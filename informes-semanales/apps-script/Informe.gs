/**
 * Informe.gs
 * ---------------------------------------------------------------------------
 * Consolidación de la semana y redacción del informe gerencial en Markdown.
 *
 * Hay dos redactores:
 *   1) `informeDeterminista_`  — siempre disponible, sin dependencias externas.
 *      Arma las cinco secciones obligatorias a partir de los datos crudos.
 *   2) `informeConIa_` (Ia.gs) — si hay GEMINI_API_KEY configurada, Gemini
 *      redacta el análisis siguiendo las DIRECTRICES_INFORME.
 *
 * El determinista es el respaldo: si la IA falla, a la hora del envío igual
 * sale un informe con la información completa.
 * ---------------------------------------------------------------------------
 */

/* ===================== Consolidación ===================== */

/**
 * Reúne todos los reportes de la semana más la lista de quien no reportó.
 * @return {Object} { anio, semana, etiqueta, areas, faltantes, totalReportes }
 */
function consolidarSemana_(anio, semana) {
  var areas = {};
  var total = 0;

  for (var i = 0; i < ORDEN_AREAS.length; i++) {
    var area = ORDEN_AREAS[i];
    var registros = leerSemanaArea_(area, anio, semana);
    areas[area] = registros;
    total += registros.length;
  }

  // Quién debía reportar y no lo hizo.
  var faltantes = [];
  var usuarios = listarUsuarios_();
  for (var u = 0; u < usuarios.length; u++) {
    var usuario = usuarios[u];
    if (!usuario.area) continue;
    var reporto = false;
    var lista = areas[usuario.area] || [];
    for (var r = 0; r < lista.length; r++) {
      if (normalizar_(lista[r].nombre) === normalizar_(usuario.nombre)) { reporto = true; break; }
    }
    if (!reporto) {
      faltantes.push({ nombre: usuario.nombre, cargo: usuario.cargo, area: usuario.area });
    }
  }

  return {
    anio: anio,
    semana: semana,
    etiqueta: etiquetaSemana_(anio, semana),
    generado: Utilities.formatDate(ahora_(), CONFIG.ZONA_HORARIA, "dd/MM/yyyy HH:mm"),
    areas: areas,
    faltantes: faltantes,
    totalReportes: total
  };
}

/* ===================== Accesores cómodos ===================== */

/** Filas de un campo tipo tabla (array vacío si no hay nada). */
function filasDe_(registro, clave) {
  var c = registro.campos[clave];
  return (c && c.tipo === 'tabla' && c.filas) ? c.filas : [];
}

/** Texto de un campo simple (cadena vacía si no hay nada). */
function textoDe_(registro, clave) {
  var c = registro.campos[clave];
  return (c && c.tipo === 'texto') ? texto_(c.valor) : '';
}

/** Adjuntos de un campo tipo imagen. */
function adjuntosDe_(registro, clave) {
  var c = registro.campos[clave];
  return (c && c.tipo === 'imagen' && c.filas) ? c.filas : [];
}

/** Tabla de estructura libre (la pegada desde Excel). */
function tablaLibreDe_(registro, clave) {
  var c = registro.campos[clave];
  return (c && c.tipo === 'tablaLibre' && c.tabla) ? c.tabla : { encabezados: [], filas: [] };
}

/**
 * Viñetas para los adjuntos de un campo — SÓLO para el informe determinista.
 *
 * Cuando Gemini está disponible, las cifras de las imágenes quedan redactadas
 * dentro del texto y la gerencia nunca ve un enlace a un archivo. Este respaldo
 * no puede leer imágenes, así que enlaza al archivo: es preferible un enlace a
 * perder el dato. Es una señal de modo degradado, no el comportamiento normal.
 */
function vinetasAdjuntos_(consolidado, area, clave, etiqueta) {
  var L = [];
  porArea_(consolidado, area, function (reg) {
    var adjuntos = adjuntosDe_(reg, clave);
    for (var i = 0; i < adjuntos.length; i++) {
      var a = adjuntos[i];
      L.push('- ' + etiqueta + ': [' + (a.nombre || 'ver adjunto') + '](' +
             (a.enlace || '') + ')' +
             (a.comentario ? ' — ' + a.comentario : '') +
             ' _(' + reg.nombre + ')_');
    }
  });
  return L;
}

