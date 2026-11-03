import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { scanTracked } from "../security-scan.mjs";

// Every synthetic value is assembled at runtime so this file never contains a
// string the tracked-file scan would report.
function scanFiles(files) {
  const directory = mkdtempSync(join(tmpdir(), "darb-security-scan-test-"));
  const prior = process.cwd();
  try {
    process.chdir(directory);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    return scanTracked(Object.keys(files));
  } finally {
    process.chdir(prior);
    rmSync(directory, { recursive: true, force: true });
  }
}

const rulesFor = (findings, path) => findings.filter((finding) => finding.path === path).map((finding) => finding.rule);

test("scanner reports provider API keys by rule and path without the value", () => {
  const gemini = "AIza" + "Fake".repeat(8) + "Xyz";
  const groq = "gsk" + "_" + "fake".repeat(6);
  const openai = "sk" + "-proj-" + "fake".repeat(6);
  const findings = scanFiles({
    "gemini.txt": `GEMINI_API_KEY=${gemini}\n`,
    "groq.txt": `GROQ_API_KEY=${groq}\n`,
    "openai.txt": `OPENAI_API_KEY=${openai}\n`
  });

  assert.deepEqual(rulesFor(findings, "gemini.txt"), ["Gemini API key"]);
  assert.deepEqual(rulesFor(findings, "groq.txt"), ["Groq API key"]);
  assert.deepEqual(rulesFor(findings, "openai.txt"), ["OpenAI API key"]);
  assert.equal(JSON.stringify(findings).includes("fake"), false);
});

test("scanner ignores short or test-double provider key shapes", () => {
  const findings = scanFiles({
    "short.txt": `GEMINI_API_KEY=${"AIza" + "short"}\nGROQ_API_KEY=${"gsk" + "_short"}\n`,
    "double.txt": `OPENAI_API_KEY=${"sk" + "-test-" + "fake".repeat(6)}\n`,
    "words.txt": "task-scheduling-and-retries-for-workers desk-reservation-flow-overview\n"
  });

  assert.deepEqual(findings, []);
});

test("scanner flags hard-coded password literals in shipped TypeScript sources", () => {
  const value = "Fake" + "Value" + "123!";
  const findings = scanFiles({
    "apps/api/src/scripts/seedPerson.ts": `const PASSWORD = "${value}";\n`,
    "apps/api/src/services/accounts.ts": `await upsert({ email, password: '${value}' });\n`,
    "apps/admin/src/pages/Login.tsx": `const defaultPassword = \`${value}\`;\n`
  });

  assert.deepEqual(rulesFor(findings, "apps/api/src/scripts/seedPerson.ts"), ["hard-coded password"]);
  assert.deepEqual(rulesFor(findings, "apps/api/src/services/accounts.ts"), ["hard-coded password"]);
  assert.deepEqual(rulesFor(findings, "apps/admin/src/pages/Login.tsx"), ["hard-coded password"]);
  assert.equal(JSON.stringify(findings).includes(value), false);
});

test("scanner leaves tests, fixtures, examples and safe password patterns alone", () => {
  const value = "Fake" + "Value" + "123!";
  const literal = `const PASSWORD = "${value}";\n`;
  const findings = scanFiles({
    "apps/api/src/tests/auth.test.ts": literal,
    "apps/api/src/fixtures/users.ts": literal,
    "apps/api/src/config.example.ts": literal,
    "apps/api/src/scripts/demoResetGateIntegration.ts": literal,
    "apps/admin/src/i18n/translations.ts": "password: \"Password\",\n",
    "scripts/test-env/seed.mjs": literal,
    "apps/api/src/services/safe.ts": [
      "const PASSWORD = process.env.DEMO_PASSWORD;",
      "const empty = { password: \"\" };",
      "const placeholder = { password: \"<set-a-strong-password>\" };",
      "const rendered = { password: `${generated}` };",
      "if (input.password === \"x\") reject();",
      "const DUMMY_PASSWORD = \"dummy-value-for-timing\";",
      "const label = { password: \"Enter your password\" };",
      "const checkPassword = (password: string) => password.length > 0;"
    ].join("\n")
  });

  assert.deepEqual(findings, []);
});
