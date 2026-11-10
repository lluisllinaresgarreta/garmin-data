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

night_series and recent_series ARE merged (not just forwarded) against
whatever the live data.json already has: this routine never runs
extract_prev_glucose.py/merge_prev_glucose.py (it skips the whole
Garmin-dependent part of the pipeline for speed), so without this merge every
quick glucose-only sync would wipe out all but this run's own ~12h window of
the overnight curve and the "Hoy" card's glucose chart -- hours/days of
accumulated history gone the moment someone taps "Sincronizar glucosa" to
check their level before a run.

Uso:
    python patch_glucose.py <ruta-al-data.json-en-vivo> [<ruta-salida>]
"""
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent
NIGHT_SERIES_KEEP = 14
RECENT_SERIES_PUBLISH_HOURS = 24


def _merge_night(fresh, cached):
    if not fresh and not cached:
        return None
    fresh = fresh or {}
    cached = cached or {}
    fresh_vals = fresh.get("values") or []
    cached_vals = cached.get("values") or []
    n = max(len(fresh_vals), len(cached_vals))
    values = []
    for i in range(n):
        fv = fresh_vals[i] if i < len(fresh_vals) else None
        cv = cached_vals[i] if i < len(cached_vals) else None
        values.append(fv if fv is not None else cv)
    return {
        "start": fresh.get("start") or cached.get("start"),
        "step_min": fresh.get("step_min") or cached.get("step_min"),
        "values": values,
    }


def _merge_recent(fresh, cached, now_ms, keep_hours):
    by_ts = {p[0]: p[1] for p in (cached or [])}
    for p in (fresh or []):
        by_ts[p[0]] = p[1]  # fresh wins on an exact-timestamp collision
    cutoff = now_ms - keep_hours * 3600_000
    return sorted([ts, v] for ts, v in by_ts.items() if ts >= cutoff and ts <= now_ms)


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
    live_nights = (data.get("glucose") or {}).get("night_series") or {}
    fresh_nights = glucose_raw.get("night_series") or {}
    all_dates = set(live_nights) | set(fresh_nights)
    merged_nights = {d: _merge_night(fresh_nights.get(d), live_nights.get(d)) for d in all_dates}
    kept_dates = sorted(merged_nights)[-NIGHT_SERIES_KEEP:]

    now_ms = int(time.time() * 1000)
    live_recent = (data.get("glucose") or {}).get("recent_series") or []
    fresh_recent = glucose_raw.get("recent_series") or []
    merged_recent = _merge_recent(fresh_recent, live_recent, now_ms, RECENT_SERIES_PUBLISH_HOURS)

    data["glucose"] = {k: v for k, v in glucose_raw.items() if k != "activities"}
    data["glucose"]["night_series"] = {d: merged_nights[d] for d in kept_dates}
    data["glucose"]["recent_series"] = merged_recent

    out_path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    g = data["glucose"]
    if g.get("available") and g.get("latest"):
        print(f"Glucosa parcheada: {g['latest']['value_mgdl']} mg/dL ({g['latest']['trend_label']}) a las {g['latest']['time']} -> {out_path}")
    else:
        print(f"Glucosa parcheada (sin lectura disponible: {g.get('reason')}) -> {out_path}")


if __name__ == "__main__":
    main()