/** Renderiza una tabla de estructura libre como tabla Markdown. */
function tablaLibreAMarkdown_(tabla) {
  if (!tabla || !tabla.filas.length) return [];
  var L = [];
  var cols = tabla.encabezados.length ||
             (tabla.filas[0] ? tabla.filas[0].length : 0);
  if (!cols) return [];

  var encabezados = tabla.encabezados.length
    ? tabla.encabezados
    : tabla.filas[0].map(function (_, i) { return 'Columna ' + (i + 1); });

  L.push('| ' + encabezados.join(' | ') + ' |');
  L.push('|' + encabezados.map(function () { return '---'; }).join('|') + '|');
  for (var i = 0; i < tabla.filas.length; i++) {
    var fila = tabla.filas[i].slice(0, encabezados.length);
    while (fila.length < encabezados.length) fila.push('');
    L.push('| ' + fila.join(' | ') + ' |');
  }
  return L;
}

/** Recorre todos los registros de un área aplicando `fn(registro)`. */
function porArea_(consolidado, area, fn) {
  var lista = consolidado.areas[area] || [];
  for (var i = 0; i < lista.length; i++) fn(lista[i], i);
}

/** Junta las filas de un mismo campo en todas las áreas indicadas. */
function recolectar_(consolidado, areas, clave) {
  var salida = [];
  for (var a = 0; a < areas.length; a++) {
    porArea_(consolidado, areas[a], function (reg) {
      var filas = filasDe_(reg, clave);
      for (var f = 0; f < filas.length; f++) {
        salida.push({ area: areas[a], autor: reg.nombre, fila: filas[f] });
      }
    });
  }
  return salida;
}

/** Suma un KPI ya calculado en KPI_Datos por coincidencia de nombre. */
function sumarKpi_(kpis, area, patron) {
  var lista = kpis[area] || [];
  var total = null;
  var re = normalizar_(patron);
  for (var i = 0; i < lista.length; i++) {
    if (normalizar_(lista[i].metrica).indexOf(re) >= 0 && lista[i].valor !== null) {
      total = (total === null ? 0 : total) + lista[i].valor;
    }
  }
  return total;
}

/** Promedia un KPI por coincidencia de nombre. */
function promediarKpi_(kpis, area, patron) {
  var lista = kpis[area] || [];
  var suma = 0, n = 0;
  var re = normalizar_(patron);
  for (var i = 0; i < lista.length; i++) {
    if (normalizar_(lista[i].metrica).indexOf(re) >= 0 && lista[i].valor !== null) {
      suma += lista[i].valor; n++;
    }
  }
  return n ? suma / n : null;
}

/** ¿El texto contiene alguna de las palabras clave? */
function contieneAlguna_(texto, palabras) {
  var t = normalizar_(texto);
  for (var i = 0; i < palabras.length; i++) {
    if (t.indexOf(palabras[i]) >= 0) return true;
  }
  return false;
}

/** Estados que se consideran de riesgo en equipos y negociaciones. */
var PALABRAS_CRITICAS = ['detenid', 'parad', 'critic', 'urgent', 'riesgo', 'perdid',
                         'sin repuesto', 'pendiente', 'demora', 'atrasad', 'escalad'];
var PALABRAS_PERSONAL = ['incapacidad', 'renuncia', 'retiro', 'ausent', 'accidente',
                         'sobrecarga', 'rotacion', 'vacante'];

/* ===================== Redactor determinista ===================== */

/**
 * Informe gerencial armado directamente de los datos, sin IA.
 * Respeta la estructura obligatoria de cinco secciones.
 */
