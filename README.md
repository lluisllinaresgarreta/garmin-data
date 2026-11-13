# garmin-data

Descarga datos de Garmin Connect (Forerunner 265) y Freestyle Libre 2, y mantiene
publicado el dashboard "Panel Forerunner 265" (Claude Artifact).

## Uso local

```
pip install -r requirements.txt
cp .env.example .env   # rellena GARMIN_EMAIL, GARMIN_PASSWORD, LIBRE_EMAIL, LIBRE_PASSWORD, HEVY_API_KEY
python fetch_garmin_data.py --days 90
python fetch_libre_data.py
python fetch_hevy_exercises.py
python build_combined.py
python merge_recent_history.py <data.json-publicado-o-vacio-la-primera-vez>
```

Genera `data/*.csv`/`*.json` y, al final, `data.json` en la raíz (los datos que
consume el dashboard) — `merge_recent_history.py` es el paso final tanto en
local como en las rutinas en la nube. `dashboard.html`/`app.js`/`styles.css`
son el código y el diseño del panel — no cambian con una sincronización
normal, solo `data.json` (y `glucose_month.json`, ver más abajo).

## Arquitectura del dashboard

El Artifact publicado tiene 5 archivos:
- `index.html` (local: `dashboard.html`) — estructura, sin datos ni estilos inline.
- `app.js` — todo el JS, envuelto en `main(DATA)`, invocado tras `fetch('data.json')`.
- `styles.css` — todo el CSS.
- `data.json` — los datos. Es el archivo que toca una sincronización normal.
- `glucose_month.json` — buffer del informe mensual de glucosa (ver más abajo),
  cargado solo cuando se abre esa sección, no al cargar el dashboard.

## Sincronización rápida incremental

`fetch_garmin_data.py --days N` descarga métricas diarias día a día (varias
llamadas a Garmin por día), así que pedir siempre 90 días es lento. En vez de
eso:
- `compute_sync_days.py <data.json-publicado>` calcula cuántos días hace falta
  pedir de verdad (días desde la última fecha ya conocida + margen de 3 días).
- `merge_recent_history.py <data.json-publicado>` fusiona el `data/combined.json`
  recién construido (con esa ventana reducida) con el histórico completo que ya
  estaba publicado, para que ninguna actividad ni día más antiguo se pierda.
  También recalcula `is_pr` sobre el histórico completo fusionado, no solo sobre
  la ventana nueva.

## Sincronización rápida de glucosa / de hoy

- `patch_glucose.py` y `patch_daily_today.py` parchean solo la clave `glucose` o
  la fila de hoy en `daily` dentro del `data.json` ya publicado, sin rehacer todo
  el pipeline — pensados para sincronizaciones rápidas bajo demanda.
- `extract_prev_glucose.py` / `merge_prev_glucose.py` conservan la correlación de
  glucosa por actividad que LibreLinkUp ya no puede recalcular (ventana móvil de
  ~12h) entre sincronizaciones.
- `patch_glucose.py` también mantiene `glucose_month.json` al día (ver la sección
  del informe mensual) usando `data/prev_glucose_month.json`, el mismo
  intermedio que escribe `extract_prev_glucose_month.py` para la sincronización
  completa -- así el informe se beneficia de cada sincronización de glucosa, no
  solo de las 2 completas al día.

## Curva de glucosa nocturna (`glucose.night_series`)

Para que el entrenador (Claude) pueda analizar patrones nocturnos, `data.json`
incluye `glucose.night_series`, un objeto `{fecha_de_la_mañana: {start, step_min,
values}}` con la curva de 21:00 a 09:00 (hora local) muestreada cada 15 minutos
(`values` tiene 48 enteros en mg/dL o `null`), para las últimas 14 noches. No se
muestra en la interfaz, es solo para análisis.

