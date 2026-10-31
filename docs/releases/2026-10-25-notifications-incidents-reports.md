# Release notes: recovery stack, notifications, incidents, reports and Admin approvals

Landed in `production-readiness` on 2026-10-25 (merge commits `b30846f` for PR #63 and `753b489` for PR #64). **Nothing is deployed.** `RELEASE_NOTES.md` stays the frozen 2026-07-13 hackathon record; this file describes what changed since.

## What is new for users

| Who | What |
| --- | --- |
| Passenger, Driver, Merchant | An in-app notification inbox (bell with unread badge, plus the Notifications tab) for offers, acceptances, trip status changes, driver-verification outcomes and incident updates. |
| Passenger, Driver, Merchant | "Report a problem" on trip screens (category and description, optionally tied to their own trip). The sheet states it is not an emergency service. |
| Merchant | A real Reports tab: own orders, parcels and deliveries by status. |
| Admin | Incidents queue with forward-only triage and notes; Reports page with a date range and CSV export (requests, orders, trips); merchant Approve/Reject on the Users page; reopening a rejected driver application with a decision history; the Overview "Active drivers", "Pending approvals" and "Incidents" cards now show real counts. |

## Recovery stack (PRs #50–#63, merged with #63)

Booking persistence and recovery after a lost response, replay-safe merchant order creation, capacity protection under contention, passenger/driver/merchant lifecycle synchronization, complete trip location names, CI baseline repairs, and hardened, session-isolated, **disabled-by-default** checkpoint directory code. Details are in each PR's description.

## Operator notes

- **Run `npm run db:migrate`.** Three additive migrations create `notifications`, `incidents` and `driver_verification_decisions`. No historical migration changed; `.gitignore` excludes `*.sql`, so new migrations must be force-added.
- **No new required configuration.** Checkpoint features stay off unless `CHECKPOINTS_ENABLED` / `CHECKPOINT_DIRECTORY_ENABLED` and their URL, file and key settings are provided; the configuration validator rejects an incomplete or placeholder setup.
- **Demo accounts sign in by email** (`demo.passenger@masari.app` and similar). New demo scripts: `npm run demo:features`, `demo:seed-approvals`, `demo:approvals`; walkthrough in `docs/demo/FEATURE_WALKTHROUGH.md`. Use only a disposable database (`masari_demo`), never `masari`.
- The legacy dispatch worker expires overdue pending requests every 30 s; the monitoring integration test's fixtures were adjusted so it no longer races that worker.

## Behavior to be aware of

- Notifications are best-effort: a failed write never fails the underlying action; duplicates are ignored. Delivery is polling only (about every 10 s while visible); there is no push, SMS or email.
- Active driver (Overview) means a verified driver with a route in service (`active`, `assigned` or `on_trip`); pending approvals are pending driver verifications; incidents counts unresolved reports. These definitions are engineering choices awaiting product confirmation.
- A rejected driver application can be reopened by an Admin only; the applicant cannot sign in to resubmit. There is still no document upload.
- Multi-route (canonical) matches do not send notifications yet.

## Not included

PDF/Excel reports or mobile file export; incident attachments, location or escalation; payments, fares or earnings; live GPS tracking; a place catalog; enabling any checkpoint provider.

## Still required before any production use

1. Revoke or rotate the historical checkpoint credential and obtain the provider's written contract and permission (owner action).
2. Human acceptance of the recovered flows and the new features.
3. Product confirmation of the metric definitions above.
4. A deployment decision; none has been made.

## Verification at release

Hosted CI (Backend/MySQL, Admin, Flutter Android, Security) passed on `753b489`. On a clean install: typecheck, API 820, Admin 379, tooling 76 and Flutter 623 tests, `flutter analyze`, `dart format`, the dependency audit policy and the secret scan. The Android emulator (Driver, Passenger and Merchant) and the Admin console in headless Chrome were exercised on pre-merge builds; the Merchant inbox, English Merchant/Driver screens and phone-width Admin were not.
