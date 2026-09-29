"""
Descarga datos de Garmin Connect (Forerunner 265) a CSV/JSON locales en ./data
Uso:
    python fetch_garmin_data.py --days 90
"""
import argparse
import json
import os
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from garminconnect import Garmin

load_dotenv()

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)


def login() -> Garmin:
    email = os.environ["GARMIN_EMAIL"]
    password = os.environ["GARMIN_PASSWORD"]
    client = Garmin(email, password)
    client.login()
    return client


def fetch_activities(client: Garmin, days: int) -> pd.DataFrame:
    activities = client.get_activities(0, 500)
    cutoff = date.today() - timedelta(days=days)
    rows = []
    for a in activities:
        start = a.get("startTimeLocal", "")[:10]
        if start and date.fromisoformat(start) < cutoff:
            continue
        rows.append({
            "activity_id": a.get("activityId"),
            "workout_id": a.get("workoutId"),
            "date": start,
            "name": a.get("activityName"),
            "type": a.get("activityType", {}).get("typeKey"),
            "distance_km": round((a.get("distance") or 0) / 1000, 2),
            "duration_min": round((a.get("duration") or 0) / 60, 1),
            "avg_hr": a.get("averageHR"),
            "max_hr": a.get("maxHR"),
            "avg_pace_min_km": a.get("averageSpeed"),
            "calories": a.get("calories"),
            "training_effect_aerobic": a.get("aerobicTrainingEffect"),
            "training_effect_anaerobic": a.get("anaerobicTrainingEffect"),
            "vo2max": a.get("vO2MaxValue"),
        })
    return pd.DataFrame(rows)


def fetch_daily_metrics(client: Garmin, days: int) -> pd.DataFrame:
    rows = []
    for i in range(days):
        d = date.today() - timedelta(days=i)
        d_str = d.isoformat()
        try:
            sleep = client.get_sleep_data(d_str)
            hrv = client.get_hrv_data(d_str)
            steps = client.get_steps_data(d_str)
            rhr = client.get_rhr_day(d_str)
        except Exception:
            continue
        try:
            readiness = client.get_training_readiness(d_str)
        except Exception:
            readiness = None
        readiness_item = readiness[0] if isinstance(readiness, list) and readiness else (readiness or {})
        rows.append({
            "date": d_str,
            "sleep_score": (sleep or {}).get("dailySleepDTO", {}).get("sleepScores", {}).get("overall", {}).get("value"),
            "sleep_hours": round(((sleep or {}).get("dailySleepDTO", {}).get("sleepTimeSeconds") or 0) / 3600, 2),
            "hrv_avg": (hrv or {}).get("hrvSummary", {}).get("lastNightAvg") if hrv else None,
            "resting_hr": rhr.get("allMetrics", {}).get("metricsMap", {}).get("WELLNESS_RESTING_HEART_RATE", [{}])[0].get("value") if rhr else None,
            "steps": steps[0].get("totalSteps") if steps else None,
            "training_readiness": readiness_item.get("score"),
            "readiness_feedback": readiness_item.get("feedbackLong") or readiness_item.get("level"),
            "recovery_time_hours": readiness_item.get("recoveryTime"),  # NOTE: Garmin returns this in minutes, not hours

        })
    return pd.DataFrame(rows)


def fetch_training_status(client: Garmin) -> dict:
    try:
        return client.get_training_status(date.today().isoformat())
    except Exception:
        return {}


def fetch_race_predictions(client: Garmin, days: int) -> dict:
    try:
        start = (date.today() - timedelta(days=days)).isoformat()
        end = date.today().isoformat()
        return client.get_race_predictions(startdate=start, enddate=end, _type="daily")
    except Exception:
        return {}


def fetch_body_battery(client: Garmin, days: int) -> list:
    # The Body Battery report endpoint rejects wide date ranges; cap at 28 days.
    capped_days = min(days, 28)
    try:
        start = (date.today() - timedelta(days=capped_days)).isoformat()
        end = date.today().isoformat()
        return client.get_body_battery(start, end)
    except Exception:
        return []


def fetch_personal_records(client: Garmin) -> dict:
    try:
        return client.get_personal_record()
    except Exception:
        return {}


