import { describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";
import { createInvitation, generateInvitationCode, normalizeInvitationCode } from "../lib/invitations.js";
import { keyedDigest, phoneDigest } from "../lib/keyedDigest.js";
import { FakeOtpProvider, generateOtpCode } from "../lib/otp.js";
import { analyzePhoneNormalization, maskPhone, normalizePhoneToE164, PhoneNormalizationError } from "../lib/phone.js";

const key = { secret: "a-test-only-secret-that-is-longer-than-thirty-two-characters", version: 1 };
const enabledSecrets = {
  INVITATION_CODE_PEPPER: "invitation-test-secret-longer-than-thirty-two-characters",
  PHONE_DIGEST_PEPPER: "phone-test-secret-longer-than-thirty-two-characters",
  OTP_CODE_PEPPER: "otp-test-secret-longer-than-thirty-two-characters",
  ONBOARDING_SESSION_PEPPER: "session-test-secret-longer-than-thirty-two-characters",
  IDEMPOTENCY_KEY_PEPPER: "idempotency-test-secret-longer-than-thirty-two-characters",
  IDEMPOTENCY_PAYLOAD_PEPPER: "payload-test-secret-longer-than-thirty-two-characters",
  ABUSE_KEY_PEPPER: "abuse-test-secret-longer-than-thirty-two-characters"
};

function localConfig(overrides: Record<string, string | undefined> = {}) {
  return createConfig({
    APP_ENV: "local",
    DATABASE_URL: "mysql://local:local@localhost:3306/darb",
    JWT_SECRET: "local-test-jwt-secret-longer-than-thirty-two-characters",
    REFRESH_TOKEN_PEPPER: "local-test-refresh-pepper-longer-than-thirty-two-characters",
    CORS_ORIGINS: "http://localhost:5173",
    TRUST_PROXY: "none",
    ...overrides
  });
}

describe("onboarding foundation primitives", () => {
  it("normalizes valid international numbers from representative numbering plans", () => {
    const cases = [
      ["+970599123456", "+970599123456"],
      ["+972569523636", "+972569523636"],
      ["+962790000000", "+962790000000"],
      ["+966501234567", "+966501234567"],
      ["+971501234567", "+971501234567"],
      ["+12025550123", "+12025550123"],
      ["+442079460018", "+442079460018"],
      ["+33142345678", "+33142345678"]
    ] as const;
    for (const [input, canonical] of cases) expect(normalizePhoneToE164(input)).toBe(canonical);
  });

  it("normalizes safe formatting variants and explicit-region local input", () => {
    expect(normalizePhoneToE164("059 000 0001", { region: "PS" })).toBe("+970590000001");
    expect(normalizePhoneToE164("+970 59 000 0001")).toBe("+970590000001");
    expect(normalizePhoneToE164("٠٥٩ ٠٠٠ ٠٠٠١", { region: "PS" })).toBe("+970590000001");
    expect(normalizePhoneToE164("۰۵۹-۰۰۰-۰۰۰۱", { region: "PS" })).toBe("+970590000001");
    expect(normalizePhoneToE164("+972 (56) 952-3636")).toBe("+972569523636");
    expect(normalizePhoneToE164("(202) 555-0123", { region: "US" })).toBe("+12025550123");
    expect(maskPhone("+970590000001")).toBe("+970 ••• •• 0001");
    expect(maskPhone("+12025550123")).toBe("+1 ••• •• 0123");
  });

  it("rejects malformed, ambiguous, unsupported, and excessive input", () => {
    const invalid = [
      "",
      "   ",
      "0590000001",
      "00970590000001",
      "+999123456789",
      "+970123",
      "+970500000000",
      "+120255501234567890",
      "+970590000001\n",
      "+970590000001 ext 2",
      "++970590000001",
      "+97+0590000001",
      "＋９７２５６９５２３６３６",
      "+97256\u200b9523636",
      "not-a-phone"
    ];
    for (const input of invalid) {
      expect(() => normalizePhoneToE164(input)).toThrow(PhoneNormalizationError);
    }
    expect(() => normalizePhoneToE164("0590000001", { region: "ZZ" })).toThrow(PhoneNormalizationError);
  });

  it("canonicalizes identity before digest and collision checks without exposing phone values", () => {
    const canonical = normalizePhoneToE164("+972 56-952-3636");
    expect(phoneDigest(canonical, key)).toBe(phoneDigest("+972569523636", key));
    expect(normalizePhoneToE164("+970569523636")).not.toBe(canonical);
    expect(phoneDigest(canonical, key)).not.toBe(phoneDigest("+970569523636", key));
    const result = analyzePhoneNormalization([
      { id: "one", phone: "+970590000001" },
      { id: "two", phone: "+970 59 000 0001" },
      { id: "three", phone: "invalid" }
    ]);
    expect(result).toEqual({ total: 3, valid: 2, invalid: 1, collisions: 1 });
    expect(JSON.stringify(result)).not.toContain("970");
  });

  it("binds invitations to the global canonical phone digest", async () => {
    const invitation = { id: "invitation_global" };
    const create = vi.fn().mockResolvedValue(invitation);
    const result = await createInvitation(
      { invitation: { create } } as never,
      {
        createdById: "admin_global",
        intendedRole: "passenger",
        intendedPhone: "+972 (56) 952-3636",
        expiresAt: new Date("2026-08-20T00:00:00.000Z"),
        keys: { code: key, phone: key }
      }
    );

    expect(result.invitation).toBe(invitation);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        intended_phone_digest: phoneDigest("+972569523636", key),
        phone_last4: "3636"
      })
    });
  });

  it("generates 100-bit Crockford codes and normalizes their display form", () => {
    const codes = new Set(Array.from({ length: 200 }, generateInvitationCode));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(normalizeInvitationCode(code)).toMatch(/^[0-9A-HJKMNP-TV-Z]{20}$/);
  });

  it("uses domain separation and key versions for keyed digests", () => {
    expect(keyedDigest("context-a", "same", key)).not.toBe(keyedDigest("context-b", "same", key));
    expect(keyedDigest("context-a", "same", key)).not.toBe(keyedDigest("context-a", "same", { ...key, version: 2 }));
    expect(keyedDigest("context-a", "same", key)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps fake OTP values only in the injected in-memory outbox", async () => {
    const provider = new FakeOtpProvider();
    const code = generateOtpCode();
    expect(code).toMatch(/^\d{6}$/);
    const result = await provider.send({ phoneE164: "+970590000001", code });
    expect(result.status).toBe("accepted");
    expect([...provider.outbox.values()]).toEqual([code]);
  });
});

