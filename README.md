# Diagnóstico de Vibraciones Kaeser — IFM VES004

Proyecto de **Google Apps Script + Google Sheets + interfaz web** para
estandarizar y automatizar el diagnóstico predictivo de compresores Kaeser
(Dry Screw, lubricados y sopladores) a partir de mediciones de vibración
tomadas con el **kit de diagnóstico IFM Octavis VES100 / software VES004**.

El motor de diagnóstico aplica la **Carta de Charlotte** (Technical Associates
of Charlotte) cruzada con la instrucción de montaje Kaeser
**MA 00-21-02.2** y las convenciones de exportación del VES004.

---

## 1. Cómo funciona el proceso VES004 (contexto)

El objetivo de la herramienta es **partir de donde termina el VES004**. Flujo
real según MA 00-21-02.2:

1. **Montaje de sensores** (§5): posiciones exactas por familia, avellanados
   limpios y sin pintura, **torque 9 Nm**, imanes de zapato para motores
   anteriores a 2019 sin roscas de fábrica. Ver tablas en `Config.gs`
   (`MONTAJE_SENSORES`).
2. **Conexión y parametrización** (§6): VES004 conecta con el VES100
   (IP Kaeser `169.254.100.101`), se importa el *parameter set* según el juego
   de engranajes del airend y el arranque (SFC / estrella-triángulo), y se
   ajusta el **escalado de velocidad** (señal 4–20 mA) — requisito para tener
   RPM y poder calcular órdenes.
3. **Recolección** (§7):
   - **Monitoring / valores actuales** (§7.1): valores globales por objeto de
     medición (v-RMS, a-RMS, HFD, gSE, temperatura, rpm) con **semáforo**
     rojo/amarillo/verde. *(Revisión 24.11.2025: mín. 300 muestras.)*
   - **Raw data** (§7.2): forma de onda temporal, **mín. 4 000 000 muestras**
     por sensor. Una franja recta en datos brutos = falla de cable / ajuste /
     posición del sensor.
   - **Espectros (FFT)**: derivados del raw. Convención Kaeser: **primera mitad
     en `mg` (aceleración) y segunda mitad en `mm/s` (velocidad)**, mín. 100
     muestras.
4. **Exportación** (§7.3): el `Export` del VES004 genera un **proyecto local**
   (parameter set + grabaciones, formato propietario IFM). El **CSV** para
   tendencia/análisis se obtiene desde la *Data Monitoring / Monitoring Window*
   (valores de característica por objeto). **Esta herramienta ingiere esos
   valores globales y/o el espectro exportado.**

> ⚠️ El manual del software IFM VES004 con el layout exacto del CSV no venía en
> el PDF adjunto (solo la instrucción de montaje Kaeser). El parser
> (`parseEspectro` en `Code.gs`) es **tolerante** (coma, `;`, tab o espacios;
> coma decimal europea) y usa las dos primeras columnas numéricas como
> `[frecuencia_Hz, amplitud]`. Con un CSV real de ejemplo se calibra en minutos.

---

## 2. Qué diagnostica el motor (Carta de Charlotte)

Implementado en `Diagnostico.gs`. Cada regla devuelve tipo, subtipo,
**confianza (0–100)**, severidad, evidencia y **acción correctiva**:

| Falla | Firma espectral detectada |
|---|---|
| **Desequilibrio** | 1X radial dominante, armónicos bajos. Recuerda verificar fase: estático ~0°, par 180°, dinámico mezcla. |
| **Desalineación** | 2X elevado. Angular → axial a 1X/2X. Paralela → radial con 2X ≥ 1X. |
| **Holgura mecánica** | Tipo C: sub-armónicos 0.5X/1.5X/2.5X + múltiples armónicos + piso de ruido alto. |
| **Rodamiento** | gSE/HFD + BPFO/BPFI/BSF/FTF con bandas laterales. Estadifica 1→4 (Etapa 3 = **reemplazar ya**). |
| **Engranaje** | GMF = nº dientes · fr, con bandas laterales ±1X. |
| **Fuerza hidráulica** | BPF = nº álabes · fr; cavitación = banda ancha de alta frecuencia ("grava"). |
| **Correa** | Frecuencia de correa 1×–4× (sub-1X). |
| **Motor eléctrico** | 2·FL (excentricidad de estator), bandas pole-pass a ±(1X) (barras rotas), 3×/6× FL (SCR en DC). |

Frecuencias características calculadas en `Frecuencias.gs`
(BPFO/BPFI/BSF/FTF/BDF, GMF, BPF, correa, eléctricas).

El **semáforo** compara los valores globales medidos contra los **límites de la
posición**: nivel de **aviso** (amarillo) y **condenatorio** (rojo), en
**velocidad (mm/s)** y **aceleración (g RMS)**, más gSE. Un rodamiento en
Etapa 3+ fuerza rojo. Si un equipo no tiene límites definidos, se usan los
defaults de `Config.gs`.

---

## 2.1 Base de datos (fuente de verdad por posición)

