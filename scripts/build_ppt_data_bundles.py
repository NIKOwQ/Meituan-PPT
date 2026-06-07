import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data"
TARGET = ROOT / "ppt" / "data" / "scenario-bundles.js"


def load_scenario(name: str) -> dict:
    folder = SOURCE / name
    report = json.loads((folder / "report.json").read_text(encoding="utf-8"))
    return {"report": report}


payload = {
    "defaultScenario": "rider",
    "scenarios": {
        "rider": load_scenario("rider"),
        "merchant": load_scenario("merchant"),
    },
    "comparison": None,
}

TARGET.write_text(
    "window.PPT_SCENARIO_BUNDLES = "
    + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    + ";\n",
    encoding="utf-8",
)
print(f"Wrote {TARGET} ({TARGET.stat().st_size} bytes)")
