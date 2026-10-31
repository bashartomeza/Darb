import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { main, parseEnvFile, runPreflight } from "../deploy/preflight.mjs";

const fill = (c) => c.repeat(40);
function goodEnv() {
  return {
    APP_ENV: "production",
    ENABLE_DEMO_FEATURES: "false",
    APP_RELEASE: "2026-10-28-abcdef1",
    DATABASE_URL: ["mysql:/", "/svc:s3cretpw@db.internal:3306/masari"].join(""),
    JWT_SECRET: fill("j"),
    REFRESH_TOKEN_PEPPER: fill("r"),
    AUTH_ACTION_TOKEN_PEPPER: fill("t"),
    CORS_ORIGINS: "https://masari.aynur.ps",
    TRUST_PROXY: "1",
    OTP_PROVIDER: "disabled",
    SUPPORTED_PHONE_REGIONS: "PS",
    ROUTE_PROVIDER: "disabled",
    DRIVER_DOCUMENTS_ENABLED: "true",
    DRIVER_DOCUMENTS_DIR: "/var/lib/masari/driver-documents"
  };
}
const failing = (results) => results.filter((r) => r.status === "FAIL").map((r) => r.id);

test("a complete production environment has no failures", () => {
  assert.deepEqual(failing(runPreflight(goodEnv())), []);
});

test("template placeholders, short and reused secrets fail", () => {
  const env = { ...goodEnv(), JWT_SECRET: "<at-least-32-random-characters>", REFRESH_TOKEN_PEPPER: fill("x"), AUTH_ACTION_TOKEN_PEPPER: fill("x") };
  const ids = failing(runPreflight(env));
  assert.ok(ids.includes("JWT_SECRET"));
  assert.ok(ids.includes("SECRETS_DISTINCT"));
  assert.ok(failing(runPreflight({ ...goodEnv(), AUTH_ACTION_TOKEN_PEPPER: "short" })).includes("AUTH_ACTION_TOKEN_PEPPER"));
  assert.ok(failing(runPreflight({ ...goodEnv(), AUTH_ACTION_TOKEN_PEPPER: undefined })).includes("AUTH_ACTION_TOKEN_PEPPER"));
});

test("unsafe production settings fail", () => {
  const bad = {
    ...goodEnv(),
    APP_ENV: "demo",
    ENABLE_DEMO_FEATURES: "true",
    CORS_ORIGINS: "http://localhost:5173",
    TRUST_PROXY: "",
    OTP_PROVIDER: "fake",
    PUBLIC_ONBOARDING_ENABLED: "true",
    DRIVER_DOCUMENTS_DIR: "relative/dir"
  };
  const ids = failing(runPreflight(bad));
  for (const id of ["APP_ENV", "ENABLE_DEMO_FEATURES", "CORS_ORIGINS", "TRUST_PROXY", "OTP_PROVIDER", "PUBLIC_ONBOARDING_ENABLED", "DRIVER_DOCUMENTS_DIR"]) {
    assert.ok(ids.includes(id), id);
  }
});

test("onboarding peppers are required and distinct only when invitations are enabled", () => {
  assert.ok(failing(runPreflight({ ...goodEnv(), INVITATIONS_ENABLED: "true" })).includes("INVITATION_CODE_PEPPER"));
  const env = { ...goodEnv(), INVITATIONS_ENABLED: "true" };
  ["INVITATION_CODE_PEPPER", "PHONE_DIGEST_PEPPER", "OTP_CODE_PEPPER", "ONBOARDING_SESSION_PEPPER", "IDEMPOTENCY_KEY_PEPPER", "ABUSE_KEY_PEPPER"].forEach((n, i) => {
    env[n] = String(i).repeat(40);
  });
  assert.deepEqual(failing(runPreflight(env)), []);
  env.ABUSE_KEY_PEPPER = env.PHONE_DIGEST_PEPPER;
  assert.ok(failing(runPreflight(env)).includes("PEPPERS_DISTINCT"));
});

