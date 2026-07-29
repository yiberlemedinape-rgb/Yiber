/**
 * Ia.gs
 * ---------------------------------------------------------------------------
 * Redacción del informe gerencial con la API de Gemini (Google AI).
 *
 * Modelo por defecto: gemini-2.5-flash.
 * Endpoint: POST {API_URL_BASE}{modelo}:generateContent
 *
 * Se activa sólo si existe la propiedad de script GEMINI_API_KEY.
 * Si no existe, falla la red, la API devuelve error, el prompt es bloqueado o
 * la respuesta llega vacía, `construirInforme_` cae automáticamente al redactor
 * determinista de Informe.gs: el correo del jueves nunca se queda sin enviar
 * por una dependencia externa.
 *
 * Configuración (Extensiones → Apps Script → Configuración del proyecto →
 * Propiedades del script):
 *   GEMINI_API_KEY   Clave obtenida en Google AI Studio (aistudio.google.com).
 *   MODELO_IA        Opcional. Por defecto CONFIG.MODELO_IA_POR_DEFECTO.
 * ---------------------------------------------------------------------------
 */

/** Modelo configurado (se admite escribirlo con o sin el prefijo "models/"). */
function modeloIa_() {
  var modelo = texto_(PropertiesService.getScriptProperties()
    .getProperty(CONFIG.PROP_MODELO)) || CONFIG.MODELO_IA_POR_DEFECTO;
  return modelo.replace(/^models\//, '');
}

/** Clave de API configurada (cadena vacía si no hay). */
function apiKey_() {
  return texto_(PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_API_KEY));
}

/** ¿Está habilitada la redacción asistida? */
function iaDisponible_() {
  return apiKey_().length > 0;
}

/** URL completa del endpoint de generación para el modelo configurado. */
function urlGemini_() {
  return CONFIG.API_URL_BASE + modeloIa_() + ':generateContent';
}

/**
 * Serializa el consolidado a un JSON compacto y legible para el modelo:
 * sólo campos con contenido, con los títulos humanos del ESQUEMA.
 */
function datosParaIa_(consolidado) {
  var salida = {
    anio: consolidado.anio,
    semana: consolidado.semana,
    periodo: consolidado.etiqueta,
    areas: {},
    pendientesDeEnvio: consolidado.faltantes.map(function (f) {
      return f.nombre + ' (' + f.area + ')';
    })
  };

  for (var a = 0; a < ORDEN_AREAS.length; a++) {
    var area = ORDEN_AREAS[a];
    var def = ESQUEMA[area];
    var registros = consolidado.areas[area] || [];
    var lista = [];

    for (var r = 0; r < registros.length; r++) {
      var reg = registros[r];
      var item = { colaborador: reg.nombre };
      var tieneAlgo = false;

      for (var c = 0; c < def.campos.length; c++) {
        var campo = def.campos[c];
        var dato = reg.campos[campo.clave];
        if (!dato) continue;

        if (campo.tipo === 'imagen') {
          if (!dato.filas || !dato.filas.length) continue;
          // Los bytes van aparte, como partes de imagen. Aquí sólo queda el
          // aviso de que existen, y el comentario, que sí es texto del área.
          item[campo.titulo] = dato.filas.map(function (f) {
            return f.comentario
              ? 'Imagen adjunta (' + f.nombre + '). Comentario del área: ' + f.comentario
              : 'Imagen adjunta (' + f.nombre + ').';
          });
          tieneAlgo = true;
        } else if (campo.tipo === 'tablaLibre') {
          if (!dato.tabla || !dato.tabla.filas.length) continue;
          item[campo.titulo] = {
            encabezados: dato.tabla.encabezados,
            filas: dato.tabla.filas
          };
          tieneAlgo = true;
        } else if (campo.tipo === 'tabla') {
          if (!dato.filas || !dato.filas.length) continue;
          item[campo.titulo] = dato.filas;
          tieneAlgo = true;
        } else if (dato.valor) {
          item[campo.titulo] = dato.valor;
          tieneAlgo = true;
        }
      }
      if (tieneAlgo) lista.push(item);
    }

    if (lista.length) salida.areas[area] = lista;
  }

  salida.metricas = kpisDeSemana_(consolidado.anio, consolidado.semana);
  return salida;
}

