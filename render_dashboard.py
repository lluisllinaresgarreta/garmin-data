"""
Regenera data.json (en la raiz del repo) a partir de data/combined.json.

Desde la separacion de dashboard.html en index.html/app.js/styles.css/data.json,
una sincronizacion normal solo necesita actualizar data.json -- el HTML/JS/CSS
se tocan a mano y se publican aparte solo cuando hay cambios de diseno.

Uso:
    python render_dashboard.py
"""
from pathlib import Path
import json

ROOT = Path(__file__).parent
COMBINED = ROOT / "data" / "combined.json"
DATA_JSON = ROOT / "data.json"


def main():
    data = json.loads(COMBINED.read_text(encoding="utf-8"))
    DATA_JSON.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"data.json actualizado ({DATA_JSON.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
