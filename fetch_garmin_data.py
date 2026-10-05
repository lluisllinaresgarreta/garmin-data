"""
Descarga datos de Garmin Connect (Forerunner 265) a CSV/JSON locales en ./data
Uso:
    python fetch_garmin_data.py --days 90
"""
import argparse
import json
import os
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd
import requests
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
            "start_time": a.get("startTimeLocal"),
            "start_time_gmt": a.get("startTimeGMT"),
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
            "training_load": a.get("activityTrainingLoad"),
            "vo2max": a.get("vO2MaxValue"),
            "cadence_spm": a.get("averageRunningCadenceInStepsPerMinute"),
            "stride_length_cm": a.get("avgStrideLength"),
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
            steps_raw = client.get_steps_data(d_str)
            rhr = client.get_rhr_day(d_str)
        except Exception:
            continue
        try:
            readiness = client.get_training_readiness(d_str)
        except Exception:
            readiness = None
        try:
            stress = client.get_stress_data(d_str)
        except Exception:
            stress = None
        readiness_item = readiness[0] if isinstance(readiness, list) and readiness else (readiness or {})
        daily_sleep = (sleep or {}).get("dailySleepDTO", {}) or {}
        hrv_summary = (hrv or {}).get("hrvSummary", {}) or {}
        total_steps = sum(b.get("steps") or 0 for b in steps_raw) if steps_raw else None
        rows.append({
            "date": d_str,
            "sleep_score": daily_sleep.get("sleepScores", {}).get("overall", {}).get("value"),
            "sleep_hours": round((daily_sleep.get("sleepTimeSeconds") or 0) / 3600, 2),
            "sleep_deep_min": round((daily_sleep.get("deepSleepSeconds") or 0) / 60),
            "sleep_light_min": round((daily_sleep.get("lightSleepSeconds") or 0) / 60),
            "sleep_rem_min": round((daily_sleep.get("remSleepSeconds") or 0) / 60),
            "sleep_awake_min": round((daily_sleep.get("awakeSleepSeconds") or 0) / 60),
            "hrv_avg": hrv_summary.get("lastNightAvg"),
            "hrv_weekly_avg": hrv_summary.get("weeklyAvg"),
            "hrv_baseline": hrv_summary.get("baseline"),
            "hrv_status": hrv_summary.get("status"),
            "resting_hr": rhr.get("allMetrics", {}).get("metricsMap", {}).get("WELLNESS_RESTING_HEART_RATE", [{}])[0].get("value") if rhr else None,
            "steps": total_steps,
            "training_readiness": readiness_item.get("score"),
            "readiness_feedback": readiness_item.get("feedbackLong") or readiness_item.get("level"),
            "recovery_time_minutes": readiness_item.get("recoveryTime"),
            "avg_stress": (stress or {}).get("avgStressLevel"),
            "max_stress": (stress or {}).get("maxStressLevel"),
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


def fetch_body_composition(client: Garmin, days: int) -> dict:
    try:
        start = (date.today() - timedelta(days=days)).isoformat()
        end = date.today().isoformat()
        return client.get_body_composition(start, end)
    except Exception:
        return {}


def fetch_profile(client: Garmin, sample_activity_id=None) -> dict:
    """HR zone boundaries, lactate/VO2max reference points, observed max HR."""
    out = {}
    try:
        p = client.get_user_profile()
        ud = p.get("userData", {}) or {}
        out["lactate_threshold_hr"] = ud.get("lactateThresholdHeartRate")
        out["lactate_threshold_hr_auto"] = ud.get("thresholdHeartRateAutoDetected")
        out["vo2max_running"] = ud.get("vo2MaxRunning")
        out["weight_g"] = ud.get("weight")
    except Exception:
        pass
    if sample_activity_id:
        try:
            zones = client.get_activity_hr_in_timezones(str(sample_activity_id))
            out["hr_zone_boundaries"] = [
                {"zone": z.get("zoneNumber"), "low": z.get("zoneLowBoundary")} for z in zones
            ]
        except Exception:
            pass
    return out


def _add_months(year: int, month: int, offset: int) -> tuple[int, int]:
    total = (year * 12 + (month - 1)) + offset
    return total // 12, total % 12 + 1


def _step_summary(step: dict) -> dict:
    """Summarize one workout step. Garmin represents a block of repetitions (e.g.
    8 x stride) as a RepeatGroupDTO with numberOfIterations and its own nested
    workoutSteps list -- recurse into those instead of flattening them away."""
    dto_type = step.get("type")
    step_type_key = (step.get("stepType") or {}).get("stepTypeKey")
    if dto_type == "RepeatGroupDTO" or step_type_key == "repeat":
        children = [_step_summary(s) for s in (step.get("workoutSteps") or [])]
        return {
            "type": "repeat",
            "iterations": step.get("numberOfIterations"),
            "steps": children,
        }
    end_cond = (step.get("endCondition") or {}).get("conditionTypeKey")
    target_key = (step.get("targetType") or {}).get("workoutTargetTypeKey")
    return {
        "type": step_type_key,
        "description": step.get("description"),
        "end_condition": end_cond,
        "end_value": step.get("endConditionValue"),
        "target_type": target_key if target_key and target_key != "no.target" else None,
        "target_low": step.get("targetValueOne"),
        "target_high": step.get("targetValueTwo"),
        "target_unit": step.get("targetValueUnit"),
        "zone_number": step.get("zoneNumber"),
    }


def fetch_workout_detail(client: Garmin, workout_id) -> dict:
    try:
        w = client.get_workout_by_id(workout_id)
    except Exception:
        return {}
    steps = []
    for seg in w.get("workoutSegments", []):
        for step in seg.get("workoutSteps", []):
            steps.append(_step_summary(step))
    return {
        "description": w.get("description"),
        "estimated_duration_sec": w.get("estimatedDurationInSecs"),
        "estimated_distance_m": w.get("estimatedDistanceInMeters"),
        "steps": steps,
    }


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
    items = sorted(items_by_id.values(), key=lambda x: x["date"] or "")
    for item in items:
        if item.get("workout_id"):
            item["detail"] = fetch_workout_detail(client, item["workout_id"])
    return items


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


def fetch_hr_zones(client: Garmin, activities_df: pd.DataFrame) -> dict:
    """Time-in-zone (seconds) per activity, for activities that recorded HR."""
    zones_by_activity = {}
    with_hr = activities_df[activities_df["avg_hr"].notna()]
    for _, row in with_hr.iterrows():
        try:
            zones = client.get_activity_hr_in_timezones(str(row["activity_id"]))
        except Exception:
            continue
        zones_by_activity[str(row["activity_id"])] = [
            {"zone": z.get("zoneNumber"), "secs": z.get("secsInZone"), "low": z.get("zoneLowBoundary")}
            for z in zones
        ]
    return zones_by_activity


def fetch_exercise_sets(client: Garmin, activities_df: pd.DataFrame) -> dict:
    """Sets/reps/weight per strength_training activity."""
    sets_by_activity = {}
    strength = activities_df[activities_df["type"] == "strength_training"]
    for _, row in strength.iterrows():
        try:
            data = client.get_activity_exercise_sets(str(row["activity_id"]))
        except Exception:
            continue
        sets_by_activity[str(row["activity_id"])] = {
            "date": row["date"],
            "name": row["name"],
            "sets": data.get("exerciseSets", []),
        }
    return sets_by_activity


FEEL_MAP = {0: "Muy mal", 25: "Mal", 50: "Normal", 75: "Bien", 100: "Muy bien"}
RUN_WALK_SPLIT_TYPES = {"RWD_RUN": "run_sec", "RWD_WALK": "walk_sec", "RWD_STAND": "stand_sec"}


def fetch_activity_extras(client: Garmin, activities_df: pd.DataFrame) -> dict:
    """Self-evaluation (feel/RPE), Coach compliance, elevation and run/walk/stand
    time breakdown per activity — one get_activity() call each."""
    extras = {}
    for _, row in activities_df.iterrows():
        activity_id = str(row["activity_id"])
        try:
            full = client.get_activity(activity_id)
        except Exception:
            continue
        summary = full.get("summaryDTO", {}) or {}
        run_sec = walk_sec = stand_sec = 0.0
        for split in full.get("splitSummaries", []) or []:
            key = RUN_WALK_SPLIT_TYPES.get(split.get("splitType"))
            if key:
                if key == "run_sec":
                    run_sec += split.get("duration") or 0.0
                elif key == "walk_sec":
                    walk_sec += split.get("duration") or 0.0
                else:
                    stand_sec += split.get("duration") or 0.0
        feel = summary.get("directWorkoutFeel")
        rpe = summary.get("directWorkoutRpe")
        extras[activity_id] = {
            "feel": feel,
            "feel_label": FEEL_MAP.get(feel, ""),
            "rpe": (rpe / 10) if rpe is not None else None,
            "compliance_score": summary.get("directWorkoutComplianceScore"),
            "elevation_gain_m": summary.get("elevationGain"),
            "elevation_loss_m": summary.get("elevationLoss"),
            "run_sec": run_sec,
            "walk_sec": walk_sec,
            "stand_sec": stand_sec,
            "avg_power_w": summary.get("averagePower"),
            "max_power_w": summary.get("maxPower"),
            "avg_speed_kmh": round(summary["averageSpeed"] * 3.6, 1) if summary.get("averageSpeed") else None,
        }
    return extras


MPH_TO_KMH = 1.60934

# Garmin's weather call only gives ONE wind reading per activity (a snapshot near
# the start, from the nearest station) -- fine for a short run where wind barely
# changes, but misleading for anything long enough to plausibly see the wind shift.
# For activities over this threshold, also pull hourly wind from Open-Meteo's
# forecast API (which keeps recent past days at low latency, unlike its ERA5-based
# archive API) so the dashboard can show how it varied, alongside Garmin's own figure
# for comparison. This is a bonus lookup: any failure just means wind_hourly stays
# empty, never blocks the sync.
LONG_ACTIVITY_WIND_MIN = 60
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


def fetch_hourly_wind(lat, lon, start_dt, end_dt):
    """Hourly wind speed/gust/direction from Open-Meteo covering [start_dt, end_dt]
    (UTC). Returns [] on any error or if the window isn't covered by the response."""
    try:
        resp = requests.get(OPEN_METEO_URL, params={
            "latitude": lat, "longitude": lon,
            "hourly": "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
            "wind_speed_unit": "kmh", "timezone": "UTC", "past_days": 7,
        }, timeout=10)
        resp.raise_for_status()
        hourly = resp.json().get("hourly", {})
        times = hourly.get("time") or []
        speeds = hourly.get("wind_speed_10m") or []
        dirs = hourly.get("wind_direction_10m") or []
        gusts = hourly.get("wind_gusts_10m") or []
        out = []
        for i, t in enumerate(times):
            try:
                ts = datetime.strptime(t, "%Y-%m-%dT%H:%M")
            except ValueError:
                continue
            if start_dt - timedelta(hours=1) <= ts <= end_dt:
                out.append({
                    "hour": ts.strftime("%H:%M"),
                    "wind_speed_kmh": round(speeds[i], 1) if i < len(speeds) and speeds[i] is not None else None,
                    "wind_dir_deg": dirs[i] if i < len(dirs) else None,
                    "wind_gust_kmh": round(gusts[i], 1) if i < len(gusts) and gusts[i] is not None else None,
                })
        return out
    except Exception:
        return []


def fetch_activity_weather(client: Garmin, activities_df: pd.DataFrame) -> dict:
    """Temperature and wind (speed, gust, direction) per activity, where Garmin has
    weather data (outdoor only). windDirection is the meteorological "from" bearing
    in degrees (0=N, 90=E, ...), matching the raw Garmin Connect weather response."""
    weather = {}
    for _, row in activities_df.iterrows():
        activity_id = str(row["activity_id"])
        try:
            w = client.get_activity_weather(activity_id)
        except Exception:
            continue
        if not w:
            continue
        entry = {}
        temp_f = w.get("temp")
        if temp_f is not None:
            entry["temp_c"] = round((temp_f - 32) * 5 / 9, 1)
        wind_speed_mph = w.get("windSpeed")
        if wind_speed_mph is not None:
            entry["wind_speed_kmh"] = round(wind_speed_mph * MPH_TO_KMH, 1)
        wind_gust_mph = w.get("windGust")
        if wind_gust_mph is not None:
            entry["wind_gust_kmh"] = round(wind_gust_mph * MPH_TO_KMH, 1)
        wind_dir_deg = w.get("windDirection")
        if wind_dir_deg is not None:
            entry["wind_dir_deg"] = wind_dir_deg
        wind_compass = w.get("windDirectionCompassPoint")
        if wind_compass:
            entry["wind_dir_compass"] = wind_compass.upper()

        duration_min = row.get("duration_min")
        lat, lon = w.get("latitude"), w.get("longitude")
        if duration_min and duration_min > LONG_ACTIVITY_WIND_MIN and lat is not None and lon is not None:
            start_raw = row.get("start_time_gmt")
            if start_raw:
                try:
                    start_dt = datetime.strptime(str(start_raw)[:19], "%Y-%m-%d %H:%M:%S")
                    end_dt = start_dt + timedelta(minutes=float(duration_min))
                    hourly = fetch_hourly_wind(lat, lon, start_dt, end_dt)
                    if hourly:
                        entry["wind_hourly"] = hourly
                except ValueError:
                    pass

        if entry:
            weather[activity_id] = entry
    return weather


# The watch's raw time-series directRunCadence is steps of ONE leg per minute (~55-80
# for real running); double it to get total steps/min, matching every other cadence
# figure in the dashboard (e.g. Garmin's own averageRunningCadenceInStepsPerMinute).
CADENCE_DOUBLE = 2
# Below this (already-doubled) cadence, treat the sample as walking/stopped rather than running.
RUN_CADENCE_THRESHOLD = 130


def _downsample(seq, target):
    """Evenly-spaced decimation to at most `target` points, keeping first and last."""
    if len(seq) <= target:
        return seq
    step = (len(seq) - 1) / (target - 1)
    return [seq[round(i * step)] for i in range(target)]


def fetch_activity_series(client: Garmin, activities_df: pd.DataFrame, exercise_sets_by_id: dict,
                           zone2_low, zone2_high, cap: int = 10) -> dict:
    """Per-activity detail used by the expandable activity card: downsampled HR/pace/
    cadence/elevation chart series, a downsampled GPS route, running km-splits/HR-drift/
    Z2-pace/cadence (as before), and for strength sessions, active-vs-rest time and the
    average HR during working sets (cross-referenced against exercise_sets' set windows).
    Limited to the most recent `cap` activities of any type to bound API calls and
    payload size -- older activities simply have no expandable detail."""
    result = {}
    recent = activities_df.sort_values("date", ascending=False).head(cap)
    for _, row in recent.iterrows():
        activity_id = str(row["activity_id"])
        activity_type = row.get("type")
        try:
            details = client.get_activity_details(activity_id)
        except Exception:
            continue
        descriptors = {d["key"]: d["metricsIndex"] for d in details.get("metricDescriptors", [])}
        points = details.get("activityDetailMetrics", [])
        i_t = descriptors.get("sumElapsedDuration")
        i_dist = descriptors.get("sumDistance")
        i_hr = descriptors.get("directHeartRate")
        i_cad = descriptors.get("directRunCadence")
        i_speed = descriptors.get("directSpeed")
        i_elev = descriptors.get("directElevation")
        i_lat = descriptors.get("directLatitude")
        i_lon = descriptors.get("directLongitude")
        if i_t is None or not points:
            continue

        samples = []
        for p in points:
            m = p.get("metrics", [])
            if i_t >= len(m):
                continue
            t = m[i_t]
            if t is None:
                continue
            cad_raw = m[i_cad] if i_cad is not None and i_cad < len(m) else None
            samples.append({
                "t": t,
                "dist": m[i_dist] if i_dist is not None and i_dist < len(m) else None,
                "hr": m[i_hr] if i_hr is not None and i_hr < len(m) else None,
                "cad": (cad_raw * CADENCE_DOUBLE) if cad_raw is not None else None,
                "speed": m[i_speed] if i_speed is not None and i_speed < len(m) else None,
                "elev": m[i_elev] if i_elev is not None and i_elev < len(m) else None,
                "lat": m[i_lat] if i_lat is not None and i_lat < len(m) else None,
                "lon": m[i_lon] if i_lon is not None and i_lon < len(m) else None,
            })
        if len(samples) < 2:
            continue

        entry = {}

        # ---- Running-only: km splits, HR drift, Z2 pace, cadence (unchanged logic) ----
        if activity_type == "running" and i_dist is not None:
            km_splits = []
            bucket_start_t = samples[0]["t"]; bucket_start_dist = samples[0]["dist"] or 0
            next_km = 1000.0
            hrs, cads, elevs = [], [], []
            all_cadences, running_cadences = [], []
            for s in samples:
                if s["hr"] is not None:
                    hrs.append(s["hr"])
                if s["cad"] is not None:
                    cads.append(s["cad"]); all_cadences.append(s["cad"])
                    if s["cad"] >= RUN_CADENCE_THRESHOLD:
                        running_cadences.append(s["cad"])
                if s["elev"] is not None:
                    elevs.append(s["elev"])
                dist = s["dist"]
                if dist is not None and dist >= next_km:
                    seg_dist = dist - bucket_start_dist
                    seg_t = s["t"] - bucket_start_t
                    if seg_dist > 0 and seg_t > 0:
                        km_splits.append({
                            "km": len(km_splits) + 1,
                            "pace_sec_km": round(seg_t / (seg_dist / 1000.0)),
                            "avg_hr": round(sum(hrs) / len(hrs)) if hrs else None,
                            "avg_cadence": round(sum(cads) / len(cads)) if cads else None,
                            "elev_net_m": round(elevs[-1] - elevs[0], 1) if len(elevs) >= 2 else None,
                            "partial": False,
                        })
                    bucket_start_t, bucket_start_dist = s["t"], dist
                    hrs, cads, elevs = [], [], []
                    next_km += 1000.0
            last_dist = samples[-1]["dist"] or 0
            seg_dist = last_dist - bucket_start_dist
            seg_t = samples[-1]["t"] - bucket_start_t
            if seg_dist > 100 and seg_t > 0:
                km_splits.append({
                    "km": len(km_splits) + 1,
                    "pace_sec_km": round(seg_t / (seg_dist / 1000.0)),
                    "avg_hr": round(sum(hrs) / len(hrs)) if hrs else None,
                    "avg_cadence": round(sum(cads) / len(cads)) if cads else None,
                    "elev_net_m": round(elevs[-1] - elevs[0], 1) if len(elevs) >= 2 else None,
                    "partial": True,
                    "distance_m": round(seg_dist),
                })

            hr_drift_pct = None
            total_t = samples[-1]["t"] - samples[0]["t"]
            if total_t > 0:
                mid_t = samples[0]["t"] + total_t / 2
                first_half = [s["hr"] for s in samples if s["hr"] is not None and s["t"] <= mid_t]
                second_half = [s["hr"] for s in samples if s["hr"] is not None and s["t"] > mid_t]
                if first_half and second_half:
                    avg1 = sum(first_half) / len(first_half)
                    avg2 = sum(second_half) / len(second_half)
                    if avg1 > 0:
                        hr_drift_pct = round((avg2 - avg1) / avg1 * 100, 1)

            z2_dist = z2_time = 0.0
            for a, b in zip(samples, samples[1:]):
                if a["hr"] is None or b["hr"] is None or a["dist"] is None or b["dist"] is None:
                    continue
                avg_hr = (a["hr"] + b["hr"]) / 2
                if zone2_low <= avg_hr < zone2_high:
                    z2_dist += max(0.0, b["dist"] - a["dist"])
                    z2_time += max(0.0, b["t"] - a["t"])
            z2_pace_sec_km = round(z2_time / (z2_dist / 1000.0)) if z2_dist > 0 else None

            entry.update({
                "km_splits": km_splits,
                "hr_drift_pct": hr_drift_pct,
                "z2_pace_sec_km": z2_pace_sec_km,
                "avg_cadence_running": round(sum(running_cadences) / len(running_cadences)) if running_cadences else None,
                "avg_cadence_total": round(sum(all_cadences) / len(all_cadences)) if all_cadences else None,
            })

        # ---- Strength-only: active/rest time, set count, HR during working sets ----
        if activity_type == "strength_training":
            sets = (exercise_sets_by_id.get(activity_id) or {}).get("sets", [])
            active_sec = sum(s.get("duration") or 0 for s in sets if s.get("setType") == "ACTIVE")
            rest_sec = sum(s.get("duration") or 0 for s in sets if s.get("setType") == "REST")
            num_sets = sum(1 for s in sets if s.get("setType") == "ACTIVE")
            # exercise_sets' startTime is in GMT/UTC, like Garmin's startTimeGMT -- NOT
            # startTimeLocal, which runs 1-2h off depending on DST and silently throws
            # every set/sample match off by that much.
            start_time_raw = row.get("start_time_gmt")
            set_hrs = []
            if start_time_raw:
                try:
                    activity_start = datetime.strptime(str(start_time_raw)[:19], "%Y-%m-%d %H:%M:%S")
                    for s in sets:
                        if s.get("setType") != "ACTIVE" or not s.get("startTime"):
                            continue
                        set_start = datetime.strptime(s["startTime"][:19], "%Y-%m-%dT%H:%M:%S")
                        lo = (set_start - activity_start).total_seconds()
                        hi = lo + (s.get("duration") or 0)
                        set_hrs.extend(x["hr"] for x in samples if x["hr"] is not None and lo <= x["t"] <= hi)
                except ValueError:
                    pass
            entry.update({
                "active_sec": round(active_sec),
                "rest_sec": round(rest_sec),
                "num_sets": num_sets,
                "avg_hr_during_sets": round(sum(set_hrs) / len(set_hrs)) if set_hrs else None,
            })

        # ---- Chart series (any type): downsampled HR/pace/cadence/elevation over time ----
        chart = _downsample(samples, 110)
        entry["chart"] = {
            "t": [round(s["t"]) for s in chart],
            "hr": [round(s["hr"]) if s["hr"] is not None else None for s in chart],
            "pace_sec_km": [round(1000 / s["speed"]) if s["speed"] and s["speed"] > 0.3 else None for s in chart],
            "cadence": [round(s["cad"]) if s["cad"] is not None else None for s in chart],
            "elevation_m": [round(s["elev"], 1) if s["elev"] is not None else None for s in chart],
            "speed_kmh": [round(s["speed"] * 3.6, 1) if s["speed"] is not None else None for s in chart],
        }

        # ---- Route (running/walking with GPS): downsampled lat/lon polyline ----
        if activity_type in ("running", "walking"):
            geo = [s for s in samples if s["lat"] is not None and s["lon"] is not None]
            if len(geo) >= 2:
                route = _downsample(geo, 80)
                entry["route"] = [
                    [round(s["lat"], 5), round(s["lon"], 5), round(s["hr"]) if s["hr"] is not None else None,
                     round(s["dist"]) if s["dist"] is not None else None]
                    for s in route
                ]

        result[activity_id] = entry
    return result


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

    print("Descargando metricas diarias (sueno, HRV, pasos, FC reposo, training readiness, estres)...")
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

    print("Descargando composicion corporal...")
    body_comp = fetch_body_composition(client, args.days)
    with open(DATA_DIR / "body_composition.json", "w", encoding="utf-8") as f:
        json.dump(body_comp, f, ensure_ascii=False, indent=2)
    print("  -> data/body_composition.json")

    print("Descargando splits de carreras...")
    run_splits = fetch_run_splits(client, activities_df)
    with open(DATA_DIR / "run_splits.json", "w", encoding="utf-8") as f:
        json.dump(run_splits, f, ensure_ascii=False, indent=2)
    print(f"  -> {len(run_splits)} carreras con splits en data/run_splits.json")

    print("Descargando tiempo en zonas de FC por actividad...")
    hr_zones = fetch_hr_zones(client, activities_df)
    with open(DATA_DIR / "hr_zones.json", "w", encoding="utf-8") as f:
        json.dump(hr_zones, f, ensure_ascii=False, indent=2)
    print(f"  -> {len(hr_zones)} actividades con zonas en data/hr_zones.json")

    print("Descargando series de fuerza (sets/reps/peso)...")
    exercise_sets = fetch_exercise_sets(client, activities_df)
    with open(DATA_DIR / "exercise_sets.json", "w", encoding="utf-8") as f:
        json.dump(exercise_sets, f, ensure_ascii=False, indent=2)
    print(f"  -> {len(exercise_sets)} sesiones de fuerza en data/exercise_sets.json")

    print("Descargando perfil (zonas de FC, umbral, VO2max)...")
    sample_run = activities_df[activities_df["type"] == "running"]
    sample_id = sample_run.iloc[0]["activity_id"] if not sample_run.empty else None
    profile = fetch_profile(client, sample_id)
    with open(DATA_DIR / "profile.json", "w", encoding="utf-8") as f:
        json.dump(profile, f, ensure_ascii=False, indent=2)
    print("  -> data/profile.json")

    print("Descargando autoevaluacion, cumplimiento y desnivel por actividad...")
    activity_extras = fetch_activity_extras(client, activities_df)
    with open(DATA_DIR / "activity_extras.json", "w", encoding="utf-8") as f:
        json.dump(activity_extras, f, ensure_ascii=False, indent=2)
    print(f"  -> {len(activity_extras)} actividades en data/activity_extras.json")

    print("Descargando temperatura por actividad...")
    activity_weather = fetch_activity_weather(client, activities_df)
    with open(DATA_DIR / "activity_weather.json", "w", encoding="utf-8") as f:
        json.dump(activity_weather, f, ensure_ascii=False, indent=2)
    print(f"  -> {len(activity_weather)} actividades con clima en data/activity_weather.json")

    print("Descargando series detalladas (FC/ritmo/cadencia/ruta) de las actividades mas recientes...")
    zones = {z["zone"]: z["low"] for z in profile.get("hr_zone_boundaries", [])}
    zone2_low, zone2_high = zones.get(2, 120), zones.get(3, 140)
    activity_series = fetch_activity_series(client, activities_df, exercise_sets, zone2_low, zone2_high)
    with open(DATA_DIR / "activity_series.json", "w", encoding="utf-8") as f:
        json.dump(activity_series, f, ensure_ascii=False, indent=2)
    print(f"  -> {len(activity_series)} actividades con series detalladas en data/activity_series.json")

    print("Descargando calendario de entrenos de Garmin Coach...")
    scheduled = fetch_scheduled_workouts(client)
    with open(DATA_DIR / "scheduled_workouts.json", "w", encoding="utf-8") as f:
        json.dump(scheduled, f, ensure_ascii=False, indent=2)
    print(f"  -> {len(scheduled)} entrenos planificados en data/scheduled_workouts.json")

    print("\nListo. Pasale estos archivos a Claude para el analisis/dashboard.")


if __name__ == "__main__":
    main()
