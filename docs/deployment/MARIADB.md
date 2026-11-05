# MariaDB migration compatibility

The Prisma migration history under `apps/api/prisma/migrations` is authored for MySQL 8 and is
immutable. MariaDB deployments use a generated copy of that history. `scripts/mariadb/translate-migrations.mjs`
only applies reviewed, deterministic rewrites and fails closed when it sees an unrecognized statement or
known MySQL-only syntax. It never edits the source migrations.

Run migrations against a MariaDB 11.4 database with:

```sh
DATABASE_URL='mysql://user:password@host:3306/database' node scripts/mariadb/migrate-deploy.mjs deploy
DATABASE_URL='mysql://user:password@host:3306/database' node scripts/mariadb/migrate-deploy.mjs status
```

The wrapper uses a unique temporary Prisma project and removes only that directory after Prisma exits. On
cPanel the deploy package includes the same wrapper under `ops/mariadb`; the normal install script invokes it
with the account's runtime environment. MySQL 8 deployments continue using the original migration history.

The `backend-mariadb` CI job runs MariaDB 11.4, applies all migrations twice, checks status, and verifies
that every migration is recorded as applied. When adding migration syntax or translation rules, keep the
source migration immutable and add a regression case to `scripts/tests/mariadb-translator.test.mjs`.
