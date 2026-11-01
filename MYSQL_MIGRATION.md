# Darb MySQL Migration Guide

This branch runs Darb on MySQL while preserving the PostgreSQL release at tag `v0.1.0-hackathon`.

## Validated database target

- Provider: MySQL.
- Observed version: MySQL Community Server 8.0.46.
- Host requirement: a local or explicitly trusted MySQL host reachable by the API machine.
- Port: 3306.
- Database name: `masari`.
- Required character set: `utf8mb4`.
- Validated collation: `utf8mb4_0900_ai_ci` at database level; Prisma-created tables use `utf8mb4_unicode_ci`.
- Migration 18 installs integrity triggers. On hosts with binary logging enabled, the
  database administrator must enable `log_bin_trust_function_creators=1` (or grant
  an equivalent reviewed capability) before `prisma migrate deploy`; the application
  database user does not require `SUPER`.

The database must be empty and dedicated to Darb before the first migration. Do not point this branch at an existing non-empty database without a separate reviewed data-migration plan.

## Safe environment

Copy `apps/api/.env.example` to the ignored `apps/api/.env` file and replace placeholders locally. Never commit or package the completed file.

```dotenv
APP_ENV="local"
ENABLE_DEMO_FEATURES="false"
DATABASE_URL="mysql://<user>:<password>@localhost:3306/masari"
JWT_SECRET="<at-least-32-random-characters>"
CORS_ORIGINS="http://localhost:5173"
```

This is a normal local configuration with demo capabilities disabled. Use the separate ignored values represented by `apps/api/.env.demo.example` only for the isolated deterministic rehearsal.
The real/pilot `masari` database is permanently ineligible for demo reset. The
demo example instead uses `masari_demo` plus an exact
`DEMO_RESET_ALLOWED_DATABASES=masari_demo` opt-in.

## Apply the schema

From the repository root:

```powershell
npm install
npm run prisma:validate
npm run prisma:generate
npm run db:migrate
npm run db:migrate:status
```

`npm run db:migrate` uses `prisma migrate deploy`. It applies the checked-in MySQL migration history and is the approved schema command for this release. `db push` is not the release mechanism.

## Provider transition

- The old PostgreSQL SQL is retained in Git history and the `v0.1.0-hackathon` tag.
- The active MySQL branch has a fresh provider-specific baseline and a follow-up migration preserving PostgreSQL-like text capacity for explanations and descriptions.
- PostgreSQL rows are not copied. The protected demo reset creates deterministic MySQL demo data.
- Do not apply PostgreSQL migration SQL to MySQL or edit committed migration files.

## Verification

With API, admin, and emulator running against the isolated `masari_demo`
configuration (never the real/pilot `masari` database):

```powershell
npm run demo:preflight
npm run demo:smoke
```

Preflight verifies required environment presence without displaying values, MySQL provider/connectivity, `utf8mb4`, database collation, Darb service identity, URL consistency, APK presence, and Android device readiness.

## Fallback

To return to the preserved PostgreSQL release, use a separate checkout or worktree at `v0.1.0-hackathon`. Do not move that tag and do not mix its PostgreSQL migrations with this branch.