No hace ninguna llamada nueva a LibreLinkUp: `compute_night_series()` en
`fetch_libre_data.py` reutiliza las mismas lecturas que ya se descargan para
`night`/`time_in_range`. Como LibreLinkUp solo expone una ventana móvil de ~12h,
cada sincronización solo ve una parte de una noche -- por eso, igual que con la
correlación de glucosa por actividad, `extract_prev_glucose.py` extrae del
`data.json` publicado el `night_series` previo (a `data/prev_glucose_nights.json`)
y `merge_prev_glucose.py` lo fusiona franja a franja con lo que esta sincronización
sí pudo ver (la franja fresca gana donde hay dato, si no se conserva la anterior),
recortando siempre a las últimas 14 noches. `patch_glucose.py` (la sincronización
rápida de solo glucosa, que no pasa por extract/merge) hace su propia fusión
contra el `data.json` en vivo que ya está leyendo, para no perder noches
acumuladas cada vez que se usa.

## Gráfico de glucosa 24h/12h (tarjeta "Hoy")

La tarjeta "Hoy" muestra un gráfico de glucosa estilo LibreLink/Gluroo (línea
coloreada por tramo -- roja &lt;70, verde 70-180, naranja &gt;180 -- con la
banda de rango objetivo sombreada, franjas de fondo por sueño y por actividad,
selector 12h/24h, y tooltip al tocar/pasar el cursor). Es puramente visual
(`buildTodayGlucoseChart()` en `app.js`); los datos que consume vienen de tres
sitios, ninguno con llamadas nuevas a Garmin/LibreLinkUp:

- **`glucose.recent_series`**: lecturas crudas `[timestamp_ms, mg/dL]`, misma
  fuente que `night`/`time_in_range`/`night_series`. `compute_recent_series()`
  en `fetch_libre_data.py` convierte el timestamp naive-local de LibreLinkUp a
  epoch ms real via `zoneinfo` (Europe/Madrid, con DST correcto), para que el
  gráfico se posicione bien en el eje temporal pase lo que pase con la zona
  horaria del navegador de quien lo mire. Mismo patrón de persistencia que
  `night_series`: `extract_prev_glucose.py` extrae lo ya publicado
  (`data/prev_glucose_recent.json`), `merge_prev_glucose.py` lo fusiona por
  timestamp exacto (fresco gana en colisión) manteniendo un buffer de trabajo
  de 48h en `data/glucose_recent.json`, pero solo publica a `glucose.json` (y
  por tanto a `data.json`) las últimas 24h -- el gráfico nunca muestra más que
  eso, no tiene sentido pagar el peso de las 48h completas en cada carga de
  página. `patch_glucose.py` hace la misma fusión contra el `data.json` en
  vivo que ya está leyendo.
- **Sueño**: `daily[].sleep_start_ts` / `sleep_end_ts` (epoch ms UTC),
  añadidos en `fetch_garmin_data.py` a partir de
  `dailySleepDTO.sleepStart/EndTimestampGMT`, que Garmin ya devuelve dentro de
  la misma llamada que da `sleep_hours` etc. -- sin llamada extra.
- **Actividades**: `activities[].start_time`/`duration_min`/`name`/`type`, que
  ya existían.

### Registro de comidas e insulina (`diabetes_log`)

Igual que `coach_notes`/`coach_sessions`, Claude escribe directamente en la
base de datos del artifact (via `ArtifactData`, nunca tocando el repo ni la
sincronización con Garmin/LibreLinkUp) cuando Lluis le cuenta por chat que ha
comido algo o se ha puesto insulina. El gráfico de "Hoy" se suscribe en vivo
(`onSnapshot`) a los documentos de las últimas 48h y dibuja un marcador en la
hora exacta -- sin necesidad de recargar la página.

