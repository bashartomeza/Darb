# Darb AI service (Python) - how to deploy it

Status: **not deployed.** The owner has not decided whether to run it. The live deploy
(`docs/deployment/CPANEL_DEPLOY.md`) does not include it and must not be changed to include it.
Without it the Node API keeps working: voice messages answer `503 voice_unavailable` and the
text assistant is unaffected, because the client is off when `AI_SERVICES_URL` is empty.

## What it is

`apps/api/ai_services` is a small stdlib HTTP service (Python 3.12, pydantic only) that the Node API
calls over one internal hop:

- `POST /v1/analyze` - JSON `{"text": "...", "routes": [optional]}`: safety firewall, extraction
  (Gemini, then Groq, then an offline heuristic), confidence gates, UI directives.
- `POST /v1/voice` - raw `.wav`/`.mp3` (max 10 MB, same as the Node route): Whisper transcript, then the same pipeline.
- `GET /health` - liveness and key counts only.

It is never exposed to the internet and never touches the database.

## Environment variables

On the **Node API** (`apps/api/.env`):

| Variable | Meaning |
| --- | --- |
| `AI_SERVICES_URL` | Base URL of the service, for example `http://127.0.0.1:8765`. Empty means the feature is off. |
| `AI_SERVICES_SHARED_SECRET` | At least 16 characters; sent as `X-Internal-Secret`. |
| `AI_SERVICES_TIMEOUT_MS` | Text timeout, default 20000. Keep above the Python text budget. |
| `AI_SERVICES_VOICE_TIMEOUT_MS` | Voice timeout, default 55000. Keep above the Python voice budget. |

On the **Python service**:

| Variable | Meaning |
| --- | --- |
| `AI_SERVICES_SHARED_SECRET` | The same secret. Unset or shorter than 16 characters: every request is refused. Surrounding spaces are trimmed on both sides. |
| `GEMINI_API_KEYS` / `GEMINI_API_KEY` | Comma-separated keys, tried in rotation. |
| `GROQ_API_KEYS` / `GROQ_API_KEY` | Second provider pool. |
| `OPENAI_API_KEYS` / `OPENAI_API_KEY` | Whisper (voice only). |
| `AI_SERVICES_HOST`, `AI_SERVICES_PORT` | Default `127.0.0.1:8765`. The container image binds `0.0.0.0` inside the container. |
| `AI_SERVICES_MAX_WORKERS` | Worker pool size, default 8. When all are busy a new request gets 503. |
| `AI_SERVICES_TEXT_BUDGET_SECONDS` | Total time for one text request, default 12. |
| `AI_SERVICES_VOICE_BUDGET_SECONDS` | Total time for one voice request, default 45. |
| `AI_SERVICES_EMERGENCY_NUMBERS` | Optional override, for example `101,100,102`. Verify the defaults before launch. |
| `AI_SERVICES_LANDMARK_HINTS` | `overpass` turns on optional landmark hints (outbound calls to Overpass). Off by default. |

Provider keys live only in the environment of the service. Never put them in the repository, the
image, or the Node `.env`.

Timeouts must nest: Python budget (12 s / 45 s) < Node timeout (20 s / 55 s). The Python side always
answers inside its budget, so the Node client does not give up while failover is still running.

## Where it can run

It **cannot run on the cPanel host** (Injazat): that plan has no Docker and no long-running
non-Node process manager for Python. Options:

1. **A small container host next to the API** (recommended if voice is wanted): any VPS or
   container platform. Build and run:

   ```
   cd apps/api
   docker build -t darb-ai-services -f ai_services/Dockerfile .
   docker run -d --restart unless-stopped --name darb-ai \
     -e AI_SERVICES_SHARED_SECRET -e GEMINI_API_KEYS -e GROQ_API_KEYS -e OPENAI_API_KEYS \
     -p 127.0.0.1:8765:8765 darb-ai-services
   ```

   Only the service code enters the image (`ai_services/Dockerfile.dockerignore`); `.env` files and
   `node_modules` are never sent. Put it on a private network or behind a firewall rule that allows
   only the API host, and use HTTPS or a private link when the API and the service are on different machines.
2. **cPanel "Setup Python App"**, only if the plan offers it: run `python -m ai_services.api.index` from
   `apps/api` with a Python 3.11+ virtualenv and `pip install -r ai_services/requirements.txt`. Passenger
   serves WSGI apps, not this stdlib server, so this needs a small WSGI wrapper first; not recommended.
3. **Do not deploy it.** Voice stays off and everything else works. This is the current state.

## Adding it to a deploy later (checklist)

1. Pick a host from the options above and generate a new 32+ character shared secret.
2. Set the Python variables on that host, the `AI_SERVICES_*` variables on the API host, restart the API.
3. Check `GET /health` from the API host, then send one voice message from a test account.
4. CI already builds the image and runs the Python tests (`ai-services-python` job).