test("env file parsing works and output never reveals secret values", () => {
  const dir = mkdtempSync(join(tmpdir(), "masari-preflight-"));
  try {
    const env = goodEnv();
    const file = join(dir, "api.env");
    writeFileSync(file, `# comment\n${Object.entries(env).map(([k, v]) => `${k}="${v}"`).join("\n")}\n`);
    assert.equal(parseEnvFile("A=1 # note\nexport B='two'\n").B, "two");
    const lines = [];
    assert.equal(main(["--env-file", file], {}, (l) => lines.push(l)), 0);
    const output = lines.join("\n");
    for (const secret of [env.JWT_SECRET, env.REFRESH_TOKEN_PEPPER, env.AUTH_ACTION_TOKEN_PEPPER, "s3cretpw"]) {
      assert.equal(output.includes(secret), false);
    }
    writeFileSync(file, "APP_ENV=production\n");
    assert.equal(main(["--env-file", file], {}, () => {}), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const smtpEnv = () => ({
  ...goodEnv(),
  EMAIL_DELIVERY: "smtp",
  SMTP_HOST: "smtp.mail.test",
  SMTP_PORT: "587",
  SMTP_SECURE: "starttls",
  SMTP_USER: "mailer",
  SMTP_PASSWORD: "an-smtp-secret-value",
  EMAIL_FROM_ADDRESS: "no-reply@masari.aynur.ps"
});

test("a complete smtp configuration passes and email-off only warns", () => {
  assert.deepEqual(failing(runPreflight(smtpEnv())), []);
  const off = runPreflight(goodEnv());
  assert.ok(off.some((r) => r.id === "EMAIL_DELIVERY_DISABLED" && r.status === "WARN"));
  assert.ok(!runPreflight(smtpEnv()).some((r) => r.id === "EMAIL_DELIVERY_DISABLED"));
});

test("an incomplete or unsafe smtp configuration fails", () => {
  for (const name of ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM_ADDRESS"]) {
    assert.ok(failing(runPreflight({ ...smtpEnv(), [name]: undefined })).includes(name), name);
  }
  assert.ok(failing(runPreflight({ ...smtpEnv(), SMTP_PASSWORD: "<smtp-account-password>" })).includes("SMTP_PASSWORD"));
  assert.ok(failing(runPreflight({ ...smtpEnv(), SMTP_HOST: "localhost" })).includes("SMTP_HOST"));
  assert.ok(failing(runPreflight({ ...smtpEnv(), SMTP_PORT: "99999" })).includes("SMTP_PORT"));
  assert.ok(failing(runPreflight({ ...smtpEnv(), SMTP_SECURE: "plain" })).includes("SMTP_SECURE"));
  assert.ok(failing(runPreflight({ ...smtpEnv(), EMAIL_FROM_ADDRESS: "not-an-address" })).includes("EMAIL_FROM_ADDRESS"));
  assert.ok(failing(runPreflight({ ...goodEnv(), EMAIL_DELIVERY: "gmail" })).includes("EMAIL_DELIVERY"));
});

test("the smtp password never appears in preflight output", () => {
  const dir = mkdtempSync(join(tmpdir(), "masari-preflight-smtp-"));
  try {
    const file = join(dir, "api.env");
    const env = smtpEnv();
    writeFileSync(file, Object.entries(env).map(([k, v]) => `${k}="${v}"`).join("\n") + "\n");
    const lines = [];
    assert.equal(main(["--env-file", file], {}, (l) => lines.push(l)), 0);
    assert.equal(lines.join("\n").includes(env.SMTP_PASSWORD), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("OTP_PROVIDER=email needs SMTP, fake is refused, and public onboarding needs the email provider", () => {
  const smtp = { EMAIL_DELIVERY: "smtp", SMTP_HOST: "smtp.mail.example.org", SMTP_USER: "svc-mailer", SMTP_PASSWORD: "x".repeat(24), EMAIL_FROM_ADDRESS: "no-reply@masari.aynur.ps" };
  assert.deepEqual(failing(runPreflight({ ...goodEnv(), ...smtp, OTP_PROVIDER: "email", PUBLIC_ONBOARDING_ENABLED: "true" })).filter((id) => /OTP|PUBLIC/.test(id)), []);
  assert.ok(failing(runPreflight({ ...goodEnv(), OTP_PROVIDER: "email" })).includes("OTP_PROVIDER_EMAIL"));
  assert.ok(failing(runPreflight({ ...goodEnv(), OTP_PROVIDER: "fake" })).includes("OTP_PROVIDER"));
  assert.ok(failing(runPreflight({ ...goodEnv(), PUBLIC_ONBOARDING_ENABLED: "true" })).includes("PUBLIC_ONBOARDING_ENABLED"));
  assert.ok(!runPreflight(goodEnv()).some((r) => r.id === "SMS_DELIVERY"));
});