Colección `diabetes_log`, un documento por evento (`doc_id` sugerido:
`d_<ts>_<algo único>`, para evitar colisión si dos eventos caen en el mismo
milisegundo):
```
{
  ts: <epoch ms>,
  type: "meal" | "insulin" | "note" | "bg",
  carbs_g: <número>,           // solo type:"meal"
  label: "<texto corto>",      // solo type:"meal", ej. "Pasta con pollo"
  insulin_units: <número>,     // solo type:"insulin"
  insulin_type: "fiasp" | "toujeo",  // solo type:"insulin" -- toujeo es basal
                                      // y se dibuja distinto (discreto, sin 💉)
  value_mgdl: <número>,        // solo type:"bg" -- medición capilar (glucómetro)
  note: "<texto opcional>",
}
```
`type:"bg"` se dibuja distinto del resto: en vez de un carril aparte arriba o
abajo del gráfico, aparece como un rombo en su posición real del eje Y (el
valor de `value_mgdl`), coloreado por rango igual que la línea del sensor
(`glucoseLineColor()`), con etiqueta "🩸 &lt;valor&gt;" al lado. El tooltip
compara contra la lectura del sensor más cercana en el tiempo (si hay alguna
a menos de `GLUCOSE_CHART_GAP_MS`), mostrando la diferencia.
Ejemplo de escritura (desde cualquier conversación, con la URL del artifact de
arriba):
```
ArtifactData action="set" collection="diabetes_log" doc_id="d_1762784400000_a1"
  data={"ts": 1762784400000, "type": "meal", "carbs_g": 65, "label": "Pasta con pollo"}
```
El informe mensual de glucosa (ver sección siguiente) reutiliza la misma
colección con su propia consulta por rango de mes (igual que `coach_sessions`
ya hace semana vs. mes), independiente de la suscripción de 48h que usa la
tarjeta "Hoy".

## Informe mensual de glucosa

Sección plegable al final del dashboard, pensada para imprimir/guardar como
PDF y llevar al endocrino: resumen del mes (media, tiempo en rango 70-180,
%&lt;70, %&gt;180, hipoglucemias, GMI, coeficiente de variación, días con
datos/carrera/fuerza, hidratos e insulina rápida media por día) y un gráfico
de 00h-24h por día, con el mismo componente/estilo que la tarjeta "Hoy"
(`renderGlucoseChart()` en `app.js`, generalizado para servir a ambos:
`buildTodayGlucoseChart()` para "Hoy", `buildGlucoseDayChart()` para cada día
del informe).

Datos, sin llamadas nuevas a Garmin/LibreLinkUp:
- **`glucose_month.json`**: lecturas `[timestamp_ms, mg/dL]` del mes en curso
  + el anterior completo, publicado como archivo *separado* de `data.json` y
  descargado por el dashboard solo al desplegar la sección (carga diferida).
  Lo mantienen al día `merge_prev_glucose.py` (sync completo, 2x/día) y
  `patch_glucose.py` (sync de glucosa, varias veces al día) -- ambos leen
  `data/prev_glucose_month.json` (escrito por `extract_prev_glucose_month.py`,
  que lee lo que ya estaba publicado) y fusionan por timestamp exacto, igual
  que `recent_series`.
- **Sueño/actividades**: mismos campos que la tarjeta "Hoy"
  (`daily[].sleep_start_ts/sleep_end_ts`, `activities[]`).
- **Comidas/insulina**: colección `diabetes_log`, consultada por el rango de
  fechas del mes seleccionado (no las últimas 48h que usa "Hoy").

Botón "Imprimir / guardar PDF": el visor de Artifacts bloquea
`window.print()` incluso abierto en su propia pestaña, así que el botón
genera un HTML autocontenido (con `styles.css` embebido) y lo ofrece para
descargar via la capacidad `downloads` del artifact -- abierto fuera de
Claude, ese archivo sí puede imprimirse/guardarse como PDF con el diálogo
normal del navegador.

## Fuerza: ejercicios desde Hevy

El reloj no tiene bien mapeados los ejercicios de gimnasio, así que los entrenos
de fuerza se registran en la app Hevy (requiere Hevy Pro para la API) y
`hevy2garmin sync` los sube a Garmin Connect automáticamente — fusionando la FC
de alta resolución de la grabación del reloj con los ejercicios/series/reps/peso
de Hevy en una única actividad. A partir de ahí, el pipeline normal
(`fetch_garmin_data.py` → `build_combined.py`) los recoge igual que cualquier
otra actividad de fuerza, sin cambios.

