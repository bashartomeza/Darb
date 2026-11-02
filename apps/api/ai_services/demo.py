from __future__ import annotations

import json
import os

from .nlp_engine import process_and_verify_request

SAMPLE_INPUTS = [
    "بدنا تكتك قوام يسحب كرتونتين كبار من عند دوار المناررة وننزلهم بمكتب البريد المركزي والوضع مستعجل",
    "في واحد مجروح عند الشفاا بدنا اسعاف قوام",
    "بدي سيرفيس من بيت لحم للخليل الساعة 16:00",
]


def main() -> None:
    has_keys = any(os.environ.get(k) for k in ("GEMINI_API_KEY", "GEMINI_API_KEYS", "GROQ_API_KEY", "GROQ_API_KEYS"))
    notice = "" if has_keys else " (offline heuristic mode: no GEMINI/GROQ keys set)"
    print(f"Masari dispatch NLP engine -- demo run{notice}\n")
    for text in SAMPLE_INPUTS:
        print(f"INPUT: {text}")
        print(json.dumps(process_and_verify_request(text), ensure_ascii=False, indent=2))
        print("-" * 60)


if __name__ == "__main__":
    main()
