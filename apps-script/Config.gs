/**
 * Config.gs
 * ---------------------------------------------------------------------------
 * Catálogo de conocimiento técnico para diagnóstico de vibraciones Kaeser.
 *
 * Fuentes cruzadas:
 *   - Instrucción de montaje Kaeser MA 00-21-02.2 (Vibration diagnostics kit).
 *   - Convenciones de software IFM Octavis VES004 / VSE100.
 *   - Carta de Charlotte (Technical Associates of Charlotte) para el motor
 *     de diagnóstico espectral.
 *
 * Todo el contenido de este archivo es "configuración pura" (sin efectos
 * secundarios) para que sea fácil de auditar y de calibrar por el analista.
 * ---------------------------------------------------------------------------
 */

/** Nombres de hojas del libro de trabajo. */
var HOJAS = {
  EQUIPOS: 'Equipos',
  POSICIONES: 'Posiciones',          // fuente de verdad por sensor: rodamiento, velocidad, límites
  UNIDADES: 'UnidadesCompresoras',   // catálogo maestro de airends (para poblar)
  MOTORES: 'Motores',                // catálogo maestro de motores (para poblar)
  SENSORES: 'Sensores',
  MEDICIONES: 'Mediciones',
  ESPECTROS: 'Espectros',
  DIAGNOSTICO: 'Diagnostico',
  UMBRALES: 'Umbrales',
  RODAMIENTOS: 'Rodamientos'
};

/**
 * Mapa de montaje de sensores por familia de equipo.
 * Tomado literalmente de MA 00-21-02.2 §5.1 (CSG–FSG) y §5.2 (CSD–HSD).
 * `tipo` = referencia del sensor IFM (VSA201 acelerómetro de alta frecuencia
 * para etapas/rotores; VSA001 para motor/gearbox).
 */
var MONTAJE_SENSORES = {
  DRY_SCREW: {
    etiqueta: 'Dry Screw (CSG / DSG / FSG)',
    series: ['CSG', 'DSG', 'FSG'],
    sensores: [
      { n: 1, pos: 'Etapa 1 — extremo no impulsor', tipo: 'VSA201' },
      { n: 2, pos: 'Etapa 2 — extremo no impulsor', tipo: 'VSA201' },
      { n: 3, pos: 'Gear Box', tipo: 'VSA001' },
      { n: 4, pos: 'Motor lado DE (carcasa, no en la rejilla del ventilador)', tipo: 'VSA001' }
    ],
    nota: 'CSG requiere adaptador 214356.0 para el sensor 2. Máquinas <2019 sin ' +
          'roscas de fábrica en el motor: preparar M8 con avellanado 90° o usar ' +
          'imanes de zapato (incluidos en el kit).'
  },
  LUBRICADO: {
    etiqueta: 'Lubricado (CSD … HSD)',
    series: ['CSD', 'CSDX', 'DSD', 'DSDX', 'ESD', 'FSD', 'HSD', 'ASD', 'BSD'],
    sensores: [
      { n: 1, pos: 'Motor lado B (carcasa, no en la rejilla del ventilador)', tipo: 'VSA001' },
      { n: 2, pos: 'Motor lado A (lado acople)', tipo: 'VSA001' },
      { n: 3, pos: 'Rotor macho — lado admisión / acople', tipo: 'VSA201' },
      { n: 4, pos: 'Rotor macho — lado compresión / libre', tipo: 'VSA201' }
    ],
    nota: 'Ver figuras 6–10 del manual para posiciones específicas por serie.'
  }
};

/** Requisitos de montaje mecánico (MA 00-21-02.2 §5). */
var MONTAJE_REQUISITOS = {
  torqueNm: 9,
  avellanado: 'Avellanados en las roscas limpios y libres de pintura.',
  conoGrados: 90,
  imanZapato: 'Motores anteriores a 2019 sin roscas de fábrica: usar imanes de zapato.',
  senalVelocidad: 'Conexión 4–20 mA solo necesaria en máquinas con variador de frecuencia.'
};

/**
 * Criterios de aceptación de la toma de datos en VES004.
 * OJO (discrepancia de versiones): la revisión MA 00-21-02.2 del 24.11.2025
 * indica mín. 300 muestras en Monitoring y mín. 4·10^6 en Raw Data.
 * Se dejan ambos por si el parameter set de campo exige más.
 */
var CRITERIOS_TOMA = {
  monitoringMuestrasMin: 300,
  rawMuestrasMin: 4000000,
  espectroMuestrasMin: 100,
  espectroPrimeraMitad: 'mg (aceleración)',
  espectroSegundaMitad: 'mm/s (velocidad)'
};

