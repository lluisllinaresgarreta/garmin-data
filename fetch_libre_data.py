"""
Descarga lecturas de glucosa (FreeStyle Libre 2, via LibreLinkUp) a data/glucose.json

LibreLinkUp solo expone una ventana movil de ~12h de lecturas (su endpoint "graph"),
no historial completo. Por eso cada sincronizacion solo puede calcular datos para lo
que caiga dentro de esa ventana en ese momento -- la sync de las 23:00 normalmente no
vera la noche (aun no ha pasado) y la de las 7:00 si; igualmente, el cruce con
actividades solo funciona para entrenos recientes (ultimas ~12h).

Calcula:
- Lectura mas reciente + tendencia (arriba/estable/abajo) + hora de esa lectura.
- Estadisticas de la noche mas reciente disponible (00:00-08:00): media, minima, hipos.
- Tiempo en rango general (no solo nocturno) sobre toda la ventana descargada:
  % por debajo de 70, en rango 70-180, por encima de 180.
- Por actividad reciente (si cae dentro de la ventana): glucosa al empezar y a los
  30 min de acabar, mas cualquier hipoglucemia en las horas siguientes.

Uso:
    python fetch_libre_data.py
"""
import json
import os
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from pylibrelinkup import APIUrl, PyLibreLinkUp

load_dotenv()

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

NIGHT_START_HOUR = 0
NIGHT_END_HOUR = 8
HYPO_THRESHOLD = 70.0
RANGE_LOW = 70.0
RANGE_HIGH = 180.0
MATCH_TOLERANCE_MIN = 30
POST_WORKOUT_HYPO_WINDOW_H = 12

REGIONS = ["EU", "DE", "FR", "EU2", "US", "AE", "AP", "AU", "CA", "JP", "LA", "RU"]

TREND_LABEL = {
    "UNKNOWN": "sin dato",
    "DOWN_FAST": "bajando rapido",
    "DOWN_SLOW": "bajando",
    "STABLE": "estable",
    "UP_SLOW": "subiendo",
    "UP_FAST": "subiendo rapido",
}
TREND_ARROW = {
    "UNKNOWN": "?",
    "DOWN_FAST": "↓↓",
    "DOWN_SLOW": "↓",
    "STABLE": "→",
    "UP_SLOW": "↑",
    "UP_FAST": "↑↑",
}


def login():
    email = os.environ["LIBRE_EMAIL"]
    password = os.environ["LIBRE_PASSWORD"]
    last_err = None
    for region_name in REGIONS:
        try:
            client = PyLibreLinkUp(email=email, password=password, api_url=getattr(APIUrl, region_name))
            client.authenticate()
            return client
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(f"No se pudo autenticar en ninguna region de LibreLinkUp: {last_err}")


def _nearest_reading(readings, target_dt, tolerance_min=MATCH_TOLERANCE_MIN):
    best, best_diff = None, None
    for r in readings:
        diff_min = abs((r.timestamp - target_dt).total_seconds()) / 60
        if diff_min <= tolerance_min and (best_diff is None or diff_min < best_diff):
            best, best_diff = r, diff_min
    return best


def fetch_latest(client, patient) -> dict:
    try:
        g = client.latest(patient_identifier=patient)
    except Exception:
        return None
    trend_name = g.trend.name if g.trend is not None else "UNKNOWN"
    return {
        "value_mgdl": round(g.value_in_mg_per_dl, 1),
        "trend": trend_name,
        "trend_label": TREND_LABEL.get(trend_name, trend_name),
        "trend_arrow": TREND_ARROW.get(trend_name, "?"),
        "time": g.timestamp.strftime("%H:%M"),
        "date": g.timestamp.date().isoformat(),
        "timestamp": g.timestamp.isoformat(),
    }


def compute_night_stats(readings) -> dict:
    nights = {}
    for g in readings:
        ts = g.timestamp
        if NIGHT_START_HOUR <= ts.hour < NIGHT_END_HOUR:
            nights.setdefault(ts.date().isoformat(), []).append(g.value_in_mg_per_dl)
    if not nights:
        return {"available": False, "reason": "no_night_readings_in_window"}
    most_recent_night = sorted(nights.keys())[-1]
    values = nights[most_recent_night]
    return {
        "available": True,
        "date": most_recent_night,
        "avg_mgdl": round(sum(values) / len(values), 1),
        "min_mgdl": round(min(values), 1),
        "max_mgdl": round(max(values), 1),
        "hypo_count": sum(1 for v in values if v < HYPO_THRESHOLD),
        "reading_count": len(values),
    }


def compute_time_in_range(readings) -> dict:
    if not readings:
        return {"available": False}
    total = len(readings)
    below = sum(1 for r in readings if r.value_in_mg_per_dl < RANGE_LOW)
    above = sum(1 for r in readings if r.value_in_mg_per_dl > RANGE_HIGH)
    in_range = total - below - above
    sorted_r = sorted(readings, key=lambda r: r.timestamp)
    return {
        "available": True,
        "below_pct": round(below / total * 100, 1),
        "in_range_pct": round(in_range / total * 100, 1),
        "above_pct": round(above / total * 100, 1),
        "reading_count": total,
        "window_start": sorted_r[0].timestamp.isoformat(),
        "window_end": sorted_r[-1].timestamp.isoformat(),
        "range_low": RANGE_LOW,
        "range_high": RANGE_HIGH,
    }


