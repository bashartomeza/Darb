"""Regenerate contracts/ui_directives.v1.json (shared by Python, Node and Flutter tests)."""
import json
from pathlib import Path

from .nlp_engine import generate_dynamic_ai_ui_payload as gen

SAMPLES = {
    "emergency": {"urgency_profile": "Emergency", "vehicle_class": "Public"},
    "logistics": {"urgency_profile": "High", "vehicle_class": "Logistics", "capacity_requirements": 4},
    "standard": {"urgency_profile": "Low", "vehicle_class": "Public"},
}

if __name__ == "__main__":
    out = {k: gen(v)["frontend_ai_ui_directives"] for k, v in SAMPLES.items()}
    path = Path(__file__).parent / "contracts" / "ui_directives.v1.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("wrote", path)