El rodamiento, la velocidad y los límites **dependen de la posición de
medición**, no del equipo en bloque. La BD está normalizada en hojas:

| Hoja | Rol |
|---|---|
| `Equipos` | TAG → familia, airend, motor, RPM motor, variador, FL, polos, arranque |
| `Posiciones` | **Fuente de verdad por sensor**: rodamiento(s), relación de transmisión, límites (vel/acel aviso y condenatorio), nº lóbulos (BPF), nº dientes (GMF) |
| `Rodamientos` | Por **coeficientes del fabricante** (BPFI/BPFO/BSF en órdenes/rev + nº elementos) **o** por geometría Nb/Bd/Pd/θ → frecuencias de defecto |
| `UnidadesCompresoras`, `Motores` | Catálogos maestros para poblar `Posiciones` |

**Velocidad por etapa (máquinas engranadas o por correa):** las etapas giran a
N× la velocidad del motor (multiplicadora en Dry Screw, poleas en SK). Se
guarda la **relación de transmisión** por posición; ingresas solo la **RPM del
motor** y el sistema deriva la RPM real de cada sensor — con ella calcula
órdenes y frecuencias de defecto correctos.

### Cómo migrar una tabla de frecuencias tipo Excel (ej. SK20 Sigma 10)

| Dato del Excel | Dónde va |
|---|---|
| Bearing + BPFI/BPFO/BSF (órdenes) + #ElemRod | Hoja `Rodamientos`, columnas `BPFI_orden`, `BPFO_orden`, `BSF_orden`, `Nb` |
| Frecuencias de falla en Hz | **No se guardan** — el script las calcula (orden × fr de la posición) |
| Diámetros de polea (142/123 mm) | `Posiciones.Relacion_vel` = 142/123 = 1.1545 |
| RPM motor (3565) | `Equipos.RPM_motor` |
| Varios rodamientos en una posición (macho + hembra) | `Posiciones.Rodamiento` = lista separada por comas: `NU206E,NA4904` |
| "Pasos de presión" (343 Hz = 5 × 68.6) | `Posiciones.N_lobulos` = 5 (es el BPF del tornillo) |

> ⚠️ **Cuidado clásico**: en tablas Excel es fácil calcular las frecuencias de
> falla del airend con la velocidad del MOTOR. Si el tornillo gira a 68.6 Hz,
> el BPFI del NU206E es 7.756 × 68.6 = **532 Hz**, no 7.756 × 59.4 = 461 Hz.
> Aquí eso no puede pasar: cada posición usa su propia velocidad derivada.

`Inicializar hojas` siembra datos de **EJEMPLO** (CSD-102 lubricado, DSG-220
engranado y **SK20-01 por correa con los coeficientes reales de la tabla
SK20 Sigma 10**); reemplaza límites y demás marcadores por los valores reales
de Kaeser Colombia. Los límites de aceleración condenatorios se comparan contra
el **a-RMS (g) del Monitoring** del VES004 (ver §5.2); el a-RMS estimado del
espectro es solo un apoyo cuando no se carga el Monitoring.

---

## 3. Estructura del proyecto

```
apps-script/
  appsscript.json      Manifiesto (web app, zona horaria)
  Config.gs            Catálogo: montaje, rodamientos, umbrales, constantes
  Frecuencias.gs       Calculadora de frecuencias de defecto
  Diagnostico.gs       Motor de reglas (Carta de Charlotte) + límites por posición
  BaseDatos.gs         Acceso a la BD: apiListaEquipos / apiEquipo (resuelve por sensor)
  Monitoring.gs        Parser del CSV de Monitoring (v/a-RMS, gSE, HFD, rpm reales)
  Importar.gs          Importación de 4 CSV (uno por sensor) + reporte consolidado
  Code.gs              Menú Sheets, doGet (web), API HTML, parser CSV, hojas
  Index.html           Interfaz web (selector de equipo + carga + reporte)
.clasp.json.example    Plantilla clasp (copiar a .clasp.json con tu scriptId)
ejemplos/              CSV de espectro de ejemplo (incl. medicion_CSD102_S1..S4.csv)
```

---

## 4. Despliegue con clasp

Requisitos: Node.js y una cuenta de Google.

```bash
# 1. Instalar clasp y autenticarse
npm install -g @google/clasp
clasp login

# 2a. Crear un proyecto NUEVO ligado a una hoja de cálculo (recomendado)
clasp create --type sheets --title "Diagnostico Vibraciones Kaeser" --rootDir apps-script
#   -> esto genera .clasp.json con el scriptId

# 2b. …o si YA tienes el proyecto, copia la plantilla y pega tu scriptId
cp .clasp.json.example .clasp.json    # edita "scriptId"

# 3. Subir el código
clasp push

# 4. Abrir el editor / la hoja
clasp open
```

En el editor de Apps Script / la hoja:

1. Menú **🔧 Diagnóstico Kaeser → Inicializar hojas** (crea Equipos, Posiciones,
   UnidadesCompresoras, Motores, Sensores, Mediciones, Espectros, Diagnostico,
   Umbrales, Rodamientos, con datos de ejemplo).
