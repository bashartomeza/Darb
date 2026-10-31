# Masari Demo Start Card

Database provider: MySQL 8.0.46 on local port 3306, dedicated disposable database `masari_demo`, using `utf8mb4`. The real/pilot `masari` database is permanently ineligible for demo reset.

## URLs

- API: `http://localhost:3000`
- Admin: `http://localhost:5173`
- Android emulator API embedded in APK: `http://10.0.2.2:3000`

## Safe local environment

Set real local values in the PowerShell session only. Never add them to this file or the release package.

```powershell
$env:DATABASE_URL = "mysql://<user>:<password>@localhost:3306/masari_demo"
$env:DEMO_RESET_ALLOWED_DATABASES = "masari_demo"
$env:APP_ENV = "demo"
$env:JWT_SECRET = "<at-least-32-random-characters>"
$env:DEMO_RESET_KEY = "<local-demo-reset-key>"
$env:DEMO_PASSENGER_PASSWORD = "<local-demo-passenger-password>"
$env:DEMO_DRIVER_PASSWORD = "<local-demo-driver-password>"
$env:DEMO_MERCHANT_PASSWORD = "<local-demo-merchant-password>"
$env:DEMO_ADMIN_PASSWORD = "<local-demo-admin-password>"
$env:CORS_ORIGINS = "http://localhost:5173,http://localhost:5174,http://localhost:5175,http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175"
$env:TRUST_PROXY = "none"
$env:PORT = "3000"
```

## Startup

1. Start MySQL and confirm local port 3306 and the disposable `masari_demo` database. Never use `masari` for a demo rehearsal.
2. Run `npm install`, `npm run prisma:validate`, `npm run prisma:generate`, and `npm run db:migrate`.
3. Terminal A: set the environment above, then run `npm run dev:api`.
4. Terminal B: set `VITE_APP_ENV=demo`, `VITE_ENABLE_DEMO_FEATURES=true`, `VITE_API_BASE_URL=http://localhost:3000`, and the matching `VITE_DEMO_ADMIN_PHONE`, `VITE_DEMO_ADMIN_PASSWORD`, and `VITE_DEMO_RESET_KEY` values; then run `npm run dev:admin`.
5. Copy `apps/mobile/config/demo.example.json` to the ignored `demo.local.json`, replace its placeholders with the matching local demo values, and run `flutter build apk --debug --dart-define-from-file=config/demo.local.json` from `apps/mobile`.
6. Cold-boot AVD `Medium_Phone_API_36.0` and install the resulting `app-debug.apk`.
7. Run `npm run demo:preflight` and require every check to pass.
8. Run `npm run demo:smoke` and require `"ok":true`. Then run `npm run demo:features` (notifications, incident reports, reports/export and dashboard counts, end to end over HTTP) and require `"ok":true`; it resets the disposable database first.
9. Run one protected reset and open `JUDGE_SCRIPT.md`.

## Fast recovery

- API down: restart `npm run dev:api`, verify health, then Retry/Refresh.
- Vite down: run `npm run dev:admin` and reopen port 5173.
- Uncertain disposable demo data: protected reset, then smoke—never point reset tooling at the real/pilot `masari` database.
- MySQL migration failure: stop, inspect `npm run db:migrate:status`, and do not use `db push` or reset a non-empty database.
- Live surface unavailable after two minutes: use `BACKUP_DEMO.md` and packaged screenshots.
