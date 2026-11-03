# ADR-005: Client refresh coordination

- Status: Accepted; the Admin console paragraph is superseded by ADR-023 (Admin console cookie session)
- Date: 2026-07-17
- Milestone: M6C1B

## Context

M6C1A introduced server-managed sessions, short-lived access tokens, and one-time rotating refresh tokens for mobile roles. Multiple Flutter repositories and polling loops can issue authenticated requests concurrently. Independent refresh logic would risk replaying a one-time token, multiplying network calls, overwriting a newer rotated bundle, or retrying authorization failures that must remain final. The admin browser deliberately receives no refresh token.

## Decision

Flutter has one `AuthSessionCoordinator` shared by all authenticated repositories.

- API-provided expiry durations are authoritative; the client does not inspect JWT claims.
- A protected request refreshes proactively when the access credential has less than 60 seconds remaining.
- A single in-flight future coordinates all refresh waiters.
- The refresh endpoint bypasses the authenticated request wrapper.
- Secure persistence of the complete replacement bundle happens before the in-memory swap.
- Only exact `access_token_expired` receives one refresh-and-retry attempt.
- Transient network, timeout, and server refresh failures preserve credentials for explicit retry.
- Invalid, revoked, expired, replayed, account-unavailable, or malformed refresh state clears the bundle and all auth-derived client state.
- Auth routing retains the last authenticated role during refresh/retryable state; terminal state ends polling and returns to login.

The admin console does not refresh. It treats terminal access-session 401 codes as one localized expiry event, clears both current and legacy browser token storage, and requires a new login.

## Consequences

One-time token rotation remains compatible with concurrent Flutter screens and polling. Retry behavior is deliberately narrow and testable. Temporary API outages do not destroy a recoverable mobile session, while known-invalid state cannot continue. All mobile feature repositories must use `AuthenticatedApiClient`; direct protected calls would bypass this invariant.

The coordinator is process-local. It does not coordinate simultaneous refreshes from two independent app processes using the same session; the server's replay defense remains authoritative for that case. Browser refresh and a cookie-based admin session design remain outside this milestone.

## Evidence

Local validation passed 134 API tests, 15 admin tests, and 100 Flutter tests. Real MySQL session integration, emulator and browser scenarios, deterministic smoke, 22/22 preflight, and production-like admin/APK artifact scans passed. On implementation head `e00c2e9cf3134cae9067df7b0b3ffbcaab2d1aec`, GitHub Actions passed Admin CI run `29581217388`, Backend and MySQL CI run `29581217465`, Flutter Android CI run `29581217302`, and Security and Configuration CI run `29581217392`.
