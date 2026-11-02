# Dependency security remediation

Darb keeps Prisma, `@prisma/client`, and `@prisma/adapter-mariadb` aligned at
7.9.1. Those packages currently pin vulnerable transitive releases: the
adapter pins `mariadb` 3.4.5, Prisma pins `mysql2` 3.15.3, and Prisma's local
tooling reaches `fast-uri` through AJV. Express and its body-parser dependency
reach `qs` 6.15.3.

The root overrides select patched releases. In particular, MariaDB and mysql2
override upstream **exact pins**, so these are locally verified compatibility
bridges, not versions declared compatible by those upstream pins:

- `mariadb` 3.4.7 fixes the 3.4.x advisory range while the adapter has not yet
  updated its exact 3.4.5 dependency in the selected 7.9.1 adapter.
- `mysql2` 3.23.1 fixes both Prisma-pinned advisories (including the
  decompression issue fixed after 3.23.0) without downgrading Prisma.
- `fast-uri` 3.1.8 is pinned as the current patched 3.x release for the AJV-supported dependency path.
- `qs` 6.16.0 fixes the Express/body-parser-supported 6.x advisory range.
- API and Admin `vitest`, including its matching `@vitest/*` packages, use
  4.1.11 to remediate the mocker advisory.

These are compatibility bridges, not audit exceptions. The existing
`deepmerge-ts` 8.0.1 override remains unchanged for the Prisma 7.9.1 config
consumer. Remove an override only after the owning upstream package publishes
the fixed dependency and the complete API, Admin, Mobile, MySQL, and security
gates pass again.

## Lockfile scope and verification

The stabilization lockfile was regenerated with Node 22.17.1 / npm 10.9.2.
Temporary direct constraints restored the base versions of sourcemap-codec,
ip-address, lru.min, negotiator, obug, picomatch, pkg-types, postcss, rc9 and
tinyexec; those temporary constraints were removed before final generation.
No package-lock entries or integrity hashes were edited manually.

Only the named remediation packages and matching Vitest packages change version.
mysql2's declared dependency change replaces `seq-queue`/`sqlstring` with
`sql-escaper` 1.5.1. npm 10.9.2 also recalculates development/optional-peer flags
(including Prisma's optional peer graph); this accounts for the remaining
metadata-only lockfile churn, not additional version upgrades. Both full and
production audits are required to be zero, and `npm ci` must leave the lockfile
unchanged.

Compatibility is established by the release gates, not the override syntax:
Prisma validate/generate, API/Admin regression, disposable MySQL migration
0-to-21 and 20-to-21 upgrades, repeated deploy, and database runtime smoke tests.
The application uses Prisma's MariaDB adapter; mysql2 is separately used by
Prisma tooling. These checks do not constitute upstream certification or an
exhaustive audit of third-party source code.
