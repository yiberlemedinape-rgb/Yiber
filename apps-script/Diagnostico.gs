/**
 * Diagnostico.gs
 * ---------------------------------------------------------------------------
 * Motor de diagnóstico espectral basado en la Carta de Charlotte.
 *
 * Entrada (objeto "medicion"):
 * {
 *   rpm: 2970,                 // velocidad de giro del eje analizado
 *   FL: 60, polos: 2,          // eléctricas (opcional)
 *   global: {                  // valores globales / Monitoring (opcional)
 *     vRMS: 3.2,               // mm/s velocidad global RMS
 *     aRMS: 1.1,               // g aceleración global RMS
 *     HFD: 4.0,                // g
 *     gSE: 1.8                 // Spike Energy
 *   },
 *   espectro: [                // pares [frecuenciaHz, amplitud] (opcional)
 *     [24.7, 0.4], [49.5, 2.1], ...
 *   ],
 *   direccion: 'radial'|'axial'|'',   // dirección predominante del espectro
 *   rodamiento: '6208',        // clave de RODAMIENTOS_REF o geo {Nb,Bd,Pd,theta}
 *   engranaje: { dientes: 37 },// opcional
 *   alabes: { n: 5 },          // opcional (BPF)
 *   correa: { L: 1200, D1: 120 } // opcional
 * }
 *
 * Salida: objeto con semáforo global + lista ordenada de hallazgos.
 * ---------------------------------------------------------------------------
 */

/**
 * Punto de entrada del diagnóstico.
 * @return {{semaforo:string, resumen:string, fr:number, hallazgos:Array, frecuencias:Object}}
 */
function diagnosticar(medicion) {
  var m = medicion || {};
  var fr = frDesdeRPM_(m.rpm || 0);
  var espectro = normalizarEspectro_(m.espectro);           // velocidad (mm/s) para órdenes
  var espectroAccel = normalizarEspectro_(m.espectroAccel); // aceleración (mg) para rodamientos
  var dir = (m.direccion || '').toLowerCase();

  var ctx = {
    m: m, fr: fr, espectro: espectro, dir: dir,
    ruido: ruidoDeFondo_(espectro),
    overall: energiaTotal_(espectro),
    espectroAccel: espectroAccel,
    ruidoAccel: ruidoDeFondo_(espectroAccel)
  };

  var hallazgos = [];

  // Cada regla devuelve null o un hallazgo {tipo, subtipo, confianza(0-100),
  // severidad, evidencia[], accion}.
  [
    reglaDesequilibrio_,
    reglaDesalineacion_,
    reglaHolguras_,
    reglaRodamientos_,
    reglaEngranajes_,
    reglaHidraulica_,
    reglaCorreas_,
    reglaMotorElectrico_
  ].forEach(function (regla) {
    var h = regla(ctx);
    if (h) hallazgos.push(h);
  });

  // Ordenar por confianza descendente.
  hallazgos.sort(function (a, b) { return b.confianza - a.confianza; });

  var semaforo = semaforoGlobal_(m.global, hallazgos);
  var frecuencias = tablaFrecuencias_(ctx);

  return {
    fr: redondear_(fr, 3),
    semaforo: semaforo.color,
    resumen: semaforo.texto + (hallazgos.length
      ? ' — Causa probable: ' + hallazgos[0].tipo +
        (hallazgos[0].subtipo ? ' (' + hallazgos[0].subtipo + ')' : '')
      : ' — Sin patrón espectral concluyente.'),
    hallazgos: hallazgos,
    frecuencias: frecuencias
  };
}

/* ======================= UTILIDADES DE ESPECTRO ======================= */

function normalizarEspectro_(esp) {
  if (!esp || !esp.length) return [];
  return esp
    .map(function (p) { return [Number(p[0]), Number(p[1])]; })
    .filter(function (p) { return isFinite(p[0]) && isFinite(p[1]) && p[0] >= 0; })
    .sort(function (a, b) { return a[0] - b[0]; });
}

/** Amplitud del mayor pico dentro de la tolerancia alrededor de f (Hz). */
function picoCerca_(espectro, f, fr) {
  if (!f || !espectro.length) return 0;
  var tol = Math.max(TOLERANCIA.fraccionObjetivo * f, TOLERANCIA.fraccionGiroMin * fr, 1e-6);
  var max = 0;
  for (var i = 0; i < espectro.length; i++) {
    var d = Math.abs(espectro[i][0] - f);
    if (d <= tol && espectro[i][1] > max) max = espectro[i][1];
  }
  return max;
}

