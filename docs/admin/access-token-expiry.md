# Admin access-token expiry

The React admin console intentionally remains access-token only. M6C1B does not add browser refresh-token storage or a background refresh flow.

## Behavior

The shared admin API client observes authenticated requests that carry the current access token. When one returns `401` with `access_token_expired`, `invalid_token`, `invalid_session`, `session_revoked`, `session_expired`, or `missing_token`, one process-wide handler:

1. clears `darb_admin_token` from both current `sessionStorage` and legacy `localStorage`;
2. clears the in-memory token, admin identity, and all auth-derived dashboard state;
3. returns to the login screen; and
4. displays the exact localized expiry notice once.

The handler is idempotent across concurrent dashboard requests and is reset by a successful new login. Requests without a bearer token do not trigger it. Login failures, `403` responses, validation errors, and ordinary network failures retain their existing behavior. A failed `/auth/me` restore cannot continue into an authenticated render.

## Verification

Unit tests cover one-time handling across concurrent failures, both storage locations, false-positive resistance, and reset after re-login. In the browser runtime, four concurrent expired dashboard requests produced one Arabic notice, both storage entries were absent, login state was cleared, and the API received no `/auth/refresh` request. Fresh re-login then restored the Arabic dashboard.
