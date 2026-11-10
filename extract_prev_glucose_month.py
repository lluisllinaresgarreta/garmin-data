"""
Read the currently-published glucose_month.json (the monthly glucose report's
own data file -- NOT inside data.json, see merge_prev_glucose.py's docstring)
and copy it to data/prev_glucose_month.json, so merge_prev_glucose.py can
merge this run's freshly fetched readings into it without losing the rest of
the current+previous month that earlier syncs already saw.

glucose_month.json might not exist yet (first time this feature runs, or the
Artifact read step failed/404'd) -- that's expected and non-fatal: this script
just writes an empty list, and merge_prev_glucose.py starts the buffer fresh
from there.

Uso:
    python extract_prev_glucose_month.py [<ruta-local-al-glucose_month.json-publicado>]
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent
OUT_PATH = ROOT / "data" / "prev_glucose_month.json"


def main():
    OUT_PATH.parent.mkdir(exist_ok=True)
    month_series = []
    if len(sys.argv) > 1:
        path = Path(sys.argv[1])
        if path.exists():
            try:
                month_series = json.loads(path.read_text(encoding="utf-8")) or []
            except (json.JSONDecodeError, OSError) as e:
                print(f"No se pudo leer {path} (no bloqueante): {e}")
                month_series = []
        else:
            print(f"No existe {path} -- primera vez que se publica glucose_month.json, o la lectura fallo.")
    else:
        print("Sin ruta de glucose_month.json previo -- arrancando el buffer mensual vacio.")

    OUT_PATH.write_text(json.dumps(month_series, ensure_ascii=False), encoding="utf-8")
    print(f"{len(month_series)} lectura(s) previas del informe mensual conservadas -> {OUT_PATH}")


if __name__ == "__main__":
    main()
