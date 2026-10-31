# Masari deployment runbook (masari.aynur.ps)

Status: **PARKED.** Nothing here has been run. The Injazat hosting is not available yet. This runbook is the procedure to follow once it is. It complements `docs/operations/masari-aynur-ps-deployment.md` (layout and nginx sketch), `docs/operations/staging-startup.md` and `docs/operations/mysql-backup-restore.md`; where they differ, this file lists the reconciliation under "Audit findings".

Never put real secret values in this file, in git, in chat or in CI logs. Every value below is a name or a generation command.

## 1. Blockers that need the owner

Tick each before the deploy day. Nothing in the repository can unblock these.

- [ ] **Domain / DNS**: `masari.aynur.ps` A/AAAA record pointing at the Injazat host, and who controls the zone.
- [ ] **Hosting account**: Injazat server or container platform with SSH or console access, Docker (or Node 22.17.1), a private MySQL 8 instance, and persistent disk.
- [ ] **TLS certificate** for `masari.aynur.ps` (who issues and renews it).
- [ ] **SMTP / email account**: an approved sending mailbox or provider (host, port, user, password, from-address, SPF/DKIM). Configure it with the `EMAIL_DELIVERY=smtp` variables in section 4 (gap G1 is closed).
- [x] **No SMS provider is needed.** Masari sends no SMS: every one-time code is emailed through the SMTP account above (gap G2 is closed by decision; see `docs/security/email-codes-instead-of-sms.md`).
- [ ] **Android signing keystore**: owner generates and keeps the upload/release key and its passwords. See gap G4.
- [ ] **Legal text**: owner-approved Arabic and English Terms, Privacy Notice and Adult 18+ Attestation (six documents) for the consent release.
- [ ] **First admin identity**: the email address and an initial password the owner will use.
- [ ] Owner-action items EDIT-01 to EDIT-10 in the PRD register (production stays unauthorized until they are resolved).

## 2. Known gaps that need a code or config change

These were found while auditing. They are not fixed here.

- **G1 (closed) Production email delivery.** `apps/api/src/services/smtpEmailDelivery.ts` is an approved SMTP `EmailDelivery` (STARTTLS or implicit TLS, AUTH PLAIN/LOGIN, certificate verification, timeouts, header-injection protection, bilingual templates in `emailTemplates.ts`), enabled with `EMAIL_DELIVERY=smtp` and wired in `server.ts`. Email sign-up, verification and password reset/set work in staging and production once the SMTP variables below are set. Without them those endpoints still answer 503 `email_auth_unavailable` (fail-closed).
- **G2 (closed by decision) No SMS provider.** Masari will not use SMS. `OTP_PROVIDER=email` emails the onboarding code (invited and open sign-up) and the phone-step code after email sign-up through the same SMTP delivery as G1; it needs `EMAIL_DELIVERY=smtp`. `OTP_PROVIDER=fake` stays refused in staging/production. SMTP is the only delivery requirement; public onboarding (`PUBLIC_ONBOARDING_ENABLED`) may be enabled in production once `OTP_PROVIDER=email`, the onboarding peppers and the legal text exist. A phone number whose code only went to an email is stored unverified (see the trade-off document).
- **G3 No first-admin bootstrap. RESOLVED.** `npm run admin:create -w @masari/api` creates the first (or an additional) admin from a hidden password prompt, and `npm run admin:list -w @masari/api` lists admins read-only. See section 7.
- **G4 Release APK was signed with the debug key. RESOLVED.** `apps/mobile/android/app/build.gradle.kts` now signs release builds from git-ignored `android/key.properties` or `MASARI_KEYSTORE_*` environment variables and fails the build if neither is present. CI uses an explicit debug-signing opt-in. The owner must still generate the upload keystore: see `docs/mobile/ANDROID_RELEASE.md`.
- **G5 `.env.production.example` leaves `AUTH_ACTION_TOKEN_PEPPER` commented out**, but it is required for email actions and the preflight treats it as required. Uncomment it in the example.
- **G6 `compose.staging.yml` is incomplete for a real deploy.** It passes only a subset of variables (no `AUTH_ACTION_TOKEN_PEPPER`, no driver-document variables or volume) and publishes `127.0.0.1:3001`, while the production doc assumes port 3000. There is no production compose file.
- **G7 Purge command path.** `docs/operations/masari-aynur-ps-deployment.md` says `node dist/scripts/purgeDriverDocuments.js`; inside the runtime image the file is `apps/api/dist/scripts/purgeDriverDocuments.js` (working dir `/app`). Use the path in section 9.
- **G8 `.gitignore` ignores `**/.env.*`** (only `.env.example` is re-included), so `.env.production.example` and `.env.staging.example` are tracked only because they were force-added. Add negations if they are ever recreated.
- **G9 CI builds only an unsigned APK against `api.staging.masari.invalid`** and there is no CI or script for a production deploy, by design; this runbook is manual.

