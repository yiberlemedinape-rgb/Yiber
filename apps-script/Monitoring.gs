/**
 * Monitoring.gs
 * ---------------------------------------------------------------------------
 * Parser del CSV de "Monitoring" (valores globales) del VES004.
 *
 * El Monitoring Window (MA 00-21-02.2 §7.1) registra en el tiempo los valores
 * de cada objeto de medición por sensor: v-RMS (mm/s), a-RMS (g), HFD (g),
 * gSE/Spike Energy, temperatura y velocidad (rpm). Este parser detecta las
 * columnas por su encabezado y devuelve un valor representativo (mediana,
 * robusta frente a transitorios) y el máximo de la ventana.
 *
 * Formato esperado: ancho, con fila de encabezado. Una fila por muestra.
 * Separadores coma, punto y coma, tab o espacios (se reutiliza dividirCampos_).
 * ---------------------------------------------------------------------------
 */

/**
 * @param {string} texto contenido del CSV de Monitoring de un sensor.
 * @return {{vRMS?:number, aRMS?:number, HFD?:number, gSE?:number, temp?:number,
 *           rpm?:number, _max?:Object, _avisos?:Array, _cols?:Array}}
 */
function parseMonitoring(texto) {
  var lineas = String(texto || '').split(/\r?\n/).filter(function (l) { return l.trim(); });
  if (lineas.length < 2) return {};

  var headers = dividirCampos_(lineas[0]).map(normalizarHeader_);
  var colMap = {};  // feature -> índice de columna
  headers.forEach(function (h, i) {
    var f = featureDeHeader_(h);
    if (f && !(f in colMap)) colMap[f] = i;
  });
  if (!Object.keys(colMap).length) return { _avisos: ['No se reconocieron columnas en el encabezado del Monitoring.'] };

  var acc = {};
  for (var r = 1; r < lineas.length; r++) {
    var campos = dividirCampos_(lineas[r]);
    Object.keys(colMap).forEach(function (f) {
      var v = aNumero_(campos[colMap[f]]);
      if (v !== null) (acc[f] = acc[f] || []).push(v);
    });
  }

  var out = { _max: {}, _avisos: [], _cols: Object.keys(colMap) };
  Object.keys(acc).forEach(function (f) {
    out[f] = mediana_(acc[f]);
    out._max[f] = Math.max.apply(null, acc[f]);
  });

  // Heurística de unidad de aceleración: si el a-RMS "en g" es absurdamente
  // grande, probablemente venga en mg → convertir a g y avisar.
  if (isFinite(out.aRMS) && out.aRMS > 50) {
    out._avisos.push('a-RMS ' + redondear_(out.aRMS, 1) + ' parece estar en mg; convertido a g (÷1000).');
    out.aRMS = out.aRMS / 1000;
    if (out._max.aRMS) out._max.aRMS = out._max.aRMS / 1000;
  }
  return out;
}

/** Normaliza un encabezado: minúsculas, sin acentos, sin espacios sobrantes. */
function normalizarHeader_(h) {
  var s = String(h == null ? '' : h).toLowerCase();
  if (String.prototype.normalize) {
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); // quita diacríticos
  }
  return s.trim();
}

/** Mapea un encabezado normalizado a una característica conocida. */
function featureDeHeader_(h) {
  if (!h) return null;
  // Orden importa: evaluar lo más específico primero.
  if (/gse|spike/.test(h)) return 'gSE';
  if (/hfd/.test(h)) return 'HFD';
  if (/(a[-_ ]?rms|acel|accel|aceleracion|acceleration)/.test(h)) return 'aRMS';
  if (/(v[-_ ]?rms|veloc|velocity|mm\/s|mm_s)/.test(h)) return 'vRMS';
  if (/(temp|temperatura|°c|deg)/.test(h)) return 'temp';
  if (/(rpm|speed|drehzahl|veloc.*giro|min-1|min\^-1)/.test(h)) return 'rpm';
  return null;
}

/** Mediana de un arreglo numérico. */
function mediana_(arr) {
  if (!arr || !arr.length) return undefined;
  var s = arr.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
