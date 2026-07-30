/**
 * Config.gs
 * ---------------------------------------------------------------------------
 * Configuración pura del ecosistema de Informes Semanales de Kaeser Compresores.
 *
 * Este archivo NO tiene efectos secundarios: sólo declara constantes y el
 * ESQUEMA de cada hoja. Es la única fuente de verdad para:
 *
 *   - Qué hoja corresponde a cada cargo de la hoja "Usuario".
 *   - Qué columna de la hoja corresponde a cada campo del formulario.
 *   - Qué tipo de control se dibuja en la interfaz web (campo simple o tabla).
 *   - Qué métricas se extraen automáticamente hacia la hoja "KPI_Datos".
 *
 * Para agregar/quitar un campo basta con editar ESQUEMA aquí: la interfaz web,
 * el guardado, la lectura, los KPI y el informe gerencial se adaptan solos.
 * ---------------------------------------------------------------------------
 */

var CONFIG = {
  /** Zona horaria usada para calcular año y número de semana ISO. */
  ZONA_HORARIA: 'America/Bogota',

  /** Hojas de apoyo (no son formularios). */
  HOJA_USUARIOS: 'Usuario',
  HOJA_KPI: 'KPI_Datos',

  /** Encabezados fijos de las tres primeras columnas de todo formulario. */
  ENCABEZADOS_BASE: ['Año', 'N° de Semana', 'Nombre del Colaborador'],

  /** Encabezados de la hoja KPI_Datos. */
  ENCABEZADOS_KPI: ['Año', 'N° de Semana', 'Área', 'Nombre', 'Métrica', 'Valor'],

  /** Separadores usados para guardar tablas dentro de una sola celda. */
  SEP_FILA: '\n',
  SEP_COL: ' | ',

  /** Cuántas semanas hacia atrás puede corregir un colaborador. */
  SEMANAS_EDITABLES: 6,

  /** Días de demora a partir de los cuales una OS se considera crítica. */
  UMBRAL_DIAS_DEMORA: 5,

  /** Propiedades de script (Configuración → Propiedades del script). */
  PROP_CORREO_GERENTE: 'CORREO_GERENTE',
  PROP_COPIA_INFORME: 'CORREO_COPIA',
  PROP_API_KEY: 'GEMINI_API_KEY',
  PROP_MODELO: 'MODELO_IA',

  /**
   * Cargo que otorga el rol de Administrador.
   *
   * El rol se decide por la columna "Cargo" de la hoja "Usuario" y por nada más:
   * cambiar ahí el cargo de alguien le da o le quita el permiso de inmediato, sin
   * tocar código ni propiedades de script. Es el mismo sitio donde ya se decide
   * qué formulario ve cada persona, así que hay un solo lugar que mantener.
   */
  CARGO_ADMIN: 'Administrador',

  /**
   * Modelo usado para redactar el informe gerencial cuando hay API key.
   * Se puede cambiar sin tocar código con la propiedad MODELO_IA.
   */
  MODELO_IA_POR_DEFECTO: 'gemini-2.5-flash',

  /** Base del endpoint de la API de Gemini (Google AI). */
  API_URL_BASE: 'https://generativelanguage.googleapis.com/v1beta/models/',

  /** Presupuesto de razonamiento del modelo (0 lo desactiva; -1 lo deja dinámico). */
  IA_PRESUPUESTO_RAZONAMIENTO: 1024,

  /** Techo de tokens de salida (incluye los tokens de razonamiento). */
  IA_MAX_TOKENS: 16384,

  /* ---------- Adjuntos en Google Drive ---------- */

  /**
   * Carpeta raíz donde se guardan las imágenes y tablas adjuntas.
   * Es el ID de la carpeta compartida por la gerencia. Se puede sustituir sin
   * tocar código con la propiedad de script CARPETA_DRIVE.
   */
  DRIVE_CARPETA_RAIZ: '16WlySidso2CAA5TwFklWmR-p4axkYb4N',
  PROP_CARPETA_DRIVE: 'CARPETA_DRIVE',

  /** Peso máximo por archivo adjunto (MB). */
  ADJUNTO_MAX_MB: 8,

  /** Tipos aceptados como imagen. */
  ADJUNTO_MIMES_IMAGEN: ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'],

  /**
   * Cuántas imágenes se envían a Gemini y cuánto pueden pesar en total.
   *
   * Gemini no lee carpetas de Drive: los bytes viajan dentro de la petición
   * (`inline_data`), y una petición con datos en línea no debe superar ~20 MB.
   * Estos topes dejan margen para el texto del informe.
   */
  IA_MAX_IMAGENES: 12,
  IA_MAX_MB_IMAGENES: 14,

  /**
   * Qué ve el Administrador en la interfaz web.
   *
   * false (por defecto): sólo el panel del informe gerencial — vista previa del
   *   correo y botón de envío. No se le muestra ningún formulario.
   * true: además de ese panel, se le muestra el formulario de su área.
   *
   * El cargo "Administrador" a secas no corresponde a ninguna área, así que esta
   * opción sólo cambia algo cuando el cargo nombra las dos cosas —por ejemplo
   * "Administrador SAU"—, que es como se registra a quien administra el sistema
   * y además debe entregar su propio reporte semanal.
   */
  ADMIN_TAMBIEN_REPORTA: false,

  /* ---------- Cuándo sale el informe ----------
   *
   * El horario vive aquí y no repartido por el código: cambiarlo es editar
   * estas tres líneas y volver a ejecutar "Instalar envío automático".
   * `ENVIO_DIA` es una clave de ScriptApp.WeekDay (MONDAY … SUNDAY) y
   * `ENVIO_HORA` está en formato 24 h, interpretada en CONFIG.ZONA_HORARIA.
   *
   * El día elegido debe caer de lunes a domingo de la MISMA semana ISO que se
   * quiere reportar, porque el disparador informa siempre la semana en curso.
   * Viernes cumple: pertenece a la semana que cierra.
   */
  ENVIO_DIA: 'FRIDAY',
  ENVIO_HORA: 6,
  ENVIO_ETIQUETA: 'viernes 6:00 a. m.',

  /** Asunto del correo semanal. */
  ASUNTO_INFORME: 'Informe Gerencial Semanal — Kaeser Compresores'
};

