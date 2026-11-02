import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("../../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const migrationPath = resolve(
  root,
  "apps/api/prisma/migrations/20260820120000_global_e164_phone_constraints/migration.sql"
);
const migration = readFileSync(migrationPath, "utf8").replaceAll("\r\n", "\n");

test("migration 20 replaces the country-specific check with structural E.164 defense in depth", () => {
  assert.match(migration, /DROP CHECK `onboarding_attempts_phone_e164_chk`/);
  assert.match(migration, /ADD CONSTRAINT `onboarding_attempts_phone_e164_chk`/);
  assert.match(migration, /CHAR_LENGTH\(`phone_e164`\) BETWEEN 2 AND 16/);
  assert.match(migration, /REGEXP '\^\\\\\+\[1-9\]\[0-9\]\{0,14\}\$'/);
  assert.doesNotMatch(migration, /\+970|\+972|country|region allow-list/i);
});
