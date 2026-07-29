/**
 * pruebas/prueba-local.js
 * ---------------------------------------------------------------------------
 * Banco de pruebas del proyecto. Ejecuta la lógica de Apps Script bajo Node
 * con dobles de prueba (fakes) de los servicios de Google: SpreadsheetApp,
 * Utilities, PropertiesService, LockService, Session, MailApp y UrlFetchApp.
 *
 *     node pruebas/prueba-local.js         # ejecuta las pruebas
 *     VER=1 node pruebas/prueba-local.js   # además imprime el informe generado
 *
 * Sirve para validar cambios en el ESQUEMA o en el redactor del informe sin
 * tener que publicar la aplicación web ni tocar el libro de producción.
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'apps-script');

/* ---------- Fake Spreadsheet ---------- */
class FakeRange {
  constructor(sheet, row, col, rows, cols) {
    Object.assign(this, { sheet, row, col, rows, cols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const fila = [];
      for (let c = 0; c < this.cols; c++) {
        const rr = this.sheet.data[this.row - 1 + r] || [];
        fila.push(rr[this.col - 1 + c] === undefined ? '' : rr[this.col - 1 + c]);
      }
      out.push(fila);
    }
    return out;
  }
  setValues(vals) {
    for (let r = 0; r < vals.length; r++) {
      const idx = this.row - 1 + r;
      if (!this.sheet.data[idx]) this.sheet.data[idx] = [];
      for (let c = 0; c < vals[r].length; c++) {
        this.sheet.data[idx][this.col - 1 + c] = vals[r][c];
      }
    }
    return this;
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setWrap() { return this; }
}
class FakeSheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  getLastRow() {
    let last = 0;
    this.data.forEach((f, i) => { if (f && f.some(v => v !== '' && v !== undefined && v !== null)) last = i + 1; });
    return last;
  }
  getLastColumn() { return this.data.reduce((m, f) => Math.max(m, f ? f.length : 0), 0); }
  getRange(r, c, nr, nc) { return new FakeRange(this, r, c, nr || 1, nc || 1); }
  appendRow(fila) { this.data[this.getLastRow()] = fila.slice(); }
  deleteRow(n) { this.data.splice(n - 1, 1); }
  setFrozenRows() { return this; }
}
class FakeSpreadsheet {
  constructor() { this.sheets = {}; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { this.sheets[n] = new FakeSheet(n); return this.sheets[n]; }
}
const LIBRO = new FakeSpreadsheet();

/* ---------- Fakes de servicios ---------- */
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const dos = n => String(n).padStart(2, '0');

/* Propiedades del script y respuesta de UrlFetchApp: mutables, para poder
   simular la API de Gemini desde las pruebas. */
const PROPS = {};
let FETCH = () => { throw new Error('sin red'); };
/** Construye la respuesta que devuelve UrlFetchApp.fetch(). */
const respuestaHttp = (codigo, cuerpo) => ({
  getResponseCode: () => codigo,
  getContentText: () => (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo))
});

const sandbox = {
  console,
  SpreadsheetApp: { getActiveSpreadsheet: () => LIBRO },
  Utilities: {
    formatDate(d, tz, fmt) {
      return fmt
        .replace('yyyy', d.getFullYear())
        .replace('MMM', MESES[d.getMonth()])
        .replace('MM', dos(d.getMonth() + 1))
        .replace('dd', dos(d.getDate()))
        .replace('HH', dos(d.getHours()))
        .replace('mm', dos(d.getMinutes()))
        .replace('ss', dos(d.getSeconds()));
    }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (Object.prototype.hasOwnProperty.call(PROPS, k) ? PROPS[k] : null)
    })
  },
  LockService: {
    getDocumentLock: () => ({ waitLock() {}, releaseLock() {} })
  },
  Session: {
    getActiveUser: () => ({ getEmail: () => 'yiber.medina@kaeser.com' }),
    getEffectiveUser: () => ({ getEmail: () => 'yiber.medina@kaeser.com' })
  },
  MailApp: { sendEmail: o => { sandbox.__correo = o; } },
  ScriptApp: { getProjectTriggers: () => [] },
  UrlFetchApp: { fetch: (url, opciones) => FETCH(url, opciones) }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['Config.gs', 'Semana.gs', 'Usuarios.gs', 'Datos.gs', 'Kpis.gs', 'Informe.gs', 'Ia.gs', 'Correo.gs', 'Code.gs']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f }));

