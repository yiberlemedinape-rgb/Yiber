/**
 * Adjuntos.gs
 * ---------------------------------------------------------------------------
 * Almacenamiento de imágenes y tablas adjuntas en Google Drive.
 *
 * Estructura que se crea sola en la carpeta raíz configurada:
 *
 *   <carpeta raíz>/
 *     2026/
 *       Semana 31 (27 jul – 02 ago)/
 *         Gestión Comercial/
 *           S31 - Órdenes Relevantes - Carlos Arbeláez.png
 *         Soporte Técnico/
 *           S31 - First Time Fix Rate (FTF) - Edilfonso Vaca.png
 *
 * En la hoja de cálculo NO se guarda el archivo: se guarda su nombre y su
 * enlace, de modo que la celda sigue siendo legible y auditable, y el informe
 * puede recuperar los bytes cuando los necesita.
 *
 * Requiere el permiso de Drive declarado en appsscript.json.
 * ---------------------------------------------------------------------------
 */

/** Carpeta raíz configurada (propiedad CARPETA_DRIVE o la de CONFIG). */
function carpetaRaiz_() {
  var id = texto_(PropertiesService.getScriptProperties()
    .getProperty(CONFIG.PROP_CARPETA_DRIVE)) || CONFIG.DRIVE_CARPETA_RAIZ;
  try {
    return DriveApp.getFolderById(id);
  } catch (e) {
    throw new Error(
      'No fue posible abrir la carpeta de Drive "' + id + '". Verifica que el ' +
      'ID sea correcto y que la cuenta que ejecuta el script tenga permiso de ' +
      'edición sobre ella. Se configura en la propiedad de script "' +
      CONFIG.PROP_CARPETA_DRIVE + '".');
  }
}

/** Devuelve la subcarpeta con ese nombre, creándola si no existe. */
function subcarpeta_(padre, nombre) {
  var existentes = padre.getFoldersByName(nombre);
  return existentes.hasNext() ? existentes.next() : padre.createFolder(nombre);
}

/** Nombre de la carpeta de una semana: "Semana 31 (27 jul – 02 ago)". */
function nombreCarpetaSemana_(anio, semana) {
  var r = rangoSemana_(anio, semana);
  var f = function (d) {
    return Utilities.formatDate(d, CONFIG.ZONA_HORARIA, 'dd MMM')
      .replace('.', '').toLowerCase();
  };
  return 'Semana ' + ('0' + semana).slice(-2) + ' (' + f(r.inicio) + ' – ' + f(r.fin) + ')';
}

/**
 * Carpeta de un área para una semana, creando el árbol si hace falta.
 * Se serializa con un candado porque dos personas guardando a la vez podrían
 * crear dos carpetas con el mismo nombre.
 */
function carpetaDeArea_(anio, semana, area) {
  var candado = LockService.getScriptLock();
  candado.waitLock(20000);
  try {
    var anual = subcarpeta_(carpetaRaiz_(), String(anio));
    var semanal = subcarpeta_(anual, nombreCarpetaSemana_(anio, semana));
    return subcarpeta_(semanal, area);
  } finally {
    candado.releaseLock();
  }
}

/** Extensión sugerida a partir del tipo MIME. */
function extensionDe_(mime, nombreOriginal) {
  var punto = String(nombreOriginal || '').lastIndexOf('.');
  if (punto > 0) return String(nombreOriginal).slice(punto);
  var mapa = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
    'image/heic': '.heic', 'image/heif': '.heif',
    'text/csv': '.csv', 'text/plain': '.txt'
  };
  return mapa[mime] || '';
}