/**
 * Directrices de análisis y redacción entregadas al modelo.
 * Reproducen literalmente el estándar acordado con la gerencia.
 */
var DIRECTRICES_INFORME =
  'Eres el analista que consolida el informe gerencial semanal de Kaeser ' +
  'Compresores (Colombia).\n\n' +
  'TONO: ejecutivo, objetivo, analítico y orientado a la toma de decisiones.\n\n' +
  'FORMATO: Markdown. Usa viñetas para facilitar la lectura y negritas para ' +
  'resaltar nombres de clientes, valores monetarios ($) y números de equipo (EMR).\n\n' +
  'ESTRUCTURA OBLIGATORIA (usa exactamente estos seis títulos, en este orden):\n' +
  '## 📋 RESUMEN EJECUTIVO (Semana Actual)\n' +
  'Un párrafo conciso con el pulso general de la operación y las ventas a nivel nacional.\n' +
  '## 🧭 DIRECCIÓN — TEMAS REPORTADOS POR LOS DIRECTORES\n' +
  'Desarrollo detallado de lo que reportó cada director, agrupado **por director** ' +
  '(un subtítulo "### <nombre>" por cada uno). Bajo cada director, un bloque por ' +
  'cada tema que haya reportado, con el mismo nombre con que lo entregó: ' +
  'Novedades de Personal y Desempeño, Visitas a Clientes y Actividades, Equipos ' +
  'Detenidos / Novedades, Métricas Clave, Órdenes Importantes Recibidas, Estado ' +
  'de Contratos (Convenios) y Notas Crédito, Quejas y Reclamos.\n' +
  '- Esta sección es EXHAUSTIVA: no resumas ni descartes un tema por parecer ' +
  'menor. Si un director reportó ocho visitas, van las ocho.\n' +
  '- Las tablas que entregaron —equipos detenidos, métricas clave, estado de ' +
  'contratos, órdenes— reprodúcelas como **tablas Markdown**, con sus columnas ' +
  'originales y sus valores exactos. Una cifra en tabla es auditable; disuelta en ' +
  'un párrafo, no.\n' +
  '- Después de cada tabla, una o dos viñetas con la lectura gerencial de esos ' +
  'datos: qué cambia, qué exige decisión. Ese análisis es tuyo; las cifras no.\n' +
  '- Si un director no reportó un tema, escribe "Sin novedades reportadas" en vez ' +
  'de omitir el encabezado: el vacío también es información para la gerencia.\n' +
  '## 🚨 ALERTAS CRÍTICAS Y CUELLOS DE BOTELLA\n' +
  'Equipos detenidos críticos (SAU / Directores / Soporte Técnico), OS con demoras ' +
  'severas (DPA), riesgos comerciales (KAM) y problemas de personal o vacantes críticas.\n' +
  '## 💰 GESTIÓN COMERCIAL Y KAM\n' +
  'Facturación vs. forecast, órdenes importantes cerradas, distribuidores ' +
  'internacionales y estado de las negociaciones de alto impacto.\n' +
  '## ⚙️ OPERACIONES, SAU Y SOPORTE TÉCNICO\n' +
  'First Time Fix Rate (FTF), efectividad de DPA, flujo de taller CDR ' +
  '(ingresos/reprocesos) y novedades del centro de monitoreo.\n' +
  '## 👥 DESARROLLO DE PERSONAL\n' +
  'Avance en contrataciones y resumen de capacitaciones técnicas impartidas.\n\n' +
  'VERACIDAD — LA REGLA QUE MANDA SOBRE TODAS LAS DEMÁS:\n' +
  'Este informe se lee para tomar decisiones sobre dinero, clientes y personas. ' +
  'Una cifra inventada es peor que una cifra ausente, porque nadie la audita hasta ' +
  'que ya se decidió con ella. Antes de escribir cualquier dato, comprueba que ' +
  'esté literalmente en el JSON o en una imagen que te fue entregada.\n' +
  '- **Está prohibido inventar, estimar, aproximar o completar.** Ni cifras, ni ' +
  'nombres de clientes, ni números de equipo (EMR), ni fechas, ni porcentajes, ni ' +
  'nombres de personas, ni causas de una falla.\n' +
  '- **No calcules cifras nuevas.** Nada de totales, promedios, variaciones, ' +
  'proyecciones ni porcentajes que no vengan dados. Si la gerencia necesita un ' +
  'total que no está reportado, es más útil que lo note a que tú lo supongas.\n' +
  '- Copia los valores **exactamente como se reportaron**, con sus mismas ' +
  'unidades y su misma precisión. No redondees "95,8 %" a "96 %" ni ' +
  '"$4.587.300" a "$4,6 millones".\n' +
  '- Si un dato falta, escribe "sin dato reportado". Si un dato es ambiguo o ' +
  'ilegible, dilo en una frase. Nunca rellenes el hueco.\n' +
  '- No atribuyas a un área o a una persona nada que no haya reportado ella.\n' +
  '- Distingue siempre el **dato** del **análisis**. El dato debe poder rastrearse ' +
  'hasta lo reportado; el análisis es tuyo y debe leerse como interpretación ' +
  '("esto sugiere", "conviene revisar"), nunca como un hecho medido.\n' +
  'Un informe corto y verificable cumple su función. Uno completo pero con una ' +
  'cifra inventada, no.\n\n' +
  'REGLAS:\n' +
  '- Si un área no reportó, dilo explícitamente en una línea en vez de omitirla.\n' +
  '- Prioriza lo excepcional sobre lo rutinario: la gerencia lee esto para decidir.\n' +
  '- No incluyas preámbulos ni cierres; empieza directamente en el primer título.\n\n' +
  'TRATAMIENTO DE LAS IMÁGENES ADJUNTAS:\n' +
  'Recibirás capturas de tableros e indicadores, cada una rotulada con su área y ' +
  'su indicador. Son insumo tuyo, no del lector.\n' +
  '- **Nunca escribas "ver imagen adjunta", "según el archivo" ni menciones ' +
  'nombres de archivo o enlaces.** La gerencia lee el informe, no abre adjuntos: ' +
  'toda cifra que esté en una imagen debe quedar escrita en el texto.\n' +
  '- Extrae las cifras y redáctalas dentro de la sección que les corresponde, como ' +
  'si las hubieras recibido en una tabla.\n' +
  '- Si la imagen es una **gráfica**, reconstrúyela en dos partes: (1) una tabla ' +
  'Markdown con los datos que puedas leer de ella —serie, periodo y valor— y ' +
  '(2) dos o tres viñetas con lo que la gráfica revela: tendencia, punto de ' +
  'quiebre, valor atípico y su implicación para la operación. La tabla es el dato; ' +
  'las viñetas son la lectura gerencial, que es lo que se espera de ti.\n' +
  '- Si una cifra de la imagen es ilegible o ambigua, dilo en una frase breve en ' +
  'vez de estimarla.';

