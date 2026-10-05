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

# Exercise name/category code -> Spanish display name. Keyed first by the specific
# movement code Garmin reports (more precise), falling back to the broader category
# code below for exercises Garmin didn't resolve to a specific movement.
EXERCISE_NAME_ES = {
    # Pecho
    "DECLINE_BARBELL_BENCH_PRESS": "Press banca declinado",
    "INCLINE_DUMBBELL_BENCH_PRESS": "Press inclinado con mancuernas",
    "DECLINE_DUMBBELL_FLYE": "Aperturas declinadas",
    "CHEST_FLY": "Aperturas de pecho",
    "BENCH_PRESS": "Press banca",
    "CHEST_PRESS": "Press de pecho",
    "PUSH_UP": "Flexiones",
    "DIP": "Fondos",
    # Espalda
    "CLOSE_GRIP_LAT_PULLDOWN": "Jalón agarre cerrado",
    "STRAIGHT_ARM_PULLDOWN": "Jalón brazos rectos",
    "FACE_PULL": "Face pull",
    "LAT_PULLDOWN": "Jalón al pecho",
    "PULLDOWN": "Jalón",
    "PULL_UP": "Dominadas",
    "PULLUP": "Dominadas",
    "ROW": "Remo",
    "DEADLIFT": "Peso muerto",
    "SHRUG": "Encogimiento de hombros",
    # Brazos
    "CABLE_OVERHEAD_TRICEPS_EXTENSION": "Extensión tríceps polea sobre la cabeza",
    "TRICEPS_PRESSDOWN": "Jalón tríceps",
    "TRICEPS_EXTENSION": "Extensión de tríceps",
    "TRICEP_EXTENSION": "Extensión de tríceps",
    "WIDE_GRIP_EZ_BAR_BICEPS_CURL": "Curl bíceps barra Z agarre ancho",
    "DUMBBELL_HAMMER_CURL": "Curl martillo con mancuernas",
    "INCLINE_DUMBBELL_BICEPS_CURL": "Curl bíceps inclinado con mancuernas",
    "CURL": "Curl de bíceps",
    # Hombros
    "SHOULDER_PRESS": "Press de hombros",
    "LATERAL_RAISE": "Elevación lateral",
    "FRONT_RAISE": "Elevación frontal",
    # Piernas
    "BARBELL_SIFF_SQUAT": "Sentadilla Siff con barra",
    "BELT_SQUAT": "Sentadilla con cinturón",
    "WEIGHTED_LEG_EXTENSIONS": "Extensión de piernas lastrada",
    "WEIGHTED_LEG_CURL": "Curl femoral lastrado",
    "SQUAT": "Sentadilla",
    "LUNGE": "Zancada",
    "LEG_PRESS": "Prensa de piernas",
    "LEG_CURL": "Curl femoral",
    "LEG_EXTENSION": "Extensión de piernas",
    "LEG_RAISE": "Elevación de piernas",
    "CALF_RAISE": "Elevación de gemelos",
    "HIP_RAISE": "Elevación de cadera",
    "HIP_THRUST": "Hip thrust",
    "STEP_UP": "Subida al cajón",
    # Core
    "PLANK": "Plancha",
    "CRUNCH": "Abdominal crunch",
    "SIT_UP": "Abdominal sit-up",
    "CORE": "Core",
    "RUSSIAN_TWIST": "Giro ruso",
}


def humanize_exercise_code(code):
    """Fallback for any exercise code we don't have a translation for: turn
    SOME_CODE into 'Some code' instead of showing the raw Garmin constant."""
    if not code:
        return "Ejercicio"
    words = code.replace("-", "_").split("_")
    return " ".join(words).capitalize()


def exercise_display_name(category, name):
    key = name or category
    return EXERCISE_NAME_ES.get(key) or EXERCISE_NAME_ES.get(category or "") or humanize_exercise_code(key)


