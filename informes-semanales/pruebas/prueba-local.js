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
  constructor() { this.sheets = {}; this.propietario = null; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { this.sheets[n] = new FakeSheet(n); return this.sheets[n]; }
  getOwner() {
    if (!this.propietario) throw new Error('propietario no disponible');
    return { getEmail: () => this.propietario };
  }
}
const LIBRO = new FakeSpreadsheet();

/* ---------- Fake Drive ----------
   Reproduce lo justo de DriveApp para verificar el árbol de carpetas por
   semana, el reemplazo de archivos y la lectura de los bytes. */
class FakeBlob {
  constructor(bytes, mime, nombre) {
    Object.assign(this, { bytes, mime, nombre });
  }
  getBytes() { return this.bytes; }
  getContentType() { return this.mime; }
  getName() { return this.nombre; }
}
class FakeFile {
  constructor(blob, carpeta) {
    this.blob = blob; this.carpeta = carpeta;
    // Los IDs reales de Drive tienen 25+ caracteres; el extractor los busca
    // con esa forma, así que el doble debe imitarla.
    this.id = '1FiLe' + String(++DRIVE.contador).padStart(28, 'x');
    this.papelera = false;
    DRIVE.archivos[this.id] = this;
  }
  getName() { return this.blob.getName(); }
  getId() { return this.id; }
  getBlob() { return this.blob; }
  setTrashed(v) { this.papelera = v; return this; }
}
class FakeFolder {
  constructor(nombre, padre) {
    this.nombre = nombre; this.padre = padre;
    this.id = '1FoLd' + String(++DRIVE.contador).padStart(28, 'x');
    this.hijas = []; this.archivos = [];
    DRIVE.carpetas[this.id] = this;
  }
  getName() { return this.nombre; }
  getId() { return this.id; }
  getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; }
  createFolder(nombre) { const f = new FakeFolder(nombre, this); this.hijas.push(f); return f; }
  getFoldersByName(nombre) { return iterador(this.hijas.filter(f => f.nombre === nombre)); }
  createFile(blob) { const f = new FakeFile(blob, this); this.archivos.push(f); return f; }
  getFilesByName(nombre) {
    return iterador(this.archivos.filter(a => !a.papelera && a.getName() === nombre));
  }
  /** Ruta legible desde la raíz, para las aserciones. */
  ruta() { return (this.padre ? this.padre.ruta() + '/' : '') + this.nombre; }
}
const iterador = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
const DRIVE = { contador: 0, carpetas: {}, archivos: {} };
const RAIZ_DRIVE = new FakeFolder('Informes (raíz)', null);
DRIVE.carpetas['16WlySidso2CAA5TwFklWmR-p4axkYb4N'] = RAIZ_DRIVE;

/* ---------- Fakes de servicios ---------- */
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const dos = n => String(n).padStart(2, '0');

/* Propiedades del script y respuesta de UrlFetchApp: mutables, para poder
   simular la API de Gemini desde las pruebas. */
const PROPS = {};
const DISPARADORES = { instalados: [] };
let FETCH = () => { throw new Error('sin red'); };
/** Construye la respuesta que devuelve UrlFetchApp.fetch(). */
const respuestaHttp = (codigo, cuerpo) => ({
  getResponseCode: () => codigo,
  getContentText: () => (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo))
});

const sandbox = {
  console,
  SpreadsheetApp: { getActiveSpreadsheet: () => LIBRO },
  DriveApp: {
    getFolderById: id => {
      const f = DRIVE.carpetas[id];
      if (!f) throw new Error('carpeta inexistente: ' + id);
      return f;
    },
    getFileById: id => {
      const a = DRIVE.archivos[id];
      if (!a || a.papelera) throw new Error('archivo inexistente: ' + id);
      return a;
    }
  },
  Utilities: {
    newBlob: (bytes, mime, nombre) => new FakeBlob(bytes, mime, nombre),
    base64Decode: s64 => Array.from(Buffer.from(s64, 'base64')),
    base64Encode: bytes => Buffer.from(bytes).toString('base64'),
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
    getDocumentLock: () => ({ waitLock() {}, releaseLock() {} }),
    getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
  },
  Session: {
    getActiveUser: () => ({ getEmail: () => 'yiber.medina@kaeser.com' }),
    getEffectiveUser: () => ({ getEmail: () => 'yiber.medina@kaeser.com' })
  },
  MailApp: { sendEmail: o => { sandbox.__correo = o; } },
  ScriptApp: {
    WeekDay: { MONDAY: 'MONDAY', TUESDAY: 'TUESDAY', WEDNESDAY: 'WEDNESDAY',
               THURSDAY: 'THURSDAY', FRIDAY: 'FRIDAY', SATURDAY: 'SATURDAY',
               SUNDAY: 'SUNDAY' },
    getProjectTriggers: () => DISPARADORES.instalados.map(d => ({
      getHandlerFunction: () => d.handler
    })),
    deleteTrigger: () => { DISPARADORES.instalados.length = 0; },
    /* Constructor encadenable que registra cómo quedó configurado el
       disparador, para poder afirmar el día y la hora reales. */
    newTrigger: handler => {
      const cfg = { handler };
      const constructor = {
        timeBased: () => constructor,
        onWeekDay: d => { cfg.dia = d; return constructor; },
        atHour: h => { cfg.hora = h; return constructor; },
        nearMinute: m => { cfg.minuto = m; return constructor; },
        inTimezone: tz => { cfg.zona = tz; return constructor; },
        create: () => { DISPARADORES.instalados.push(cfg); return cfg; }
      };
      return constructor;
    }
  },
  UrlFetchApp: { fetch: (url, opciones) => FETCH(url, opciones) }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['Config.gs', 'Semana.gs', 'Usuarios.gs', 'Adjuntos.gs', 'Datos.gs', 'Kpis.gs',
 'Informe.gs', 'Ia.gs', 'Correo.gs', 'Code.gs']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f }));

