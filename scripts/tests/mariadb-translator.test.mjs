import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { translateMigrationsFolder, translateSql } from "../mariadb/translate-migrations.mjs";

test("rewrites DROP CHECK only in SQL code, not comments or strings", () => {
  const source = [
    "-- DROP CHECK in this historical note stays unchanged",
    "ALTER TABLE `t` DROP CHECK `shape_chk`;",
    "INSERT INTO `notes` (`value`) VALUES ('DROP CHECK is quoted text');"
  ].join("\n");

  const { sql, applied } = translateSql(source, "fixture.sql");

  assert.equal(sql, [
    "-- DROP CHECK in this historical note stays unchanged",
    "ALTER TABLE `t` DROP CONSTRAINT `shape_chk`;",
    "INSERT INTO `notes` (`value`) VALUES ('DROP CHECK is quoted text');"
  ].join("\n"));
  assert.deepEqual(applied, ["drop-check"]);
});

test("converts SHA2 to ascii only inside CHECK expressions", () => {
  const source = "ALTER TABLE `t` ADD CONSTRAINT `c` CHECK (`digest` = SHA2(CONCAT('x)', `id`), 256));";

  const { sql, applied } = translateSql(source, "fixture.sql");

  assert.equal(sql, "ALTER TABLE `t` ADD CONSTRAINT `c` CHECK (`digest` = CONVERT(SHA2(CONCAT('x)', `id`), 256) USING ascii) COLLATE ascii_bin);");
  assert.deepEqual(applied, ["sha2-ascii-comparison"]);
});

test("refuses unhandled MySQL-only syntax with the migration and statement", () => {
  assert.throws(
    () => translateSql("ALTER TABLE `t` ADD COLUMN `x` VARCHAR(10) INVISIBLE;", "20300101_invisible/migration.sql"),
    /20300101_invisible\/migration\.sql: MySQL-only construct not handled \(invisible-index\)/
  );
});

test("never overwrites an existing output directory", () => {
  const root = mkdtempSync(join(tmpdir(), "darb-mariadb-output-"));
  try {
    const source = join(root, "source");
    const output = join(root, "output");
    mkdirSync(join(source, "001_init"), { recursive: true });
    writeFileSync(join(source, "001_init", "migration.sql"), "CREATE TABLE `t` (`id` INT);");
    mkdirSync(output);
    writeFileSync(join(output, "keep.txt"), "user data");

    assert.throws(() => translateMigrationsFolder(source, output), /Output directory already exists/);
    assert.equal(readFileSync(join(output, "keep.txt"), "utf8"), "user data");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("translates the repository migration set without changing source files", () => {
  const root = mkdtempSync(join(tmpdir(), "darb-mariadb-repository-"));
  try {
    const source = join(process.cwd(), "apps", "api", "prisma", "migrations");
    const output = join(root, "migrations");
    const report = translateMigrationsFolder(source, output);
    const changed = report.filter((entry) => entry.applied.length > 0);

    assert.equal(report.length, 57);
    assert.deepEqual(changed.map((entry) => entry.migration), [
      "20260722180000_harden_multi_route_operations",
      "20260722200000_enforce_operational_mode_and_expiry_quarantine",
      "20260726130000_canonical_matching_dispatch",
      "20260727110000_harden_canonical_assignment_integrity",
      "20260728130000_canonical_shared_trip_aggregation",
      "20260820120000_global_e164_phone_constraints",
      "20261012165000_allow_legacy_offer_lifecycle_timestamps",
      "20261104120000_route_based_orders"
    ]);
    for (const entry of report.filter((candidate) => candidate.applied.length === 0)) {
      const input = readFileSync(join(source, entry.migration, "migration.sql"), "utf8");
      const translated = readFileSync(join(output, entry.migration, "migration.sql"), "utf8");
      assert.equal(translated, input, `${entry.migration} should remain byte-identical`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
