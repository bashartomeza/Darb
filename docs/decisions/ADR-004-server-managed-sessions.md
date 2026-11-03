# ADR-004: Server-managed sessions and rotating refresh tokens

- Status: Accepted for M6C1A; the Admin browser session part is superseded by ADR-023 (Admin console cookie session)
- Date: 2026-07-17

## Context

Darb's hackathon JWTs were signature-valid for eight hours and could not be revoked before expiry. Controlled-beta identity needs immediate account suspension, per-device session revocation, logout-all, and mobile continuity without placing long-lived browser credentials in JavaScript.

## Decision

Keep short-lived JWT access tokens, but bind each token to an `AuthSession` and user `security_version`. Resolve that session and account from MySQL on every protected request. Issue one-time rotating opaque refresh tokens only to passenger, driver, and merchant sessions; store keyed HMAC digests rather than raw values. Treat reuse as session compromise and revoke the entire session.

Access JWT signing and verification are restricted to HS256. Issuer and audience claims are intentionally omitted while Darb has one API issuer and one resource-server trust domain; they must become mandatory before introducing another token issuer, resource server, or federation boundary. The live session/user/role/version checks remain authoritative for every protected request.

Admin browser logins receive only short-lived access JWTs. Admins reauthenticate after expiry until a later secure browser-session decision. Existing clients retain the `token` field, so backend rollout does not require M6C1B client refresh support in the same milestone.

## Consequences

- Suspension, session revocation, and logout-all take effect on the next request.
- Protected traffic incurs one MySQL session/user lookup and a last-used update; this is acceptable at beta scale.
- The refresh pepper becomes a required staging/production secret and must be rotated through a separately planned operational procedure.
- Concurrent use of one refresh token permits one rotation and then revokes the session as replay defense.
- A mobile session has an absolute refresh expiry established at login. Rotation never extends that boundary, and the returned replacement lifetime is capped to the remaining session lifetime.
- Session and refresh tables require forward migration, backup/restore rehearsal, indexes, and explicit cascade behavior.
- Mobile refresh handling, distributed refresh coordination, cleanup scheduling, OTP, registration, and public onboarding remain separate work.

## Alternatives rejected

Signature-only JWTs cannot provide immediate revocation. Very short JWTs without refresh harm mobile continuity. Storing raw refresh tokens increases breach impact. Browser refresh tokens in JavaScript enlarge the admin XSS credential surface. An authentication cache could delay enforcement and is unnecessary at current scale.
