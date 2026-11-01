# Darb — درب

Formerly named Darb; technical identifiers (package ids, database, domain) still use masari until migrated.

Darb is a Palestine-focused, Arabic-first smart route-sharing logistics application for the Hebron / PPU / Bab Al-Zawiya to Bethlehem corridor. The repository contains the Express/Prisma API, Flutter mobile application, and React/Vite admin dashboard.

## Prerequisites

- Node.js `22.17.1`
- npm `10.9.2` (or another `>=10.9.2 <11` release)
- MySQL reachable through `DATABASE_URL`
- Flutter with a Dart SDK compatible with `apps/mobile/pubspec.yaml` (`^3.12.2`)

## Backend and database

```bash
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env and replace placeholders with local values.
npm install
npm run prisma:validate
npm run prisma:generate
npm run db:migrate
npm run dev:api
```

The API listens on `PORT` (default `3000`) and exposes the existing `/api/v1` routes. The API also starts the legacy dispatch worker automatically; it expires stale legacy matches and overdue passenger/merchant demand and restores any held legacy capacity.

## Admin dashboard

In a second terminal:

```bash
cp apps/admin/.env.example apps/admin/.env.local
npm run dev:admin
```

For a production build:

```bash
npm run build:admin
```

## Flutter mobile application

For an Android emulator, the example local config already points at `10.0.2.2:3000`:

```bash
cd apps/mobile
cp config/local.example.json config/local.local.json
flutter pub get
flutter run --dart-define-from-file=config/local.local.json
```

For Chrome, change `API_BASE_URL` in the ignored local config to `http://localhost:3000` before running Flutter.

## Validation

With dependencies installed and MySQL configured:

```bash
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run test
npm run build
npm run security:scan

cd apps/mobile
flutter analyze
flutter test
```

Database-backed integration suites require a disposable MySQL database whose name follows the safeguards documented by the individual integration scripts.

Production HTTP controls, request IDs, proxy topology, and health/readiness contracts are documented in `docs/security/http-security-baseline.md`, `docs/operations/logging-and-request-ids.md`, and `docs/operations/health-and-readiness.md`.

`npm audit fix --force` is intentionally prohibited because the repository documents breaking dependency implications for forced audit remediation.