# Fine-grained muscle groups, each exercise contributing 1.0 to its primary
# group and 0.5 (or another weight) to secondary groups it also works, so
# "effective sets" per group can sum these weighted contributions rather than
# just counting raw sets. Checked against the exercise's specific movement
# NAME first (more precise, and fixes cases where Garmin's broader CATEGORY is
# wrong — e.g. a leg-extension movement logged under the CRUNCH category),
# falling back to CATEGORY-level rules for anything not matched by name.
def _name_muscle_rules(key):
    def has(*subs):
        return any(s in key for s in subs)
    if has("LEG_EXTENSION"):
        return [("Cuádriceps", 1.0)]
    if has("LEG_CURL"):
        return [("Isquios", 1.0)]
    if has("FACE_PULL"):
        return [("Hombros", 1.0), ("Espalda", 0.5)]
    if has("STRAIGHT_ARM_PULLDOWN", "LAT_PULLDOWN", "PULLDOWN"):
        return [("Espalda", 1.0), ("Bíceps", 0.5)]
    if has("BENCH_PRESS", "CHEST_PRESS", "PUSH_UP", "DIP"):
        return [("Pecho", 1.0), ("Tríceps", 0.5), ("Hombros", 0.5)]
    if has("FLYE", "CHEST_FLY", "FLY"):
        return [("Pecho", 1.0)]
    if has("TRICEPS", "PRESSDOWN"):
        return [("Tríceps", 1.0)]
    if has("BICEPS_CURL", "HAMMER_CURL", "CURL"):
        return [("Bíceps", 1.0)]
    if has("SQUAT"):
        return [("Cuádriceps", 1.0), ("Glúteo", 0.5)]
    if has("DEADLIFT"):
        return [("Isquios", 1.0), ("Glúteo", 1.0), ("Espalda", 0.3)]
    if has("CALF_RAISE"):
        return [("Gemelo", 1.0)]
    if has("HIP_THRUST", "HIP_RAISE"):
        return [("Glúteo", 1.0), ("Isquios", 0.3)]
    if has("SHOULDER_PRESS"):
        return [("Hombros", 1.0), ("Tríceps", 0.5)]
    if has("LATERAL_RAISE", "FRONT_RAISE"):
        return [("Hombros", 1.0)]
    if has("SHRUG"):
        return [("Espalda", 1.0)]
    if has("PLANK", "CRUNCH", "SIT_UP", "RUSSIAN_TWIST"):
        return [("Core", 1.0)]
    if has("LEG_PRESS", "LUNGE", "STEP_UP"):
        return [("Cuádriceps", 1.0), ("Glúteo", 0.5)]
    if has("ROW", "PULL_UP", "PULLUP"):
        return [("Espalda", 1.0), ("Bíceps", 0.5)]
    return None


