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
python render_dashboard.py
```

Genera `data/*.csv`/`*.json` y, al final, `data.json` en la raíz (los datos que
consume el dashboard). `dashboard.html`/`app.js`/`styles.css` son el código y el
diseño del panel — no cambian con una sincronización normal, solo `data.json`.

## Arquitectura del dashboard

El Artifact publicado tiene 4 archivos:
- `index.html` (local: `dashboard.html`) — estructura, sin datos ni estilos inline.
- `app.js` — todo el JS, envuelto en `main(DATA)`, invocado tras `fetch('data.json')`.
- `styles.css` — todo el CSS.
- `data.json` — los datos. Es el único archivo que toca una sincronización normal.

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
  solo `data.json`.
- **Glucosa - sincronizar ahora** (manual): solo glucosa, rápido.
- **Garmin: reintento sueño/HRV matutino** (horaria 7-11h): reintenta el sueño/VFC
  de hoy si Garmin aún no lo había subido cuando corrió la sincronización
  completa; no hace nada si ya está completo.
- **Hevy → Garmin sync** (horaria): sube a Garmin Connect los entrenos de fuerza
  registrados en Hevy, fusionados con la FC del reloj.

Ninguna de las rutinas hace commit/push al repo — solo republican el artifact.
Las credenciales (`GARMIN_EMAIL`/`GARMIN_PASSWORD`, `LIBRE_EMAIL`/`LIBRE_PASSWORD`,
`HEVY_API_KEY`) viven como variables de entorno dentro del prompt de cada rutina,
nunca en el repo.

URL del artifact: https://claude.ai/artifact/D5E5q8QLsxim5HhVcuyegX
