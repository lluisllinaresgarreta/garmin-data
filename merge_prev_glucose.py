"""
Merge previously-known per-activity glucose correlations AND the overnight
glucose curve (see extract_prev_glucose.py) into data/glucose.json, for
whatever this run's fetch_libre_data.py could NOT (re)compute because
LibreLinkUp's rolling ~12h window no longer covers it.

Without this, every full sync would silently wipe glucose_start/post_mgdl
(and the richer per-activity chart, and most of each night's curve) for
anything older than ~12h, even though it was computed correctly earlier.

Per-activity merges at FIELD level, not by replacing the whole entry:
- scalar fields (glucose_start/post_mgdl, chart start/end/post_2h): keep the
  freshly computed value when present, otherwise fall back to the cached one.
- the chart's reading series: union of cached + fresh points, deduped by
  their minute-offset from activity start, so coverage only ever grows
  across syncs instead of being clobbered by whichever run happens to have
  the narrower window.
- "partial" is recomputed from the merged series/points, so it reflects the
  best data known so far rather than just this run's view.

night_series merges at SLOT level (same idea, one array index per 15-min
slot instead of per activity-relative-minute), and is pruned to the most
recent NIGHT_SERIES_KEEP nights so the file doesn't grow without bound.

recent_series (raw [ts_ms, value] readings for the "Hoy" card's glucose
chart) merges by exact-timestamp dedup (fresh wins on an exact collision),
capped to the last RECENT_SERIES_KEEP_HOURS as a working buffer written to
data/glucose_recent.json -- but only the last RECENT_SERIES_PUBLISH_HOURS of
that buffer is written into glucose.json's own "recent_series" (what
actually reaches data.json), since the chart itself never shows more than
24h and there's no reason to ship a heavier payload than the page uses.

glucose_month.json (current calendar month + previous one, Europe/Madrid)
is the same exact-timestamp-dedup merge, but published as its OWN file
(data/glucose_month.json) instead of living inside glucose.json/data.json --
the monthly report is a separate, lazily-fetched page concern (see
extract_prev_glucose_month.py, which is what feeds this script its prior
state: that script reads the PUBLISHED glucose_month.json, since it isn't
nested inside data.json the way night_series/recent_series's own prior state
is).

Uso:
    python merge_prev_glucose.py [<prev_glucose_activities.json>]
"""
import json
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).parent
MADRID_TZ = ZoneInfo("Europe/Madrid")

CHART_PRE_MIN = 30
CHART_POST_H = 2
CHART_EDGE_TOLERANCE_MIN = 20
NIGHT_SERIES_KEEP = 14
RECENT_SERIES_KEEP_HOURS = 48
RECENT_SERIES_PUBLISH_HOURS = 24


def _prev_month_start_ms(now_ms):
    now_local = datetime.fromtimestamp(now_ms / 1000, tz=MADRID_TZ)
    first_of_this_month = now_local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last_day_prev_month = first_of_this_month - timedelta(days=1)
    prev_month_start = last_day_prev_month.replace(day=1)
    return int(prev_month_start.timestamp() * 1000)


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


def _merge_night(fresh, cached):
    """Slot-by-slot merge of one night's 15-min values: fresh wins wherever
    this run actually saw a reading for that slot, otherwise fall back to
    whatever a previous sync already had there."""
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


def _merge_series_since(fresh, cached, since_ms, now_ms):
    """Exact-timestamp dedup merge of [ts_ms, value] pairs (fresh wins on a
    collision), kept from since_ms through now_ms. Used both for the 48h
    recent_series working buffer (since_ms = now - keep_hours) and for the
    current+previous-month glucose_month.json buffer (since_ms = start of
    the previous calendar month) -- same merge, different cutoff."""
    by_ts = {p[0]: p[1] for p in (cached or [])}
    for p in (fresh or []):
        by_ts[p[0]] = p[1]  # fresh wins on an exact-timestamp collision
    return sorted([ts, v] for ts, v in by_ts.items() if since_ms <= ts <= now_ms)


