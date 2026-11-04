"""
Prints how many days back a fast sync should ask Garmin for: days since the
most recent date already in the live-published data.json's `daily` array,
plus a small safety margin (Garmin occasionally recomputes something a day
or two late), clamped to a sane floor/ceiling.

Used by the main sync so it only re-fetches what's actually new instead of
always re-downloading the full 90-day history -- merge_recent_history.py
then folds that fresh slice back into the rest of the already-published
history, so nothing older ever gets dropped.

Uso:
    python compute_sync_days.py <live_data_json_path>
"""
import json
import sys
from datetime import date
from pathlib import Path

MARGIN_DAYS = 3
MIN_DAYS = 5
MAX_DAYS = 90


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Uso: python compute_sync_days.py <live_data_json_path>")
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    dates = [d["date"] for d in (data.get("daily") or []) if d.get("date")]
    if not dates:
        print(MAX_DAYS)
        return
    last_date = date.fromisoformat(max(dates))
    gap_days = (date.today() - last_date).days
    days = max(MIN_DAYS, min(MAX_DAYS, gap_days + MARGIN_DAYS))
    print(days)


if __name__ == "__main__":
    main()
