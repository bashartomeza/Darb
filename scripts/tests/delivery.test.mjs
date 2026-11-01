import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { withoutLocalOnlyEnvironment } from "../lib/production-environment.mjs";
import { run } from "../lib/process.mjs";
import { scanTracked } from "../security-scan.mjs";

test("tracked scanner reports a rule and path without the detected value", () => {
  const directory = mkdtempSync(join(tmpdir(), "darb-security-test-"));
  const prior = process.cwd();
  try {
    process.chdir(directory);
    writeFileSync("unsafe.txt", `token=${"ghp_"}${"abcdefghijklmnopqrstuvwxyz1234567890"}`);
    const findings = scanTracked(["unsafe.txt"]);
    assert.equal(findings.length, 1);
    assert.deepEqual(findings[0], { rule: "GitHub token", path: "unsafe.txt" });
    assert.equal(JSON.stringify(findings).includes("abcdefghijklmnopqrstuvwxyz"), false);
  } finally {
    process.chdir(prior);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("validation subprocess failures remain nonzero and visible", () => {
  assert.throws(
    () => run(process.execPath, ["-e", "process.stderr.write('diagnostic'); process.exit(7)"], { stdio: "pipe" }),
    /exit code 7/
  );
});

test("production subprocesses drop local-only onboarding fixtures", () => {
  const sanitized = withoutLocalOnlyEnvironment({
    APP_ENV: "local",
    ONBOARDING_TEST_LEGAL_FIXTURES_ENABLED: "true",
    SAFE_VALUE: "retained"
  });

  assert.equal(sanitized.ONBOARDING_TEST_LEGAL_FIXTURES_ENABLED, undefined);
  assert.equal(sanitized.SAFE_VALUE, "retained");
});
