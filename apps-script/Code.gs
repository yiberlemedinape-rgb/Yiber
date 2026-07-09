/**
 * Code.gs
 * ---------------------------------------------------------------------------
 * Entradas del proyecto:
 *   - onOpen(): menú en Google Sheets.
 *   - doGet(): sirve la interfaz web (Index.html).
 *   - Funciones invocadas desde el HTML vía google.script.run.
 * ---------------------------------------------------------------------------
 */

/** Menú personalizado al abrir la hoja. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔧 Diagnóstico Kaeser')
    .addItem('Inicializar hojas', 'inicializarHojas')
    .addItem('Sugerir transmisión (regla "D")', 'sugerirTransmision')
    .addItem('Abrir interfaz web (URL)', 'mostrarUrlWebApp')
    .addSeparator()
    .addItem('Acerca de', 'acercaDe')
    .addToUi();
}

/** Sirve la aplicación web. */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Diagnóstico de Vibraciones Kaeser — VES004')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Permite incluir parciales HTML si se necesita (google Apps Script include). */
function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

/* ===================== API llamada desde el HTML ===================== */

/**
 * Devuelve la configuración de montaje/criterios para poblar la interfaz.
 */
function apiConfig() {
  return {
    montaje: MONTAJE_SENSORES,
    montajeTransmision: MONTAJE_TRANSMISION,
    requisitos: MONTAJE_REQUISITOS,
    criterios: CRITERIOS_TOMA,
    rodamientos: Object.keys(RODAMIENTOS_REF),
    rodamientosDef: RODAMIENTOS_REF,   // coeficientes/geometría para el cliente (marcas ±10%)
    tolerancia: TOLERANCIA,
    umbrales: {
      velocidad: UMBRALES_VELOCIDAD_RMS,
      gSE: UMBRALES_GSE,
      HFD: UMBRALES_HFD
    }
  };
}

/**
 * Recibe la medición desde la interfaz, ejecuta el diagnóstico y opcionalmente
 * lo registra en la hoja "Diagnostico".
 * @param {Object} payload medición + {guardar:boolean, etiqueta:string, sensor:string}
 */
function apiDiagnosticar(payload) {
  var p = payload || {};
  // Parsear espectro si viene como texto.
  if (typeof p.espectroTexto === 'string' && p.espectroTexto.trim()) {
    p.espectro = parseEspectro(p.espectroTexto);
  }
  var resultado = diagnosticar(p);

  if (p.guardar) {
    try { guardarDiagnostico_(p, resultado); } catch (e) { resultado.avisoGuardado = String(e); }
  }
  return resultado;
}

/**
 * Parser tolerante de espectro pegado desde VES004 / CSV.
 * Acepta separadores coma, punto y coma, tab o espacios; ignora encabezados y
 * usa las dos primeras columnas numéricas de cada línea como [frecuencia, amp].
 * Reconoce coma decimal si no hay separador de columnas de coma.
 * @return {Array<[number,number]>}
 */
function parseEspectro(texto) {
  var out = [];
  var lineas = String(texto).split(/\r?\n/);
  lineas.forEach(function (linea) {
    if (!linea || !linea.trim()) return;
    var campos = dividirCampos_(linea);
    var nums = [];
    for (var i = 0; i < campos.length && nums.length < 2; i++) {
      var v = aNumero_(campos[i]);
      if (v !== null) nums.push(v);
    }
    if (nums.length === 2) out.push([nums[0], nums[1]]);
  });
  return out;
}

function dividirCampos_(linea) {
  // Si hay ; o , o tab, usarlos como separador; si no, espacios.
  if (/[;\t]/.test(linea)) return linea.split(/[;\t]+/);
  if (/,/.test(linea) && /,.*,/.test(linea)) return linea.split(/,+/); // varias comas => separador
  if (/\s{1,}/.test(linea) && !/,/.test(linea)) return linea.split(/\s+/);
  return linea.split(/[,;\t\s]+/);
}