/**
 * Reúne las imágenes adjuntas de la semana para enviarlas a Gemini.
 *
 * Punto importante de arquitectura: **Gemini no puede leer una carpeta de
 * Drive**. `generateContent` sólo acepta bytes en línea (`inline_data`) o URIs
 * de su propia Files API; no tiene conector a Drive. Lo que hacemos es leer los
 * archivos desde Drive con `DriveApp` y adjuntarlos a la petición, con lo que se
 * consigue el mismo objetivo: el modelo interpreta las imágenes al redactar.
 *
 * Cada imagen va precedida de una parte de texto que dice de qué área y de qué
 * indicador es; sin ese rótulo el modelo recibe capturas sin contexto.
 *
 * @return {Object} { partes: [...], incluidas: n, omitidas: [motivos] }
 */
function imagenesParaIa_(consolidado) {
  var partes = [];
  var omitidas = [];
  var incluidas = 0;
  var pesoTotal = 0;
  var maximoBytes = CONFIG.IA_MAX_MB_IMAGENES * 1024 * 1024;

  for (var a = 0; a < ORDEN_AREAS.length; a++) {
    var area = ORDEN_AREAS[a];
    var def = ESQUEMA[area];
    var registros = consolidado.areas[area] || [];

    for (var r = 0; r < registros.length; r++) {
      var reg = registros[r];

      for (var c = 0; c < def.campos.length; c++) {
        var campo = def.campos[c];
        if (campo.tipo !== 'imagen') continue;

        var dato = reg.campos[campo.clave];
        if (!dato || !dato.filas) continue;

        for (var f = 0; f < dato.filas.length; f++) {
          var adjunto = dato.filas[f];
          if (!adjunto.enlace) continue;

          if (incluidas >= CONFIG.IA_MAX_IMAGENES) {
            omitidas.push(adjunto.nombre + ' (se superó el máximo de ' +
                          CONFIG.IA_MAX_IMAGENES + ' imágenes)');
            continue;
          }

          var blob = leerAdjunto_(adjunto.enlace);
          if (!blob) {
            omitidas.push(adjunto.nombre + ' (ya no está en Drive)');
            continue;
          }

          var bytes = blob.getBytes();
          if (pesoTotal + bytes.length > maximoBytes) {
            omitidas.push(adjunto.nombre + ' (se superó el peso máximo de ' +
                          CONFIG.IA_MAX_MB_IMAGENES + ' MB)');
            continue;
          }

          var mime = blob.getContentType() || 'image/png';
          if (CONFIG.ADJUNTO_MIMES_IMAGEN.indexOf(mime) < 0) {
            omitidas.push(adjunto.nombre + ' (tipo no interpretable: ' + mime + ')');
            continue;
          }

          partes.push({ text:
            'Imagen adjunta — área ' + area + ', indicador "' + campo.titulo +
            '", reportada por ' + reg.nombre +
            (adjunto.comentario ? '. Comentario del área: ' + adjunto.comentario : '') +
            '. Lee las cifras de la imagen y úsalas en el informe.' });
          partes.push({ inline_data: { mime_type: mime, data: Utilities.base64Encode(bytes) } });

          pesoTotal += bytes.length;
          incluidas++;
        }
      }
    }
  }

  return { partes: partes, incluidas: incluidas, omitidas: omitidas };
}

/** Mensaje legible para los motivos de bloqueo o corte más comunes. */
function motivoGemini_(codigo) {
  var motivos = {
    SAFETY: 'el contenido fue marcado por los filtros de seguridad',
    RECITATION: 'la respuesta fue bloqueada por recitación',
    PROHIBITED_CONTENT: 'el contenido fue considerado prohibido',
    BLOCKLIST: 'el contenido coincidió con la lista de bloqueo',
    SPII: 'el contenido fue marcado por incluir datos personales sensibles',
    OTHER: 'la API no entregó un motivo específico'
  };
  return motivos[codigo] || codigo;
}

/**
 * Pide al modelo el cuerpo del informe (las cinco secciones obligatorias).
 * @return {Object} { ok, markdown?, motivo? }
 */
