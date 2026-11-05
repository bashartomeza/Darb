# Data retention

Everything that only grows has a stated retention. Purges run once a day from `deploy/cpanel/ops/jobs.sh`
(cron, 02:40) as separate jobs, so one failing job does not stop the others. Each purge deletes in
batches of 1000 rows by primary key (with a short pause between batches) and stops after 500 batches per
run, so it never holds a long lock; the next day's run continues. All are safe to repeat.

Manual run (same settings as production): `node ops/run.mjs node dist/scripts/purgeLocationEvents.js` and
`node ops/run.mjs node dist/scripts/purgeExpiredData.js` (locally `npm run retention:locations` and
`npm run retention:expired` in `apps/api`). Windows are days and are validated at start-up.

| Data (table) | Why kept | Default retention | Config var | Purged by |
| --- | --- | --- | --- | --- |
| Live driver GPS points (`location_events`) | Shown live during a trip; short support window afterwards | 30 days, finished trips only (1-365). The latest point of a trip is kept for 24 h after the trip ends. Points of trips still running are never deleted. | `LOCATION_RETENTION_DAYS` | `purgeLocationEvents` |
| Sign-in sessions and refresh tokens (`auth_sessions`, `refresh_tokens`) | Reuse detection and "where am I signed in" | Deleted 30 days after they expired or were revoked (1-365) | `SESSION_RETENTION_DAYS` | `purgeExpiredData` |
| Email codes, reset and verification links (`auth_action_tokens`) | Single use, short lived | Deleted 7 days after expiry or use (1-365) | `AUTH_TOKEN_RETENTION_DAYS` | `purgeExpiredData` |
| Idempotency claims (`idempotency_records`) | Safe client retries | Unfinished or failed claims deleted 7 days after expiry (1-365). Completed claims are kept: booking replays rely on them. | `IDEMPOTENCY_RETENTION_DAYS` | `purgeExpiredData` |
| Abuse and rate-limit counters (`abuse_counters`) | Throttling windows | Deleted 1 day after the window expired (1-365) | `ABUSE_COUNTER_RETENTION_DAYS` | `purgeExpiredData` |
| Push devices (`push_devices`) | Delivering pushes | Revoked rows deleted after 30 days (1-365); active devices are kept | `PUSH_DEVICE_RETENTION_DAYS` | `purgeExpiredData` |
| In-app notifications (`notifications`) | User inbox | 180 days (1-3650) | `NOTIFICATION_RETENTION_DAYS` | `purgeExpiredData` |
| Driver and merchant documents (`driver_verification_documents`, `merchant_application_documents`) | Verification evidence | 90 days after the decision | `DRIVER_DOCUMENT_RETENTION_DAYS` | `purgeDriverDocuments` (existing) |
| Passenger parcel receiver details | Delivery | Erased 14 days after the departure window ends | none | `purgePassengerParcelReceivers` (existing) |
| Unresolved AI requests (`uncertain_ai_requests`) | Improving the assistant; redacted text, no user id | 30 days, removed by the service itself on each new insert | none | in the service (existing) |
| Assistant history (`passenger_assistant_*`) | Conversation context | Already capped per conversation | none | in the service (existing) |
| **Audit events (`audit_events`)** | Security and accountability record | **Kept. Never purged automatically.** | none | none |
| **Consents, onboarding attempts, invitations, ratings, incidents, trips, orders, parcels, trust scores** | Legal, financial or safety relevance | **Kept.** Any deletion needs an owner and legal decision | none | none |
| Demo tables (`demo_scenarios`) | Static scenario definitions | Kept (tiny); demo databases are cleared by the demo reset | none | none |

Notes

- Retention shortens only what is stored; it does not change what the API returns for current data.
- Deleting a session also detaches its push devices (the device row stays until its own window).
- Raising a window is always safe; lowering it deletes the extra rows at the next run.
- Indexes added for the purge queries (`location_events.recorded_at`, `notifications.created_at`,
  `abuse_counters.expires_at`) are in migration `20261113120000_data_retention`.
- Live tracking itself is controlled by `LIVE_TRACKING_ENABLED` (default on everywhere, including
  production); see `docs/api/live-location.md`.
