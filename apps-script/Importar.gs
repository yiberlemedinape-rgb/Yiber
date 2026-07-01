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

  var ss = null, shEsp = null;
  if (p.guardar) {
    ss = SpreadsheetApp.getActiveSpreadsheet();
    shEsp = ss.getSheetByName(HOJAS.ESPECTROS) || ss.insertSheet(HOJAS.ESPECTROS);
    if (shEsp.getLastRow() === 0) {
      shEsp.appendRow(['Fecha', 'TAG', 'Sensor', 'Frecuencia_Hz', 'Amplitud', 'Unidad']);
    }
  }

  var porSensor = sensores.map(function (s) {
    s = s || {};
    var nombre = s.nombre || ('S' + (s.n || '?'));
    if (!s.contenido || !String(s.contenido).trim()) {
      return { sensor: nombre, n: s.n, pos: s.pos, tipo: s.tipo, vacio: true };
    }

    var todas = parseEspectro(s.contenido);          // orden de archivo (sin ordenar)
    var partes = partirEspectro_(todas, p.modoCorte); // {accel:[], vel:[]}

    // Diagnóstico de calidad de la señal (una "franja recta" = falla de cable).
    var aviso = validarSenal_(todas, partes);

    // Persistir en la hoja Espectros.
    if (shEsp && todas.length) {
      var filas = [];
      partes.accel.forEach(function (r) { filas.push([fecha, p.etiqueta || '', nombre, r[0], r[1], 'mg']); });
      partes.vel.forEach(function (r) { filas.push([fecha, p.etiqueta || '', nombre, r[0], r[1], 'mm/s']); });
      if (filas.length) shEsp.getRange(shEsp.getLastRow() + 1, 1, filas.length, 6).setValues(filas);
    }

    // v-RMS global estimado a partir de la mitad de velocidad.
    var vRMS = overallRMS_(partes.vel);

    var medicion = {
      rpm: p.rpm, FL: p.FL, polos: p.polos,
      rodamiento: s.rodamiento || p.rodamiento || undefined,
      espectro: partes.vel,          // velocidad (órdenes)
      espectroAccel: partes.accel,   // aceleración (rodamiento)
      direccion: s.direccion || '',
      global: {
        vRMS: vRMS,
        gSE: (s.gSE !== undefined && s.gSE !== '' ) ? Number(s.gSE) : undefined,
        HFD: (s.HFD !== undefined && s.HFD !== '' ) ? Number(s.HFD) : undefined
      }
    };

    var diag = diagnosticar(medicion);
    if (p.guardar) {
      try { guardarDiagnostico_({ etiqueta: p.etiqueta, sensor: nombre, rpm: p.rpm }, diag); } catch (e) {}
    }

    return {
      sensor: nombre, n: s.n, pos: s.pos, tipo: s.tipo,
      nAccel: partes.accel.length, nVel: partes.vel.length,
      vRMS_est: (vRMS === undefined ? null : redondear_(vRMS, 3)),
      aviso: aviso,
      semaforo: diag.semaforo, resumen: diag.resumen,
      hallazgos: diag.hallazgos, frecuencias: diag.frecuencias
    };
  });

  return { fecha: fecha, general: peorSemaforo_(porSensor), porSensor: porSensor };
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
