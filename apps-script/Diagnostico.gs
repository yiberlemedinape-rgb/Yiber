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
    ruidoAccel: ruidoDeFondo_(espectroAccel),
    limites: limitesEfectivos_(m)   // aviso/condenatorio por posición (o defaults)
  };
  // Umbral de significancia: un pico cuenta si supera 3× el piso de ruido Y
  // el 2% del pico dominante. Con listas de picos (datos brutos procesados en
  // cliente) el piso queda muy bajo y sin este segundo criterio los micro-picos
  // dispararían falsos positivos.
  ctx.sig = Math.max(3 * ctx.ruido, 0.02 * maxAmp_(espectro));
  ctx.sigAccel = Math.max(3 * ctx.ruidoAccel, 0.02 * maxAmp_(espectroAccel));

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

  var semaforo = semaforoGlobal_(m.global, hallazgos, ctx.limites);
  var frecuencias = tablaFrecuencias_(ctx);

  return {
    fr: redondear_(fr, 3),
    semaforo: semaforo.color,
    resumen: semaforo.texto + (hallazgos.length
      ? ' — Causa probable: ' + hallazgos[0].tipo +
        (hallazgos[0].subtipo ? ' (' + hallazgos[0].subtipo + ')' : '')
      : ' — Sin patrón espectral concluyente.'),
    hallazgos: hallazgos,
    frecuencias: frecuencias,
    limites: ctx.limites
  };
}

/**
 * Límites efectivos (aviso/condenatorio). Toma los de la posición (medicion.limites)
 * y cae a los defaults de Config para lo que no esté definido.
 * Velocidad en mm/s (RMS), aceleración en g (RMS), gSE en su unidad IFM.
 */
function limitesEfectivos_(m) {
  var L = (m && m.limites) || {};
  return {
    velAviso: numPos_(L.velAviso, UMBRALES_VELOCIDAD_RMS.aceptableMax),
    velCond: numPos_(L.velCond, UMBRALES_VELOCIDAD_RMS.alarmaMax),
    acelAviso: numPos_(L.acelAviso, null),
    acelCond: numPos_(L.acelCond, null),
    gseAviso: numPos_(L.gseAviso, UMBRALES_GSE.aceptableMax),
    gseCond: numPos_(L.gseCond, UMBRALES_GSE.alarmaMax)
  };
}

function numPos_(v, def) { v = Number(v); return (isFinite(v) && v > 0) ? v : def; }

/* ======================= UTILIDADES DE ESPECTRO ======================= */

function normalizarEspectro_(esp) {
  if (!esp || !esp.length) return [];
  return esp
    .map(function (p) { return [Number(p[0]), Number(p[1])]; })
    .filter(function (p) { return isFinite(p[0]) && isFinite(p[1]) && p[0] >= 0; })
    .sort(function (a, b) { return a[0] - b[0]; });
}

/** Amplitud del mayor pico dentro de la tolerancia alrededor de f (Hz).
 *  tolFrac opcional: fracción de f que anula la tolerancia por defecto
 *  (p.ej. 0.10 = ±10% para frecuencias de defecto de rodamiento). */
function picoCerca_(espectro, f, fr, tolFrac) {
  return picoCercaF_(espectro, f, fr, tolFrac).amp;
}

/** Igual que picoCerca_ pero devuelve también la frecuencia real del pico.
 *  excluirSinc=true: ignora picos síncronos (1X..12X) dentro de la ventana —
 *  así un paso de presión/armónico grande no enmascara un defecto de
 *  rodamiento que convive en la misma banda ±10%. */
function picoCercaF_(espectro, f, fr, tolFrac, excluirSinc) {
  if (!f || !espectro.length) return { amp: 0, f: 0 };
  var tol = tolFrac
    ? tolFrac * f
    : Math.max(TOLERANCIA.fraccionObjetivo * f, TOLERANCIA.fraccionGiroMin * fr, 1e-6);
  var max = 0, fMax = 0;
  for (var i = 0; i < espectro.length; i++) {
    var d = Math.abs(espectro[i][0] - f);
    if (d > tol) continue;
    if (excluirSinc && esSincrono_(espectro[i][0], fr)) continue;
    if (espectro[i][1] > max) { max = espectro[i][1]; fMax = espectro[i][0]; }
  }
  return { amp: max, f: fMax };
}

