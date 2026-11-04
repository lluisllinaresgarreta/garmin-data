# garmin-data

Descarga datos de Garmin Connect (Forerunner 265) y Freestyle Libre 2, y mantiene
publicado el dashboard "Panel Forerunner 265" (Claude Artifact).

## Uso local

```
pip install -r requirements.txt
cp .env.example .env   # rellena GARMIN_EMAIL, GARMIN_PASSWORD, LIBRE_EMAIL, LIBRE_PASSWORD
python fetch_garmin_data.py --days 90
python fetch_libre_data.py
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

## Fuerza: ejercicios desde Hevy

El reloj no tiene bien mapeados los ejercicios de gimnasio, así que los entrenos
de fuerza se registran en la app Hevy (requiere Hevy Pro para la API) y
`hevy2garmin sync` los sube a Garmin Connect automáticamente — fusionando la FC
de alta resolución de la grabación del reloj con los ejercicios/series/reps/peso
de Hevy en una única actividad. A partir de ahí, el pipeline normal
(`fetch_garmin_data.py` → `build_combined.py`) los recoge igual que cualquier
otra actividad de fuerza, sin cambios.

## Rutinas en la nube

Este repo lo usan varias rutinas programadas de Claude Code para mantener el
dashboard actualizado sin depender de ningún PC local:

- **Garmin dashboard refresh** (2x/día + manual): sincronización completa
  (Garmin + Libre, ventana adaptativa) y publica solo `data.json`.
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