const S = sandbox;
let fallos = 0;
function ok(cond, etiqueta, extra) {
  if (cond) { console.log('  ✔ ' + etiqueta); }
  else { fallos++; console.log('  ✘ ' + etiqueta + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}

/* ===== 1. Semana ISO ===== */
console.log('\n[1] Semana ISO y números');
ok(S.numeroSemanaIso(new Date(2026, 0, 1)) === 1, '01/01/2026 → semana 1');
ok(S.numeroSemanaIso(new Date(2026, 6, 29)) === 31, '29/07/2026 → semana 31', S.numeroSemanaIso(new Date(2026, 6, 29)));
ok(S.anioIso(new Date(2027, 0, 1)) === 2026, '01/01/2027 pertenece al año ISO 2026', S.anioIso(new Date(2027, 0, 1)));
const rango = S.rangoSemana(2026, 31);
ok(rango.inicio.getDate() === 27 && rango.inicio.getMonth() === 6, 'semana 31 arranca el lunes 27/07', rango.inicio.toDateString());
ok(S.aNumero_('1.500.000') === 1500000, '"1.500.000" → 1500000', S.aNumero_('1.500.000'));
ok(S.aNumero_('95,8 %') === 95.8, '"95,8 %" → 95.8', S.aNumero_('95,8 %'));
ok(S.aNumero_('$ 4.500') === 4500, '"$ 4.500" → 4500', S.aNumero_('$ 4.500'));
ok(S.aNumero_('4,5 horas') === 4.5, '"4,5 horas" → 4.5', S.aNumero_('4,5 horas'));
ok(S.aNumero_('1,234,567.89') === 1234567.89, 'formato inglés', S.aNumero_('1,234,567.89'));
ok(S.aNumero_('sin datos') === null, 'texto sin dígitos → null');

/* ===== 2. Inicialización ===== */
console.log('\n[2] Inicialización de hojas');
const informeInit = S.inicializarHojas();
ok(informeInit.split('\n').length >= 9, 'reporta las 7 áreas + Usuario + KPI_Datos');
ok(!!LIBRO.getSheetByName('SAU, Renta, CDR'), 'crea la hoja con coma en el nombre');

/* Poblar Usuario */
const hojaU = LIBRO.getSheetByName('Usuario');
[['DPA', 'Leidy Johanna Monsalve', 'leidy.monsalve@kaeser.com'],
 ['Soporte Técnico', 'Edilfonso Vaca', 'edilfonso.vaca@kaeser.com'],
 ['Desarrollo Personal', 'Jairo Atehortua', 'jairo.atehortua@kaeser.com'],
 ['Gestión Comercial', 'Carlos Alberto Arbeláez', 'carlos.arbelaez@kaeser.com'],
 ['SAU, Renta, CDR', 'Andrés Camilo Peña', 'andres.pena@kaeser.com'],
 ['Directores', 'Luis Rodriguez', 'luis.rodriguez@kaeser.com'],
 ['SAU, Renta, CDR', 'Yiber Medina', 'yiber.medina@kaeser.com'],
 ['Asesores CAN', 'Ana Gómez', 'ana.gomez@kaeser.com']
].forEach(f => hojaU.appendRow(f));

console.log('\n[3] Resolución de cargos y sesión');
ok(S.areaDeCargo('SAU') === 'SAU, Renta, CDR', 'alias "SAU"');
ok(S.areaDeCargo('Asesores CAN') === 'Asesores KAM', 'alias "Asesores CAN" → Asesores KAM');
ok(S.areaDeCargo('gestion comercial') === 'Gestión Comercial', 'sin tildes');
ok(S.areaDeCargo('Contabilidad') === null, 'cargo desconocido → null');
const sesion = S.usuarioActual();
ok(sesion.ok && sesion.usuario.area === 'SAU, Renta, CDR', 'usuario de sesión resuelto', sesion);

/* ===== 4. Guardado / lectura ===== */
console.log('\n[4] Guardado, upsert y round-trip de tablas');
const P = { anio: 2026, semana: 31 };

S.guardarRegistro('SAU, Renta, CDR', {
  anio: P.anio, semana: P.semana, nombre: 'Yiber Medina',
  campos: {
    novedadesPersonal: 'Equipo completo. Incapacidad de 3 días de un técnico en Cali.',
    visitasClientes: [{ cliente: 'Cementos Argos', actividad: 'Auditoría de sala' }],
    equiposDetenidos: [
      { cliente: 'Postobón', equipo: 'EMR-4412', falla: 'Falla en unidad compresora',
        estado: 'Detenido | crítico', observacion: 'Espera repuesto\nimportado' }
    ],
    horasExtra: '124 horas',
    novedadesSucursales: 'Sin novedad.',
    serviciosUtility: '38',
    serviciosTaller: [{ estado: 'Ingresados', cantidad: '12' }, { estado: 'Entregados', cantidad: '9' }],
    registroReprocesos: '2 reprocesos por torque incorrecto',
    equiposMasUnMes: [{ equipo: 'EMR-2210', cliente: 'Bavaria', observacion: 'Repuesto en tránsito' }],
    mantenimientoRenta: 'Flota al 92% de disponibilidad.'
  }
});

const leido = S.leerRegistro('SAU, Renta, CDR', P.anio, P.semana, 'Yiber Medina');
ok(!!leido, 'el registro se recupera');
ok(leido.campos.equiposDetenidos.filas.length === 1, 'la tabla vuelve con 1 fila');
ok(leido.campos.equiposDetenidos.filas[0].estado === 'Detenido / crítico',
   'el "|" del usuario se escapa a "/"', leido.campos.equiposDetenidos.filas[0].estado);
ok(leido.campos.equiposDetenidos.filas[0].observacion === 'Espera repuesto · importado',
   'el salto de línea se escapa a " · "', leido.campos.equiposDetenidos.filas[0].observacion);
ok(leido.campos.serviciosTaller.filas.length === 2, 'segunda tabla con 2 filas');
ok(leido.campos.serviciosUtility.valor === '38', 'campo simple intacto');

const hojaSau = LIBRO.getSheetByName('SAU, Renta, CDR');
const filasAntes = hojaSau.getLastRow();
S.guardarRegistro('SAU, Renta, CDR', {
  anio: P.anio, semana: P.semana, nombre: 'Yiber Medina',
  campos: { serviciosUtility: '41', serviciosTaller: [{ estado: 'Ingresados', cantidad: '15' }] }
});
ok(hojaSau.getLastRow() === filasAntes, 'guardar dos veces NO duplica la fila',
   { antes: filasAntes, despues: hojaSau.getLastRow() });
ok(S.leerRegistro('SAU, Renta, CDR', P.anio, P.semana, 'Yiber Medina').campos.serviciosUtility.valor === '41',
   'la segunda escritura sobrescribe');

/* ===== 5. KPI ===== */
console.log('\n[5] KPI_Datos');
const hojaKpi = LIBRO.getSheetByName('KPI_Datos');
const kpisSau = S.kpisDeSemana(P.anio, P.semana)['SAU, Renta, CDR'] || [];
ok(kpisSau.some(k => k.metrica === 'Servicios Utility' && k.valor === 41),
   'Servicios Utility = 41 (valor actualizado)', kpisSau);
ok(kpisSau.filter(k => k.metrica === 'Servicios Utility').length === 1,
   'no se duplican los KPI al volver a guardar');
ok(kpisSau.some(k => k.metrica === 'Taller — Ingresados' && k.valor === 15),
   'métrica por fila con etiqueta', kpisSau);

/* ===== 6. Resto de áreas ===== */
console.log('\n[6] Consolidación multi-área');
/* La interfaz siempre envía TODOS los campos; el guardado parcial del test
   anterior borró las tablas de SAU a propósito. Se restauran antes de consolidar. */
S.guardarRegistro('SAU, Renta, CDR', {
  anio: P.anio, semana: P.semana, nombre: 'Yiber Medina',
  campos: {
    novedadesPersonal: 'Equipo completo. Incapacidad de 3 días de un técnico en Cali.',
    equiposDetenidos: [
      { cliente: 'Postobón', equipo: 'EMR-4412', falla: 'Falla en unidad compresora',
        estado: 'Detenido crítico', observacion: 'Espera repuesto importado' }
    ],
    serviciosUtility: '41',
    serviciosTaller: [{ estado: 'Ingresados', cantidad: '15' }, { estado: 'Entregados', cantidad: '9' }],
    registroReprocesos: '2 reprocesos por torque incorrecto',
    equiposMasUnMes: [{ equipo: 'EMR-2210', cliente: 'Bavaria', observacion: 'Repuesto en tránsito' }]
  }
});
S.guardarRegistro('DPA', {
  anio: P.anio, semana: P.semana, nombre: 'Leidy Johanna Monsalve',
  campos: {
    novedadesPersonal: 'Sin novedades.',
    tiempoRespuesta: '4,5 horas',
    calidadInformacion: [
      { proceso: 'Ofertas puntuales', solicitudes: '120', reprocesos: '5', efectividad: '95,8' },
      { proceso: 'Convenios', solicitudes: '40', reprocesos: '1', efectividad: '97,5' }
    ],
    ofertasPuntuales: [{ estado: 'Cerradas', total: '120', fueraTiempo: '8', aTiempo: '112' }],
    tratamientoOS: [
      { os: 'OS-99120', zona: 'Bogotá', responsable: 'Juan Norato', diasDemora: '12' },
      { os: 'OS-99131', zona: 'Cali', responsable: 'Maycol Quiros', diasDemora: '2' }
    ],
    demorasCoordinador: [{ coordinador: 'Juan Norato', oficina: 'Bogotá', osDemoradas: '4' }]
  }
});
S.guardarRegistro('Gestión Comercial', {
  anio: P.anio, semana: P.semana, nombre: 'Carlos Alberto Arbeláez',
  campos: {
    ordenesPorSucursal: [{ sucursal: 'Bogotá', valorRecibido: '1.250.000.000' },
                         { sucursal: 'Medellín', valorRecibido: '640.000.000' }],
    ordenesRelevantes: [{ asesor: 'Ana Gómez', cliente: 'Nestlé', tipoVenta: 'Equipo nuevo', valor: '480.000.000' }],
    metricasFacturacion: [{ kpi: 'Facturación mes', valor: '3.900.000.000' },
                          { kpi: 'Cumplimiento forecast', valor: '92' }],
    kpisConvenios: [{ metaAnual: '60', activos: '48', nuevos: '3', cancelados: '1' }],
    distribuidores: [{ distribuidor: 'Kaeser Ecuador', ocValor: 'OC 4412 / $210.000', actividad: 'Entrenamiento' }],
    negociacionesAltoImpacto: 'Negociación con Cerrejón en revisión de precios.'
  }
});
S.guardarRegistro('Soporte Técnico', {
  anio: P.anio, semana: P.semana, nombre: 'Edilfonso Vaca',
  campos: {
    equiposDetenidos: [{ cliente: 'Ecopetrol', equipo: 'EMR-7781', falla: 'Sensor de vibración',
                         estado: 'En diagnóstico', observacion: '' }],
    firstTimeFix: [{ totalNotificaciones: '210', ftf: '87,5', visitasAdicionales: '26' }],
    metricasEmergencia: [{ kpi: 'Llamadas atendidas', valor: '54' }],
    analisisVibraciones: [{ estado: 'Alerta', cantidad: '3' }],
    centroMonitoreo: 'Se activaron 5 alarmas remotas.'
  }
});
S.guardarRegistro('Desarrollo Personal', {
  anio: P.anio, semana: P.semana, nombre: 'Jairo Atehortua',
  campos: {
    gestionVacantes: [{ zona: 'Cali', cargo: 'Técnico de servicio', estado: 'Terna en entrevista' },
                      { zona: 'Bogotá', cargo: 'Analista DPA', estado: 'Cerrada — contratado' }],
    entrenamientos: 'Curso de Sigma Control 2 para 12 técnicos.'
  }
});
S.guardarRegistro('Asesores KAM', {
  anio: P.anio, semana: P.semana, nombre: 'Ana Gómez',
  campos: {
    negociacionesCurso: [
      { cliente: 'Cerrejón', tipo: 'Convenio', valorTotal: '2.100.000.000', estado: 'En riesgo por precio' },
      { cliente: 'Nestlé', tipo: 'Equipo', valorTotal: '480.000.000', estado: 'Cerrada' }
    ],
    desarrolloPresupuestario: [{ meta: '5.000.000.000', ocPuntuales: '3', ocConvenios: '2',
                                 facturado: '4.600.000.000', cumplimiento: '92' }]
  }
});

const consolidado = S.consolidarSemana(P.anio, P.semana);
ok(consolidado.totalReportes === 6, '6 reportes consolidados', consolidado.totalReportes);
ok(consolidado.faltantes.length === 2, '2 pendientes de envío (Andrés Peña y Luis Rodriguez)',
   consolidado.faltantes.map(f => f.nombre));

/* ===== 7. Informe ===== */
console.log('\n[7] Informe gerencial determinista');
const md = S.informeDeterminista_(consolidado);
['## 📋 RESUMEN EJECUTIVO', '## 🚨 ALERTAS', '## 💰 GESTIÓN COMERCIAL',
 '## ⚙️ OPERACIONES', '## 👥 DESARROLLO DE PERSONAL'].forEach(sec => {
  ok(md.indexOf(sec) >= 0, 'contiene la sección ' + sec);
});
ok(md.indexOf('OS **OS-99120**') >= 0, 'la OS con 12 días de demora aparece en alertas');
ok(md.indexOf('OS-99131') < 0, 'la OS con 2 días NO aparece (bajo el umbral)');
const alertas = md.slice(md.indexOf('## 🚨'), md.indexOf('## 💰'));
ok(alertas.indexOf('🔴') >= 0, 'marca en rojo el equipo con estado crítico');
ok(alertas.indexOf('**Cerrejón**') >= 0, 'riesgo comercial KAM detectado');
ok(alertas.indexOf('Nestlé') < 0, 'la negociación cerrada NO entra en alertas');
ok(alertas.indexOf('Técnico de servicio') >= 0, 'vacante abierta listada en alertas');
ok(alertas.indexOf('Analista DPA') < 0, 'vacante cerrada NO listada en alertas');
ok(md.slice(md.indexOf('## 👥')).indexOf('Analista DPA') >= 0,
   'la vacante cerrada sí aparece en Desarrollo de Personal');
ok(md.indexOf('$1.890.000.000') >= 0, 'suma de OC por sucursal formateada',
   (md.match(/total \*\*\$[\d.]+/) || [])[0]);
ok(md.indexOf('87,5% FTF') >= 0 || md.indexOf('**87,5% FTF**') >= 0, 'FTF reportado');
ok(md.indexOf('Pendientes de envío:') >= 0, 'anexo de cobertura');

/* ===== 8. Markdown → HTML ===== */
console.log('\n[8] Conversión a HTML del correo');
const html = S.markdownAHtml_(md);
ok(html.indexOf('<h2') >= 0, 'encabezados convertidos');
ok(html.indexOf('<ul') >= 0 && html.indexOf('<li') >= 0, 'viñetas convertidas');
ok(html.indexOf('<strong>') >= 0, 'negritas convertidas');
ok(html.indexOf('**') < 0, 'no quedan asteriscos sin procesar');
const conTabla = S.markdownAHtml_('| A | B |\n|---|---|\n| 1 | 2 |');
ok(conTabla.indexOf('<table') >= 0 && conTabla.indexOf('<th') >= 0, 'tablas Markdown convertidas');
ok(S.markdownAHtml_('Texto con <script>alert(1)</script>').indexOf('&lt;script&gt;') >= 0,
   'el HTML del usuario se escapa');

/* ===== 9. API de la interfaz ===== */
console.log('\n[9] API de la interfaz web');
const apiS = S.apiSesion();
ok(apiS.ok && apiS.area.nombre === 'SAU, Renta, CDR', 'apiSesion devuelve el área correcta');
ok(apiS.area.campos.length === 10, 'SAU expone 10 campos', apiS.area.campos.length);
ok(apiS.registro && apiS.registro.campos.serviciosUtility === '41', 'precarga el registro existente');
ok(apiS.periodosEditables.length === 6, '6 periodos editables');
ok(apiS.permisos.verInforme === false, 'un usuario de SAU no ve el informe gerencial');
let bloqueado = false;
try { S.apiPrevisualizarInforme(P.anio, P.semana, false); } catch (e) { bloqueado = true; }
ok(bloqueado, 'apiPrevisualizarInforme rechaza a quien no tiene permiso');
let rechazoPeriodo = false;
try { S.apiGuardar({ anio: 2019, semana: 5, campos: {} }); } catch (e) { rechazoPeriodo = true; }
ok(rechazoPeriodo, 'apiGuardar rechaza semanas fuera de la ventana de corrección');

/* ===== 10. Respaldo sin IA ===== */
console.log('\n[10] Respaldo cuando la IA no está disponible');
ok(S.iaDisponible() === false, 'sin clave, la IA está inactiva');
const conRespaldo = S.construirInforme(P.anio, P.semana, true);
ok(conRespaldo.fuente === 'datos', 'cae al informe determinista sin API key');
ok(conRespaldo.aviso.indexOf('GEMINI_API_KEY') >= 0, 'explica por qué', conRespaldo.aviso);

/* ===== 11. Integración con la API de Gemini ===== */
console.log('\n[11] API de Gemini (gemini-2.5-flash)');
PROPS.GEMINI_API_KEY = 'clave-de-prueba';
ok(S.iaDisponible() === true, 'con clave, la IA se activa');
ok(S.modeloIa_() === 'gemini-2.5-flash', 'modelo por defecto gemini-2.5-flash', S.modeloIa_());
PROPS.MODELO_IA = 'models/gemini-2.5-flash';
ok(S.modeloIa_() === 'gemini-2.5-flash', 'se tolera el prefijo "models/"', S.modeloIa_());
delete PROPS.MODELO_IA;
ok(S.urlGemini_() ===
   'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
   'URL del endpoint bien formada', S.urlGemini_());

/* 11.1 Respuesta correcta */
let peticion = null;
FETCH = (url, opciones) => {
  peticion = { url, opciones, cuerpo: JSON.parse(opciones.payload) };
  return respuestaHttp(200, {
    candidates: [{
      content: { role: 'model', parts: [
        { thought: true, text: 'razonamiento interno que no debe salir' },
        { text: '## 📋 RESUMEN EJECUTIVO (Semana Actual)\n\nLa semana cerró estable.' }
      ] },
      finishReason: 'STOP'
    }],
    usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 120 }
  });
};
const conIa = S.construirInforme(P.anio, P.semana, true);
ok(conIa.fuente === 'ia', 'usa la redacción de Gemini cuando responde bien');
ok(conIa.markdown.indexOf('La semana cerró estable.') >= 0, 'incorpora el texto del modelo');
ok(conIa.markdown.indexOf('razonamiento interno') < 0, 'descarta las partes marcadas como thought');
ok(conIa.markdown.indexOf('Pendientes de envío:') >= 0, 'conserva el anexo de cobertura');
ok(peticion.opciones.headers['x-goog-api-key'] === 'clave-de-prueba',
   'la clave viaja en el encabezado, no en la URL');
ok(peticion.url.indexOf('clave-de-prueba') < 0, 'la URL no contiene la clave');
ok(peticion.cuerpo.systemInstruction.parts[0].text.indexOf('ALERTAS CRÍTICAS') >= 0,
   'las directrices van como systemInstruction');
ok(peticion.cuerpo.contents[0].role === 'user' &&
   peticion.cuerpo.contents[0].parts[0].text.indexOf('Cerrejón') >= 0,
   'el JSON consolidado viaja en el contenido del usuario');
ok(peticion.cuerpo.generationConfig.thinkingConfig.thinkingBudget === 1024,
   'se envía el presupuesto de razonamiento');

/* 11.2 Error HTTP */
FETCH = () => respuestaHttp(429, { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } });
const con429 = S.construirInforme(P.anio, P.semana, true);
ok(con429.fuente === 'datos', 'un 429 cae al informe determinista');
ok(con429.aviso.indexOf('Quota exceeded') >= 0, 'muestra el mensaje real de la API', con429.aviso);