/**
 * Umbrales de severidad para velocidad global RMS (mm/s), estilo ISO 10816-3.
 * Son VALORES POR DEFECTO. En Kaeser los umbrales reales vienen en el
 * parameter set (semáforo del VES004); estos se pueden sobreescribir en la
 * hoja "Umbrales".
 *
 * Grupo por defecto: máquinas medianas rígidas.  A=verde, C=amarillo, D=rojo.
 */
var UMBRALES_VELOCIDAD_RMS = {
  // mm/s: [límite bueno(A/B), límite aceptable(B/C), límite alarma(C/D)]
  buenoMax: 2.8,      // verde
  aceptableMax: 4.5,  // aún operable / vigilar
  alarmaMax: 7.1      // > = rojo (inaceptable)
};

/** Umbrales por defecto para energía de pico (gSE / Spike Energy) del rodamiento. */
var UMBRALES_GSE = {
  buenoMax: 0.5,      // verde
  aceptableMax: 2.0,  // amarillo (Etapa 1–2 incipiente)
  alarmaMax: 4.0      // rojo (Etapa 3+, reemplazar)
};

/** Umbrales por defecto para HFD (High Frequency Detection, g). */
var UMBRALES_HFD = {
  buenoMax: 3.0,
  aceptableMax: 6.0,
  alarmaMax: 10.0
};

/**
 * Rodamientos de referencia para el cálculo de frecuencias de defecto.
 * Dos formas de definición (ver frecuenciasRodamiento):
 *  - Coeficientes del fabricante (órdenes/rev): coefBPFI, coefBPFO, coefBSF, Nb.
 *    Es el formato de las tablas de análisis predictivo de campo (Excel SK20).
 *  - Geometría: Nb, Bd (mm), Pd (mm), theta (°).
 * Se pueden añadir/sobrescribir en la hoja "Rodamientos".
 *
 * Los coeficientes NU206E…6308 provienen de la tabla "Frecuencias SK20
 * Sigma 10 star delta" (Kaeser Colombia).
 */
var RODAMIENTOS_REF = {
  // — Coeficientes de la tabla SK20 Sigma 10 —
  'NU206E': { coefBPFI: 7.756, coefBPFO: 5.242, coefBSF: 2.487, Nb: 13 },
  'NA4904': { coefBPFI: 8.535, coefBPFO: 6.466, coefBSF: 3.556, Nb: 15 },
  '7305': { coefBPFI: 6.057, coefBPFO: 3.943, coefBSF: 1.732, Nb: 10 },
  'NU205E': { coefBPFI: 7.75, coefBPFO: 5.25, coefBSF: 2.504, Nb: 13 },
  '7205': { coefBPFI: 7.527, coefBPFO: 5.473, coefBSF: 2.365, Nb: 13 },
  '6208': { coefBPFI: 4.927, coefBPFO: 3.073, coefBSF: 4.082, Nb: 8 },
  '6308': { coefBPFI: 4.433, coefBPFO: 2.567, coefBSF: 3.485, Nb: 7 },
  // — Geometría (marcadores de posición; sustituir por datos reales) —
  '6210': { Nb: 10, Bd: 12.7, Pd: 70.0, theta: 0 },
  '6312': { Nb: 8, Bd: 22.2, Pd: 92.5, theta: 0 },
  'NU2216': { Nb: 13, Bd: 18.0, Pd: 108.0, theta: 0 },
  '7310': { Nb: 11, Bd: 16.0, Pd: 80.0, theta: 40 }
};

/**
 * Datos de EJEMPLO para sembrar la base de datos (se reemplazan por los reales
 * de Kaeser Colombia). Los valores de rodamientos, relaciones y límites NO son
 * de referencia oficial: son marcadores de posición para mostrar la estructura.
 */
