"""
Combina los CSV/JSON descargados por fetch_garmin_data.py en un unico
data/combined.json listo para inyectar en dashboard.html.
Uso:
    python build_combined.py
"""
import json
from datetime import date
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).parent / "data"

MUSCLE_GROUP_MAP = {
    "BENCH_PRESS": "Pecho", "CHEST_PRESS": "Pecho", "FLY": "Pecho", "PUSH_UP": "Pecho", "DIP": "Pecho",
    "ROW": "Espalda", "PULL_UP": "Espalda", "PULLUP": "Espalda", "LAT_PULLDOWN": "Espalda", "PULLDOWN": "Espalda",
    "DEADLIFT": "Espalda",
    "SQUAT": "Piernas", "LUNGE": "Piernas", "LEG_PRESS": "Piernas", "LEG_CURL": "Piernas",
    "LEG_EXTENSION": "Piernas", "LEG_RAISE": "Piernas", "CALF_RAISE": "Piernas", "HIP_RAISE": "Piernas",
    "HIP_THRUST": "Piernas", "STEP_UP": "Piernas",
    "SHOULDER_PRESS": "Hombros", "LATERAL_RAISE": "Hombros", "FRONT_RAISE": "Hombros", "SHRUG": "Hombros",
    "CURL": "Brazos", "TRICEPS_EXTENSION": "Brazos", "TRICEP_EXTENSION": "Brazos",
    "PLANK": "Core", "CRUNCH": "Core", "SIT_UP": "Core", "CORE": "Core", "RUSSIAN_TWIST": "Core",
    "WARM_UP": "Calentamiento", "COOL_DOWN": "Enfriamiento", "CARDIO": "Cardio",
}


def muscle_group(category):
    if not category:
        return "Otro"
    cat = category.upper()
    for key, group in MUSCLE_GROUP_MAP.items():
        if key in cat:
            return group
    return "Otro"


def te_label(value):
    if value is None or value == "":
        return None
    v = float(value)
    if v < 1.0:
        return "Sin efecto"
    if v < 2.0:
        return "Mínimo"
    if v < 3.0:
        return "Mantiene"
    if v < 4.0:
        return "Mejora"
    if v < 5.0:
        return "Mejora mucho"
    return "Sobrecarga"


def pace_sec_per_km(speed_mps):
    if pd.isna(speed_mps) or speed_mps <= 0:
        return None
    return round(1000 / speed_mps)


