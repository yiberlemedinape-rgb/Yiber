# Informes Semanales — Kaeser Compresores

Ecosistema de **Google Sheets + Apps Script + interfaz web** para recopilar los
informes periódicos de las siete áreas (Directores, Gestión Comercial, Asesores
KAM, DPA, Soporte Técnico, SAU/Renta/CDR y Desarrollo de Personal), almacenarlos
en una base de datos única y **generar y enviar automáticamente el informe
gerencial los jueves a las 5:00 p. m.**

---

## 1. Cómo funciona

```
                 ┌─────────────────────────────────────────┐
   Colaborador → │ Interfaz web (Apps Script + HTML)       │
                 │  · valida el correo contra "Usuario"    │
                 │  · precarga Año / Semana / Nombre       │
                 │  · dibuja el formulario de SU área      │
                 │  · NO puede tocar el informe gerencial  │
                 └───────────────┬─────────────────────────┘
                                 │ google.script.run
                 ┌───────────────▼─────────────────────────┐
                 │ Capa de datos (Datos.gs / Kpis.gs)      │
                 │  · upsert por (Año, Semana, Nombre)     │
                 │  · vuelca métricas a KPI_Datos          │
                 └───────────────┬─────────────────────────┘
                                 │
                 ┌───────────────▼─────────────────────────┐
                 │ Google Sheets (1 hoja por área)         │
                 └───────────────┬─────────────────────────┘
                                 │ jueves 17:00 (disparador automático)
                                 │ o menú de Sheets (sólo Administrador)
                 ┌───────────────▼─────────────────────────┐
                 │ Informe.gs → Gemini (opcional) → Correo │
                 │  Markdown con las 5 secciones exigidas  │
                 └───────────────┬─────────────────────────┘
                                 ▼
                          📧 Gerencia
```

**Principio de diseño:** el `ESQUEMA` de `Config.gs` es la única fuente de
verdad. Define para cada área qué columna de la hoja corresponde a qué campo,
si ese campo es *Campo Simple* o *Tabla*, y qué KPI produce. La interfaz web, el
guardado, la lectura, los KPI y el informe se generan a partir de él: **agregar
o quitar un campo se hace en un solo lugar.**

---

## 2. Archivos

| Archivo | Responsabilidad |
|---|---|
| `Config.gs` | `ESQUEMA` de las 7 hojas, alias de cargos, directrices del informe, constantes. Sin efectos secundarios. |
| `Semana.gs` | Semana ISO 8601, rangos de fechas, normalización de texto y parseo de números escritos por humanos. |
| `Usuarios.gs` | Control de acceso contra la hoja `Usuario`; roles de administrador. |
| `Datos.gs` | Lectura/escritura de formularios, serialización de tablas dentro de una celda, verificación de encabezados. |
| `Kpis.gs` | Extracción automática de métricas hacia `KPI_Datos`. |
| `Informe.gs` | Consolidación semanal y redactor determinista (las 5 secciones). |
| `Ia.gs` | Conector con la API de Gemini (`gemini-2.5-flash`) para la redacción asistida (opcional). |
| `Correo.gs` | Markdown → HTML, envío del correo y disparador de los jueves. |
| `Code.gs` | Menú de Sheets, `doGet()` y la API que consume la interfaz. |
| `Index.html`, `Estilos.html`, `Js.html` | Interfaz web dinámica. |
| `pruebas/prueba-local.js` | Banco de pruebas bajo Node con dobles de los servicios de Google. |

---

## 3. Modelo de datos

### 3.1 Hojas de formulario

Cada área tiene su hoja con la estructura acordada. Las tres primeras columnas
son siempre `Año | N° de Semana | Nombre del Colaborador` y forman la **clave
lógica del registro**: volver a guardar la misma semana actualiza la fila, no la
duplica.

### 3.2 Cómo se guarda una "Tabla" en una celda

Las hojas las leen personas, así que **no se guarda JSON**. Un campo tipo tabla
se guarda como un bloque de texto legible, con la primera línea de encabezados:

```
Proceso | Solicitudes | Reprocesos | Efectividad %
Ofertas puntuales | 120 | 5 | 95,8
Convenios | 40 | 1 | 97,5
```