/**
 * Ruido de fondo (piso) del espectro. Se usa un percentil BAJO (25%) en vez de
 * la mediana: el piso de ruido está por definición por debajo de los picos, y
 * la mediana se infla cuando una fracción grande de las líneas son picos
 * (espectros pequeños). En espectros reales (cientos de líneas con piso bajo)
 * ambos coinciden. Se descartan valores nulos/negativos.
 */
function ruidoDeFondo_(espectro) {
  if (!espectro.length) return 0;
  var amps = espectro
    .map(function (p) { return p[1]; })
    .filter(function (a) { return a > 0; })
    .sort(function (a, b) { return a - b; });
  if (!amps.length) return 0;
  var idx = Math.floor(0.25 * (amps.length - 1));
  return amps[idx];
}

/** Energía total aproximada (suma de amplitudes). */
function energiaTotal_(espectro) {
  return espectro.reduce(function (s, p) { return s + p[1]; }, 0);
}

/** Amplitud en un orden n·fr. */
function amp_(ctx, n) { return picoCerca_(ctx.espectro, n * ctx.fr, ctx.fr); }

/* ============================= REGLAS ================================= */

/**
 * Desequilibrio: 1X radial dominante, armónicos superiores bajos.
 * Estático (fase ~0° entre soportes), par/couple (180°), dinámico (mezcla).
 */
function reglaDesequilibrio_(ctx) {
  if (!ctx.espectro.length || !ctx.fr) return null;
  var a1 = amp_(ctx, 1), a2 = amp_(ctx, 2), a3 = amp_(ctx, 3);
  if (a1 <= 0) return null;

  var dominante1X = a1 >= 2 * Math.max(a2, a3) && a1 > 3 * ctx.ruido;
  if (!dominante1X) return null;

  var conf = 55;
  if (a1 >= 4 * Math.max(a2, a3)) conf += 20;         // 1X muy limpio
  if (ctx.dir === 'radial') conf += 15;               // radial refuerza
  if (ctx.dir === 'axial') conf -= 25;                // axial lo descarta
  conf = acotar_(conf);

  return {
    tipo: 'Desequilibrio',
    subtipo: '',
    confianza: conf,
    severidad: severidadPorOrden_(a1),
    evidencia: [
      '1X dominante (' + redondear_(a1, 3) + ') vs 2X (' + redondear_(a2, 3) + '), 3X (' + redondear_(a3, 3) + ')',
      'Predominio ' + (ctx.dir || 'radial') + '.'
    ],
    accion: 'Confirmar con FASE: estático → fase ~0° e igual en ambos soportes; ' +
            'par/couple → desfase 180° entre soportes; dinámico → mezcla 0°–180°. ' +
            'Balancear en 1 plano (estático) o 2 planos (par/dinámico).'
  };
}

/**
 * Desalineación: 2X elevado. Angular → axial alta a 1X y 2X (180° axial en el
 * acople). Paralela → radial alta, 2X ≥ 1X (180° radial en el acople).
 */
function reglaDesalineacion_(ctx) {
  if (!ctx.espectro.length || !ctx.fr) return null;
  var a1 = amp_(ctx, 1), a2 = amp_(ctx, 2), a3 = amp_(ctx, 3);
  if (a2 <= 3 * ctx.ruido) return null;
  if (a2 < 0.5 * a1) return null; // 2X debe ser significativo respecto a 1X

  var subtipo, evid, conf = 55;
  if (ctx.dir === 'axial') {
    subtipo = 'Angular';
    evid = 'Axial alta a 1X y 2X (2X=' + redondear_(a2, 3) + ').';
    conf += 20;
  } else if (a2 >= a1) {
    subtipo = 'Paralela (offset)';
    evid = 'Radial con 2X (' + redondear_(a2, 3) + ') ≥ 1X (' + redondear_(a1, 3) + ').';
    conf += 15;
  } else {
    subtipo = 'General';
    evid = '2X elevado (' + redondear_(a2, 3) + ') respecto a 1X (' + redondear_(a1, 3) + ').';
  }
  if (a3 > 3 * ctx.ruido) { conf += 5; evid += ' Presencia de 3X.'; }

  return {
    tipo: 'Desalineación',
    subtipo: subtipo,
    confianza: acotar_(conf),
    severidad: severidadPorOrden_(a2),
    evidencia: [evid],
    accion: 'Verificar desfase de 180° a través del acople (axial=angular, radial=paralela). ' +
            'Alinear en frío considerando crecimiento térmico; revisar pie blando antes de alinear.'
  };
}

