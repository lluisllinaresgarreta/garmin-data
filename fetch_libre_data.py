"""
Descarga lecturas de glucosa (FreeStyle Libre 2, via LibreLinkUp) a data/glucose.json
Calcula estadisticas de la noche mas reciente disponible (00:00-08:00 hora local):
media, minima, hipos (<70 mg/dL).

Nota: LibreLinkUp solo expone una ventana movil de ~12h de lecturas (su endpoint
"graph"), no historial completo. Por eso la sincronizacion de las 23:00 normalmente
no encontrara datos nocturnos (la noche aun no ha pasado) y la de las 7:00 si.

Uso:
    python fetch_libre_data.py
"""
import json
import os
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from pylibrelinkup import APIUrl, PyLibreLinkUp

load_dotenv()

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

NIGHT_START_HOUR = 0
NIGHT_END_HOUR = 8
HYPO_THRESHOLD = 70.0

REGIONS = ["EU", "DE", "FR", "EU2", "US", "AE", "AP", "AU", "CA", "JP", "LA", "RU"]


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


def fetch_night_glucose(client) -> dict:
    patients = client.get_patients()
    if not patients:
        return {"available": False, "reason": "no_patient"}

    graph = client.graph(patient_identifier=patients[0])
    if not graph:
        return {"available": False, "reason": "no_readings"}

    # Group readings by the calendar date of their "night bucket": a reading
    # between 00:00 and NIGHT_END_HOUR belongs to that same date's night.
    nights = {}
    for g in graph:
        ts = g.timestamp
        if NIGHT_START_HOUR <= ts.hour < NIGHT_END_HOUR:
            key = ts.date().isoformat()
            nights.setdefault(key, []).append(g.value_in_mg_per_dl)

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
        "fetched_at": datetime.now().isoformat(),
    }


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

    print("Login OK. Descargando glucosa nocturna...")
    result = fetch_night_glucose(client)
    with open(DATA_DIR / "glucose.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    if result.get("available"):
        print(f"  -> noche del {result['date']}: media {result['avg_mgdl']} mg/dL, "
              f"minima {result['min_mgdl']}, {result['hypo_count']} hipos -> data/glucose.json")
    else:
        print(f"  -> sin datos nocturnos disponibles todavia ({result.get('reason')}) -> data/glucose.json")


if __name__ == "__main__":
    main()
