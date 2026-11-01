# Darb Hackathon MySQL Demo — Release Notes

- Release name: **Darb Hackathon MySQL Demo**
- Release date: **2026-07-13**
- Final Git reference: annotated tag **`v0.2.0-hackathon-mysql`**
- Final Git commit: resolved during packaging.
- PostgreSQL fallback: annotated tag **`v0.1.0-hackathon`**, commit `074fc4e7cc79c6b08a2baa18ca251b4802aa48c7`
- APK SHA-256: `0F9C367DEFC1A9E986E1522D2E2331962EE6E5D685B32D217FA09DB4B425B619`

## Scope freeze

Application behavior remains frozen. This release changes only the database provider boundary, provider-specific migrations/tooling, and release documentation.

## Database provider transition

- Runtime provider: MySQL Community Server 8.0.46, database `masari`, port 3306.
- Unicode: database `utf8mb4` / `utf8mb4_0900_ai_ci`; Prisma tables use `utf8mb4_unicode_ci`.
- Prisma ORM and Client remain 7.8.0.
- Runtime adapter: `@prisma/adapter-mariadb` 7.8.0 with `mariadb` 3.4.5.
- Active migration history is a fresh MySQL baseline plus an explicit long-text compatibility migration.
- PostgreSQL rows were not transferred; protected demo reset creates deterministic MySQL data.
- Approved schema command: `npm run db:migrate` (`prisma migrate deploy`).

## Implemented systems

- TypeScript/Express API with MySQL and Prisma 7.
- Protected deterministic demo reset and seeded demo identities.
- JWT login, `/me`, role authorization, and ownership isolation.
- Passenger requests, driver locked routes, merchant orders/parcels/batching, explainable combined matching, acceptance, trip lifecycle, and deterministic tracking.
- Darb versus nearest-driver deterministic comparison.
- Arabic-first React/Vite admin judge console.
- Android Flutter app for passenger, driver, and merchant roles.
- Preflight, full API smoke, runbook, eight-minute judge script, and screenshot backup.

## Supported presentation contract

- Roles: passenger, selected driver, alternate-driver isolation proof, merchant, and admin.
- Languages: Arabic default RTL; English optional LTR with persistence.
- Locked corridor: Hebron / PPU / Bab Al-Zawiya to Bethlehem.
- Architecture: local MySQL on 3306, API on localhost:3000, admin on localhost:5173, Android emulator API on 10.0.2.2:3000.
- Primary story: one passenger request plus one five-parcel merchant batch on one selected driver route and one shared trip.

## Deterministic simulation disclosure

- Tracking is simulated and polled through REST. It is not live GPS, maps, Socket.IO, or background tracking.
- Matching and comparison values are deterministic hackathon demo metrics, not production routing, prices, or city-wide measured outcomes.
- Expected proof: score `0.9317`; sequence `2`; trips `1` versus `6`; distance `21.53` versus `129.19`; cost `43.06` versus `258.38`; winner `masari`.

## Validation summary

- API: 6 files / 60 tests passed after MySQL migration; workspace typecheck and build passed.
- Admin: 1 file / 7 tests passed; typecheck and production build passed unchanged.
- Mobile: 62 tests passed with clean analysis and formatting; no APK rebuild was required because the API URL/contract did not change.
- Existing validated debug APK installed, launched Arabic-first, and logged the passenger into the real MySQL-backed API.
- Fresh migration applied to the confirmed-empty dedicated MySQL target; repeated deploy reported no pending migrations.
- Five protected reset audits returned identical counts with zero mutable duplicates.
- Arabic and emoji text round-tripped through the real passenger API and MySQL, then reset cleanly.
- Five full cross-role MySQL rehearsals returned the frozen score, sequence, trips, distance, cost, winner, and reset recovery.
- Final preflight passed 12/12 and verifies MySQL provider/connectivity/Unicode without revealing environment values.
- Exact package/ZIP checksums and final commit are recorded in the packaged checksum manifest.

## Known limitations

- Local MySQL, API, Vite, and Android emulator infrastructure are required.
- This release does not transfer existing PostgreSQL rows.
- No AI parser, live GPS, maps, payments, public registration, multi-city support, app-store delivery, or production deployment is implemented.
- The release uses a debug APK for the local hackathon presentation.
- Three moderate findings remain through Prisma CLI transitive `@hono/node-server`. The breaking `npm audit fix --force` downgrade was not applied.

## Startup requirements

Follow `MYSQL_MIGRATION.md` and `README_DEMO_START.md`, then require `npm run demo:preflight` and `npm run demo:smoke` success before judges arrive. The full operational procedure is in `DEMO_RUNBOOK.md`; presenter cues are in `JUDGE_SCRIPT.md`; fallback is in `BACKUP_DEMO.md`.

- Security follow-up: updated the existing fast-uri override to 3.1.8 to address current patched 3.x advisories without a Prisma downgrade.

## CI remediation update

The latest CI pass identified and corrected a backend Admin test-fixture authorization mismatch and a Flutter formatter-only failure caused by missing final newlines. Dependency remediation also pins `fast-uri` at `3.1.8`.