## 3. Prerequisites

- Node `22.17.1`, npm `>=10.9.2 <11` (see root `package.json`), or Docker with the images from `apps/api/Dockerfile` (targets `migration` and `runtime`).
- MySQL 8 reachable only from the API host; `mysql`, `mysqldump` clients on the operator machine for backups.
- A reverse proxy (nginx) terminating TLS, HTTP to HTTPS redirect.
- Flutter SDK and Android SDK on the build machine for the APK.
- A clean checkout of exactly one reviewed commit of `production-readiness`. Record the commit as `APP_RELEASE`.

## 4. Environment variables (names only)

Template: `apps/api/.env.production.example`. Keep the real file outside the repository with mode `0600`, owned by the API user. Validate it with the preflight (section 5).

Generate every secret independently (each must be at least 32 characters and unique):

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Run it once per secret and paste the result straight into the secret store, not into a shell history or chat.

### Required in production

| Variable | Purpose / rule |
| --- | --- |
| `APP_ENV` | Must be `production`. |
| `APP_RELEASE` | Immutable release identifier (commit hash or date-hash). Required. |
| `DATABASE_URL` | `mysql://<user>:<password>@<host>:3306/masari`, private host. |
| `JWT_SECRET` | Signs access tokens. 32+ chars, random. |
| `REFRESH_TOKEN_PEPPER` | Hashes refresh tokens. 32+ chars, different from `JWT_SECRET`. |
| `AUTH_ACTION_TOKEN_PEPPER` | Hashes email-action codes (verification, reset, six-digit short codes). 32+ chars, different from the two above. Generate with the command above. Needed for any email action. |
| `CORS_ORIGINS` | `https://masari.aynur.ps` (explicit https, no wildcard, no localhost). |
| `TRUST_PROXY` | Proxy hop count `1` through `5` (use `1` for one nginx), or `none`. Must be explicit. |
| `ENABLE_DEMO_FEATURES` | `false`. Any `true` aborts startup. |

### Required for specific features

| Variable | When |
| --- | --- |
| `DRIVER_DOCUMENTS_ENABLED=true`, `DRIVER_DOCUMENTS_DIR` | Driver and merchant document uploads. Directory must be absolute. |
| `DRIVER_DOCUMENT_RETENTION_DAYS` | Retention for the purge job (default 90). |
| `INVITATIONS_ENABLED=true` plus `INVITATION_CODE_PEPPER`, `PHONE_DIGEST_PEPPER`, `OTP_CODE_PEPPER`, `ONBOARDING_SESSION_PEPPER`, `IDEMPOTENCY_KEY_PEPPER`, `ABUSE_KEY_PEPPER` | Admin-issued invitations. Six distinct secrets, distinct from the core three. Each has a `*_KEY_VERSION` (default 1) for rotation. |
| `ROUTE_MAPS_ENABLED=true`, `ROUTE_PROVIDER`, `ROUTE_PROVIDER_SECRET` | Only after a map provider is approved. Otherwise `ROUTE_PROVIDER=disabled`. |
| `EMAIL_DELIVERY=smtp` plus `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM_ADDRESS` (optional `SMTP_PORT`, `SMTP_SECURE`, `EMAIL_FROM_NAME`) | Email sign-up, verification and password reset/set. All of host, user, password and from-address are required together in staging/production (startup is refused otherwise). `SMTP_SECURE` is `starttls` (default, port 587; credentials are sent only after a verified TLS upgrade) or `tls` (implicit TLS, default port 465). `SMTP_PORT` defaults from `SMTP_SECURE`. Also needs `AUTH_ACTION_TOKEN_PEPPER`. The password is never logged. Optional abuse limits: `EMAIL_CODE_RESEND_COOLDOWN_SECONDS` (default 60) and `EMAIL_CODE_MAX_PER_EMAIL_PER_DAY` (default 10) per inbox. Set SPF/DKIM/DMARC for the sender domain with your mail provider. |
| `OTP_PROVIDER=email` | Emails every one-time code through the SMTP delivery above (requires `EMAIL_DELIVERY=smtp`). Leave `disabled` while registration is off. There are no SMS settings. |