function informeConIa_(consolidado) {
  var clave = apiKey_();
  if (!clave) {
    return { ok: false, motivo: 'No hay GEMINI_API_KEY configurada; se usó el informe automático.' };
  }

  var datos = datosParaIa_(consolidado);
  if (!Object.keys(datos.areas).length) {
    return { ok: false, motivo: 'No hay reportes cargados para esta semana.' };
  }

  var imagenes = imagenesParaIa_(consolidado);

  var mensaje =
    'Redacta el informe gerencial de la ' + consolidado.etiqueta + '.\n\n' +
    'Estos son todos los datos reportados por las áreas, en JSON:\n\n' +
    '```json\n' + JSON.stringify(datos, null, 1) + '\n```' +
    (imagenes.incluidas
      ? '\n\nAdemás se adjuntan ' + imagenes.incluidas + ' imagen(es) con ' +
        'indicadores. Cada una viene rotulada con su área y su indicador: ' +
        'extrae de ellas las cifras y trátalas como parte del reporte de esa ' +
        'área, no como material aparte.'
      : '');

  var partes = [{ text: mensaje }].concat(imagenes.partes);

  var cuerpo = {
    systemInstruction: { parts: [{ text: DIRECTRICES_INFORME }] },
    contents: [{ role: 'user', parts: partes }],
    generationConfig: {
      temperature: 0.35,
      topP: 0.95,
      maxOutputTokens: CONFIG.IA_MAX_TOKENS,
      // En los modelos 2.5 los tokens de razonamiento consumen maxOutputTokens.
      // Un presupuesto acotado deja margen suficiente para el informe completo.
      thinkingConfig: { thinkingBudget: CONFIG.IA_PRESUPUESTO_RAZONAMIENTO }
    }
  };

  var respuesta;
  try {
    respuesta = UrlFetchApp.fetch(urlGemini_(), {
      method: 'post',
      contentType: 'application/json',
      // La clave viaja en el encabezado, no en la URL, para que no quede
      // registrada en los logs de ejecución de Apps Script.
      headers: { 'x-goog-api-key': clave },
      payload: JSON.stringify(cuerpo),
      muteHttpExceptions: true
    });
  } catch (e) {
    return { ok: false, motivo: 'No fue posible contactar la API de Gemini: ' + e.message };
  }

  var codigo = respuesta.getResponseCode();
  var texto = respuesta.getContentText();

  var json;
  try {
    json = JSON.parse(texto);
  } catch (e2) {
    return { ok: false, motivo: 'Respuesta de la API de Gemini ilegible (HTTP ' + codigo + ').' };
  }

  if (codigo !== 200) {
    var detalle = (json && json.error && json.error.message)
      ? json.error.message
      : texto.slice(0, 300);
    return { ok: false, motivo: 'La API de Gemini respondió ' + codigo + ': ' + detalle };
  }

  // El prompt completo puede ser bloqueado antes de generar nada.
  if (json.promptFeedback && json.promptFeedback.blockReason) {
    return {
      ok: false,
      motivo: 'Gemini bloqueó la solicitud (' +
              motivoGemini_(json.promptFeedback.blockReason) + '); se usó el informe automático.'
    };
  }

  var candidatos = json.candidates || [];
  if (!candidatos.length) {
    return { ok: false, motivo: 'Gemini no devolvió candidatos; se usó el informe automático.' };
  }

  var candidato = candidatos[0];
  var partes = (candidato.content && candidato.content.parts) ? candidato.content.parts : [];
  var trozos = [];
  for (var i = 0; i < partes.length; i++) {
    // `thought: true` marca resúmenes de razonamiento: no son parte del informe.
    if (partes[i].thought) continue;
    if (partes[i].text) trozos.push(partes[i].text);
  }
  var markdown = trozos.join('\n').trim();

  if (!markdown) {
    var razon = candidato.finishReason || 'sin texto';
    if (razon === 'MAX_TOKENS') {
      razon = 'se agotaron los tokens de salida antes de escribir el informe ' +
              '(revisa CONFIG.IA_MAX_TOKENS o baja el presupuesto de razonamiento)';
    } else {
      razon = motivoGemini_(razon);
    }
    return { ok: false, motivo: 'Gemini no entregó texto: ' + razon + '; se usó el informe automático.' };
  }

  if (candidato.finishReason === 'MAX_TOKENS') {
    markdown += '\n\n_(El análisis se truncó por límite de tokens de salida.)_';
  }

  return {
    ok: true,
    markdown: markdown,
    imagenesLeidas: imagenes.incluidas,
    imagenesOmitidas: imagenes.omitidas
  };
}
