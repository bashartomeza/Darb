import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { scanTracked } from "../security-scan.mjs";

test("checkpoint mobile repository stays inside the authenticated API boundary", () => {
  const source = readFileSync(new URL("../../apps/mobile/lib/features/checkpoints/data/checkpoint_repository.dart", import.meta.url), "utf8");
  // Only report booleans: never echo embedded credentials in assertion output.
  assert.equal(source.includes("authenticatedApiClientProvider"), true);
  assert.equal(/https?:\/\//.test(source), false);
  assert.equal(source.includes("http.get"), false);
});

test("artifact scan rejects a synthetic checkpoint credential without reporting its value", () => {
  const dir = mkdtempSync(join(tmpdir(), "masari-artifact-fixture-"));
  const path = join(dir, "client.js");
  try {
    const synthetic = ["ar", "partner", "fixture", "e".repeat(40)].join("_");
    writeFileSync(path, synthetic);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scan-production-artifacts.mjs", import.meta.url)), "--admin-dir", dir], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal((result.stdout + result.stderr).includes(synthetic), false);
  } finally {
    rmSync(path);
    rmdirSync(dir);
  }
});

test("secret scan detects partner credentials using a synthetic fixture", () => {
  const dir = mkdtempSync(join(tmpdir(), "masari-secret-fixture-"));
  const path = join(dir, "fixture.dart");
  try {
    const synthetic = ["ar", "partner", "fixture", "f".repeat(40)].join("_");
    writeFileSync(path, `const credential = '${synthetic}';`);
    assert.equal(scanTracked([path]).some((finding) => finding.rule === "checkpoint partner credential"), true);
  } finally {
    rmSync(path);
    rmdirSync(dir);
  }
});
