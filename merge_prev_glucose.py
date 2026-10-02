"""
Merge previously-known per-activity glucose correlations (see
extract_prev_glucose.py) into data/glucose.json's "activities" dict, for any
activity this run's fetch_libre_data.py could NOT correlate because its
start/post time has rolled outside LibreLinkUp's rolling ~12h window.

Without this, every full sync silently wipes glucose_start/post_mgdl for any
activity older than ~12h, even though it was computed correctly right after
the activity happened.

Uso:
    python merge_prev_glucose.py [<prev_glucose_activities.json>]
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent


def _has_data(entry) -> bool:
    return bool(entry) and (entry.get("glucose_start_mgdl") is not None or entry.get("glucose_post_mgdl") is not None)


def main():
    prev_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "prev_glucose_activities.json"
    glucose_path = ROOT / "data" / "glucose.json"

    if not glucose_path.exists():
        print(f"No existe {glucose_path} -- nada que fusionar.")
        return
    if not prev_path.exists():
        print(f"No existe {prev_path} -- nada previo que conservar.")
        return

    prev = json.loads(prev_path.read_text(encoding="utf-8"))
    glucose = json.loads(glucose_path.read_text(encoding="utf-8"))
    if not glucose.get("available"):
        print("glucose.json marcado como no disponible -- no se fusiona nada.")
        return

    activities = glucose.setdefault("activities", {})
    restored = 0
    for act_id, prev_entry in prev.items():
        if not _has_data(activities.get(act_id)) and _has_data(prev_entry):
            activities[act_id] = prev_entry
            restored += 1

    glucose_path.write_text(json.dumps(glucose, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Restauradas {restored} correlacion(es) de glucosa de actividades fuera de la ventana actual de ~12h.")


if __name__ == "__main__":
    main()
