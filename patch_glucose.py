"""
Fast glucose-only sync: patches just the `glucose` key inside an already-published
dashboard.html's embedded DATA with a freshly fetched Libre reading, WITHOUT
re-running the full Garmin fetch (which is what makes the main sync slow).

Takes the currently-live dashboard.html (as saved locally by the Artifact tool's
`read` action) and data/glucose.json (written by fetch_libre_data.py), and produces
a patched dashboard.html with everything else byte-for-byte unchanged except the
`glucose` key and the `const DATA = ` line itself.

Per-activity glucose_start_mgdl/glucose_post_mgdl correlation is NOT recomputed in
this fast path (it needs data/activities.csv, which this path doesn't fetch) --
only the top-level `glucose` summary (latest reading/trend, night stats, time in
range) is refreshed. A full sync will still recompute per-activity glucose as usual.

Uso:
    python patch_glucose.py <ruta-al-dashboard-html-en-vivo> [<ruta-salida>]
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Uso: python patch_glucose.py <live_dashboard_html_path> [output_path]")
    live_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "dashboard.html"
    glucose_path = ROOT / "data" / "glucose.json"

    if not glucose_path.exists():
        raise SystemExit(f"No existe {glucose_path} -- ejecuta fetch_libre_data.py antes.")

    lines = live_path.read_text(encoding="utf-8").splitlines(keepends=True)
    target_i = None
    for i, line in enumerate(lines):
        if line.startswith("const DATA = "):
            target_i = i
            break
    if target_i is None:
        raise SystemExit("No se encontro la linea 'const DATA = ' en el HTML en vivo.")

    line = lines[target_i]
    prefix = "const DATA = "
    suffix = ";\n" if line.endswith(";\n") else ";"
    json_str = line[len(prefix):]
    if json_str.endswith(suffix):
        json_str = json_str[: -len(suffix)]
    # The stored line has </script escaped as <\/script for safe embedding; undo
    # that before parsing, same convention render_dashboard.py writes.
    data = json.loads(json_str.replace("<\\/script", "</script"))

    glucose_raw = json.loads(glucose_path.read_text(encoding="utf-8"))
    data["glucose"] = {k: v for k, v in glucose_raw.items() if k != "activities"}

    new_json = json.dumps(data, ensure_ascii=False).replace("</script", "<\\/script")
    lines[target_i] = f"const DATA = {new_json};\n"

    out_path.write_text("".join(lines), encoding="utf-8")
    g = data["glucose"]
    if g.get("available") and g.get("latest"):
        print(f"Glucosa parcheada: {g['latest']['value_mgdl']} mg/dL ({g['latest']['trend_label']}) a las {g['latest']['time']} -> {out_path}")
    else:
        print(f"Glucosa parcheada (sin lectura disponible: {g.get('reason')}) -> {out_path}")


if __name__ == "__main__":
    main()