function informeDeterminista_(consolidado) {
  var kpis = kpisDeSemana_(consolidado.anio, consolidado.semana);
  var L = [];

  L.push('# Informe Gerencial Semanal — Kaeser Compresores');
  L.push('**' + consolidado.etiqueta + '** · generado el ' + consolidado.generado);
  L.push('');

  L.push(seccionResumen_(consolidado, kpis));
  L.push(seccionAlertas_(consolidado));
  L.push(seccionComercial_(consolidado, kpis));
  L.push(seccionOperaciones_(consolidado, kpis));
  L.push(seccionPersonal_(consolidado));
  L.push(bloqueCobertura_(consolidado));

  return L.join('\n');
}

/** 📋 RESUMEN EJECUTIVO */
function seccionResumen_(consolidado, kpis) {
  var equipos = recolectar_(consolidado,
    ['Directores', 'SAU, Renta, CDR', 'Soporte Técnico'], 'equiposDetenidos');
  var visitas = recolectar_(consolidado,
    ['Directores', 'SAU, Renta, CDR'], 'visitasClientes');

  var ordenes = sumarKpi_(kpis, 'Gestión Comercial', 'oc recibidas — total');
  if (ordenes === null) ordenes = sumarKpi_(kpis, 'Directores', 'ordenes importantes recibidas');
  var ftf = promediarKpi_(kpis, 'Soporte Técnico', '% ftf');
  var efectividad = promediarKpi_(kpis, 'DPA', 'efectividad %');

  var frases = [];
  frases.push('Durante la **' + consolidado.etiqueta + '** se consolidaron **' +
              consolidado.totalReportes + '** reportes de área.');
  if (ordenes !== null) {
    frases.push('Las órdenes de compra registradas suman **$' + formatearNumero_(ordenes) + '**.');
  }
  if (visitas.length) {
    frases.push('Se documentaron **' + visitas.length + '** visitas y actividades con clientes.');
  }
  if (equipos.length) {
    frases.push('La operación arrastra **' + equipos.length +
                '** equipo(s) con novedad o detención reportada.');
  }
  if (ftf !== null) frases.push('El **First Time Fix Rate** promedió **' + formatearNumero_(ftf) + '%**.');
  if (efectividad !== null) {
    frases.push('La efectividad de información de **DPA** se ubicó en **' +
                formatearNumero_(efectividad) + '%**.');
  }
  if (frases.length === 1) {
    frases.push('No se registraron cifras comerciales ni operativas cuantificables en la semana.');
  }

  return '## 📋 RESUMEN EJECUTIVO (Semana Actual)\n\n' + frases.join(' ') + '\n';
}