2. **Deploy → New deployment → Web app** (ejecutar como *tú*, acceso según tu
   organización). Copia la URL: esa es la interfaz de diagnóstico.

> El `scriptId` real no se versiona (`.clasp.json` está en `.gitignore`).

---

## 5. Uso de la interfaz web

1. Elige la **familia** (Dry Screw / Lubricado) → se muestra la guía de montaje
   con posiciones, tipo de sensor, torque y criterios de toma.
2. Ingresa **RPM del eje** (imprescindible para órdenes y frecuencias de
   defecto), dirección predominante y los **valores globales** disponibles
   (v-RMS, a-RMS, HFD, gSE).
3. Opcional: rodamiento (BPFO/BPFI…), FL/polos (eléctricas), dientes de
   engrane (GMF), nº álabes (BPF).
4. Opcional: **pega el espectro** exportado (una fila por línea).
5. **Diagnosticar** → semáforo, hallazgos ordenados por confianza con
   evidencia y acciones, y tabla de frecuencias características. Marca
   *Guardar* para historizar en la hoja `Diagnostico`.

El botón *Cargar ejemplo* usa `ejemplos/espectro_desalineacion_CSD102.csv`.

### 5.1 Importar una medición completa (4 CSV, uno por sensor)

Flujo estándar de campo: cada medición produce **4 archivos, uno por sensor**
(S1–S4). En el panel *Importar medición completa*:

1. Elige el **Equipo** en el selector (base de datos): autocompleta familia,
   RPM motor, FL/polos y precarga los 4 sensores con su **posición, rodamiento,
   RPM por etapa y límites**. (Sin equipo, funciona en modo manual por familia.)
2. Ajusta la **RPM motor** a la real de la toma si hay variador.
3. Carga los 4 CSV. Cada archivo es un espectro del VES004 con **1ª mitad `mg`
   (aceleración) y 2ª mitad `mm/s` (velocidad)**.
4. **Corte accel/vel**: *Automático* detecta el reinicio del eje de frecuencia
   entre las dos mitades; *Exacto a la mitad* corta en total/2.
5. *Importar y diagnosticar los 4 sensores* → guarda el espectro en la hoja
   `Espectros` (etiquetado por unidad) y muestra un **reporte consolidado**:
   semáforo del equipo (el peor de los 4) + diagnóstico por sensor.

El motor analiza los **órdenes** (1X/2X, holguras…) sobre la mitad de
**velocidad** y refuerza la evidencia de **rodamiento** con la mitad de
**aceleración**: un defecto que aparece solo en `mg` se clasifica como
**incipiente (Etapa 2)**, y cuando migra a `mm/s` como **avanzado (Etapa 3 →
reemplazar)**. Detecta además la "franja recta" (amplitud casi constante) que
indica falla de cable/ajuste/posición del sensor.

Archivos de ejemplo: `ejemplos/medicion_CSD102_S1..S4.csv` (S1 desalineación,
S2 normal, S3 rodamiento incipiente, S4 rodamiento avanzado).

### 5.2 CSV de Monitoring (valores globales reales)

Además del espectro, cada sensor admite (opcional) su **CSV de Monitoring** del
VES004 (§7.1): la serie temporal de valores globales. El sistema:

- Detecta las columnas por su encabezado (**v-RMS, a-RMS (g), HFD, gSE,
  temperatura, rpm/speed**), en cualquier orden y con separador coma/`;`/tab.
- Toma la **mediana** de la ventana como valor representativo (robusta frente a
  transitorios) y reporta el máximo.
- Usa esos **valores reales** para el semáforo (por encima del estimado del
  espectro), de modo que los límites **condenatorios en g y gSE** se evalúan
  contra lo medido.
- Toma la **RPM del Monitoring como velocidad real del motor** (señal 4–20 mA) —
  clave con variador — y deriva la RPM de cada etapa con su relación.
- Heurística de unidad: si el a-RMS "en g" es absurdamente alto, asume mg y
  convierte a g avisando.

El reporte etiqueta cada sensor con la fuente de los valores: *Monitoring (real)*
o *estimado del espectro*. Archivos de ejemplo:
`ejemplos/monitoring_CSD102_S1..S4.csv`.

---

## 6. Calibración y próximos pasos

- **Umbrales**: ajusta la hoja `Umbrales` para igualar el semáforo del
  parameter set real de cada equipo (Kaeser define límites por máquina).
- **Rodamientos**: agrega referencias en la hoja `Rodamientos`
  (Nb, Bd, Pd, θ) para ampliar la base de frecuencias de defecto.
- **CSV real del VES004**: al disponer de un export real, se ajusta el corte
  accel/vel y el mapeo de columnas (`parseEspectro` / `partirEspectro_`). Si el
  export incluye una columna de unidad (`mg`/`mm/s`) por fila, el corte se
  vuelve trivial.
- Pendiente sugerido: gráficos de tendencia por equipo/sensor a partir del
  histórico acumulado en `Espectros`/`Diagnostico`.
