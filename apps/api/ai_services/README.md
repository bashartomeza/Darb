# ai_services - Darb dispatch AI (Python)

Internal compute service. The Node API (`apps/api/src`) owns auth, the database,
PII redaction and the place catalog; this package owns NLP, the safety firewall,
the confidence gates and the UI-directive generator. They talk over one internal
HTTP hop (`/v1/analyze`, `/v1/voice`) protected by a shared secret.

Product rules it follows:

- The places a user typed are returned exactly as typed. Landmark matching (optional,
  `AI_SERVICES_LANDMARK_HINTS=overpass`) only adds `meta.landmark_hints`; it never rewrites.
- Routes are Darb's predefined operating routes (`GET /api/v1/operating-routes`, keys like
  `hebron-to-bethlehem`). The caller may send `routes` with `/v1/analyze`
  (`[{key, origin_ar, destination_ar}]`) and gets `meta.route_hint` back. No city, route or fare
  table is built in; fares are inputs to `logistics_math.enforce_route_based_fare`.
- Every request has a total time budget (`AI_SERVICES_TEXT_BUDGET_SECONDS`, default 12;
  `AI_SERVICES_VOICE_BUDGET_SECONDS`, default 45). When it runs out, text falls back to the offline
  heuristic (low confidence, so a human reviews it) and voice answers 503.
- A confidence that is NaN, infinite or not a number counts as 0.0 and goes to human review.

Deployment: see `docs/deployment/AI_SERVICE.md`. Tests: `python -m pytest -q ai_services/tests`
from `apps/api` (install `requirements-dev.txt`).