/* 11.3 Prompt bloqueado */
FETCH = () => respuestaHttp(200, { promptFeedback: { blockReason: 'SAFETY' } });
const conBloqueo = S.construirInforme(P.anio, P.semana, true);
ok(conBloqueo.fuente === 'datos', 'un bloqueo de seguridad cae al determinista');
ok(conBloqueo.aviso.indexOf('filtros de seguridad') >= 0, 'traduce el motivo del bloqueo', conBloqueo.aviso);

/* 11.4 Sin texto por agotar tokens (caso típico de los modelos 2.5) */
FETCH = () => respuestaHttp(200, { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] });
const sinTexto = S.construirInforme(P.anio, P.semana, true);
ok(sinTexto.fuente === 'datos', 'una respuesta vacía cae al determinista');
ok(sinTexto.aviso.indexOf('tokens de salida') >= 0, 'explica que se agotaron los tokens', sinTexto.aviso);

/* 11.5 Respuesta truncada pero con contenido */
FETCH = () => respuestaHttp(200, {
  candidates: [{ content: { parts: [{ text: '## 📋 RESUMEN EJECUTIVO\n\nTexto parcial' }] },
                 finishReason: 'MAX_TOKENS' }]
});
const truncado = S.construirInforme(P.anio, P.semana, true);
ok(truncado.fuente === 'ia', 'una respuesta truncada con texto sí se aprovecha');
ok(truncado.markdown.indexOf('se truncó por límite de tokens') >= 0, 'avisa que viene truncada');

