/**
 * Importar.gs
 * ---------------------------------------------------------------------------
 * Importación de una medición completa = 4 CSV, uno por sensor (S1..S4).
 *
 * Cada CSV es un espectro exportado del VES004 con la convención Kaeser:
 *   - Primera mitad  → aceleración en mg.
 *   - Segunda mitad  → velocidad en mm/s.
 * El corte entre ambas mitades se detecta por el REINICIO del eje de frecuencia
 * (la 2ª mitad vuelve a empezar en baja frecuencia). Fallback: mitad exacta.
 *
 * Para cada sensor se guarda el espectro en la hoja "Espectros" (etiquetado por
 * unidad) y se ejecuta el diagnóstico: los órdenes (1X/2X…) se analizan sobre
 * la mitad de velocidad y la evidencia de rodamiento se refuerza con la de
 * aceleración. Devuelve un reporte consolidado de los 4 sensores.
 * ---------------------------------------------------------------------------
 */

/**
 * @param {Object} payload
 *   { etiqueta, rpm, FL, polos, rodamiento, modoCorte:'auto'|'mitad',
 *     guardar:boolean,
 *     sensores:[ { n, nombre, pos, tipo, contenido, rodamiento?, gSE?, HFD?, direccion? } ] }
 * @return {{fecha, general, porSensor:Array}}
 */