_CATEGORY_MUSCLE_RULES = {
    "BENCH_PRESS": [("Pecho", 1.0), ("Tríceps", 0.5), ("Hombros", 0.5)],
    "CHEST_PRESS": [("Pecho", 1.0), ("Tríceps", 0.5), ("Hombros", 0.5)],
    "FLYE": [("Pecho", 1.0)],
    "PUSH_UP": [("Pecho", 1.0), ("Tríceps", 0.5), ("Hombros", 0.5)],
    "DIP": [("Pecho", 1.0), ("Tríceps", 0.5)],
    "ROW": [("Espalda", 1.0), ("Bíceps", 0.5)],
    "PULL_UP": [("Espalda", 1.0), ("Bíceps", 0.5)],
    "PULLUP": [("Espalda", 1.0), ("Bíceps", 0.5)],
    "LAT_PULLDOWN": [("Espalda", 1.0), ("Bíceps", 0.5)],
    "PULLDOWN": [("Espalda", 1.0), ("Bíceps", 0.5)],
    "DEADLIFT": [("Isquios", 1.0), ("Glúteo", 1.0), ("Espalda", 0.3)],
    "SQUAT": [("Cuádriceps", 1.0), ("Glúteo", 0.5)],
    "LUNGE": [("Cuádriceps", 1.0), ("Glúteo", 0.5)],
    "LEG_PRESS": [("Cuádriceps", 1.0), ("Glúteo", 0.5)],
    "LEG_CURL": [("Isquios", 1.0)],
    "LEG_EXTENSION": [("Cuádriceps", 1.0)],
    "LEG_RAISE": [("Core", 1.0)],
    "CALF_RAISE": [("Gemelo", 1.0)],
    "HIP_RAISE": [("Glúteo", 1.0), ("Isquios", 0.3)],
    "HIP_THRUST": [("Glúteo", 1.0), ("Isquios", 0.3)],
    "STEP_UP": [("Cuádriceps", 1.0), ("Glúteo", 0.5)],
    "SHOULDER_PRESS": [("Hombros", 1.0), ("Tríceps", 0.5)],
    "LATERAL_RAISE": [("Hombros", 1.0)],
    "FRONT_RAISE": [("Hombros", 1.0)],
    "SHRUG": [("Espalda", 1.0)],
    "CURL": [("Bíceps", 1.0)],
    "TRICEPS_EXTENSION": [("Tríceps", 1.0)],
    "TRICEP_EXTENSION": [("Tríceps", 1.0)],
    "PLANK": [("Core", 1.0)],
    "CRUNCH": [("Core", 1.0)],
    "SIT_UP": [("Core", 1.0)],
    "CORE": [("Core", 1.0)],
    "RUSSIAN_TWIST": [("Core", 1.0)],
}


def classify_muscles(category, name):
    """List of (fine muscle group, weight) this exercise works — primary group
    weight 1.0, secondary groups a fraction of that. Empty list for exercises
    with no tracked muscle group (warm-up, cool-down, cardio, unrecognized)."""
    rules = _name_muscle_rules((name or "").upper())
    if rules is not None:
        return rules
    cat = (category or "").upper()
    for key, rules in _CATEGORY_MUSCLE_RULES.items():
        if key in cat:
            return rules
    return []


PUSH_GROUPS = {"Pecho", "Hombros", "Tríceps"}
PULL_GROUPS = {"Espalda", "Bíceps"}
LEG_GROUPS = {"Cuádriceps", "Isquios", "Glúteo", "Gemelo"}


def classify_session_type(session_name, muscle_group_sets):
    name = (session_name or "").lower()
    if "push" in name or "empuje" in name:
        return "Push"
    if "pull" in name or "tirón" in name or "tiron" in name:
        return "Pull"
    if "pierna" in name or "leg" in name:
        return "Pierna"
    push_total = sum(v for g, v in muscle_group_sets.items() if g in PUSH_GROUPS)
    pull_total = sum(v for g, v in muscle_group_sets.items() if g in PULL_GROUPS)
    leg_total = sum(v for g, v in muscle_group_sets.items() if g in LEG_GROUPS)
    best = max(push_total, pull_total, leg_total)
    if best <= 0:
        return "Fuerza"
    if best == push_total:
        return "Push"
    if best == pull_total:
        return "Pull"
    return "Pierna"


WARMUP_THRESHOLD = 0.6  # a set below 60% of that exercise's max weight this session doesn't count as "effective"


def epley_1rm(weight_kg, reps):
    if weight_kg is None or not reps:
        return None
    return weight_kg * (1 + reps / 30)


