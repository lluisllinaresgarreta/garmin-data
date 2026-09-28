"""
Combina los CSV/JSON descargados por fetch_garmin_data.py en un unico
data/combined.json listo para inyectar en dashboard.html.
Uso:
    python build_combined.py
"""
import json
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).parent / "data"


def pace_sec_per_km(speed_mps):
    if pd.isna(speed_mps) or speed_mps <= 0:
        return None
    return round(1000 / speed_mps)


def main():
    act = pd.read_csv(DATA_DIR / "activities.csv")
    daily = pd.read_csv(DATA_DIR / "daily_metrics.csv")

    # avg_pace_min_km column actually holds raw speed in m/s from the Garmin API
    act["pace_sec_km"] = act["avg_pace_min_km"].apply(pace_sec_per_km)
    act_records = act.drop(columns=["avg_pace_min_km"]).fillna("").to_dict(orient="records")

    daily = daily.sort_values("date")
    daily_records = daily.fillna("").to_dict(orient="records")
    # recovery_time_hours column actually holds minutes (Garmin API quirk);
    # dashboard.html's fmtRecoveryMinutes() expects minutes and labels correctly.

    status = json.load(open(DATA_DIR / "training_status.json", encoding="utf-8"))
    vo2 = status.get("mostRecentVO2Max", {}).get("generic", {})
    load_balance = list(status.get("mostRecentTrainingLoadBalance", {}).get("metricsTrainingLoadBalanceDTOMap", {}).values())
    load_balance = load_balance[0] if load_balance else {}
    train_status = list(status.get("mostRecentTrainingStatus", {}).get("latestTrainingStatusData", {}).values())
    train_status = train_status[0] if train_status else {}

    race_raw = json.load(open(DATA_DIR / "race_predictions.json", encoding="utf-8"))
    race_history = [r for r in race_raw if r.get("time10K") is not None]

    pr_raw = json.load(open(DATA_DIR / "personal_records.json", encoding="utf-8"))
    pr_map = {r["typeId"]: r for r in pr_raw}
    personal_records = {
        "best_1k_sec": pr_map.get(1, {}).get("value"),
        "best_1k_date": pr_map.get(1, {}).get("activityStartDateTimeLocalFormatted"),
        "longest_run_m": pr_map.get(7, {}).get("value"),
        "longest_run_date": pr_map.get(7, {}).get("activityStartDateTimeLocalFormatted"),
    }

    bb_raw = json.load(open(DATA_DIR / "body_battery.json", encoding="utf-8"))
    body_battery = []
    for d in bb_raw[-14:]:
        vals = d.get("bodyBatteryValuesArray", [])
        end_level = vals[-1][1] if vals else None
        body_battery.append({
            "date": d.get("date"),
            "charged": d.get("charged"),
            "drained": d.get("drained"),
            "end_level": end_level,
        })

    splits_raw = json.load(open(DATA_DIR / "run_splits.json", encoding="utf-8"))
    run_splits = {}
    for act_id, v in splits_raw.items():
        laps = v["splits"].get("lapDTOs", [])
        active_laps = []
        for lap in laps:
            dist = lap.get("distance") or 0
            dur = lap.get("duration") or 0
            if lap.get("intensityType") != "ACTIVE" or dist < 50:
                continue
            active_laps.append({
                "distance_m": round(dist),
                "pace_sec_km": round(dur / dist * 1000) if dist else None,
                "avg_hr": lap.get("averageHR"),
            })
        run_splits[act_id] = {"date": v["date"], "name": v["name"], "active_laps": active_laps}

    out = {
        "activities": act_records,
        "daily": daily_records,
        "vo2max": vo2,
        "loadBalance": load_balance,
        "trainingStatus": train_status,
        "racePredictions": race_history,
        "personalRecords": personal_records,
        "bodyBattery": body_battery,
        "runSplits": run_splits,
    }
    with open(DATA_DIR / "combined.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"data/combined.json written ({len(json.dumps(out))} bytes)")


if __name__ == "__main__":
    main()
