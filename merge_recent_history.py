"""
Merges the just-built data/combined.json (built from a narrow, adaptive fetch
window -- see compute_sync_days.py) with the full history already in the
live-published data.json, so a fast incremental sync never drops activities
or daily rows that fell outside this run's fetch window.

Only `activities` and `daily` are merged (unioned by activity_id / date, with
the fresh fetch winning on any id/date that exists in both) -- every other
top-level field (trainingStatus, loadBalance, bodyBattery, coachPlan,
profile, racePredictions, personalRecords, runSplits, bodyComposition,
runTrends, glucose, vo2max, generatedAt) is a current-snapshot value from
Garmin, not a historical series accumulated over time, so the fresh fetch's
value always replaces it outright. runSplits in particular is only ever used
for the single most recent reference/build run, which is always inside any
reasonable fetch window, so it needs no merging.

is_pr is recomputed across the FULL merged activity list, not just this run's
narrow window: a narrow window has no memory of the true historical best set
for an exercise, so trusting build_combined.py's own narrow-window is_pr
could wrongly flag a tied-or-lower set as a new record the moment the real
best falls outside the window. Keep this comparison logic identical to
build_combined.py's.

Uso:
    python merge_recent_history.py <live_data_json_path> [<fresh_combined_json>] [<output_path>]
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent


def recompute_is_pr(activities):
    strength_records = sorted(
        (a for a in activities if a.get("exercises")),
        key=lambda a: a.get("date") or "",
    )
    best_set_so_far = {}
    for a in strength_records:
        for ex in a["exercises"]:
            bs = ex.get("best_set")
            if not bs or bs.get("weight_kg") is None:
                ex["is_pr"] = False
                continue
            weight, reps = bs["weight_kg"], bs.get("reps") or 0
            prev = best_set_so_far.get(ex["name"])
            is_record = prev is None or weight > prev[0] or (weight == prev[0] and reps > prev[1])
            ex["is_pr"] = is_record
            if is_record:
                best_set_so_far[ex["name"]] = (weight, reps)


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Uso: python merge_recent_history.py <live_data_json_path> [fresh_combined_json] [output_path]")
    live_path = Path(sys.argv[1])
    fresh_path = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "data" / "combined.json"
    out_path = Path(sys.argv[3]) if len(sys.argv) > 3 else ROOT / "data.json"

    live = json.loads(live_path.read_text(encoding="utf-8"))
    fresh = json.loads(fresh_path.read_text(encoding="utf-8"))

    live_activities = {str(a["activity_id"]): a for a in live.get("activities", [])}
    fresh_activities = {str(a["activity_id"]): a for a in fresh.get("activities", [])}
    merged_activities_map = {**live_activities, **fresh_activities}
    merged_activities = sorted(
        merged_activities_map.values(),
        key=lambda a: (a.get("date") or "", a.get("start_time") or ""),
        reverse=True,
    )

    live_daily = {d["date"]: d for d in live.get("daily", []) if d.get("date")}
    fresh_daily = {d["date"]: d for d in fresh.get("daily", []) if d.get("date")}
    merged_daily_map = {**live_daily, **fresh_daily}
    merged_daily = sorted(merged_daily_map.values(), key=lambda d: d.get("date") or "")

    recompute_is_pr(merged_activities)

    out = dict(fresh)
    out["activities"] = merged_activities
    out["daily"] = merged_daily

    out_path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    kept = len(merged_activities) - len(fresh_activities)
    print(f"Fusionado: {len(merged_activities)} actividades ({len(fresh_activities)} de esta sincronizacion, {kept} conservadas del historial), {len(merged_daily)} dias de daily -> {out_path}")


if __name__ == "__main__":
    main()