/** 🚨 ALERTAS CRÍTICAS Y CUELLOS DE BOTELLA */
function seccionAlertas_(consolidado) {
  var L = ['## 🚨 ALERTAS CRÍTICAS Y CUELLOS DE BOTELLA', ''];
  var hubo = false;

  // Equipos detenidos (Directores / SAU / Soporte).
  var equipos = recolectar_(consolidado,
    ['Directores', 'SAU, Renta, CDR', 'Soporte Técnico'], 'equiposDetenidos');
  if (equipos.length) {
    hubo = true;
    L.push('**Equipos detenidos y novedades de campo**');
    for (var i = 0; i < equipos.length; i++) {
      var f = equipos[i].fila;
      var marca = contieneAlguna_(f.estado + ' ' + f.falla, PALABRAS_CRITICAS) ? '🔴 ' : '';
      L.push('- ' + marca + '**' + (f.cliente || 'Cliente sin registrar') + '** — equipo **' +
             (f.equipo || 'N/D') + '**: ' + (f.falla || 'falla sin detallar') +
             (f.estado ? ' _(estado: ' + f.estado + ')_' : '') +
             (f.observacion ? ' · ' + f.observacion : '') +
             '  \n  ↳ reporta ' + equipos[i].autor + ' (' + equipos[i].area + ')');
    }
    L.push('');
  }

  // OS con demora severa (DPA).
  var osCriticas = [];
  porArea_(consolidado, 'DPA', function (reg) {
    var filas = filasDe_(reg, 'tratamientoOS');
    for (var i = 0; i < filas.length; i++) {
      var dias = aNumero_(filas[i].diasDemora);
      if (dias !== null && dias >= CONFIG.UMBRAL_DIAS_DEMORA) {
        osCriticas.push(filas[i]);
      }
    }
  });
  if (osCriticas.length) {
    hubo = true;
    osCriticas.sort(function (a, b) { return aNumero_(b.diasDemora) - aNumero_(a.diasDemora); });
    L.push('**Órdenes de servicio con demora ≥ ' + CONFIG.UMBRAL_DIAS_DEMORA + ' días (DPA)**');
    for (var j = 0; j < osCriticas.length; j++) {
      var o = osCriticas[j];
      L.push('- OS **' + (o.os || 'N/D') + '** · zona ' + (o.zona || 'N/D') +
             ' · responsable **' + (o.responsable || 'N/D') + '** — **' +
             formatearNumero_(aNumero_(o.diasDemora)) + ' días** de demora');
    }
    L.push('');
  }

  // Coordinadores con OS demoradas.
  var coordinadores = recolectar_(consolidado, ['DPA'], 'demorasCoordinador');
  if (coordinadores.length) {
    hubo = true;
    L.push('**Demoras en ejecución por coordinador**');
    for (var c = 0; c < coordinadores.length; c++) {
      var d = coordinadores[c].fila;
      L.push('- **' + (d.coordinador || 'N/D') + '** (' + (d.oficina || 'N/D') + '): ' +
             (d.osDemoradas || '0') + ' OS demoradas');
    }
    L.push('');
  }

  // Equipos represados en taller.
  var taller = recolectar_(consolidado, ['SAU, Renta, CDR'], 'equiposMasUnMes');
  if (taller.length) {
    hubo = true;
    L.push('**Equipos con más de 1 mes en taller (CDR)**');
    for (var t = 0; t < taller.length; t++) {
      var e = taller[t].fila;
      L.push('- Equipo **' + (e.equipo || 'N/D') + '** de **' + (e.cliente || 'N/D') + '**' +
             (e.observacion ? ' — ' + e.observacion : ''));
    }
    L.push('');
  }

  // Riesgo comercial (KAM).
  var riesgos = [];
  porArea_(consolidado, 'Asesores KAM', function (reg) {
    var filas = filasDe_(reg, 'negociacionesCurso');
    for (var i = 0; i < filas.length; i++) {
      if (contieneAlguna_(filas[i].estado, PALABRAS_CRITICAS)) {
        riesgos.push({ autor: reg.nombre, fila: filas[i] });
      }
    }
  });
  if (riesgos.length) {
    hubo = true;
    L.push('**Riesgos comerciales en negociaciones (KAM)**');
    for (var k = 0; k < riesgos.length; k++) {
      var n = riesgos[k].fila;
      L.push('- **' + (n.cliente || 'N/D') + '** (' + (n.tipo || 'N/D') + ') — **$' +
             formatearNumero_(aNumero_(n.valorTotal)) + '** · estado: _' +
             (n.estado || 'N/D') + '_ · asesor ' + riesgos[k].autor);
    }
    L.push('');
  }

  // Personal y vacantes.
  var personal = [];
  var areasPersonal = ['Directores', 'DPA', 'Soporte Técnico', 'SAU, Renta, CDR'];
  for (var p = 0; p < areasPersonal.length; p++) {
    porArea_(consolidado, areasPersonal[p], function (reg) {
      var t = textoDe_(reg, 'novedadesPersonal');
      if (t && contieneAlguna_(t, PALABRAS_PERSONAL)) {
        personal.push('- **' + reg.nombre + '** (' + reg.area + '): ' + t);
      }
    });
  }
  var vacantes = recolectar_(consolidado, ['Desarrollo Personal'], 'gestionVacantes')
    .filter(function (v) {
      return !contieneAlguna_(v.fila.estado, ['cerrad', 'contratad', 'cubiert', 'finalizad']);
    });
  for (var w = 0; w < vacantes.length; w++) {
    var vf = vacantes[w].fila;
    personal.push('- Vacante abierta: **' + (vf.cargo || 'N/D') + '** en ' +
                  (vf.zona || 'N/D') + ' — ' + (vf.estado || 'sin avance registrado'));
  }
  if (personal.length) {
    hubo = true;
    L.push('**Personal y vacantes críticas**');
    L = L.concat(personal);
    L.push('');
  }

  if (!hubo) L.push('_Sin alertas críticas reportadas esta semana._\n');
  return L.join('\n');
}