### Optional with safe defaults

`PORT` (3000), `LOG_LEVEL`, `ACCESS_TOKEN_TTL_SECONDS` (900; allowed 300-1800), `REFRESH_TOKEN_TTL_DAYS` (30; max 90), `READINESS_TIMEOUT_MS` (2000), `RATE_LIMIT_GLOBAL_WINDOW_MS`/`_MAX` (900000 / 300, max 50-1000), `RATE_LIMIT_LOGIN_WINDOW_MS`/`_MAX` (900000 / 10, max 3-50), `SUPPORTED_PHONE_REGIONS` (`PS` only), `AUTH_ACTION_TOKEN_KEY_VERSION`, and the `OTP_*` and `ONBOARDING_*` tuning values in the template.

### Must stay off or unset in production (startup is refused otherwise)

`ENABLE_DEMO_FEATURES`, `MULTI_ROUTE_ENTRY_ENABLED`, `MULTI_ROUTE_MATCHING_ENABLED`, `CANONICAL_TRIP_CREATION_ENABLED`, `CANONICAL_SHARED_TRIPS_ENABLED`, `CANONICAL_SHARED_TRIP_MOBILE_ENABLED`, `ONBOARDING_TEST_LEGAL_FIXTURES_ENABLED`, `OTP_PROVIDER=fake`, and `PUBLIC_ONBOARDING_ENABLED` unless `OTP_PROVIDER=email`, `ROUTE_PROVIDER=fake`, `GOOGLE_PASSENGER_SIGNUP_MODE` other than `disabled`, `ROUTE_PROVIDER_CACHE_TTL_SECONDS` other than `0`. Do not set any `DEMO_*` variable.

## 5. Preflight check (read-only)

```sh
node scripts/deploy/preflight.mjs --env-file /etc/masari/api.env --target production
```

It prints PASS, FAIL or WARN per item and never prints values. Exit code 1 means do not continue. It FAILs an incomplete `EMAIL_DELIVERY=smtp` configuration and WARNs when email delivery is off; it also FAILs `OTP_PROVIDER=fake`, and `PUBLIC_ONBOARDING_ENABLED=true` or `OTP_PROVIDER=email` without `OTP_PROVIDER=email` / `EMAIL_DELIVERY=smtp`. There is no SMS check any more. The API itself repeats these checks at startup (`apps/api/src/config.ts`) and refuses to start on a bad configuration.

## 6. Database creation and migrations

1. Create the database and a dedicated user (run as the MySQL admin, replacing the placeholders, choosing a generated password):

   ```sql
   CREATE DATABASE masari CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
   CREATE USER 'masari_app'@'<api-host>' IDENTIFIED BY '<generated-password>';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON masari.* TO 'masari_app'@'<api-host>';
   ```