/** Limpia un texto para usarlo como nombre de archivo. */
function nombreSeguro_(texto) {
  return texto_(texto).replace(/[\\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

/**
 * Guarda un archivo en la carpeta de la semana y devuelve su referencia.
 *
 * @param {Object} ctx    { anio, semana, area, colaborador, campo }
 * @param {Object} archivo { nombre, mime, base64 }
 * @return {Object}       { nombre, id, enlace }
 */
function guardarAdjunto_(ctx, archivo) {
  var base64 = texto_(archivo.base64);
  if (!base64) throw new Error('El archivo "' + archivo.nombre + '" llegó vacío.');

  // 4 caracteres de base64 codifican 3 bytes.
  var bytesAprox = Math.floor(base64.length * 3 / 4);
  var maximo = CONFIG.ADJUNTO_MAX_MB * 1024 * 1024;
  if (bytesAprox > maximo) {
    throw new Error('El archivo "' + archivo.nombre + '" pesa ' +
                    (bytesAprox / 1048576).toFixed(1) + ' MB y el máximo es ' +
                    CONFIG.ADJUNTO_MAX_MB + ' MB.');
  }

  var mime = texto_(archivo.mime) || 'application/octet-stream';
  var nombre = 'S' + ('0' + ctx.semana).slice(-2) + ' - ' +
               nombreSeguro_(ctx.campo) + ' - ' + nombreSeguro_(ctx.colaborador) +
               extensionDe_(mime, archivo.nombre);

  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, nombre);
  var carpeta = carpetaDeArea_(ctx.anio, ctx.semana, ctx.area);

  // Si ya existe un archivo con el mismo nombre (mismo campo, misma persona,
  // misma semana) se elimina primero: reenviar el reporte reemplaza la imagen
  // en vez de acumular duplicados.
  var previos = carpeta.getFilesByName(nombre);
  while (previos.hasNext()) previos.next().setTrashed(true);

  var creado = carpeta.createFile(blob);
  return {
    nombre: creado.getName(),
    id: creado.getId(),
    enlace: 'https://drive.google.com/file/d/' + creado.getId() + '/view'
  };
}

/**
 * Convierte lo que envía el formulario en las filas que se guardan en la celda.
 *
 * Cada entrada trae `base64` si es un archivo nuevo (recién pegado o subido), o
 * sólo `enlace` si ya estaba guardado de un envío anterior. Sólo se sube a
 * Drive lo nuevo: reenviar el reporte no vuelve a subir lo que ya estaba.
 *
 * @param {Object} ctx      { anio, semana, area, colaborador }
 * @param {Object} campo    Definición del campo en el ESQUEMA.
 * @param {Array}  entradas [{ nombre, mime, base64?, enlace?, comentario? }]
 * @return {Array}          [{ nombre, enlace, comentario? }]
 */
function procesarAdjuntos_(ctx, campo, entradas) {
  var salida = [];
  var lista = entradas || [];

  for (var i = 0; i < lista.length; i++) {
    var entrada = lista[i] || {};
    var fila;

    if (texto_(entrada.base64)) {
      var guardado = guardarAdjunto_({
        anio: ctx.anio, semana: ctx.semana, area: ctx.area,
        colaborador: ctx.colaborador,
        // Con varios archivos en el mismo campo se numeran para no pisarse.
        campo: campo.titulo + (lista.length > 1 ? ' ' + (i + 1) : '')
      }, entrada);
      fila = { nombre: guardado.nombre, enlace: guardado.enlace };
    } else if (texto_(entrada.enlace)) {
      fila = { nombre: texto_(entrada.nombre), enlace: texto_(entrada.enlace) };
    } else if (campo.comentario && texto_(entrada.comentario)) {
      // El área puede escribir su análisis antes de tener la captura; el
      // comentario no se pierde por no haber adjuntado todavía la imagen.
      fila = { nombre: '(sin imagen)', enlace: '' };
    } else {
      continue;   // entrada sin archivo, sin referencia y sin comentario
    }

    if (campo.comentario) fila.comentario = texto_(entrada.comentario);
    salida.push(fila);
  }
  return salida;
}

/** Extrae el ID de Drive de un enlace guardado en la hoja. */
function idDesdeEnlace_(enlace) {
  var m = String(enlace || '').match(/[-\w]{25,}/);
  return m ? m[0] : '';
}

/**
 * Recupera un adjunto como blob. Devuelve null si el archivo ya no existe
 * (alguien pudo borrarlo en Drive después de reportarlo).
 */
function leerAdjunto_(enlaceOId) {
  var id = idDesdeEnlace_(enlaceOId) || texto_(enlaceOId);
  if (!id) return null;
  try {
    return DriveApp.getFileById(id).getBlob();
  } catch (e) {
    return null;
  }
}

/** URL de la carpeta de una semana, para enlazarla desde el informe. */
function urlCarpetaSemana_(anio, semana) {
  try {
    var anual = subcarpeta_(carpetaRaiz_(), String(anio));
    var semanal = subcarpeta_(anual, nombreCarpetaSemana_(anio, semana));
    return semanal.getUrl();
  } catch (e) {
    return '';
  }
}
