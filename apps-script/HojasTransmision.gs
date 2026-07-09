/**
 * HojasTransmision.gs
 * ---------------------------------------------------------------------------
 * Conexión dinámica con las hojas del archivo maestro "Proyecto Vibraciones":
 *   "Transmisión Por Correa" · "Transmisión Directo" · "Transmisión Engranaje"
 *
 * ESTRUCTURA REAL (según el archivo de Kaeser Colombia):
 *  - Cada EQUIPO ocupa un bloque de varias filas (celdas combinadas): la
 *    referencia aparece solo en la primera fila del bloque y cada fila del
 *    bloque describe UN rodamiento (Ubicación, Designation, BPFI/BPFO/BSF en
 *    órdenes, #ElemRod y las frecuencias de falla calculadas por la hoja).
 *  - Columnas correa:  Referencia | Transmisión | Unidad Compresora |
 *    Polea Motor (mm) | Polea Unidad (mm) | Rpm Motor | Pasos de Presión |
 *    Armonico Admisión 1X | Armonico Motor 1X | Velocidad del Rotor Macho |
 *    Ubicación Rodamientos | Designation | BPFI | BPFO | BSF | #ElemRod | ...
 *  - Columnas directo: igual sin poleas ni Armonico Admisión.
 *  - "Velocidad del Rotor Macho" = relación macho/hembra (p.ej. 1.2 = 6/5
 *    lóbulos): los rodamientos de la HEMBRA giran a fr_macho / 1.2.
 *
 * La lectura es TOLERANTE: encabezados por expresión regular, de modo que se
 * pueden añadir columnas sin romper el script.
 * ---------------------------------------------------------------------------
 */

var HOJAS_TRANSMISION = {
  correa: 'Transmisión Por Correa',
  directo: 'Transmisión Directo',
  engranaje: 'Transmisión Engranaje'
};

/** Sinónimos de columnas → clave interna (sobre encabezado normalizado). */
var COLUMNAS_TRANS_ = [
  { clave: 'referencia', re: /^referencia$|^referen/ },
  { clave: 'transmision', re: /^transmisi/ },
  { clave: 'unidad', re: /unidad\s*compresora|^unidad$/ },
  { clave: 'poleaMotor', re: /polea.*motor/ },
  { clave: 'poleaUnidad', re: /polea.*unidad|polea.*airend/ },
  { clave: 'rpm', re: /^rpm|rpm.*motor/ },
  { clave: 'pasosPresion', re: /pasos.*presi/ },
  { clave: 'armAdmision', re: /armonico.*admisi/ },
  { clave: 'armMotor', re: /armonico.*motor/ },
  { clave: 'relMacho', re: /rotor\s*macho/ },
  { clave: 'ubicacion', re: /ubicaci/ },
  { clave: 'designacion', re: /^designat|^rodamiento$|^bearing$/ },
  { clave: 'bpfi', re: /^bpfi$/ },
  { clave: 'bpfo', re: /^bpfo$/ },
  { clave: 'bsf', re: /^bsf$/ },
  { clave: 'nb', re: /elem\s*rod|^#\s*elem|^nb$/ }
];

function normalizarTexto_(s) {
  s = String(s == null ? '' : s).toLowerCase().trim();
  if (String.prototype.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s;
}

/**
 * Lee una hoja de transmisión agrupando por BLOQUES de equipo.
 * @return {{nombre, existe, columnas, equipos:Array}}
 */
function leerHojaTransmision_(nombreHoja) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreHoja);
  if (!sh) return { nombre: nombreHoja, existe: false, equipos: [], columnas: {} };
  var datos = sh.getDataRange().getValues();
  if (!datos.length) return { nombre: nombreHoja, existe: true, equipos: [], columnas: {} };

  // Fila de encabezado: la primera (en las 10 primeras) con ≥3 coincidencias.
  var hIdx = -1, mapa = {};
  for (var r = 0; r < Math.min(10, datos.length); r++) {
    var m = {}, hits = 0;
    for (var c = 0; c < datos[r].length; c++) {
      var celda = normalizarTexto_(datos[r][c]);
      if (!celda) continue;
      for (var k = 0; k < COLUMNAS_TRANS_.length; k++) {
        var def = COLUMNAS_TRANS_[k];
        if (!(def.clave in m) && def.re.test(celda)) { m[def.clave] = c; hits++; break; }
      }
    }
    if (hits >= 3) { hIdx = r; mapa = m; break; }
  }
  if (hIdx < 0) return { nombre: nombreHoja, existe: true, equipos: [], columnas: {} };

  var equipos = [], actual = null;
  for (var i = hIdx + 1; i < datos.length; i++) {
    var fila = datos[i];
    var ref = campo_(fila, mapa.referencia);

    if (ref) {                       // inicia un bloque de equipo
      actual = {
        filaHoja: i + 1,             // primera fila del bloque (write-back)
        referencia: ref,
        transmision: campo_(fila, mapa.transmision),
        unidad: campo_(fila, mapa.unidad),
        rpm: numero_(fila, mapa.rpm),
        poleaMotor: numero_(fila, mapa.poleaMotor),
        poleaUnidad: numero_(fila, mapa.poleaUnidad),
        pasosPresion: numero_(fila, mapa.pasosPresion),
        armAdmision: numero_(fila, mapa.armAdmision),
        armMotor: numero_(fila, mapa.armMotor),
        relMacho: numero_(fila, mapa.relMacho),
        rodamientos: []
      };
      equipos.push(actual);
    }
    if (!actual) continue;

    // Fila de rodamiento (puede coexistir con la primera fila del bloque).
    var desig = campo_(fila, mapa.designacion);
    var ubic = campo_(fila, mapa.ubicacion);
    if (desig || ubic) {
      var rod = {
        ubicacion: ubic,
        ref: desig,
        coefBPFI: numero_(fila, mapa.bpfi) || 0,
        coefBPFO: numero_(fila, mapa.bpfo) || 0,
        coefBSF: numero_(fila, mapa.bsf) || 0,
        Nb: numero_(fila, mapa.nb) || 0
      };
      if (rod.ref && (rod.coefBPFI || rod.coefBPFO)) actual.rodamientos.push(rod);
    }
  }
  return { nombre: nombreHoja, existe: true, columnas: mapa, equipos: equipos };
}

