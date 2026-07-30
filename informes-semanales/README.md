# Informes Semanales — Kaeser Compresores

Ecosistema de **Google Sheets + Apps Script + interfaz web** para recopilar los
informes periódicos de las siete áreas (Directores, Gestión Comercial, Asesores
KAM, DPA, Soporte Técnico, SAU/Renta/CDR y Desarrollo de Personal), almacenarlos
en una base de datos única y **generar y enviar automáticamente el informe
gerencial los viernes a las 6:00 a. m.**

---

## 1. Cómo funciona

```
                 ┌─────────────────────────────────────────┐
   Colaborador → │ Interfaz web — vista según el rol        │
 Administrador → │  colaborador  → sólo su formulario       │
                 │  administrador→ sólo vista previa+envío  │
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
                                 │ viernes 06:00 (disparador automático)
                                 │ o a mano por el Administrador
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
| `Adjuntos.gs` | Guarda imágenes y tablas en Google Drive, con una carpeta por semana. |
| `Kpis.gs` | Extracción automática de métricas hacia `KPI_Datos`. |
| `Informe.gs` | Consolidación semanal y redactor determinista (las 5 secciones). |
| `Ia.gs` | Conector con la API de Gemini (`gemini-2.5-flash`) para la redacción asistida (opcional). |
| `Correo.gs` | Markdown → HTML, envío del correo y disparador semanal. |
| `Code.gs` | Menú de Sheets, `doGet()` y la API que consume la interfaz. |
| `Index.html`, `Estilos.html`, `Js.html` | Interfaz web dinámica. |
| `pruebas/prueba-local.js` | Banco de pruebas bajo Node con dobles de los servicios de Google. |

### 2.1 Convención de visibilidad — qué se puede ejecutar y qué no

En Apps Script, **una función cuyo nombre termina en `_` es privada**: no
aparece en el selector de **▶ Ejecutar** del editor y no puede invocarse con
`google.script.run`. Todo el proyecto usa esa convención, así que el editor sólo
ofrece los **16 puntos de entrada** reales:

| Función | Quién la ejecuta |
|---|---|
| `onOpen()` | Google Sheets, al abrir el libro |
| `doGet()`, `include()` | La aplicación web |
| `menuInicializar()`, `menuUrlWebApp()`, `menuVerificarApi()`, `menuPrevisualizar()`, `menuEnviarAhora()`, `menuInstalarDisparador()`, `menuEstado()` | El menú de la hoja |
| `apiSesion()`, `apiCargarRegistro()`, `apiGuardar()` | El navegador vía `google.script.run` |
| `apiPrevisualizarCorreo()`, `apiEnviarInformeGerencial()` | Ídem, pero **exigen Administrador en el servidor** |
| `enviarInformeSemanal()` | El disparador semanal |

Todo lo demás termina en `_` porque **espera argumentos** (área, año, semana,
nombre) que el editor no tiene cómo suministrar. Ejecutar una de esas funciones
a mano produce errores del tipo `Área desconocida: "undefined"`.

> ✅ **La única función segura de ejecutar desde el editor para probar el
> circuito completo es `enviarInformeSemanal`**: no lleva argumentos, toma la
> semana en curso y manda el correo de verdad. Para lo demás, usa el menú
> **📊 Informes Semanales**.

Una prueba automática congela esa lista: si alguien agrega una función pública
nueva, el banco de pruebas falla y obliga a decidir si es un punto de entrada o
si le faltó el `_`.

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

### 3.3 Tipos de campo disponibles

| `tipo` | Control en la interfaz | Cómo se guarda |
|---|---|---|
| `texto` | Área de texto o campo de una línea | Texto plano en la celda |
| `tabla` | Filas dinámicas con columnas fijas | Bloque `col \| col \| …` con encabezado |
| `tablaLibre` | Recuadro que recibe un rango **pegado desde Excel** | Igual, pero los encabezados son los de la hoja de origen |
| `imagen` | Zona para **pegar (Ctrl+V)**, arrastrar o elegir archivo | `Archivo \| Enlace` a Drive, opcionalmente `\| Comentario` |

Las columnas de una `tabla` admiten además `opciones`:

```js
{ clave: 'sucursal', titulo: 'Sucursal', opciones: SUCURSALES }               // lista cerrada → <select>
{ clave: 'distribuidor', titulo: 'Distribuidor',
  opciones: DISTRIBUIDORES, abierta: true }                                   // lista abierta → sugerencias
