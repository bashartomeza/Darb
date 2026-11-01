# Route migration and recovery

M7B uses the forward-only MySQL migration `20260721110000_canonical_route_catalog`. Independent review adds the forward-only integrity correction `20260721170000_enforce_route_catalog_integrity`; it constrains a route's current pointer to a version owned by that route. The eight earlier migration directories, including the original M7B migration, and both frozen release tags remain unchanged.

`scripts/tests/migration-integrity.test.mjs` pins a normalized SHA-256 for every migration SQL file. This makes historical byte-content changes fail tooling/CI validation while remaining insensitive to a checkout's LF versus CRLF line endings.

## Before deploy

1. Confirm the target is the intended MySQL database and has current migration history.
2. Inspect only aggregate DriverRoute/trip/corridor counts and validate nonnegative legacy capacities.
3. Create an ignored `mysqldump` backup and SHA-256 sidecar with `npm run mysql:backup`.
4. Verify the backup into an isolated `darb_restore_*` database.

## Deploy

```text
npm run prisma:validate
npm run prisma:generate
npm run db:migrate
npm run db:migrate:status
```

Run `npm run db:migrate` a second time to prove repeatability. Do not use `db push`, edit an applied migration, drop a populated database, or seed beta routes from migration SQL.

The original migration creates `service_routes`, `service_route_versions`, `stops`, and `route_version_stops`; extends the audit enum; adds nullable DriverRoute compatibility/availability fields; backfills legacy capacity/status values; and adds Unicode tables, restrictive FKs, unique indexes, coordinate/date/sequence/capacity checks, and lookup indexes. The correction migration replaces only the current-version foreign key and adds the composite ownership keys required by that relationship.

## Historical checksum investigation

The local development database recorded a checksum for `20260717195454_onboarding_foundation` that does not match the canonical Git file or its CRLF equivalent. Git history contains one unchanged version of that migration from its original reviewed commit onward. The local row predates that first commit by about three hours, proving that this database applied an uncommitted pre-merge draft. Every other successful local migration matched the canonical files. Clean GitHub CI and a newly created disposable database applied the canonical history, and checksum-backed backups restored successfully without rewriting or resolving any historical row.

This is an isolated local-provenance outcome, not a tracked-history mutation. Do not edit or reapply the old migration, run `migrate resolve`, manually change `_prisma_migrations`, reset the populated development database, or use `db push` to conceal it. Use clean environments plus the canonical checksum guard as release evidence.

## Recovery evidence required

- Deploy all migrations from an empty `utf8mb4` database.
- Upgrade a populated eight-migration database through the integrity correction.
- Restore the pre-correction backup into an isolated database, apply the correction, and confirm current status.
- Create a post-migration backup, restore it without data loss, and remove the isolated target.
- Run the real route concurrency suite in an `_ci` or `darb_route_*` disposable database.
- Run deterministic demo reset/smoke and verify the locked metrics.

The test/demo reset deletes the new catalog in FK-safe order and recreates one exact deterministic route/version plus three canonical fixture stops. It is unavailable outside demo/test-enabled environments and does not seed production beta routes.

Rollback is application-level: disable both route flags. Schema rollback is not performed; history-bearing tables remain additive. Restore is reserved for a validated incident plan, never an automatic downgrade.