function campo_(fila, idx) { return idx === undefined ? '' : String(fila[idx] == null ? '' : fila[idx]).trim(); }
function numero_(fila, idx) {
  if (idx === undefined) return null;
  var v = Number(fila[idx]); return isFinite(v) && v > 0 ? v : null;
}

/**
 * Equipos clasificados por tipo de transmisión, con su tabla de rodamientos.
 * @return {{correa:Array, directo:Array, engranaje:Array, avisos:Array}}
 */
function apiEquiposTransmision() {
  var out = { avisos: [] };
  Object.keys(HOJAS_TRANSMISION).forEach(function (tipo) {
    var h = leerHojaTransmision_(HOJAS_TRANSMISION[tipo]);
    out[tipo] = h.equipos;
    if (!h.existe) out.avisos.push('No existe la hoja "' + HOJAS_TRANSMISION[tipo] + '".');
    else if (!h.equipos.length) out.avisos.push('La hoja "' + HOJAS_TRANSMISION[tipo] + '" no tiene bloques reconocibles.');
  });
  return out;
}

/**
 * Actualiza RPM y poleas del bloque de un equipo de Correa EN LA HOJA, para
 * que las fórmulas del Sheets recalculen las frecuencias de falla.
 */
function apiActualizarCorrea(p) {
  p = p || {};
  var h = leerHojaTransmision_(HOJAS_TRANSMISION.correa);
  if (!h.existe) return { ok: false, mensaje: 'No existe la hoja "' + HOJAS_TRANSMISION.correa + '".' };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJAS_TRANSMISION.correa);

  var escritos = [];
  [['rpm', p.rpm], ['poleaMotor', p.poleaMotor], ['poleaUnidad', p.poleaUnidad]].forEach(function (par) {
    var col = h.columnas[par[0]];
    var val = Number(par[1]);
    if (col !== undefined && isFinite(val) && val > 0) {
      sh.getRange(p.filaHoja, col + 1).setValue(val);
      escritos.push(par[0]);
    }
  });

  var relacion = (p.poleaMotor > 0 && p.poleaUnidad > 0) ? p.poleaMotor / p.poleaUnidad : null;
  return {
    ok: escritos.length > 0,
    relacion: relacion,
    mensaje: escritos.length
      ? 'Actualizado en la hoja: ' + escritos.join(', ') + (relacion ? ' · relación ' + relacion.toFixed(4) : '')
      : 'No se encontraron columnas de RPM/poleas en la hoja (revisa los encabezados).'
  };
}

/**
 * Asigna los rodamientos de un bloque a los 4 sensores según su "Ubicación":
 *   Admisión → S3 · Compresión → S4 · Motor Trasera → S2 · Motor Delantera →
 *   S1 (correa). En Directa el sensor de motor es S2 (S1 es el ventilador),
 *   así que ambos rodamientos de motor van a S2.
 * Cada rodamiento lleva su factor de velocidad respecto al SENSOR:
 *   macho = 1 · hembra = 1/relMacho (giran más despacio) · motor = 1.
 */
function asignarRodamientosASensores(equipo, tipo) {
  var asign = { 1: [], 2: [], 3: [], 4: [] };
  var relM = equipo.relMacho || 1;
  (equipo.rodamientos || []).forEach(function (rod) {
    var u = normalizarTexto_(rod.ubicacion);
    var esHembra = /hembra/.test(u);
    var item = {
      ref: rod.ref + (esHembra ? ' (hembra)' : ''),
      ubicacion: rod.ubicacion,
      coefBPFI: rod.coefBPFI, coefBPFO: rod.coefBPFO, coefBSF: rod.coefBSF, Nb: rod.Nb,
      factorVel: esHembra ? 1 / relM : 1
    };
    if (/admisi/.test(u)) asign[3].push(item);
    else if (/compresi/.test(u)) asign[4].push(item);
    else if (/motor/.test(u)) {
      if (tipo === 'correa') {
        if (/delanter/.test(u)) asign[1].push(item);
        else asign[2].push(item);       // trasera (o sin especificar)
      } else {
        asign[2].push(item);            // directa: S2 = motor principal
      }
    }
  });
  return asign;
}