def _add_months(year: int, month: int, offset: int) -> tuple[int, int]:
    total = (year * 12 + (month - 1)) + offset
    return total // 12, total % 12 + 1


def fetch_scheduled_workouts(client: Garmin) -> list:
    """Garmin Coach calendar: previous, current and next month, deduped by id."""
    today = date.today()
    items_by_id = {}
    for offset in (-1, 0, 1):
        y, m = _add_months(today.year, today.month, offset)
        try:
            cal = client.get_scheduled_workouts(y, m)
        except Exception:
            continue
        for item in cal.get("calendarItems", []):
            if item.get("itemType") == "workout":
                items_by_id[item["id"]] = {
                    "id": item.get("id"),
                    "date": item.get("date"),
                    "title": item.get("title"),
                    "sport": item.get("sportTypeKey"),
                    "workout_id": item.get("workoutId"),
                    "atp_plan_id": item.get("atpPlanId"),
                }
    return sorted(items_by_id.values(), key=lambda x: x["date"] or "")


def fetch_run_splits(client: Garmin, activities_df: pd.DataFrame) -> dict:
    splits_by_activity = {}
    runs = activities_df[activities_df["type"] == "running"]
    for _, row in runs.iterrows():
        try:
            splits = client.get_activity_splits(str(row["activity_id"]))
        except Exception:
            continue
        splits_by_activity[str(row["activity_id"])] = {
            "date": row["date"],
            "name": row["name"],
            "splits": splits,
        }
    return splits_by_activity


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=90, help="Dias hacia atras a descargar")
    args = parser.parse_args()

    print("Conectando a Garmin Connect...")
    client = login()
    print("Login OK. Descargando actividades...")

    activities_df = fetch_activities(client, args.days)
    activities_df.to_csv(DATA_DIR / "activities.csv", index=False, encoding="utf-8")
    print(f"  -> {len(activities_df)} actividades guardadas en data/activities.csv")

    print("Descargando metricas diarias (sueno, HRV, pasos, FC reposo, training readiness)...")
    daily_df = fetch_daily_metrics(client, args.days)
    daily_df.to_csv(DATA_DIR / "daily_metrics.csv", index=False, encoding="utf-8")
    print(f"  -> {len(daily_df)} dias guardados en data/daily_metrics.csv")

    print("Descargando training status...")
    status = fetch_training_status(client)
    with open(DATA_DIR / "training_status.json", "w", encoding="utf-8") as f:
        json.dump(status, f, ensure_ascii=False, indent=2)
    print("  -> data/training_status.json")

    print("Descargando predictor de carrera...")
    race_pred = fetch_race_predictions(client, args.days)
    with open(DATA_DIR / "race_predictions.json", "w", encoding="utf-8") as f:
        json.dump(race_pred, f, ensure_ascii=False, indent=2)
    print("  -> data/race_predictions.json")

    print("Descargando Body Battery...")
    body_battery = fetch_body_battery(client, args.days)
    with open(DATA_DIR / "body_battery.json", "w", encoding="utf-8") as f:
        json.dump(body_battery, f, ensure_ascii=False, indent=2)
    print(f"  -> {len(body_battery)} dias guardados en data/body_battery.json")

    print("Descargando records personales...")
    prs = fetch_personal_records(client)
    with open(DATA_DIR / "personal_records.json", "w", encoding="utf-8") as f:
        json.dump(prs, f, ensure_ascii=False, indent=2)
    print("  -> data/personal_records.json")

    print("Descargando splits de carreras...")
    run_splits = fetch_run_splits(client, activities_df)
    with open(DATA_DIR / "run_splits.json", "w", encoding="utf-8") as f:
        json.dump(run_splits, f, ensure_ascii=False, indent=2)
    print(f"  -> {len(run_splits)} carreras con splits en data/run_splits.json")

    print("Descargando calendario de entrenos de Garmin Coach...")
    scheduled = fetch_scheduled_workouts(client)
    with open(DATA_DIR / "scheduled_workouts.json", "w", encoding="utf-8") as f:
        json.dump(scheduled, f, ensure_ascii=False, indent=2)
    print(f"  -> {len(scheduled)} entrenos planificados en data/scheduled_workouts.json")

    print("\nListo. Pasale estos archivos a Claude para el analisis/dashboard.")


if __name__ == "__main__":
    main()