```

La diferencia no es cosmética. Una **lista cerrada** obliga a que "Antioquia"
se escriba siempre igual, y eso es lo que permite que la serie de KPI de esa
sucursal no se parta en tres. Una **lista abierta** sugiere los distribuidores
conocidos pero deja registrar uno nuevo sin esperar a que alguien lo agregue al
código.

### 3.4 Adjuntos: imágenes y tablas de Excel

Los campos `imagen` no guardan bytes en la hoja: suben el archivo a Drive y
dejan en la celda el nombre y el enlace, de modo que la hoja sigue siendo
legible y auditable. La carpeta se crea sola:

```
<carpeta raíz configurada>/
  2026/
    Semana 31 (27 jul – 02 ago)/
      Gestión Comercial/
        S31 - Órdenes Relevantes - Carlos Arbeláez.png
      Soporte Técnico/
        S31 - First Time Fix Rate (FTF) - Edilfonso Vaca.png
```

- Volver a enviar el reporte **reemplaza** la imagen (mismo nombre) en vez de
  acumular duplicados; la anterior queda en la papelera de Drive.
- Un adjunto ya guardado **no se vuelve a subir**: el formulario devuelve sólo
  su enlace.
- Tope de 8 MB por archivo (`CONFIG.ADJUNTO_MAX_MB`).

Para las **tablas de Excel** (`tablaLibre`) no se sube archivo: se copia el
rango en Excel y se pega en el recuadro. A diferencia de una captura, así **las
cifras siguen siendo datos**: se pueden leer, sumar y reproducir como tabla en
el informe. Se prefiere el HTML que Excel deja en el portapapeles (un `<table>`
real, que conserva celdas vacías, combinadas y valores con saltos de línea) y se
recurre al texto tabulado sólo como respaldo.

#### Cómo pegar: las tres vías

| Vía | Cómo |
|---|---|
| **Ctrl+V** | Clic en el recuadro (queda resaltado) y `Ctrl+V` / `⌘+V`. |
| **Botón** | `📋 Pegar imagen` o `📋 Pegar tabla`. |
| **Arrastrar** o `📁 Elegir archivo` | Sólo para imágenes. |

Detalles que explican por qué está montado así:

- Un evento `paste` **sólo llega al elemento que tiene el foco**. Por eso el clic
  en el recuadro se limita a enfocarlo: si abriera el explorador de archivos, el
  diálogo se llevaría el foco y `Ctrl+V` dejaría de funcionar. Abrir el
  explorador es un botón aparte, y no es un detalle cosmético — era exactamente
  la causa de que pegar no funcionara.
- Además se escucha el pegado **a nivel de documento** y se encamina al recuadro
  activo, para que `Ctrl+V` también sirva nada más abrir el formulario, cuando el
  foco todavía está en el cuerpo de la página. Si hay varios recuadros del mismo
  tipo y no se ha elegido ninguno, el sistema **pide elegir** en vez de adivinar.
- Pegar texto dentro de una caja de texto sigue pegando texto. Sólo se desvía al
  recuadro cuando lo que hay en el portapapeles es una imagen — así se puede
  pegar la captura estando el cursor en el comentario del área.
- Los botones `📋 Pegar` usan la API de portapapeles del navegador. El marco en
  que Apps Script sirve la interfaz **no siempre concede ese permiso**; cuando lo
  niega, el botón deja el recuadro enfocado y pide el atajo, que nunca depende de
  permisos.
- Una imagen copiada desde una página o un documento a veces no viaja como
  archivo sino incrustada en el HTML del portapapeles; ese caso también se
  reconoce.

### 3.5 `KPI_Datos`

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
Script** y crea los 14 archivos. Deben quedar exactamente así:

| Tipo | Archivos |
|---|---|
| **Script** (10) | `Adjuntos.gs` · `Code.gs` · `Config.gs` · `Correo.gs` · `Datos.gs` · `Ia.gs` · `Informe.gs` · `Kpis.gs` · `Semana.gs` · `Usuarios.gs` |
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
| `CORREO_GERENTE` | ✅ | Destinatario del informe semanal. |
| `CORREO_COPIA` | — | Copias del informe (separadas por coma). |
| `GEMINI_API_KEY` | — | Clave de la API de Gemini (se obtiene en [Google AI Studio](https://aistudio.google.com/apikey)). Activa la redacción asistida; sin ella se usa el informe automático. |
| `MODELO_IA` | — | Modelo a usar. Por defecto `gemini-2.5-flash`. Se admite escribirlo con o sin el prefijo `models/`. |
| `CARPETA_DRIVE` | — | ID de la carpeta de Drive para los adjuntos. Por defecto, la de `CONFIG.DRIVE_CARPETA_RAIZ`. |

> 🔑 **La clave de Gemini no va en el código.** Va aquí, en las propiedades del
> script, y `Ia.gs` la lee con `PropertiesService`. Escrita dentro de un `.gs`
> quedaría versionada en Git y visible para cualquiera con acceso al proyecto.

> 👤 **El Administrador no se configura aquí.** Se otorga escribiendo
> `Administrador` en la columna **Cargo** de la hoja `Usuario` (§5.3). No hay
> ninguna propiedad de script para eso: un permiso repartido en dos sitios
> acabaría contradiciéndose.

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

### 4.5 Comprobar que todo está listo

Menú **📊 Informes Semanales → 🔒 Verificar conexión con Gemini**. Revisa cinco
cosas y dice cuáles fallan:

| Verifica | Cómo |
|---|---|
| **Gemini** | Hace una llamada real y mínima al modelo. No basta con mirar si hay clave: una clave revocada, un modelo mal escrito o una cuota agotada se ven igual que una configuración correcta hasta que se intenta usar. |
| **Drive** | **Crea y borra un archivo de prueba.** La cuenta puede *ver* la carpeta y aun así no poder escribir en ella, y ese fallo sólo aparecería cuando alguien intente adjuntar una imagen. |
| **Destinatario** | Que `CORREO_GERENTE` esté configurado. |
| **Envío automático** | Que el disparador esté instalado. |
| **Semana en curso** | Cuántos reportes llegaron, cuántas imágenes leerá Gemini y quién falta. |

Los errores traen la causa probable y la propiedad a corregir: un `404` señala
`MODELO_IA`, un `429` avisa que se agotó la cuota, una carpeta inaccesible
apunta a `CARPETA_DRIVE`.

### 4.6 Activar el envío automático

Menú **📊 Informes Semanales → 🔒 Instalar envío automático (viernes 6:00 a. m.)**.

- **Este paso no es opcional.** Sin él, el informe no sale nunca solo. El menú
  **🔒 Estado de la configuración** lo advierte si falta.
- **El día y la hora se configuran en `Config.gs`** (`ENVIO_DIA`, `ENVIO_HORA`,
  `ENVIO_ETIQUETA`), no repartidos por el código. Tras cambiarlos hay que volver
  a ejecutar esta opción para que el disparador se reemplace.
- El día elegido debe caer al final de la semana ISO (jueves a domingo): el
  disparador informa siempre **la semana en curso**, así que un envío en lunes
  cubriría la semana que apenas empieza, no la que cerró.
- Es idempotente: reinstalar no duplica el disparador.
- La hora se interpreta en `America/Bogota` (declarada en `appsscript.json` y
  fijada explícitamente con `.inTimezone()` al crear el disparador).
- Apps Script ejecuta los disparadores por tiempo dentro de una ventana de
  ~15 minutos alrededor de la hora indicada; para un informe semanal esa
  precisión sobra.
- El disparador corre con la cuenta que lo instaló: el correo sale desde esa
  cuenta y consume su cuota diaria de Gmail. Instálalo con la cuenta que quieras
  que figure como remitente.
- Si el envío falla, el propio disparador avisa por correo a quienes tengan el
  cargo de **Administrador** en la hoja `Usuario`, con el motivo del error.

---

## 5. Control de acceso

Hay **dos roles y nada más**: el colaborador, que sólo registra su propio
reporte; y el Administrador, único que puede disparar el informe a mano.

Los dos salen del **mismo sitio**: la columna `Cargo` de la hoja `Usuario`. Ese
es el único mando del control de acceso — quien administre el sistema no necesita
entrar al editor de Apps Script para cambiar quién puede hacer qué.

### 5.1 Colaborador — la hoja `Usuario` es la lista blanca

- El correo se toma de la sesión de Google, no de un campo del formulario: nadie
  puede reportar a nombre de otro colaborador desde la interfaz.
- El `Cargo` se traduce al área con `areaDeCargo_()`, que acepta variantes
  razonables (`SAU`, `Asesores CAN` → `Asesores KAM`, con o sin tildes).
- Si el correo no está en la hoja, la interfaz no muestra ningún formulario.
- Cada llamada al servidor (`apiSesion`, `apiCargarRegistro`, `apiGuardar`)
  revalida al usuario: la interfaz nunca decide sola qué puede hacer alguien.

> ℹ️ La hoja `Usuario` del archivo actual no tiene ninguna fila con el cargo
> **Asesores KAM**, aunque la hoja existe. Agrega a los asesores allí para que
> puedan entrar a su formulario.

### 5.2 Dos vistas, una por rol

`apiSesion()` decide qué se muestra, y el servidor entrega **sólo los datos que
corresponden al rol**:

| Rol | Qué recibe de `apiSesion()` | Qué ve |
|---|---|---|
| **Colaborador** | Su área, sus campos y su registro | Únicamente el formulario de su área |
| **Administrador** | Destinatario, copia y estado de la IA | Únicamente el panel del informe: vista previa del correo y botón de envío |

El administrador **no ve ningún formulario**: el cargo `Administrador` no
corresponde a ninguna área, porque quien lo tiene consolida lo que reportan las
demás en vez de reportar un área propia.

Si la misma persona debe además entregar su reporte semanal, se le escribe el
cargo compuesto —`Administrador SAU`— y se activa
`CONFIG.ADMIN_TAMBIEN_REPORTA = true` en `Config.gs`. Entonces ve las dos cosas:
el panel del informe y el formulario de su área.

> Esto importa en la práctica: quien administra el sistema suele estar también en
> la hoja como colaborador de un área. Cambiarle el cargo a `Administrador` a
> secas le da el permiso pero **le quita su formulario**; el cargo compuesto es la
> forma de conservar los dos.

### 5.3 Dónde vive de verdad el permiso

Ocultar botones **no es seguridad**: cualquier función pública de `Code.gs` es
invocable desde la consola del navegador con `google.script.run.<nombre>()`. Un
colaborador podría llamar a `apiEnviarInformeGerencial` aunque no vea el botón.

Por eso la barrera está en la **primera línea de cada endpoint**:

```js
function apiEnviarInformeGerencial(anio, semana) {
  exigirAdministrador_();          // ← la barrera real
  return enviarInforme_(...);
}
```

Las pruebas cubren los dos lados: que un colaborador que invoque esas funciones
directamente reciba un error **y que no se envíe ningún correo**, y —de forma
estática sobre el código fuente— que ambas conserven esa llamada, para que nadie
pueda quitarla sin que el banco de pruebas falle.

El mismo criterio aplica al menú de Google Sheets, donde cada acción pasa por
`exigirAdministrador_()`:

- **Administrador** = quien tenga `Administrador` en la columna **Cargo** de la
  hoja `Usuario`. No hay ninguna lista de correos aparte: el permiso se otorga y
  se retira escribiendo en esa celda, en el mismo sitio donde ya se decide qué
  formulario ve cada persona.
- Cambiarle el cargo a un área le quita el rol y le devuelve su formulario. El
  efecto es inmediato: no hay que volver a publicar nada.
- Se acepta también `Admin`, y un cargo compuesto como `Administrador SAU` para
  quien administra el sistema y además debe entregar su propio reporte (requiere
  `CONFIG.ADMIN_TAMBIEN_REPORTA = true`). Un cargo que sólo se *parece*, como
  `Administrativo` o `Director Administrativo`, no otorga nada.
- Mientras **nadie** tenga ese cargo se acepta al **propietario del libro**, para
  que un libro recién creado no quede sin nadie que pueda operarlo. En cuanto se
  escribe el primer Administrador, esa excepción deja de aplicar.
- Quien no sea administrador ve el menú, pero al hacer clic recibe un aviso
  explicando cómo pedir acceso. No se ejecuta nada.

Además, con la implementación recomendada (§4.4) los colaboradores **no tienen
acceso al libro de Sheets**, así que ni siquiera ven ese menú.

### 5.4 La vista previa es el correo

`construirCorreo_()` es el **único** lugar donde se arma el mensaje, y lo usan
por igual la vista previa y el envío real. Por eso lo que el administrador ve
—remitente, copia, asunto, cabecera de Kaeser, informe y pie— es idéntico
carácter por carácter a lo que recibe la gerencia.

No es un detalle estético: si la vista previa se armara por su cuenta, podría
divergir del correo real sin que nadie lo notara. Una prueba compara ambos
resultados y falla si dejan de coincidir.

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
responde un error o el modelo declina la solicitud, el correo semanal sale
igual con toda la información. Los avisos de por qué se usó el respaldo se ven
en la vista previa de la interfaz.

### 6.3 Cómo lee Gemini las imágenes

> ⚠️ **Gemini no puede navegar una carpeta de Drive.** `generateContent` no tiene
> conector a Drive: sólo acepta bytes dentro de la petición (`inline_data`) o
> URIs de su propia Files API.

El sistema consigue el mismo resultado por otra vía: al redactar el informe,
**Apps Script recorre la carpeta de la semana, lee los archivos con `DriveApp` y
los adjunta a la petición**. Cada imagen va precedida de una parte de texto que
dice de qué área y de qué indicador es —sin ese rótulo el modelo recibe capturas
sin contexto— y, si el campo tiene comentario, también lo incluye.

**El informe no menciona adjuntos.** Las cifras de las imágenes quedan escritas
dentro del texto, en la sección que les corresponde. Las directrices prohíben
explícitamente escribir "ver imagen adjunta", nombrar archivos o enlazar
carpetas: la gerencia lee el informe, no abre archivos. Al JSON que viaja al
modelo tampoco se le pasan nombres de archivo, sólo el comentario del área —
nombrarlos invitaba al modelo a remitir al adjunto.

**Gráficas.** Cuando una imagen es una gráfica, el modelo la reconstruye en dos
partes: una **tabla Markdown** con los datos que puede leer (serie, periodo,
valor) y dos o tres **viñetas con la lectura gerencial** — tendencia, punto de
quiebre, valor atípico y su implicación. La tabla es el dato; las viñetas son el
análisis, que es lo que se espera del informe.

> El modelo devuelve texto, así que "replicar la gráfica" significa
> **reconstruir sus datos y explicarla**, no volver a dibujarla. En un correo eso
> suele ser más útil: la tabla se puede copiar, comparar y auditar, y sobrevive a
> los clientes de correo que bloquean imágenes.

| Tope | Valor | Por qué |
|---|---|---|
| `CONFIG.IA_MAX_IMAGENES` | 12 | Evita peticiones desproporcionadas |
| `CONFIG.IA_MAX_MB_IMAGENES` | 14 MB | Una petición con datos en línea no debe pasar de ~20 MB |

Si una imagen se omite —porque se borró de Drive, porque se superó un tope o
porque su tipo no es interpretable— **el informe se envía igual** y el aviso
dice cuál faltó. Nunca se calla.

### 6.4 Cómo se llama a Gemini

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

### 6.5 Umbrales configurables

| Constante | Por defecto | Efecto |
|---|---|---|
| `CONFIG.UMBRAL_DIAS_DEMORA` | `5` | Días a partir de los cuales una OS aparece en las alertas críticas. |
| `CONFIG.SEMANAS_EDITABLES` | `6` | Semanas hacia atrás que un colaborador puede corregir. |
| `CONFIG.IA_MAX_TOKENS` | `16384` | Techo de tokens de salida de Gemini (incluye razonamiento). |
| `CONFIG.IA_PRESUPUESTO_RAZONAMIENTO` | `1024` | Presupuesto de razonamiento. `0` lo desactiva, `-1` lo deja dinámico. |
| `CONFIG.ADJUNTO_MAX_MB` | `8` | Peso máximo por archivo adjunto. |
| `CONFIG.IA_MAX_IMAGENES` / `IA_MAX_MB_IMAGENES` | `12` / `14` | Cuántas imágenes viajan a Gemini y cuánto pesan. |
| `CONFIG.ENVIO_DIA` / `ENVIO_HORA` | `FRIDAY` / `6` | Cuándo sale el informe. Requiere reinstalar el disparador. |
| `CONFIG.ADMIN_TAMBIEN_REPORTA` | `false` | Si es `true`, al administrador se le muestra además el formulario de su área. |
| `PALABRAS_CRITICAS` / `PALABRAS_PERSONAL` | — | Vocabulario que dispara el marcado de riesgo. |

---

## 7. Consecuencia de convertir indicadores en imágenes

Cuatro ítems pasaron de tabla a imagen adjunta: **Órdenes Relevantes**,
**KPIs de Convenios**, **Métricas Línea de Emergencia** y **First Time Fix
Rate**. Es lo que se pidió y ya está implementado, pero tiene un efecto que
conviene tener presente:

**esas cifras dejan de alimentar `KPI_Datos`.** Antes, el `% FTF` o el número de
convenios activos se guardaban como números y podían graficarse semana a semana.
Ahora viven dentro de una imagen: Gemini las lee para redactar el informe, pero
**no quedan como serie histórica** ni se pueden comparar entre semanas.

Qué se conserva y qué no:

| Ítem | Antes | Ahora |
|---|---|---|
| Órdenes Relevantes | Tabla (sin KPI) | Imagen — sin pérdida de KPI |
| KPIs de Convenios | Activos / nuevos / cancelados en `KPI_Datos` | Imagen — **se pierde la serie** |
| Métricas Línea de Emergencia | KPI por indicador | Imagen — **se pierde la serie** |
| First Time Fix Rate | `% FTF` y visitas adicionales | Imagen + comentario — **se pierde la serie** |
| Estado de Contratos (Directores) | Estado / cantidad | **Gana** KPI por asesor: vigentes, vencidos y % cumplimiento |

Si en algún momento quieren recuperar la tendencia de FTF o de convenios sin
renunciar a la imagen, la vía más simple es agregar al ESQUEMA un campo numérico
corto junto al adjunto (`tipo: 'texto'`, `lineas: 1`, con su `kpis`). Son tres
líneas en `Config.gs`; el resto del sistema se adapta solo.

---

## 8. Métricas Clave de Directores

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

## 9. Pruebas

El proyecto trae un banco de pruebas que corre la lógica completa **fuera de
Google**, con dobles de prueba de `SpreadsheetApp`, `Utilities`,
`PropertiesService`, `LockService`, `Session`, `MailApp` y `UrlFetchApp`:

```bash
node pruebas/prueba-local.js         # ejecuta las ~250 verificaciones
VER=1 node pruebas/prueba-local.js   # además imprime el informe generado
```

Cubre: semana ISO y parseo de números colombianos, creación y verificación de
hojas, alias de cargos y control de acceso, guardado con *upsert*, ida y vuelta
de las tablas dentro de una celda (incluidos los caracteres escapados), no
duplicación de KPI, consolidación multi-área, las cinco secciones del informe
con sus umbrales, y la conversión Markdown → HTML (incluido el escape de HTML
malicioso).

Dos bloques valen la pena por separado:

- **Autorización del informe** (§5.3): que un colaborador que invoque los
  endpoints directamente reciba un error y **no se envíe ningún correo**, y
  —de forma estática sobre el código— que ambos endpoints conserven la llamada
  a `exigirAdministrador_()`.
- **Vista previa = correo enviado** (§5.4): se comparan ambos resultados y la
  prueba falla si dejan de coincidir.
- **Rol de Administrador** (§5.3): que el cargo lo otorgue y lo retire, que un
  cargo parecido (`Administrativo`) no lo herede, la excepción del propietario
  mientras la hoja no nombre a nadie, y el mensaje de error que dice en qué celda
  se concede.
- **Pegado en la interfaz** (§3.4): `Js.html` se carga en un navegador simulado
  y se **dispara un evento `paste` de verdad** para comprobar dónde aterriza.
  Cubre el encaminamiento (imagen → recuadro de imagen, texto tabulado → recuadro
  de tabla, negativa a adivinar cuando hay dos candidatos), que pegar texto en un
  `textarea` siga siendo pegar texto, el troceado del TSV con celdas vacías,
  comillas escapadas y saltos de línea dentro de una celda, y —de forma estática
  sobre el código— que el clic en el recuadro ya **no** abra el explorador de
  archivos, que es lo que rompía el pegado.

La integración con Gemini se prueba con la API simulada, así que se verifica
sin gastar cuota ni depender de la red: forma del `systemInstruction` y del
`contents`, que la clave viaje en el encabezado y **no** en la URL, el descarte
de las partes `thought`, y los cinco modos de fallo que caen al informe
determinista (HTTP 429, bloqueo de seguridad, respuesta vacía por
`MAX_TOKENS`, respuesta truncada con texto y caída de red).

### 9.1 Prueba contra la API real

Hay además una prueba que sí llama a Gemini, y que sólo se ejecuta si le pasas
una clave por el entorno:

```bash
GEMINI_API_KEY=tu-clave node pruebas/prueba-local.js
GEMINI_API_KEY=tu-clave VER=1 node pruebas/prueba-local.js   # imprime el informe real
```

Sin la variable, la sección se omite con un aviso. **La clave nunca se escribe en
el repositorio**: se lee del entorno, igual que en producción se lee de las
propiedades del script.

Comprueba lo que ninguna simulación puede: que la clave sea válida, que el modelo
exista, que las imágenes de la semana lleguen de verdad, y que el informe que
redacta el modelo real traiga las cinco secciones, use negritas y **no remita al
lector a ningún adjunto ni nombre archivos** — la directriz añadida en §6.3, que
sólo un modelo real puede confirmar que se está respetando.

Ejecútalo antes de tocar el `ESQUEMA`: si renombras una clave o una columna,
las pruebas lo detectan de inmediato.

---

## 10. Operación diaria

**Colaborador** — sólo necesita la URL de la aplicación web:

| Quiero… | Cómo |
|---|---|
| Reportar mi semana | Abrir la URL de la aplicación web. Año, semana y nombre vienen precargados. |
| Corregir una semana pasada | Cambiar el selector *Periodo a reportar* (hasta 6 semanas atrás). |

**Administrador** — al abrir la misma URL de la aplicación web ve el panel del
informe en lugar del formulario:

| Quiero… | Cómo |
|---|---|
| Ver el correo antes de mandarlo | Botón **Ver vista previa**. Muestra el mensaje tal como llegará. |
| Enviarlo ahora | Botón **Enviar al gerente**. Pide confirmación. |
| Enviar el de una semana anterior | Cambiar el selector *Semana del informe* (hasta 6 semanas atrás). |
| Saber quién falta por reportar | Está en la vista previa: el anexo de cobertura al final del informe. |

Y desde el menú de Google Sheets, para la configuración
(🔒 = requiere el cargo `Administrador` en la hoja `Usuario`):

| Quiero… | Cómo |
|---|---|
| Que el informe salga solo cada semana | 🔒 **Instalar envío automático (viernes 6:00 a. m.)**. Una sola vez. |
| Revisar la configuración | 🔒 **Estado de la configuración** (gerente, admins, IA, disparador). |
| Comprobar que una columna no se rompió | 🔒 **Verificar / crear hojas**. |
| Saber si todo está listo para el viernes | 🔒 **Verificar conexión con Gemini**. |
| Previsualizar o enviar sin abrir la web | 🔒 **Previsualizar informe** / 🔒 **Enviar informe ahora**. |

---

## 11. Solución de problemas

### `SyntaxError: Unexpected token '<', línea 1`

El editor está leyendo HTML como si fuera JavaScript. Dos causas:

1. **Un archivo HTML se creó como Script** y quedó en `.gs`. Se corrige
   borrándolo y creándolo de nuevo con `+ → HTML` (ver §4.1).
2. **El contenido de un `.html` quedó pegado dentro de un `.gs`.** Para
   ubicarlo: cada archivo `.gs` de este proyecto lleva **su propio nombre en la
   línea 2**. Si `Ia.gs` no dice `* Ia.gs` en la línea 2, ahí está el error.

### `Área desconocida: "undefined"`

Se ejecutó una función interna desde el botón **▶ Ejecutar** del editor. Esas
funciones esperan argumentos que el editor no puede pasar, así que reciben
`undefined`.

Cómo reconocerlo en el registro de ejecuciones: **la traza no tiene una función
que la llamara encima**. Si el error viniera del uso normal, arriba aparecerían
`apiCargarRegistro` y `apiSesion`.

```
areaOError_    @ Datos.gs      ← el error
hojaDeArea_    @ Datos.gs
leerRegistro_  @ Datos.gs      ← nada la llamó: la ejecutó el editor
```

No es un fallo del sistema: la interfaz web y el menú funcionan con normalidad.
Desde la versión actual, esas funciones son privadas y **ya no aparecen en el
selector del editor**. Usa el menú **📊 Informes Semanales** o, si quieres
probar el envío completo, ejecuta `enviarInformeSemanal`.

### `No fue posible identificar tu cuenta de Google`

La implementación web no está como *Ejecutar como: Yo* + *Acceso: dominio*
(§4.4), o se está entrando con una cuenta que no es `@kaeser.com`.

### El correo no llegó el viernes

Revisa en orden, desde **🔒 Estado de la configuración**:

1. ¿Dice `Envío automático: instalado`? Si no, falta el paso §4.5.
2. ¿`CORREO_GERENTE` está configurado?
3. Mira **Ejecuciones** en el editor: si el disparador falló, el propio sistema
   envía el motivo a quienes tengan el cargo de `Administrador`.
4. Cuota de Gmail: el correo sale desde la cuenta que instaló el disparador.

### El informe salió sin análisis de IA

Es el comportamiento previsto ante cualquier fallo externo: se envía el informe
determinista con toda la información. El motivo aparece en el aviso ámbar de
**🔒 Previsualizar informe de esta semana** — clave ausente, cuota agotada,
bloqueo de seguridad o red caída.