/**
 * Holguras mecánicas. Tipo C (ajuste inadecuado) es el más reconocible en
 * espectro: sub/armónicos 0.5X, 1.5X, 2.5X, múltiples armónicos síncronos y
 * ruido de fondo elevado (forma de onda truncada).
 */
function reglaHolguras_(ctx) {
  if (!ctx.espectro.length || !ctx.fr) return null;
  var a05 = amp_(ctx, 0.5), a15 = amp_(ctx, 1.5), a25 = amp_(ctx, 2.5);
  var armonicos = 0;
  for (var n = 1; n <= 6; n++) if (amp_(ctx, n) > 3 * ctx.ruido) armonicos++;

  var subArm = (a05 > 3 * ctx.ruido) || (a15 > 3 * ctx.ruido) || (a25 > 3 * ctx.ruido);
  if (!(subArm && armonicos >= 3)) return null;

  var conf = 60 + Math.min(armonicos * 4, 20);
  return {
    tipo: 'Holgura mecánica',
    subtipo: 'Tipo C (ajuste inadecuado entre piezas)',
    confianza: acotar_(conf),
    severidad: severidadPorRuido_(ctx),
    evidencia: [
      'Sub-armónicos presentes (0.5X=' + redondear_(a05, 3) + ', 1.5X=' + redondear_(a15, 3) + ', 2.5X=' + redondear_(a25, 3) + ').',
      armonicos + ' armónicos síncronos + ruido de fondo elevado (mediana=' + redondear_(ctx.ruido, 4) + ').'
    ],
    accion: 'Inspeccionar forma de onda (truncamiento). Tipo A: pie blando/debilidad ' +
            'estructural (fase 90°–180° vertical). Tipo B: pernos flojos/fisuras. ' +
            'Tipo C: ajuste rotor/alojamiento. Reapretar, revisar tolerancias y bancada.'
  };
}

/**
 * Rodamientos: energía de pico (gSE/HFD) + frecuencias de defecto no síncronas
 * (BPFO/BPFI/BSF/FTF) con bandas laterales. Determina etapa 1–4.
 */
