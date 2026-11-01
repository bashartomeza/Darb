# ADR-006: Invite-controlled onboarding foundation

- Status: Accepted
- Date: 2026-07-17
- Milestone: M6C2B1

> M6C2B2 follow-up: ADR-007 and the public-onboarding documents supersede the statements below that public routes are absent. The production boundary remains unchanged: public onboarding is still rejected in staging/production and no real provider or UI exists.

## Context

Darb needs controlled-beta onboarding without weakening the M6C1 account/session boundary. Public registration, passwords, account creation, operational sessions, and real SMS are deliberately deferred.

## Decision

Every future beta account requires a phone-bound, one-time invitation. Only valid Palestinian `+970` numbers and passenger, driver, or merchant roles are enabled. Admin invitation is impossible through the model/API contract. Invitation codes, OTPs, continuation tokens, phone lookup values, and idempotency keys use distinct, versioned, domain-separated HMAC keys that must also differ from JWT and refresh-token secrets.

M6C2B1 adds only the data and service foundation plus admin create/list/revoke APIs. `PUBLIC_ONBOARDING_ENABLED=true` is a startup error and no public onboarding route exists. Fake OTP delivery is injectable only in local, test, or demo; staging and production reject it. Future registration completion must create account/consent evidence atomically, return no operational session, and direct active passengers through the existing login endpoint. Pending driver/merchant status will use a separate opaque onboarding credential that operational auth never accepts.

## Consequences

The system can safely issue and operate invitations while legal documents, real SMS, password setup, and public UX remain blocked. Raw destination E.164 is retained only on the short-lived attempt because delivery/retry requires it; invitation rows keep only HMAC lookup and last four digits. Durable MySQL counters, fenced OTP dispatch claims, and version-fenced idempotency claims provide multi-process-safe foundations. M6C2B2 must not bypass these boundaries.
