# Staging startup baseline

This is a provider-neutral local staging simulation, not a deployed environment. MySQL remains a separate private service and is never bundled into or exposed by the API image.

## Build and controlled migration

```powershell
docker build --target runtime -f apps/api/Dockerfile -t darb-api:local .
docker build --target migration -f apps/api/Dockerfile -t darb-migrate:local .
```

Set the values referenced by `compose.staging.yml` in the operator shell or an ignored Compose environment file. Use a dedicated, disposable `darb_staging_sim` database. `STAGING_DATABASE_URL` must point to the private Compose MySQL hostname and must not contain production credentials. Then run:

```powershell
docker compose -f compose.staging.yml run --rm migrate
docker compose -f compose.staging.yml up -d api
```

The migration is an explicit one-shot target and is not hidden in API startup. The API runtime is multi-stage, production-dependency-only, and runs as the image's unprivileged `node` user. Missing `APP_ENV=staging`, `APP_RELEASE`, database, JWT, explicit HTTPS CORS, or trust-proxy configuration makes startup fail closed.

The API binds locally at `http://127.0.0.1:3001` for simulation. Check `/api/v1/health/live` and `/api/v1/health/ready`. Demo reset, comparison, and tracking mutation routes must return `404`; protected role APIs remain registered and return `401` without authentication. Because registration/onboarding is intentionally not implemented, an authenticated staging route cannot be exercised in a clean unseeded staging database yet.

Stop with `docker compose -f compose.staging.yml down`. Add `-v` only when the operator has explicitly confirmed the local simulation database is disposable. Graceful SIGTERM has a 15-second Compose allowance; API shutdown has its existing 10-second bound.

Admin staging build:

```powershell
$env:VITE_APP_ENV='staging'
$env:VITE_ENABLE_DEMO_FEATURES='false'
$env:VITE_API_BASE_URL='https://<approved-staging-api-host>'
npm run build:admin
npm run security:artifacts -- --admin-dir apps/admin/dist
```

Mobile staging build uses `flutter build apk --release --dart-define=APP_ENV=staging --dart-define=API_BASE_URL=https://<approved-staging-api-host>`. Ordinary CI uses an invalid placeholder HTTPS host and no signing secrets.
