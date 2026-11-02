# MySQL backup and isolated restore

The scripts read `DATABASE_URL` from the ignored `apps/api/.env` (or `DARB_ENV_FILE`) and never place the password on the process command line. A restrictive temporary MySQL option file is deleted after each operation. Generated dumps and checksum sidecars are ignored under `backups/`.

## Backup

Install a MySQL 8-compatible `mysqldump` on `PATH`, then run:

```powershell
npm run mysql:backup
```

The command creates a timestamped SQL dump and SHA-256 sidecar. It uses a transaction-consistent InnoDB snapshot, includes triggers/events/routines, preserves binary values, and uses `utf8mb4`. Missing configuration or a dump failure returns nonzero and withholds client output to avoid credential leakage.

## Isolated restore verification

Choose a new lowercase database name beginning `darb_restore_`. The destination must not be the configured source and must be empty.

```powershell
npm run mysql:restore:verify -- -- --dump backups/mysql/<file>.sql --database darb_restore_rehearsal_yyyymmdd --confirm-isolated --cleanup
```

The command validates the checksum, refuses unsafe/non-empty destinations, creates an `utf8mb4_0900_ai_ci` isolated database, restores, checks Prisma migration status and expected Darb tables, executes a read-only connectivity check, and drops only the validated isolated database when `--cleanup` is present. Omit `--cleanup` when an operator needs to inspect a failed rehearsal; remove it manually only after confirming the name.

The second `--` shown above preserves named arguments with npm 10 on Windows. Calling `node scripts/mysql-restore-verify.mjs --dump ...` directly is equivalent.

To rehearse a forward migration against an older valid backup, add `--migrate`. The script restores first, runs the repository's approved `db:migrate` command only inside the isolated destination, and then requires current migration status:

```powershell
npm run mysql:restore:verify -- -- --dump backups/mysql/<older-file>.sql --database darb_restore_upgrade_yyyymmdd --confirm-isolated --migrate --cleanup
```

Never use `--migrate` against the configured source database; the restore tool rejects that destination.

Linux/macOS use the same Node commands when `mysql` and `mysqldump` are on `PATH`.

## Provisional controlled-beta targets

- RPO: 15 minutes.
- RTO: 2 hours.
- Provisional retention: 30 days, pending approval.
- Monthly isolated restore rehearsal.
- Future staging/production backups must be encrypted and access-limited to operational owners.

These are recovery objectives and procedures, not a claim that cloud schedules, encryption, retention, or access controls have been provisioned.