function reglaRodamientos_(ctx) {
  var g = (ctx.m.global) || {};
  var geo = resolverRodamiento_(ctx.m.rodamiento);
  var frec = geo ? frecuenciasRodamiento(geo, ctx.fr) : null;

  // Evidencia por energía de pico.
  var gSE = Number(g.gSE) || 0, HFD = Number(g.HFD) || 0;
  var energiaAlta = gSE > UMBRALES_GSE.aceptableMax || HFD > UMBRALES_HFD.aceptableMax;

  // Evidencia espectral: frecuencias de defecto en cada mitad del espectro.
  // Aparecen PRIMERO en aceleración (mg) — defecto incipiente — y luego migran
  // al espectro de velocidad (mm/s) al agravarse (Carta de Charlotte).
  var defVel = [];    // en velocidad → daño avanzado
  var defAccel = [];  // solo en aceleración → incipiente
  if (frec) {
    ['BPFO', 'BPFI', 'BSF', 'FTF'].forEach(function (k) {
      var aV = ctx.espectro.length ? picoCerca_(ctx.espectro, frec[k], ctx.fr) : 0;
      var aA = ctx.espectroAccel.length ? picoCerca_(ctx.espectroAccel, frec[k], ctx.fr) : 0;
      if (aV > 3 * ctx.ruido) defVel.push(k + '@' + frec[k] + 'Hz vel(' + redondear_(aV, 3) + ')');
      else if (aA > 3 * ctx.ruidoAccel) defAccel.push(k + '@' + frec[k] + 'Hz acc(' + redondear_(aA, 3) + ')');
    });
  }
  var defectos = defVel.concat(defAccel);

  if (!energiaAlta && !defectos.length) return null;

  // Estadificación (Carta de Charlotte):
  var etapa, accion, conf = 55;
  if (defVel.length && (gSE > UMBRALES_GSE.alarmaMax || defVel.length >= 2)) {
    etapa = 'Etapa 3';
    accion = 'REEMPLAZAR DE INMEDIATO. Frecuencias de defecto con armónicos/bandas ' +
             'laterales visibles en el espectro de VELOCIDAD.';
    conf = 82;
  } else if (defVel.length) {
    etapa = 'Etapa 2–3';
    accion = 'Programar reemplazo a corto plazo. Defecto ya presente en velocidad; ' +
             'aumentar la frecuencia de monitoreo.';
    conf = 74;
  } else if (defAccel.length) {
    etapa = 'Etapa 2';
    accion = 'Defecto discreto visible en ACELERACIÓN (mg) con bandas laterales, aún no ' +
             'en velocidad. Programar reemplazo y vigilar evolución.';
    conf = 70;
  } else if (gSE > UMBRALES_GSE.alarmaMax || HFD > UMBRALES_HFD.alarmaMax) {
    etapa = 'Etapa 3–4';
    accion = 'REEMPLAZAR. Energía de pico muy alta sin líneas discretas claras: posible ' +
             'daño avanzado/ruido aleatorio de banda ancha.';
    conf = 72;
  } else {
    etapa = 'Etapa 1';
    accion = 'Vigilar. Elevación ultrasónica (gSE/HFD) sin líneas discretas. Revisar lubricación.';
    conf = 60;
  }

  var evid = [];
  if (gSE) evid.push('gSE=' + gSE + ' (alarma>' + UMBRALES_GSE.alarmaMax + ')');
  if (HFD) evid.push('HFD=' + HFD + ' g (alarma>' + UMBRALES_HFD.alarmaMax + ')');
  if (defVel.length) evid.push('Defectos en velocidad: ' + defVel.join(', '));
  if (defAccel.length) evid.push('Defectos en aceleración: ' + defAccel.join(', '));
  if (!geo) evid.push('Sin geometría de rodamiento: solo se evalúa energía de pico.');

  return {
    tipo: 'Rodamiento',
    subtipo: etapa,
    confianza: acotar_(conf),
    severidad: etapa.indexOf('3') >= 0 || etapa.indexOf('4') >= 0 ? 'ALTA' : (etapa.indexOf('2') >= 0 ? 'MEDIA' : 'BAJA'),
    evidencia: evid,
    accion: accion
  };
}

/** Engranajes: GMF con bandas laterales a ±1X del eje. */
function reglaEngranajes_(ctx) {
  if (!ctx.m.engranaje || !ctx.m.engranaje.dientes || !ctx.espectro.length) return null;
  var gmf = frecuenciaEngrane(ctx.m.engranaje.dientes, ctx.fr);
  var aG = picoCerca_(ctx.espectro, gmf, ctx.fr);
  if (aG <= 3 * ctx.ruido) return null;

  var bandaSup = picoCerca_(ctx.espectro, gmf + ctx.fr, ctx.fr);
  var bandaInf = picoCerca_(ctx.espectro, gmf - ctx.fr, ctx.fr);
  var conBandas = (bandaSup > 3 * ctx.ruido) || (bandaInf > 3 * ctx.ruido);

  return {
    tipo: 'Engranaje',
    subtipo: conBandas ? 'GMF con bandas laterales ±1X' : 'GMF elevada',
    confianza: acotar_(conBandas ? 72 : 60),
    severidad: severidadPorOrden_(aG),
    evidencia: ['GMF@' + gmf + 'Hz (amp=' + redondear_(aG, 3) + ')' + (conBandas ? ' con bandas ±1X.' : '.')],
    accion: 'Inspeccionar desgaste/diente agrietado. Bandas laterales a 1X del eje ' +
            'afectado localizan el engrane con problema. Revisar backlash y alineación.'
  };
}

/**
 * Fuerzas hidráulicas/aerodinámicas: BPF (paso de álabes) y cavitación
 * (ruido de banda ancha de alta frecuencia, "grava").
 */