/** 💰 GESTIÓN COMERCIAL Y KAM */
function seccionComercial_(consolidado, kpis) {
  var L = ['## 💰 GESTIÓN COMERCIAL Y KAM', ''];
  var hubo = false;

  // Facturación y cumplimiento.
  var metricas = recolectar_(consolidado, ['Gestión Comercial'], 'metricasFacturacion');
  if (metricas.length) {
    hubo = true;
    L.push('**Facturación y cumplimiento**');
    for (var i = 0; i < metricas.length; i++) {
      L.push('- ' + (metricas[i].fila.kpi || 'KPI') + ': **' +
             (metricas[i].fila.valor || 'N/D') + '**');
    }
    L.push('');
  }

  var metricasDir = recolectar_(consolidado, ['Directores'], 'metricasClave');
  if (metricasDir.length) {
    hubo = true;
    L.push('**Métricas clave reportadas por dirección**');
    for (var m = 0; m < metricasDir.length; m++) {
      var fm = metricasDir[m].fila;
      L.push('- ' + (fm.metrica || 'Métrica sin nombre') + ': **' + (fm.valor || 'N/D') + '**' +
             (fm.observacion ? ' — ' + fm.observacion : '') +
             ' _(' + metricasDir[m].autor + ')_');
    }
    L.push('');
  }

  // Órdenes de compra por sucursal.
  var sucursales = recolectar_(consolidado, ['Gestión Comercial'], 'ordenesPorSucursal');
  if (sucursales.length) {
    hubo = true;
    var totalOc = sumarKpi_(kpis, 'Gestión Comercial', 'oc recibidas — total');
    L.push('**Órdenes de compra por sucursal**' +
           (totalOc !== null ? ' — total **$' + formatearNumero_(totalOc) + '**' : ''));
    for (var s = 0; s < sucursales.length; s++) {
      L.push('- ' + (sucursales[s].fila.sucursal || 'N/D') + ': **$' +
             formatearNumero_(aNumero_(sucursales[s].fila.valorRecibido)) + '**');
    }
    L.push('');
  }

  // Órdenes relevantes (imagen adjunta) e importantes (tabla de dirección).
  var relevantes = vinetasAdjuntos_(consolidado, 'Gestión Comercial',
                                    'ordenesRelevantes', 'Órdenes relevantes');
  var importantes = recolectar_(consolidado, ['Directores'], 'ordenesImportantes');
  if (relevantes.length || importantes.length) {
    hubo = true;
    L.push('**Órdenes importantes cerradas**');
    L = L.concat(relevantes);
    for (var q = 0; q < importantes.length; q++) {
      var fq = importantes[q].fila;
      L.push('- **' + (fq.cliente || 'N/D') + '** — **$' +
             formatearNumero_(aNumero_(fq.monto)) + '** _(' + importantes[q].autor + ')_');
    }
    L.push('');
  }

  // Convenios: KPI como imagen adjunta, contratos por asesor como tabla.
  var convenios = vinetasAdjuntos_(consolidado, 'Gestión Comercial',
                                   'kpisConvenios', 'KPIs de convenios');
  var contratos = recolectar_(consolidado, ['Directores'], 'estadoContratos');
  if (convenios.length || contratos.length) {
    hubo = true;
    L.push('**Convenios y contratos**');
    L = L.concat(convenios);
    for (var x = 0; x < contratos.length; x++) {
      var fx = contratos[x].fila;
      L.push('- **' + (fx.asesor || 'N/D') + '** — meta **' + (fx.meta || 'N/D') +
             '**, vigentes **' + (fx.vigentes || '0') + '**, cumplimiento **' +
             (fx.cumplimiento || 'N/D') + '%**, vencidos **' + (fx.vencidos || '0') +
             '** _(' + contratos[x].autor + ')_');
    }
    L.push('');
  }

  // Distribuidores internacionales.
  var distribuidores = recolectar_(consolidado, ['Gestión Comercial'], 'distribuidores');
  if (distribuidores.length) {
    hubo = true;
    L.push('**Distribuidores internacionales**');
    for (var d = 0; d < distribuidores.length; d++) {
      var fd = distribuidores[d].fila;
      L.push('- **' + (fd.distribuidor || 'N/D') + '** — ' + (fd.ocValor || 'sin OC') +
             (fd.actividad ? ' · ' + fd.actividad : ''));
    }
    L.push('');
  }

  // KAM: presupuesto y pipeline.
  var presupuesto = recolectar_(consolidado, ['Asesores KAM'], 'desarrolloPresupuestario');
  if (presupuesto.length) {
    hubo = true;
    L.push('**Desarrollo presupuestario (KAM)**');
    for (var pp = 0; pp < presupuesto.length; pp++) {
      var fp = presupuesto[pp].fila;
      L.push('- ' + presupuesto[pp].autor + ': meta **' + (fp.meta || 'N/D') +
             '**, facturado **' + (fp.facturado || 'N/D') + '**, cumplimiento **' +
             (fp.cumplimiento || 'N/D') + '%**' +
             ' (OC puntuales ' + (fp.ocPuntuales || '0') +
             ' / convenios ' + (fp.ocConvenios || '0') + ')');
    }
    L.push('');
  }

  var pipeline = sumarKpi_(kpis, 'Asesores KAM', 'pipeline en negociacion');
  if (pipeline !== null) {
    hubo = true;
    L.push('**Pipeline de cuentas clave**');
    L.push('- Valor total en negociación: **$' + formatearNumero_(pipeline) + '**');
    L.push('');
  }

  // Negociaciones de alto impacto: tabla pegada desde Excel, con su estructura.
  var negociaciones = [];
  porArea_(consolidado, 'Gestión Comercial', function (reg) {
    var tabla = tablaLibreDe_(reg, 'negociacionesAltoImpacto');
    var filas = tablaLibreAMarkdown_(tabla);
    if (filas.length) {
      negociaciones.push('_Reportado por ' + reg.nombre + ':_');
      negociaciones = negociaciones.concat(filas);
      negociaciones.push('');
    }
  });
  if (negociaciones.length) {
    hubo = true;
    L.push('**Negociaciones de alto impacto y precios**');
    L.push('');
    L = L.concat(negociaciones);
  }

  if (!hubo) L.push('_Sin información comercial reportada esta semana._\n');
  return L.join('\n');
}