**Ejercicios exactos, no los mapeados a Garmin**: hevy2garmin necesita mapear
cada ejercicio de Hevy al catálogo limitado de Garmin para poder subirlo (p.ej.
"Incline Bench Press (Dumbbell)" → `INCLINE_DUMBBELL_BENCH_PRESS`), así que lo
que queda en Garmin Connect no siempre es el nombre exacto. Para que el
dashboard sí muestre el nombre exacto, `fetch_hevy_exercises.py` descarga los
entrenos recientes directamente de la API de Hevy (`HEVY_API_KEY`, la misma
clave que usa hevy2garmin) a `data/hevy_workouts.json` -- una sola llamada,
cubre semanas de historial. `build_combined.py` cruza cada actividad de fuerza
de Garmin con su entreno de Hevy por hora de inicio (±2h) y, si encuentra uno,
usa los ejercicios/series/reps/peso de Hevy tal cual en vez de los mapeados,
conservando la FC/duración/calorías del reloj (que Hevy no tiene). Si
`HEVY_API_KEY` no está configurada, o un entreno no tiene match, se queda con
los ejercicios de Garmin como hasta ahora -- nunca bloqueante.

**Limitación conocida con Strava**: la sincronización Garmin→Strava solo
empuja la actividad en el momento en que se crea (vacía, antes de que
hevy2garmin la fusione) — Strava nunca recoge la edición posterior, así que la
versión fusionada nunca llega a Strava por esa vía. Decisión tomada: usar la
integración nativa Hevy→Strava (Ajustes → Integraciones → Strava en la app de
Hevy) para que las sesiones de fuerza lleguen a Strava con ejercicios/series
(sin la FC del reloj, que sí se queda en Garmin Connect). Esto deja un
duplicado vacío en Strava (el que vino de Garmin) que Lluis borra a mano.

## Entrenador (notas y plan desde el chat de Claude)

Lluis ya no sigue el plan de Garmin Coach; su entrenador es el chat de Claude.
El dashboard tiene dos tarjetas -- "Mensaje de tu entrenador" y "Plan de tu
entrenador" -- que leen en vivo (via la capacidad `db` del artifact, sin pasar
por `data.json` ni por ninguna rutina) dos colecciones:

- `coach_notes/<id>`: `{ text, created_at }` -- notas libres, se muestran las
  6 mas recientes.
- `coach_sessions/<date>`: `{ date, type: run|strength|bike|rest|other, title,
  duration_min, notes }` -- una sesion programada por dia. La de HOY tambien
  alimenta directamente la tarjeta "Hoy" (bloque "Sesion de hoy" y el aviso de
  Training Readiness) -- ya no existe el antiguo planificador automatico que
  proponia sesiones por disponibilidad; ahora la unica fuente de "que toca
  hoy" es lo que haya en `coach_sessions` para la fecha de hoy (o nada, si no
  se ha programado).

Para dejar algo ahi (desde cualquier conversacion de Claude Code), usar la
herramienta `ArtifactData` con `url` = la URL del artifact de arriba,
`action: "set"` y el `collection`/`doc_id`/`data` correspondientes. No hace
falta tocar el repo ni publicar nada con la herramienta Artifact -- el
dashboard ya publicado se actualiza solo en cuanto se escribe en la base de
datos.

## Rutinas en la nube

Este repo lo usan varias rutinas programadas de Claude Code para mantener el
dashboard actualizado sin depender de ningún PC local:

- **Garmin dashboard refresh** (2x/día + manual): sincronización completa
  (Garmin + Libre + ejercicios exactos de Hevy, ventana adaptativa) y publica
  `data.json` + `glucose_month.json`.
- **Glucosa - sincronizar ahora** (automática varias veces al día + manual):
  solo glucosa, rápido -- no toca Garmin ni Hevy.
- **Garmin: reintento sueño/HRV matutino** (horaria, unas horas tras la
  sincronización completa de la mañana): reintenta el sueño/VFC de hoy si
  Garmin aún no lo había subido cuando corrió la sincronización completa; no
  hace nada si ya está completo. Ajustar su cron si cambia la hora de la
  sincronización completa, para que siga corriendo después y no antes.

Ninguna de las rutinas hace commit/push al repo — solo republican el artifact.
Las credenciales (`GARMIN_EMAIL`/`GARMIN_PASSWORD`, `LIBRE_EMAIL`/`LIBRE_PASSWORD`,
`HEVY_API_KEY`) viven como variables de entorno dentro del prompt de cada rutina,
nunca en el repo.

URL del artifact: https://claude.ai/artifact/D5E5q8QLsxim5HhVcuyegX
