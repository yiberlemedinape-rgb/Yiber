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

/** Mapa referencia → geometría, combinando la hoja Rodamientos y el catálogo. */
function mapaRodamientos_() {
  var mapa = {};
  Object.keys(RODAMIENTOS_REF).forEach(function (k) { mapa[k] = RODAMIENTOS_REF[k]; });
  leerTabla_(HOJAS.RODAMIENTOS).forEach(function (r) {
    if (!r.Referencia) return;
    mapa[String(r.Referencia)] = {
      Nb: Number(r.Nb), Bd: Number(r.Bd_mm), Pd: Number(r.Pd_mm), theta: Number(r.Theta_grados) || 0
    };
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

  var posiciones = leerTabla_(HOJAS.POSICIONES)
    .filter(function (p) { return String(p.TAG) === String(tag); })
    .sort(function (a, b) { return (Number(a.Sensor) || 0) - (Number(b.Sensor) || 0); })
    .map(function (p) {
      var relacion = Number(p.Relacion_vel) || 1;
      var ref = String(p.Rodamiento || '');
      return {
        sensor: Number(p.Sensor),
        posicion: String(p.Posicion || ''),
        unidad: String(p.Unidad || ''),
        rodamiento: ref,
        geometria: rods[ref] || null,
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
      variador: String(eq.Variador || ''),
      FL: Number(eq.FL_Hz) || null,
      polos: Number(eq.Polos) || null,
      arranque: String(eq.Arranque || ''),
      notas: String(eq.Notas || '')
    },
    posiciones: posiciones
  };
}