function reglaHidraulica_(ctx) {
  if (!ctx.espectro.length) return null;
  var out = null;

  if (ctx.m.alabes && ctx.m.alabes.n && ctx.fr) {
    var bpf = frecuenciaPasoAlabes(ctx.m.alabes.n, ctx.fr);
    var aB = picoCerca_(ctx.espectro, bpf, ctx.fr);
    if (aB > 3 * ctx.ruido) {
      out = {
        tipo: 'Fuerza hidráulica',
        subtipo: 'BPF (paso de álabes)',
        confianza: 65,
        severidad: severidadPorOrden_(aB),
        evidencia: ['BPF@' + bpf + 'Hz (amp=' + redondear_(aB, 3) + ') = ' + ctx.m.alabes.n + '·fr.'],
        accion: 'Revisar holgura impulsor-voluta, recirculación y condiciones de operación.'
      };
    }
  }

  // Cavitación: banda ancha de alta frecuencia (energía difusa sobre el ruido).
  var alta = ctx.espectro.filter(function (p) { return p[0] > 5 * ctx.fr; });
  if (alta.length >= 5) {
    var mediaAlta = alta.reduce(function (s, p) { return s + p[1]; }, 0) / alta.length;
    if (ctx.ruido > 0 && mediaAlta > 2 * ctx.ruido) {
      var cav = {
        tipo: 'Fuerza hidráulica',
        subtipo: 'Cavitación (ruido de banda ancha, "grava")',
        confianza: 55,
        severidad: 'MEDIA',
        evidencia: ['Energía difusa en alta frecuencia (media=' + redondear_(mediaAlta, 4) + ' vs ruido=' + redondear_(ctx.ruido, 4) + ').'],
        accion: 'Revisar NPSH/presión de succión, temperatura y estrangulamiento. La ' +
                'cavitación erosiona impulsor y rodamientos.'
      };
      // Preferir el hallazgo de mayor confianza si ya hay BPF.
      if (!out || cav.confianza > out.confianza) out = cav;
    }
  }
  return out;
}

/** Correas: sub-armónicos a la frecuencia de correa (1×–4×), casi siempre <1X. */
function reglaCorreas_(ctx) {
  if (!ctx.m.correa || !ctx.m.correa.L || !ctx.m.correa.D1 || !ctx.espectro.length) return null;
  var f = frecuenciaCorrea(ctx.m.correa.L, ctx.m.correa.D1, ctx.fr);
  var hits = [];
  ['x1', 'x2', 'x3', 'x4'].forEach(function (k) {
    var a = picoCerca_(ctx.espectro, f[k], ctx.fr);
    if (a > 3 * ctx.ruido) hits.push(k + '@' + f[k] + 'Hz');
  });
  if (!hits.length) return null;
  return {
    tipo: 'Transmisión por correa',
    subtipo: 'Frecuencia de correa',
    confianza: acotar_(55 + hits.length * 6),
    severidad: 'MEDIA',
    evidencia: ['Picos a: ' + hits.join(', ') + '.'],
    accion: 'Revisar tensión, alineación de poleas, desgaste/grietas y excentricidad de poleas.'
  };
}

/**
 * Motor eléctrico: 2FL (excentricidad de estator/entrehierro), 1X con bandas
 * laterales a pole-pass (barras rotas), 3X/6X FL (defectos de SCR en DC).
 */
function reglaMotorElectrico_(ctx) {
  if (!ctx.m.FL || !ctx.m.polos || !ctx.espectro.length || !ctx.fr) return null;
  var e = frecuenciasElectricas(ctx.m.FL, ctx.m.polos, ctx.fr);

  var a2FL = picoCerca_(ctx.espectro, e.dosFL, ctx.fr);
  var a1 = amp_(ctx, 1);
  var bandaSup = picoCerca_(ctx.espectro, 1 * ctx.fr + e.polePass, ctx.fr);
  var bandaInf = picoCerca_(ctx.espectro, 1 * ctx.fr - e.polePass, ctx.fr);
  var a3FL = picoCerca_(ctx.espectro, e.scr3X, ctx.fr);
  var a6FL = picoCerca_(ctx.espectro, e.scr6X, ctx.fr);

  var evid = [], subtipo = null, conf = 0;

  if (a2FL > 3 * ctx.ruido) {
    subtipo = 'Excentricidad de estator / entrehierro (2·FL)';
    conf = 65;
    evid.push('2·FL@' + e.dosFL + 'Hz (amp=' + redondear_(a2FL, 3) + ').');
  }
  if (a1 > 3 * ctx.ruido && (bandaSup > 3 * ctx.ruido || bandaInf > 3 * ctx.ruido)) {
    subtipo = 'Barras de rotor rotas (bandas pole-pass a ±' + e.polePass + 'Hz de 1X)';
    conf = Math.max(conf, 70);
    evid.push('Bandas laterales pole-pass alrededor de 1X.');
  }
  if (a3FL > 3 * ctx.ruido || a6FL > 3 * ctx.ruido) {
    subtipo = 'Defecto de SCR (3×/6× FL) — accionamiento DC';
    conf = Math.max(conf, 60);
    evid.push('Componentes a 3·FL/6·FL (' + e.scr3X + '/' + e.scr6X + ' Hz).');
  }

  if (!subtipo) return null;
  return {
    tipo: 'Motor eléctrico',
    subtipo: subtipo,
    confianza: acotar_(conf),
    severidad: 'MEDIA',
    evidencia: evid,
    accion: 'Distinguir eléctrico vs mecánico con prueba de corte de energía (los picos ' +
            'eléctricos desaparecen al instante). Revisar entrehierro, barras/anillos y ' +
            'rectificador (SCR) según el caso.'
  };
}