- Separador de columnas: ` | ` · Separador de filas: salto de línea.
- Al guardar, los valores del usuario se limpian de `|` (pasa a `/`) y de
  saltos de línea (pasan a ` · `) para que el parseo de vuelta sea determinista.
- Al leer, la primera línea se descarta si coincide con el encabezado esperado,
  de modo que también funciona si alguien pega las filas sin encabezado.

### 3.3 `KPI_Datos`

`Año | N° de Semana | Área | Nombre | Métrica | Valor`

Se llena **sola** cada vez que alguien guarda. Los KPI están declarados en
`ESQUEMA` junto al campo que los produce:

```js
kpis: [
  { metrica: 'Efectividad %', valorCol: 'efectividad', etiquetaCol: 'proceso' }, // una fila por proceso
  { metrica: 'Solicitudes atendidas', valorCol: 'solicitudes', agregacion: 'suma' }
]
```

El parseo numérico entiende la convención colombiana (`1.500.000`, `95,8 %`,
`$ 4.500`, `4,5 horas`). Guardar dos veces la misma semana **reemplaza** las
métricas anteriores, nunca las duplica.

---

## 4. Puesta en marcha

### 4.1 Cargar el código

**Opción recomendada — `clasp`** (no se puede equivocar de tipo de archivo):

```bash
cp .clasp.json.example .clasp.json     # y pon dentro el scriptId real
clasp push
```

**Opción manual** — Abre el libro `Informes_Semanales` → **Extensiones → Apps
Script** y crea los 13 archivos. Deben quedar exactamente así:

| Tipo | Archivos |
|---|---|
| **Script** (9) | `Code.gs` · `Config.gs` · `Correo.gs` · `Datos.gs` · `Ia.gs` · `Informe.gs` · `Kpis.gs` · `Semana.gs` · `Usuarios.gs` |
| **HTML** (3) | `Estilos.html` · `Index.html` · `Js.html` |
| Manifiesto | `appsscript.json` (se muestra activando *Mostrar el archivo de manifiesto* en Configuración) |

> ⚠️ **Los archivos HTML se crean con `+ → HTML`, no con `+ → Script`,** y al
> nombrarlos se escribe `Estilos`, `Index`, `Js` **sin la extensión** (Apps
> Script agrega `.html` solo). Si se crean como Script quedan en `.gs` y el
> editor falla con `SyntaxError: Unexpected token '<', línea 1`: está
> intentando leer HTML como JavaScript.

**Verificación rápida de que cada contenido quedó en su archivo:** todo archivo
`.gs` de este proyecto lleva **su propio nombre en la línea 2** de la cabecera.
Si `Ia.gs` no dice `* Ia.gs` en la línea 2, ahí se pegó otra cosa. El mismo
error (`Unexpected token '<'`) aparece cuando el contenido de un `.html` termina
pegado dentro de un `.gs`.

### 4.2 Configurar propiedades del script

**Configuración del proyecto → Propiedades del script:**