def main():
    prev_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "prev_glucose_activities.json"
    prev_nights_path = ROOT / "data" / "prev_glucose_nights.json"
    prev_recent_path = ROOT / "data" / "prev_glucose_recent.json"
    prev_month_path = ROOT / "data" / "prev_glucose_month.json"
    recent_out_path = ROOT / "data" / "glucose_recent.json"
    month_out_path = ROOT / "data" / "glucose_month.json"
    glucose_path = ROOT / "data" / "glucose.json"

    if not glucose_path.exists():
        print(f"No existe {glucose_path} -- nada que fusionar.")
        return

    glucose = json.loads(glucose_path.read_text(encoding="utf-8"))

    # Per-activity correlations and the overnight curve are restored
    # regardless of whether TODAY's fetch succeeded (glucose["available"]) --
    # that flag is about the top-level summary (latest reading, night stats),
    # not about whether there's prior data worth keeping. Each block below
    # is independent: a missing prev file for one never skips the other.
    touched = 0
    if prev_path.exists():
        prev = json.loads(prev_path.read_text(encoding="utf-8"))
        activities = glucose.setdefault("activities", {})
        for act_id, prev_entry in prev.items():
            if not _has_data(prev_entry):
                continue
            before = activities.get(act_id)
            merged = _merge_entry(before, prev_entry)
            if merged != before:
                activities[act_id] = merged
                touched += 1
    else:
        print(f"No existe {prev_path} -- nada previo de actividades que conservar.")

    nights_kept = 0
    if prev_nights_path.exists():
        prev_nights = json.loads(prev_nights_path.read_text(encoding="utf-8"))
        fresh_nights = glucose.get("night_series") or {}
        all_dates = set(fresh_nights) | set(prev_nights)
        merged_nights = {d: _merge_night(fresh_nights.get(d), prev_nights.get(d)) for d in all_dates}
        kept_dates = sorted(merged_nights)[-NIGHT_SERIES_KEEP:]
        glucose["night_series"] = {d: merged_nights[d] for d in kept_dates}
        nights_kept = len(kept_dates)
    else:
        print(f"No existe {prev_nights_path} -- nada previo de noches que conservar.")
        fresh_nights = glucose.get("night_series") or {}
        kept_dates = sorted(fresh_nights)[-NIGHT_SERIES_KEEP:]
        glucose["night_series"] = {d: fresh_nights[d] for d in kept_dates}
        nights_kept = len(kept_dates)

    now_ms = int(time.time() * 1000)
    prev_recent = json.loads(prev_recent_path.read_text(encoding="utf-8")) if prev_recent_path.exists() else []
    if not prev_recent_path.exists():
        print(f"No existe {prev_recent_path} -- nada previo de lecturas recientes que conservar.")
    fresh_recent = glucose.get("recent_series") or []
    working_buffer = _merge_series_since(fresh_recent, prev_recent, now_ms - RECENT_SERIES_KEEP_HOURS * 3600_000, now_ms)
    recent_out_path.write_text(json.dumps(working_buffer, ensure_ascii=False), encoding="utf-8")
    publish_cutoff = now_ms - RECENT_SERIES_PUBLISH_HOURS * 3600_000
    glucose["recent_series"] = [p for p in working_buffer if p[0] >= publish_cutoff]

    # glucose_month.json: mismo mecanismo, pero el "fresco" de esta sincronizacion
    # es el MISMO fresh_recent de arriba (la ventana que esta corrida realmente
    # vio) y lo previo viene de extract_prev_glucose_month.py (lee el
    # glucose_month.json YA PUBLICADO, porque no vive dentro de data.json).
    prev_month = json.loads(prev_month_path.read_text(encoding="utf-8")) if prev_month_path.exists() else []
    if not prev_month_path.exists():
        print(f"No existe {prev_month_path} -- nada previo del informe mensual que conservar.")
    month_buffer = _merge_series_since(fresh_recent, prev_month, _prev_month_start_ms(now_ms), now_ms)
    month_out_path.write_text(json.dumps(month_buffer, ensure_ascii=False), encoding="utf-8")

    glucose_path.write_text(json.dumps(glucose, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Fusionadas/restauradas {touched} actividad(es) con datos previos de glucosa.")
    print(f"night_series: {nights_kept} noche(s) conservadas (maximo {NIGHT_SERIES_KEEP}).")
    print(f"recent_series: {len(working_buffer)} lectura(s) en el buffer de {RECENT_SERIES_KEEP_HOURS}h, {len(glucose['recent_series'])} publicadas (ultimas {RECENT_SERIES_PUBLISH_HOURS}h) -> {recent_out_path}")
    print(f"glucose_month: {len(month_buffer)} lectura(s) (mes en curso + mes anterior) -> {month_out_path}")


if __name__ == "__main__":
    main()
