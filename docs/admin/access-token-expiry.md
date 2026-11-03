# Admin session expiry

The React admin console signs in to an HttpOnly cookie session (ADR-023). It holds no token: nothing is written to `sessionStorage` or `localStorage`, and there is no browser refresh-token flow. The API slides the session forward on every request, up to 30 minutes idle and 12 hours in total by default.

## Behavior

Every request is sent with `credentials: "include"` and `X-Darb-Admin-Session: 1`, never with an `Authorization` header. Each sign-in gets an in-memory handle that feature code passes with its requests; it is not a credential, and it only lets a late failure from an earlier sign-in be ignored.

On load the console asks `/me` whether a cookie session is alive. If it is, the staff member continues signed in; if not, the sign-in screen shows without an expiry notice. Old `darb_admin_token` entries left by earlier builds are removed from both `sessionStorage` and `localStorage`.

When an authenticated request (including a file download) returns `401` with `access_token_expired`, `invalid_token`, `invalid_session`, `session_revoked`, `session_expired`, or `missing_token`, or `403 account_unavailable`, one process-wide handler:

1. clears the in-memory handle, admin identity, and all auth-derived dashboard state;
2. returns to the login screen; and
3. displays the exact localized expiry notice once.

The API also clears the cookie on such a 401. The handler is idempotent across concurrent dashboard requests and is reset by a successful new login. Requests made before sign-in do not trigger it. Login failures, other `403` responses (including `csrf_rejected`), validation errors, and ordinary network failures retain their existing behavior.

Sign-out calls `POST /auth/logout`, which revokes the server session and clears the cookie, and returns to the login screen at once even if that request is slow or fails.

## Verification

Unit tests cover the cookie-only request shape (credentials, session header, no `Authorization`), session resume on reload, purge of old stored tokens, one-time handling across concurrent failures, false-positive resistance, reset after re-login, and sign-out. API tests cover the cookie flags, sliding, idle and absolute expiry, CSRF refusals, logout, and that mobile Bearer authentication is unchanged.