/* 11.6 Caída de red */
FETCH = () => { throw new Error('DNS timeout'); };
const sinRed = S.construirInforme(P.anio, P.semana, true);
ok(sinRed.fuente === 'datos', 'una caída de red cae al determinista');
ok(sinRed.aviso.indexOf('DNS timeout') >= 0, 'reporta el error de red', sinRed.aviso);

/* 11.7 El correo se arma igual con el respaldo */
PROPS.CORREO_GERENTE = 'gerencia@kaeser.com';
const envio = S.enviarInforme(P.anio, P.semana);
ok(envio.ok && envio.fuente === 'datos', 'el correo sale aunque la IA esté caída');
ok(S.__correo.to === 'gerencia@kaeser.com', 'destinatario correcto');
ok(S.__correo.subject.indexOf('Semana 31') >= 0, 'asunto con la semana', S.__correo.subject);
ok(S.__correo.htmlBody.indexOf('KAESER COMPRESORES') >= 0, 'cuerpo HTML con la plantilla');
ok(S.__correo.body.indexOf('## 📋 RESUMEN EJECUTIVO') >= 0, 'cuerpo alterno en texto plano');
delete PROPS.GEMINI_API_KEY;

if (process.env.VER) { console.log('\n===== INFORME =====\n' + md); }
console.log('\n' + (fallos ? '❌ ' + fallos + ' prueba(s) fallida(s)' : '✅ Todas las pruebas pasaron'));
process.exit(fallos ? 1 : 0);
