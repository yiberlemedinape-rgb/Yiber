/**
 * Semana.gs
 * ---------------------------------------------------------------------------
 * Utilidades de tiempo y de normalización de texto/números.
 *
 * El "N° de Semana" del informe usa la norma ISO 8601 (la semana empieza el
 * lunes y la semana 1 es la que contiene el primer jueves del año), que es la
 * convención usada por Excel/Sheets con `ISOWEEKNUM` y por SAP.
 * ---------------------------------------------------------------------------
 */

/** Fecha actual en la zona horaria de operación. */
function ahora_() {
  var s = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy/MM/dd HH:mm:ss');
  var p = s.split(/[\/ :]/);
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]),
                  Number(p[3]), Number(p[4]), Number(p[5]));
}

/** Copia de la fecha desplazada N días. */
function sumarDias_(fecha, dias) {
  var d = new Date(fecha.getTime());
  d.setDate(d.getDate() + dias);
  return d;
}

/** Jueves de la semana ISO a la que pertenece `fecha` (ancla de la norma). */
function juevesIso_(fecha) {
  var d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  // getDay(): 0 = domingo … 6 = sábado. En ISO el lunes es 1 y el domingo 7.
  var diaIso = d.getDay() === 0 ? 7 : d.getDay();
  return sumarDias_(d, 4 - diaIso);
}

/** Número de semana ISO 8601 (1..53). */
function numeroSemanaIso_(fecha) {
  var jueves = juevesIso_(fecha);
  var primeroEnero = new Date(jueves.getFullYear(), 0, 1);
  var dias = Math.round((jueves - primeroEnero) / 86400000);
  return Math.floor(dias / 7) + 1;
}

/** Año ISO (puede diferir del año calendario a fin/inicio de año). */
function anioIso_(fecha) {
  return juevesIso_(fecha).getFullYear();
}

/** Periodo ISO actual: { anio, semana }. */
function periodoActual_() {
  var hoy = ahora_();
  return { anio: anioIso_(hoy), semana: numeroSemanaIso_(hoy) };
}

/** Lunes y domingo (fechas) de una semana ISO dada. */
function rangoSemana_(anio, semana) {
  // El 4 de enero siempre cae en la semana ISO 1.
  var cuatroEnero = new Date(anio, 0, 4);
  var diaIso = cuatroEnero.getDay() === 0 ? 7 : cuatroEnero.getDay();
  var lunesSemana1 = sumarDias_(cuatroEnero, 1 - diaIso);
  var lunes = sumarDias_(lunesSemana1, (semana - 1) * 7);
  return { inicio: lunes, fin: sumarDias_(lunes, 6) };
}

/** Etiqueta legible: "Semana 31 · 28 jul – 03 ago 2026". */
function etiquetaSemana_(anio, semana) {
  var r = rangoSemana_(anio, semana);
  var f = function (d) {
    return Utilities.formatDate(d, CONFIG.ZONA_HORARIA, 'dd MMM')
      .replace('.', '').toLowerCase();
  };
  return 'Semana ' + semana + ' · ' + f(r.inicio) + ' – ' + f(r.fin) + ' ' + anio;
}

/**
 * Últimos N periodos ISO hacia atrás desde el actual (incluido).
 * Se usa para permitir correcciones de semanas anteriores.
 */
function ultimosPeriodos_(cantidad) {
  var lista = [];
  var d = ahora_();
  for (var i = 0; i < cantidad; i++) {
    var anio = anioIso_(d);
    var semana = numeroSemanaIso_(d);
    lista.push({
      anio: anio,
      semana: semana,
      etiqueta: etiquetaSemana_(anio, semana)
    });
    d = sumarDias_(d, -7);
  }
  return lista;
}

/* ===================== Normalización de texto ===================== */

/** Minúsculas, sin tildes y sin espacios sobrantes: para comparar cargos. */
function normalizar_(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .toLowerCase()
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/ñ/g, 'n')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convierte a texto plano y recorta. */
function texto_(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

/**
 * Interpreta un número escrito por un humano.
 * Acepta "1.234.567,89", "1,234,567.89", "$ 4.500", "95,8 %", "4,5 horas".
 * Devuelve null si no hay ningún dígito.
 */
function aNumero_(valor) {
  if (typeof valor === 'number') return isNaN(valor) ? null : valor;
  var s = texto_(valor);
  if (!s) return null;

  var m = s.match(/-?[\d.,]*\d/);
  if (!m) return null;
  var crudo = m[0];

  var tieneComa = crudo.indexOf(',') >= 0;
  var tienePunto = crudo.indexOf('.') >= 0;
  var limpio;

  if (tieneComa && tienePunto) {
    // El separador decimal es el que aparece de último.
    if (crudo.lastIndexOf(',') > crudo.lastIndexOf('.')) {
      limpio = crudo.replace(/\./g, '').replace(',', '.');
    } else {
      limpio = crudo.replace(/,/g, '');
    }
  } else if (tieneComa) {
    var trasComa = crudo.split(',')[1] || '';
    limpio = (trasComa.length === 3 && crudo.split(',').length > 2)
      ? crudo.replace(/,/g, '')            // 1,234,567 → miles
      : crudo.replace(',', '.');           // 95,8 → decimal
  } else if (tienePunto) {
    // Convención colombiana: el punto separa miles cuando todos los grupos
    // posteriores al primero tienen exactamente tres dígitos ("1.500.000").
    var partes = crudo.split('.');
    var todosMiles = true;
    for (var i = 1; i < partes.length; i++) {
      if (!/^\d{3}$/.test(partes[i])) { todosMiles = false; break; }
    }
    limpio = todosMiles ? crudo.replace(/\./g, '') : crudo;
  } else {
    limpio = crudo;
  }

  var n = parseFloat(limpio);
  return isNaN(n) ? null : n;
}

/** Formato de miles colombiano para mostrar cifras en el informe. */
function formatearNumero_(n) {
  if (n === null || n === undefined || isNaN(n)) return '';
  var entero = Math.abs(n) >= 1000 ? Math.round(n) : n;
  var partes = String(entero).split('.');
  partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return partes.join(',');
}
