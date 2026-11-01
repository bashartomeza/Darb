# CI quality gates

Darb uses four focused GitHub Actions workflows under `.github/workflows`. They are locally parseable with `npm run ci:workflows`; GitHub execution remains pending until the team leader creates and approves an exact private remote.

## Canonical toolchains

- Node: `.nvmrc` (`22.17.1`); npm is locked by `packageManager` in `package.json` (`10.9.2`).
- Flutter: `.flutter-version` (`3.44.6`), without adding a version-manager dependency.
- Java: `.java-version` (`21`).
- Database CI: MySQL `8.0`, ephemeral and dedicated to `masari_ci`.

External actions are immutable-SHA pinned with their maintained major noted inline: `actions/checkout` v6, `actions/setup-node` v6, `actions/setup-java` v5, and `subosito/flutter-action` v2. Review and deliberately update those SHAs as a dependency-maintenance change.

## Local equivalents

```powershell
npm ci
npm run validate
npm run validate:all       # includes Flutter checks
npm run validate:backend
npm run validate:admin
npm run validate:security
```

`validate` stops at the first failing subprocess and leaves its output visible. Flutter is included only in `validate:all` to keep the standard Node command portable for machines without the Android toolchain.

The backend workflow deploys the checked-in MySQL migrations into an empty ephemeral database, deploys them a second time to prove idempotence, checks migration status, then runs the compiled API and the deterministic smoke against real MySQL. It never connects to a developer, staging, or production database.

The security workflow scans tracked paths/content without printing matches, enforces the lockfile, runs production-isolation tests, and applies the dependency policy: high/critical and unapproved moderate advisories fail. The documented moderate exception is limited to the current Prisma CLI-only chain (`@hono/node-server`, `@prisma/dev`, `prisma`, and its pinned `valibot`); it is not a global severity waiver. The application does not import these CLI transitive packages at runtime, and their upstream fix currently requires the prohibited out-of-range Prisma force update.

Production admin and APK outputs are scanned for reset/simulation controls, demo credential markers, and the Full Demo Sequence marker. Ordinary CI builds an unsigned APK and does not receive signing material.

The release APK scan exposed that existing driver simulation endpoint strings survived runtime-only UI gating. M6B2 adds a compile-time product-build guard around those two existing repository calls so release tree-shaking removes the endpoints while ordinary demo/debug behavior and tests remain unchanged.
