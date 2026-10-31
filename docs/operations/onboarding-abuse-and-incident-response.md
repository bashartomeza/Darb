# Onboarding abuse and incident response

## Operating boundary

Keep `PUBLIC_ONBOARDING_ENABLED=false`. In staging/production use `OTP_PROVIDER=disabled` until the owner opens registration, then `OTP_PROVIDER=email` (codes are emailed over SMTP; there is no SMS). The per-day send cap (`OTP_MAX_SENDS_PER_PHONE_DAY`) applies to the phone and, separately, to the receiving email address. Store all six onboarding peppers separately, rotate by introducing a new positive version while retaining old keys only for the approved record lifetime, and never place values in tickets or logs.

Default policy: invitation seven days; OTP five minutes; resend cooldown 60 seconds; five verification attempts; three resends; five sends per phone/day. Durable counters support phone/day, IP/hour, invitation, verification, completion, and admin-generation buckets. A limit event logs only record ID, bucket type, safe status, and request ID.

## Triage

1. Disable invitations to remove admin routes if issuance is suspected.
2. Revoke affected unused invitation IDs; never request raw codes or phones in an incident channel.
3. Inspect aggregate counter/status/audit data using IDs and request IDs only.
4. If a key is suspected, disable the feature, rotate the domain-specific key/version, and invalidate affected unconsumed records.
5. Preserve database/log evidence under approved access controls; do not export raw attempt phones.
6. Confirm public routes remain `404`, fake provider remains rejected in production-like config, and operational auth rejects onboarding tokens.

Future provider incidents require webhook/signature and delivery-response procedures that B1 intentionally does not claim.