/* ======================== SEVERIDAD / SEMÁFORO ======================== */

function severidadPorOrden_(amp) {
  if (amp >= UMBRALES_VELOCIDAD_RMS.alarmaMax) return 'ALTA';
  if (amp >= UMBRALES_VELOCIDAD_RMS.aceptableMax) return 'MEDIA';
  return 'BAJA';
}

function severidadPorRuido_(ctx) {
  return ctx.ruido > 0 && ctx.overall > 20 * ctx.ruido ? 'MEDIA' : 'BAJA';
}

/** Semáforo global priorizando valores globales medidos (Monitoring). */
function semaforoGlobal_(global, hallazgos) {
  var color = 'VERDE', texto = 'Estado general: NORMAL';
  var g = global || {};

  var v = Number(g.vRMS);
  if (isFinite(v)) {
    if (v >= UMBRALES_VELOCIDAD_RMS.alarmaMax) { color = 'ROJO'; texto = 'Estado general: INACEPTABLE (v-RMS ' + v + ' mm/s)'; }
    else if (v >= UMBRALES_VELOCIDAD_RMS.aceptableMax) { color = 'AMARILLO'; texto = 'Estado general: VIGILAR (v-RMS ' + v + ' mm/s)'; }
    else if (v >= UMBRALES_VELOCIDAD_RMS.buenoMax) { color = 'AMARILLO'; texto = 'Estado general: ACEPTABLE-ALTO (v-RMS ' + v + ' mm/s)'; }
    else { texto = 'Estado general: BUENO (v-RMS ' + v + ' mm/s)'; }
  }

  var gse = Number(g.gSE);
  if (isFinite(gse) && gse >= UMBRALES_GSE.alarmaMax && color !== 'ROJO') {
    color = 'ROJO'; texto = 'Estado general: INACEPTABLE (gSE ' + gse + ' — rodamiento)';
  }

  // Un hallazgo de rodamiento Etapa 3+ fuerza rojo.
  hallazgos.forEach(function (h) {
    if (h.tipo === 'Rodamiento' && /3|4/.test(h.subtipo) && color !== 'ROJO') {
      color = 'ROJO'; texto = 'Estado general: INACEPTABLE (rodamiento ' + h.subtipo + ')';
    }
  });

  return { color: color, texto: texto };
}

/** Tabla de referencia de frecuencias para el reporte. */
function tablaFrecuencias_(ctx) {
  var out = { fr: redondear_(ctx.fr, 3) };
  for (var n of [0.5, 1, 1.5, 2, 3]) out['x' + n] = redondear_(n * ctx.fr, 3);
  var geo = resolverRodamiento_(ctx.m.rodamiento);
  if (geo && ctx.fr) out.rodamiento = frecuenciasRodamiento(geo, ctx.fr);
  if (ctx.m.FL && ctx.m.polos && ctx.fr) out.electricas = frecuenciasElectricas(ctx.m.FL, ctx.m.polos, ctx.fr);
  if (ctx.m.engranaje && ctx.m.engranaje.dientes) out.GMF = frecuenciaEngrane(ctx.m.engranaje.dientes, ctx.fr);
  if (ctx.m.alabes && ctx.m.alabes.n) out.BPF = frecuenciaPasoAlabes(ctx.m.alabes.n, ctx.fr);
  return out;
}

/* ============================ AUXILIARES ============================= */

function resolverRodamiento_(r) {
  if (!r) return null;
  if (typeof r === 'object') return r;                 // geo directa
  return RODAMIENTOS_REF[String(r).toUpperCase()] || RODAMIENTOS_REF[String(r)] || null;
}

function acotar_(x) { return Math.max(0, Math.min(100, Math.round(x))); }
