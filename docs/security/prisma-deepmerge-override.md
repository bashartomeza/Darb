# Prisma deepmerge security override

Darb uses Prisma 7.9.1 across the CLI, client, and MariaDB adapter. That
release still resolves `@prisma/config` to `deepmerge-ts` 7.1.5, which is
affected by GHSA-ggr8-5vv4-36mx.

The root npm override temporarily selects `deepmerge-ts` 8.0.1. The lockfile
has a single `deepmerge-ts` consumer (`@prisma/config`), and version 8 retains
the named `deepmerge` export and supported Node.js engine required by that
consumer.

This override is a temporary compatibility bridge. Remove it only after a
stable Prisma release resolves `@prisma/config` to a fixed `deepmerge-ts`
version, and only after rerunning the complete API, Admin, Mobile, MySQL, and
security gates.