function apiImportarSensores(payload) {
  var p = payload || {};
  var sensores = p.sensores || [];
  var fecha = new Date();
  var etiqueta = p.tag || p.etiqueta || '';

  // Resolución desde la base de datos si se indicó un TAG.
  var resuelto = p.tag ? apiEquipo(p.tag) : null;
  var equipo = resuelto ? resuelto.equipo : {};
  var posPorSensor = {};
  if (resuelto) resuelto.posiciones.forEach(function (x) { posPorSensor[x.sensor] = x; });

  var ss = null, shEsp = null, shMed = null;
  if (p.guardar) {
    ss = SpreadsheetApp.getActiveSpreadsheet();
    shEsp = ss.getSheetByName(HOJAS.ESPECTROS) || ss.insertSheet(HOJAS.ESPECTROS);
    if (shEsp.getLastRow() === 0) {
      shEsp.appendRow(['Fecha', 'TAG', 'Sensor', 'Frecuencia_Hz', 'Amplitud', 'Unidad']);
    }
    shMed = ss.getSheetByName(HOJAS.MEDICIONES) || ss.insertSheet(HOJAS.MEDICIONES);
    if (shMed.getLastRow() === 0) {
      shMed.appendRow(['Fecha', 'TAG', 'Sensor', 'RPM', 'vRMS_mm_s', 'aRMS_g', 'HFD_g', 'gSE', 'Direccion', 'Rodamiento']);
    }
  }

  // Pre-escaneo del Monitoring: la señal de velocidad (4–20 mA) es única para
  // la máquina, así que la RPM del Monitoring es la del MOTOR. Se toma como
  // referencia y luego se multiplica por la relación de cada etapa.
  var motorRpmMon = null;
  sensores.forEach(function (s) {
    if (s && s.monitoring && String(s.monitoring).trim()) {
      s._mon = parseMonitoring(s.monitoring);
      if (motorRpmMon == null && isFinite(s._mon.rpm)) motorRpmMon = s._mon.rpm;
    }
  });
  var motorRpmEfectivo = numOr_(motorRpmMon, equipo.rpmMotor, p.rpm);

  var porSensor = sensores.map(function (s) {
    s = s || {};
    var nombre = s.nombre || ('S' + (s.n || '?'));
    var pos = posPorSensor[s.n] || null;
    var posTxt = s.pos || (pos && pos.posicion) || '';
    if (!s.contenido || !String(s.contenido).trim()) {
      return { sensor: nombre, n: s.n, pos: posTxt, tipo: s.tipo, vacio: true };
    }
    var mon = s._mon || {};

    var todas = parseEspectro(s.contenido);          // orden de archivo (sin ordenar)
    var partes = partirEspectro_(todas, p.modoCorte); // {accel:[], vel:[]}
    var aviso = validarSenal_(todas, partes);

    // Persistir en la hoja Espectros.
    if (shEsp && todas.length) {
      var filas = [];
      partes.accel.forEach(function (r) { filas.push([fecha, etiqueta, nombre, r[0], r[1], 'mg']); });
      partes.vel.forEach(function (r) { filas.push([fecha, etiqueta, nombre, r[0], r[1], 'mm/s']); });
      if (filas.length) shEsp.getRange(shEsp.getLastRow() + 1, 1, filas.length, 6).setValues(filas);
    }

    // RPM de la posición: manual > (RPM motor efectiva × relación de etapa) > p.rpm.
    var relacion = pos ? (pos.relacion || 1) : 1;
    var rpm = numOr_(s.rpm, motorRpmEfectivo ? motorRpmEfectivo * relacion : null, p.rpm);

    // Rodamiento(s): override manual > lista resuelta de la BD > payload global.
    // pos.rodamientos ya viene resuelto contra la hoja Rodamientos ([{ref,geo}]),
    // así el motor reconoce referencias que solo existen en la hoja.
    var rodamiento = s.rodamiento || (pos && (pos.rodamientos && pos.rodamientos.length ? pos.rodamientos : pos.rodamiento)) || p.rodamiento || undefined;
    var rodTexto = s.rodamiento || (pos && pos.rodamiento) || p.rodamiento || '';
    var limites = s.limites || (pos && pos.limites) || p.limites || {};
    var FL = numOr_(p.FL, equipo.FL, null);
    var polos = numOr_(p.polos, equipo.polos, null);
    var dientes = numOr_(s.dientes, pos ? pos.nDientes : null, null);
    var lobulos = numOr_(s.alabes, pos ? pos.nLobulos : null, null);

    // Globales: se prefieren los REALES del Monitoring; si no, el estimado del
    // espectro (v-RMS de velocidad; a-RMS en g desde la mitad de aceleración mg).
    var vRMSest = overallRMS_(partes.vel);
    var aRMSmg = overallRMS_(partes.accel);
    var aRMSest = (aRMSmg === undefined) ? undefined : aRMSmg / 1000;

    var vRMS = numOr_(mon.vRMS, vRMSest);
    var aRMS = numOr_(mon.aRMS, aRMSest);
    var gSE = numOr_(mon.gSE, (s.gSE !== undefined && s.gSE !== '') ? Number(s.gSE) : null);
    var HFD = numOr_(mon.HFD, (s.HFD !== undefined && s.HFD !== '') ? Number(s.HFD) : null);
    var hayMon = isFinite(mon.vRMS) || isFinite(mon.aRMS) || isFinite(mon.gSE) || isFinite(mon.HFD);

    var medicion = {
      rpm: rpm, FL: FL, polos: polos,
      rodamiento: rodamiento,
      espectro: partes.vel,
      espectroAccel: partes.accel,
      direccion: s.direccion || '',
      limites: limites,
      global: { vRMS: vRMS, aRMS: aRMS, gSE: gSE, HFD: HFD },
      engranaje: dientes ? { dientes: dientes } : undefined,
      alabes: lobulos ? { n: lobulos } : undefined
    };

    var diag = diagnosticar(medicion);
    if (p.guardar) {
      try { guardarDiagnostico_({ etiqueta: etiqueta, sensor: nombre, rpm: rpm }, diag); } catch (e) {}
      if (shMed) {
        try {
          shMed.appendRow([fecha, etiqueta, nombre, rpm,
            vRMS == null ? '' : redondear_(vRMS, 3),
            aRMS == null ? '' : redondear_(aRMS, 4),
            HFD == null ? '' : HFD, gSE == null ? '' : gSE,
            s.direccion || '', rodTexto]);
        } catch (e) {}
      }
    }

    var avisos = [aviso].concat(mon._avisos || []).filter(function (x) { return x; });

    return {
      sensor: nombre, n: s.n, pos: posTxt, tipo: s.tipo,
      rpm: rpm, rodamiento: rodTexto,
      nAccel: partes.accel.length, nVel: partes.vel.length,
      fuenteGlobal: hayMon ? 'Monitoring (real)' : 'estimado del espectro',
      rpmReal: isFinite(mon.rpm) ? mon.rpm : null,
      vRMS_val: (vRMS == null ? null : redondear_(vRMS, 3)),
      aRMS_val: (aRMS == null ? null : redondear_(aRMS, 4)),
      gSE_val: (gSE == null ? null : gSE),
      limites: diag.limites,
      aviso: avisos.join(' '),
      semaforo: diag.semaforo, resumen: diag.resumen,
      hallazgos: diag.hallazgos, frecuencias: diag.frecuencias
    };
  });

  return { fecha: fecha, equipo: equipo, general: peorSemaforo_(porSensor), porSensor: porSensor };
}

