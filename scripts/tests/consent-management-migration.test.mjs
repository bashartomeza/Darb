import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("../../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const migration = readFileSync(
  resolve(root, "apps/api/prisma/migrations/20260821120000_consent_management_workflow/migration.sql"),
  "utf8"
).replaceAll("\r\n", "\n");

test("migration 21 adds only the consent workflow structure and no legal content", () => {
  assert.match(migration, /CREATE TABLE `consent_releases`/);
  assert.match(migration, /`revision` INTEGER NOT NULL DEFAULT 1/);
  assert.match(migration, /`content_body` TEXT NULL/);
  assert.match(migration, /`release_id` VARCHAR\(191\) NULL/);
  assert.match(migration, /FOREIGN KEY \(`release_id`\) REFERENCES `consent_releases`\(`id`\) ON DELETE RESTRICT/);
  assert.doesNotMatch(migration, /INSERT\s+INTO|UPDATE\s+`?(?:users|consent_documents|user_consents)`?/i);
  assert.doesNotMatch(migration, /TEST ONLY|terms text|privacy policy|adult declaration/i);
});