/* ===================== Listas desplegables ===================== */

/**
 * Sucursales. Lista **cerrada**: la columna se muestra como desplegable y el
 * usuario sólo puede elegir uno de estos valores. Mantenerla cerrada es lo que
 * permite agrupar las órdenes por sucursal semana a semana sin que "Antioquia",
 * "ANTIOQUIA" y "Ant." se conviertan en tres series distintas.
 */
var SUCURSALES = [
  'Zona Norte',
  'Zona Centro',
  'Antioquia',
  'Zona Occidente',
  'Cundinamarca',
  'Zona Santanderes'
];

/**
 * Distribuidores internacionales. Lista **abierta** (`abierta: true` en la
 * columna): se sugieren estos, pero el usuario puede escribir uno nuevo sin
 * esperar a que se agregue aquí.
 */
var DISTRIBUIDORES = [
  'AC 2000',
  'PETROSYSTEMS',
  'AMERICAN DRY',
  'BDC INTERNATIONAL'
];

/**
 * Alias de cargo → hoja. La hoja "Usuario" se llena a mano, así que se aceptan
 * variantes razonables (con/sin tildes, abreviaturas de uso interno).
 */
var ALIAS_CARGOS = {
  'dpa': 'DPA',
  'soporte tecnico': 'Soporte Técnico',
  'soporte': 'Soporte Técnico',
  'desarrollo personal': 'Desarrollo Personal',
  'desarrollo de personal': 'Desarrollo Personal',
  'gestion comercial': 'Gestión Comercial',
  'comercial': 'Gestión Comercial',
  'sau, renta, cdr': 'SAU, Renta, CDR',
  'sau renta cdr': 'SAU, Renta, CDR',
  'sau': 'SAU, Renta, CDR',
  'renta': 'SAU, Renta, CDR',
  'cdr': 'SAU, Renta, CDR',
  'directores': 'Directores',
  'director': 'Directores',
  'asesores kam': 'Asesores KAM',
  'asesor kam': 'Asesores KAM',
  'kam': 'Asesores KAM',
  'asesores can': 'Asesores KAM',
  'can': 'Asesores KAM'
};

/**
 * Cargos que otorgan el rol de Administrador, ya normalizados (sin tildes, en
 * minúscula). Se comparan contra la primera palabra del cargo, de modo que
 * "Administrador", "Admin" y "Administrador de sistemas" cuentan, pero
 * "Director Administrativo" no: el permiso no debe caer por parecido de texto.
 */
var CARGOS_ADMIN = ['administrador', 'administradora', 'admin', 'administrator'];

