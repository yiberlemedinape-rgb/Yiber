/**
 * Ia.gs
 * ---------------------------------------------------------------------------
 * Redacción del informe gerencial con un modelo de lenguaje (opcional).
 *
 * Se activa sólo si existe la propiedad de script ANTHROPIC_API_KEY.
 * Si no existe, falla la red o el modelo declina la solicitud, `construirInforme`
 * cae automáticamente al redactor determinista de Informe.gs: el correo del
 * jueves nunca se queda sin enviar por una dependencia externa.
 *
 * Configuración (Extensiones → Apps Script → Configuración del proyecto →
 * Propiedades del script):
 *   ANTHROPIC_API_KEY   Clave de la API.
 *   MODELO_IA           Opcional. Por defecto CONFIG.MODELO_IA_POR_DEFECTO.
 * ---------------------------------------------------------------------------
 */

/** Modelo configurado (o el de por defecto). */
function modeloIa_() {
  return PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_MODELO) ||
         CONFIG.MODELO_IA_POR_DEFECTO;
}

/** Clave de API configurada (cadena vacía si no hay). */
function apiKey_() {
  return texto_(PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_API_KEY));
}

/** ¿Está habilitada la redacción asistida? */
function iaDisponible() {
  return apiKey_().length > 0;
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

        if (campo.tipo === 'tabla') {
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

  salida.metricas = kpisDeSemana(consolidado.anio, consolidado.semana);
  return salida;
}

/**
 * Pide al modelo el cuerpo del informe (las cinco secciones obligatorias).
 * @return {Object} { ok, markdown?, motivo? }
 */
function informeConIa_(consolidado) {
  var clave = apiKey_();
  if (!clave) {
    return { ok: false, motivo: 'No hay ANTHROPIC_API_KEY configurada; se usó el informe automático.' };
  }

  var datos = datosParaIa_(consolidado);
  if (!Object.keys(datos.areas).length) {
    return { ok: false, motivo: 'No hay reportes cargados para esta semana.' };
  }

  var mensaje =
    'Redacta el informe gerencial de la ' + consolidado.etiqueta + '.\n\n' +
    'Estos son todos los datos reportados por las áreas, en JSON:\n\n' +
    '```json\n' + JSON.stringify(datos, null, 1) + '\n```';

  var cuerpo = {
    model: modeloIa_(),
    max_tokens: 12000,
    system: DIRECTRICES_INFORME,
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: mensaje }]
  };

  var respuesta;
  try {
    respuesta = UrlFetchApp.fetch(CONFIG.API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': clave,
        'anthropic-version': CONFIG.API_VERSION
      },
      payload: JSON.stringify(cuerpo),
      muteHttpExceptions: true
    });
  } catch (e) {
    return { ok: false, motivo: 'No fue posible contactar la API: ' + e.message };
  }

  var codigo = respuesta.getResponseCode();
  var texto = respuesta.getContentText();

  if (codigo !== 200) {
    return { ok: false, motivo: 'La API respondió ' + codigo + ': ' + texto.slice(0, 300) };
  }

  var json;
  try {
    json = JSON.parse(texto);
  } catch (e2) {
    return { ok: false, motivo: 'Respuesta de la API ilegible.' };
  }

  // El modelo puede declinar la solicitud: se responde 200 con stop_reason "refusal".
  if (json.stop_reason === 'refusal') {
    return { ok: false, motivo: 'El modelo declinó redactar el informe; se usó el informe automático.' };
  }

  var partes = [];
  var bloques = json.content || [];
  for (var i = 0; i < bloques.length; i++) {
    if (bloques[i].type === 'text' && bloques[i].text) partes.push(bloques[i].text);
  }
  var markdown = partes.join('\n').trim();

  if (!markdown) {
    return { ok: false, motivo: 'La API no devolvió texto; se usó el informe automático.' };
  }
  if (json.stop_reason === 'max_tokens') {
    markdown += '\n\n_(El análisis se truncó por límite de tokens.)_';
  }

  return { ok: true, markdown: markdown };
}
