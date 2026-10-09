"""
Fast "today only" re-check for sleep/HRV: patches just today's entry in the
`daily` array of the currently-live data.json with freshly fetched Garmin
data, WITHOUT re-running the full 90-day fetch (data/ is gitignored, so a
routine's fresh checkout has none of the CSV/JSON caches build_combined.py
would otherwise need -- patching the live data.json directly sidesteps that).

Exists because Garmin Connect can take a few hours after waking to finish
uploading the watch's overnight sync, so the main 7:00 sync sometimes
publishes today's row with sleep_hours=0 and hrv_avg empty. A routine can
call this hourly through the morning; once today's row is complete, the next
call sees that in the live data.json and exits without touching Garmin.

Takes the currently-live data.json (as saved locally by the Artifact tool's
`read` action with path="data.json"). Prints whether today's row is now
complete, so the calling routine knows whether publishing is needed.

Uso:
    python patch_daily_today.py <ruta-al-data.json-en-vivo> [<ruta-salida>]
"""
import json
import sys
from datetime import date, datetime
from pathlib import Path

from fetch_garmin_data import fetch_daily_metrics, login

ROOT = Path(__file__).parent


def is_complete(row: dict) -> bool:
    sleep_hours = row.get("sleep_hours")
    hrv_avg = row.get("hrv_avg")
    try:
        sleep_ok = sleep_hours is not None and sleep_hours != "" and float(sleep_hours) > 0
    except (TypeError, ValueError):
        sleep_ok = False
    hrv_ok = hrv_avg is not None and hrv_avg != ""
    return sleep_ok and hrv_ok


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Uso: python patch_daily_today.py <live_data_json_path> [output_path]")
    live_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "data.json"

    data = json.loads(live_path.read_text(encoding="utf-8"))
    today_str = date.today().isoformat()

    existing_today = next((r for r in data.get("daily", []) if r.get("date") == today_str), None)
    if existing_today and is_complete(existing_today):
        print(f"NOCHANGE {today_str} ya esta completo en el data.json publicado (sleep_hours={existing_today.get('sleep_hours')}, hrv_avg={existing_today.get('hrv_avg')}) -- nada que hacer.")
        return

    print("Conectando a Garmin Connect...")
    client = login()
    print("Login OK. Descargando metricas diarias de hoy...")
    fresh_df = fetch_daily_metrics(client, 1)
    if fresh_df.empty:
        print("NOCHANGE Garmin no devolvio fila para hoy todavia.")
        return
    fresh_row = fresh_df.iloc[0].fillna("").to_dict()

    daily = [r for r in data.get("daily", []) if r.get("date") != today_str]
    daily.append(fresh_row)
    daily.sort(key=lambda r: r.get("date") or "")
    data["daily"] = daily
    data["generatedAt"] = datetime.now().astimezone().isoformat()

    out_path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    if is_complete(fresh_row):
        print(f"UPDATED {today_str} actualizado y YA COMPLETO: sleep_hours={fresh_row.get('sleep_hours')}, hrv_avg={fresh_row.get('hrv_avg')} -> {out_path}")
    else:
        print(f"UPDATED {today_str} actualizado pero TODAVIA incompleto: sleep_hours={fresh_row.get('sleep_hours')}, hrv_avg={fresh_row.get('hrv_avg')} -> {out_path}")


if __name__ == "__main__":
    main()
