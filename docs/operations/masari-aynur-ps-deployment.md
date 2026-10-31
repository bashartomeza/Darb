# Deploying to masari.aynur.ps (Injazat, server storage)

This is a deployment plan, not evidence of a deployment. Nothing here has been run on the Injazat host. Production deployment stays not authorized until the owner-action items in the PRD register (EDIT-01 to EDIT-10) are resolved by their owners.

## Layout: one origin

Everything is served from `https://masari.aynur.ps`:

| Path | Served by |
| --- | --- |
| `/api/v1/*` | the API container (`apps/api/Dockerfile`, target `runtime`), listening privately on port 3000 |
| everything else | the built Admin console (`apps/admin/dist`), as static files with a fallback to `index.html` |

One origin means the Admin console and the API share a site, so no cross-origin setup is needed beyond the explicit allow-list the API already requires (`CORS_ORIGINS="https://masari.aynur.ps"`). The mobile app uses the same base URL; the app appends `/api/v1` itself.

TLS terminates at the reverse proxy in front of both. HTTP must redirect to HTTPS, and the API must never be reachable on a public port directly.

## Configuration

API (`apps/api/.env.production.example` is the template; never commit real values):

- `APP_ENV=production`, `ENABLE_DEMO_FEATURES=false`, `APP_RELEASE=<immutable release id>`
- `CORS_ORIGINS=https://masari.aynur.ps`
- `TRUST_PROXY=1` when exactly one proxy sits in front (use the real hop count; the API refuses to start without an explicit value)
- `DATABASE_URL` to a private MySQL 8 host, plus `JWT_SECRET`, `REFRESH_TOKEN_PEPPER` and the other secrets as separate random values of at least 32 characters
- Registration stays off (`PUBLIC_ONBOARDING_ENABLED=false`, `OTP_PROVIDER=disabled`) until the legal text exists and the owner opens it; there is no SMS provider to wait for (Masari emails its codes: `OTP_PROVIDER=email` with the SMTP delivery)

Admin build:

```powershell
$env:VITE_APP_ENV='production'
$env:VITE_ENABLE_DEMO_FEATURES='false'
$env:VITE_API_BASE_URL='https://masari.aynur.ps'
npm run build:admin
npm run security:artifacts -- --admin-dir apps/admin/dist
```

Mobile release build: `flutter build apk --release --dart-define=APP_ENV=production --dart-define=API_BASE_URL=https://masari.aynur.ps`, signed with the owner's release key.

## Reverse proxy sketch (nginx)

```nginx
server {
  listen 443 ssl http2;
  server_name masari.aynur.ps;
  # ssl_certificate / ssl_certificate_key: the host's certificate for masari.aynur.ps

  client_max_body_size 6m;            # driver documents are limited to 5 MB

  location /api/v1/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
  }

  location / {
    root /srv/masari/admin;           # contents of apps/admin/dist
    try_files $uri /index.html;
  }
}
server { listen 80; server_name masari.aynur.ps; return 301 https://$host$request_uri; }
```

`X-Forwarded-For` is overwritten with `$remote_addr` so a client cannot spoof its address into the API's rate limits.

## Driver documents on server storage

1. Create a directory on persistent storage, outside the proxy's `root`, for example `/var/lib/masari/driver-documents`, owned by the API user with mode `0700`.
2. Mount it into the API container at the same absolute path and set `DRIVER_DOCUMENTS_ENABLED=true` and `DRIVER_DOCUMENTS_DIR=/var/lib/masari/driver-documents`.
3. Include the directory in the same backup job as the database; restore both together. A database restored without its files leaves rows that point at missing files (downloads return 404).
4. Schedule the retention purge daily, for example from cron on the host: `docker compose run --rm api node dist/scripts/purgeDriverDocuments.js` (or the equivalent for the platform). It is safe to repeat.
5. Schedule the document-expiry check daily (early UTC morning is fine), for example `docker compose run --rm api node dist/scripts/checkDriverDocumentExpiry.js`. It sends the 30 and 7 day reminders and restricts drivers whose recorded documents ran out. It is idempotent; if a day is missed the next run catches up. Without this job, expiry dates are recorded but nothing is enforced.

## Release order

1. Build the images and the Admin bundle for one commit; record the commit and tree in `docs/qa/EVIDENCE_INDEX.md`.
2. Back up the database.
3. Run the migration image once (`prisma migrate deploy`); do not run migrations from API startup.
4. Start the API, then check `/api/v1/health/live` and `/api/v1/health/ready` through the public URL.
5. Publish the Admin bundle.
6. Roll back by stopping writes, restoring the previous images, and keeping the additive tables in place (see the rollback notes in `docs/admin/driver-verification.md`).

## Still the owner's to confirm

Provider and credential items (EDIT-01 to 09), exact-head release verification (EDIT-10), the 90-day document retention, the legal text before registration is opened, and who holds the TLS certificate and DNS for `masari.aynur.ps`.
