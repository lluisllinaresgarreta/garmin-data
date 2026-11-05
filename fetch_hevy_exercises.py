"""
Descarga los entrenos de fuerza recientes de Hevy (data/hevy_workouts.json),
con los ejercicios/series exactamente como se registraron en el gimnasio --
sin pasar por el mapeo al catalogo limitado de ejercicios de Garmin que hace
hevy2garmin para poder subirlos a Garmin Connect.

build_combined.py cruza cada actividad de fuerza de Garmin (por hora de
inicio) con su entreno de Hevy correspondiente y usa los ejercicios de Hevy
en vez de los de Garmin -- conservando la FC/duracion/calorias del reloj,
que Hevy no tiene.

Una sola pagina de la API de Hevy (ordenada por mas reciente primero) cubre
semanas de historial dado que Lluis entrena fuerza ~3x/semana, asi que esto
es una unica llamada HTTP -- no hace falta sincronizacion incremental por
fecha como con Garmin. pageSize=10 porque la API de Hevy devuelve 400 Bad
Request con valores mayores (hevy2garmin, que ya sabemos que funciona contra
esta misma API, usa 10 como default en todos sus endpoints paginados) --
sigue cubriendo mas de 3 semanas de historial a ese ritmo.

Uso:
    python fetch_hevy_exercises.py [page_size]
"""
import json
import os
import sys
from pathlib import Path

import requests

DATA_DIR = Path(__file__).parent / "data"
BASE_URL = os.environ.get("HEVY_API_KEY_URL", "https://api.hevyapp.com/v1")
PAGE_SIZE = int(sys.argv[1]) if len(sys.argv) > 1 else 10


def main():
    DATA_DIR.mkdir(exist_ok=True)
    api_key = os.environ.get("HEVY_API_KEY")
    if not api_key:
        print("HEVY_API_KEY no configurada -- saltando ejercicios de Hevy (se usaran los de Garmin).")
        (DATA_DIR / "hevy_workouts.json").write_text("[]", encoding="utf-8")
        return

    try:
        resp = requests.get(
            f"{BASE_URL}/workouts",
            params={"page": 1, "pageSize": PAGE_SIZE},
            headers={"api-key": api_key, "Accept": "application/json"},
            timeout=30,
        )
        resp.raise_for_status()
        workouts = resp.json().get("workouts", [])
    except Exception as e:
        # Best-effort, igual que la glucosa: un fallo aqui no debe bloquear el
        # resto del pipeline -- simplemente los entrenos de fuerza se quedan
        # con los ejercicios (mapeados) de Garmin de esta sincronizacion.
        print(f"No se pudo descargar de Hevy (no bloqueante): {e}")
        (DATA_DIR / "hevy_workouts.json").write_text("[]", encoding="utf-8")
        return

    (DATA_DIR / "hevy_workouts.json").write_text(
        json.dumps(workouts, ensure_ascii=False), encoding="utf-8"
    )
    print(f"  -> {len(workouts)} entrenos de Hevy en data/hevy_workouts.json")


if __name__ == "__main__":
    main()
