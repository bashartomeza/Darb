import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createConfig } from "../config.js";
import { idempotencyPayloadDigest, keyedDigest } from "../lib/keyedDigest.js";

function disabledConfig() {
  return createConfig({
    APP_ENV: "local",
    DATABASE_URL: "mysql://local:local@localhost:3306/darb",
    JWT_SECRET: "public-onboarding-test-jwt-secret-longer-than-thirty-two",
    REFRESH_TOKEN_PEPPER: "public-onboarding-test-refresh-secret-longer-than-thirty-two",
    CORS_ORIGINS: "http://localhost:5173",
    TRUST_PROXY: "none",
    PUBLIC_ONBOARDING_ENABLED: "false",
    INVITATIONS_ENABLED: "false",
    OTP_PROVIDER: "disabled"
  });
}

describe("public onboarding boundary", () => {
  it("keeps safe config registered and every mutation absent when disabled", async () => {
    const app = createApp(disabledConfig());
    const config = await request(app).get("/api/v1/onboarding/config").expect(200);
    expect(config.body).toEqual({ enabled: false, registration_roles: [], open_registration_roles: [], request_id: expect.any(String) });
    expect(JSON.stringify(config.body)).not.toMatch(/provider|pepper|environment/);
    const consent = await request(app).get("/api/v1/onboarding/consents?locale=ar").expect(404);
    expect(consent.body).toEqual({ error: "not_found", request_id: expect.any(String) });
    const start = await request(app)
      .post("/api/v1/onboarding/attempts")
      .set("idempotency-key", "disabled-test-key")
      .send({})
      .expect(404);
    expect(start.body.request_id).toEqual(expect.any(String));
  });

  it("rejects every production-like attempt to enable public onboarding or fake delivery", () => {
    const base = {
      APP_ENV: "production",
      DATABASE_URL: "mysql://production:secret@db.internal:3306/darb",
      JWT_SECRET: "production-jwt-secret-longer-than-thirty-two-characters",
      REFRESH_TOKEN_PEPPER: "production-refresh-secret-longer-than-thirty-two-characters",
      CORS_ORIGINS: "https://admin.darb.example",
      APP_RELEASE: "test",
      TRUST_PROXY: "none"
    };
    expect(() => createConfig({ ...base, PUBLIC_ONBOARDING_ENABLED: "true" })).toThrow(/requires OTP_PROVIDER=email/);
    expect(() => createConfig({ ...base, OTP_PROVIDER: "fake" })).toThrow(/forbidden/);
    // Email delivery needs the SMTP settings; Darb sends no SMS.
    expect(() => createConfig({ ...base, OTP_PROVIDER: "email" })).toThrow(/OTP_PROVIDER=email requires EMAIL_DELIVERY=smtp/);
  });

  it("allows code-free driver and shop sign-up in production only with both switches, no SMTP and no OTP provider", () => {
    const base = {
      APP_ENV: "production",
      DATABASE_URL: "mysql://production:secret@db.internal:3306/darb",
      JWT_SECRET: "production-jwt-secret-longer-than-thirty-two-characters",
      REFRESH_TOKEN_PEPPER: "production-refresh-secret-longer-than-thirty-two-characters",
      CORS_ORIGINS: "https://admin.darb.example",
      APP_RELEASE: "test",
      TRUST_PROXY: "none",
      PUBLIC_ONBOARDING_ENABLED: "true",
      INVITATIONS_ENABLED: "true",
      DRIVER_DOCUMENTS_ENABLED: "true",
      EMAIL_VERIFICATION_DISABLED: "true",
      ALLOW_UNVERIFIED_EMAIL_SIGNUP: "true"
    };
    const problemsFor = (extra: Record<string, string>, drop: string[] = []) => {
      const environment: Record<string, string> = { ...base, ...extra };
      for (const name of drop) delete environment[name];
      try { createConfig(environment as any); return ""; } catch (error) { return String((error as Error).message); }
    };
    // Without the new switches production still demands the emailed code.
    expect(problemsFor({})).toMatch(/requires OTP_PROVIDER=email/);
    // The code switch alone is refused: the acknowledgement is mandatory.
    expect(problemsFor({ ONBOARDING_CODE_DISABLED: "true" })).toMatch(/also needs ALLOW_UNVERIFIED_ONBOARDING=true/);
    expect(problemsFor({ ALLOW_UNVERIFIED_ONBOARDING: "true" })).toMatch(/only makes sense together with ONBOARDING_CODE_DISABLED/);
    // Approved applicants must be able to sign in with their unverified email.
    expect(problemsFor({ ONBOARDING_CODE_DISABLED: "true", ALLOW_UNVERIFIED_ONBOARDING: "true" }, ["EMAIL_VERIFICATION_DISABLED", "ALLOW_UNVERIFIED_EMAIL_SIGNUP"])).toMatch(/requires EMAIL_VERIFICATION_DISABLED=true/);
    // Both switches: no OTP provider and no SMTP settings are needed for onboarding.
    const accepted = problemsFor({ ONBOARDING_CODE_DISABLED: "true", ALLOW_UNVERIFIED_ONBOARDING: "true" });
    expect(accepted).not.toMatch(/OTP_PROVIDER|SMTP|ONBOARDING_CODE_DISABLED|ALLOW_UNVERIFIED_ONBOARDING/);
    expect(problemsFor({ ONBOARDING_CODE_DISABLED: "true", ALLOW_UNVERIFIED_ONBOARDING: "true", OTP_PROVIDER: "fake" })).toMatch(/OTP_PROVIDER=fake is forbidden/);
  });

  it("uses an isolated keyed digest for secret-bearing idempotency payloads", () => {
    const payloadKey = { secret: "payload-pepper-longer-than-thirty-two-characters", version: 3 };
    const idempotencyKey = { secret: "key-pepper-longer-than-thirty-two-characters", version: 3 };
    const payload = "{\"otp\":\"123456\",\"password\":\"common password\"}";
    const digest = idempotencyPayloadDigest("onboarding_verify", payload, payloadKey);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toBe(keyedDigest("onboarding_verify", payload, idempotencyKey));
    expect(digest).not.toContain("123456");
    expect(digest).not.toContain("common password");
  });
});