def load_json(name, default):
    path = DATA_DIR / name
    if not path.exists():
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    act = pd.read_csv(DATA_DIR / "activities.csv")
    daily = pd.read_csv(DATA_DIR / "daily_metrics.csv")

    # avg_pace_min_km column actually holds raw speed in m/s from the Garmin API
    act["pace_sec_km"] = act["avg_pace_min_km"].apply(pace_sec_per_km)
    act["te_aerobic_label"] = act["training_effect_aerobic"].apply(te_label)
    act["te_anaerobic_label"] = act["training_effect_anaerobic"].apply(te_label)

    # HR time-in-zone per activity
    hr_zones_raw = load_json("hr_zones.json", {})
    act["hr_zones"] = act["activity_id"].apply(
        lambda aid: hr_zones_raw.get(str(aid))
    )

    act_records = act.drop(columns=["avg_pace_min_km"]).to_dict(orient="records")
    # Replace NaN with '' except for the hr_zones list column (keep None -> null, not '')
    for r in act_records:
        for k, v in list(r.items()):
            if k == "hr_zones":
                continue
            if isinstance(v, float) and pd.isna(v):
                r[k] = ""

    # Self-evaluation (feel/RPE), Coach compliance, elevation, run/walk/stand time and weather
    extras_raw = load_json("activity_extras.json", {})
    weather_raw = load_json("activity_weather.json", {})
    series_raw = load_json("activity_series.json", {})
    glucose_raw = load_json("glucose.json", {"available": False, "reason": "not_fetched"})
    glucose_by_activity = glucose_raw.get("activities", {}) if glucose_raw.get("available") else {}
    for r in act_records:
        aid = str(r["activity_id"])
        extra = extras_raw.get(aid, {})
        r["feel"] = extra.get("feel")
        r["feel_label"] = extra.get("feel_label") or ""
        r["rpe"] = extra.get("rpe")
        r["compliance_score"] = extra.get("compliance_score")
        r["elevation_gain_m"] = extra.get("elevation_gain_m")
        r["elevation_loss_m"] = extra.get("elevation_loss_m")
        r["run_sec"] = extra.get("run_sec") or 0
        r["walk_sec"] = extra.get("walk_sec") or 0
        r["stand_sec"] = extra.get("stand_sec") or 0
        r["avg_power_w"] = extra.get("avg_power_w")
        r["max_power_w"] = extra.get("max_power_w")
        r["avg_speed_kmh"] = extra.get("avg_speed_kmh")
        w = weather_raw.get(aid, {})
        r["temp_c"] = w.get("temp_c")
        r["wind_speed_kmh"] = w.get("wind_speed_kmh")
        r["wind_gust_kmh"] = w.get("wind_gust_kmh")
        r["wind_dir_deg"] = w.get("wind_dir_deg")
        r["wind_dir_compass"] = w.get("wind_dir_compass")
        series = series_raw.get(aid, {})
        r["km_splits"] = series.get("km_splits") or []
        r["hr_drift_pct"] = series.get("hr_drift_pct")
        r["z2_pace_sec_km"] = series.get("z2_pace_sec_km")
        r["avg_cadence_running"] = series.get("avg_cadence_running")
        r["avg_cadence_total"] = series.get("avg_cadence_total")
        r["active_sec"] = series.get("active_sec")
        r["rest_sec"] = series.get("rest_sec")
        r["num_sets"] = series.get("num_sets")
        r["avg_hr_during_sets"] = series.get("avg_hr_during_sets")
        r["chart"] = series.get("chart")
        r["route"] = series.get("route") or []
        g = glucose_by_activity.get(aid)
        r["glucose_start_mgdl"] = g.get("glucose_start_mgdl") if g else None
        r["glucose_start_time"] = g.get("glucose_start_time") if g else None
        r["glucose_post_mgdl"] = g.get("glucose_post_mgdl") if g else None
        r["glucose_post_time"] = g.get("glucose_post_time") if g else None
        r["post_workout_hypos"] = g.get("post_workout_hypos") if g else []
        r["glucose_chart"] = g.get("glucose_chart") if g else None

    daily = daily.sort_values("date")
    daily_records = daily.fillna("").to_dict(orient="records")

    status = load_json("training_status.json", {})
    vo2 = status.get("mostRecentVO2Max", {}).get("generic", {})
    load_balance = list(status.get("mostRecentTrainingLoadBalance", {}).get("metricsTrainingLoadBalanceDTOMap", {}).values())
    load_balance = load_balance[0] if load_balance else {}
    train_status = list(status.get("mostRecentTrainingStatus", {}).get("latestTrainingStatusData", {}).values())
    train_status = train_status[0] if train_status else {}

    race_raw = load_json("race_predictions.json", [])
    race_history = [r for r in race_raw if r.get("time10K") is not None]

    pr_raw = load_json("personal_records.json", [])
    pr_map = {r["typeId"]: r for r in pr_raw}
    personal_records = {
        "best_1k_sec": pr_map.get(1, {}).get("value"),
        "best_1k_date": pr_map.get(1, {}).get("activityStartDateTimeLocalFormatted"),
        "longest_run_m": pr_map.get(7, {}).get("value"),
        "longest_run_date": pr_map.get(7, {}).get("activityStartDateTimeLocalFormatted"),
    }

    bb_raw = load_json("body_battery.json", [])
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

    # Coach calendar: match planned workouts to completed activities by workout_id
    activities_by_workout_id = {
        int(r["workout_id"]): r for r in act_records if r.get("workout_id") not in ("", None)
    }
    scheduled_raw = load_json("scheduled_workouts.json", [])
    today_str = pd.Timestamp.today().strftime("%Y-%m-%d")
    coach_plan = []
    for w in scheduled_raw:
        wid = w.get("workout_id")
        match = activities_by_workout_id.get(int(wid)) if wid else None
        if match:
            plan_status = "done"
        elif (w.get("date") or "9999") < today_str:
            plan_status = "missed"
        else:
            plan_status = "upcoming"
        coach_plan.append({
            "date": w.get("date"),
            "title": w.get("title"),
            "sport": w.get("sport"),
            "status": plan_status,
            "activity_name": match.get("name") if match else None,
            "avg_hr": match.get("avg_hr") if match else None,
            "distance_km": match.get("distance_km") if match else None,
            "duration_min": match.get("duration_min") if match else None,
            "detail": w.get("detail") or None,
        })

    splits_raw = load_json("run_splits.json", {})
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

    # Profile: HR zones, thresholds, observed max HR
    profile_raw = load_json("profile.json", {})
    observed_max_hr = None
    max_hrs = [r["max_hr"] for r in act_records if r.get("max_hr") not in ("", None)]
    if max_hrs:
        observed_max_hr = max(max_hrs)
    profile = {
        "hrZoneBoundaries": profile_raw.get("hr_zone_boundaries"),
        "lactateThresholdHr": profile_raw.get("lactate_threshold_hr"),
        "lactateThresholdAuto": profile_raw.get("lactate_threshold_hr_auto"),
        "observedMaxHr": observed_max_hr,
        "weightKg": round(profile_raw["weight_g"] / 1000, 1) if profile_raw.get("weight_g") else None,
    }

    # Body composition (weigh-ins) — only keep points with a real weight value
    comp_raw = load_json("body_composition.json", {})
    body_composition = []
    for w in comp_raw.get("dateWeightList", []):
        if w.get("weight") is None:
            continue
        body_composition.append({
            "date": w.get("calendarDate"),
            "weight_kg": round(w["weight"] / 1000, 1),
            "body_fat_pct": w.get("bodyFat"),
            "muscle_mass_kg": round(w["muscleMass"] / 1000, 1) if w.get("muscleMass") else None,
            "bmi": w.get("bmi"),
        })
    body_composition.sort(key=lambda x: x["date"] or "")

    # Strength sessions: sets/reps/weight + volume per muscle group
    sets_raw = load_json("exercise_sets.json", {})
    strength_sessions = []
    for act_id, session in sets_raw.items():
        exercises = []
        group_volume = {}
        for s in session.get("sets", []):
            if s.get("setType") != "ACTIVE":
                continue
            exs = s.get("exercises") or []
            category = exs[0].get("category") if exs else None
            name = exs[0].get("name") if exs else None
            reps = s.get("repetitionCount")
            weight_kg = round(s["weight"] / 1000, 1) if s.get("weight") else None
            group = muscle_group(category)
            volume = (reps or 0) * (weight_kg or 0)
            if group not in ("Calentamiento", "Enfriamiento", "Cardio", "Otro") or volume > 0:
                group_volume[group] = group_volume.get(group, 0) + volume
            exercises.append({
                "category": category,
                "name": name,
                "reps": reps,
                "weight_kg": weight_kg,
                "volume_kg": round(volume, 1) if volume else None,
                "muscle_group": group,
            })
        strength_sessions.append({
            "date": session.get("date"),
            "name": session.get("name"),
            "exercises": exercises,
            "group_volume": {g: round(v, 1) for g, v in group_volume.items() if v > 0},
        })
    strength_sessions.sort(key=lambda x: x["date"] or "", reverse=True)

    # Weekly running trends: km, longest run, cadence, avg pace while in Z2 (last 12 weeks)
    run_weeks = {}
    for r in act_records:
        if r.get("type") != "running" or not r.get("date"):
            continue
        d = date.fromisoformat(r["date"])
        y, wk, _ = d.isocalendar()
        key = (y, wk)
        week_start = date.fromisocalendar(y, wk, 1).isoformat()
        bucket = run_weeks.setdefault(key, {
            "week_start": week_start, "km_total": 0.0, "longest_run_km": 0.0,
            "cadences": [], "z2_paces": [],
        })
        dist = r.get("distance_km") or 0
        bucket["km_total"] += dist
        bucket["longest_run_km"] = max(bucket["longest_run_km"], dist)
        if r.get("avg_cadence_running") not in ("", None):
            bucket["cadences"].append(r["avg_cadence_running"])
        if r.get("z2_pace_sec_km") not in ("", None):
            bucket["z2_paces"].append(r["z2_pace_sec_km"])
    run_trends = []
    for (y, wk), b in sorted(run_weeks.items()):
        run_trends.append({
            "week_start": b["week_start"],
            "km_total": round(b["km_total"], 1),
            "longest_run_km": round(b["longest_run_km"], 1),
            "avg_cadence": round(sum(b["cadences"]) / len(b["cadences"])) if b["cadences"] else None,
            "z2_pace_sec_km": round(sum(b["z2_paces"]) / len(b["z2_paces"])) if b["z2_paces"] else None,
        })
    run_trends = run_trends[-12:]

    # Per-activity detail already merged above; keep only the general summary here.
    glucose = {k: v for k, v in glucose_raw.items() if k != "activities"}

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
        "coachPlan": coach_plan,
        "profile": profile,
        "bodyComposition": body_composition,
        "strengthSessions": strength_sessions,
        "runTrends": run_trends,
        "glucose": glucose,
    }
    with open(DATA_DIR / "combined.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"data/combined.json written ({len(json.dumps(out))} bytes)")


if __name__ == "__main__":
    main()
