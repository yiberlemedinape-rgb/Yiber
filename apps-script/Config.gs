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
 * Geometría de rodamientos de referencia para el cálculo de frecuencias de
 * defecto. Se pueden añadir más en la hoja "Rodamientos".
 * Nb=nº elementos, Bd=diámetro elemento, Pd=diámetro primitivo (paso),
 * theta=ángulo de contacto (grados). Coeficientes BPFO/BPFI/BSF/FTF por
 * revolución precalculados a partir de la geometría.
 */
var RODAMIENTOS_REF = {
  '6208': { Nb: 9, Bd: 12.0, Pd: 60.0, theta: 0 },
  '6210': { Nb: 10, Bd: 12.7, Pd: 70.0, theta: 0 },
  '6312': { Nb: 8, Bd: 22.2, Pd: 92.5, theta: 0 },
  'NU2216': { Nb: 13, Bd: 18.0, Pd: 108.0, theta: 0 },
  '7310': { Nb: 11, Bd: 16.0, Pd: 80.0, theta: 40 }
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
