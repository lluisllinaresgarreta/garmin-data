"""
Inyecta data/combined.json en dashboard.html, sustituyendo la linea
`const DATA = {...};` por el contenido actual. No toca el resto del archivo
(CSS/HTML/JS), asi que cualquier rediseno hecho a mano sobre dashboard.html
se conserva entre actualizaciones de datos.
Uso:
    python render_dashboard.py
"""
from pathlib import Path

ROOT = Path(__file__).parent
DASHBOARD = ROOT / "dashboard.html"
COMBINED = ROOT / "data" / "combined.json"


def main():
    data_json = COMBINED.read_text(encoding="utf-8")
    data_json_escaped = data_json.replace("</script", "<\\/script")

    lines = DASHBOARD.read_text(encoding="utf-8").splitlines(keepends=True)
    replaced = False
    for i, line in enumerate(lines):
        if line.startswith("const DATA = "):
            lines[i] = f"const DATA = {data_json_escaped};\n"
            replaced = True
            break

    if not replaced:
        raise SystemExit("No se encontro la linea 'const DATA = ' en dashboard.html")

    DASHBOARD.write_text("".join(lines), encoding="utf-8")
    print("dashboard.html actualizado con los datos nuevos")


if __name__ == "__main__":
    main()
