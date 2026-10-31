# Masari application environment matrix

`APP_ENV` is the backend and Flutter product-capability boundary. `VITE_APP_ENV` is its admin-build equivalent. `NODE_ENV` and Vite modes may control framework behavior, but they do not enable Masari demo capabilities.

Demo features do not authorize destructive reset. Reset additionally requires
an exact database name in `DEMO_RESET_ALLOWED_DATABASES`; `masari` is permanently
protected, and a Serializable guard rejects any database containing a non-demo
user. Missing reset isolation configuration leaves normal API usage available
while advertising reset as unavailable.

| Environment | Demo reset | Simulation mutations | Deterministic comparison | Demo credentials/UI | URL policy |
| --- | --- | --- | --- | --- | --- |
| `local` | Disabled by default; explicit local opt-in allowed | Same as reset | Same as reset | Optional explicit build/config only | Local HTTP allowed |
| `test` | Allowed with explicit test values | Allowed | Allowed | Test fixtures only | Test URL allowed |
| `demo` | Registered | Registered | Registered | Required from untracked/build-time values | Local HTTP allowed |
| `staging` | Route absent | Routes absent | Routes absent | Prohibited | Admin/mobile API URL must use HTTPS |
| `production` | Route absent | Routes absent | Routes absent | Prohibited | HTTPS; backend CORS rejects local/wildcard origins |

Public onboarding defaults off. Only local, test, and demo may enable the M6C2B2 routes, and only with invitations, distinct keyed secrets, the injected fake provider, and a complete approved consent set. Staging and production reject public enablement, fake OTP delivery, and test legal fixtures at startup until a real provider and legal publication process are approved.

M7C1 canonical operational entry also defaults off. `MULTI_ROUTE_ENTRY_ENABLED=true` is accepted only in local, test, and demo for explicit backend validation; staging and production reject it. `MULTI_ROUTE_MATCHING_ENABLED=true` requires `MULTI_ROUTE_ENTRY_ENABLED` and is accepted only in local, test, and demo; staging and production reject it (see `apps/api/src/config.ts`). Route management remains independently controlled by `ROUTE_MANAGEMENT_ENABLED`.

Staging and production backend startup additionally require `DATABASE_URL`, a non-placeholder JWT secret of at least 32 characters, explicit `CORS_ORIGINS`, and `APP_RELEASE`. Secret-bearing validation values are never echoed.

Staging and production also require an explicit `TRUST_PROXY` topology (`none`/`0` for direct serving or a known hop count from `1` through `5`). Operational rate-limit and readiness values have validated safe defaults; production-like overrides cannot reduce them below the enforced baseline. HSTS is production-like only.

Demo-only backend values are `DEMO_RESET_KEY` and the four `DEMO_*_PASSWORD` variables. Admin and Flutter demo values are injected only into explicit demo builds. Safe examples live beside each application; completed environment files remain ignored.