2. Take a backup first if the database is not empty (section 12).
3. Apply **all** migrations. Never from API startup, always as an explicit step:

   ```sh
   # with the migration image
   docker run --rm --env DATABASE_URL --name masari-migrate masari-migrate:RELEASE
   # or from a checkout
   DATABASE_URL=... npm ci && npm run db:migrate      # prisma migrate deploy
   npm run db:migrate:status                          # must report "Database schema is up to date"
   ```

   `prisma migrate deploy` applies every folder in `apps/api/prisma/migrations` in order. The most recent ones, which an older database will be missing, are:
   - `20261025120000_in_app_notifications`
   - `20261025140000_incident_reports`
   - `20261025160000_driver_verification_history`
   - `20261026120000_driver_verification_evidence`
   - `20261026140000_driver_verification_documents`
   - `20261028120000_merchant_application_documents`
   - `20261028150000_auth_action_short_codes`

   Never use `prisma migrate dev` or `db push` against this database.

## 7. First admin bootstrap

Gap G3 is resolved by `npm run admin:create`. Admin sign-in is by **email and password** at `/api/v1/auth/admin/login` (phone login is blocked for admins). Run it once, from the operator machine or inside the API container, with the owner present, after migrations (section 6) and with the production environment file loaded (`APP_ENV=production`, `DATABASE_URL` from the env file).

1. Build once (`npm run build -w @masari/api`); the runtime image already contains `apps/api/dist/scripts/createAdmin.js`.
2. Dry run first. Nothing is written:

   ```sh
   npm run admin:create -w @masari/api -- --email <admin email> --name "<admin name>" --dry-run
   ```
3. Create the admin. The password is read from a **hidden prompt** (typed twice) and is never a command-line argument:

   ```sh
   npm run admin:create -w @masari/api -- --email <admin email> --name "<admin name>"
   ```

   Non-interactive alternatives, both still keeping the password out of argv and shell history: `--password-file <path>` (a file with mode 0600, delete it afterwards) or `--password-stdin`. `ADMIN_EMAIL` and `ADMIN_NAME` may replace the flags.
4. The command creates a user with role `admin`, status `active`, email verified, a bcrypt (cost 12) hash exactly as the login route expects, and writes an `admin_action` audit event (`admin_created_cli`). The password must be 16 or more characters (and at most 72 bytes); use a unique one from the owner's password manager.
5. Confirm with the read-only listing (email, status, created and last login times; no hashes):

   ```sh
   npm run admin:list -w @masari/api
   ```
6. Safety rules built into the command:
   - It refuses if the email already exists. To set a new password for an existing admin add `--reset-password`: it replaces the hash, increments `security_version`, revokes all sessions and writes an `admin_password_reset_cli` audit event.
   - It refuses to run when demo features are enabled (`APP_ENV` `demo`/`test`), when the database name is listed in `DEMO_RESET_ALLOWED_DATABASES`, or when any `demo_account` user exists. `--allow-demo-database` overrides this deliberately; never use it in production.
   - Further admins use the same command with a different email.
7. Sign in to the Admin site to confirm, and clear any password file.
## 8. Consent documents release

Registration stays closed until a complete consent release is active. In the Admin console, Settings, Consent releases (`/api/v1/admin/consent-releases`, see `docs/admin/consent-management.md`):

1. Create a draft with all six documents (Terms, Privacy Notice, Adult 18+ Attestation, in Arabic and English) using the owner-approved text. The repository contains no legal wording.
2. Review, record legal approval, then activate at or after the intended time.
3. Confirm the Settings screen shows onboarding `READY`.

## 9. Document storage (driver and merchant documents)

1. Create the directory on persistent storage outside any web root and outside the nginx `root`:

   ```sh
   install -d -m 0700 -o <api-user> -g <api-user> /var/lib/masari/driver-documents
   ```

   If the API runs in Docker, the container user is `node` (uid 1000): `chown 1000:1000` the directory and bind-mount it at the same absolute path.
