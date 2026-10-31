# Admin invitation API

These endpoints exist only when `INVITATIONS_ENABLED=true`. They require an active admin M6C1 session, inherit request IDs/global HTTP limits, use a durable admin-generation counter, and write allowlisted audit events. When disabled, the path returns `404`.

## Create

`POST /api/v1/admin/invitations`

Body: `role` (`passenger|driver|merchant`), `phone`, `contact_email` (required: the address the one-time code is emailed to; Masari sends no SMS), optional two-letter `region`, optional `expires_in_days` (1–30), `campaign`, and `source`. International phone input beginning with `+` needs no region. Local-format input requires an explicit region. Unknown fields are rejected so arbitrary operator input cannot become a hidden PII or secret store. The phone is mandatory. A `201` response returns a safe invitation summary plus `code`; this is the only response that can contain the raw code. The response and list show the email masked (`a***@example.com`). No message, account, password, or session is created. The admin vouches for the phone/email pair, so a phone registered through an invitation counts as verified.

## List

`GET /api/v1/admin/invitations`

Filters: `status`, `role`, exact `campaign`, exact `source`, and exact `phone` with an optional region for local input. Pagination is `page` plus `limit` (maximum 50), newest first. The phone filter is normalized to canonical E.164 and HMAC-matched server-side. Results contain ID, role, country-neutral masked phone suffix, lifecycle times/status, use counts, safe campaign/source, and safe actor IDs. They never contain code, hashes, digests, raw phone, or metadata.

## Revoke

`POST /api/v1/admin/invitations/:id/revoke`

Body: required bounded `reason`. Repeating revocation is safe. A consumed invitation cannot be revoked or unconsumed. Responses use the same safe summary.
