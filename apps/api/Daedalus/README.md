# ai_services — Darb Dispatch NLP Engine

Parses raw Palestinian-dialect dispatch text into a validated structured
schema for the matching/dispatch pipeline.

## Layout

| File | Responsibility |
|---|---|
| `schema.py` | `DispatchRequest` — the validated Pydantic output contract |
| `lexicons.py` | Deterministic, auditable keyword lists + rule functions (emergency detection, vehicle class, capacity, clock time) |
| `llm_extractor.py` | Free-text extraction via OpenAI structured output, with an offline heuristic fallback (MOCK_MODE) |
| `pipeline.py` | Orchestration: merges the two layers, applies the safety override, validates the result |
| `demo.py` | Runnable entry point |
| `tests/` | pytest suite for the deterministic layer and the full pipeline |

## Why two layers?

`urgency_profile` is safety-critical. The deterministic keyword layer in
`lexicons.py` can only ever **raise** urgency relative to what the LLM
returns — never lower it. A language model misreading or softening a
life-safety phrase should never silently downgrade an emergency. This is
enforced in `pipeline.apply_safety_layer` and covered by
`tests/test_lexicons.py::test_safety_layer_forces_emergency`.

Every output also carries `confidence` and `raw_text`, and sets
`needs_review=True` on low-confidence or emergency results — this is meant
to feed a human-review queue in the dispatch UI, not to be silently
auto-dispatched.

Locations are **never** auto-corrected or normalized (per the
"no semantic drift" requirement) — misspellings are passed through as-is.
Fuzzy matching against the GIS gazetteer is a separate downstream concern.

## Running

```bash
pip install -r requirements.txt

# Runs in offline/heuristic MOCK_MODE (no key needed):
python -m ai_services.demo

# Runs against the real LLM:
export OPENAI_API_KEY=sk-...
python -m ai_services.demo
```

## Testing

```bash
python -m pytest ai_services/tests/ -v
```

## Known limitations (by design, not oversight)

- The offline heuristic extractor in `llm_extractor.heuristic_extract` uses
  regex and handles simple "from X to Y" phrasing well, but degrades on
  longer, multi-clause dialect sentences. That gap is exactly what the real
  LLM path (`call_llm_extract` with `OPENAI_API_KEY` set) is for.
- `EMERGENCY_KEYWORDS` / `VEHICLE_KEYWORDS` / `IMMEDIATE_TIME_KEYWORDS` in
  `lexicons.py` are a starting point, not a claim of completeness. In a
  larger deployment these should move to a versioned config file so
  ops/linguists can extend them without a code change.
