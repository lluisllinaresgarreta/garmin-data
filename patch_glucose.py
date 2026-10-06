"""
Fast glucose-only sync: patches just the `glucose` key inside the currently-live
data.json with a freshly fetched Libre reading, WITHOUT re-running the full Garmin
fetch (which is what makes the main sync slow).

Takes the currently-live data.json (as saved locally by the Artifact tool's `read`
action with path="data.json") and data/glucose.json (written by fetch_libre_data.py),
and produces a patched data.json with everything else byte-for-byte unchanged except
the `glucose` key.

Per-activity glucose_start_mgdl/glucose_post_mgdl correlation is NOT recomputed in
this fast path (it needs data/activities.csv, which this path doesn't fetch) --
only the top-level `glucose` summary (latest reading/trend, night stats, time in
range) is refreshed. A full sync will still recompute per-activity glucose as usual.

Uso:
    python patch_glucose.py <ruta-al-data.json-en-vivo> [<ruta-salida>]
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Uso: python patch_glucose.py <live_data_json_path> [output_path]")
    live_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "data.json"
    glucose_path = ROOT / "data" / "glucose.json"

    if not glucose_path.exists():
        raise SystemExit(f"No existe {glucose_path} -- ejecuta fetch_libre_data.py antes.")

    data = json.loads(live_path.read_text(encoding="utf-8"))

    glucose_raw = json.loads(glucose_path.read_text(encoding="utf-8"))
    data["glucose"] = {k: v for k, v in glucose_raw.items() if k != "activities"}

    out_path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    g = data["glucose"]
    if g.get("available") and g.get("latest"):
        print(f"Glucosa parcheada: {g['latest']['value_mgdl']} mg/dL ({g['latest']['trend_label']}) a las {g['latest']['time']} -> {out_path}")
    else:
        print(f"Glucosa parcheada (sin lectura disponible: {g.get('reason')}) -> {out_path}")


if __name__ == "__main__":
    main()
