/**
 * Code.gs
 * ---------------------------------------------------------------------------
 * Puntos de entrada del proyecto.
 *
 * CONVENCIÓN DE VISIBILIDAD — importante al trabajar en el editor:
 *
 * En Apps Script, una función cuyo nombre termina en "_" es privada: no aparece
 * en el selector de "▶ Ejecutar" del editor y no puede invocarse con
 * google.script.run. Todo el proyecto usa esa convención, de modo que sólo las
 * funciones de abajo son ejecutables directamente. Las demás esperan argumentos
 * (área, año, semana...) que el editor no tiene cómo pasar, y ejecutarlas a
 * mano produce errores como `Área desconocida: "undefined"`.
 *
 *   onOpen()                  Menú dentro de Google Sheets (disparador simple).
 *   doGet()                   Sirve la interfaz web (Index.html).
 *   include()                 Inserta parciales HTML en la plantilla.
 *   menu*()                   Acciones del menú; todas exigen Administrador.
 *   api*()                    Invocadas desde el HTML vía google.script.run.
 *   enviarInformeSemanal()    Disparador de los jueves a las 5:00 p. m.
 *                             Es la única función segura de ejecutar desde el
 *                             editor para probar el envío de punta a punta.
 *
 * Todas las funciones `api*` validan el usuario contra la hoja "Usuario" antes
 * de tocar datos: la interfaz nunca decide sola qué puede hacer alguien.
 * ---------------------------------------------------------------------------
 */

/**
 * Menú personalizado al abrir la hoja de cálculo.
 *
 * Todas las acciones salvo "Abrir interfaz web" exigen rol de Administrador
 * (ver `accionAdministrador_`). El menú se muestra igual, pero al ejecutarlo
 * quien no sea administrador recibe un aviso y nada más ocurre.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 Informes Semanales')
    .addItem('Abrir interfaz web (URL)', 'menuUrlWebApp')
    .addSeparator()
    .addItem('🔒 Verificar / crear hojas', 'menuInicializar')
    .addItem('🔒 Previsualizar informe de esta semana', 'menuPrevisualizar')
    .addItem('🔒 Enviar informe ahora (manual)', 'menuEnviarAhora')
    .addSeparator()
    .addItem('🔒 Instalar envío automático (jueves 5:00 p. m.)', 'menuInstalarDisparador')
    .addItem('🔒 Estado de la configuración', 'menuEstado')
    .addToUi();
}

/**
 * Envuelve una acción de menú exigiendo rol de Administrador y mostrando los
 * errores como diálogo en vez de dejarlos en el registro de ejecuciones.
 */
function accionAdministrador_(titulo, fn) {
  var ui = SpreadsheetApp.getUi();
  try {
    exigirAdministrador_();
    fn(ui);
  } catch (e) {
    ui.alert(titulo, e.message, ui.ButtonSet.OK);
  }
}

function menuInicializar() {
  accionAdministrador_('Verificación de hojas', function (ui) {
    ui.alert('Verificación de hojas', inicializarHojas_(), ui.ButtonSet.OK);
  });
}