function aNumero_(s) {
  if (s === undefined || s === null) return null;
  var t = String(s).trim();
  if (!t) return null;
  // Coma decimal (europeo): "49,5" -> "49.5" solo si no hay punto ya.
  if (/^-?\d+,\d+$/.test(t)) t = t.replace(',', '.');
  var v = parseFloat(t);
  return isFinite(v) ? v : null;
}

/* ========================= HOJAS DE CÁLCULO ========================= */

/** Crea las hojas base con encabezados y datos de ejemplo. Idempotente. */
function inicializarHojas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var defs = {};
  defs[HOJAS.EQUIPOS] = ['TAG', 'Serie', 'Familia', 'Airend', 'Motor', 'RPM_motor', 'Transmision', 'Polea_motor_mm', 'Polea_airend_mm', 'Variador', 'FL_Hz', 'Polos', 'Arranque', 'Notas'];
  defs[HOJAS.POSICIONES] = ['TAG', 'Sensor', 'Posicion', 'Unidad', 'Rodamiento', 'Relacion_vel', 'Vel_aviso_mm_s', 'Vel_cond_mm_s', 'Acel_aviso_g', 'Acel_cond_g', 'gSE_aviso', 'gSE_cond', 'N_lobulos', 'N_dientes'];
  defs[HOJAS.UNIDADES] = ['Codigo', 'Familia', 'Rod_admision', 'Rod_compresion', 'N_lobulos', 'N_dientes', 'Relacion_default'];
  defs[HOJAS.MOTORES] = ['Codigo', 'Rod_DE', 'Rod_NDE', 'Polos'];
  defs[HOJAS.SENSORES] = ['Familia', 'Sensor', 'Posicion', 'Tipo'];
  defs[HOJAS.MEDICIONES] = ['Fecha', 'TAG', 'Sensor', 'RPM', 'vRMS_mm_s', 'aRMS_g', 'HFD_g', 'gSE', 'Direccion', 'Rodamiento'];
  defs[HOJAS.ESPECTROS] = ['Fecha', 'TAG', 'Sensor', 'Frecuencia_Hz', 'Amplitud', 'Unidad'];
  defs[HOJAS.DIAGNOSTICO] = ['Fecha', 'TAG', 'Sensor', 'RPM', 'Semaforo', 'Causa_probable', 'Confianza', 'Resumen', 'Acciones'];
  defs[HOJAS.UMBRALES] = ['Parametro', 'Bueno', 'Aceptable', 'Alarma'];
  defs[HOJAS.RODAMIENTOS] = ['Referencia', 'Nb', 'Bd_mm', 'Pd_mm', 'Theta_grados', 'BPFI_orden', 'BPFO_orden', 'BSF_orden'];

  Object.keys(defs).forEach(function (nombre) {
    var sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, defs[nombre].length).setValues([defs[nombre]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });

  sembrarHoja_(ss, HOJAS.EQUIPOS, SEED.equipos);
  sembrarHoja_(ss, HOJAS.POSICIONES, SEED.posiciones);
  sembrarHoja_(ss, HOJAS.UNIDADES, SEED.unidades);
  sembrarHoja_(ss, HOJAS.MOTORES, SEED.motores);

  // Poblar Sensores (mapa de montaje por familia).
  var filasS = [];
  Object.keys(MONTAJE_SENSORES).forEach(function (fam) {
    MONTAJE_SENSORES[fam].sensores.forEach(function (s) {
      filasS.push([fam, s.n, s.pos, s.tipo]);
    });
  });
  sembrarHoja_(ss, HOJAS.SENSORES, filasS);

  sembrarHoja_(ss, HOJAS.UMBRALES, [
    ['vRMS_mm_s', UMBRALES_VELOCIDAD_RMS.buenoMax, UMBRALES_VELOCIDAD_RMS.aceptableMax, UMBRALES_VELOCIDAD_RMS.alarmaMax],
    ['gSE', UMBRALES_GSE.buenoMax, UMBRALES_GSE.aceptableMax, UMBRALES_GSE.alarmaMax],
    ['HFD_g', UMBRALES_HFD.buenoMax, UMBRALES_HFD.aceptableMax, UMBRALES_HFD.alarmaMax]
  ]);

  sembrarHoja_(ss, HOJAS.RODAMIENTOS, Object.keys(RODAMIENTOS_REF).map(function (k) {
    var g = RODAMIENTOS_REF[k];
    return [k, g.Nb || '', g.Bd || '', g.Pd || '', (g.theta === undefined ? '' : g.theta),
            g.coefBPFI || '', g.coefBPFO || '', g.coefBSF || ''];
  }));

  SpreadsheetApp.getUi().alert('Hojas inicializadas con datos de EJEMPLO.\n\n' +
    'Reemplaza en Equipos/Posiciones/Rodamientos los valores reales de Kaeser Colombia.');
}

