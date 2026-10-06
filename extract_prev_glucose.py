"""
Read the currently-published data.json and pull out the per-activity glucose
correlation (glucose_start_mgdl/time, glucose_post_mgdl/time) for every
activity that already has a non-null value.

This exists because compute_activity_glucose() in fetch_libre_data.py can only
match an activity against readings inside LibreLinkUp's rolling ~12h window --
once an activity falls outside that window (the next sync, hours later), the
correlation computes to null and would otherwise silently overwrite the correct
value that was computed right after the activity happened. merge_prev_glucose.py
uses this file to restore what this run's ~12h window can no longer see.

Uso:
    python extract_prev_glucose.py <ruta-al-data.json-en-vivo> [<ruta-salida>]
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Uso: python extract_prev_glucose.py <live_data_json_path> [output_path]")
    live_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "data" / "prev_glucose_activities.json"
    out_path.parent.mkdir(exist_ok=True)

    data = json.loads(live_path.read_text(encoding="utf-8"))

    prev = {}
    for a in data.get("activities", []):
        gc = a.get("glucose_chart")
        has_chart = gc and (gc.get("series") or gc.get("start") or gc.get("end") or gc.get("post_2h"))
        if a.get("glucose_start_mgdl") is None and a.get("glucose_post_mgdl") is None and not has_chart:
            continue
        prev[str(a["activity_id"])] = {
            "glucose_start_mgdl": a.get("glucose_start_mgdl"),
            "glucose_start_time": a.get("glucose_start_time"),
            "glucose_post_mgdl": a.get("glucose_post_mgdl"),
            "glucose_post_time": a.get("glucose_post_time"),
            "glucose_chart": gc,
        }

    out_path.write_text(json.dumps(prev, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(prev)} actividad(es) con glucosa previa conservada -> {out_path}")


if __name__ == "__main__":
    main()
