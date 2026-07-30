/**
 * Correo.gs
 * ---------------------------------------------------------------------------
 * Envío automático del informe gerencial y gestión de los disparadores.
 *
 * Regla de negocio: el informe sale **los viernes a las 6:00 a. m.**
 * (zona horaria America/Bogota, definida en appsscript.json). El día y la hora
 * se configuran en CONFIG.ENVIO_DIA / ENVIO_HORA, no aquí.
 *
 * Nota sobre disparadores por tiempo: Apps Script ejecuta el disparador dentro
 * de una ventana de ~15 minutos alrededor de la hora indicada. Para el informe
 * semanal esa precisión es suficiente.
 * ---------------------------------------------------------------------------
 */

var HANDLER_INFORME = 'enviarInformeSemanal';

/* ===================== Destinatarios ===================== */

/** Correo del gerente (propiedad CORREO_GERENTE). */
function correoGerente_() {
  return texto_(PropertiesService.getScriptProperties()
    .getProperty(CONFIG.PROP_CORREO_GERENTE));
}

/** Correos en copia (propiedad CORREO_COPIA, separados por coma). */
function correosCopia_() {
  var crudo = PropertiesService.getScriptProperties()
    .getProperty(CONFIG.PROP_COPIA_INFORME) || '';
  return crudo.split(/[,;\s]+/)
    .map(function (c) { return c.trim(); })
    .filter(function (c) { return c.length > 0; })
    .join(',');
}

/* ===================== Markdown → HTML ===================== */

function escaparHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Aplica negrita, cursiva y código a un fragmento de texto. */
function enlinea_(s) {
  var t = escaparHtml_(s);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/`([^`]+)`/g, '<code style="background:#f1f3f7;padding:1px 4px;border-radius:3px">$1</code>');
  t = t.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s.,;:)])/g, '$1<em>$2</em>');
  return t;
}

/** ¿La línea es el separador de una tabla Markdown ("---|---")? */
function esSeparadorTabla_(linea) {
  return /^\s*\|?[\s:-]*-{2,}[\s:|-]*\|?\s*$/.test(linea) && linea.indexOf('-') >= 0;
}

/** Divide una fila de tabla Markdown en celdas. */
function celdasTabla_(linea) {
  var s = linea.trim().replace(/^\|/, '').replace(/\|$/, '');
  return s.split('|').map(function (c) { return c.trim(); });
}

/**
 * Convierte el Markdown del informe a HTML apto para correo.
 * Soporta encabezados, viñetas, listas numeradas, tablas, reglas y énfasis.
 */
function markdownAHtml_(md) {
  var lineas = String(md).replace(/\r\n/g, '\n').split('\n');
  var html = [];
  var enLista = null;   // 'ul' | 'ol' | null

  function cerrarLista() {
    if (enLista) { html.push('</' + enLista + '>'); enLista = null; }
  }

  for (var i = 0; i < lineas.length; i++) {
    var linea = lineas[i];
    var limpia = linea.trim();

    if (!limpia) { cerrarLista(); continue; }

    // Regla horizontal.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(limpia)) {
      cerrarLista();
      html.push('<hr style="border:0;border-top:1px solid #dfe3ea;margin:22px 0">');
      continue;
    }

    // Bloques de código: se ignoran las cercas, se mantiene el contenido.
    if (/^```/.test(limpia)) { cerrarLista(); continue; }

    // Encabezados.
    var enc = limpia.match(/^(#{1,4})\s+(.*)$/);
    if (enc) {
      cerrarLista();
      var nivel = enc[1].length;
      var estilos = {
        1: 'font-size:20px;color:#1f3864;margin:0 0 4px;font-weight:700',
        2: 'font-size:16px;color:#1f3864;margin:26px 0 10px;font-weight:700;' +
           'border-bottom:2px solid #e6eaf2;padding-bottom:6px',
        3: 'font-size:14px;color:#33415c;margin:18px 0 8px;font-weight:700',
        4: 'font-size:13px;color:#33415c;margin:14px 0 6px;font-weight:700'
      };
      html.push('<h' + nivel + ' style="' + estilos[nivel] + '">' +
                enlinea_(enc[2]) + '</h' + nivel + '>');
      continue;
    }

    // Tabla Markdown.
    if (limpia.indexOf('|') >= 0 && i + 1 < lineas.length && esSeparadorTabla_(lineas[i + 1])) {
      cerrarLista();
      var encabezados = celdasTabla_(limpia);
      var filas = [];
      i += 2;
      while (i < lineas.length && lineas[i].indexOf('|') >= 0 && lineas[i].trim()) {
        filas.push(celdasTabla_(lineas[i]));
        i++;
      }
      i--;
      var t = ['<table style="border-collapse:collapse;width:100%;margin:10px 0;font-size:13px">'];
      t.push('<tr>');
      for (var h = 0; h < encabezados.length; h++) {
        t.push('<th style="text-align:left;background:#eef1f7;color:#1f3864;padding:7px 9px;' +
               'border:1px solid #dfe3ea">' + enlinea_(encabezados[h]) + '</th>');
      }
      t.push('</tr>');
      for (var r = 0; r < filas.length; r++) {
        t.push('<tr>');
        for (var c = 0; c < filas[r].length; c++) {
          t.push('<td style="padding:7px 9px;border:1px solid #dfe3ea;vertical-align:top">' +
                 enlinea_(filas[r][c]) + '</td>');
        }
        t.push('</tr>');
      }
      t.push('</table>');
      html.push(t.join(''));
      continue;
    }

    // Viñetas y listas numeradas.
    var vinieta = limpia.match(/^[-*•]\s+(.*)$/);
    var numerada = limpia.match(/^\d+[.)]\s+(.*)$/);
    if (vinieta || numerada) {
      var tipo = vinieta ? 'ul' : 'ol';
      if (enLista !== tipo) {
        cerrarLista();
        html.push('<' + tipo + ' style="margin:6px 0 12px;padding-left:22px;' +
                  'font-size:14px;line-height:1.6;color:#22262e">');
        enLista = tipo;
      }
      html.push('<li style="margin:3px 0">' +
                enlinea_((vinieta ? vinieta[1] : numerada[1])) + '</li>');
      continue;
    }

    // Continuación de una viñeta ("↳ …" indentado).
    if (enLista && /^\s{2,}/.test(linea)) {
      html.push('<div style="font-size:12.5px;color:#5c6472;margin:0 0 4px 22px">' +
                enlinea_(limpia) + '</div>');
      continue;
    }

    cerrarLista();
    html.push('<p style="margin:0 0 12px;font-size:14px;line-height:1.65;color:#22262e">' +
              enlinea_(limpia) + '</p>');
  }
  cerrarLista();
  return html.join('\n');
}