/** ⚙️ OPERACIONES, SAU Y SOPORTE TÉCNICO */
function seccionOperaciones_(consolidado, kpis) {
  var L = ['## ⚙️ OPERACIONES, SAU Y SOPORTE TÉCNICO', ''];
  var hubo = false;

  // First Time Fix Rate: indicador adjunto + comentario del área de soporte.
  var ftf = vinetasAdjuntos_(consolidado, 'Soporte Técnico', 'firstTimeFix', 'Indicador FTF');
  if (ftf.length) {
    hubo = true;
    L.push('**First Time Fix Rate (FTF)**');
    L = L.concat(ftf);
    L.push('');
  }

  // Línea de emergencia: tablero adjunto.
  var emergencia = vinetasAdjuntos_(consolidado, 'Soporte Técnico',
                                    'metricasEmergencia', 'Tablero de la línea');
  if (emergencia.length) {
    hubo = true;
    L.push('**Línea de emergencia**');
    L = L.concat(emergencia);
    L.push('');
  }

  // Efectividad DPA.
  var calidad = recolectar_(consolidado, ['DPA'], 'calidadInformacion');
  if (calidad.length) {
    hubo = true;
    L.push('**Efectividad de información (DPA)**');
    for (var c = 0; c < calidad.length; c++) {
      var fc = calidad[c].fila;
      L.push('- ' + (fc.proceso || 'Proceso') + ': **' + (fc.efectividad || 'N/D') +
             '%** de efectividad (' + (fc.solicitudes || '0') + ' solicitudes, ' +
             (fc.reprocesos || '0') + ' reprocesos)');
    }
    L.push('');
  }

  var tiempos = [];
  porArea_(consolidado, 'DPA', function (reg) {
    var t = textoDe_(reg, 'tiempoRespuesta');
    if (t) tiempos.push('- Tiempo promedio de respuesta: **' + t + '** _(' + reg.nombre + ')_');
  });
  if (tiempos.length) { hubo = true; L = L.concat(tiempos); L.push(''); }

  // Ofertas y tiempos.
  var ofertas = [];
  var fuera = sumarKpi_(kpis, 'DPA', 'fuera de tiempo');
  var totalOfertas = sumarKpi_(kpis, 'DPA', '— total');
  if (totalOfertas !== null) {
    ofertas.push('- Ofertas gestionadas: **' + formatearNumero_(totalOfertas) + '**' +
                 (fuera !== null ? ', de las cuales **' + formatearNumero_(fuera) +
                  '** salieron fuera de tiempo' : ''));
  }
  if (ofertas.length) { hubo = true; L.push('**Ofertas (puntuales y convenios)**'); L = L.concat(ofertas); L.push(''); }

  // Taller CDR.
  var talleres = recolectar_(consolidado, ['SAU, Renta, CDR'], 'serviciosTaller');
  if (talleres.length) {
    hubo = true;
    L.push('**Flujo de taller CDR**');
    for (var t2 = 0; t2 < talleres.length; t2++) {
      L.push('- ' + (talleres[t2].fila.estado || 'Estado') + ': **' +
             (talleres[t2].fila.cantidad || '0') + '**');
    }
    L.push('');
  }

  var otrosSau = [];
  porArea_(consolidado, 'SAU, Renta, CDR', function (reg) {
    var utility = textoDe_(reg, 'serviciosUtility');
    var reprocesos = textoDe_(reg, 'registroReprocesos');
    var renta = textoDe_(reg, 'mantenimientoRenta');
    var horas = textoDe_(reg, 'horasExtra');
    if (utility) otrosSau.push('- Servicios Utility: **' + utility + '** _(' + reg.nombre + ')_');
    if (reprocesos) otrosSau.push('- Reprocesos: ' + reprocesos + ' _(' + reg.nombre + ')_');
    if (horas) otrosSau.push('- Horas extra: ' + horas + ' _(' + reg.nombre + ')_');
    if (renta) otrosSau.push('- Flota de renta: ' + renta + ' _(' + reg.nombre + ')_');
  });
  if (otrosSau.length) { hubo = true; L.push('**SAU, Renta y CDR**'); L = L.concat(otrosSau); L.push(''); }

  // Centro de monitoreo y vibraciones.
  var monitoreo = [];
  porArea_(consolidado, 'Soporte Técnico', function (reg) {
    var t = textoDe_(reg, 'centroMonitoreo');
    if (t) monitoreo.push('- ' + t + ' _(' + reg.nombre + ')_');
    var fallas = textoDe_(reg, 'fallasFrecuentes');
    if (fallas) monitoreo.push('- Fallas frecuentes: ' + fallas + ' _(' + reg.nombre + ')_');
  });
  var vibraciones = recolectar_(consolidado, ['Soporte Técnico'], 'analisisVibraciones');
  for (var v = 0; v < vibraciones.length; v++) {
    monitoreo.push('- Análisis de vibraciones — ' + (vibraciones[v].fila.estado || 'N/D') +
                   ': **' + (vibraciones[v].fila.cantidad || '0') + '**');
  }
  if (monitoreo.length) {
    hubo = true;
    L.push('**Centro de monitoreo y análisis predictivo**');
    L = L.concat(monitoreo);
    L.push('');
  }

  if (!hubo) L.push('_Sin información operativa reportada esta semana._\n');
  return L.join('\n');
}