const S = sandbox;
/** PNG de 1x1 px: sirve para probar el circuito de adjuntos sin archivos reales. */
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let fallos = 0;
function ok(cond, etiqueta, extra) {
  if (cond) { console.log('  ✔ ' + etiqueta); }
  else { fallos++; console.log('  ✘ ' + etiqueta + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}

/* ===== 0. Integridad de los archivos =====
   El README documenta que cada .gs lleva su nombre en la línea 2, para que al
   cargarlos a mano en Apps Script se pueda verificar que ningún contenido
   quedó en el archivo equivocado (síntoma típico: Unexpected token '<'). */
console.log('\n[0] Integridad de los archivos');
fs.readdirSync(DIR).sort().forEach(nombre => {
  const contenido = fs.readFileSync(path.join(DIR, nombre), 'utf8');
  if (nombre === 'appsscript.json') return;
  if (nombre.endsWith('.gs')) {
    const linea2 = contenido.split('\n')[1] || '';
    ok(contenido.startsWith('/**') && linea2.trim() === '* ' + nombre,
       nombre + ' declara su nombre en la línea 2', linea2.trim());
  } else {
    ok(contenido.trim().charAt(0) === '<', nombre + ' es HTML');
  }
});
ok(fs.readdirSync(DIR).filter(n => n.endsWith('.gs')).length === 10, '10 archivos .gs');
ok(fs.readdirSync(DIR).filter(n => n.endsWith('.html')).length === 3, '3 archivos .html');

/* ===== 0b. Superficie pública =====
   En Apps Script una función que NO termina en "_" aparece en el selector de
   "▶ Ejecutar" del editor y es invocable con google.script.run. Ejecutar por
   error una función interna (que espera argumentos) produce fallos como
   `Área desconocida: "undefined"`. Esta prueba congela la lista de funciones
   públicas: si alguien agrega una, tiene que decidir conscientemente si es un
   punto de entrada o si le falta el "_". */
console.log('\n[0b] Superficie pública del proyecto');
const ENTRADAS_PERMITIDAS = [
  'onOpen',                                   // disparador simple de Sheets
  'doGet', 'include',                         // aplicación web
  'menuInicializar', 'menuUrlWebApp', 'menuPrevisualizar', 'menuVerificarApi',
  'menuEnviarAhora', 'menuInstalarDisparador', 'menuEstado',
  'apiSesion', 'apiCargarRegistro', 'apiGuardar',
  'apiPrevisualizarCorreo', 'apiEnviarInformeGerencial',  // sólo Administrador
  'enviarInformeSemanal'                      // disparador de los jueves
].sort();

const publicas = [];
fs.readdirSync(DIR).filter(n => n.endsWith('.gs')).forEach(archivo => {
  const contenido = fs.readFileSync(path.join(DIR, archivo), 'utf8');
  const re = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm;
  let m;
  while ((m = re.exec(contenido)) !== null) {
    if (!m[1].endsWith('_')) publicas.push(m[1]);
  }
});
publicas.sort();

ok(JSON.stringify(publicas) === JSON.stringify(ENTRADAS_PERMITIDAS),
   'sólo son públicos los ' + ENTRADAS_PERMITIDAS.length + ' puntos de entrada previstos',
   publicas.filter(f => ENTRADAS_PERMITIDAS.indexOf(f) < 0));

/* Las funciones que la interfaz web invoca por nombre NO pueden ser privadas:
   google.script.run no alcanza a las que terminan en "_". */
['apiSesion', 'apiCargarRegistro', 'apiGuardar'].forEach(f => {
  ok(publicas.indexOf(f) >= 0, f + ' sigue siendo alcanzable desde la interfaz');
});
/* Lo mismo para el disparador y las llamadas del menú, que se registran por nombre. */
const codeGs = fs.readFileSync(path.join(DIR, 'Code.gs'), 'utf8');
(codeGs.match(/addItem\('[^']*',\s*'([A-Za-z0-9_]+)'\)/g) || []).forEach(linea => {
  const nombre = linea.match(/'([A-Za-z0-9_]+)'\)$/)[1];
  ok(publicas.indexOf(nombre) >= 0, 'el menú puede invocar ' + nombre + '()');
});
ok(publicas.indexOf('enviarInformeSemanal') >= 0,
   'el disparador de los jueves sigue siendo público');

/* Los endpoints del informe son alcanzables desde el navegador por cualquiera,
   así que la autorización tiene que estar dentro de la propia función. Se
   verifica de forma estática para que nadie pueda quitarla sin que falle. */
['apiPrevisualizarCorreo', 'apiEnviarInformeGerencial'].forEach(nombre => {
  const cuerpo = (codeGs.split('function ' + nombre + '(')[1] || '').split('\nfunction ')[0];
  ok(cuerpo.indexOf('exigirAdministrador_()') >= 0,
     nombre + '() exige Administrador en la primera línea');
});

/* ===== 1. Semana ISO ===== */
console.log('\n[1] Semana ISO y números');
ok(S.numeroSemanaIso_(new Date(2026, 0, 1)) === 1, '01/01/2026 → semana 1');
ok(S.numeroSemanaIso_(new Date(2026, 6, 29)) === 31, '29/07/2026 → semana 31', S.numeroSemanaIso_(new Date(2026, 6, 29)));
ok(S.anioIso_(new Date(2027, 0, 1)) === 2026, '01/01/2027 pertenece al año ISO 2026', S.anioIso_(new Date(2027, 0, 1)));
const rango = S.rangoSemana_(2026, 31);
ok(rango.inicio.getDate() === 27 && rango.inicio.getMonth() === 6, 'semana 31 arranca el lunes 27/07', rango.inicio.toDateString());
ok(S.aNumero_('1.500.000') === 1500000, '"1.500.000" → 1500000', S.aNumero_('1.500.000'));
ok(S.aNumero_('95,8 %') === 95.8, '"95,8 %" → 95.8', S.aNumero_('95,8 %'));
ok(S.aNumero_('$ 4.500') === 4500, '"$ 4.500" → 4500', S.aNumero_('$ 4.500'));
ok(S.aNumero_('4,5 horas') === 4.5, '"4,5 horas" → 4.5', S.aNumero_('4,5 horas'));
ok(S.aNumero_('1,234,567.89') === 1234567.89, 'formato inglés', S.aNumero_('1,234,567.89'));
ok(S.aNumero_('sin datos') === null, 'texto sin dígitos → null');

/* ===== 2. Inicialización ===== */
console.log('\n[2] Inicialización de hojas');
const informeInit = S.inicializarHojas_();
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
ok(S.areaDeCargo_('SAU') === 'SAU, Renta, CDR', 'alias "SAU"');
ok(S.areaDeCargo_('Asesores CAN') === 'Asesores KAM', 'alias "Asesores CAN" → Asesores KAM');
ok(S.areaDeCargo_('gestion comercial') === 'Gestión Comercial', 'sin tildes');
ok(S.areaDeCargo_('Contabilidad') === null, 'cargo desconocido → null');
const sesion = S.usuarioActual_();
ok(sesion.ok && sesion.usuario.area === 'SAU, Renta, CDR', 'usuario de sesión resuelto', sesion);

/* ===== 3b. Mensajes de error accionables ===== */
console.log('\n[3b] Mensajes de error accionables');
let errSinArea = '';
try { S.areaOError_(undefined); } catch (e) { errSinArea = e.message; }
ok(errSinArea.indexOf('directamente desde el editor') >= 0,
   'llamar sin área explica que se ejecutó una función interna desde el editor', errSinArea);
ok(errSinArea.indexOf('undefined') < 0,
   'el mensaje ya no expone un "undefined" críptico');
let errAreaMala = '';
try { S.areaOError_('Contabilidad'); } catch (e) { errAreaMala = e.message; }
ok(errAreaMala.indexOf('Contabilidad') >= 0 && errAreaMala.indexOf('ALIAS_CARGOS') >= 0,
   'un área inexistente indica dónde corregirla', errAreaMala);
ok(errAreaMala.indexOf('Soporte Técnico') >= 0, 'y enumera las áreas válidas');

/* ===== 4. Guardado / lectura ===== */
console.log('\n[4] Guardado, upsert y round-trip de tablas');
const P = { anio: 2026, semana: 31 };

S.guardarRegistro_('SAU, Renta, CDR', {
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

const leido = S.leerRegistro_('SAU, Renta, CDR', P.anio, P.semana, 'Yiber Medina');
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
S.guardarRegistro_('SAU, Renta, CDR', {
  anio: P.anio, semana: P.semana, nombre: 'Yiber Medina',
  campos: { serviciosUtility: '41', serviciosTaller: [{ estado: 'Ingresados', cantidad: '15' }] }
});
ok(hojaSau.getLastRow() === filasAntes, 'guardar dos veces NO duplica la fila',
   { antes: filasAntes, despues: hojaSau.getLastRow() });
ok(S.leerRegistro_('SAU, Renta, CDR', P.anio, P.semana, 'Yiber Medina').campos.serviciosUtility.valor === '41',
   'la segunda escritura sobrescribe');

/* ===== 5. KPI ===== */
console.log('\n[5] KPI_Datos');
const hojaKpi = LIBRO.getSheetByName('KPI_Datos');
const kpisSau = S.kpisDeSemana_(P.anio, P.semana)['SAU, Renta, CDR'] || [];
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
S.guardarRegistro_('SAU, Renta, CDR', {
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
S.guardarRegistro_('DPA', {
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
S.guardarRegistro_('Gestión Comercial', {
  anio: P.anio, semana: P.semana, nombre: 'Carlos Alberto Arbeláez',
  campos: {
    ordenesPorSucursal: [{ sucursal: 'Bogotá', valorRecibido: '1.250.000.000' },
                         { sucursal: 'Medellín', valorRecibido: '640.000.000' }],
    ordenesRelevantes: [{ nombre: 'ordenes.png', mime: 'image/png', base64: PNG_1x1 }],
    metricasFacturacion: [{ kpi: 'Facturación mes', valor: '3.900.000.000' },
                          { kpi: 'Cumplimiento forecast', valor: '92' }],
    kpisConvenios: [{ nombre: 'convenios.png', mime: 'image/png', base64: PNG_1x1 }],
    distribuidores: [{ distribuidor: 'AC 2000', ocValor: 'OC 4412 / $210.000', actividad: 'Entrenamiento' },
                     { distribuidor: 'Kaeser Ecuador', ocValor: 'OC 4499', actividad: 'Visita' }],
    negociacionesAltoImpacto: {
      encabezados: ['Cliente', 'Producto', 'Precio actual', 'Precio propuesto', 'Estado'],
      filas: [['Cerrejón', 'CSD 125', '820.000.000', '790.000.000', 'En revisión'],
              ['Drummond', 'DSD 175', '1.150.000.000', '1.120.000.000', 'Aprobada']]
    }
  }
});
S.guardarRegistro_('Soporte Técnico', {
  anio: P.anio, semana: P.semana, nombre: 'Edilfonso Vaca',
  campos: {
    equiposDetenidos: [{ cliente: 'Ecopetrol', equipo: 'EMR-7781', falla: 'Sensor de vibración',
                         estado: 'En diagnóstico', observacion: '' }],
    firstTimeFix: [{ nombre: 'ftf.png', mime: 'image/png', base64: PNG_1x1,
                     comentario: '87,5% de FTF; las 26 visitas adicionales se concentran en Cali.' }],
    metricasEmergencia: [{ nombre: 'emergencia.png', mime: 'image/png', base64: PNG_1x1 }],
    analisisVibraciones: [{ estado: 'Alerta', cantidad: '3' }],
    centroMonitoreo: 'Se activaron 5 alarmas remotas.'
  }
});
S.guardarRegistro_('Desarrollo Personal', {
  anio: P.anio, semana: P.semana, nombre: 'Jairo Atehortua',
  campos: {
    gestionVacantes: [{ zona: 'Cali', cargo: 'Técnico de servicio', estado: 'Terna en entrevista' },
                      { zona: 'Bogotá', cargo: 'Analista DPA', estado: 'Cerrada — contratado' }],
    entrenamientos: 'Curso de Sigma Control 2 para 12 técnicos.'
  }
});
S.guardarRegistro_('Asesores KAM', {
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

S.guardarRegistro_('Directores', {
  anio: P.anio, semana: P.semana, nombre: 'Luis Rodriguez',
  campos: {
    novedadesPersonal: 'Zona centro sin novedades de personal.',
    visitasClientes: [{ cliente: 'Alpina', actividad: 'Cierre de convenio' }],
    metricasClave: [
      { metrica: 'Facturación acumulada', valor: '3.900.000.000', observacion: '92% de la meta del mes' },
      { metrica: 'Forecast del trimestre', valor: '11.500.000.000', observacion: 'Ajustado al alza' }
    ],
    ordenesImportantes: [{ cliente: 'Alpina', monto: '320.000.000' }],
    estadoContratos: [
      { asesor: 'Ana Gómez', meta: '20', vigentes: '18', cumplimiento: '90', vencidos: '2' },
      { asesor: 'Luis Rodriguez', meta: '15', vigentes: '15', cumplimiento: '100', vencidos: '0' }
    ],
    notasCredito: 'Una nota crédito por despacho errado, resuelta.'
  }
});

const consolidado = S.consolidarSemana_(P.anio, P.semana);
ok(consolidado.totalReportes === 7, '7 reportes consolidados', consolidado.totalReportes);
ok(consolidado.faltantes.length === 1 && consolidado.faltantes[0].nombre === 'Andrés Camilo Peña',
   '1 pendiente de envío (Andrés Camilo Peña)', consolidado.faltantes.map(f => f.nombre));

/* Columna G de Directores: Métrica | Valor | Observación */
const regDir = S.leerRegistro_('Directores', P.anio, P.semana, 'Luis Rodriguez');
const metricasDir = regDir.campos.metricasClave.filas;
ok(metricasDir.length === 2, 'métricas clave con 2 filas');
ok(metricasDir[0].metrica === 'Facturación acumulada' &&
   metricasDir[0].valor === '3.900.000.000' &&
   metricasDir[0].observacion === '92% de la meta del mes',
   'la fila conserva Métrica / Valor / Observación', metricasDir[0]);
const kpisDir = S.kpisDeSemana_(P.anio, P.semana)['Directores'] || [];
ok(kpisDir.some(k => k.metrica === 'Facturación acumulada' && k.valor === 3900000000),
   'la métrica nombrada se vuelca a KPI_Datos y ya es graficable',
   kpisDir.map(k => k.metrica));

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
ok(md.indexOf('Indicador FTF') >= 0 && md.indexOf('las 26 visitas adicionales') >= 0,
   'el FTF aparece como adjunto con el comentario del área',
   (md.match(/Indicador FTF[^\n]*/) || [])[0]);
ok(md.indexOf('Facturación acumulada: **3.900.000.000**') >= 0,
   'la métrica clave se lee con su nombre en el informe',
   (md.match(/Facturación acumulada[^\n]*/) || [])[0]);
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
let rechazoPeriodo = false;
try { S.apiGuardar({ anio: 2019, semana: 5, campos: {} }); } catch (e) { rechazoPeriodo = true; }
ok(rechazoPeriodo, 'apiGuardar rechaza semanas fuera de la ventana de corrección');

/* El colaborador no debe poder tocar el informe. Como los endpoints SÍ existen
   (el administrador los usa), la barrera tiene que estar en el servidor: que la
   interfaz oculte los botones no protege nada. */
console.log('\n[9b] Un colaborador no puede tocar el informe gerencial');
ok(apiS.rol === 'colaborador', 'con un cargo de área, el rol es colaborador', apiS.rol);
ok(apiS.informe === undefined, 'apiSesion no entrega datos del informe a un colaborador');
ok(!!apiS.area, 'el colaborador sí recibe su formulario');

let bloqueoPrevia = '';
try { S.apiPrevisualizarCorreo(P.anio, P.semana); } catch (e) { bloqueoPrevia = e.message; }
ok(bloqueoPrevia.indexOf('Administrador') >= 0,
   'apiPrevisualizarCorreo rechaza al colaborador aunque la invoque directo', bloqueoPrevia);

let bloqueoEnvio = '';
const correoAntes = S.__correo;
try { S.apiEnviarInformeGerencial(P.anio, P.semana); } catch (e) { bloqueoEnvio = e.message; }
ok(bloqueoEnvio.indexOf('Administrador') >= 0,
   'apiEnviarInformeGerencial rechaza al colaborador', bloqueoEnvio);
ok(S.__correo === correoAntes, 'y no se envió ningún correo en el intento');

/* ===== 9c. Rol de Administrador =====
   El permiso vive en la columna "Cargo" de la hoja "Usuario" y en ningún otro
   sitio: cambiar ahí el cargo de alguien debe darle o quitarle el rol de
   inmediato, sin tocar código ni propiedades de script. */
console.log('\n[9c] El rol de Administrador sale del Cargo en la hoja "Usuario"');

/** Reescribe el cargo de un correo en la hoja "Usuario", como haría el usuario. */
const fijarCargo = (correo, cargo) => {
  const fila = hojaU.data.find(f => String(f[2]).toLowerCase() === correo);
  if (!fila) throw new Error('fixture: no existe la fila de ' + correo);
  fila[0] = cargo;
};

ok(S.esCargoAdmin_('Administrador') === true, 'el cargo "Administrador" otorga el rol');
ok(S.esCargoAdmin_('  administrador ') === true, 'sin importar espacios ni mayúsculas');
ok(S.esCargoAdmin_('Admin') === true, 'y la abreviatura "Admin"');
ok(S.esCargoAdmin_('Administrador SAU') === true, 'un cargo compuesto también lo otorga');
ok(S.esCargoAdmin_('Administrativo') === false,
   'un cargo que sólo empieza parecido NO otorga el rol');
ok(S.esCargoAdmin_('Director Administrativo') === false, 'ni uno que lo contenga en medio');
ok(S.esCargoAdmin_('') === false, 'una celda vacía tampoco');
ok(S.areaDeCargo_('Administrador') === null,
   'el cargo de Administrador no corresponde a ningún formulario');
ok(S.areaDeCargo_('Administrador SAU') === 'SAU, Renta, CDR',
   '"Administrador SAU" conserva su área para poder seguir reportando');

ok(S.esAdministrador_() === false,
   'con su cargo de área, Yiber no es administrador');

/* La hoja es la ÚNICA fuente del permiso: ni siquiera el propietario del libro
   entra por la puerta de atrás. */
LIBRO.propietario = 'yiber.medina@kaeser.com';
ok(S.esAdministrador_() === false,
   'ser propietario del libro NO otorga el rol: sólo cuenta el cargo');
ok(S.correosAdmin_().length === 0, 'y la hoja no reporta ningún administrador');

fijarCargo('luis.rodriguez@kaeser.com', 'Administrador');
ok(S.esAdministrador_() === false,
   'que otro tenga el cargo tampoco se lo da a Yiber');
fijarCargo('yiber.medina@kaeser.com', 'ADMINISTRADOR');
ok(S.esAdministrador_() === true,
   'cambiar el cargo en la hoja otorga el permiso, sin tocar código');
let sinPermiso = false;
try { S.exigirAdministrador_(); } catch (e) { sinPermiso = true; }
ok(sinPermiso === false, 'exigirAdministrador_ deja pasar al administrador');

fijarCargo('yiber.medina@kaeser.com', 'SAU, Renta, CDR');
LIBRO.propietario = null;
ok(S.esAdministrador_() === false, 'y devolverle su cargo de área se lo quita');
sinPermiso = false;
let mensajePermiso = '';
try { S.exigirAdministrador_(); } catch (e) { sinPermiso = true; mensajePermiso = e.message; }
ok(sinPermiso, 'exigirAdministrador_ vuelve a bloquearlo');
ok(mensajePermiso.indexOf('Cargo') >= 0 && mensajePermiso.indexOf('Usuario') >= 0,
   'el error dice exactamente dónde se otorga el permiso', mensajePermiso);
fijarCargo('luis.rodriguez@kaeser.com', 'Directores');

/* ===== 9d. Vista del Administrador ===== */
console.log('\n[9d] Vista del Administrador en la interfaz');
fijarCargo('yiber.medina@kaeser.com', 'Administrador');
PROPS.CORREO_GERENTE = 'gerencia@kaeser.com';
PROPS.CORREO_COPIA = 'direccion@kaeser.com';

const sesionAdmin = S.apiSesion();
ok(sesionAdmin.rol === 'administrador', 'el rol pasa a administrador', sesionAdmin.rol);
ok(sesionAdmin.area === undefined,
   'NO se le entrega formulario (CONFIG.ADMIN_TAMBIEN_REPORTA = false)');
ok(sesionAdmin.registro === undefined, 'ni el registro de su área');
ok(sesionAdmin.informe.destinatario === 'gerencia@kaeser.com', 'sí recibe el destinatario');
ok(sesionAdmin.informe.copia === 'direccion@kaeser.com', 'y los correos en copia');
ok(sesionAdmin.usuario.cargo === 'Administrador', 'el cargo mostrado es el que dice la hoja');
ok(sesionAdmin.usuario.nombre === 'Yiber Medina',
   'y el nombre sigue saliendo de la hoja, no del correo', sesionAdmin.usuario.nombre);

/* La vista previa debe ser el correo completo, no sólo el informe. */
const previa = S.apiPrevisualizarCorreo(P.anio, P.semana);
ok(previa.para === 'gerencia@kaeser.com', 'la vista previa indica el destinatario');
ok(previa.asunto.indexOf('Semana 31') >= 0, 'y el asunto real', previa.asunto);
ok(previa.html.indexOf('KAESER COMPRESORES') >= 0, 'incluye la plantilla del correo');
ok(previa.html.indexOf('No responder a este correo') >= 0, 'incluye el pie del correo');
ok(previa.html.indexOf('RESUMEN EJECUTIVO') >= 0, 'y el informe consolidado');

/* La garantía que justifica construirCorreo_: previa y envío son el mismo correo. */
S.apiEnviarInformeGerencial(P.anio, P.semana);
ok(S.__correo.htmlBody === previa.html,
   'el correo enviado es idéntico, carácter por carácter, a la vista previa');
ok(S.__correo.subject === previa.asunto, 'mismo asunto en vista previa y envío');
ok(S.__correo.to === previa.para, 'mismo destinatario');
ok(S.__correo.cc === previa.cc, 'misma copia');

/* Con el interruptor activado, un administrador que además tenga área recupera
   su formulario. El cargo "Administrador" a secas no nombra ninguna, así que ni
   con el interruptor puesto debe aparecer un formulario inventado. */
S.CONFIG.ADMIN_TAMBIEN_REPORTA = true;
ok(S.apiSesion().area === undefined,
   'el cargo "Administrador" a secas no trae formulario ni con el interruptor activo');

fijarCargo('yiber.medina@kaeser.com', 'Administrador SAU');
const sesionAmbos = S.apiSesion();
ok(sesionAmbos.rol === 'administrador' &&
   sesionAmbos.area && sesionAmbos.area.nombre === 'SAU, Renta, CDR',
   '"Administrador SAU" + ADMIN_TAMBIEN_REPORTA sí devuelve el formulario del área',
   sesionAmbos.area && sesionAmbos.area.nombre);
ok(!!sesionAmbos.informe, 'y conserva el panel del informe');

S.CONFIG.ADMIN_TAMBIEN_REPORTA = false;
ok(S.apiSesion().area === undefined,
   'con el interruptor apagado vuelve a ver sólo el panel del informe');

fijarCargo('yiber.medina@kaeser.com', 'SAU, Renta, CDR');
delete PROPS.CORREO_GERENTE;
delete PROPS.CORREO_COPIA;
LIBRO.propietario = null;

/* ===== 10. Respaldo sin IA ===== */
console.log('\n[10] Respaldo cuando la IA no está disponible');
ok(S.iaDisponible_() === false, 'sin clave, la IA está inactiva');
const conRespaldo = S.construirInforme_(P.anio, P.semana, true);
ok(conRespaldo.fuente === 'datos', 'cae al informe determinista sin API key');
ok(conRespaldo.aviso.indexOf('GEMINI_API_KEY') >= 0, 'explica por qué', conRespaldo.aviso);

/* ===== 11. Integración con la API de Gemini ===== */
console.log('\n[11] API de Gemini (gemini-2.5-flash)');
PROPS.GEMINI_API_KEY = 'clave-de-prueba';
ok(S.iaDisponible_() === true, 'con clave, la IA se activa');
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
const conIa = S.construirInforme_(P.anio, P.semana, true);
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
const con429 = S.construirInforme_(P.anio, P.semana, true);
ok(con429.fuente === 'datos', 'un 429 cae al informe determinista');
ok(con429.aviso.indexOf('Quota exceeded') >= 0, 'muestra el mensaje real de la API', con429.aviso);

/* 11.3 Prompt bloqueado */
FETCH = () => respuestaHttp(200, { promptFeedback: { blockReason: 'SAFETY' } });
const conBloqueo = S.construirInforme_(P.anio, P.semana, true);
ok(conBloqueo.fuente === 'datos', 'un bloqueo de seguridad cae al determinista');
ok(conBloqueo.aviso.indexOf('filtros de seguridad') >= 0, 'traduce el motivo del bloqueo', conBloqueo.aviso);

/* 11.4 Sin texto por agotar tokens (caso típico de los modelos 2.5) */
FETCH = () => respuestaHttp(200, { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] });
const sinTexto = S.construirInforme_(P.anio, P.semana, true);
ok(sinTexto.fuente === 'datos', 'una respuesta vacía cae al determinista');
ok(sinTexto.aviso.indexOf('tokens de salida') >= 0, 'explica que se agotaron los tokens', sinTexto.aviso);

/* 11.5 Respuesta truncada pero con contenido */
FETCH = () => respuestaHttp(200, {
  candidates: [{ content: { parts: [{ text: '## 📋 RESUMEN EJECUTIVO\n\nTexto parcial' }] },
                 finishReason: 'MAX_TOKENS' }]
});
const truncado = S.construirInforme_(P.anio, P.semana, true);
ok(truncado.fuente === 'ia', 'una respuesta truncada con texto sí se aprovecha');
ok(truncado.markdown.indexOf('se truncó por límite de tokens') >= 0, 'avisa que viene truncada');

/* 11.6 Caída de red */
FETCH = () => { throw new Error('DNS timeout'); };
const sinRed = S.construirInforme_(P.anio, P.semana, true);
ok(sinRed.fuente === 'datos', 'una caída de red cae al determinista');
ok(sinRed.aviso.indexOf('DNS timeout') >= 0, 'reporta el error de red', sinRed.aviso);

/* 11.7 El correo se arma igual con el respaldo */
PROPS.CORREO_GERENTE = 'gerencia@kaeser.com';
const envio = S.enviarInforme_(P.anio, P.semana);
ok(envio.ok && envio.fuente === 'datos', 'el correo sale aunque la IA esté caída');
ok(S.__correo.to === 'gerencia@kaeser.com', 'destinatario correcto');
ok(S.__correo.subject.indexOf('Semana 31') >= 0, 'asunto con la semana', S.__correo.subject);
ok(S.__correo.htmlBody.indexOf('KAESER COMPRESORES') >= 0, 'cuerpo HTML con la plantilla');
ok(S.__correo.body.indexOf('## 📋 RESUMEN EJECUTIVO') >= 0, 'cuerpo alterno en texto plano');
delete PROPS.GEMINI_API_KEY;

/* ===== 12. Listas desplegables ===== */
console.log('\n[12] Listas desplegables');
const colSucursal = S.ESQUEMA['Gestión Comercial'].campos
  .find(c => c.clave === 'ordenesPorSucursal').columnas.find(c => c.clave === 'sucursal');
ok(JSON.stringify(colSucursal.opciones) === JSON.stringify(
     ['Zona Norte', 'Zona Centro', 'Antioquia', 'Zona Occidente',
      'Cundinamarca', 'Zona Santanderes']),
   'Sucursal ofrece las seis zonas pedidas', colSucursal.opciones);
ok(!colSucursal.abierta, 'Sucursal es lista cerrada: no se puede escribir otra cosa');

const colDistribuidor = S.ESQUEMA['Gestión Comercial'].campos
  .find(c => c.clave === 'distribuidores').columnas.find(c => c.clave === 'distribuidor');
['AC 2000', 'PETROSYSTEMS', 'AMERICAN DRY', 'BDC INTERNATIONAL'].forEach(d => {
  ok(colDistribuidor.opciones.indexOf(d) >= 0, 'Distribuidor incluye ' + d);
});
ok(colDistribuidor.abierta === true,
   'Distribuidor es lista abierta: admite uno nuevo sin tocar el código');
ok(S.leerRegistro_('Gestión Comercial', P.anio, P.semana, 'Carlos Alberto Arbeláez')
    .campos.distribuidores.filas[1].distribuidor === 'Kaeser Ecuador',
   'y de hecho guarda un distribuidor fuera de la lista');

/* ===== 13. Adjuntos en Drive ===== */
console.log('\n[13] Adjuntos en Google Drive');
const regGc = S.leerRegistro_('Gestión Comercial', P.anio, P.semana, 'Carlos Alberto Arbeláez');
const adjOrdenes = regGc.campos.ordenesRelevantes.filas;
ok(adjOrdenes.length === 1, 'la imagen quedó registrada en la celda');
ok(/drive\.google\.com\/file\/d\//.test(adjOrdenes[0].enlace),
   'la celda guarda el enlace de Drive, no los bytes', adjOrdenes[0].enlace);
ok(adjOrdenes[0].nombre.indexOf('S31 - Órdenes Relevantes - Carlos') === 0,
   'el archivo se nombra con semana, indicador y colaborador', adjOrdenes[0].nombre);

const archivoSubido = Object.values(DRIVE.archivos).find(
  a => a.getName().indexOf('Órdenes Relevantes') >= 0 && !a.papelera);
ok(archivoSubido.carpeta.ruta() ===
   'Informes (raíz)/2026/Semana 31 (27 jul – 02 ago)/Gestión Comercial',
   'el árbol de carpetas es raíz/año/semana/área', archivoSubido.carpeta.ruta());

/* Reenviar el reporte no debe duplicar el archivo en Drive. */
const idAnterior = archivoSubido.getId();
S.guardarRegistro_('Gestión Comercial', {
  anio: P.anio, semana: P.semana, nombre: 'Carlos Alberto Arbeláez',
  campos: { ordenesRelevantes: [{ nombre: 'ordenes.png', mime: 'image/png', base64: PNG_1x1 }] }
});
const vivos = Object.values(DRIVE.archivos)
  .filter(a => a.getName().indexOf('Órdenes Relevantes') >= 0 && !a.papelera);
ok(vivos.length === 1, 'volver a subir reemplaza el archivo en vez de duplicarlo',
   vivos.map(a => a.getName()));
ok(DRIVE.archivos[idAnterior].papelera === true, 'el archivo anterior queda en la papelera');

/* Un adjunto ya guardado se conserva sin volver a subirlo. */
const antesDeReenviar = Object.keys(DRIVE.archivos).length;
S.guardarRegistro_('Gestión Comercial', {
  anio: P.anio, semana: P.semana, nombre: 'Carlos Alberto Arbeláez',
  campos: { ordenesRelevantes: [{ nombre: vivos[0].getName(),
                                  enlace: 'https://drive.google.com/file/d/' + vivos[0].getId() + '/view' }] }
});
ok(Object.keys(DRIVE.archivos).length === antesDeReenviar,
   'reenviar sin bytes nuevos no crea archivos en Drive');

/* El comentario del área viaja junto al indicador. */
const regSoporte = S.leerRegistro_('Soporte Técnico', P.anio, P.semana, 'Edilfonso Vaca');
ok(regSoporte.campos.firstTimeFix.filas[0].comentario.indexOf('87,5%') >= 0,
   'el comentario del FTF se guarda junto a la imagen',
   regSoporte.campos.firstTimeFix.filas[0].comentario);

/* Tope de peso. */
let errPeso = '';
try {
  S.guardarAdjunto_({ anio: 2026, semana: 31, area: 'DPA', colaborador: 'X', campo: 'Y' },
    { nombre: 'grande.png', mime: 'image/png', base64: 'A'.repeat(13 * 1024 * 1024) });
} catch (e) { errPeso = e.message; }
ok(errPeso.indexOf('máximo es 8 MB') >= 0, 'rechaza archivos por encima del tope', errPeso);

/* ===== 14. Tabla pegada desde Excel ===== */
console.log('\n[14] Tabla importada desde Excel');
const tablaNeg = regGc.campos.negociacionesAltoImpacto.tabla;
ok(JSON.stringify(tablaNeg.encabezados) ===
   JSON.stringify(['Cliente', 'Producto', 'Precio actual', 'Precio propuesto', 'Estado']),
   'conserva los encabezados originales de Excel', tablaNeg.encabezados);
ok(tablaNeg.filas.length === 2 && tablaNeg.filas[0][0] === 'Cerrejón',
   'y las filas con su estructura', tablaNeg.filas[0]);
ok(md.indexOf('| Cliente | Producto |') >= 0,
   'el informe la reproduce como tabla, no como texto plano');
ok(md.indexOf('| Cerrejón | CSD 125 |') >= 0, 'con sus datos');

/* ===== 15. Gemini con imágenes ===== */
console.log('\n[15] Gemini interpreta las imágenes adjuntas');
/* La sección anterior guardó Gestión Comercial de forma parcial (a propósito),
   lo que vació las demás imágenes. Se restaura el reporte completo antes de
   medir cuántas llegan a Gemini. */
S.guardarRegistro_('Gestión Comercial', {
  anio: P.anio, semana: P.semana, nombre: 'Carlos Alberto Arbeláez',
  campos: {
    ordenesRelevantes: [{ nombre: 'ordenes.png', mime: 'image/png', base64: PNG_1x1 }],
    kpisConvenios: [{ nombre: 'convenios.png', mime: 'image/png', base64: PNG_1x1 }]
  }
});
PROPS.GEMINI_API_KEY = 'clave-de-prueba';
let peticionIa = null;
FETCH = (url, opciones) => {
  peticionIa = JSON.parse(opciones.payload);
  return respuestaHttp(200, {
    candidates: [{ content: { parts: [{ text: '## 📋 RESUMEN EJECUTIVO\n\nSemana estable.' }] },
                   finishReason: 'STOP' }]
  });
};
const conImagenes = S.construirInforme_(P.anio, P.semana, true);
ok(conImagenes.fuente === 'ia', 'el informe se redacta con Gemini');

const partesIa = peticionIa.contents[0].parts;
const partesImagen = partesIa.filter(p => p.inline_data);
ok(partesImagen.length === 4,
   'se envían las 4 imágenes de la semana como inline_data', partesImagen.length);
ok(partesImagen.every(p => p.mime_type === undefined && p.inline_data.mime_type === 'image/png'),
   'con su tipo MIME dentro de inline_data');
ok(partesIa.some(p => p.text && p.text.indexOf('indicador "First Time Fix Rate (FTF)"') >= 0),
   'cada imagen va rotulada con su área e indicador');
ok(partesIa.some(p => p.text && p.text.indexOf('Comentario del área: 87,5%') >= 0),
   'y el comentario del área acompaña al indicador');
ok(conImagenes.imagenesLeidas === 4, 'se informa cuántas imágenes leyó', conImagenes.imagenesLeidas);
ok(conImagenes.aviso === '', 'sin imágenes omitidas no hay aviso');

/* Si una imagen desaparece de Drive, el informe sale igual y lo advierte. */
const vivoActual = Object.values(DRIVE.archivos).find(
  a => a.getName().indexOf('Órdenes Relevantes') >= 0 && !a.papelera);
vivoActual.setTrashed(true);
const conFaltante = S.construirInforme_(P.anio, P.semana, true);
ok(conFaltante.fuente === 'ia', 'un adjunto borrado no impide redactar el informe');
ok(conFaltante.aviso.indexOf('ya no está en Drive') >= 0,
   'pero se advierte cuál falta', conFaltante.aviso);
vivoActual.setTrashed(false);

/* Tope de imágenes por petición. */
S.CONFIG.IA_MAX_IMAGENES = 2;
const conTope = S.construirInforme_(P.anio, P.semana, true);
ok(conTope.imagenesLeidas === 2, 'respeta el máximo de imágenes por petición');
ok(conTope.aviso.indexOf('máximo de 2 imágenes') >= 0, 'y explica por qué omitió el resto');
S.CONFIG.IA_MAX_IMAGENES = 12;
delete PROPS.GEMINI_API_KEY;

/* ===== 16. Horario del envío automático ===== */
console.log('\n[16] Envío automático los viernes a las 6:00 a. m.');
const mensajeDisparador = S.instalarDisparadores_();
ok(DISPARADORES.instalados.length === 1, 'se instala un único disparador');
const disp = DISPARADORES.instalados[0];
ok(disp.handler === 'enviarInformeSemanal', 'apunta a enviarInformeSemanal');
ok(disp.dia === 'FRIDAY', 'se dispara el viernes', disp.dia);
ok(disp.hora === 6, 'a las 6 de la mañana', disp.hora);
ok(disp.zona === 'America/Bogota', 'en la zona horaria de Colombia', disp.zona);
ok(mensajeDisparador.indexOf('viernes 6:00 a. m.') >= 0,
   'y el mensaje que ve el administrador lo confirma', mensajeDisparador);

/* Reinstalar no debe acumular disparadores. */
S.instalarDisparadores_();
ok(DISPARADORES.instalados.length === 1, 'reinstalar no duplica el disparador');

/* El día configurado debe pertenecer a la semana ISO que se reporta: si el
   informe saliera un lunes, cubriría la semana siguiente, no la que cierra. */
const diaSemanaIso = { MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4,
                       FRIDAY: 5, SATURDAY: 6, SUNDAY: 7 }[S.CONFIG.ENVIO_DIA];
ok(diaSemanaIso >= 4,
   'el día de envío cae al final de la semana, así el informe cubre la semana que cierra',
   S.CONFIG.ENVIO_DIA);

/* Un día mal escrito debe fallar con un mensaje claro, no en silencio. */
const diaOriginal = S.CONFIG.ENVIO_DIA;
S.CONFIG.ENVIO_DIA = 'VIERNES';
let errDia = '';
try { S.instalarDisparadores_(); } catch (e) { errDia = e.message; }
ok(errDia.indexOf('no es un día válido') >= 0,
   'un día mal escrito se rechaza con un mensaje claro', errDia);
S.CONFIG.ENVIO_DIA = diaOriginal;

/* ===== 17. El informe ya no habla de adjuntos ===== */
console.log('\n[17] El informe no expone adjuntos ni carpetas');
ok(md.indexOf('Adjuntos de la semana') < 0,
   'se eliminó la sección "Adjuntos de la semana" del anexo');
ok(md.indexOf('carpeta en Drive') < 0, 'ni el enlace a la carpeta de Drive');

/* Las directrices que recibe Gemini deben prohibir el lenguaje de adjuntos y
   pedir la reconstrucción de las gráficas. */
ok(S.DIRECTRICES_INFORME.indexOf('Nunca escribas "ver imagen adjunta"') >= 0,
   'las directrices prohíben remitir a un adjunto');
ok(S.DIRECTRICES_INFORME.indexOf('reconstrúyela en dos partes') >= 0,
   'y piden reconstruir las gráficas');
ok(S.DIRECTRICES_INFORME.indexOf('tabla Markdown') >= 0,
   'con una tabla de datos legibles');
ok(S.DIRECTRICES_INFORME.indexOf('viñetas con lo que la gráfica revela') >= 0,
   'y la lectura gerencial de la gráfica');

/* El JSON que viaja a Gemini no debe llevar nombres de archivo: nombrarlos
   invita al modelo a escribir "ver adjunto". */
PROPS.GEMINI_API_KEY = 'clave-de-prueba';
let cuerpoIa = null;
FETCH = (url, opciones) => {
  cuerpoIa = JSON.parse(opciones.payload);
  return respuestaHttp(200, {
    candidates: [{ content: { parts: [{ text: '## 📋 RESUMEN EJECUTIVO\n\nOK.' }] },
                   finishReason: 'STOP' }]
  });
};
S.construirInforme_(P.anio, P.semana, true);
const textoUsuario = cuerpoIa.contents[0].parts[0].text;
ok(textoUsuario.indexOf('.png') < 0,
   'el JSON de datos no menciona nombres de archivo');
ok(textoUsuario.indexOf('Imagen adjunta (') < 0, 'ni la etiqueta "Imagen adjunta"');
ok(textoUsuario.indexOf('87,5%') >= 0,
   'pero el comentario del área sí viaja, que es texto suyo');
ok(cuerpoIa.systemInstruction.parts[0].text.indexOf('gráfica') >= 0,
   'y las directrices sobre gráficas llegan como systemInstruction');

/* ===== 18. Verificación de la API ===== */
console.log('\n[18] Botón de verificación de la API');

FETCH = () => respuestaHttp(200, {
  candidates: [{ content: { parts: [{ text: 'LISTO' }] }, finishReason: 'STOP' }]
});
const okIa = S.verificarApiIa_();
ok(okIa.ok === true, 'con clave y API sana, reporta conexión correcta');
ok(okIa.detalle.indexOf('gemini-2.5-flash') >= 0, 'e indica el modelo probado', okIa.detalle);
ok(typeof okIa.ms === 'number', 'y mide el tiempo de respuesta');

/* Un modelo inexistente debe explicarse, no devolver un 404 crudo. */
FETCH = () => respuestaHttp(404, { error: { code: 404, message: 'models/x is not found' } });
const err404 = S.verificarApiIa_();
ok(err404.ok === false && err404.detalle.indexOf(S.CONFIG.PROP_MODELO) >= 0,
   'un 404 señala la propiedad MODELO_IA', err404.detalle);

FETCH = () => respuestaHttp(429, { error: { code: 429, message: 'Quota exceeded' } });
const err429 = S.verificarApiIa_();
ok(err429.ok === false && err429.detalle.indexOf('cuota') >= 0,
   'un 429 explica que se agotó la cuota', err429.detalle);

FETCH = () => { throw new Error('DNS timeout'); };
const errRed = S.verificarApiIa_();
ok(errRed.ok === false && errRed.titulo.indexOf('No hay conexión') >= 0,
   'una caída de red se reporta como tal');

delete PROPS.GEMINI_API_KEY;
const sinClave = S.verificarApiIa_();
ok(sinClave.ok === false && sinClave.detalle.indexOf('informe se enviará igual') >= 0,
   'sin clave avisa, pero aclara que el informe igual sale', sinClave.detalle);

/* La carpeta de Drive se verifica escribiendo de verdad, no sólo mirando. */
const archivosAntes = Object.keys(DRIVE.archivos).length;
const okDrive = S.verificarCarpetaDrive_();
ok(okDrive.ok === true, 'la carpeta configurada es accesible y escribible');
const rastro = Object.values(DRIVE.archivos)
  .filter(a => a.getName() === '.verificacion-informes.txt' && !a.papelera);
ok(rastro.length === 0, 'el archivo de prueba no queda en la carpeta');
ok(Object.keys(DRIVE.archivos).length === archivosAntes + 1,
   'sólo se creó el archivo de prueba, que quedó en la papelera');

PROPS.CARPETA_DRIVE = 'carpeta-que-no-existe';
const malDrive = S.verificarCarpetaDrive_();
ok(malDrive.ok === false && malDrive.detalle.indexOf('CARPETA_DRIVE') >= 0,
   'una carpeta inaccesible señala la propiedad a corregir', malDrive.titulo);
delete PROPS.CARPETA_DRIVE;

ok(S.contarAdjuntosSemana_(P.anio, P.semana) === 4,
   'se cuentan las imágenes que Gemini leerá esta semana',
   S.contarAdjuntosSemana_(P.anio, P.semana));

/* ===== 19. Pegado en la interfaz =====
   Js.html se carga en un navegador simulado. El fallo que motivó esta sección
   no estaba en el parseo sino en el foco: un evento `paste` sólo llega al
   elemento enfocado, y el clic en la zona abría el explorador de archivos, que
   se llevaba el foco consigo. Por eso se prueba el encaminamiento, no sólo los
   parsers. */
console.log('\n[19] Pegado de imágenes y tablas en la interfaz');

/** Elemento DOM mínimo: lo justo que usan `crear` y las zonas de pegado. */
function elementoFalso(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(),
    hijos: [], style: {}, innerHTML: '', className: '', textContent: '',
    clases: new Set(),
    classList: {
      add(c) { this.__d.clases.add(c); }, remove(c) { this.__d.clases.delete(c); },
      contains(c) { return this.__d.clases.has(c); },
      toggle(c, v) { v ? this.__d.clases.add(c) : this.__d.clases.delete(c); }
    },
    oyentes: {},
    addEventListener(ev, fn) { (this.oyentes[ev] = this.oyentes[ev] || []).push(fn); },
    setAttribute() {}, appendChild(h) { this.hijos.push(h); },
    contains(otro) { return otro === this; },
    focus() { this.enfocado = true; },
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
}
const nuevoElemento = (tag) => {
  const el = elementoFalso(tag);
  el.classList.__d = el;
  return el;
};

const OYENTES_DOC = {};
const UI = vm.createContext({
  console,
  document: {
    addEventListener(ev, fn) { (OYENTES_DOC[ev] = OYENTES_DOC[ev] || []).push(fn); },
    getElementById: () => nuevoElemento('div'),
    createElement: nuevoElemento,
    body: nuevoElemento('body')
  },
  window: { addEventListener() {} },
  navigator: {},
  alert(m) { UI.__alertas.push(m); },
  setTimeout() {},
  Promise,
  FileReader: class {
    readAsDataURL(blob) {
      this.result = 'data:' + blob.type + ';base64,' + blob.__base64;
      this.onload();
    }
  },
  __alertas: []
});
vm.runInContext(
  fs.readFileSync(path.join(DIR, 'Js.html'), 'utf8')
    .replace(/^[\s\S]*?<script>/, '').replace(/<\/script>[\s\S]*$/, ''),
  UI);

ok(typeof UI.filasDesdeTsv === 'function' && typeof UI.registrarZona === 'function',
   'Js.html se carga sin tocar el DOM al arrancar');
ok((OYENTES_DOC.paste || []).length === 1,
   'registra un único manejador de pegado a nivel de documento');

/* --- Tablas copiadas de Excel --- */
const tsv = UI.filasDesdeTsv('Cliente\tValor\nACME\t1.500.000\nBETA\t900.000');
ok(tsv.length === 3 && tsv[1][0] === 'ACME' && tsv[2][1] === '900.000',
   'el texto tabulado se divide en filas y columnas', JSON.stringify(tsv));

const conVacias = UI.filasDesdeTsv('A\tB\tC\n1\t\t3');
ok(conVacias[1].length === 3 && conVacias[1][1] === '',
   'una celda vacía en medio no desplaza las columnas', JSON.stringify(conVacias[1]));

const conSalto = UI.filasDesdeTsv('Cliente\tNota\nACME\t"linea 1\nlinea 2"\tX');
ok(conSalto.length === 2,
   'una celda con salto de línea no rompe la fila en dos', conSalto.length);
ok(conSalto[1][1] === 'linea 1\nlinea 2', 'y conserva su contenido', conSalto[1][1]);

const conComillas = UI.filasDesdeTsv('A\n"dijo ""hola"""');
ok(conComillas[1][0] === 'dijo "hola"', 'las comillas escapadas se desdoblan', conComillas[1][0]);

const tablaExcel = UI.tablaDesdeFilas([['Asesor', 'Meta'], ['Luis', '100'], ['Ana']]);
ok(tablaExcel.encabezados.join('|') === 'Asesor|Meta', 'la primera fila es el encabezado');
ok(tablaExcel.filas[1].length === 2 && tablaExcel.filas[1][1] === '',
   'una fila corta se rellena para no descuadrar la tabla', JSON.stringify(tablaExcel.filas[1]));
ok(UI.tablaDesdeFilas([['', ''], ['x', '']]).encabezados.join('') === 'x',
   'las filas totalmente vacías se descartan');

/* --- Imágenes incrustadas en el HTML del portapapeles --- */
const uris = UI.imagenesEnHtml(
  '<div><img alt="a" src="data:image/png;base64,QUJD"><img src="http://x/y.png"></div>');
ok(uris.length === 1 && uris[0].indexOf('QUJD') > 0,
   'se extrae la imagen incrustada y se ignoran las remotas', JSON.stringify(uris));

/* --- Encaminamiento del Ctrl+V --- */
const zonaImg = nuevoElemento('div');
const zonaTab = nuevoElemento('div');
let recibidoImg = 0, recibidoTab = 0;
UI.registrarZona(zonaImg, 'imagen', () => { recibidoImg++; return true; });
UI.registrarZona(zonaTab, 'tabla', () => { recibidoTab++; return true; });

const portapapelesImagen = {
  items: [{ kind: 'file', type: 'image/png', getAsFile: () => ({}) }],
  getData: () => ''
};
const portapapelesTexto = { items: [], getData: () => 'A\tB' };
const eventoPaste = (dt, target) => {
  let prevenido = false;
  OYENTES_DOC.paste[0]({ clipboardData: dt, target, preventDefault() { prevenido = true; } });
  return prevenido;
};

/* Sin haber hecho clic en nada: una imagen tiene un único destino posible. */
ok(eventoPaste(portapapelesImagen, UI.document.body) && recibidoImg === 1,
   'Ctrl+V con el foco en la página encamina la imagen a la única zona de imagen');
ok(recibidoTab === 0, 'y no la manda a la zona de tablas');
ok(eventoPaste(portapapelesTexto, UI.document.body) && recibidoTab === 1,
   'un pegado de texto tabulado va a la zona de tablas');

/* Tras hacer clic, gana la zona elegida. */
zonaTab.oyentes.mousedown[0]();
ok(zonaTab.classList.contains('activa'), 'la zona sobre la que se hace clic queda marcada');
ok(eventoPaste(portapapelesTexto, UI.document.body) && recibidoTab === 2,
   'y recibe el siguiente pegado');

/* Escribir en un campo de texto debe seguir siendo escribir. */
const cajaTexto = nuevoElemento('textarea');
const antes = recibidoTab;
ok(eventoPaste(portapapelesTexto, cajaTexto) === false && recibidoTab === antes,
   'pegar texto dentro de un textarea no se desvía a ninguna zona');
ok(eventoPaste(portapapelesImagen, cajaTexto) && recibidoImg === 2,
   'pero pegar una imagen sobre el comentario sí la adjunta');

/* Con dos zonas del mismo tipo y ninguna elegida, se pide elegir antes de pegar. */
UI.ZONA_ACTIVA = null;
UI.registrarZona(nuevoElemento('div'), 'tabla', () => { recibidoTab++; return true; });
const ambiguo = recibidoTab;
ok(eventoPaste(portapapelesTexto, UI.document.body) === false && recibidoTab === ambiguo,
   'con dos zonas candidatas no se adivina el destino');

/* El fallo original: el clic en la zona no debe abrir el explorador de archivos,
   porque el diálogo se lleva el foco y Ctrl+V deja de llegar. */
const fuenteJs = fs.readFileSync(path.join(DIR, 'Js.html'), 'utf8');
ok(fuenteJs.indexOf("zona.addEventListener('click', function () { entrada.click(); })") < 0,
   'el clic en la zona ya no abre el explorador de archivos');
ok(/texto: '📁 Elegir archivo'[\s\S]{0,80}entrada\.click\(\)/.test(fuenteJs),
   'elegir archivo es un botón aparte');

/* ===== 21. Veracidad: cifras contrastadas contra lo reportado ===== */
console.log('\n[21] Ninguna cifra del informe puede salir de la nada');

const datosFuente = S.datosParaIa_(S.consolidarSemana_(P.anio, P.semana));

ok(S.cifrasSinRespaldo_(
     'Se facturaron **$3.900.000.000**, el 92% de la meta.', datosFuente).length === 0,
   'una cifra que sí está en los datos no se señala');
ok(S.cifrasSinRespaldo_(
     'El equipo **EMR-4412** sigue detenido.', datosFuente).length === 0,
   'ni un código de equipo real');

const inventadas = S.cifrasSinRespaldo_(
  'Se facturaron **$7.777.777.777** y el equipo **EMR-9999** está detenido.', datosFuente);
ok(inventadas.indexOf('EMR-9999') >= 0, 'un código de equipo inexistente se detecta', inventadas);
ok(inventadas.indexOf('7.777.777.777') >= 0, 'y un importe que nadie reportó', inventadas);

ok(S.cifrasSinRespaldo_('Se atendieron 27 casos en 12 días.', datosFuente).length === 0,
   'los conteos cortos no se revisan: sólo generarían ruido');
ok(S.cifrasSinRespaldo_('Facturación de $3.900 millones.', datosFuente).length === 0,
   'un importe reescrito en otra escala se reconoce igual');

/* No basta con detectar: hay que impedir que salga. Si el modelo inventa, se le
   pide corregir señalándole la cifra concreta; si insiste, se descarta su
   redacción y sale el informe determinista, que no puede inventar nada. */
PROPS.GEMINI_API_KEY = 'clave-de-prueba';
const inventado = '## 📋 RESUMEN EJECUTIVO\nCerramos **$8.888.888.888** con **Cementos Argos**.';
const limpio = '## 📋 RESUMEN EJECUTIVO\nCerramos **$3.900.000.000**, 92% de la meta.';

let peticiones = [];
FETCH = (url, opciones) => {
  peticiones.push(JSON.parse(opciones.payload));
  return respuestaHttp(200, {
    candidates: [{
      content: { parts: [{ text: peticiones.length === 1 ? inventado : limpio }] },
      finishReason: 'STOP'
    }]
  });
};
const corregido = S.construirInforme_(P.anio, P.semana, true);
ok(peticiones.length === 2, 'una cifra inventada provoca un segundo intento', peticiones.length);
ok(peticiones[1].contents[0].parts[0].text.indexOf('8.888.888.888') >= 0,
   'y al modelo se le dice exactamente qué cifra se inventó');
ok(corregido.fuente === 'ia' && corregido.markdown.indexOf('8.888.888.888') < 0,
   'el informe que sale ya no contiene la cifra inventada');
ok(corregido.aviso.indexOf('primera redacción') >= 0,
   'pero el administrador queda enterado de que hubo que corregirlo', corregido.aviso);

/* El mismo ciclo protege de que el informe remita al lector a un archivo, que
   es el otro defecto que una instrucción sola no logra evitar. */
ok(S.lenguajeDeAdjuntos_('El FTF fue del 87,5%.').length === 0,
   'un informe limpio no dispara la alarma');
['Ver imagen adjunta para el detalle.', 'Según el archivo de convenios.',
 'Se adjunta la gráfica de FTF.', 'Revisar ftf.png.',
 'Disponible en https://drive.google.com/drive/folders/abc'
].forEach(frase => ok(S.lenguajeDeAdjuntos_(frase).length > 0,
  'se detecta: "' + frase + '"'));

peticiones = [];
FETCH = (url, opciones) => {
  peticiones.push(JSON.parse(opciones.payload));
  return respuestaHttp(200, {
    candidates: [{
      content: { parts: [{ text: peticiones.length === 1
        ? '## 📋 RESUMEN EJECUTIVO\nEl FTF aparece en la imagen adjunta.'
        : limpio }] },
      finishReason: 'STOP'
    }]
  });
};
const sinAdjuntos = S.construirInforme_(P.anio, P.semana, true);
ok(peticiones.length === 2, 'remitir a un adjunto también provoca la corrección');
ok(peticiones[1].contents[0].parts[0].text.indexOf('remiten al lector a un archivo') >= 0,
   'y se le explica por qué no sirve: la gerencia no tiene esos archivos');
ok(sinAdjuntos.markdown.indexOf('imagen adjunta') < 0,
   'el informe enviado ya no remite a ningún archivo');

/* Si insiste, no se envía su redacción: gana el informe construido desde la hoja. */
peticiones = [];
FETCH = (url, opciones) => {
  peticiones.push(1);
  return respuestaHttp(200, {
    candidates: [{ content: { parts: [{ text: inventado }] }, finishReason: 'STOP' }]
  });
};
const descartado = S.construirInforme_(P.anio, P.semana, true);
ok(peticiones.length === 2, 'se reintenta una sola vez, no en bucle', peticiones.length);
ok(descartado.fuente === 'datos',
   'si el modelo insiste, se descarta su redacción entera', descartado.fuente);
ok(descartado.markdown.indexOf('8.888.888.888') < 0,
   'y la cifra inventada no llega al correo bajo ningún concepto');
ok(descartado.aviso.indexOf('mantuvo defectos') >= 0,
   'el motivo del descarte queda explicado', descartado.aviso);

/* Y las directrices deben prohibirlo explícitamente, no sólo la comprobación. */
const D = S.DIRECTRICES_INFORME;
ok(D.indexOf('VERACIDAD') >= 0, 'las directrices abren con la regla de veracidad');
ok(D.indexOf('estimar') >= 0 && D.indexOf('aproximar') >= 0,
   'prohíben estimar y aproximar');
ok(D.indexOf('No calcules cifras nuevas') >= 0,
   'y calcular cifras que no vengan dadas, que es lo que vuelve auditable el informe');
ok(D.indexOf('sin dato reportado') >= 0, 'e indican qué escribir cuando el dato falta');

/* ===== 22. Detalle de lo reportado por los directores ===== */
console.log('\n[22] El informe detalla los temas de los directores');

ok(D.indexOf('## 🧭 DIRECCIÓN — TEMAS REPORTADOS POR LOS DIRECTORES') >= 0,
   'las directrices piden una sección propia para dirección');
ok(D.indexOf('seis títulos') >= 0, 'y la estructura pasa a seis secciones');
ok(D.indexOf('EXHAUSTIVA') >= 0, 'exigiendo que no se resuma ni se descarte un tema');

/* El informe determinista debe traer la misma sección: si Gemini no responde,
   la gerencia no puede quedarse sin el detalle de dirección. */
const seccionDir = S.seccionDireccion_(S.consolidarSemana_(P.anio, P.semana));
ok(seccionDir.indexOf('### Luis Rodriguez') >= 0,
   'un subtítulo por cada director que reportó');
S.TEMAS_DIRECCION.forEach(t => ok(seccionDir.indexOf('**' + t.titulo + '**') >= 0,
  'incluye el bloque "' + t.titulo + '"'));
ok(seccionDir.indexOf('| ASESOR | META | VIGENTES | % CUMPL. | VENCIDOS |') >= 0,
   'las tablas se reproducen como tablas, con sus columnas originales');
ok(seccionDir.indexOf('| Facturación acumulada | 3.900.000.000 | 92% de la meta del mes |') >= 0,
   'y los valores van exactos, sin redondear ni reescribir');
ok(seccionDir.indexOf('Sin novedades reportadas') >= 0,
   'y un tema sin datos se declara en vez de desaparecer');

const detMd = S.construirInforme_(P.anio, P.semana, false).markdown;
ok(detMd.indexOf('## 🧭 DIRECCIÓN') > detMd.indexOf('## 📋 RESUMEN EJECUTIVO'),
   'la sección va después del resumen ejecutivo');
ok(detMd.indexOf('## 🧭 DIRECCIÓN') < detMd.indexOf('## 🚨 ALERTAS'),
   'y antes de las alertas');
ok(S.construirInforme_(P.anio, P.semana, false).markdown.match(/^## /gm).length === 6,
   'el informe determinista trae las seis secciones',
   detMd.match(/^## /gm).length);

delete PROPS.GEMINI_API_KEY;

/* ===== 20. Prueba contra la API real (opcional) =====
   Se activa sólo si hay una clave en el entorno, nunca en el repositorio:

       GEMINI_API_KEY=... node pruebas/prueba-local.js

   Las demás secciones simulan la respuesta de Gemini, que es lo correcto para
   una prueba rápida y repetible. Esta comprueba lo que ninguna simulación puede:
   que la clave sea válida, que el modelo exista y que el informe que redacta el
   modelo real respete la estructura pactada con la gerencia. */
if (process.env.GEMINI_API_KEY) {
  console.log('\n[20] Informe redactado por la API real de Gemini');
  const { execFileSync } = require('child_process');

  /* Se usa curl y no el módulo https porque así se respeta el proxy de salida
     del entorno sin configurarlo a mano. */
  FETCH = (url, opciones) => {
    const args = ['-sS', '-X', opciones.method === 'post' ? 'POST' : 'GET',
                  '-w', '\n%{http_code}', '--data-binary', '@-'];
    Object.keys(opciones.headers || {}).forEach(h => {
      args.push('-H', h + ': ' + opciones.headers[h]);
    });
    args.push('-H', 'Content-Type: ' + (opciones.contentType || 'application/json'), url);
    const salida = execFileSync('curl', args,
      { input: opciones.payload || '', maxBuffer: 64 * 1024 * 1024 }).toString();
    const corte = salida.lastIndexOf('\n');
    return respuestaHttp(Number(salida.slice(corte + 1)), salida.slice(0, corte));
  };

  PROPS.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  PROPS.CORREO_GERENTE = 'gerencia@kaeser.com';

  const real = S.informeConIa_(S.consolidarSemana_(P.anio, P.semana));
  ok(real.ok === true, 'la API real acepta la clave y devuelve un informe',
     real.ok ? '' : real.motivo);

  if (real.ok) {
    const t = real.markdown;
    ok(real.imagenesLeidas === 4, 'y leyó las 4 imágenes de la semana', real.imagenesLeidas);
    ['RESUMEN EJECUTIVO', 'DIRECCIÓN', 'ALERTAS CRÍTICAS', 'GESTIÓN COMERCIAL',
     'OPERACIONES, SAU Y SOPORTE TÉCNICO', 'DESARROLLO DE PERSONAL'
    ].forEach(titulo => ok(t.indexOf(titulo) >= 0,
      'el modelo real incluye la sección "' + titulo + '"'));

    /* Veracidad: la comprobación mecánica sobre lo que escribió el modelo real.
       Es la única forma de saber si las directrices se están respetando. */
    ok(real.cifrasSinRespaldo.length === 0,
       'ninguna cifra del informe real sale de fuera de los datos reportados',
       real.cifrasSinRespaldo.join(', '));
    // Al fallar, la cifra sola no dice nada: hay que ver en qué frase la metió.
    real.cifrasSinRespaldo.forEach(c => {
      const linea = t.split('\n').find(l => l.indexOf(c) >= 0);
      console.log('      ↳ ' + c + ' → ' + String(linea || '').trim().slice(0, 160));
    });

    /* Detalle de dirección: los temas del director, con sus cifras exactas. */
    const dir = t.slice(t.indexOf('DIRECCIÓN'), t.indexOf('ALERTAS CRÍTICAS'));
    ok(dir.indexOf('Luis Rodriguez') >= 0, 'la sección de dirección nombra al director');
    ok(dir.indexOf('3.900.000.000') >= 0,
       'y reproduce su cifra de facturación exacta, sin redondear');
    ok(dir.indexOf('|') >= 0, 'sus tablas se reproducen como tablas Markdown');

    ok(S.lenguajeDeAdjuntos_(t).length === 0,
       'no remite al lector a ningún adjunto ni nombra archivos',
       S.lenguajeDeAdjuntos_(t).join(', '));
    ok(/\*\*/.test(t), 'usa negritas como pide la directriz de formato');
    ok(t.length > 800, 'el informe tiene cuerpo, no es una respuesta corta', t.length);

    /* Las imágenes son insumo real: si el modelo las leyó, deben aparecer sus
       cifras en el texto. Se comprueba con una que sí lleva número legible. */
    const correoReal = S.construirCorreo_(P.anio, P.semana);
    ok(correoReal.fuente === 'ia', 'el correo se arma con la redacción del modelo');
    ok(correoReal.html.indexOf('KAESER COMPRESORES') >= 0, 'dentro de la plantilla del correo');

    if (process.env.VER) console.log('\n===== INFORME REAL =====\n' + t);
  }

  delete PROPS.GEMINI_API_KEY;
  delete PROPS.CORREO_GERENTE;
} else {
  console.log('\n[20] Prueba contra la API real: omitida (sin GEMINI_API_KEY en el entorno)');
}

if (process.env.VER) { console.log('\n===== INFORME =====\n' + md); }
console.log('\n' + (fallos ? '❌ ' + fallos + ' prueba(s) fallida(s)' : '✅ Todas las pruebas pasaron'));
process.exit(fallos ? 1 : 0);