def parse_strength_session(session):
    """Per-exercise sets/best-set/1RM plus effective-sets-per-muscle-group for one
    strength activity's raw exercise_sets.json entry. Shared by the per-activity
    fields consumed by the dashboard's strength-focused detail view."""
    order = []
    by_key = {}
    for s in (session or {}).get("sets", []):
        if s.get("setType") != "ACTIVE":
            continue
        exs = s.get("exercises") or []
        category = exs[0].get("category") if exs else None
        name = exs[0].get("name") if exs else None
        reps = s.get("repetitionCount")
        if category == "WARM_UP":
            continue
        if category == "UNKNOWN" and not reps:
            continue
        weight_kg = round(s["weight"] / 1000, 1) if s.get("weight") else None
        key = (category, name)
        if key not in by_key:
            by_key[key] = {"category": category, "name": name, "sets": []}
            order.append(key)
        by_key[key]["sets"].append({"reps": reps, "weight_kg": weight_kg})

    exercises = []
    group_sets = {}
    effective_sets_total = 0
    volume_kg_total = 0.0
    for key in order:
        ex = by_key[key]
        weighted_sets = [s for s in ex["sets"] if s["weight_kg"] is not None]
        max_weight = max((s["weight_kg"] for s in weighted_sets), default=None)
        out_sets = []
        effective_count = 0
        best_set, best_1rm = None, -1
        for s in ex["sets"]:
            warmup = (max_weight is not None and s["weight_kg"] is not None
                      and s["weight_kg"] < WARMUP_THRESHOLD * max_weight)
            effective = s["weight_kg"] is not None and not warmup
            out_sets.append({"reps": s["reps"], "weight_kg": s["weight_kg"], "warmup": warmup})
            if effective:
                effective_count += 1
                volume_kg_total += (s["reps"] or 0) * s["weight_kg"]
                rm = epley_1rm(s["weight_kg"], s["reps"])
                if rm is not None and rm > best_1rm:
                    best_1rm, best_set = rm, s
        display_name = exercise_display_name(ex["category"], ex["name"])
        weights = [s["weight_kg"] for s in ex["sets"] if s["weight_kg"] is not None]
        exercises.append({
            "name": ex["name"] or ex["category"],
            "category": ex["category"],
            "display_name": display_name,
            "sets": out_sets,
            "weight_min": min(weights) if weights else None,
            "weight_max": max(weights) if weights else None,
            "best_set": {"reps": best_set["reps"], "weight_kg": best_set["weight_kg"]} if best_set else None,
            "one_rm_est": round(best_1rm, 1) if best_set else None,
        })
        effective_sets_total += effective_count
        if effective_count:
            for group, w in classify_muscles(ex["category"], ex["name"]):
                group_sets[group] = group_sets.get(group, 0) + effective_count * w

    muscle_group_sets = {g: round(v, 1) for g, v in group_sets.items() if v > 0}
    return {
        "exercises": exercises,
        "muscle_group_sets": muscle_group_sets,
        "session_type": classify_session_type(session.get("name"), muscle_group_sets),
        "effective_sets_total": effective_sets_total,
        "volume_kg_total": round(volume_kg_total, 1),
    }


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
    sets_raw = load_json("exercise_sets.json", {})
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
        r["wind_hourly"] = w.get("wind_hourly") or []
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
        if aid in sets_raw:
            parsed = parse_strength_session(sets_raw[aid])
            r["exercises"] = parsed["exercises"]
            r["muscle_group_sets"] = parsed["muscle_group_sets"]
            r["session_type"] = parsed["session_type"]
            r["effective_sets_total"] = parsed["effective_sets_total"]
            r["volume_kg_total"] = parsed["volume_kg_total"]

    # Personal-record flag per exercise: mark an exercise's one_rm_est as a PR only
    # if it beats every STRICTLY EARLIER session's best for that same exercise name,
    # so this needs all strength sessions parsed above before it can compare across
    # them chronologically (oldest first).
    strength_records = sorted(
        (r for r in act_records if r.get("exercises")),
        key=lambda r: r.get("date") or "",
    )
    best_1rm_so_far = {}
    for r in strength_records:
        for ex in r["exercises"]:
            rm = ex.get("one_rm_est")
            prev_best = best_1rm_so_far.get(ex["name"])
            ex["is_pr"] = rm is not None and (prev_best is None or rm > prev_best)
            if rm is not None and (prev_best is None or rm > prev_best):
                best_1rm_so_far[ex["name"]] = rm

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
        "runTrends": run_trends,
        "glucose": glucose,
    }
    with open(DATA_DIR / "combined.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"data/combined.json written ({len(json.dumps(out))} bytes)")


if __name__ == "__main__":
    main()