/** Escribe filas de ejemplo en una hoja solo si está vacía (idempotente). */
function sembrarHoja_(ss, nombre, filas) {
  if (!filas || !filas.length) return;
  var sh = ss.getSheetByName(nombre);
  if (sh.getLastRow() > 1) return; // ya tiene datos: no sobreescribir
  sh.getRange(2, 1, filas.length, filas[0].length).setValues(filas);
}

/**
 * Rellena la columna Transmision de los equipos que la tengan vacía, aplicando
 * la regla de la "D" (con Familia como guarda para Dry Screw). No sobrescribe
 * valores ya definidos por el usuario.
 */
function sugerirTransmision() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(HOJAS.EQUIPOS);
  if (!sh || sh.getLastRow() < 2) { SpreadsheetApp.getUi().alert('No hay equipos.'); return; }
  var datos = sh.getDataRange().getValues();
  var head = datos[0];
  var cTrans = head.indexOf('Transmision');
  var cFam = head.indexOf('Familia');
  var cSerie = head.indexOf('Serie');
  var cTag = head.indexOf('TAG');
  if (cTrans < 0) { SpreadsheetApp.getUi().alert('Falta la columna Transmision. Corre "Inicializar hojas".'); return; }

  var cambios = 0;
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][cTrans]).trim()) continue; // respetar lo ya definido
    var ref = datos[i][cSerie] || datos[i][cTag];
    var t = clasificarTransmision_(datos[i][cFam], ref);
    sh.getRange(i + 1, cTrans + 1).setValue(t);
    cambios++;
  }
  SpreadsheetApp.getUi().alert('Transmisión sugerida en ' + cambios + ' equipo(s).\n' +
    'Revisa los engranados/sopladores por si la regla de la "D" no aplica.');
}

/** Registra el diagnóstico en la hoja "Diagnostico". */
function guardarDiagnostico_(p, resultado) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(HOJAS.DIAGNOSTICO) || ss.insertSheet(HOJAS.DIAGNOSTICO);
  var causa = resultado.hallazgos.length ? resultado.hallazgos[0] : null;
  var acciones = resultado.hallazgos.map(function (h) {
    return h.tipo + (h.subtipo ? ' (' + h.subtipo + ')' : '') + ': ' + h.accion;
  }).join(' | ');
  sh.appendRow([
    new Date(), p.etiqueta || '', p.sensor || '', p.rpm || '',
    resultado.semaforo,
    causa ? causa.tipo + (causa.subtipo ? ' (' + causa.subtipo + ')' : '') : '—',
    causa ? causa.confianza + '%' : '',
    resultado.resumen, acciones
  ]);
}

/* ============================= VARIOS ============================== */

function mostrarUrlWebApp() {
  var url = ScriptApp.getService().getUrl();
  var msg = url
    ? 'URL de la app web:\n\n' + url + '\n\n(Requiere haber hecho el Deploy como aplicación web.)'
    : 'Aún no hay un deployment de app web. Ve a Deploy → New deployment → Web app.';
  SpreadsheetApp.getUi().alert(msg);
}

function acercaDe() {
  SpreadsheetApp.getUi().alert(
    'Diagnóstico de Vibraciones Kaeser (VES004)\n\n' +
    'Motor de diagnóstico espectral basado en la Carta de Charlotte, ' +
    'con las tablas de montaje de MA 00-21-02.2.\n\n' +
    'Menú → Inicializar hojas, y despliega la app web para diagnosticar.'
  );
}
