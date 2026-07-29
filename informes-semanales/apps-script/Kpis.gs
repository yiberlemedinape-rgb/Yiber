/**
 * Kpis.gs
 * ---------------------------------------------------------------------------
 * Extracción automática de métricas hacia la hoja "KPI_Datos"
 * (Año | N° de Semana | Área | Nombre | Métrica | Valor).
 *
 * Los KPI no se escriben a mano: se declaran en ESQUEMA junto al campo que los
 * produce y este archivo los calcula cada vez que alguien guarda su reporte.
 * Así la hoja KPI_Datos queda lista para tablas dinámicas y gráficos de
 * tendencia sin depender de que nadie recuerde actualizarla.
 * ---------------------------------------------------------------------------
 */

/** Hoja KPI_Datos (la crea con encabezados si no existe). */
function hojaKpi_() {
  var hoja = libro_().getSheetByName(CONFIG.HOJA_KPI);
  if (!hoja) {
    hoja = libro_().insertSheet(CONFIG.HOJA_KPI);
    hoja.getRange(1, 1, 1, CONFIG.ENCABEZADOS_KPI.length)
      .setValues([CONFIG.ENCABEZADOS_KPI]);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

/**
 * Calcula las métricas de un reporte a partir del ESQUEMA.
 * @return {Array<{metrica: string, valor: number}>}
 */
function calcularKpis(area, datos) {
  var def = areaOError_(area);
  var salida = [];

  for (var i = 0; i < def.campos.length; i++) {
    var campo = def.campos[i];
    if (!campo.kpis || !campo.kpis.length) continue;

    var entrada = datos.campos ? datos.campos[campo.clave] : null;

    for (var k = 0; k < campo.kpis.length; k++) {
      var kpi = campo.kpis[k];

      if (campo.tipo === 'texto') {
        var n = aNumero_(entrada);
        if (n !== null) salida.push({ metrica: kpi.metrica || campo.titulo, valor: n });
        continue;
      }

      var filas = entrada || [];
      if (!filas.length) continue;

      if (kpi.agregacion) {
        var suma = 0, cuenta = 0;
        for (var f = 0; f < filas.length; f++) {
          var v = aNumero_(filas[f][kpi.valorCol]);
          if (v !== null) { suma += v; cuenta++; }
        }
        if (!cuenta) continue;
        salida.push({
          metrica: kpi.metrica || campo.titulo,
          valor: kpi.agregacion === 'promedio' ? suma / cuenta : suma
        });
      } else {
        for (var g = 0; g < filas.length; g++) {
          var valor = aNumero_(filas[g][kpi.valorCol]);
          if (valor === null) continue;
          var etiqueta = kpi.etiquetaCol ? texto_(filas[g][kpi.etiquetaCol]) : '';
          var nombreMetrica = kpi.metrica
            ? (etiqueta ? kpi.metrica + ' — ' + etiqueta : kpi.metrica)
            : (etiqueta || campo.titulo);
          salida.push({ metrica: nombreMetrica, valor: valor });
        }
      }
    }
  }
  return salida;
}

/**
 * Reemplaza las métricas de (año, semana, área, nombre) por las recién
 * calculadas. Guardar dos veces la misma semana no duplica filas.
 */
function registrarKpis(area, anio, semana, nombre, datos) {
  var metricas = calcularKpis(area, datos);
  var hoja = hojaKpi_();

  var candado = LockService.getDocumentLock();
  candado.waitLock(20000);
  try {
    borrarKpisDe_(hoja, anio, semana, area, nombre);
    if (!metricas.length) return 0;

    var filas = metricas.map(function (m) {
      return [Number(anio), Number(semana), area, nombre, m.metrica, m.valor];
    });
    hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, CONFIG.ENCABEZADOS_KPI.length)
      .setValues(filas);
  } finally {
    candado.releaseLock();
  }
  return metricas.length;
}

/** Borra (de abajo hacia arriba) las filas previas de un reporte. */
function borrarKpisDe_(hoja, anio, semana, area, nombre) {
  var ultima = hoja.getLastRow();
  if (ultima < 2) return;

  var valores = hoja.getRange(2, 1, ultima - 1, 4).getValues();
  var objetivoNombre = normalizar_(nombre);
  var objetivoArea = normalizar_(area);

  for (var i = valores.length - 1; i >= 0; i--) {
    if (aNumero_(valores[i][0]) === Number(anio) &&
        aNumero_(valores[i][1]) === Number(semana) &&
        normalizar_(valores[i][2]) === objetivoArea &&
        normalizar_(valores[i][3]) === objetivoNombre) {
      hoja.deleteRow(i + 2);
    }
  }
}

/** Todas las métricas de una semana, agrupadas por área. */
function kpisDeSemana(anio, semana) {
  var hoja = libro_().getSheetByName(CONFIG.HOJA_KPI);
  if (!hoja || hoja.getLastRow() < 2) return {};

  var valores = hoja.getRange(2, 1, hoja.getLastRow() - 1,
                              CONFIG.ENCABEZADOS_KPI.length).getValues();
  var salida = {};

  for (var i = 0; i < valores.length; i++) {
    if (aNumero_(valores[i][0]) !== Number(anio)) continue;
    if (aNumero_(valores[i][1]) !== Number(semana)) continue;

    var area = texto_(valores[i][2]);
    if (!salida[area]) salida[area] = [];
    salida[area].push({
      nombre: texto_(valores[i][3]),
      metrica: texto_(valores[i][4]),
      valor: aNumero_(valores[i][5])
    });
  }
  return salida;
}
