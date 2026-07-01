/**
 * Frecuencias.gs
 * ---------------------------------------------------------------------------
 * Calculadora de frecuencias características de falla.
 *
 * Convención: todas las frecuencias se devuelven en Hz. La frecuencia de giro
 * fr = RPM / 60. Los "órdenes" (1X, 2X, 0.5X...) son múltiplos de fr.
 * ---------------------------------------------------------------------------
 */

/** Frecuencia de giro (Hz) a partir de las RPM del eje. */
function frDesdeRPM_(rpm) {
  return rpm / 60.0;
}

/**
 * Frecuencias de defecto de rodamiento a partir de la geometría.
 * Fórmulas estándar (ángulo de contacto theta en grados):
 *   FTF  = (fr/2)·(1 − (Bd/Pd)·cosθ)
 *   BPFO = (Nb/2)·fr·(1 − (Bd/Pd)·cosθ)
 *   BPFI = (Nb/2)·fr·(1 + (Bd/Pd)·cosθ)
 *   BSF  = (Pd/(2·Bd))·fr·(1 − ((Bd/Pd)·cosθ)²)
 *   BDF (Ball Defect Freq) = 2·BSF  (un defecto en el elemento golpea 2 pistas)
 *
 * @param {{Nb:number,Bd:number,Pd:number,theta:number}} geo
 * @param {number} fr Frecuencia de giro (Hz)
 * @return {{FTF:number,BPFO:number,BPFI:number,BSF:number,BDF:number}}
 */
function frecuenciasRodamiento(geo, fr) {
  var ratio = (geo.Bd / geo.Pd) * Math.cos(gradosARad_(geo.theta || 0));
  var FTF = (fr / 2) * (1 - ratio);
  var BPFO = (geo.Nb / 2) * fr * (1 - ratio);
  var BPFI = (geo.Nb / 2) * fr * (1 + ratio);
  var BSF = (geo.Pd / (2 * geo.Bd)) * fr * (1 - ratio * ratio);
  return {
    FTF: redondear_(FTF, 2),
    BPFO: redondear_(BPFO, 2),
    BPFI: redondear_(BPFI, 2),
    BSF: redondear_(BSF, 2),
    BDF: redondear_(2 * BSF, 2)
  };
}

/**
 * Frecuencia de engrane (Gear Mesh Frequency).
 * GMF = nº de dientes · frecuencia de giro de ESE eje. Aparece con bandas
 * laterales a ±1X del eje con problema.
 */
function frecuenciaEngrane(numDientes, frEje) {
  return redondear_(numDientes * frEje, 2);
}

/**
 * Frecuencia de paso de álabes/paletas (Blade/Vane Pass Frequency).
 * BPF = nº de álabes · frecuencia de giro del impulsor. Relevante en fuerzas
 * hidráulicas/aerodinámicas.
 */
function frecuenciaPasoAlabes(numAlabes, frImpulsor) {
  return redondear_(numAlabes * frImpulsor, 2);
}

/**
 * Frecuencias eléctricas de motor.
 * FL = frecuencia de línea (50 o 60 Hz). Poles = nº de polos.
 *   fSync   = 2·FL / polos  (velocidad síncrona en Hz)
 *   slip    = fSync − fr    (deslizamiento en Hz)
 *   fPolo   = polos · slip  (Pole Pass Frequency, bandas laterales a 1X)
 *   2FL     = 2·FL          (excentricidad de estator / holgura de entrehierro)
 *   3X/6X FL (defectos de SCR en accionamientos DC)
 *
 * @param {number} FL frecuencia de línea (Hz)
 * @param {number} polos número de polos del motor
 * @param {number} fr frecuencia de giro real (Hz)
 */
function frecuenciasElectricas(FL, polos, fr) {
  var fSync = (2 * FL) / polos;
  var slip = fSync - fr;
  var fPolo = polos * slip;
  return {
    FL: redondear_(FL, 2),
    dosFL: redondear_(2 * FL, 2),
    fSync: redondear_(fSync, 2),
    slipHz: redondear_(slip, 3),
    polePass: redondear_(Math.abs(fPolo), 3),
    scr3X: redondear_(3 * FL, 2),
    scr6X: redondear_(6 * FL, 2)
  };
}

/**
 * Frecuencia de correa. Requiere longitud de correa (L), y diámetros de polea
 * motriz (D1) y conducida (D2), con la fr de la polea motriz.
 *   fCorrea = π · D1 · fr_motriz / L
 * Los defectos de correa aparecen a 1×–4× fCorrea, casi siempre sub-1X.
 */
function frecuenciaCorrea(L, D1, frMotriz) {
  var fCorrea = (Math.PI * D1 * frMotriz) / L;
  return {
    x1: redondear_(fCorrea, 3),
    x2: redondear_(2 * fCorrea, 3),
    x3: redondear_(3 * fCorrea, 3),
    x4: redondear_(4 * fCorrea, 3)
  };
}

/** Redondeo utilitario. */
function redondear_(x, dec) {
  var f = Math.pow(10, dec);
  return Math.round(x * f) / f;
}