def compute_activity_glucose(readings) -> dict:
    """For each recent activity whose start/end time falls inside the fetched
    glucose window, record glucose at start and ~30min after finishing, plus
    any hypoglycemia readings in the hours after."""
    out = {}
    csv_path = DATA_DIR / "activities.csv"
    if not csv_path.exists():
        return out
    try:
        acts = pd.read_csv(csv_path)
    except Exception:
        return out
    if "start_time" not in acts.columns:
        return out

    for _, row in acts.iterrows():
        start_raw = row.get("start_time")
        if not isinstance(start_raw, str) or not start_raw:
            continue
        try:
            start_dt = datetime.strptime(start_raw, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        duration_min = row.get("duration_min") or 0
        end_dt = start_dt + timedelta(minutes=float(duration_min))
        post_30_dt = end_dt + timedelta(minutes=30)

        at_start = _nearest_reading(readings, start_dt)
        at_post = _nearest_reading(readings, post_30_dt)
        if at_start is None and at_post is None:
            continue  # activity is outside the fetched glucose window entirely

        hypo_cutoff = end_dt + timedelta(hours=POST_WORKOUT_HYPO_WINDOW_H)
        hypo_events = sorted(
            [
                {"time": r.timestamp.strftime("%H:%M"), "value_mgdl": round(r.value_in_mg_per_dl, 1)}
                for r in readings
                if end_dt <= r.timestamp <= hypo_cutoff and r.value_in_mg_per_dl < HYPO_THRESHOLD
            ],
            key=lambda e: e["time"],
        )

        out[str(row["activity_id"])] = {
            "glucose_start_mgdl": round(at_start.value_in_mg_per_dl, 1) if at_start else None,
            "glucose_start_time": at_start.timestamp.strftime("%H:%M") if at_start else None,
            "glucose_post_mgdl": round(at_post.value_in_mg_per_dl, 1) if at_post else None,
            "glucose_post_time": at_post.timestamp.strftime("%H:%M") if at_post else None,
            "post_workout_hypos": hypo_events,
        }
    return out


def main():
    if not os.environ.get("LIBRE_EMAIL") or not os.environ.get("LIBRE_PASSWORD"):
        print("LIBRE_EMAIL / LIBRE_PASSWORD no configurados en .env — saltando glucosa.")
        with open(DATA_DIR / "glucose.json", "w", encoding="utf-8") as f:
            json.dump({"available": False, "reason": "not_configured"}, f, ensure_ascii=False, indent=2)
        return

    print("Conectando a LibreLinkUp...")
    try:
        client = login()
    except Exception as e:
        # Glucose is a bonus feature: never fail the overall sync over it, just
        # record that it's unavailable this run and let the rest proceed.
        print(f"Login a LibreLinkUp fallido (no bloqueante): {e}")
        with open(DATA_DIR / "glucose.json", "w", encoding="utf-8") as f:
            json.dump({"available": False, "reason": "login_failed"}, f, ensure_ascii=False, indent=2)
        return

    patients = client.get_patients()
    if not patients:
        print("Login OK pero sin paciente vinculado en LibreLinkUp.")
        with open(DATA_DIR / "glucose.json", "w", encoding="utf-8") as f:
            json.dump({"available": False, "reason": "no_patient"}, f, ensure_ascii=False, indent=2)
        return
    patient = patients[0]

    print("Login OK. Descargando glucosa...")
    readings = client.graph(patient_identifier=patient)
    if not readings:
        with open(DATA_DIR / "glucose.json", "w", encoding="utf-8") as f:
            json.dump({"available": False, "reason": "no_readings"}, f, ensure_ascii=False, indent=2)
        print("  -> sin lecturas recientes -> data/glucose.json")
        return

    result = {
        "available": True,
        "fetched_at": datetime.now().isoformat(),
        "latest": fetch_latest(client, patient),
        "night": compute_night_stats(readings),
        "time_in_range": compute_time_in_range(readings),
        "activities": compute_activity_glucose(readings),
    }
    with open(DATA_DIR / "glucose.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    latest = result["latest"]
    tir = result["time_in_range"]
    print(f"  -> ultima lectura: {latest['value_mgdl']} mg/dL ({latest['trend_label']}) a las {latest['time']}" if latest else "  -> sin lectura actual")
    print(f"  -> tiempo en rango: {tir['in_range_pct']}% (bajo {tir['below_pct']}%, alto {tir['above_pct']}%)" if tir.get("available") else "  -> sin tiempo en rango")
    print(f"  -> {len(result['activities'])} actividad(es) con glucosa correlacionada -> data/glucose.json")


if __name__ == "__main__":
    main()
