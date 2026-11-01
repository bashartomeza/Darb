# Session revocation operations

Use session and account controls without copying credentials into terminals, tickets, logs, or screenshots. Always correlate an operation by the API `request_id` and audit event.

## User-directed revocation

An authenticated user can inspect `GET /api/v1/auth/sessions`, revoke one owned session with `DELETE /api/v1/auth/sessions/:id`, revoke the current session with `POST /api/v1/auth/logout`, or revoke all sessions with `POST /api/v1/auth/logout-all`.

After any revocation, verify the affected access token fails on the next protected request. `logout-all` also increments `security_version`, so every earlier access token fails even if a session record were restored incorrectly.

## Administrative suspension

An admin sends `PATCH /api/v1/admin/users/:id/status` with `suspended` or `disabled` and a concise operational reason. The transaction revokes all target sessions, revokes their refresh tokens, increments the target's security version, stores the normalized reason, and writes an audit event.

Reactivation uses status `active` and does not restore revoked sessions. Verify the former token still fails, then require a fresh login. The current admin cannot self-suspend, and the last-active-admin rule prevents administrative lockout.

## Suspected refresh replay

Refresh-token reuse automatically revokes the affected session. Confirm the `refresh_token_reuse_detected` audit action and advise the user to authenticate again. Do not request or collect the raw token. Escalate repeated events through the future incident-response process; M6C1A does not add notifications or automated account lockout.

## Demo and maintenance behavior

Protected demo reset deletes refresh-token records before sessions, deletes sessions before demo users, and recreates deterministic active users at security version 1. The real integration smoke ends with reset and requires zero session/token rows to prove cleanup.

There is no automated expired-session cleanup job yet. Expired rows are rejected immediately and indexed for a later bounded maintenance task. Do not delete or rewrite migration history to clean session data.

## Recovery rehearsal

Run a normal post-migration backup and isolated restore using `docs/operations/mysql-backup-restore.md`. To prove a release upgrades an older backup, use the restore tool's explicit `--migrate` option only with a safe `darb_restore_*` destination. Never run restore verification against the configured source database.