2. Set `DRIVER_DOCUMENTS_ENABLED=true` and `DRIVER_DOCUMENTS_DIR=/var/lib/masari/driver-documents`.
3. Back it up together with the database and restore both at the same point in time. A database restored without the files leaves rows whose downloads return 404.
4. Schedule the daily jobs (each is safe to repeat). Run them from host cron with the same image and env file:

   | Job | Command (inside `/app`) | When |
   |---|---|---|
   | Driver document retention purge | `node apps/api/dist/scripts/purgeDriverDocuments.js` | daily |
   | Driver document expiry (reminders, restrict expired drivers) | `node apps/api/dist/scripts/checkDriverDocumentExpiry.js` | daily, early morning |
   | Driver trust score recompute | `node apps/api/dist/scripts/recomputeDriverTrust.js` | daily |
   | Passenger parcel receiver-data purge | `node apps/api/dist/scripts/purgePassengerParcelReceivers.js` | daily |

   ```sh
   docker run --rm --env-file /etc/masari/api.env -v /var/lib/masari/driver-documents:/var/lib/masari/driver-documents \
     masari-api:RELEASE node apps/api/dist/scripts/purgeDriverDocuments.js
   ```

   The expiry job is what turns an expired licence into a restricted driver and sends the 7-day reminders; without it nothing expires. Have cron mail or your monitor alert on any job that exits non-zero or stops running.
5. nginx must allow request bodies a little above 5 MB (`client_max_body_size 6m;`).

## 10. Build and run the API

```sh
docker build --target runtime   -f apps/api/Dockerfile -t masari-api:RELEASE .
docker build --target migration -f apps/api/Dockerfile -t masari-migrate:RELEASE .
```

Run the migration (section 6), then start the API bound to loopback only so it is never public:

```sh
docker run -d --name masari-api --restart unless-stopped --env-file /etc/masari/api.env \
  -p 127.0.0.1:3000:3000 -v /var/lib/masari/driver-documents:/var/lib/masari/driver-documents masari-api:RELEASE
```

The image has a health check on `/api/v1/health/ready`. Without Docker: `npm ci && npm run build:api`, then `node apps/api/dist/server.js` under a process manager (systemd) with the env file loaded.

## 11. Build and serve the Admin site

```sh
VITE_APP_ENV=production VITE_ENABLE_DEMO_FEATURES=false VITE_API_BASE_URL=https://masari.aynur.ps npm run build:admin
npm run security:artifacts -- --admin-dir apps/admin/dist
```

Copy `apps/admin/dist/` to `/srv/masari/admin` on the host. The scan must pass (no demo credentials or tools in the bundle). Do not set any `VITE_DEMO_*` variable.

### HTTPS and reverse proxy

Use the nginx sketch in `docs/operations/masari-aynur-ps-deployment.md`: `/api/v1/` proxied to `127.0.0.1:3000`, everything else served from `/srv/masari/admin` with `try_files $uri /index.html`, port 80 redirects to 443, `X-Forwarded-For` overwritten with `$remote_addr`, `client_max_body_size 6m`. `TRUST_PROXY=1` matches exactly one proxy hop. Also enable HSTS once HTTPS works (`add_header Strict-Transport-Security "max-age=31536000" always;`), keep the certificate renewal automated, and block direct access to port 3000 in the firewall.

## 12. Backups, restore and rollback

Existing tooling: `scripts/mysql-backup.mjs` and `scripts/mysql-restore-verify.mjs` (details in `docs/operations/mysql-backup-restore.md`). They read `DATABASE_URL` from `apps/api/.env` or the file named by `MASARI_ENV_FILE`, and never put the password on a command line.

Before every deploy:

```sh
MASARI_ENV_FILE=/etc/masari/api.env npm run mysql:backup        # creates backups/mysql/<timestamp>.sql and a .sha256
tar -C /var/lib/masari -czf backups/driver-documents-<timestamp>.tgz driver-documents
```

Verify a backup restores (rehearse monthly, and once before go-live), in a throwaway database, never the live one:

```sh
npm run mysql:restore:verify -- -- --dump backups/mysql/<file>.sql --database masari_restore_rehearsal_<yyyymmdd> --confirm-isolated --cleanup
```

Provisional targets from the existing doc: RPO 15 minutes, RTO 2 hours, 30 day retention (pending approval). A nightly dump alone does not meet the 15 minute RPO; enable MySQL binary logs or the host's snapshot service if that target is kept. Store backups encrypted and off the API host.

