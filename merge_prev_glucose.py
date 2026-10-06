"""
Merge previously-known per-activity glucose correlations (see
extract_prev_glucose.py) into data/glucose.json's "activities" dict, for
whatever this run's fetch_libre_data.py could NOT (re)compute because
LibreLinkUp's rolling ~12h window no longer covers it.

Without this, every full sync would silently wipe glucose_start/post_mgdl
(and the richer per-activity chart) for any activity older than ~12h, even
though it was computed correctly right after the activity happened.

This merges at FIELD level, not by replacing the whole activity entry:
- scalar fields (glucose_start/post_mgdl, chart start/end/post_2h): keep the
  freshly computed value when present, otherwise fall back to the cached one.
- the chart's reading series: union of cached + fresh points, deduped by
  their minute-offset from activity start, so coverage only ever grows
  across syncs instead of being clobbered by whichever run happens to have
  the narrower window.
- "partial" is recomputed from the merged series/points, so it reflects the
  best data known so far rather than just this run's view.

Uso:
    python merge_prev_glucose.py [<prev_glucose_activities.json>]
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent

CHART_PRE_MIN = 30
CHART_POST_H = 2
CHART_EDGE_TOLERANCE_MIN = 20


def _has_data(entry) -> bool:
    if not entry:
        return False
    if entry.get("glucose_start_mgdl") is not None or entry.get("glucose_post_mgdl") is not None:
        return True
    gc = entry.get("glucose_chart")
    return bool(gc and (gc.get("series") or gc.get("start") or gc.get("end") or gc.get("post_2h")))


def _series_partial(series, duration_min, tolerance_min=CHART_EDGE_TOLERANCE_MIN):
    if not series:
        return True
    expected_start = -CHART_PRE_MIN
    expected_end = (duration_min or 0) + CHART_POST_H * 60
    ts = [p["t"] for p in series]
    return (min(ts) > expected_start + tolerance_min) or (max(ts) < expected_end - tolerance_min)


def _merge_chart(fresh_gc, cached_gc):
    if not fresh_gc and not cached_gc:
        return None
    fresh_gc = fresh_gc or {}
    cached_gc = cached_gc or {}

    merged_series_by_t = {p["t"]: p for p in (cached_gc.get("series") or [])}
    for p in fresh_gc.get("series") or []:
        merged_series_by_t[p["t"]] = p  # fresh wins on exact-same-offset conflicts
    series = sorted(merged_series_by_t.values(), key=lambda p: p["t"])

    duration_min = fresh_gc.get("duration_min", cached_gc.get("duration_min"))
    return {
        "start": fresh_gc.get("start") or cached_gc.get("start"),
        "end": fresh_gc.get("end") or cached_gc.get("end"),
        "post_2h": fresh_gc.get("post_2h") or cached_gc.get("post_2h"),
        "series": series,
        "duration_min": duration_min,
        "partial": _series_partial(series, duration_min),
    }


def _merge_entry(fresh, cached):
    fresh = fresh or {}
    cached = cached or {}
    return {
        "glucose_start_mgdl": fresh.get("glucose_start_mgdl") if fresh.get("glucose_start_mgdl") is not None else cached.get("glucose_start_mgdl"),
        "glucose_start_time": fresh.get("glucose_start_time") if fresh.get("glucose_start_time") is not None else cached.get("glucose_start_time"),
        "glucose_post_mgdl": fresh.get("glucose_post_mgdl") if fresh.get("glucose_post_mgdl") is not None else cached.get("glucose_post_mgdl"),
        "glucose_post_time": fresh.get("glucose_post_time") if fresh.get("glucose_post_time") is not None else cached.get("glucose_post_time"),
        "glucose_chart": _merge_chart(fresh.get("glucose_chart"), cached.get("glucose_chart")),
    }


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
    touched = 0
    for act_id, prev_entry in prev.items():
        if not _has_data(prev_entry):
            continue
        before = activities.get(act_id)
        merged = _merge_entry(before, prev_entry)
        if merged != before:
            activities[act_id] = merged
            touched += 1

    glucose_path.write_text(json.dumps(glucose, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Fusionadas/restauradas {touched} actividad(es) con datos previos de glucosa.")


if __name__ == "__main__":
    main()