function menuUrlWebApp() {
  var url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert('Interfaz web',
    url ? url : 'Aún no has publicado la aplicación (Implementar → Nueva implementación → Aplicación web).',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuPrevisualizar() {
  accionAdministrador_('Vista previa del informe', function (ui) {
    var p = periodoActual_();
    var informe = construirInforme_(p.anio, p.semana, true);
    var aviso = informe.aviso
      ? '<p style="background:#fff6e0;border:1px solid #f0dca6;color:#9a6700;' +
        'padding:8px 12px;border-radius:6px;font-size:13px">' + informe.aviso + '</p>'
      : '';
    var html = HtmlService
      .createHtmlOutput('<div style="font-family:Segoe UI,Arial,sans-serif;padding:8px">' +
                        aviso + markdownAHtml_(informe.markdown) + '</div>')
      .setWidth(900).setHeight(640);
    ui.showModalDialog(html, 'Vista previa · ' + informe.consolidado.etiqueta);
  });
}

function menuEnviarAhora() {
  accionAdministrador_('Enviar informe gerencial', function (ui) {
    var p = periodoActual_();
    var respuesta = ui.alert('Enviar informe gerencial',
      '¿Enviar ahora el informe de la ' + etiquetaSemana_(p.anio, p.semana) + ' al gerente?',
      ui.ButtonSet.YES_NO);
    if (respuesta !== ui.Button.YES) return;
    ui.alert(enviarInforme_(p.anio, p.semana).mensaje);
  });
}

function menuInstalarDisparador() {
  accionAdministrador_('Envío automático', function (ui) {
    ui.alert('Envío automático', instalarDisparadores_(), ui.ButtonSet.OK);
  });
}

function menuEstado() {
  accionAdministrador_('Estado de la configuración', function (ui) {
    var props = PropertiesService.getScriptProperties();
    var admins = correosAdmin_();
    var lineas = [
      'Correo del gerente: ' + (props.getProperty(CONFIG.PROP_CORREO_GERENTE) || '⚠️ sin configurar'),
      'Copias: ' + (props.getProperty(CONFIG.PROP_COPIA_INFORME) || '—'),
      'Administradores: ' + (admins.length ? admins.join(', ')
        : '⚠️ sin configurar (sólo el propietario del libro puede operar)'),
      'Redacción con IA: ' + (iaDisponible_()
        ? 'activa (' + modeloIa_() + ')' : 'inactiva (informe automático)'),
      'Zona horaria: ' + CONFIG.ZONA_HORARIA,
      ''
    ];

    var triggers = ScriptApp.getProjectTriggers().filter(function (t) {
      return t.getHandlerFunction() === HANDLER_INFORME;
    });
    if (triggers.length) {
      lineas.push('Envío automático: instalado (jueves 5:00 p. m., ' + CONFIG.ZONA_HORARIA + ')');
      var p = periodoActual_();
      lineas.push('Próximo informe: ' + etiquetaSemana_(p.anio, p.semana));
    } else {
      lineas.push('Envío automático: ⚠️ NO instalado — el informe no saldrá el jueves.');
    }

    ui.alert('Estado de la configuración', lineas.join('\n'), ui.ButtonSet.OK);
  });
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
  var sesion = usuarioActual_();
  if (!sesion.ok) return { ok: false, motivo: sesion.motivo };

  var usuario = sesion.usuario;
  var periodo = periodoActual_();
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
      etiqueta: etiquetaSemana_(periodo.anio, periodo.semana)
    },
    periodosEditables: ultimosPeriodos_(CONFIG.SEMANAS_EDITABLES),
    registro: apiCargarRegistro(periodo.anio, periodo.semana)
  };
}

/**
 * Carga el reporte propio del usuario para un periodo.
 * Devuelve null si aún no ha reportado esa semana.
 */
function apiCargarRegistro(anio, semana) {
  var sesion = usuarioActual_();
  if (!sesion.ok) throw new Error(sesion.motivo);

  var usuario = sesion.usuario;
  var registro = leerRegistro_(usuario.area, Number(anio), Number(semana), usuario.nombre);
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
  var sesion = usuarioActual_();
  if (!sesion.ok) throw new Error(sesion.motivo);
  var usuario = sesion.usuario;

  var anio = Number(datos.anio);
  var semana = Number(datos.semana);
  if (!anio || !semana) throw new Error('Periodo inválido.');

  // Sólo se permite escribir dentro de la ventana de corrección.
  var permitidos = ultimosPeriodos_(CONFIG.SEMANAS_EDITABLES);
  var valido = permitidos.some(function (p) { return p.anio === anio && p.semana === semana; });
  if (!valido) {
    throw new Error('Sólo puedes reportar la semana actual o las ' +
                    (CONFIG.SEMANAS_EDITABLES - 1) + ' anteriores.');
  }

  var resultado = guardarRegistro_(usuario.area, {
    anio: anio,
    semana: semana,
    nombre: usuario.nombre,
    campos: datos.campos || {}
  });

  return {
    ok: true,
    creado: resultado.creado,
    mensaje: (resultado.creado ? 'Reporte registrado' : 'Reporte actualizado') +
             ' para la ' + etiquetaSemana_(anio, semana) + '.'
  };
}

/*
 * NOTA DE SEGURIDAD — el informe gerencial no tiene endpoint.
 *
 * Aquí NO existe ninguna función que previsualice, genere o envíe el informe.
 * Es deliberado: cualquier función de este archivo es invocable desde el
 * navegador con `google.script.run.<nombre>()`, así que esconder un botón en el
 * HTML no impediría que alguien la llamara desde la consola. Al no existir el
 * endpoint, la acción sencillamente no es alcanzable desde la interfaz.
 *
 * El informe sale por dos caminos, y sólo por esos dos:
 *   1. Automático: disparador `enviarInformeSemanal` (jueves 5:00 p. m.).
 *   2. Manual: menú de Google Sheets, restringido con `exigirAdministrador_()`.
 */
