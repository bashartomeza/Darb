# Mobile token refresh and retry

M6C1B makes the Flutter app consume the server-managed mobile session contract introduced by M6C1A. Passenger, driver, and merchant clients use the same coordinator. Admin remains a browser-only role and does not receive or store a refresh token.

## Secure token bundle

`TokenStorage` stores one JSON document under `darb_auth_bundle_v1` in `flutter_secure_storage`. Version 1 contains:

- `access_token`
- optional `refresh_token`
- authoritative `access_token_expires_at` and `refresh_token_expires_at`, calculated from the API's `*_expires_in` values when the response is received
- optional `session_id`
- `legacy_access_only`

The client does not decode JWT claims to determine expiry or identity. The API response is authoritative. A malformed, incomplete, or unsupported bundle is deleted and treated as signed out.

The former `darb_jwt` value is read only when the versioned bundle is absent. It is restored as an access-only legacy bundle, verified through `/auth/me`, and then serialized under the versioned key. Saving the new bundle precedes deleting the legacy key, so an interrupted migration retains at least one recoverable credential. Explicit logout clears both auth keys but does not clear locale storage.

## Canonical refresh coordinator

`AuthSessionCoordinator` is the only component that refreshes credentials. Every protected repository uses `AuthenticatedApiClient`, which delegates to this coordinator.

- Before an authenticated request, an access token with less than 60 seconds remaining is refreshed proactively.
- Concurrent callers await the same `_refreshFuture`; one refresh response serves all waiting requests.
- `/auth/refresh` uses the raw API client, so refresh cannot recurse through the authenticated wrapper.
- The rotated bundle is written to secure storage before it replaces the in-memory bundle.
- A refresh response must contain a refresh token and must retain the current session ID when one is known.
- Request closures rebuild their authorization header for the retry. No buffered response or stale header is reused.

## 401 policy

Only an exact `401 access_token_expired` from a protected request is eligible for refresh and one retry. A retry is never attempted twice. `403`, ordinary validation failures, and other authorization errors are returned unchanged.

The following access/session codes are terminal: `invalid_token`, `invalid_session`, `session_revoked`, `session_expired`, `account_unavailable`, and `missing_token`. A final `access_token_expired` is also terminal. Terminal state clears secure auth storage, invalidates auth-derived providers, stops polling, and routes to login with a localized reason.

Network, timeout, and server failures during refresh are retryable. They preserve the last bundle and authenticated route, display a localized status banner, and allow an explicit later retry. They do not silently continue a request with a known-expired access token.

## Routing and polling

Restoring, unauthenticated, authenticating, authenticated, refreshing, retryable-failure, restore-failed, and session-ended states are explicit. Refreshing and retryable states project to the existing authenticated role for routing, preventing a router rebuild from discarding the active screen. Terminal transitions invalidate passenger, driver, merchant, trip, and session providers; auto-disposed detail providers stop outstanding polling when their screens or authentication state end.

## Verification

Automated coverage proves version parsing, malformed-bundle cleanup, legacy migration, locale-preserving logout, six concurrent calls sharing one refresh, one exact retry, non-refreshable authorization failures, retryable refresh recovery, terminal cleanup, provider invalidation, polling disposal, and authenticated-route preservation.

On the Android emulator, session restoration survived process restart; proactive refresh succeeded for passenger, driver, and merchant roles; three concurrent merchant dashboard calls produced one refresh; an API outage preserved the screen with a retry banner and recovered after retry; invalid refresh state forced login with the exact Arabic expiry notice.