/**
 * ¿El pico es SÍNCRONO (armónico entero de fr)? Las frecuencias de defecto de
 * rodamiento son no-síncronas por naturaleza: un pico que cae en 1X..12X
 * (incluye pasos de presión y GMF) NO debe contarse como defecto de rodamiento
 * aunque entre en la ventana ±10%. Criterio: |orden − entero| < 0.03.
 */
function esSincrono_(fPico, fr) {
  if (!fr || !fPico) return false;
  var o = fPico / fr;
  var n = Math.round(o);
  return n >= 1 && n <= 12 && Math.abs(o - n) < 0.03;
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

/** Amplitud máxima del espectro (para el umbral de significancia). */
function maxAmp_(espectro) {
  var m = 0;
  for (var i = 0; i < espectro.length; i++) if (espectro[i][1] > m) m = espectro[i][1];
  return m;
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

  var dominante1X = a1 >= 2 * Math.max(a2, a3) && a1 > ctx.sig;
  if (!dominante1X) return null;
  // Un 1X limpio siempre existe: solo es hallazgo si su magnitud es relevante
  // frente al límite de aviso de la posición (≥25%).
  if (a1 < 0.25 * ctx.limites.velAviso) return null;

  var conf = 55;
  if (a1 >= 4 * Math.max(a2, a3)) conf += 20;         // 1X muy limpio
  if (ctx.dir === 'radial') conf += 15;               // radial refuerza
  if (ctx.dir === 'axial') conf -= 25;                // axial lo descarta
  conf = acotar_(conf);

  return {
    tipo: 'Desequilibrio',
    subtipo: '',
    confianza: conf,
    severidad: severidadPorOrden_(a1, ctx.limites),
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
  if (a2 <= ctx.sig) return null;
  if (a2 < 0.5 * a1) return null; // 2X debe ser significativo respecto a 1X
  if (a2 < 0.25 * ctx.limites.velAviso) return null; // magnitud irrelevante

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
  if (a3 > ctx.sig) { conf += 5; evid += ' Presencia de 3X.'; }

  return {
    tipo: 'Desalineación',
    subtipo: subtipo,
    confianza: acotar_(conf),
    severidad: severidadPorOrden_(a2, ctx.limites),
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
  for (var n = 1; n <= 6; n++) if (amp_(ctx, n) > ctx.sig) armonicos++;

  var subArm = (a05 > ctx.sig) || (a15 > ctx.sig) || (a25 > ctx.sig);
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
  var lista = resolverRodamientos_(ctx.m.rodamiento);   // [{ref, geo}]

  // Evidencia por energía de pico.
  var gSE = Number(g.gSE) || 0, HFD = Number(g.HFD) || 0;
  var energiaAlta = gSE > UMBRALES_GSE.aceptableMax || HFD > UMBRALES_HFD.aceptableMax;

  // Evidencia espectral: frecuencias de defecto de CADA rodamiento de la
  // posición, en cada mitad del espectro. Aparecen PRIMERO en aceleración (mg)
  // — defecto incipiente — y luego migran al espectro de velocidad (mm/s) al
  // agravarse (Carta de Charlotte).
  var defVel = [];      // pista/elemento (BPFO/BPFI/BSF) en velocidad → daño real
  var defVelFTF = [];   // solo FTF en velocidad → jaula o fuente sub-síncrona
  var defAccel = [];    // solo en aceleración → incipiente
  var racesFuertes = 0; // pista/elemento con amplitud significativa
  // Umbral de "significativo" para condenar: además del umbral de ruido, la
  // línea de defecto debe alcanzar el 10% del límite de aviso en velocidad.
  var umbralFuerte = Math.max(ctx.sig, 0.1 * ctx.limites.velAviso);

  lista.forEach(function (rod) {
    if (!rod.geo || !ctx.fr) return;
    var frec = frecuenciasRodamiento(rod.geo, ctx.fr);
    var tag = lista.length > 1 ? rod.ref + ' ' : '';
    var tolRod = TOLERANCIA.fraccionRodamiento;   // ±10% (criterio de campo)
    ['BPFO', 'BPFI', 'BSF', 'FTF'].forEach(function (k) {
      // Solo picos NO-síncronos: 1X..12X (incluye PP/GMF) no son rodamiento.
      var pV = ctx.espectro.length ? picoCercaF_(ctx.espectro, frec[k], ctx.fr, tolRod, true) : { amp: 0, f: 0 };
      var pA = ctx.espectroAccel.length ? picoCercaF_(ctx.espectroAccel, frec[k], ctx.fr, tolRod, true) : { amp: 0, f: 0 };
      if (pV.amp > ctx.sig) {
        var txt = tag + k + '@' + frec[k] + 'Hz vel(' + redondear_(pV.amp, 3) + ' en ' + redondear_(pV.f, 1) + 'Hz)';
        if (k === 'FTF') defVelFTF.push(txt);
        else { defVel.push(txt); if (pV.amp >= umbralFuerte) racesFuertes++; }
      } else if (pA.amp > ctx.sigAccel) {
        defAccel.push(tag + k + '@' + frec[k] + 'Hz acc(' + redondear_(pA.amp, 3) + ' en ' + redondear_(pA.f, 1) + 'Hz)');
      }
    });
  });
  var defectos = defVel.concat(defVelFTF).concat(defAccel);

  if (!energiaAlta && !defectos.length) return null;

  // Estadificación (Carta de Charlotte + criterios de campo):
  //  - Condenar (Etapa 3) exige defecto de PISTA/ELEMENTO significativo en
  //    velocidad; la FTF sola es señal de jaula O de una fuente sub-síncrona
  //    externa (ventilador/bomba/correa) transmitida — verificar, no condenar.
  var etapa, accion, conf = 55, condenatorio = false;
  if (racesFuertes && (gSE > UMBRALES_GSE.alarmaMax || racesFuertes >= 2)) {
    etapa = 'Etapa 3';
    accion = 'REEMPLAZAR DE INMEDIATO. Defectos de pista/elemento significativos en el ' +
             'espectro de VELOCIDAD.';
    conf = 82; condenatorio = true;
  } else if (defVel.length) {
    etapa = 'Etapa 2–3';
    accion = 'Programar reemplazo a corto plazo. Defecto de pista/elemento ya presente en ' +
             'velocidad (amplitud aún moderada); aumentar la frecuencia de monitoreo y tendenciar.';
    conf = 74;
  } else if (defVelFTF.length) {
    etapa = 'Etapa 2 (jaula / fuente sub-síncrona)';
    accion = 'Línea(s) en la ventana FTF sin defectos de pista/elemento. Puede ser desgaste ' +
             'de jaula O una fuente sub-síncrona externa transmitida (ventilador, bomba, ' +
             'correa). VERIFICAR en campo la velocidad de los auxiliares antes de intervenir; ' +
             'tendenciar la línea y su tren de armónicos.';
    conf = 62;
  } else if (defAccel.length) {
    etapa = 'Etapa 2';
    accion = 'Defecto discreto visible en ACELERACIÓN (mg) con bandas laterales, aún no ' +
             'en velocidad. Programar reemplazo y vigilar evolución.';
    conf = 70;
  } else if (gSE > UMBRALES_GSE.alarmaMax || HFD > UMBRALES_HFD.alarmaMax) {
    etapa = 'Etapa 3–4';
    accion = 'REEMPLAZAR. Energía de pico muy alta sin líneas discretas claras: posible ' +
             'daño avanzado/ruido aleatorio de banda ancha.';
    conf = 72; condenatorio = true;
  } else {
    etapa = 'Etapa 1';
    accion = 'Vigilar. Elevación ultrasónica (gSE/HFD) sin líneas discretas. Revisar lubricación.';
    conf = 60;
  }

  var evid = [];
  if (gSE) evid.push('gSE=' + gSE + ' (alarma>' + UMBRALES_GSE.alarmaMax + ')');
  if (HFD) evid.push('HFD=' + HFD + ' g (alarma>' + UMBRALES_HFD.alarmaMax + ')');
  if (defVel.length) evid.push('Pista/elemento en velocidad: ' + defVel.join(', '));
  if (defVelFTF.length) evid.push('Ventana FTF en velocidad: ' + defVelFTF.join(', '));
  if (defAccel.length) evid.push('Defectos en aceleración: ' + defAccel.join(', '));
  if (!lista.length) evid.push('Sin datos de rodamiento: solo se evalúa energía de pico.');

  return {
    tipo: 'Rodamiento',
    subtipo: etapa,
    confianza: acotar_(conf),
    severidad: condenatorio ? 'ALTA' : (etapa.indexOf('1') === 6 ? 'BAJA' : 'MEDIA'),
    condenatorio: condenatorio,
    evidencia: evid,
    accion: accion
  };
}

/** Engranajes: GMF con bandas laterales a ±1X del eje. */
function reglaEngranajes_(ctx) {
  if (!ctx.m.engranaje || !ctx.m.engranaje.dientes || !ctx.espectro.length) return null;
  var gmf = frecuenciaEngrane(ctx.m.engranaje.dientes, ctx.fr);
  var aG = picoCerca_(ctx.espectro, gmf, ctx.fr);
  if (aG <= ctx.sig) return null;

  var bandaSup = picoCerca_(ctx.espectro, gmf + ctx.fr, ctx.fr);
  var bandaInf = picoCerca_(ctx.espectro, gmf - ctx.fr, ctx.fr);
  var conBandas = (bandaSup > ctx.sig) || (bandaInf > ctx.sig);

  return {
    tipo: 'Engranaje',
    subtipo: conBandas ? 'GMF con bandas laterales ±1X' : 'GMF elevada',
    confianza: acotar_(conBandas ? 72 : 60),
    severidad: severidadPorOrden_(aG, ctx.limites),
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
    if (aB > ctx.sig) {
      out = {
        tipo: 'Fuerza hidráulica',
        subtipo: 'BPF (paso de álabes)',
        confianza: 65,
        severidad: severidadPorOrden_(aB, ctx.limites),
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
    if (a > ctx.sig) hits.push(k + '@' + f[k] + 'Hz');
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

  if (a2FL > ctx.sig) {
    subtipo = 'Excentricidad de estator / entrehierro (2·FL)';
    conf = 65;
    evid.push('2·FL@' + e.dosFL + 'Hz (amp=' + redondear_(a2FL, 3) + ').');
  }
  if (a1 > ctx.sig && (bandaSup > ctx.sig || bandaInf > ctx.sig)) {
    subtipo = 'Barras de rotor rotas (bandas pole-pass a ±' + e.polePass + 'Hz de 1X)';
    conf = Math.max(conf, 70);
    evid.push('Bandas laterales pole-pass alrededor de 1X.');
  }
  if (a3FL > ctx.sig || a6FL > ctx.sig) {
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

function severidadPorOrden_(amp, L) {
  L = L || limitesEfectivos_({});
  if (amp >= L.velCond) return 'ALTA';
  if (amp >= L.velAviso) return 'MEDIA';
  return 'BAJA';
}

function severidadPorRuido_(ctx) {
  return ctx.ruido > 0 && ctx.overall > 20 * ctx.ruido ? 'MEDIA' : 'BAJA';
}

/** Ranking de colores para quedarnos con el peor. */
function peorColor_(a, b) {
  var r = { VERDE: 0, AMARILLO: 1, ROJO: 2 };
  return (r[b] > r[a]) ? b : a;
}

/**
 * Semáforo global contra los límites de la posición: aviso (amarillo) y
 * condenatorio (rojo), en velocidad (mm/s), aceleración (g RMS) y gSE.
 */
function semaforoGlobal_(global, hallazgos, L) {
  L = L || limitesEfectivos_({});
  var g = global || {};
  var color = 'VERDE', motivos = [];

  function evaluar(valor, aviso, cond, etiqueta, unidad) {
    if (!isFinite(valor)) return;
    if (cond && valor >= cond) {
      color = peorColor_(color, 'ROJO');
      motivos.push(etiqueta + ' ' + redondear_(valor, 2) + unidad + ' ≥ condenatorio ' + cond);
    } else if (aviso && valor >= aviso) {
      color = peorColor_(color, 'AMARILLO');
      motivos.push(etiqueta + ' ' + redondear_(valor, 2) + unidad + ' ≥ aviso ' + aviso);
    }
  }

  evaluar(Number(g.vRMS), L.velAviso, L.velCond, 'v-RMS', ' mm/s');
  evaluar(Number(g.aRMS), L.acelAviso, L.acelCond, 'a-RMS', ' g');
  evaluar(Number(g.gSE), L.gseAviso, L.gseCond, 'gSE', '');

  // Rodamiento condenatorio (Etapa 3/3–4) fuerza rojo; etapas intermedias
  // (2, 2–3, jaula) elevan al menos a amarillo.
  hallazgos.forEach(function (h) {
    if (h.tipo !== 'Rodamiento') return;
    if (h.condenatorio) {
      color = peorColor_(color, 'ROJO');
      motivos.push('rodamiento ' + h.subtipo);
    } else if (h.subtipo.indexOf('Etapa 2') === 0) {
      color = peorColor_(color, 'AMARILLO');
      motivos.push('rodamiento ' + h.subtipo);
    }
  });

  var estado = color === 'ROJO' ? 'INACEPTABLE / CONDENATORIO'
    : color === 'AMARILLO' ? 'VIGILAR (nivel de aviso)' : 'NORMAL';
  return { color: color, texto: 'Estado general: ' + estado + (motivos.length ? ' — ' + motivos.join('; ') : '') };
}

/** Tabla de referencia de frecuencias para el reporte. */
function tablaFrecuencias_(ctx) {
  var out = { fr: redondear_(ctx.fr, 3) };
  for (var n of [0.5, 1, 1.5, 2, 3]) out['x' + n] = redondear_(n * ctx.fr, 3);
  var lista = resolverRodamientos_(ctx.m.rodamiento);
  if (lista.length && ctx.fr) {
    if (lista.length === 1) {
      out.rodamiento = frecuenciasRodamiento(lista[0].geo, ctx.fr);
    } else {
      out.rodamientos = {};
      lista.forEach(function (rod) {
        if (rod.geo) out.rodamientos[rod.ref] = frecuenciasRodamiento(rod.geo, ctx.fr);
      });
    }
  }
  if (ctx.m.FL && ctx.m.polos && ctx.fr) out.electricas = frecuenciasElectricas(ctx.m.FL, ctx.m.polos, ctx.fr);
  if (ctx.m.engranaje && ctx.m.engranaje.dientes) out.GMF = frecuenciaEngrane(ctx.m.engranaje.dientes, ctx.fr);
  if (ctx.m.alabes && ctx.m.alabes.n) out.BPF = frecuenciaPasoAlabes(ctx.m.alabes.n, ctx.fr);
  return out;
}

/* ============================ AUXILIARES ============================= */

/**
 * Resuelve la definición de rodamiento(s) a una lista [{ref, geo}].
 * Acepta: array [{ref,geo}] ya resuelto (BD), objeto geo directo, referencia
 * simple ('6208') o lista separada por comas ('NU206E,NA4904').
 * Las referencias con geo nulo se conservan (energía de pico sigue aplicando).
 */
function resolverRodamientos_(r) {
  if (!r) return [];
  if (Array.isArray(r)) {
    return r.filter(function (x) { return x && (x.geo || x.ref); });
  }
  if (typeof r === 'object') return [{ ref: '(geo)', geo: r }];
  return String(r).split(',')
    .map(function (x) { return x.trim(); })
    .filter(String)
    .map(function (x) {
      return { ref: x, geo: RODAMIENTOS_REF[x.toUpperCase()] || RODAMIENTOS_REF[x] || null };
    });
}

function acotar_(x) { return Math.max(0, Math.min(100, Math.round(x))); }
