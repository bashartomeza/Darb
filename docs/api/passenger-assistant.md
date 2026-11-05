# Passenger assistant (chat and voice)

How the passenger assistant answers, what it knows, and where the time goes on a voice turn.

## Pipeline

1. Mobile (`apps/mobile/lib/features/assistant`): typed text, or on-device speech recognition
   (`speech_service.dart`, `speech_to_text`) whose final text is sent as a normal message.
2. API `POST /passenger/assistant/messages` (`modules/passengerAssistant.ts`) calls
   `services/passengerAssistant.ts`:
   1. Load published stops and routes (cached 60 s in the service instance).
   2. `parseRequest` (`services/assistantParser.ts`): the deterministic, route-aware parser. It is the safe
      core: it never invents a place, every pickup/dropoff is a real active stop.
   3. `services/assistantKnowledge.ts`: small talk and app-help answers (below). Checked on the message on
      its own, so an earlier ride in the chat does not hide "thanks" or "how do I cancel".
   4. Optional LLM provider (only when an API key is configured; see "LLM"). Its output is validated against
      real stops and cross-checked with the rule parser. Any failure falls back to the rule parser.
   5. `buildClarification` turns anything incomplete into a specific question.
3. Anything the assistant could not read goes to `uncertain_ai_requests` (redacted, 30-day retention) for
   the admin review queue.

The Python `ai_services` voice route (Whisper) is **not deployed** (`docs/deployment/AI_SERVICE.md`), so the
app uses on-device recognition. `/passenger/assistant/voice` answers `503 voice_unavailable` without it.

## Product facts the assistant may state

Answers are static strings; they say only what the product really does.

| Topic | Answer |
| --- | --- |
| Cancel | Open "My trips", pick the request, "Cancel request", choose a reason; the app says if it is not possible. The assistant cannot cancel for you. |
| Payment / fares | No payment in the app. Fares are estimates paid to the driver directly (`docs/api/route-fares.md`); the trip card shows the estimate. |
| Checkpoints | "Map" tab (Barriers) shows the last confirmed state, may be out of date; alerts on a route after a driver accepts. No live data in chat. |
| Support | Settings > Help & Support. A live in-app support channel is not connected; urgent safety issues go to the authorities. |
| How to book / capabilities | Say where from, where to, when and how many; the passenger always reviews and confirms. |
| Parcels | Not available from the chat. |
| Trip status | "My trips" (answered by the provider with the passenger's own requests when one is configured). |

Update `assistantKnowledge.ts` when one of these facts changes.

## Never a dead end

- Unknown request: says what it needs (from, to, when), shows a real example built from a published route,
  and offers tap-to-send buttons (that example, how to cancel, how to contact support). It is logged.
- Second dead end in a row: hands off to a concrete next step (rewrite in the example form, pick a button,
  Help & Support). Still logged.
- Partial request: "So far: from X to Y. When would you like to leave?" with time suggestions; missing
  pickup/dropoff suggestions are limited to places reachable on a real route; a pair with no route lists
  routes that exist; an unserved place lists served places plus an example.
- Replies of type `result` may now carry `suggestions`; the app shows them as chips.

## Dialect and matching

`normalizeText` folds alef/ya/ta-marbuta, diacritics, digits and the article. The synonym groups map spelling
and dialect variants of city and village names to whatever stop names exist in the database (nothing is
hard-coded as a place). Fuzzy matching tolerates one edit on names of 5+ letters at strength 0.8; an equal
claim by two different places on the same span is dropped as ambiguous. Confidence below 0.7
(`CONFIDENCE_PREFILL`) never prefills a request. The last three user turns are merged field by field, later
turns win.

## LLM (optional, off unless configured)

Existing design, unchanged: with `XAI_API_KEY`, `GEMINI_API_KEY` or `GROQ_API_KEY` set
(`ASSISTANT_PROVIDER`, model and `*_TIMEOUT_MS` env variables, see `config.ts`), the provider reads the
message into the same structured intent. No key means the rule path only, so there is **no paid external key
requirement**. Timeouts are enforced and every failure falls back to the rule parser. Small talk and app help
never call the provider (lower cost, lower latency). Privacy: the message, recent turns, the stop list and
the passenger's last 10 request summaries are sent to the configured provider; nothing else (no phone, name or
coordinates of the passenger). No new flag was added: the key is the switch.

## Where the time goes on a voice turn

Not measurable end to end in this environment (no device); these are the measured constants from the code
and typical engine figures.

| Step | Before | After |
| --- | --- | --- |
| Mic tap to listening (`initialize` + locales) | platform round trip on every tap, about 0.2-0.6 s | cached after the first tap, about 0 s |
| End of speech | `pauseFor` 3.0 s | 1.4 s (`speechPauseFor`) |
| Final text to request | passenger had to tap Send (about 1-2 s) | sent immediately (setting "Send when I stop speaking", default on); a ride is still only prefilled, never booked |
| Server: places | multi-join query per message | cached 60 s |
| Server: small talk / help | provider call, typically 1-4 s | static answer, under 50 ms |
| Server: ride with provider | unchanged (provider latency) | unchanged; no key means rules only, under 50 ms |
| Spoken reply | none existed | engine warmed while listening, first two sentences (max 220 characters) spoken immediately at rate 0.58 (about 1.15x normal) |
| Barge-in | n/a | mic tap stops speech; stop button while speaking |

Typed requests are never read aloud. Estimated saving per voice turn: about 1.6 s end of speech, 1-2 s
tap, 0.2-0.6 s start, plus the whole provider call on help and small-talk turns.

## Voice settings (mobile)

Tune icon next to the mic: send when I stop speaking (default on), read replies aloud when I speak
(default on), reading speed (0.35-0.85, default 0.58). Stored in `shared_preferences`
(`assistant_voice_*`). Recognition locale preference: `ar_PS`, then `ar`, then any `ar_*`; English `en_US`.

## Tests

- `apps/api/src/tests/assistantDialect.test.ts`: dialect rides, the small-talk/help matrix, unclear and
  unknown requests asserting the clarifying answers, hand-off, places cache.
- `apps/api/src/tests/assistantParser.test.ts`, `passengerAssistantService.test.ts`,
  `passengerAssistantApi.test.ts`: parser, provider paths, API.
- `apps/mobile/test/assistant_voice_test.dart`: auto-send, reading aloud only for spoken requests, settings,
  barge-in, `spokenVersion`.
