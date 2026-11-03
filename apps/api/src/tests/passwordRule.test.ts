import { tmpdir } from "node:os";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";
import { isValidNewPassword, newPassword } from "../lib/passwordRule.js";

const prismaMock = vi.hoisted(() => ({
  consentDocument: { findMany: vi.fn() },
  auditEvent: { create: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn()
}));
const consume = vi.hoisted(() => vi.fn());

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../lib/abuseCounters.js", () => ({ consumeAbuseCounter: consume }));
vi.mock("../lib/consentContent.js", () => ({ consentDigestMatches: () => true }));
// The completion route's session check is not what this file tests: let every request through as attempt_1.
vi.mock("../middleware/onboardingAuth.js", () => ({
  requireOnboardingToken: () => (req: { onboarding?: unknown }, _res: unknown, next: () => void) => {
    req.onboarding = { sessionId: "session_1", attemptId: "attempt_1", purpose: "continuation", attemptStatus: "phone_verified", completedReplayOnly: false };
    next();
  }
}));

const { createApp } = await import("../app.js");

function config() {
  return createConfig({
    APP_ENV: "local",
    DATABASE_URL: "mysql://local:local@localhost:3306/darb",
    JWT_SECRET: "password-rule-test-jwt-secret-longer-than-thirty-two",
    REFRESH_TOKEN_PEPPER: "password-rule-test-refresh-secret-longer-than-thirty-two",
    CORS_ORIGINS: "http://localhost:5173",
    TRUST_PROXY: "none",
    PUBLIC_ONBOARDING_ENABLED: "true",
    OTP_PROVIDER: "fake",
    DRIVER_DOCUMENTS_ENABLED: "true",
    DRIVER_DOCUMENTS_DIR: tmpdir(),
    PHONE_DIGEST_PEPPER: "phone-test-secret-longer-than-thirty-two-characters",
    OTP_CODE_PEPPER: "otp-test-secret-longer-than-thirty-two-characters",
    ONBOARDING_SESSION_PEPPER: "session-test-secret-longer-than-thirty-two-characters",
    IDEMPOTENCY_KEY_PEPPER: "idempotency-test-secret-longer-than-thirty-two-characters",
    IDEMPOTENCY_PAYLOAD_PEPPER: "payload-test-secret-longer-than-thirty-two-characters",
    ABUSE_KEY_PEPPER: "abuse-test-secret-longer-than-thirty-two-characters"
  });
}

describe("the shared password rule", () => {
  it.each([
    ["7 characters", "abcde12"],
    ["letters only", "abcdefghij"],
    ["digits only", "12345678"],
    ["Arabic-Indic digits only", "١٢٣٤٥٦٧٨"],
    ["more than 72 bytes", `a1${"b".repeat(71)}`],
    ["more than 72 bytes in 37 Arabic characters", `${"ب".repeat(36)}١`],
    ["spaces and symbols only", "        !!"]
  ])("refuses %s", (_label, value) => {
    expect(isValidNewPassword(value)).toBe(false);
    expect(newPassword.safeParse(value).success).toBe(false);
  });

  it.each([
    ["8 characters with a letter and a digit", "abcdefg1"],
    ["a digit first", "1abcdefg"],
    ["Arabic letters with Arabic-Indic digits", "كلمةسر١٢"],
    ["Arabic letters with a Western digit", "كلمةسرية1"],
    ["Latin letters with an Arabic-Indic digit", "password٣"],
    ["exactly 72 bytes", `a1${"b".repeat(70)}`],
    ["spaces inside", "my pass 2026"]
  ])("accepts %s", (_label, value) => {
    expect(isValidNewPassword(value)).toBe(true);
    expect(newPassword.safeParse(value).success).toBe(true);
  });

  it("counts characters, not UTF-16 units, toward the minimum", () => {
    // Seven code points, eight UTF-16 units: still too short.
    expect(isValidNewPassword("abcde1😀")).toBe(false);
    expect(isValidNewPassword("abcdef1😀")).toBe(true);
  });
});

describe("driver and shop-owner onboarding use the same rule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consume.mockResolvedValue({ allowed: true });
    prismaMock.auditEvent.create.mockResolvedValue({});
    prismaMock.consentDocument.findMany.mockResolvedValue(["terms", "privacy", "adult_self_attestation"].map((type) => ({
      id: `consent_${type}`, document_type: type, version: "1", locale: "en", content_body: "body", content_digest: "a".repeat(64), effective_at: new Date()
    })));
  });

  const consents = (types = ["terms", "privacy", "adult_self_attestation"]) =>
    types.map((type) => ({ id: `consent_${type}`, type, content_hash: "a".repeat(64) }));
  const complete = (password: string, consentTypes?: string[]) =>
    request(createApp(config()))
      .post("/api/v1/onboarding/attempts/attempt_1/complete")
      .set("authorization", `Onboarding ${"a".repeat(43)}`)
      .set("idempotency-key", "password-rule-key-1")
      .send({ registration_grant: "g".repeat(43), display_name: "Driver Name", password, locale: "en", consents: consents(consentTypes), adult_self_attestation: true });

  it.each(["abcde12", "lettersonly", "1234567890", `a1${"b".repeat(71)}`])("refuses %s with invalid_password", async (password) => {
    const response = await complete(password).expect(400);
    expect(response.body.error).toBe("invalid_password");
    expect(JSON.stringify(response.body)).not.toContain(password);
  });

  it("lets an 8-character password with a letter and a digit (Arabic too) past the password check", async () => {
    // Duplicate consent types fail right after the password check, proving the password itself passed.
    for (const password of ["driver12", "سائق١٢٣٤"]) {
      const response = await complete(password, ["terms", "terms", "privacy"]).expect(400);
      expect(response.body.error).toBe("validation_error");
    }
  });

  it("advertises the shared rule in the onboarding config", async () => {
    const response = await request(createApp(config())).get("/api/v1/onboarding/config").expect(200);
    expect(response.body.password_policy).toEqual({
      minimum_characters: 8,
      maximum_characters: 72,
      maximum_utf8_bytes: 72,
      requires_letter: true,
      requires_digit: true
    });
  });
});