/** Envuelve el HTML del informe en una plantilla de correo. */
function plantillaCorreo_(cuerpoHtml, etiqueta) {
  return '' +
    '<div style="background:#f4f6fa;padding:24px 0;font-family:Segoe UI,Arial,Helvetica,sans-serif">' +
      '<div style="max-width:760px;margin:0 auto;background:#ffffff;border-radius:10px;' +
                  'overflow:hidden;border:1px solid #e2e6ee">' +
        '<div style="background:#1f3864;padding:20px 28px">' +
          '<div style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.3px">' +
            'KAESER COMPRESORES</div>' +
          '<div style="color:#b9c6de;font-size:13px;margin-top:3px">' +
            'Informe Gerencial Semanal · ' + escaparHtml_(etiqueta) + '</div>' +
        '</div>' +
        '<div style="padding:26px 28px">' + cuerpoHtml + '</div>' +
        '<div style="background:#f7f9fc;padding:14px 28px;border-top:1px solid #e2e6ee;' +
                    'color:#7b8494;font-size:11.5px">' +
          'Generado automáticamente desde la base de datos de Informes Semanales ' +
          '(Google Sheets + Apps Script). No responder a este correo.' +
        '</div>' +
      '</div>' +
    '</div>';
}

/* ===================== Construcción y envío ===================== */

/**
 * Arma el correo completo de una semana SIN enviarlo.
 *
 * Es el único lugar donde se construye el mensaje, y tanto la vista previa como
 * el envío real lo usan. Esa es la razón de que exista: garantiza que **lo que
 * el administrador ve en la vista previa es idéntico, carácter por carácter, a
 * lo que recibirá el gerente**. Si la vista previa se armara por su cuenta,
 * podría divergir del correo sin que nadie lo notara.
 *
 * @return {Object} { para, cc, asunto, html, texto, fuente, aviso, etiqueta, ... }
 */
