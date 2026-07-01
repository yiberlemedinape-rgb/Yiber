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

El **semáforo global** prioriza los valores globales medidos (v-RMS estilo
ISO 10816-3, gSE) y fuerza rojo ante rodamiento en Etapa 3+.
Umbrales por defecto en `Config.gs` y editables en la hoja `Umbrales`.

---

## 3. Estructura del proyecto

```
apps-script/
  appsscript.json      Manifiesto (web app, zona horaria)
  Config.gs            Catálogo: montaje, rodamientos, umbrales, constantes
  Frecuencias.gs       Calculadora de frecuencias de defecto
  Diagnostico.gs       Motor de reglas (Carta de Charlotte)
  Importar.gs          Importación de 4 CSV (uno por sensor) + reporte consolidado
  Code.gs              Menú Sheets, doGet (web), API HTML, parser CSV, hojas
  Index.html           Interfaz web (formulario + reporte)
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

1. Menú **🔧 Diagnóstico Kaeser → Inicializar hojas** (crea Equipos, Sensores,
   Mediciones, Espectros, Diagnostico, Umbrales, Rodamientos).
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

1. Elige la **familia** (define qué es S1..S4 y muestra su posición/tipo).
2. Completa **TAG** y **RPM** (panel 1). Opcional: FL/polos, y **rodamiento por
   sensor** (motor y airend suelen llevar rodamientos distintos).
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
