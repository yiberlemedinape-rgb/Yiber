/**
 * BaseDatos.gs
 * ---------------------------------------------------------------------------
 * Capa de acceso a la base de datos (hojas de cálculo). Resuelve, por equipo,
 * todo lo que el motor necesita POR POSICIÓN de medición:
 *   - rodamiento (referencia → geometría → frecuencias de defecto),
 *   - velocidad de giro de la posición (RPM_motor × relación de transmisión),
 *   - límites de control (aviso / condenatorio) en velocidad y aceleración,
 *   - nº de lóbulos (BPF) y nº de dientes (GMF) cuando aplica.
 * ---------------------------------------------------------------------------
 */

/** Lee una hoja como arreglo de objetos {encabezado: valor}. */
function leerTabla_(nombre) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return [];
  var datos = sh.getDataRange().getValues();
  var headers = datos.shift();
  return datos.map(function (fila) {
    var o = {};
    headers.forEach(function (h, i) { o[String(h)] = fila[i]; });
    return o;
  });
}

/** Lista de equipos para el selector de la interfaz. */
function apiListaEquipos() {
  return leerTabla_(HOJAS.EQUIPOS)
    .filter(function (e) { return e.TAG; })
    .map(function (e) {
      return { tag: String(e.TAG), serie: String(e.Serie || ''), familia: String(e.Familia || '') };
    });
}

/** Mapa referencia → definición, combinando la hoja Rodamientos y el catálogo.
 *  Prefiere los coeficientes del fabricante (órdenes/rev) si están presentes. */
function mapaRodamientos_() {
  var mapa = {};
  Object.keys(RODAMIENTOS_REF).forEach(function (k) { mapa[k] = RODAMIENTOS_REF[k]; });
  leerTabla_(HOJAS.RODAMIENTOS).forEach(function (r) {
    if (!r.Referencia) return;
    var coefI = Number(r.BPFI_orden), coefO = Number(r.BPFO_orden);
    if ((isFinite(coefI) && coefI > 0) || (isFinite(coefO) && coefO > 0)) {
      mapa[String(r.Referencia)] = {
        coefBPFI: coefI || 0, coefBPFO: coefO || 0,
        coefBSF: Number(r.BSF_orden) || 0, Nb: Number(r.Nb) || 0
      };
    } else {
      mapa[String(r.Referencia)] = {
        Nb: Number(r.Nb), Bd: Number(r.Bd_mm), Pd: Number(r.Pd_mm), theta: Number(r.Theta_grados) || 0
      };
    }
  });
  return mapa;
}

/**
 * Devuelve el equipo con sus posiciones resueltas.
 * @param {string} tag
 * @return {{equipo:Object, posiciones:Array}|null}
 */
function apiEquipo(tag) {
  if (!tag) return null;
  var eq = leerTabla_(HOJAS.EQUIPOS).filter(function (e) { return String(e.TAG) === String(tag); })[0];
  if (!eq) return null;

  var rpmMotor = Number(eq.RPM_motor) || 0;
  var rods = mapaRodamientos_();

  // Transmisión: la del equipo, o clasificada por la regla de la "D".
  var transmision = String(eq.Transmision || '').trim() ||
    clasificarTransmision_(eq.Familia, eq.Serie || eq.TAG);
  var poleaMotor = Number(eq.Polea_motor_mm) || 0;
  var poleaAirend = Number(eq.Polea_airend_mm) || 0;

  var posiciones = leerTabla_(HOJAS.POSICIONES)
    .filter(function (p) { return String(p.TAG) === String(tag); })
    .sort(function (a, b) { return (Number(a.Sensor) || 0) - (Number(b.Sensor) || 0); })
    .map(function (p) {
      var unidad = String(p.Unidad || '');
      // Relación: la explícita de la hoja; si está vacía, se deriva de la
      // transmisión (correa → razón de poleas en airend; directa → 1).
      var relacion = Number(p.Relacion_vel) ||
        relacionDerivada_(unidad, transmision, poleaMotor, poleaAirend);
      var ref = String(p.Rodamiento || '');
      // Varias referencias por posición, separadas por coma ("NU206E,NA4904").
      var lista = ref.split(',').map(function (x) { return x.trim(); }).filter(String)
        .map(function (x) { return { ref: x, geo: rods[x] || null }; });
      return {
        sensor: Number(p.Sensor),
        posicion: String(p.Posicion || ''),
        unidad: unidad,
        rodamiento: ref,
        rodamientos: lista,           // [{ref, geo}] resueltos contra la hoja
        geometria: lista.length === 1 ? lista[0].geo : null,
        relacion: relacion,
        rpm: redondear_(rpmMotor * relacion, 1),
        nLobulos: Number(p.N_lobulos) || null,
        nDientes: Number(p.N_dientes) || null,
        limites: {
          velAviso: Number(p.Vel_aviso_mm_s) || null,
          velCond: Number(p.Vel_cond_mm_s) || null,
          acelAviso: Number(p.Acel_aviso_g) || null,
          acelCond: Number(p.Acel_cond_g) || null,
          gseAviso: Number(p.gSE_aviso) || null,
          gseCond: Number(p.gSE_cond) || null
        }
      };
    });

  return {
    equipo: {
      tag: String(eq.TAG),
      serie: String(eq.Serie || ''),
      familia: String(eq.Familia || ''),
      airend: String(eq.Airend || ''),
      motor: String(eq.Motor || ''),
      rpmMotor: rpmMotor,
      transmision: transmision,
      poleaMotor: poleaMotor || null,
      poleaAirend: poleaAirend || null,
      variador: String(eq.Variador || ''),
      FL: Number(eq.FL_Hz) || null,
      polos: Number(eq.Polos) || null,
      arranque: String(eq.Arranque || ''),
      notas: String(eq.Notas || '')
    },
    posiciones: posiciones
  };
}

/**
 * Relación de velocidad derivada de la transmisión cuando no está explícita.
 *  - Correa: airend gira a Polea_motor/Polea_airend; motor/gearbox = 1.
 *  - Directa: todo a 1 (acople directo, screw = motor).
 *  - Engranaje: 1 por defecto (la multiplicadora real debe ir en Posiciones).
 */
function relacionDerivada_(unidad, transmision, poleaMotor, poleaAirend) {
  var u = String(unidad || '').toLowerCase();
  if (transmision === 'Correa' && u === 'airend' && poleaMotor > 0 && poleaAirend > 0) {
    return poleaMotor / poleaAirend;
  }
  return 1;
}