function construirCorreo_(anio, semana) {
  var informe = construirInforme_(anio, semana, true);
  var etiqueta = informe.consolidado.etiqueta;

  return {
    para: correoGerente_(),
    cc: correosCopia_(),
    asunto: CONFIG.ASUNTO_INFORME + ' — ' + etiqueta,
    html: plantillaCorreo_(markdownAHtml_(informe.markdown), etiqueta),
    texto: informe.markdown,
    fuente: informe.fuente,
    aviso: informe.aviso,
    cifrasSinRespaldo: informe.cifrasSinRespaldo || [],
    etiqueta: etiqueta,
    totalReportes: informe.consolidado.totalReportes,
    faltantes: informe.consolidado.faltantes
  };
}

/**
 * Construye y envía el informe de una semana concreta.
 * @return {Object} { ok, mensaje, fuente }
 */
function enviarInforme_(anio, semana) {
  var correo = construirCorreo_(anio, semana);

  if (!correo.para) {
    throw new Error('Falta la propiedad de script "' + CONFIG.PROP_CORREO_GERENTE +
                    '" con el correo del gerente.');
  }

  var opciones = {
    to: correo.para,
    subject: correo.asunto,
    body: correo.texto,
    htmlBody: correo.html,
    name: 'Informes Semanales Kaeser'
  };
  if (correo.cc) opciones.cc = correo.cc;

  MailApp.sendEmail(opciones);

  return {
    ok: true,
    fuente: correo.fuente,
    mensaje: 'Informe de la ' + correo.etiqueta + ' enviado a ' + correo.para +
             (correo.cc ? ' (copia: ' + correo.cc + ')' : '') + '.'
  };
}

/**
 * Punto de entrada del disparador semanal (viernes 6:00 a. m.).
 *
 * Envía siempre la semana ISO en curso. El viernes pertenece a la misma semana
 * ISO que se está reportando (lunes a domingo), así que el informe cubre la
 * semana que acaba de cerrar, igual que cuando salía el jueves.
 */
function enviarInformeSemanal() {
  var periodo = periodoActual_();
  try {
    var r = enviarInforme_(periodo.anio, periodo.semana);
    console.log(r.mensaje + ' Fuente: ' + r.fuente + '.');
  } catch (e) {
    console.error('Fallo el envío automático: ' + e.message);
    // Mismo criterio que el permiso: quienes tengan el cargo de Administrador
    // en la hoja "Usuario". Si no hay ninguno, el motivo queda en el registro de
    // ejecuciones, que es donde el menú de verificación dice ir a mirarlo.
    var admins = correosAdmin_();
    if (admins.length) {
      MailApp.sendEmail(admins.join(','),
        '⚠️ Falló el envío del informe gerencial',
        'No se pudo enviar el informe de la semana ' + periodo.semana + ' de ' +
        periodo.anio + '.\n\nDetalle: ' + e.message);
    }
    throw e;
  }
}

/* ===================== Disparadores ===================== */

/** Elimina los disparadores existentes del envío semanal. */
function eliminarDisparadores_() {
  var triggers = ScriptApp.getProjectTriggers();
  var borrados = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === HANDLER_INFORME) {
      ScriptApp.deleteTrigger(triggers[i]);
      borrados++;
    }
  }
  return borrados;
}

/**
 * Instala (idempotente) el disparador semanal según CONFIG.ENVIO_DIA / HORA.
 * La hora se interpreta en la zona horaria del proyecto (America/Bogota).
 */
function instalarDisparadores_() {
  var dia = ScriptApp.WeekDay[CONFIG.ENVIO_DIA];
  if (!dia) {
    throw new Error('CONFIG.ENVIO_DIA no es un día válido: "' + CONFIG.ENVIO_DIA +
                    '". Usa MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, ' +
                    'SATURDAY o SUNDAY.');
  }

  eliminarDisparadores_();
  ScriptApp.newTrigger(HANDLER_INFORME)
    .timeBased()
    .onWeekDay(dia)
    .atHour(CONFIG.ENVIO_HORA)
    .nearMinute(0)
    .inTimezone(CONFIG.ZONA_HORARIA)
    .create();
  return 'Disparador instalado: ' + CONFIG.ENVIO_ETIQUETA +
         ' (' + CONFIG.ZONA_HORARIA + ').';
}
