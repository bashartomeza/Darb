# ADR-023: Admin console cookie session

- Status: Accepted (owner decision, 2026-11-03)
- Date: 2026-11-03
- Supersedes: the admin parts of ADR-004 ("Admins reauthenticate after expiry until a later secure browser-session decision") and ADR-005 ("The admin console does not refresh")

## Context

ADR-004 gave Admin browser logins only a short access JWT (900 s by default, at most 1800 s in staging and production) and kept it in `sessionStorage`. Staff were signed out every 15 to 30 minutes even while working. ADR-004 and ADR-005 rejected a JavaScript-readable refresh token for the Admin console because a script injected into the console (XSS) could read and export it, and named a secure browser session as the follow-up. The owner has chosen that follow-up.

In production the console and the API are served from one origin (`https://darb.aynur.ps`, API under `/api/v1`), so they are always the same site. In local development they are `http://localhost:5173` and `http://localhost:3000`, which are also the same site.

## Decision

The Admin console signs in to a server-side `AuthSession` whose credential is an HttpOnly cookie.

- **Sign-in.** `POST /auth/admin/login` and `POST /auth/admin/google` set the cookie when the request carries `X-Darb-Admin-Session: 1`, which the console sends on every request. The response body then has the session summary and user only: no `token`, `access_token` or refresh token. Without that header the endpoints behave as before (short Bearer access token, no refresh token), which keeps operator scripts and smoke checks working.
- **Cookie.** `HttpOnly`; `SameSite=Strict`; `Path=/api/v1`; `Secure` with the `__Secure-` name prefix in staging and production (`darb_admin_session` without it on plain-http local and demo runs); `Max-Age` equal to the absolute limit. Strict is enough because the console and the API share one site; Lax was not needed.
- **Cookie value.** A JWT bound to the session ID and the user's security version, with a `use: "admin_cookie"` claim and a lifetime equal to the absolute limit. Bearer authentication refuses tokens carrying that claim and cookie authentication accepts nothing else, so neither credential can stand in for the other. Every request still loads the session and user from MySQL, so suspension, logout, logout-all and security-version changes take effect on the next request exactly as in ADR-004.
- **Sliding expiry.** Each authenticated cookie request sets the session's `expires_at` to `min(now + idle timeout, created_at + absolute timeout)`. `ADMIN_SESSION_IDLE_TIMEOUT_SECONDS` defaults to 1800 (30 minutes without a request ends the session) and `ADMIN_SESSION_ABSOLUTE_TIMEOUT_SECONDS` to 43200 (12 hours after sign-in the session ends regardless of activity). Startup fails if idle exceeds absolute, and in staging and production unless idle is 300 to 3600 and absolute is 3600 to 43200. No schema change: the existing `expires_at`, `created_at` and `last_used_at` columns carry it.
- **CSRF.** A cookie-authenticated request must carry `X-Darb-Admin-Session: 1`, and a state-changing one (anything but GET, HEAD, OPTIONS) must also name an allowed origin in `Origin` (or, failing that, `Referer`); a request naming no origin is refused. The cookie sign-in itself is checked the same way (login CSRF). Allowed origins are the CORS rule: the explicit `CORS_ORIGINS` list, plus any loopback port outside staging and production. Failures return `403 csrf_rejected`. We chose a required custom header plus origin check over a double-submit token because it needs no token state in the browser or the server: a cross-site form, link or image cannot set a custom header, and a cross-site `fetch` that sets one triggers a CORS preflight that only allowed origins pass. The origin check is defence in depth should a preflight ever be skipped (a browser defect or a CORS misconfiguration), and `SameSite=Strict` is a third layer.
- **CORS.** Credentials are allowed only for allowed origins (in production only the explicit `CORS_ORIGINS`); other origins get no CORS headers at all. `DELETE` and the session header are in the allowed methods and headers.
- **Logout.** `POST /auth/logout` revokes the session as before (#139) and clears the cookie. `logout-all` also clears it. Any 401 on a cookie request (expired, revoked, invalid) clears the cookie too.
- **Console.** Every request uses `credentials: "include"` and the session header and never sends `Authorization`. Nothing is written to `sessionStorage` or `localStorage`; old `darb_admin_token` entries are purged at start-up. On load the console asks `/me` whether a cookie session is alive and resumes it; otherwise it shows the sign-in screen without an expiry notice. A terminal 401 during use shows the existing sign-in screen with the expiry notice.
- **Mobile.** Unchanged. A Bearer header always wins over the cookie, mobile requests need no CSRF header, and their sessions do not slide.

## Consequences

- Staff stay signed in while active, up to 12 hours, and an idle console ends after 30 minutes.
- A script injected into the console can still act as the signed-in admin while the page is open (no browser design prevents that), but it cannot read or export a credential for later use.
- The console and the API must stay on the same site (same registrable domain and scheme). A future split onto unrelated domains would make the cookie third-party, and browsers would drop it; that change needs a new decision.
- The console's API base URL must be an origin listed in `CORS_ORIGINS`, or cookie state changes are refused.
- Each cookie request costs the same one session lookup and one update as before; the update now also writes `expires_at`.
- The Admin sign-in endpoints still issue a short Bearer token to clients that do not send the session header. Whether to turn that off in production once operator tooling has moved is left open.

## Alternatives rejected

A JavaScript-readable refresh token (the XSS exposure ADR-004 rejected). A double-submit CSRF token (more moving parts for no gain over a custom header with an origin check on one site). `SameSite=Lax` (not needed on one site, and weaker). An opaque random cookie with a new hashed column (a migration for the same guarantees the bound, purpose-marked JWT already gives with the server-side session check).