/** Primer valor numérico positivo entre los candidatos. */
function numOr_() {
  for (var i = 0; i < arguments.length; i++) {
    var v = Number(arguments[i]);
    if (isFinite(v) && v > 0) return v;
  }
  return undefined;
}

/**
 * Parte un espectro en su mitad de aceleración (mg) y de velocidad (mm/s).
 * modo 'auto' (por defecto): busca el reinicio del eje de frecuencia.
 * modo 'mitad': corta en total/2.
 * @return {{accel:Array<[number,number]>, vel:Array<[number,number]>}}
 */
function partirEspectro_(rows, modo) {
  if (!rows || !rows.length) return { accel: [], vel: [] };
  var b = -1;
  if (modo !== 'mitad') {
    for (var i = 1; i < rows.length; i++) {
      // Reinicio: la frecuencia cae de forma marcada (< 50% de la anterior).
      if (rows[i][0] < rows[i - 1][0] * 0.5) { b = i; break; }
    }
  }
  if (b < 0) b = Math.floor(rows.length / 2);
  return { accel: rows.slice(0, b), vel: rows.slice(b) };
}

/** Overall RMS estimado del espectro (raíz de la suma de cuadrados de las líneas). */
function overallRMS_(rows) {
  if (!rows || !rows.length) return undefined;
  var s = 0;
  for (var i = 0; i < rows.length; i++) s += rows[i][1] * rows[i][1];
  return Math.sqrt(s);
}

/**
 * Detecta problemas de señal:
 *  - "franja recta" (amplitud prácticamente constante) = cable/ajuste/posición.
 *  - archivo sin corte accel/vel detectado.
 */
function validarSenal_(todas, partes) {
  if (!todas || todas.length < 4) return 'Muy pocas líneas en el archivo; verifica el export.';
  var amps = todas.map(function (r) { return r[1]; });
  var min = Math.min.apply(null, amps), max = Math.max.apply(null, amps);
  if (max > 0 && (max - min) / max < 0.02) {
    return 'Franja recta en datos (amplitud casi constante): revisa cable, ajuste y posición del sensor.';
  }
  if (!partes.accel.length || !partes.vel.length) {
    return 'No se detectó corte aceleración/velocidad; se usó partición a la mitad.';
  }
  return '';
}

/** Peor semáforo entre los sensores (ROJO > AMARILLO > VERDE). */
function peorSemaforo_(porSensor) {
  var orden = { VERDE: 0, AMARILLO: 1, ROJO: 2 };
  var peor = 'VERDE';
  porSensor.forEach(function (r) {
    if (r.semaforo && orden[r.semaforo] > orden[peor]) peor = r.semaforo;
  });
  return peor;
}