/**
 * ESQUEMA: definición completa de cada formulario.
 *
 * Por cada campo:
 *   col        Letra de la columna en la hoja (A, B y C son fijas).
 *   clave      Identificador interno usado por la interfaz y la API.
 *   titulo     Etiqueta corta que ve el usuario.
 *   encabezado Texto exacto del encabezado en Google Sheets (para validarlo).
 *   ayuda      Texto de apoyo bajo la etiqueta.
 *   tipo       'texto' (campo simple) | 'tabla' (filas dinámicas).
 *   lineas     Alto del textarea para campos simples (1 = input de una línea).
 *   columnas   Sólo para tablas: [{clave, titulo, tipo}].
 *   kpis       Métricas que se vuelcan automáticamente a la hoja KPI_Datos.
 *
 * Definición de un KPI:
 *   { metrica, valorCol, etiquetaCol, agregacion }
 *     - En tablas: valorCol es la columna numérica; etiquetaCol (opcional)
 *       genera una métrica por fila; agregacion ('suma'|'promedio') resume.
 *     - En campos simples: basta `metrica` (se toma el primer número del texto).
 */
var ESQUEMA = {

  'Directores': {
    hoja: 'Directores',
    icono: '🧭',
    descripcion: 'Visión de zona: clientes, equipos detenidos, cifras y contratos.',
    campos: [
      { col: 'D', clave: 'novedadesPersonal', tipo: 'texto', lineas: 4,
        titulo: 'Novedades de Personal y Desempeño',
        encabezado: 'Novedades de Personal y Desempeño (Desempeño general, estado de salud (alto impacto), gestión de vacaciones y análisis de carga laboral.)',
        ayuda: 'Desempeño general, estado de salud (alto impacto), vacaciones y carga laboral.' },

      { col: 'E', clave: 'visitasClientes', tipo: 'tabla',
        titulo: 'Visitas a Clientes y Actividades',
        encabezado: 'Visitas a Clientes y Actividades',
        columnas: [
          { clave: 'cliente', titulo: 'Cliente' },
          { clave: 'actividad', titulo: 'Actividad' }
        ] },

      { col: 'F', clave: 'equiposDetenidos', tipo: 'tabla',
        titulo: 'Equipos Detenidos / Novedades',
        encabezado: 'Equipos Detenidos / Novedades',
        columnas: [
          { clave: 'cliente', titulo: 'Cliente' },
          { clave: 'equipo', titulo: 'Equipo' },
          { clave: 'falla', titulo: 'Falla' },
          { clave: 'estado', titulo: 'Estado' },
          { clave: 'observacion', titulo: 'Obs.' }
        ] },

      { col: 'G', clave: 'metricasClave', tipo: 'tabla',
        titulo: 'Métricas Clave (Facturación, Forecast)',
        encabezado: 'Métricas Clave (Facturación, Forecast)',
        ayuda: 'Una fila por cifra: qué métrica es, su valor y la lectura ' +
               '(ej. "Facturación acumulada" / "1.250.000.000" / "92% de la meta del mes").',
        columnas: [
          { clave: 'metrica', titulo: 'Métrica' },
          { clave: 'valor', titulo: 'Valor', tipo: 'numero' },
          { clave: 'observacion', titulo: 'Observación' }
        ],
        kpis: [{ metrica: '', valorCol: 'valor', etiquetaCol: 'metrica' }] },

      { col: 'H', clave: 'ordenesImportantes', tipo: 'tabla',
        titulo: 'Órdenes Importantes Recibidas',
        encabezado: 'Órdenes Importantes Recibidas',
        columnas: [
          { clave: 'cliente', titulo: 'Cliente' },
          { clave: 'monto', titulo: 'Monto', tipo: 'numero' }
        ],
        kpis: [{ metrica: 'Órdenes importantes recibidas ($)', valorCol: 'monto', agregacion: 'suma' }] },

      { col: 'I', clave: 'estadoContratos', tipo: 'tabla',
        titulo: 'Estado de Contratos (Convenios)',
        encabezado: 'Estado de Contratos (Convenios)',
        columnas: [
          { clave: 'asesor', titulo: 'ASESOR' },
          { clave: 'meta', titulo: 'META', tipo: 'numero' },
          { clave: 'vigentes', titulo: 'VIGENTES', tipo: 'numero' },
          { clave: 'cumplimiento', titulo: '% CUMPL.', tipo: 'numero' },
          { clave: 'vencidos', titulo: 'VENCIDOS', tipo: 'numero' }
        ],
        kpis: [
          { metrica: 'Convenios vigentes', valorCol: 'vigentes', etiquetaCol: 'asesor' },
          { metrica: 'Convenios vencidos', valorCol: 'vencidos', etiquetaCol: 'asesor' },
          { metrica: '% Cumplimiento convenios', valorCol: 'cumplimiento', etiquetaCol: 'asesor' },
          { metrica: 'Convenios vigentes — total', valorCol: 'vigentes', agregacion: 'suma' },
          { metrica: 'Convenios vencidos — total', valorCol: 'vencidos', agregacion: 'suma' }
        ] },

      { col: 'J', clave: 'notasCredito', tipo: 'texto', lineas: 4,
        titulo: 'Notas Crédito, Quejas y Reclamos',
        encabezado: 'Notas Crédito / Registro, estado y resolución de quejas y reclamos de la semana.',
        ayuda: 'Registro, estado y resolución de quejas y reclamos de la semana.' }
    ]
  },

  'DPA': {
    hoja: 'DPA',
    icono: '📐',
    descripcion: 'Tiempos de respuesta, efectividad de la información y tratamiento de OS.',
    campos: [
      { col: 'D', clave: 'novedadesPersonal', tipo: 'texto', lineas: 4,
        titulo: 'Novedades de Personal y Desempeño',
        encabezado: 'Novedades de Personal y Desempeño (Desempeño general, estado de salud (alto impacto), gestión de vacaciones y análisis de carga laboral.)',
        ayuda: 'Desempeño general, estado de salud (alto impacto), vacaciones y carga laboral.' },

      { col: 'E', clave: 'tiempoRespuesta', tipo: 'texto', lineas: 1,
        titulo: 'Tiempo Promedio de Respuesta',
        encabezado: 'Tiempo Promedio de Respuesta',
        ayuda: 'Ej.: 4,5 horas',
        kpis: [{ metrica: 'Tiempo promedio de respuesta' }] },

      { col: 'F', clave: 'calidadInformacion', tipo: 'tabla',
        titulo: 'Calidad de Información (Efectividad)',
        encabezado: 'Calidad de Información (Efectividad)',
        columnas: [
          { clave: 'proceso', titulo: 'Proceso' },
          { clave: 'solicitudes', titulo: 'Solicitudes', tipo: 'numero' },
          { clave: 'reprocesos', titulo: 'Reprocesos', tipo: 'numero' },
          { clave: 'efectividad', titulo: 'Efectividad %', tipo: 'numero' }
        ],
        kpis: [
          { metrica: 'Efectividad %', valorCol: 'efectividad', etiquetaCol: 'proceso' },
          { metrica: 'Solicitudes atendidas', valorCol: 'solicitudes', agregacion: 'suma' },
          { metrica: 'Reprocesos', valorCol: 'reprocesos', agregacion: 'suma' }
        ] },

      { col: 'G', clave: 'reporteCalculador', tipo: 'tabla',
        titulo: 'Reporte Calculador Web',
        encabezado: 'Reporte Calculador Web',
        columnas: [
          { clave: 'herramienta', titulo: 'Herramienta' },
          { clave: 'totalOfertas', titulo: 'Total Ofertas', tipo: 'numero' },
          { clave: 'utilizacion', titulo: '% Utilización', tipo: 'numero' }
        ],
        kpis: [{ metrica: '% Utilización calculador', valorCol: 'utilizacion', etiquetaCol: 'herramienta' }] },

      { col: 'H', clave: 'tareasC4C', tipo: 'texto', lineas: 3,
        titulo: 'Asignación de Tareas C4C (CRM)',
        encabezado: 'Asignación de Tareas C4C (CRM)' },

      { col: 'I', clave: 'ofertasPuntuales', tipo: 'tabla',
        titulo: 'Ofertas Puntuales (Tiempos)',
        encabezado: 'Ofertas Puntuales (Tiempos)',
        columnas: [
          { clave: 'estado', titulo: 'Estado' },
          { clave: 'total', titulo: 'Total', tipo: 'numero' },
          { clave: 'fueraTiempo', titulo: 'Fuera de tiempo', tipo: 'numero' },
          { clave: 'aTiempo', titulo: 'A tiempo', tipo: 'numero' }
        ],
        kpis: [
          { metrica: 'Ofertas puntuales — total', valorCol: 'total', agregacion: 'suma' },
          { metrica: 'Ofertas puntuales fuera de tiempo', valorCol: 'fueraTiempo', agregacion: 'suma' }
        ] },

      { col: 'J', clave: 'ofertasConvenios', tipo: 'tabla',
        titulo: 'Ofertas de Convenios (Tiempos)',
        encabezado: 'Ofertas de Convenios (Tiempos)',
        columnas: [
          { clave: 'estado', titulo: 'Estado' },
          { clave: 'total', titulo: 'Total', tipo: 'numero' },
          { clave: 'fueraTiempo', titulo: 'Fuera de tiempo', tipo: 'numero' },
          { clave: 'aTiempo', titulo: 'A tiempo', tipo: 'numero' }
        ],
        kpis: [
          { metrica: 'Ofertas convenios — total', valorCol: 'total', agregacion: 'suma' },
          { metrica: 'Ofertas convenios fuera de tiempo', valorCol: 'fueraTiempo', agregacion: 'suma' }
        ] },

      { col: 'K', clave: 'tratamientoOS', tipo: 'tabla',
        titulo: 'Tratamiento de OS (Cierres y Demoras)',
        encabezado: 'Tratamiento de OS (Cierres y Demoras)',
        columnas: [
          { clave: 'os', titulo: 'OS' },
          { clave: 'zona', titulo: 'Zona' },
          { clave: 'responsable', titulo: 'Responsable' },
          { clave: 'diasDemora', titulo: 'Días de Demora', tipo: 'numero' }
        ] },

      { col: 'L', clave: 'osCierreIncompleto', tipo: 'texto', lineas: 3,
        titulo: 'OS con Cierre Incompleto',
        encabezado: 'OS con Cierre Incompleto' },

      { col: 'M', clave: 'demorasCoordinador', tipo: 'tabla',
        titulo: 'Demoras en Ejecución por Coordinador',
        encabezado: 'Demoras en Ejecución por Coordinador',
        columnas: [
          { clave: 'coordinador', titulo: 'Coordinador' },
          { clave: 'oficina', titulo: 'Oficina' },
          { clave: 'osDemoradas', titulo: 'OS Demoradas', tipo: 'numero' }
        ],
        kpis: [{ metrica: 'OS demoradas', valorCol: 'osDemoradas', etiquetaCol: 'coordinador' }] },

      { col: 'N', clave: 'pendientesLogistician', tipo: 'texto', lineas: 3,
        titulo: 'Pendientes de Service Logistician',
        encabezado: 'Pendientes de Service Logistician' }
    ]
  },

  'Gestión Comercial': {
    hoja: 'Gestión Comercial',
    icono: '💰',
    descripcion: 'Órdenes de compra, facturación, convenios y distribuidores.',
    campos: [
      { col: 'D', clave: 'ordenesPorSucursal', tipo: 'tabla',
        titulo: 'Órdenes de Compra por Sucursal',
        encabezado: 'Órdenes de Compra por Sucursal',
        columnas: [
          { clave: 'sucursal', titulo: 'Sucursal', opciones: SUCURSALES },
          { clave: 'valorRecibido', titulo: 'Valor Recibido', tipo: 'numero' }
        ],
        kpis: [
          { metrica: 'OC recibidas ($)', valorCol: 'valorRecibido', etiquetaCol: 'sucursal' },
          { metrica: 'OC recibidas — total ($)', valorCol: 'valorRecibido', agregacion: 'suma' }
        ] },

      { col: 'E', clave: 'ordenesRelevantes', tipo: 'imagen',
        titulo: 'Órdenes Relevantes',
        encabezado: 'Órdenes Relevantes',
        ayuda: 'Adjunta la captura del reporte. Puedes pegarla con Ctrl+V, ' +
               'arrastrarla o elegir el archivo.' },

      { col: 'F', clave: 'metricasFacturacion', tipo: 'tabla',
        titulo: 'Métricas de Facturación y Cumplimiento',
        encabezado: 'Métricas de Facturación y Cumplimiento',
        columnas: [
          { clave: 'kpi', titulo: 'KPI' },
          { clave: 'valor', titulo: 'Valor', tipo: 'numero' }
        ],
        kpis: [{ metrica: '', valorCol: 'valor', etiquetaCol: 'kpi' }] },

      { col: 'G', clave: 'kpisConvenios', tipo: 'imagen',
        titulo: 'KPIs de Convenios',
        encabezado: 'KPIs de Convenios',
        ayuda: 'Adjunta la captura del tablero de convenios.' },

      { col: 'H', clave: 'distribuidores', tipo: 'tabla',
        titulo: 'Distribuidores Internacionales',
        encabezado: 'Distribuidores Internacionales',
        columnas: [
          { clave: 'distribuidor', titulo: 'Distribuidor',
            opciones: DISTRIBUIDORES, abierta: true },
          { clave: 'ocValor', titulo: 'OC / Valor' },
          { clave: 'actividad', titulo: 'Actividad' }
        ] },

      { col: 'I', clave: 'negociacionesAltoImpacto', tipo: 'tablaLibre',
        titulo: 'Negociaciones de Alto Impacto y Precios',
        encabezado: 'Negociaciones de Alto Impacto y Precios',
        ayuda: 'Copia el rango en Excel y pégalo aquí con Ctrl+V: se conserva ' +
               'la estructura original, con sus encabezados y columnas.' },

      { col: 'J', clave: 'entrenamientosMarketing', tipo: 'texto', lineas: 4,
        titulo: 'Entrenamientos, Visitas y Marketing',
        encabezado: 'Entrenamientos , visitas  y Marketing' }
    ]
  },

  'Asesores KAM': {
    hoja: 'Asesores KAM',
    icono: '🤝',
    descripcion: 'Negociaciones en curso, presupuesto y relacionamiento con cuentas clave.',
    campos: [
      { col: 'D', clave: 'negociacionesCurso', tipo: 'tabla',
        titulo: 'Negociaciones en Curso',
        encabezado: 'Negociaciones en Curso',
        columnas: [
          { clave: 'cliente', titulo: 'Cliente' },
          { clave: 'tipo', titulo: 'Tipo' },
          { clave: 'valorTotal', titulo: 'Valor Total', tipo: 'numero' },
          { clave: 'estado', titulo: 'Estado' }
        ],
        kpis: [{ metrica: 'Pipeline en negociación ($)', valorCol: 'valorTotal', agregacion: 'suma' }] },

      { col: 'E', clave: 'desarrolloPresupuestario', tipo: 'tabla',
        titulo: 'Desarrollo Presupuestario',
        encabezado: 'Desarrollo Presupuestario',
        columnas: [
          { clave: 'meta', titulo: 'Meta', tipo: 'numero' },
          { clave: 'ocPuntuales', titulo: 'OC Puntuales', tipo: 'numero' },
          { clave: 'ocConvenios', titulo: 'OC Convenios', tipo: 'numero' },
          { clave: 'facturado', titulo: 'Facturado', tipo: 'numero' },
          { clave: 'cumplimiento', titulo: '% Cumplimiento', tipo: 'numero' }
        ],
        kpis: [
          { metrica: '% Cumplimiento presupuesto', valorCol: 'cumplimiento', agregacion: 'promedio' },
          { metrica: 'Facturado ($)', valorCol: 'facturado', agregacion: 'suma' }
        ] },

      { col: 'F', clave: 'accionesValor', tipo: 'texto', lineas: 4,
        titulo: 'Acciones Generadoras de Valor',
        encabezado: 'Acciones Generadoras de Valor' },

      { col: 'G', clave: 'actividadesRelacionamiento', tipo: 'texto', lineas: 4,
        titulo: 'Actividades de Relacionamiento',
        encabezado: 'Actividades de Relacionamiento' },

      { col: 'H', clave: 'informacionInteres', tipo: 'texto', lineas: 4,
        titulo: 'Información de Interés (Mercado / Clientes)',
        encabezado: 'Información de Interés (Mercado/Clientes)' }
    ]
  },

  'Soporte Técnico': {
    hoja: 'Soporte Técnico',
    icono: '🛠️',
    descripcion: 'Equipos detenidos, FTF, línea de emergencia y centro de monitoreo.',
    campos: [
      { col: 'D', clave: 'novedadesPersonal', tipo: 'texto', lineas: 4,
        titulo: 'Novedades de Personal y Desempeño',
        encabezado: 'Novedades de Personal y Desempeño (Desempeño general, estado de salud (alto impacto), gestión de vacaciones y análisis de carga laboral.)',
        ayuda: 'Desempeño general, estado de salud (alto impacto), vacaciones y carga laboral.' },

      { col: 'E', clave: 'equiposDetenidos', tipo: 'texto', lineas: 5,
        titulo: 'Equipos Detenidos / Novedades',
        encabezado: 'Equipos Detenidos / Novedades',
        ayuda: 'Redacción libre: cliente, equipo, falla, estado y observación.' },

      { col: 'F', clave: 'gestionSoporte', tipo: 'tabla',
        titulo: 'Gestión de Soporte por Ingeniero',
        encabezado: 'Gestión de Soporte por Ingeniero',
        columnas: [
          { clave: 'ingeniero', titulo: 'Ingeniero' },
          { clave: 'cliente', titulo: 'Cliente' },
          { clave: 'caso', titulo: 'Falla / Caso' },
          { clave: 'avance', titulo: 'Avance' }
        ] },

      { col: 'G', clave: 'metricasEmergencia', tipo: 'imagen',
        titulo: 'Métricas Línea de Emergencia',
        encabezado: 'Métricas Línea de Emergencia',
        ayuda: 'Adjunta la captura del tablero de la línea de emergencia.' },

      // El análisis va en su propio campo y no como comentario de la imagen:
      // así queda en una columna propia de la hoja —legible y auditable sin
      // abrir el adjunto— y llega al informe aunque falte la captura.
      { col: 'M', clave: 'metricasEmergenciaTexto', tipo: 'texto', lineas: 4,
        titulo: 'Métricas Línea de Emergencia — análisis',
        encabezado: 'Métricas Línea de Emergencia — análisis',
        ayuda: 'Qué explica las cifras del tablero y qué se está haciendo.' },

      { col: 'H', clave: 'firstTimeFix', tipo: 'imagen',
        titulo: 'First Time Fix Rate (FTF)',
        encabezado: 'First Time Fix Rate (FTF)',
        ayuda: 'Adjunta el indicador del FTF.' },

      { col: 'N', clave: 'firstTimeFixTexto', tipo: 'texto', lineas: 4,
        titulo: 'First Time Fix Rate (FTF) — análisis',
        encabezado: 'First Time Fix Rate (FTF) — análisis',
        ayuda: 'Análisis del área: qué explica el resultado y qué se está ' +
               'haciendo. Es lo que la gerencia lee junto a la cifra.' },

      // 5. Renombrado. `encabezadosAlternos` conserva el nombre anterior para
      //    que las hojas que aún no se han renombrado sigan mapeando bien.
      { col: 'I', clave: 'fallasFrecuentes', tipo: 'texto', lineas: 4,
        titulo: 'Informe de gestión Ingenieros de Soporte',
        encabezado: 'Informe de gestión Ingenieros de Soporte',
        encabezadosAlternos: ['Análisis de Fallas Frecuentes'] },

      { col: 'J', clave: 'centroMonitoreo', tipo: 'texto', lineas: 4,
        titulo: 'Actividades Centro de Monitoreo',
        encabezado: 'Actividades Centro de Monitoreo' },

      { col: 'K', clave: 'analisisVibraciones', tipo: 'tabla',
        titulo: 'Análisis de Vibraciones',
        encabezado: 'Análisis de Vibraciones',
        columnas: [
          { clave: 'estado', titulo: 'Estado' },
          { clave: 'cantidad', titulo: 'Cantidad', tipo: 'numero' }
        ],
        kpis: [{ metrica: 'Vibraciones', valorCol: 'cantidad', etiquetaCol: 'estado' }] },

      { col: 'L', clave: 'gestionSemana', tipo: 'texto', lineas: 4,
        titulo: 'Gestión durante la semana',
        encabezado: 'Gestión durante la semana' }
    ]
  },

  'SAU, Renta, CDR': {
    hoja: 'SAU, Renta, CDR',
    icono: '⚙️',
    descripcion: 'Servicio al usuario, taller CDR, reprocesos y flota de renta.',
    campos: [
      { col: 'D', clave: 'novedadesPersonal', tipo: 'texto', lineas: 4,
        titulo: 'Novedades de Personal y Desempeño',
        encabezado: 'Novedades de Personal y Desempeño (Desempeño general, estado de salud (alto impacto), gestión de vacaciones y análisis de carga laboral.)',
        ayuda: 'Desempeño general, estado de salud (alto impacto), vacaciones y carga laboral.' },

      { col: 'E', clave: 'visitasClientes', tipo: 'tabla',
        titulo: 'Visitas a Clientes y Actividades',
        encabezado: 'Visitas a Clientes y Actividades',
        columnas: [
          { clave: 'cliente', titulo: 'Cliente' },
          { clave: 'actividad', titulo: 'Actividad' }
        ] },

      { col: 'F', clave: 'equiposDetenidos', tipo: 'tabla',
        titulo: 'Equipos Detenidos / Novedades',
        encabezado: 'Equipos Detenidos / Novedades',
        columnas: [
          { clave: 'cliente', titulo: 'Cliente' },
          { clave: 'equipo', titulo: 'Equipo' },
          { clave: 'falla', titulo: 'Falla' },
          { clave: 'estado', titulo: 'Estado' },
          { clave: 'observacion', titulo: 'Obs.' }
        ] },

      { col: 'G', clave: 'horasExtra', tipo: 'texto', lineas: 3,
        titulo: 'Gestión de Horas Extra',
        encabezado: 'Gestión de Horas Extra',
        kpis: [{ metrica: 'Horas extra' }] },

      { col: 'H', clave: 'novedadesSucursales', tipo: 'texto', lineas: 3,
        titulo: 'Novedades en sucursales',
        encabezado: 'Novedades en sucursales' },

      { col: 'I', clave: 'serviciosUtility', tipo: 'texto', lineas: 1,
        titulo: 'Número de servicios Utility',
        encabezado: 'Número de servicios Utility',
        ayuda: 'Cantidad de servicios ejecutados en la semana.',
        kpis: [{ metrica: 'Servicios Utility' }] },

      { col: 'J', clave: 'serviciosTaller', tipo: 'tabla',
        titulo: 'Servicios de Taller',
        encabezado: 'Servicios de Taller',
        columnas: [
          { clave: 'estado', titulo: 'Estado' },
          { clave: 'cantidad', titulo: 'Cantidad', tipo: 'numero' }
        ],
        kpis: [{ metrica: 'Taller', valorCol: 'cantidad', etiquetaCol: 'estado' }] },

      { col: 'K', clave: 'registroReprocesos', tipo: 'texto', lineas: 3,
        titulo: 'Registro de reprocesos',
        encabezado: 'Registro de reprocesos',
        kpis: [{ metrica: 'Reprocesos taller' }] },

      { col: 'L', clave: 'equiposMasUnMes', tipo: 'tabla',
        titulo: 'Equipos con más de 1 mes en taller',
        encabezado: 'Equipos con más de 1 mes en taller',
        columnas: [
          { clave: 'equipo', titulo: 'Equipo' },
          { clave: 'cliente', titulo: 'Cliente' },
          { clave: 'observacion', titulo: 'Observación' }
        ] },

      { col: 'M', clave: 'mantenimientoRenta', tipo: 'texto', lineas: 4,
        titulo: 'Novedades de mantenimiento (Flota de Renta)',
        encabezado: 'Novedades de mantenimiento (Flota de Renta)' }
    ]
  },

  'Desarrollo Personal': {
    hoja: 'Desarrollo Personal',
    icono: '👥',
    descripcion: 'Vacantes, escalafonamiento, capacitaciones y soporte a distribuidores.',
    campos: [
      { col: 'D', clave: 'gestionVacantes', tipo: 'tabla',
        titulo: 'Gestión de Vacantes y Requerimientos',
        encabezado: 'Gestión de Vacantes y Requerimientos',
        columnas: [
          { clave: 'zona', titulo: 'Zona' },
          { clave: 'cargo', titulo: 'Cargo' },
          { clave: 'estado', titulo: 'Estado / Avance' }
        ] },

      { col: 'E', clave: 'seguimiento', tipo: 'tabla',
        titulo: 'Seguimiento y Escalafonamiento',
        encabezado: 'Seguimiento y Escalafonamiento',
        columnas: [
          { clave: 'colaborador', titulo: 'Colaborador' },
          { clave: 'zona', titulo: 'Zona' },
          { clave: 'novedad', titulo: 'Novedad / Seguimiento' }
        ] },

      { col: 'F', clave: 'entrenamientos', tipo: 'texto', lineas: 4,
        titulo: 'Entrenamientos y Capacitaciones',
        encabezado: 'Entrenamientos y Capacitaciones' },

      { col: 'G', clave: 'temasEspecialistas', tipo: 'texto', lineas: 4,
        titulo: 'Temas de Especialistas',
        encabezado: 'Temas de Especialistas' },

      { col: 'H', clave: 'soporteDistribuidores', tipo: 'texto', lineas: 4,
        titulo: 'Gestión y Soporte a Distribuidores',
        encabezado: 'Gestión y Soporte a Distribuidores' }
    ]
  }
};

/** Orden en que se recorren las áreas al consolidar el informe. */
var ORDEN_AREAS = [
  'Directores',
  'Gestión Comercial',
  'Asesores KAM',
  'DPA',
  'Soporte Técnico',
  'SAU, Renta, CDR',
  'Desarrollo Personal'
];
