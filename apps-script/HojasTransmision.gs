/**
 * HojasTransmision.gs
 * ---------------------------------------------------------------------------
 * Conexión dinámica con las hojas del archivo maestro de Kaeser Colombia:
 *   "Transmisión Por Correa" · "Transmisión Directo" · "Transmisión Engranaje"
 *
 * La lectura es TOLERANTE: se busca la fila de encabezado por palabras clave y
 * las columnas se mapean por nombre (referencia, unidad, rpm, polea, rodamiento,
 * ubicación...), de modo que el equipo puede reorganizar su hoja sin romper el
 * script. Si una columna no se encuentra, el campo llega vacío.
 *
 * Para Correa, apiActualizarCorrea() escribe RPM y diámetros de polea EN LA
 * HOJA, de modo que las fórmulas del Sheets recalculen las frecuencias de
 * falla ahí mismo (fuente única de verdad visible para el analista).
 * ---------------------------------------------------------------------------
 */

var HOJAS_TRANSMISION = {
  correa: 'Transmisión Por Correa',
  directo: 'Transmisión Directo',
  engranaje: 'Transmisión Engranaje'
};

/** Sinónimos de columnas → clave interna. El primero que case gana. */
var COLUMNAS_TRANS_ = [
  { clave: 'referencia', re: /referen|equipo|modelo|serie|m[aá]quina/i },
  { clave: 'unidad', re: /unidad|airend|compresora|sigma/i },
  { clave: 'rpm', re: /rpm|veloc.*motor|min-?1/i },
  { clave: 'poleaMotor', re: /polea.*motor|motor.*polea/i },
  { clave: 'poleaUnidad', re: /polea.*(unidad|airend|compresor)|unidad.*polea/i },
  { clave: 'rodamientos', re: /rodamiento|bearing/i },
  { clave: 'ubicacion', re: /ubicaci|posici|lado/i },
  { clave: 'lobulos', re: /l[oó]bul|pasos.*presi/i },
  { clave: 'tag', re: /^tag$|c[oó]digo|placa/i }
];

/**
 * Lee una hoja de transmisión de forma tolerante.
 * @return {{nombre:string, existe:boolean, columnas:Object, filas:Array}}
 */
function leerHojaTransmision_(nombreHoja) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreHoja);
  if (!sh) return { nombre: nombreHoja, existe: false, filas: [], columnas: {} };
  var datos = sh.getDataRange().getValues();
  if (!datos.length) return { nombre: nombreHoja, existe: true, filas: [], columnas: {} };

  // Buscar fila de encabezado en las primeras 10 filas.
  var hIdx = -1, mapa = {};
  for (var r = 0; r < Math.min(10, datos.length); r++) {
    var m = {}, hits = 0;
    for (var c = 0; c < datos[r].length; c++) {
      var celda = String(datos[r][c] || '');
      if (!celda.trim()) continue;
      for (var k = 0; k < COLUMNAS_TRANS_.length; k++) {
        var def = COLUMNAS_TRANS_[k];
        if (!(def.clave in m) && def.re.test(celda)) { m[def.clave] = c; hits++; break; }
      }
    }
    if (hits >= 2) { hIdx = r; mapa = m; break; }
  }
  if (hIdx < 0) { hIdx = 0; mapa = { referencia: 0, unidad: 1 }; } // fallback: 2 primeras columnas

  var filas = [];
  for (var i = hIdx + 1; i < datos.length; i++) {
    var ref = mapa.referencia !== undefined ? String(datos[i][mapa.referencia] || '').trim() : '';
    if (!ref) continue;
    filas.push({
      filaHoja: i + 1,                          // fila real (1-based) para write-back
      referencia: ref,
      tag: campo_(datos[i], mapa.tag),
      unidad: campo_(datos[i], mapa.unidad),
      rpm: numero_(datos[i], mapa.rpm),
      poleaMotor: numero_(datos[i], mapa.poleaMotor),
      poleaUnidad: numero_(datos[i], mapa.poleaUnidad),
      rodamientos: campo_(datos[i], mapa.rodamientos),
      ubicacion: campo_(datos[i], mapa.ubicacion),
      lobulos: numero_(datos[i], mapa.lobulos)
    });
  }
  return { nombre: nombreHoja, existe: true, columnas: mapa, filas: filas };
}

function campo_(fila, idx) { return idx === undefined ? '' : String(fila[idx] || '').trim(); }
function numero_(fila, idx) {
  if (idx === undefined) return null;
  var v = Number(fila[idx]); return isFinite(v) && v > 0 ? v : null;
}

/**
 * Equipos clasificados por tipo de transmisión, leídos de las tres hojas.
 * @return {{correa:Array, directo:Array, engranaje:Array, avisos:Array}}
 */
function apiEquiposTransmision() {
  var out = { avisos: [] };
  Object.keys(HOJAS_TRANSMISION).forEach(function (tipo) {
    var h = leerHojaTransmision_(HOJAS_TRANSMISION[tipo]);
    out[tipo] = h.filas;
    if (!h.existe) out.avisos.push('No existe la hoja "' + HOJAS_TRANSMISION[tipo] + '".');
    else if (!h.filas.length) out.avisos.push('La hoja "' + HOJAS_TRANSMISION[tipo] + '" no tiene filas reconocibles.');
  });
  return out;
}

/**
 * Actualiza RPM y poleas de un equipo de Correa EN LA HOJA para que las
 * fórmulas del Sheets recalculen las frecuencias de falla.
 * @param {{filaHoja:number, rpm:number, poleaMotor:number, poleaUnidad:number}} p
 * @return {{ok:boolean, relacion:number|null, mensaje:string}}
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