describe("onboarding configuration isolation", () => {
  it("keeps the foundation and all public onboarding disabled by default", () => {
    const parsed = localConfig();
    expect(parsed.invitationsEnabled).toBe(false);
    expect(parsed.publicOnboardingEnabled).toBe(false);
    expect(parsed.onboarding).toBeUndefined();
  });

  it("requires every independent pepper when invitations are enabled", () => {
    expect(() => localConfig({ INVITATIONS_ENABLED: "true" })).toThrow(/pepper is required/);
    expect(localConfig({ INVITATIONS_ENABLED: "true", OTP_PROVIDER: "fake", ...enabledSecrets }).onboarding).toBeDefined();
  });

  it("rejects placeholder or reused onboarding peppers without echoing values", () => {
    expect(() => localConfig({
      INVITATIONS_ENABLED: "true",
      ...enabledSecrets,
      OTP_CODE_PEPPER: "replace-with-a-long-random-otp-pepper"
    })).toThrow(/placeholder/);
    const repeated = "same-sensitive-pepper-value-longer-than-thirty-two-characters";
    expect(() => localConfig({
      INVITATIONS_ENABLED: "true",
      ...enabledSecrets,
      OTP_CODE_PEPPER: repeated,
      PHONE_DIGEST_PEPPER: repeated
    })).toThrow(/must be distinct/);
    try {
      localConfig({ INVITATIONS_ENABLED: "true", ...enabledSecrets, OTP_CODE_PEPPER: repeated, PHONE_DIGEST_PEPPER: repeated });
    } catch (error) {
      expect(String(error)).not.toContain(repeated);
    }
  });

  it("rejects reuse of JWT and refresh-token secrets for onboarding digests", () => {
    const jwtSecret = "local-test-jwt-secret-longer-than-thirty-two-characters";
    const refreshSecret = "local-test-refresh-pepper-longer-than-thirty-two-characters";
    expect(() => localConfig({
      INVITATIONS_ENABLED: "true",
      ...enabledSecrets,
      OTP_CODE_PEPPER: jwtSecret
    })).toThrow(/distinct from JWT and refresh-token secrets/);
    expect(() => localConfig({
      INVITATIONS_ENABLED: "true",
      ...enabledSecrets,
      OTP_CODE_PEPPER: refreshSecret
    })).toThrow(/distinct from JWT and refresh-token secrets/);
  });

  it("enables public onboarding only with its isolated prerequisites", () => {
    expect(() => localConfig({ PUBLIC_ONBOARDING_ENABLED: "true" })).toThrow(/pepper is required/);
    expect(() => localConfig({
      PUBLIC_ONBOARDING_ENABLED: "true",
      OTP_PROVIDER: "fake",
      ...enabledSecrets
    })).toThrow(/requires DRIVER_DOCUMENTS_ENABLED/);
    // Registration does not depend on invitations: no INVITATIONS_ENABLED and no invitation pepper.
    const { INVITATION_CODE_PEPPER: _unused, ...withoutInvitationPepper } = enabledSecrets as Record<string, string>;
    const parsed = localConfig({
      PUBLIC_ONBOARDING_ENABLED: "true",
      OTP_PROVIDER: "fake",
      DRIVER_DOCUMENTS_ENABLED: "true",
      DRIVER_DOCUMENTS_DIR: process.cwd(),
      ONBOARDING_TEST_LEGAL_FIXTURES_ENABLED: "true",
      ...withoutInvitationPepper
    });
    expect(parsed.invitationsEnabled).toBe(false);
    expect(parsed.onboarding).toBeDefined();
    expect(parsed.publicRegistration).toEqual(expect.objectContaining({
      attemptTtlSeconds: 1800,
      registrationGrantTtlSeconds: 900,
      continuationTtlSeconds: 1800,
      pendingStatusTtlDays: 7,
      testLegalFixturesEnabled: true
    }));
  });

  it("rejects the fake provider in production even when no routes are enabled", () => {
    expect(() => createConfig({
      APP_ENV: "production",
      DATABASE_URL: "mysql://production:secret@db.internal:3306/darb",
      JWT_SECRET: "production-jwt-secret-longer-than-thirty-two-characters",
      REFRESH_TOKEN_PEPPER: "production-refresh-pepper-longer-than-thirty-two-characters",
      CORS_ORIGINS: "https://admin.darb.example",
      APP_RELEASE: "test",
      TRUST_PROXY: "none",
      OTP_PROVIDER: "fake"
    })).toThrow(/forbidden/);
  });
});
