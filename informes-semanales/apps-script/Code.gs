/**
 * Code.gs
 * ---------------------------------------------------------------------------
 * Puntos de entrada del proyecto:
 *   - onOpen()  : menú dentro de Google Sheets.
 *   - doGet()   : sirve la interfaz web (Index.html).
 *   - api*()    : funciones invocadas desde el HTML vía google.script.run.
 *
 * Todas las funciones `api*` validan el usuario contra la hoja "Usuario" antes
 * de tocar datos: la interfaz nunca decide sola qué puede hacer alguien.
 * ---------------------------------------------------------------------------
 */

/** Menú personalizado al abrir la hoja de cálculo. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 Informes Semanales')
    .addItem('Verificar / crear hojas', 'menuInicializar')
    .addItem('Abrir interfaz web (URL)', 'menuUrlWebApp')
    .addSeparator()
    .addItem('Previsualizar informe de esta semana', 'menuPrevisualizar')
    .addItem('Enviar informe ahora', 'menuEnviarAhora')
    .addSeparator()
    .addItem('Instalar envío automático (jueves 5:00 p. m.)', 'menuInstalarDisparador')
    .addItem('Estado de la configuración', 'menuEstado')
    .addToUi();
}

function menuInicializar() {
  SpreadsheetApp.getUi().alert('Verificación de hojas', inicializarHojas(),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuUrlWebApp() {
  var url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert('Interfaz web',
    url ? url : 'Aún no has publicado la aplicación (Implementar → Nueva implementación → Aplicación web).',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuPrevisualizar() {
  var p = periodoActual();
  var informe = construirInforme(p.anio, p.semana, true);
  var html = HtmlService
    .createHtmlOutput('<div style="font-family:Segoe UI,Arial,sans-serif;padding:8px">' +
                      markdownAHtml_(informe.markdown) + '</div>')
    .setWidth(900).setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, 'Vista previa · ' + informe.consolidado.etiqueta);
}

function menuEnviarAhora() {
  var ui = SpreadsheetApp.getUi();
  var p = periodoActual();
  var respuesta = ui.alert('Enviar informe gerencial',
    '¿Enviar ahora el informe de la ' + etiquetaSemana(p.anio, p.semana) + ' al gerente?',
    ui.ButtonSet.YES_NO);
  if (respuesta !== ui.Button.YES) return;
  try {
    ui.alert(enviarInforme(p.anio, p.semana).mensaje);
  } catch (e) {
    ui.alert('No se pudo enviar: ' + e.message);
  }
}

function menuInstalarDisparador() {
  SpreadsheetApp.getUi().alert(instalarDisparadores());
}

function menuEstado() {
  var props = PropertiesService.getScriptProperties();
  var lineas = [
    'Correo del gerente: ' + (props.getProperty(CONFIG.PROP_CORREO_GERENTE) || '⚠️ sin configurar'),
    'Copias: ' + (props.getProperty(CONFIG.PROP_COPIA_INFORME) || '—'),
    'Administradores: ' + (props.getProperty(CONFIG.PROP_ADMINS) || '—'),
    'Redacción con IA: ' + (iaDisponible() ? 'activa (' + modeloIa_() + ')' : 'inactiva (informe automático)'),
    'Zona horaria: ' + CONFIG.ZONA_HORARIA,
    ''
  ];
  var triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === HANDLER_INFORME;
  });
  lineas.push('Disparador semanal: ' + (triggers.length ? 'instalado' : '⚠️ no instalado'));
  SpreadsheetApp.getUi().alert('Estado de la configuración', lineas.join('\n'),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ===================== Aplicación web ===================== */

/** Sirve la interfaz web. */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Informes Semanales · Kaeser Compresores')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Permite incluir parciales HTML desde la plantilla. */
function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

/* ===================== API para la interfaz ===================== */

/**
 * Estado inicial de la sesión: usuario, área, esquema del formulario,
 * periodo precargado y el registro ya guardado (si existe).
 */
function apiSesion() {
  var sesion = usuarioActual();
  if (!sesion.ok) return { ok: false, motivo: sesion.motivo };

  var usuario = sesion.usuario;
  var periodo = periodoActual();
  var def = ESQUEMA[usuario.area];

  return {
    ok: true,
    usuario: {
      nombre: usuario.nombre,
      correo: usuario.correo,
      cargo: usuario.cargo,
      area: usuario.area
    },
    area: {
      nombre: usuario.area,
      icono: def.icono,
      descripcion: def.descripcion,
      campos: def.campos
    },
    periodo: {
      anio: periodo.anio,
      semana: periodo.semana,
      etiqueta: etiquetaSemana(periodo.anio, periodo.semana)
    },
    periodosEditables: ultimosPeriodos(CONFIG.SEMANAS_EDITABLES),
    registro: apiCargarRegistro(periodo.anio, periodo.semana),
    permisos: {
      verInforme: puedeVerInforme_(usuario),
      enviarInforme: puedeEnviarInforme_(usuario)
    },
    iaActiva: iaDisponible()
  };
}

