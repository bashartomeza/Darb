# Public onboarding feature gate

`PUBLIC_ONBOARDING_ENABLED` defaults to `false`. Disabled mode leaves only the safe config endpoint registered. Enabled mode additionally requires `INVITATIONS_ENABLED=true`, `OTP_PROVIDER=email` (with `EMAIL_DELIVERY=smtp`; the only provider allowed in staging/production) or `OTP_PROVIDER=fake` (local, test and demo only), all distinct onboarding peppers, and a distinct idempotency-payload pepper.

Staging and production reject public enablement, fake delivery, and test legal fixtures during configuration parsing. They remain disabled until an approved real provider is implemented. The config response never identifies the provider or environment. It reports enabled only when all three legally approved, current documents exist in both Arabic and English.

Local validation uses ignored secrets only. Never commit `.env`, test OTPs, provider outboxes, credentials, or legal fixtures. Production templates intentionally keep the feature disabled.

## Open driver and shop-owner registration

`OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED` (default `false`) lets drivers and shop owners register without an invitation code. It needs `PUBLIC_ONBOARDING_ENABLED=true` and `DRIVER_DOCUMENTS_ENABLED=true`, so it inherits every restriction above and cannot be enabled in staging or production. See `docs/admin/driver-verification.md` for the flow, the server-side document requirement and the abuse limits.
