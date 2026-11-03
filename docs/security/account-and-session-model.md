# Account and session security model

M6C1A replaces signature-only access with a server-managed trust check while preserving the existing `token` login response field. It is the identity/session foundation for the controlled beta; it does not add registration, OTP, password recovery, public onboarding, or approval workflows.

## Account status

Every user has one explicit status: `active`, `pending`, `suspended`, or `disabled`. Existing and demo users migrate to `active`, and demo reset recreates them with `security_version = 1`.

Only `active` users may log in, refresh, or use protected routes. Login rechecks role, status, and security version transactionally before persisting the session, so a concurrent suspension cannot leave a newly issued orphan credential. Correct credentials for an inactive account return `account_unavailable` without revealing the stored operational reason. Admin-safe reads may show `account_status`, `status_reason`, `status_updated_at`, and `last_login_at`.

Suspension or disablement revokes all target sessions and atomically increments `security_version`. Reactivation does not restore them; the user must log in again. An admin cannot suspend the current admin identity, and the API also prevents removing the last active admin.

## Server-managed access

All successful logins create one `AuthSession`. An access JWT contains only its user subject, role, session ID, security version, and standard issued/expiry timestamps. Signing and verification are restricted to HS256. Every protected request verifies the JWT and then loads the referenced session and user from MySQL. Access fails immediately when:

- the user is missing or not active;
- the session is missing, expired, revoked, or belongs to another user;
- the role claim no longer matches;
- the JWT, session, and user security versions do not agree.

No authentication cache is used. A database lookup per protected request is intentional at the current beta scale.

## Login and client compatibility

`POST /api/v1/auth/login` accepts the existing phone/password fields plus optional `device_name`. Its safe response includes:

- `token` and `access_token`, containing the same access JWT;
- `access_token_expires_in`;
- `refresh_token` and `refresh_token_expires_in` only for passenger, driver, and merchant logins;
- a safe session summary;
- the existing safe user summary plus account status.

Admin browser logins create revocable sessions but never receive a long-lived refresh token in JSON. The Flutter clients continue to read `token`; M6C1B added mobile refresh consumption and expiry handling.

## Admin console cookie session

The Admin console (ADR-023) sends `X-Darb-Admin-Session: 1` with every request. With that header, `POST /api/v1/auth/admin/login` and `POST /api/v1/auth/admin/google` set an HttpOnly, `SameSite=Strict`, `Path=/api/v1` cookie (`Secure` and named `__Secure-darb_admin_session` in staging and production) and return only the session summary and user, with no token in the body. Without the header they return the short Bearer access token as before, for operator tooling.

- The cookie value is a JWT bound to the session and security version and marked for cookie use only; Bearer authentication refuses it, and cookie authentication refuses ordinary access tokens.
- Each cookie request moves the session's `expires_at` to one idle timeout from now, capped at the absolute timeout from sign-in (`ADMIN_SESSION_IDLE_TIMEOUT_SECONDS`, default 1800; `ADMIN_SESSION_ABSOLUTE_TIMEOUT_SECONDS`, default 43200).
- Cookie requests must carry the session header; state-changing ones must also come from an allowed origin (`Origin`, else `Referer`, checked against the CORS rule). Otherwise the API answers `403 csrf_rejected`.
- Logout and logout-all clear the cookie; any `401` on a cookie request clears it as well.
- A Bearer header always takes precedence, so mobile authentication is unchanged.

Refresh credentials are bound to the passenger, driver, or merchant role that received them. A role change makes the earlier credential ineligible and revokes its session; role-management operations must also revoke sessions and increment `security_version`. Rotation is bounded by the absolute session expiry established at login.

## Session APIs

- `GET /api/v1/auth/sessions` lists only the authenticated user's sessions.
- `DELETE /api/v1/auth/sessions/:id` revokes only an owned session and uses safe not-found behavior for unrelated IDs.
- `POST /api/v1/auth/logout` revokes the current session and is safe to repeat while the access JWT remains otherwise valid.
- `POST /api/v1/auth/logout-all` revokes every session and increments the user security version.

Session responses allow only ID, client type, optional device name, created/last-used/expiry timestamps, current-session indication, and revoked state. They never include raw tokens, hashes, revoke reasons, IP addresses, user-agent strings, or security-version internals.

## Admin account control

`PATCH /api/v1/admin/users/:id/status` is admin-only. It accepts `active`, `suspended`, or `disabled`; suspension and disablement require a normalized reason. Status changes use serializable MySQL transactions so two admins cannot concurrently remove every active administrator; write conflicts return a safe retryable conflict. Changes record the actor, target, old/new states, reason, and request ID in an audit event. Password hashes and authentication internals are excluded from responses.

## Configuration

`ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`, and `REFRESH_TOKEN_PEPPER` are documented in every API environment template. Staging/production default to a 900-second access token, enforce a 300–1800 second range, cap refresh lifetime at 90 days, and fail closed without a non-placeholder pepper of at least 32 characters. Demo/test retain configurable demo-friendly access duration and may derive non-production refresh protection from the JWT secret.

`ADMIN_SESSION_IDLE_TIMEOUT_SECONDS` (default 1800) and `ADMIN_SESSION_ABSOLUTE_TIMEOUT_SECONDS` (default 43200) bound the Admin cookie session. Startup fails if the idle timeout exceeds the absolute one, and in staging/production unless idle is 300–3600 seconds and absolute is 3600–43200 seconds.