var SEED = {
  // Equipos: TAG | Serie | Familia | Airend | Motor | RPM_motor | Variador | FL_Hz | Polos | Arranque | Notas
  equipos: [
    ['CSD-102', 'CSD 105', 'LUBRICADO', 'SIGMA-CSD105', 'MOT-45KW-2P', 2970, 'No', 60, 2, 'Estrella-Triángulo', 'EJEMPLO — reemplazar por datos reales'],
    ['DSG-220', 'DSG 220-2', 'DRY_SCREW', 'AIR-DSG220', 'MOT-160KW-2P', 3560, 'Sí', 60, 2, 'SFC (variador)', 'EJEMPLO — máquina engranada de 2 etapas'],
    ['SK20-01', 'SK 20 Sigma 10', 'LUBRICADO', 'SIGMA-10', 'MOT-SK20-2P', 3565, 'No', 60, 2, 'Estrella-Triángulo', 'Transmisión por correa: poleas 142/123 mm → relación 1.1545. Datos de la tabla de frecuencias SK20.']
  ],
  // Posiciones: TAG | Sensor | Posicion | Unidad | Rodamiento | Relacion_vel | Vel_aviso | Vel_cond | Acel_aviso_g | Acel_cond_g | gSE_aviso | gSE_cond | N_lobulos | N_dientes
  posiciones: [
    // CSD lubricado (acople directo, relación 1.0)
    ['CSD-102', 1, 'Motor lado B (NDE)', 'motor', '6210', 1.0, 2.8, 4.5, 2.0, 4.0, 1.0, 3.0, '', ''],
    ['CSD-102', 2, 'Motor lado A (acople)', 'motor', '6208', 1.0, 2.8, 4.5, 2.0, 4.0, 1.0, 3.0, '', ''],
    ['CSD-102', 3, 'Rotor macho admisión', 'airend', 'NU2216', 1.0, 4.5, 7.1, 3.0, 6.0, 1.5, 4.0, 5, ''],
    ['CSD-102', 4, 'Rotor macho compresión', 'airend', 'NU2216', 1.0, 4.5, 7.1, 3.0, 6.0, 1.5, 4.0, 5, ''],
    // DSG dry screw (etapas multiplicadas por engranaje)
    ['DSG-220', 1, 'Etapa 1 (no impulsor)', 'airend', '7310', 3.20, 4.5, 7.1, 4.0, 8.0, 2.0, 5.0, 3, 37],
    ['DSG-220', 2, 'Etapa 2 (no impulsor)', 'airend', '7310', 5.10, 4.5, 7.1, 4.0, 8.0, 2.0, 5.0, 3, 37],
    ['DSG-220', 3, 'Gear Box', 'gearbox', '6312', 1.0, 2.8, 4.5, 3.0, 6.0, 1.5, 4.0, '', 37],
    ['DSG-220', 4, 'Motor lado DE', 'motor', '6312', 1.0, 2.8, 4.5, 2.0, 4.0, 1.0, 3.0, '', ''],
    // SK20 Sigma 10: correa 142/123 → tornillo a 1.1545× motor (59.4 → 68.6 Hz).
    // Varias referencias por posición separadas por coma. Lóbulos=5 (pasos de
    // presión 343 Hz = 5 × 68.6). Límites de EJEMPLO: cargar los reales.
    ['SK20-01', 1, 'Motor lado B (NDE)', 'motor', '6308', 1.0, 2.8, 4.5, 2.0, 4.0, 1.0, 3.0, '', ''],
    ['SK20-01', 2, 'Motor lado A (polea)', 'motor', '6208', 1.0, 2.8, 4.5, 2.0, 4.0, 1.0, 3.0, '', ''],
    ['SK20-01', 3, 'Airend admisión (macho+hembra)', 'airend', 'NU206E,NA4904', 1.1545, 4.5, 7.1, 3.0, 6.0, 1.5, 4.0, 5, ''],
    ['SK20-01', 4, 'Airend compresión (macho+hembra)', 'airend', 'NU206E,7305,NU205E,7205', 1.1545, 4.5, 7.1, 3.0, 6.0, 1.5, 4.0, 5, '']
  ],
  // UnidadesCompresoras: Codigo | Familia | Rod_admision | Rod_compresion | N_lobulos | N_dientes | Relacion_default
  unidades: [
    ['SIGMA-CSD105', 'LUBRICADO', 'NU2216', 'NU2216', 5, '', 1.0],
    ['AIR-DSG220', 'DRY_SCREW', '7310', '7310', 3, 37, 3.20],
    ['SIGMA-10', 'LUBRICADO', 'NU206E,NA4904', 'NU206E,7305,NU205E,7205', 5, '', 1.1545]
  ],
  // Motores: Codigo | Rod_DE | Rod_NDE | Polos
  motores: [
    ['MOT-45KW-2P', '6208', '6210', 2],
    ['MOT-160KW-2P', '6312', '6312', 2],
    ['MOT-SK20-2P', '6208', '6308', 2]
  ]
};

/** Convierte grados a radianes. */
function gradosARad_(g) { return g * Math.PI / 180; }

/**
 * Tolerancia de emparejamiento de picos: cuánto puede desviarse un pico medido
 * respecto de una frecuencia objetivo para considerarlo "el mismo".
 * Se usa la mayor entre un % del objetivo y un % de la frecuencia de giro.
 */
var TOLERANCIA = {
  fraccionObjetivo: 0.03,  // ±3% de la frecuencia objetivo
  fraccionGiroMin: 0.05    // o ±5% de fr, lo que sea mayor
};
