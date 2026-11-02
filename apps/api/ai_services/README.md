# ai_services - Masari dispatch AI (Python)

Internal compute service. The Node API (`apps/api/src`) owns auth, the database,
PII redaction and the place catalog; this package owns NLP, logistics math,
the tool agent and the UI-directive generator. They talk over one internal HTTP
hop (`/v1/analyze`, `/v1/voice`) protected by a shared secret.