/** 👥 DESARROLLO DE PERSONAL */
function seccionPersonal_(consolidado) {
  var L = ['## 👥 DESARROLLO DE PERSONAL', ''];
  var hubo = false;

  var vacantes = recolectar_(consolidado, ['Desarrollo Personal'], 'gestionVacantes');
  if (vacantes.length) {
    hubo = true;
    L.push('**Avance en contrataciones**');
    for (var i = 0; i < vacantes.length; i++) {
      var f = vacantes[i].fila;
      L.push('- **' + (f.cargo || 'N/D') + '** — ' + (f.zona || 'N/D') + ': ' +
             (f.estado || 'sin avance registrado'));
    }
    L.push('');
  }

  var seguimiento = recolectar_(consolidado, ['Desarrollo Personal'], 'seguimiento');
  if (seguimiento.length) {
    hubo = true;
    L.push('**Seguimiento y escalafonamiento**');
    for (var s = 0; s < seguimiento.length; s++) {
      var fs = seguimiento[s].fila;
      L.push('- **' + (fs.colaborador || 'N/D') + '** (' + (fs.zona || 'N/D') + '): ' +
             (fs.novedad || 'sin novedad'));
    }
    L.push('');
  }

  var textos = [];
  porArea_(consolidado, 'Desarrollo Personal', function (reg) {
    var entrenamientos = textoDe_(reg, 'entrenamientos');
    var especialistas = textoDe_(reg, 'temasEspecialistas');
    var distribuidores = textoDe_(reg, 'soporteDistribuidores');
    if (entrenamientos) textos.push('- Entrenamientos y capacitaciones: ' + entrenamientos);
    if (especialistas) textos.push('- Temas de especialistas: ' + especialistas);
    if (distribuidores) textos.push('- Soporte a distribuidores: ' + distribuidores);
  });
  if (textos.length) {
    hubo = true;
    L.push('**Formación técnica impartida**');
    L = L.concat(textos);
    L.push('');
  }

  if (!hubo) L.push('_Sin información de desarrollo de personal reportada esta semana._\n');
  return L.join('\n');
}