### Rollback

1. Stop writes (stop the API container or put nginx into maintenance).
2. Application only: start the previous `masari-api:<old-release>` image. The migrations are additive, so the old image runs against the newer schema; leave the tables in place.
3. Data problem: restore the pre-deploy dump into a fresh database, restore the matching documents archive, point `DATABASE_URL` at it, and start the previous image. Never restore over the live database without a fresh backup of its current state.
4. Re-run the smoke tests (section 14).

## 13. Android release build

Gap G4 is resolved in code: release builds are signed from git-ignored `apps/mobile/android/key.properties` (or `MASARI_KEYSTORE_*` environment variables) and fail without it. Generating and backing up the keystore remains an owner task; follow `docs/mobile/ANDROID_RELEASE.md` (keytool commands, Play App Signing, checklist, optional manual `release-android.yml` workflow that needs owner-added GitHub secrets).

Build (points the app at the production API; the app appends `/api/v1` itself and refuses non-HTTPS in production):

```sh
cd apps/mobile
flutter build apk --release --build-number=<N> --dart-define=APP_ENV=production --dart-define=ENABLE_DEMO_FEATURES=false --dart-define=API_BASE_URL=https://masari.aynur.ps
```

The same keys are in `apps/mobile/config/production.example.json` (`--dart-define-from-file`). The application id is `ps.masari.mobile`. Output: `apps/mobile/build/app/outputs/flutter-apk/app-release.apk`. Check `apksigner verify --print-certs` shows the release certificate, not "Android Debug".

## 14. Smoke-test checklist after deploy

Replace nothing with real credentials in this document; use the owner's admin account interactively.

- [ ] `https://masari.aynur.ps/api/v1/health/live` returns 200, and `/api/v1/health/ready` returns 200 (DB reachable).
- [ ] `http://masari.aynur.ps` redirects to HTTPS; certificate is valid and not expiring soon.
- [ ] `http://<host>:3000` is not reachable from outside.
- [ ] Admin site loads at `/`, a deep link reload works (SPA fallback), no demo controls or credential presets are visible.
- [ ] `npm run admin:create -w @masari/api -- --email <admin email> --name "<name>" --dry-run` succeeds against production (validates the guard and flags, writes nothing), and `npm run admin:list -w @masari/api` shows the bootstrap admin as `active`.
- [ ] Admin sign-in with the bootstrap account works; sign-out works; a wrong password is rejected.
- [ ] Demo endpoints are absent: the demo reset route returns 404.
- [ ] Settings shows consent onboarding `READY` after the release is active.
- [ ] A document upload (5 MB or less) from a test applicant succeeds and appears in the Admin review, and the file exists under `DRIVER_DOCUMENTS_DIR` with mode not world-readable. (Requires an applicant account; see G2.)
- [ ] Email code delivery: a registration email arrives within a minute with a six-digit code on its own line and the expiry in minutes (Arabic or English by the request locale). Repeat for password reset. A wrong `SMTP_PASSWORD` must make the request answer 503 and the code must not work.
- [ ] The APK installs, shows Arabic UI, connects to `https://masari.aynur.ps`, and the signing certificate is the release key.
- [ ] A backup was taken and a restore rehearsal passed within the last month.
- [ ] Logs contain request ids and no secrets; `APP_RELEASE` shows the expected release.

## 15. Audit findings summary

Contradictions found between existing material, now reconciled here: the staging doc binds the API to `127.0.0.1:3001` while the production doc uses 3000 (G6); the purge command path (G7); the example env comments out a pepper the code requires for email actions (G5); the production doc says registration stays off until an SMS provider exists, which is correct, but does not say that email sign-up is also unusable in production without a delivery adapter (G1, now closed by the SMTP adapter). G2 (no SMS provider) is closed: Masari sends no SMS, and every phone code goes by email through the same SMTP delivery (see `docs/security/email-codes-instead-of-sms.md`). What still blocks a public launch is owner-side: the production mail account, hosting and domain, the Android signing key, the legal texts and the first admin.