/**
 * Carga el reporte propio del usuario para un periodo.
 * Devuelve null si aún no ha reportado esa semana.
 */
function apiCargarRegistro(anio, semana) {
  var sesion = usuarioActual();
  if (!sesion.ok) throw new Error(sesion.motivo);

  var usuario = sesion.usuario;
  var registro = leerRegistro(usuario.area, Number(anio), Number(semana), usuario.nombre);
  if (!registro) return null;

  // Se aplana a { clave: valor | filas } para que el formulario lo consuma directo.
  var campos = {};
  for (var clave in registro.campos) {
    var c = registro.campos[clave];
    campos[clave] = (c.tipo === 'tabla') ? c.filas : c.valor;
  }
  return { anio: registro.anio, semana: registro.semana, nombre: registro.nombre, campos: campos };
}

/**
 * Guarda el reporte del usuario autenticado.
 * El nombre y el área NUNCA vienen del cliente: se toman de la hoja "Usuario".
 */
function apiGuardar(datos) {
  var sesion = usuarioActual();
  if (!sesion.ok) throw new Error(sesion.motivo);
  var usuario = sesion.usuario;

  var anio = Number(datos.anio);
  var semana = Number(datos.semana);
  if (!anio || !semana) throw new Error('Periodo inválido.');

  // Sólo se permite escribir dentro de la ventana de corrección.
  var permitidos = ultimosPeriodos(CONFIG.SEMANAS_EDITABLES);
  var valido = permitidos.some(function (p) { return p.anio === anio && p.semana === semana; });
  if (!valido) {
    throw new Error('Sólo puedes reportar la semana actual o las ' +
                    (CONFIG.SEMANAS_EDITABLES - 1) + ' anteriores.');
  }

  var resultado = guardarRegistro(usuario.area, {
    anio: anio,
    semana: semana,
    nombre: usuario.nombre,
    campos: datos.campos || {}
  });

  return {
    ok: true,
    creado: resultado.creado,
    mensaje: (resultado.creado ? 'Reporte registrado' : 'Reporte actualizado') +
             ' para la ' + etiquetaSemana(anio, semana) + '.'
  };
}

/** Vista previa del informe gerencial (HTML listo para incrustar). */
function apiPrevisualizarInforme(anio, semana, usarIa) {
  var sesion = usuarioActual();
  if (!sesion.ok) throw new Error(sesion.motivo);
  if (!puedeVerInforme_(sesion.usuario)) {
    throw new Error('No tienes permiso para ver el informe gerencial.');
  }

  var informe = construirInforme(Number(anio), Number(semana), usarIa !== false);
  return {
    ok: true,
    html: markdownAHtml_(informe.markdown),
    markdown: informe.markdown,
    fuente: informe.fuente,
    aviso: informe.aviso,
    etiqueta: informe.consolidado.etiqueta,
    totalReportes: informe.consolidado.totalReportes,
    faltantes: informe.consolidado.faltantes
  };
}

/** Envía el informe gerencial por correo (sólo administradores). */
function apiEnviarInforme(anio, semana) {
  var sesion = usuarioActual();
  if (!sesion.ok) throw new Error(sesion.motivo);
  if (!puedeEnviarInforme_(sesion.usuario)) {
    throw new Error('No tienes permiso para enviar el informe gerencial.');
  }
  return enviarInforme(Number(anio), Number(semana));
}

/** Estado de cobertura de la semana (quién ya reportó y quién no). */
function apiCobertura(anio, semana) {
  var sesion = usuarioActual();
  if (!sesion.ok) throw new Error(sesion.motivo);
  if (!puedeVerInforme_(sesion.usuario)) {
    throw new Error('No tienes permiso para ver la cobertura.');
  }

  var consolidado = consolidarSemana(Number(anio), Number(semana));
  var reportaron = [];
  for (var a = 0; a < ORDEN_AREAS.length; a++) {
    var lista = consolidado.areas[ORDEN_AREAS[a]] || [];
    for (var i = 0; i < lista.length; i++) {
      reportaron.push({ nombre: lista[i].nombre, area: ORDEN_AREAS[a] });
    }
  }
  return {
    etiqueta: consolidado.etiqueta,
    reportaron: reportaron,
    faltantes: consolidado.faltantes
  };
}
