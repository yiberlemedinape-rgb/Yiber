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
 *                             Las de informe exigen Administrador en servidor.
 *   enviarInformeSemanal()    Disparador semanal del informe gerencial.
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
    .addItem('🔒 Verificar conexión con Gemini', 'menuVerificarApi')
    .addItem('🔒 Verificar / crear hojas', 'menuInicializar')
    .addItem('🔒 Previsualizar informe de esta semana', 'menuPrevisualizar')
    .addItem('🔒 Enviar informe ahora (manual)', 'menuEnviarAhora')
    .addSeparator()
    .addItem('🔒 Instalar envío automático (' + CONFIG.ENVIO_ETIQUETA + ')',
             'menuInstalarDisparador')
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

/**
 * Comprueba que todo lo necesario para el informe del viernes esté en pie:
 * la API de Gemini, la carpeta de Drive, el destinatario y el disparador.
 *
 * Se llama de verdad a la API en vez de sólo mirar si hay clave, porque una
 * clave revocada, un modelo mal escrito o una cuota agotada se ven igual que
 * una configuración correcta hasta que se intenta usar.
 */
function menuVerificarApi() {
  accionAdministrador_('Verificación de la API', function (ui) {
    var lineas = [];
    var problemas = 0;

    var marca = function (r) { return r.ok ? '✅ ' : '❌ '; };

    // 1. Gemini.
    var ia = verificarApiIa_();
    if (!ia.ok) problemas++;
    lineas.push(marca(ia) + 'GEMINI — ' + ia.titulo);
    lineas.push('   ' + ia.detalle);
    lineas.push('');

    // 2. Carpeta de adjuntos.
    var drive = verificarCarpetaDrive_();
    if (!drive.ok) problemas++;
    lineas.push(marca(drive) + 'DRIVE — ' + drive.titulo);
    lineas.push('   ' + drive.detalle);
    lineas.push('');

    // 3. Destinatario del informe.
    var gerente = correoGerente_();
    if (!gerente) problemas++;
    lineas.push((gerente ? '✅ ' : '❌ ') + 'DESTINATARIO — ' +
                (gerente || 'falta la propiedad ' + CONFIG.PROP_CORREO_GERENTE));
    lineas.push('');

    // 4. Envío automático.
    var triggers = ScriptApp.getProjectTriggers().filter(function (t) {
      return t.getHandlerFunction() === HANDLER_INFORME;
    });
    if (!triggers.length) problemas++;
    lineas.push((triggers.length ? '✅ ' : '❌ ') + 'ENVÍO AUTOMÁTICO — ' +
                (triggers.length
                  ? 'instalado (' + CONFIG.ENVIO_ETIQUETA + ')'
                  : 'no instalado; el informe no saldrá solo'));
    lineas.push('');

    // 5. Insumos de la semana en curso.
    var p = periodoActual_();
    var consolidado = consolidarSemana_(p.anio, p.semana);
    var imagenes = contarAdjuntosSemana_(p.anio, p.semana);
    lineas.push('📋 SEMANA EN CURSO — ' + etiquetaSemana_(p.anio, p.semana));
    lineas.push('   ' + consolidado.totalReportes + ' reporte(s) · ' +
                imagenes + ' imagen(es) que Gemini leerá.');
    if (consolidado.faltantes.length) {
      lineas.push('   Faltan por reportar: ' +
                  consolidado.faltantes.map(function (f) { return f.nombre; }).join(', '));
    }
    lineas.push('');
    lineas.push(problemas === 0
      ? '✅ Todo listo: el informe saldrá el ' + CONFIG.ENVIO_ETIQUETA + '.'
      : '⚠️ ' + problemas + ' punto(s) por corregir. El informe se enviará igual, ' +
        'pero revisa lo marcado con ❌.');

    ui.alert('Verificación de la API', lineas.join('\n'), ui.ButtonSet.OK);
  });
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
  accionAdministrador_('Vista previa del correo', function (ui) {
    var p = periodoActual_();
    var correo = construirCorreo_(p.anio, p.semana);
    var aviso = correo.aviso
      ? '<p style="background:#fff6e0;border:1px solid #f0dca6;color:#9a6700;' +
        'padding:8px 12px;border-radius:6px;font-size:13px;font-family:Segoe UI,Arial,sans-serif">' +
        escaparHtml_(correo.aviso) + '</p>'
      : '';
    var cabecera =
      '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:12.5px;color:#5c6472;' +
                  'border:1px solid #dfe3ea;border-radius:6px;padding:10px 12px;margin-bottom:10px">' +
        '<b>Para:</b> ' + escaparHtml_(correo.para || '⚠️ falta CORREO_GERENTE') + '<br>' +
        (correo.cc ? '<b>Copia:</b> ' + escaparHtml_(correo.cc) + '<br>' : '') +
        '<b>Asunto:</b> ' + escaparHtml_(correo.asunto) +
      '</div>';
    var html = HtmlService
      .createHtmlOutput(aviso + cabecera + correo.html)
      .setWidth(900).setHeight(640);
    ui.showModalDialog(html, 'Así lo recibirá el gerente · ' + correo.etiqueta);
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
      lineas.push('Envío automático: instalado (' + CONFIG.ENVIO_ETIQUETA +
                  ', ' + CONFIG.ZONA_HORARIA + ')');
      var p = periodoActual_();
      lineas.push('Próximo informe: ' + etiquetaSemana_(p.anio, p.semana));
    } else {
      lineas.push('Envío automático: ⚠️ NO instalado — el informe no saldrá solo.');
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
  var esAdmin = esAdministrador_();
  var sesion = usuarioActual_();
  var periodo = periodoActual_();

  // Un administrador puede no estar en la hoja "Usuario" (p. ej. alguien de TI);
  // en ese caso igual entra, sólo que sin formulario.
  if (!esAdmin && !sesion.ok) return { ok: false, motivo: sesion.motivo };

  var usuario = sesion.ok ? sesion.usuario : null;
  var base = {
    ok: true,
    rol: esAdmin ? 'administrador' : 'colaborador',
    usuario: {
      nombre: usuario ? usuario.nombre : correoSesion_(),
      correo: usuario ? usuario.correo : correoSesion_(),
      cargo: esAdmin ? 'Administrador' : (usuario ? usuario.cargo : '')
    },
    periodo: {
      anio: periodo.anio,
      semana: periodo.semana,
      etiqueta: etiquetaSemana_(periodo.anio, periodo.semana)
    },
    periodosEditables: ultimosPeriodos_(CONFIG.SEMANAS_EDITABLES)
  };

  if (esAdmin) {
    base.informe = {
      destinatario: correoGerente_() || '',
      copia: correosCopia_() || '',
      iaActiva: iaDisponible_()
    };
  }

  // El formulario se entrega al colaborador, y al administrador sólo si se
  // habilitó CONFIG.ADMIN_TAMBIEN_REPORTA y además está en la hoja "Usuario".
  var mostrarFormulario = usuario && (!esAdmin || CONFIG.ADMIN_TAMBIEN_REPORTA);
  if (mostrarFormulario) {
    var def = ESQUEMA[usuario.area];
    base.usuario.area = usuario.area;
    base.area = {
      nombre: usuario.area,
      icono: def.icono,
      descripcion: def.descripcion,
      campos: def.campos
    };
    base.registro = apiCargarRegistro(periodo.anio, periodo.semana);
  }

  return base;
}

/**
 * Vista previa del correo tal como lo recibirá el gerente.
 *
 * Sólo Administrador. La autorización se resuelve **aquí, en el servidor**:
 * que la interfaz muestre u oculte el botón es cosmético, porque cualquiera
 * puede invocar esta función desde la consola del navegador con
 * `google.script.run`. `exigirAdministrador_()` es la barrera real.
 *
 * Devuelve el mismo objeto que usa el envío (`construirCorreo_`), así que lo
 * que se ve es idéntico a lo que se manda.
 */
function apiPrevisualizarCorreo(anio, semana) {
  exigirAdministrador_();
  var correo = construirCorreo_(Number(anio), Number(semana));
  return {
    ok: true,
    para: correo.para,
    cc: correo.cc,
    asunto: correo.asunto,
    html: correo.html,
    fuente: correo.fuente,
    aviso: correo.aviso,
    etiqueta: correo.etiqueta,
    totalReportes: correo.totalReportes,
    faltantes: correo.faltantes
  };
}

/**
 * Envía el informe gerencial al gerente. Sólo Administrador.
 * Reutiliza exactamente el correo de la vista previa.
 */
function apiEnviarInformeGerencial(anio, semana) {
  exigirAdministrador_();
  return enviarInforme_(Number(anio), Number(semana));
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

  // Se aplana para que el formulario lo consuma directo:
  //   texto       → string
  //   tabla       → [{col: valor}]
  //   imagen      → [{nombre, enlace, comentario?}]  (sin bytes: ya están en Drive)
  //   tablaLibre  → {encabezados, filas}
  var campos = {};
  for (var clave in registro.campos) {
    var c = registro.campos[clave];
    if (c.tipo === 'tabla' || c.tipo === 'imagen') campos[clave] = c.filas;
    else if (c.tipo === 'tablaLibre') campos[clave] = c.tabla;
    else campos[clave] = c.valor;
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
 * NOTA DE SEGURIDAD — dónde vive de verdad el permiso del informe.
 *
 * `apiPrevisualizarCorreo` y `apiEnviarInformeGerencial` existen como endpoints
 * y por tanto son invocables desde el navegador con `google.script.run`, incluso
 * por alguien que no vea el botón. Que la interfaz los muestre sólo al
 * administrador es cosmético.
 *
 * La barrera real es la primera línea de cada una: `exigirAdministrador_()`, que
 * compara el correo de la sesión de Google contra ADMIN_CORREOS. Un colaborador
 * que invoque cualquiera de las dos desde la consola recibe un error y nada más
 * ocurre. Las pruebas verifican exactamente ese escenario.
 *
 * El informe sale por tres caminos, todos autorizados:
 *   1. Automático: disparador `enviarInformeSemanal` (ver CONFIG.ENVIO_*).
 *   2. Interfaz web: panel del administrador.
 *   3. Menú de Google Sheets, también con `exigirAdministrador_()`.
 */
