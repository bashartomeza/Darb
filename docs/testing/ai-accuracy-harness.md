# AI request-understanding accuracy harness

Plan p21 targets 85% accuracy when the assistant understands Arabic ride and parcel requests. This harness measures that number repeatably. Code and data live in `apps/api/src/aiEval/`.

## Run it

```
npm run ai:eval -w @masari/api                       # baseline keyword parser
npm run ai:eval -w @masari/api -- --threshold 90     # stricter gate (percent)
npm run ai:eval -w @masari/api -- --category typo    # one category only
```

Options (flag or env): `--parser` / `AI_EVAL_PARSER` (`baseline` default, `real`, `groq`, `gemini`), `--threshold` / `AI_EVAL_THRESHOLD` (default 85), `--failures N` (failures listed, default 15), `--category`.

Exit codes: 0 at or above threshold, 1 below it, 2 on configuration errors.

## Dataset (`dataset.json`)

165 labelled requests for the locked Hebron / PPU / Bab Al-Zawiya to Bethlehem corridor. Stop ids come from `DEMO_STOP_KEYS` in `apps/api/src/modules/demoReset.ts`:

| id | name |
| --- | --- |
| `demo-ppu-main-gate` | PPU Main Gate (بوابة جامعة بوليتكنك فلسطين) |
| `demo-bab-al-zawiya` | Bab Al-Zawiya (باب الزاوية) |
| `demo-bethlehem-center` | Bethlehem Center (وسط بيت لحم) |

Each case: `id`, `category`, `text`, `expected` = `{type, pickup, dropoff, time, seats, size}`.

Label conventions:

- `type`: `ride`, `parcel`, or `unknown` (greetings, price questions, cancellations, gibberish, an empty string, "I do not want to go"). Unknown cases expect every other field null.
- `pickup` / `dropoff`: a stop id; `null` if not stated; `"ambiguous"` if the place matches several stops (for example "الخليل" or "Hebron", which could be PPU or Bab Al-Zawiya); `"unsupported"` for places outside the network (Nablus, Ramallah, Jerusalem, Gaza).
- `time`: resolved against the fixed `now` in the dataset (Wednesday 2026-10-28 08:00, Asia/Hebron). Values: `null`, `now`, `HH:MM` (24h), `morning|afternoon|evening|noon|tonight`, optionally prefixed `tomorrow ` or `day-after-tomorrow `. A bare hour with no period word follows the 7-11 morning / 1-6 afternoon convention.
- `seats`: integer for rides, 1 when unstated. `size`: `small|medium|large` or null for parcels (seats are null for parcels, size null for rides).
- Multi-intent messages are labelled with the first request in the message.

Categories: basic, reverse, english, arabizi, mixed, typo, numbers, time, missing_dest, missing_pickup, ambiguous, unsupported, negation, multi_intent, parcel, non_request, noisy.

### Extending it

Add a row to the `cases` array with the next free id and a category (a new category name is fine; it appears as its own row in the report). Use real stop ids only; `aiEval.test.ts` enforces id uniqueness, valid stop ids and label consistency. Prefer adding cases for real failures seen in production logs (after removing personal data: no names, phone numbers or exact addresses). Do not edit expected labels to make a parser pass.

## Scoring and reporting

Every parser is reduced to the same shape (`type, pickup, dropoff, time, seats, size`). A field is correct on exact match with the label.

- Overall accuracy: share of cases where all six fields are correct. This is the number gated by the threshold and the one to compare with the 85% target.
- Per-field accuracy: share of cases with that field correct.
- Field micro-average: correct (case, field) pairs over all pairs. Informational.
- Failures by category: for each category, cases, passes, accuracy and how many failures were in each field.
- Type confusion: expected vs predicted type (ride, parcel, unknown).
- The first failures are listed with the wrong fields. A parser that throws counts as all fields wrong.

## Pointing it at the real parser

The harness targets the pure function `parseRequest(text, context)` (branch `feat/ai-assistant-v2`). `context` is `{ now, timezone, locale, stops: [{id, name_ar, name_en}], provider? }`.

```
AI_EVAL_PARSER_MODULE=src/services/<parser-file>.ts npm run ai:eval -w @masari/api -- --parser real
```

The path is relative to `apps/api` and the module must export `parseRequest`. The harness is written against that signature only; `normalizeRealResult` in `adapters.ts` maps the returned object onto the scored shape and accepts several field spellings (`type|intent`, `pickup|pickupStopId`, `seats|seatCount|passengerCount`, and so on, optionally wrapped in `request`). If the real result differs, adjust that one function.

## Live Groq / Gemini providers (opt-in, never CI)

```
AI_EVAL_LIVE=1 GROQ_API_KEY=... AI_EVAL_PARSER_MODULE=... npm run ai:eval -w @masari/api -- --parser groq
AI_EVAL_LIVE=1 GEMINI_API_KEY=... AI_EVAL_PARSER_MODULE=... npm run ai:eval -w @masari/api -- --parser gemini
```

The harness passes `context.provider = "groq" | "gemini"` to the real parser, which must select that provider. Live runs are refused unless `AI_EVAL_LIVE=1`, refused when `CI` is set, and refused without the key. They make network calls and may cost money (165 requests per run). Unit tests never call the network; the vitest suite only exercises the baseline parser and the scoring code.

## Baseline

`baselineParser.ts` is a small keyword parser that exists only to show the harness working. At the time of writing it scores 72.7% overall, below the 85% gate, so `npm run ai:eval` exits 1 with it. That is expected; it is not wired into CI as a gate. Wire the gate once the real parser reaches the target.
