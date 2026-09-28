# garmin-data

Descarga datos de Garmin Connect (Forerunner 265) y genera/republica el dashboard
"Panel Forerunner 265" (Claude Artifact).

## Uso local

```
pip install -r requirements.txt
cp .env.example .env   # rellena GARMIN_EMAIL y GARMIN_PASSWORD
python fetch_garmin_data.py --days 90
```

Genera `data/activities.csv`, `data/daily_metrics.csv`, `data/training_status.json`,
`data/race_predictions.json`, `data/body_battery.json`, `data/personal_records.json`,
`data/run_splits.json`.

## Rutina en la nube

Este repo lo usa una rutina programada de Claude Code para mantener el dashboard
actualizado sin depender de ningún PC local. La rutina necesita:

- `GARMIN_EMAIL` y `GARMIN_PASSWORD` como variables de entorno del environment de
  la rutina (nunca en el repo).
- Ejecutar `fetch_garmin_data.py --days 90`, reconstruir `data/combined.json`
  (activities.csv + daily_metrics.csv + training_status.json + race_predictions.json
  + personal_records.json + body_battery.json + run_splits.json, con las mismas
  transformaciones que en `dashboard.html`: pace en m/s -> seg/km, recovery time
  en minutos, etc.) e inyectarlo en `dashboard.html` sustituyendo la línea
  `const DATA = {...};`.
- Republicar el mismo artifact (url fija) con el Artifact tool.

URL del artifact: https://claude.ai/artifact/D5E5q8QLsxim5HhVcuyegX