/** Anexo de cobertura: quién reportó y quién no. */
function bloqueCobertura_(consolidado) {
  var L = ['---', '', '**Cobertura del reporte:** ' + consolidado.totalReportes +
           ' reporte(s) recibido(s).'];

  if (consolidado.faltantes.length) {
    var nombres = consolidado.faltantes.map(function (f) {
      return f.nombre + ' (' + f.area + ')';
    });
    L.push('**Pendientes de envío:** ' + nombres.join(', ') + '.');
  } else {
    L.push('**Pendientes de envío:** ninguno.');
  }
  return L.join('\n');
}

/* ===================== Punto de entrada ===================== */

/**
 * Construye el informe de la semana indicada.
 * @param {number}  anio
 * @param {number}  semana
 * @param {boolean} usarIa  Intenta redactar con el modelo si hay API key.
 * @return {Object} { markdown, fuente, consolidado, aviso }
 */
function construirInforme_(anio, semana, usarIa) {
  var consolidado = consolidarSemana_(anio, semana);
  var respaldo = informeDeterminista_(consolidado);

  if (usarIa === false) {
    return { markdown: respaldo, fuente: 'datos', consolidado: consolidado, aviso: '' };
  }

  var ia = informeConIa_(consolidado);
  if (ia.ok) {
    var encabezado = '# Informe Gerencial Semanal — Kaeser Compresores\n' +
                     '**' + consolidado.etiqueta + '** · generado el ' +
                     consolidado.generado + '\n\n';

    // Si alguna imagen no se pudo enviar, la gerencia debe saberlo: el informe
    // se redactó sin ella.
    var aviso = '';
    if (ia.imagenesOmitidas && ia.imagenesOmitidas.length) {
      aviso = 'Gemini leyó ' + ia.imagenesLeidas + ' imagen(es). No se pudieron ' +
              'incluir: ' + ia.imagenesOmitidas.join('; ') + '.';
    }

    return {
      markdown: encabezado + ia.markdown + '\n\n' + bloqueCobertura_(consolidado),
      fuente: 'ia',
      consolidado: consolidado,
      imagenesLeidas: ia.imagenesLeidas || 0,
      aviso: aviso
    };
  }

  return {
    markdown: respaldo,
    fuente: 'datos',
    consolidado: consolidado,
    aviso: ia.motivo || ''
  };
}