| Propiedad | Obligatoria | Para qué sirve |
|---|---|---|
| `CORREO_GERENTE` | ✅ | Destinatario del informe de los jueves. |
| `ADMIN_CORREOS` | ✅ | Correos del **Administrador** (separados por coma): los únicos que pueden ejecutar el envío manual y las acciones de configuración. Si se deja vacía, sólo puede operar el propietario del libro. |
| `CORREO_COPIA` | — | Copias del informe (separadas por coma). |
| `GEMINI_API_KEY` | — | Clave de la API de Gemini (se obtiene en [Google AI Studio](https://aistudio.google.com/apikey)). Activa la redacción asistida; sin ella se usa el informe automático. |
| `MODELO_IA` | — | Modelo a usar. Por defecto `gemini-2.5-flash`. Se admite escribirlo con o sin el prefijo `models/`. |

> 🔑 **La clave de Gemini no va en el código.** Va aquí, en las propiedades del
> script, y `Ia.gs` la lee con `PropertiesService`. Escrita dentro de un `.gs`
> quedaría versionada en Git y visible para cualquiera con acceso al proyecto.

### 4.3 Verificar la estructura

Recarga la hoja → menú **📊 Informes Semanales → Verificar / crear hojas**.
Crea lo que falte y avisa con ⚠️ si alguien renombró una columna y rompió el
mapeo con el `ESQUEMA`.

### 4.4 Publicar la interfaz web

**Implementar → Nueva implementación → Aplicación web:**

- **Ejecutar como:** *Yo* (el dueño del libro).
- **Quién tiene acceso:** *Cualquier usuario de kaeser.com*.

Esa combinación es deliberada: el script escribe en la hoja con los permisos del
dueño (los colaboradores **no necesitan acceso de edición** al libro, así que no
pueden alterar filas ajenas), y aun así Google entrega el correo del usuario que
entra —porque está en el mismo dominio—, que es lo que permite validarlo contra
la hoja `Usuario`.

### 4.5 Activar el envío automático de los jueves

Menú **📊 Informes Semanales → 🔒 Instalar envío automático (jueves 5:00 p. m.)**.

- **Este paso no es opcional.** Sin él, el informe no sale nunca solo. El menú
  **🔒 Estado de la configuración** lo advierte en mayúsculas si falta.
- Es idempotente: reinstalar no duplica el disparador.
- La hora se interpreta en `America/Bogota` (declarada en `appsscript.json` y
  fijada explícitamente con `.inTimezone()` al crear el disparador).
- Apps Script ejecuta los disparadores por tiempo dentro de una ventana de
  ~15 minutos alrededor de la hora indicada; para un informe semanal esa
  precisión sobra.
- El disparador corre con la cuenta que lo instaló: el correo sale desde esa
  cuenta y consume su cuota diaria de Gmail. Instálalo con la cuenta que quieras
  que figure como remitente.
- Si un jueves falla el envío, el propio disparador avisa por correo a
  `ADMIN_CORREOS` con el motivo del error.

---

## 5. Control de acceso

Hay **dos roles y nada más**: el colaborador, que sólo registra su propio
reporte; y el Administrador, único que puede disparar el informe a mano.

### 5.1 Colaborador — la hoja `Usuario` es la lista blanca

- El correo se toma de la sesión de Google, no de un campo del formulario: nadie
  puede reportar a nombre de otro colaborador desde la interfaz.
- El `Cargo` se traduce al área con `areaDeCargo()`, que acepta variantes
  razonables (`SAU`, `Asesores CAN` → `Asesores KAM`, con o sin tildes).
- Si el correo no está en la hoja, la interfaz no muestra ningún formulario.
- Cada llamada al servidor (`apiSesion`, `apiCargarRegistro`, `apiGuardar`)
  revalida al usuario: la interfaz nunca decide sola qué puede hacer alguien.

> ℹ️ La hoja `Usuario` del archivo actual no tiene ninguna fila con el cargo
> **Asesores KAM**, aunque la hoja existe. Agrega a los asesores allí para que
> puedan entrar a su formulario.

### 5.2 El informe gerencial no es alcanzable desde la interfaz web

La interfaz **no tiene** botón, pestaña ni pantalla de informe. Pero ocultar un
botón no es una medida de seguridad: **cualquier función de `Code.gs` es
invocable desde el navegador** con `google.script.run.<nombre>()`, así que un
botón escondido seguiría siendo ejecutable desde la consola del navegador.

Por eso la protección real es que **el endpoint no existe**: en `Code.gs` no hay
ninguna función que previsualice, genere o envíe el informe. La acción no está
oculta — no es alcanzable. Las pruebas verifican esto explícitamente.

### 5.3 Quién puede ejecutarlo a mano

El envío manual vive **sólo en el menú de Google Sheets**, y cada acción pasa
por `exigirAdministrador_()`:

- **Administrador** = correo listado en la propiedad `ADMIN_CORREOS`.
- Si esa propiedad aún no se ha configurado, se acepta únicamente al
  **propietario del libro**, para que el sistema no quede sin nadie que pueda
  operarlo el primer día. En cuanto se configura `ADMIN_CORREOS`, esa excepción
  deja de aplicar.
- Quien no sea administrador ve el menú, pero al hacer clic recibe un aviso
  explicando cómo pedir acceso. No se ejecuta nada.

Además, con la implementación recomendada (§4.4) los colaboradores **no tienen
acceso al libro de Sheets**, así que ni siquiera ven ese menú.

---

## 6. El informe gerencial

### 6.1 Estructura (obligatoria)

```markdown
## 📋 RESUMEN EJECUTIVO (Semana Actual)
## 🚨 ALERTAS CRÍTICAS Y CUELLOS DE BOTELLA
## 💰 GESTIÓN COMERCIAL Y KAM
## ⚙️ OPERACIONES, SAU Y SOPORTE TÉCNICO
## 👥 DESARROLLO DE PERSONAL
```

Cierra con un anexo de **cobertura**: cuántos reportes llegaron y **quién no
reportó** (calculado contra la hoja `Usuario`).

### 6.2 Dos redactores

1. **Determinista** (`Informe.gs`) — siempre disponible, sin dependencias.
   Arma las cinco secciones desde los datos crudos: marca con 🔴 los equipos
   cuyo estado o falla contiene palabras críticas, ordena las OS por días de
   demora, resalta clientes y valores en negrita.
2. **Asistido por Gemini** (`Ia.gs`) — si hay `GEMINI_API_KEY`, el modelo
   `gemini-2.5-flash` redacta el análisis siguiendo las `DIRECTRICES_INFORME`
   sobre el JSON consolidado.

El determinista es el **respaldo real**: si no hay clave, falla la red, la API
responde un error o el modelo declina la solicitud, el correo del jueves sale
igual con toda la información. Los avisos de por qué se usó el respaldo se ven
en la vista previa de la interfaz.

### 6.3 Cómo se llama a Gemini

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
x-goog-api-key: <GEMINI_API_KEY>

{
  "systemInstruction": { "parts": [{ "text": "<DIRECTRICES_INFORME>" }] },
  "contents": [{ "role": "user", "parts": [{ "text": "<JSON consolidado>" }] }],
  "generationConfig": {
    "temperature": 0.35,
    "topP": 0.95,
    "maxOutputTokens": 16384,
    "thinkingConfig": { "thinkingBudget": 1024 }
  }
}
```

Detalles que importan en la práctica:

- **La clave viaja en el encabezado `x-goog-api-key`, no en la URL.** Es
  deliberado: la URL sí queda registrada en los logs de ejecución de Apps
  Script, y ahí la clave sería visible para cualquiera con acceso al proyecto.
- **En los modelos 2.5 los tokens de razonamiento consumen `maxOutputTokens`.**
  Si el presupuesto de razonamiento se come el cupo, Gemini responde
  `finishReason: MAX_TOKENS` **sin texto**. Por eso el presupuesto está acotado
  a 1.024 tokens contra un techo de 16.384, y ese caso está manejado
  explícitamente: cae al informe determinista y explica qué pasó.
- Las partes marcadas con `thought: true` se descartan al armar el Markdown:
  son razonamiento del modelo, no el informe.
- Se distinguen y se traducen los motivos de bloqueo (`SAFETY`, `RECITATION`,
  `PROHIBITED_CONTENT`, …) para que el aviso en la interfaz sea legible.
- Una respuesta **truncada pero con texto** sí se aprovecha; se le añade una
  nota al final indicando que viene incompleta.

### 6.4 Umbrales configurables

| Constante | Por defecto | Efecto |
|---|---|---|
| `CONFIG.UMBRAL_DIAS_DEMORA` | `5` | Días a partir de los cuales una OS aparece en las alertas críticas. |
| `CONFIG.SEMANAS_EDITABLES` | `6` | Semanas hacia atrás que un colaborador puede corregir. |
| `CONFIG.IA_MAX_TOKENS` | `16384` | Techo de tokens de salida de Gemini (incluye razonamiento). |
| `CONFIG.IA_PRESUPUESTO_RAZONAMIENTO` | `1024` | Presupuesto de razonamiento. `0` lo desactiva, `-1` lo deja dinámico. |
| `PALABRAS_CRITICAS` / `PALABRAS_PERSONAL` | — | Vocabulario que dispara el marcado de riesgo. |

---

## 7. Métricas Clave de Directores

La columna **G de `Directores` — "Métricas Clave (Facturación, Forecast)"** es
una tabla de tres columnas:

| Métrica | Valor | Observación |
|---|---|---|
| Facturación acumulada | 3.900.000.000 | 92% de la meta del mes |
| Forecast del trimestre | 11.500.000.000 | Ajustado al alza |

Que la fila diga **cuál** métrica es tiene una consecuencia concreta: cada una
se vuelca a `KPI_Datos` con su propio nombre, así que se puede graficar su
tendencia semana a semana y compararla entre directores. Con sólo valor y
observación, esas cifras habrían sido texto suelto imposible de seguir en el
tiempo.

En el informe gerencial se leen como `Facturación acumulada: **3.900.000.000**
— 92% de la meta del mes`.

---

## 8. Pruebas

El proyecto trae un banco de pruebas que corre la lógica completa **fuera de
Google**, con dobles de prueba de `SpreadsheetApp`, `Utilities`,
`PropertiesService`, `LockService`, `Session`, `MailApp` y `UrlFetchApp`:

```bash
node pruebas/prueba-local.js         # ejecuta las ~105 verificaciones
VER=1 node pruebas/prueba-local.js   # además imprime el informe generado
```

Cubre: semana ISO y parseo de números colombianos, creación y verificación de
hojas, alias de cargos y control de acceso, guardado con *upsert*, ida y vuelta
de las tablas dentro de una celda (incluidos los caracteres escapados), no
duplicación de KPI, consolidación multi-área, las cinco secciones del informe
con sus umbrales, y la conversión Markdown → HTML (incluido el escape de HTML
malicioso).

Dos bloques valen la pena por separado:

- **El informe no es alcanzable desde la web** (§5.2): se verifica que las
  funciones de informe *no existan* como endpoint, que `apiSesion` no exponga
  permisos y que ni el HTML ni el JavaScript del cliente las mencionen. Si
  alguien vuelve a agregar un botón, las pruebas fallan.
- **Rol de Administrador** (§5.3): con y sin `ADMIN_CORREOS`, la excepción del
  propietario, insensibilidad a mayúsculas y el mensaje de error que explica
  cómo pedir acceso.

La integración con Gemini se prueba con la API simulada, así que se verifica
sin gastar cuota ni depender de la red: forma del `systemInstruction` y del
`contents`, que la clave viaje en el encabezado y **no** en la URL, el descarte
de las partes `thought`, y los cinco modos de fallo que caen al informe
determinista (HTTP 429, bloqueo de seguridad, respuesta vacía por
`MAX_TOKENS`, respuesta truncada con texto y caída de red).

Ejecútalo antes de tocar el `ESQUEMA`: si renombras una clave o una columna,
las pruebas lo detectan de inmediato.

---

## 9. Operación diaria

**Colaborador** — sólo necesita la URL de la aplicación web:

| Quiero… | Cómo |
|---|---|
| Reportar mi semana | Abrir la URL de la aplicación web. Año, semana y nombre vienen precargados. |
| Corregir una semana pasada | Cambiar el selector *Periodo a reportar* (hasta 6 semanas atrás). |

**Administrador** — todo desde el menú de Google Sheets (🔒 = requiere estar en
`ADMIN_CORREOS`):

| Quiero… | Cómo |
|---|---|
| Que el informe salga solo los jueves | 🔒 **Instalar envío automático (jueves 5:00 p. m.)**. Una sola vez. |
| Ver el informe antes del jueves | 🔒 **Previsualizar informe de esta semana**. No envía nada. |
| Enviarlo a mano ahora | 🔒 **Enviar informe ahora (manual)**. Pide confirmación. |
| Saber quién falta por reportar | Está en la vista previa: el anexo de cobertura al final del informe. |
| Revisar la configuración | 🔒 **Estado de la configuración** (gerente, admins, IA, disparador). |
| Comprobar que una columna no se rompió | 🔒 **Verificar / crear hojas**. |
