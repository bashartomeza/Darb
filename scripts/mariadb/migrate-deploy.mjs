#!/usr/bin/env node
// Translate the immutable MySQL migrations into an isolated temporary Prisma project.
// Supports a repo checkout and the cPanel release layout (prisma/, prisma.config.ts).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { translateMigrationsFolder } from "./translate-migrations.mjs";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const releaseLayout = resolve(scriptRoot, "prisma");
const repoLayout = resolve(scriptRoot, "apps/api/prisma");
const prismaDir = existsSync(releaseLayout) ? releaseLayout : repoLayout;
const config = resolve(scriptRoot, "prisma.config.ts");
const command = process.argv[2] ?? "deploy";
if (!["deploy", "status"].includes(command)) {
  console.error("Usage: migrate-deploy.mjs [deploy|status]");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for Prisma migration commands.");
  process.exit(2);
}

if (!existsSync(config)) throw new Error(`Prisma config not found: ${config}`);
if (!existsSync(join(prismaDir, "migrations"))) throw new Error(`Migrations not found under ${prismaDir}`);
const work = mkdtempSync(join(tmpdir(), "darb-mariadb-migrate-"));
let result;
try {
  cpSync(config, join(work, "prisma.config.ts"));
  mkdirSync(join(work, "prisma"));
  cpSync(join(prismaDir, "schema.prisma"), join(work, "prisma", "schema.prisma"));
  const translatedDir = join(work, "prisma", "migrations");
  const report = translateMigrationsFolder(join(prismaDir, "migrations"), translatedDir);
  console.log(`Translated ${report.length} migrations for MariaDB.`);
  const prisma = join(scriptRoot, "node_modules", "prisma", "build", "index.js");
  if (!existsSync(prisma)) throw new Error(`Prisma CLI not found: ${prisma}`);
  result = spawnSync(process.execPath, [prisma, "migrate", command, "--config", join(work, "prisma.config.ts")], {
    stdio: "inherit",
    env: process.env
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (result.error) throw result.error;
process.exit(result.status ?? 1);
