/**
 * Datos.gs
 * ---------------------------------------------------------------------------
 * Lectura y escritura de los formularios sobre Google Sheets.
 *
 * Decisión de diseño — cómo se guarda una "tabla" en una sola celda:
 * la hoja la leen personas (gerencia, auditoría), así que NO se guarda JSON.
 * Se guarda un bloque de texto legible con la primera línea de encabezados:
 *
 *     Proceso | Solicitudes | Reprocesos | Efectividad %
 *     Ofertas puntuales | 120 | 5 | 95,8
 *     Convenios | 40 | 1 | 97,5
 *
 * El separador de columnas es " | " y el de filas el salto de línea. Al
 * guardar se escapan esos dos caracteres dentro de los valores del usuario
 * ("|" → "/", saltos → " · ") para que el parseo de vuelta sea determinista.
 *
 * La clave lógica de un registro es (Año, N° de Semana, Nombre): guardar dos
 * veces la misma semana actualiza la fila, no la duplica.
 * ---------------------------------------------------------------------------
 */

/** Índice de columna (1-based) a partir de la letra declarada en el ESQUEMA. */
function indiceColumna_(letra) {
  var n = 0;
  var s = String(letra).toUpperCase();
  for (var i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return n;
}

/** Letra de columna a partir del índice (1 → A, 27 → AA). Inversa de la anterior. */
function letraColumna_(indice) {
  var n = Number(indice);
  var letra = '';
  while (n > 0) {
    var resto = (n - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    n = Math.floor((n - 1) / 26);
  }
  return letra;
}

/**
 * Devuelve la definición del área o lanza un error accionable.
 *
 * El mensaje distingue los tres casos que se dan en la práctica, porque cada
 * uno se corrige en un lugar distinto:
 *   - Sin argumento: alguien ejecutó una función interna desde el editor.
 *   - Cargo sin traducir: falta un alias en ALIAS_CARGOS.
 *   - Nombre mal escrito: no coincide con ninguna clave del ESQUEMA.
 */
function areaOError_(area) {
  var def = ESQUEMA[area];
  if (def) return def;

  if (area === undefined || area === null || area === '') {
    throw new Error(
      'Se llamó a una función interna sin indicar el área. Esto ocurre al ' +
      'ejecutar una función del proyecto directamente desde el editor de Apps ' +
      'Script: esas funciones esperan argumentos que el editor no puede pasar. ' +
      'Usa el menú "📊 Informes Semanales" de la hoja de cálculo o la interfaz ' +
      'web, que son los puntos de entrada reales.');
  }

  throw new Error(
    'Área desconocida: "' + area + '". Las áreas válidas son: ' +
    ORDEN_AREAS.join(', ') + '. Si es el cargo de alguien en la hoja "' +
    CONFIG.HOJA_USUARIOS + '", agrégalo a ALIAS_CARGOS en Config.gs.');
}

/**
 * Busca una hoja tolerando diferencias de tildes, mayúsculas y espacios.
 *
 * `getSheetByName` distingue "Soporte Técnico" de "Soporte Tecnico". Sin esta
 * tolerancia, una tilde de menos en la pestaña hacía que el sistema no
 * encontrara la hoja y creara **otra al lado**, vacía y con sus propios
 * encabezados: exactamente el síntoma de "está generando columnas incorrectas".
 *
 * @return {Sheet|null}
 */
function hojaPorNombre_(nombre) {
  var libro = libro_();
  var directa = libro.getSheetByName(nombre);
  if (directa) return directa;

  var objetivo = normalizar_(nombre);
  var hojas = libro.getSheets();
  for (var i = 0; i < hojas.length; i++) {
    if (normalizar_(hojas[i].getName()) === objetivo) return hojas[i];
  }
  return null;
}

/** Hoja del área (la crea con encabezados si no existe). */
function hojaDeArea_(area) {
  var def = areaOError_(area);
  var hoja = hojaPorNombre_(def.hoja);
  if (!hoja) hoja = crearHojaArea_(area);
  return hoja;
}

/** Texto de encabezado sin la aclaración entre paréntesis. */
function cabeceraBase_(texto) {
  var corte = String(texto || '').indexOf('(');
  return normalizar_(corte > 0 ? String(texto).slice(0, corte) : texto);
}

/**
 * Resuelve en qué columna real de la hoja vive cada campo del área.
 *
 * ESTE ES EL MAPEO QUE MANDA. Antes, cada campo se leía y se escribía en la
 * letra fija declarada en el ESQUEMA (`campo.col`), sin mirar los encabezados
 * reales. Bastaba con que alguien insertara, moviera o renombrara una columna en
 * Sheets para que todos los datos cayeran desplazados una posición: se escribía
 * el análisis de fallas bajo "Centro de Monitoreo" y nadie se enteraba.
 *
 * Ahora se busca cada campo por su encabezado, en tres pasadas de más estricta a
 * más tolerante:
 *   1. El `encabezado` exacto del ESQUEMA.
 *   2. Cualquiera de sus `encabezadosAlternos` (nombres anteriores, para que
 *      renombrar un campo en el código no rompa las hojas ya en uso).
 *   3. El texto sin la aclaración entre paréntesis, que es lo que la gente suele
 *      dejar escrito en la hoja.
 *
 * `campo.col` queda sólo como respaldo para cuando el encabezado no aparece —
 * hoja recién creada, o columna que todavía nadie ha añadido.
 *
 * @return {Object} { indices: {clave: col1Based}, porDefecto: [campos], ancho }
 */
function mapaColumnas_(hoja, area) {
  var def = areaOError_(area);
  var ultima = hoja.getLastColumn();
  var cabecera = ultima > 0 ? hoja.getRange(1, 1, 1, ultima).getValues()[0] : [];

  var exactos = {};
  var bases = {};
  for (var c = 0; c < cabecera.length; c++) {
    var texto = normalizar_(cabecera[c]);
    if (!texto) continue;
    // El primero gana: si alguien duplicó un encabezado, manda el de la
    // izquierda, que es el que se ve primero en la hoja.
    if (exactos[texto] === undefined) exactos[texto] = c + 1;
    var base = cabeceraBase_(cabecera[c]);
    if (base && bases[base] === undefined) bases[base] = c + 1;
  }

  var mapa = { indices: {}, porDefecto: [], ancho: Math.max(3, ultima) };

  for (var i = 0; i < def.campos.length; i++) {
    var campo = def.campos[i];
    var col = columnaDeCampo_(campo, exactos, bases);

    if (!col) {
      col = indiceColumna_(campo.col);
      mapa.porDefecto.push(campo);
    }

    mapa.indices[campo.clave] = col;
    mapa.ancho = Math.max(mapa.ancho, col);
  }

  return mapa;
}

/**
 * Columna (1-based) donde vive un campo según los encabezados de la hoja.
 * Devuelve 0 si ninguno de sus nombres aparece.
 *
 * Es una función aparte a propósito. En Apps Script (ES5) `var` es de ámbito de
 * función, no de bloque: escrito dentro del bucle de `mapaColumnas_`, el
 * resultado de un campo sobrevivía a la siguiente vuelta y todos los campos
 * acababan apuntando a la columna del primero. Aislarlo hace imposible ese error.
 */
function columnaDeCampo_(campo, exactos, bases) {
  var candidatos = [campo.encabezado || campo.titulo, campo.titulo]
    .concat(campo.encabezadosAlternos || []);

  for (var i = 0; i < candidatos.length; i++) {
    var exacta = exactos[normalizar_(candidatos[i])];
    if (exacta) return exacta;
  }
  for (var j = 0; j < candidatos.length; j++) {
    var aproximada = bases[cabeceraBase_(candidatos[j])];
    if (aproximada) return aproximada;
  }
  return 0;
}

/* ===================== Serialización de tablas ===================== */

/** Limpia un valor para que no rompa los separadores del bloque de texto. */
function escaparCelda_(valor) {
  return texto_(valor)
    .replace(/\|/g, '/')
    .replace(/[\r\n]+/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Columnas efectivas de un campo tabular.
 *
 * Los campos `imagen` se guardan con la misma maquinaria que las tablas, sólo
 * que con columnas fijas. Así el adjunto queda legible en la hoja (nombre y
 * enlace en texto plano) y no hace falta un segundo formato de serialización.
 */
function columnasDe_(campo) {
  if (campo.tipo !== 'imagen') return campo.columnas;
  var cols = [
    { clave: 'nombre', titulo: 'Archivo' },
    { clave: 'enlace', titulo: 'Enlace' }
  ];
  if (campo.comentario) cols.push({ clave: 'comentario', titulo: 'Comentario' });
  return cols;
}

/** Encabezado del bloque: "Proceso | Solicitudes | ...". */
function encabezadoTabla_(campo) {
  return columnasDe_(campo).map(function (c) { return c.titulo; }).join(CONFIG.SEP_COL);
}

/** Convierte [{clave: valor}] en el bloque de texto que se guarda en la celda. */
function serializarTabla_(campo, filas) {
  if (!filas || !filas.length) return '';

  var lineas = [];
  for (var i = 0; i < filas.length; i++) {
    var fila = filas[i] || {};
    var celdas = columnasDe_(campo).map(function (c) { return escaparCelda_(fila[c.clave]); });
    // Se descartan las filas totalmente vacías que deja la interfaz.
    if (celdas.join('').length === 0) continue;
    lineas.push(celdas.join(CONFIG.SEP_COL));
  }
  if (!lineas.length) return '';

  return encabezadoTabla_(campo) + CONFIG.SEP_FILA + lineas.join(CONFIG.SEP_FILA);
}

/** Convierte el bloque de texto de una celda de vuelta a [{clave: valor}]. */
function parseTabla_(campo, valor) {
  var crudo = texto_(valor);
  if (!crudo) return [];

  var lineas = crudo.split(/\r?\n/)
    .map(function (l) { return l.trim(); })
    .filter(function (l) { return l.length > 0; });
  if (!lineas.length) return [];

  // Se ignora la primera línea si es el encabezado que escribió el sistema.
  var encabezado = normalizar_(encabezadoTabla_(campo));
  if (normalizar_(lineas[0]) === encabezado) lineas.shift();

  var columnas = columnasDe_(campo);
  var filas = [];
  for (var i = 0; i < lineas.length; i++) {
    var celdas = lineas[i].split('|').map(function (c) { return c.trim(); });
    var fila = {};
    var vacia = true;
    for (var j = 0; j < columnas.length; j++) {
      var v = celdas[j] === undefined ? '' : celdas[j];
      fila[columnas[j].clave] = v;
      if (v) vacia = false;
    }
    if (!vacia) filas.push(fila);
  }
  return filas;
}

/* ---------- Tablas de estructura libre (pegadas desde Excel) ---------- */

/**
 * Serializa una tabla cuyas columnas las define el usuario al pegar desde
 * Excel. A diferencia de `tabla`, aquí los encabezados son datos: se guardan
 * como primera línea del bloque, tal como venían en la hoja de cálculo origen.
 *
 * @param {Object} datos { encabezados: [...], filas: [[...], ...] }
 */
function serializarTablaLibre_(datos) {
  if (!datos) return '';
  var encabezados = (datos.encabezados || []).map(escaparCelda_);
  var filas = datos.filas || [];

  var lineas = [];
  if (encabezados.join('').length) lineas.push(encabezados.join(CONFIG.SEP_COL));
  for (var i = 0; i < filas.length; i++) {
    var celdas = (filas[i] || []).map(escaparCelda_);
    if (celdas.join('').length === 0) continue;
    lineas.push(celdas.join(CONFIG.SEP_COL));
  }
  return lineas.length > (encabezados.join('').length ? 1 : 0) ? lineas.join(CONFIG.SEP_FILA) : '';
}

/** Reconstruye { encabezados, filas } desde el bloque guardado. */
function parseTablaLibre_(valor) {
  var crudo = texto_(valor);
  if (!crudo) return { encabezados: [], filas: [] };

  var lineas = crudo.split(/\r?\n/)
    .map(function (l) { return l.trim(); })
    .filter(function (l) { return l.length > 0; });
  if (!lineas.length) return { encabezados: [], filas: [] };

  var corta = function (l) { return l.split('|').map(function (c) { return c.trim(); }); };
  return {
    encabezados: corta(lineas[0]),
    filas: lineas.slice(1).map(corta)
  };
}

/* ===================== Lectura ===================== */

/**
 * Convierte una fila de la hoja en un registro estructurado.
 * `fila` es el array de valores completo de la fila (0-based por columna).
 */
function filaARegistro_(area, fila, mapa) {
  var def = areaOError_(area);
  var registro = {
    area: area,
    anio: aNumero_(fila[0]),
    semana: aNumero_(fila[1]),
    nombre: texto_(fila[2]),
    campos: {}
  };

  for (var i = 0; i < def.campos.length; i++) {
    var campo = def.campos[i];
    var valor = fila[mapa.indices[campo.clave] - 1];
    if (campo.tipo === 'tabla' || campo.tipo === 'imagen') {
      registro.campos[campo.clave] = { tipo: campo.tipo, filas: parseTabla_(campo, valor) };
    } else if (campo.tipo === 'tablaLibre') {
      registro.campos[campo.clave] = { tipo: 'tablaLibre', tabla: parseTablaLibre_(valor) };
    } else {
      registro.campos[campo.clave] = { tipo: 'texto', valor: texto_(valor) };
    }
  }
  return registro;
}

/** Última columna usada por el área (según el ESQUEMA). */
function anchoArea_(area) {
  var def = areaOError_(area);
  var max = 3;
  for (var i = 0; i < def.campos.length; i++) {
    max = Math.max(max, indiceColumna_(def.campos[i].col));
  }
  return max;
}

/** Busca la fila (1-based) de un registro. Devuelve -1 si no existe. */
function buscarFila_(hoja, anio, semana, nombre) {
  var ultima = hoja.getLastRow();
  if (ultima < 2) return -1;

  var claves = hoja.getRange(2, 1, ultima - 1, 3).getValues();
  var objetivo = normalizar_(nombre);

  for (var i = 0; i < claves.length; i++) {
    if (aNumero_(claves[i][0]) === Number(anio) &&
        aNumero_(claves[i][1]) === Number(semana) &&
        normalizar_(claves[i][2]) === objetivo) {
      return i + 2;
    }
  }
  return -1;
}

/** Registro de un colaborador para una semana. Devuelve null si no existe. */
function leerRegistro_(area, anio, semana, nombre) {
  var hoja = hojaDeArea_(area);
  var fila = buscarFila_(hoja, anio, semana, nombre);
  if (fila < 0) return null;

  var mapa = mapaColumnas_(hoja, area);
  var valores = hoja.getRange(fila, 1, 1, mapa.ancho).getValues()[0];
  return filaARegistro_(area, valores, mapa);
}

/** Todos los registros de un área para una semana. */
function leerSemanaArea_(area, anio, semana) {
  var hoja = hojaPorNombre_(areaOError_(area).hoja);
  if (!hoja) return [];

  var ultima = hoja.getLastRow();
  if (ultima < 2) return [];

  var mapa = mapaColumnas_(hoja, area);
  var valores = hoja.getRange(2, 1, ultima - 1, mapa.ancho).getValues();
  var salida = [];

  for (var i = 0; i < valores.length; i++) {
    if (aNumero_(valores[i][0]) === Number(anio) &&
        aNumero_(valores[i][1]) === Number(semana)) {
      salida.push(filaARegistro_(area, valores[i], mapa));
    }
  }
  return salida;
}

/* ===================== Escritura ===================== */

/**
 * Guarda (inserta o actualiza) el reporte de un colaborador.
 *
 * @param {string} area    Nombre del área en ESQUEMA.
 * @param {Object} datos   { anio, semana, nombre, campos: {clave: valor|filas} }
 * @return {Object}        { fila, creado }
 */
function guardarRegistro_(area, datos) {
  var def = areaOError_(area);
  var hoja = hojaDeArea_(area);

  var anio = Number(datos.anio);
  var semana = Number(datos.semana);
  var nombre = texto_(datos.nombre);

  if (!anio || !semana || !nombre) {
    throw new Error('Faltan Año, N° de Semana o Nombre del Colaborador.');
  }

  var mapa = mapaColumnas_(hoja, area);
  var ancho = mapa.ancho;
  var fila = new Array(ancho);
  for (var k = 0; k < ancho; k++) fila[k] = '';

  fila[0] = anio;
  fila[1] = semana;
  fila[2] = nombre;

  var contexto = { anio: anio, semana: semana, area: area, colaborador: nombre };

  for (var i = 0; i < def.campos.length; i++) {
    var campo = def.campos[i];
    var entrada = datos.campos ? datos.campos[campo.clave] : null;
    var idx = mapa.indices[campo.clave] - 1;

    if (campo.tipo === 'imagen') {
      // Sube a Drive lo que sea nuevo y deja en la celda nombre + enlace.
      fila[idx] = serializarTabla_(campo, procesarAdjuntos_(contexto, campo, entrada || []));
    } else if (campo.tipo === 'tabla') {
      fila[idx] = serializarTabla_(campo, entrada || []);
    } else if (campo.tipo === 'tablaLibre') {
      fila[idx] = serializarTablaLibre_(entrada);
    } else {
      fila[idx] = texto_(entrada);
    }
  }

  // El candado evita que dos personas del mismo área se pisen la fila.
  var candado = LockService.getDocumentLock();
  candado.waitLock(20000);
  var resultado;
  try {
    var existente = buscarFila_(hoja, anio, semana, nombre);
    if (existente > 0) {
      hoja.getRange(existente, 1, 1, ancho).setValues([fila]);
      resultado = { fila: existente, creado: false };
    } else {
      hoja.appendRow(fila);
      resultado = { fila: hoja.getLastRow(), creado: true };
    }
  } finally {
    candado.releaseLock();
  }

  registrarKpis_(area, anio, semana, nombre, datos);
  return resultado;
}

/* ===================== Inicialización de hojas ===================== */

/** Crea la hoja de un área con sus encabezados exactos. */
function crearHojaArea_(area) {
  var def = areaOError_(area);
  var hoja = libro_().insertSheet(def.hoja);
  var encabezados = CONFIG.ENCABEZADOS_BASE.slice();

  var ancho = anchoArea_(area);
  for (var c = 3; c < ancho; c++) encabezados.push('');
  for (var i = 0; i < def.campos.length; i++) {
    encabezados[indiceColumna_(def.campos[i].col) - 1] =
      def.campos[i].encabezado || def.campos[i].titulo;
  }

  hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
  hoja.getRange(1, 1, 1, encabezados.length)
    .setFontWeight('bold')
    .setBackground('#1f3864')
    .setFontColor('#ffffff')
    .setWrap(true);
  hoja.setFrozenRows(1);
  return hoja;
}

/**
 * Verifica (y crea si hace falta) todas las hojas del ecosistema.
 * Devuelve un informe legible de lo que encontró: es la forma rápida de
 * detectar que alguien renombró una columna en Sheets y rompió el mapeo.
 */
function inicializarHojas_() {
  var lineas = [];

  for (var a = 0; a < ORDEN_AREAS.length; a++) {
    var area = ORDEN_AREAS[a];
    var def = ESQUEMA[area];
    var hoja = libro_().getSheetByName(def.hoja);

    if (!hoja) {
      crearHojaArea_(area);
      lineas.push('✅ Hoja creada: ' + def.hoja);
      continue;
    }

    // Se informa del mapeo REAL, que es el que se va a usar para leer y
    // escribir. Comparar contra las letras del ESQUEMA sólo diría si la hoja se
    // parece a la plantilla; lo que importa es dónde van a caer los datos.
    var ancho = Math.max(anchoArea_(area), hoja.getLastColumn());
    var actuales = hoja.getRange(1, 1, 1, ancho).getValues()[0];
    var mapa = mapaColumnas_(hoja, area);
    var problemas = [];

    for (var b = 0; b < CONFIG.ENCABEZADOS_BASE.length; b++) {
      if (normalizar_(actuales[b]) !== normalizar_(CONFIG.ENCABEZADOS_BASE[b])) {
        problemas.push('col ' + String.fromCharCode(65 + b) + ' debería ser "' +
                       CONFIG.ENCABEZADOS_BASE[b] + '"');
      }
    }

    // Campos cuyo encabezado no está en la hoja: se escribirán en su columna de
    // respaldo. Si ahí hay algo escrito, hay que decirlo, porque se sobrescribe.
    for (var i = 0; i < mapa.porDefecto.length; i++) {
      var campo = mapa.porDefecto[i];
      var ocupada = texto_(actuales[indiceColumna_(campo.col) - 1]);
      problemas.push('falta el encabezado "' + (campo.encabezado || campo.titulo) +
                     '"; se usará la columna ' + campo.col +
                     (ocupada ? ', que hoy dice "' + ocupada + '"' : ', que está vacía'));
    }

    // Campos que sí se encontraron, pero movidos respecto del ESQUEMA. No es un
    // error —el mapeo por encabezado lo resuelve— pero conviene saberlo.
    var movidos = [];
    for (var j = 0; j < def.campos.length; j++) {
      var c = def.campos[j];
      var real = mapa.indices[c.clave];
      if (real !== indiceColumna_(c.col) && mapa.porDefecto.indexOf(c) < 0) {
        movidos.push(c.titulo + ' → ' + letraColumna_(real));
      }
    }

    lineas.push((problemas.length ? '⚠️ ' : '✅ ') + def.hoja +
                (problemas.length ? ' → ' + problemas.join('; ') : '') +
                (movidos.length ? ' · columnas movidas (se respetan): ' +
                                  movidos.join(', ') : ''));
  }

  // Hoja de usuarios.
  var hojaU = libro_().getSheetByName(CONFIG.HOJA_USUARIOS);
  if (!hojaU) {
    hojaU = libro_().insertSheet(CONFIG.HOJA_USUARIOS);
    hojaU.getRange(1, 1, 1, 3).setValues([['Cargo', 'Nombre', 'Correo']]);
    hojaU.setFrozenRows(1);
    lineas.push('✅ Hoja creada: ' + CONFIG.HOJA_USUARIOS);
  } else {
    lineas.push('✅ ' + CONFIG.HOJA_USUARIOS + ' → ' +
                Math.max(0, hojaU.getLastRow() - 1) + ' colaborador(es)');
  }

  // Hoja de KPI.
  var hojaK = libro_().getSheetByName(CONFIG.HOJA_KPI);
  if (!hojaK) {
    hojaK = libro_().insertSheet(CONFIG.HOJA_KPI);
    hojaK.getRange(1, 1, 1, CONFIG.ENCABEZADOS_KPI.length)
      .setValues([CONFIG.ENCABEZADOS_KPI]);
    hojaK.setFrozenRows(1);
    lineas.push('✅ Hoja creada: ' + CONFIG.HOJA_KPI);
  } else {
    lineas.push('✅ ' + CONFIG.HOJA_KPI + ' → ' +
                Math.max(0, hojaK.getLastRow() - 1) + ' métrica(s)');
  }

  return lineas.join('\n');
}
