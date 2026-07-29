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
  PROP_ADMINS: 'ADMIN_CORREOS',
  PROP_API_KEY: 'GEMINI_API_KEY',
  PROP_MODELO: 'MODELO_IA',

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
   * true: además de ese panel, se le muestra el formulario de su área, si está
   *   registrado en la hoja "Usuario". Útil cuando la persona que administra
   *   también debe entregar su propio reporte semanal.
   */
  ADMIN_TAMBIEN_REPORTA: false,

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
  'ESTRUCTURA OBLIGATORIA (usa exactamente estos cinco títulos, en este orden):\n' +
  '## 📋 RESUMEN EJECUTIVO (Semana Actual)\n' +
  'Un párrafo conciso con el pulso general de la operación y las ventas a nivel nacional.\n' +
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
  'REGLAS:\n' +
  '- Trabaja únicamente con los datos entregados. No inventes cifras, clientes ni equipos.\n' +
  '- Si un área no reportó, dilo explícitamente en una línea en vez de omitirla.\n' +
  '- Prioriza lo excepcional sobre lo rutinario: la gerencia lee esto para decidir.\n' +
  '- No incluyas preámbulos ni cierres; empieza directamente en el primer título.';

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

      { col: 'E', clave: 'equiposDetenidos', tipo: 'tabla',
        titulo: 'Equipos Detenidos / Novedades',
        encabezado: 'Equipos Detenidos / Novedades',
        columnas: [
          { clave: 'cliente', titulo: 'Cliente' },
          { clave: 'equipo', titulo: 'Equipo' },
          { clave: 'falla', titulo: 'Falla' },
          { clave: 'estado', titulo: 'Estado' },
          { clave: 'observacion', titulo: 'Obs.' }
        ] },

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

      { col: 'H', clave: 'firstTimeFix', tipo: 'imagen', comentario: true,
        titulo: 'First Time Fix Rate (FTF)',
        encabezado: 'First Time Fix Rate (FTF)',
        ayuda: 'Adjunta el indicador y escribe el análisis del área de soporte ' +
               'en el comentario: es lo que la gerencia lee junto a la cifra.' },

      { col: 'I', clave: 'fallasFrecuentes', tipo: 'texto', lineas: 4,
        titulo: 'Análisis de Fallas Frecuentes',
        encabezado: 'Análisis de Fallas Frecuentes' },

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
