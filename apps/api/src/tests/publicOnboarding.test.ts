import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createConfig } from "../config.js";
import { idempotencyPayloadDigest, keyedDigest } from "../lib/keyedDigest.js";

function disabledConfig() {
  return createConfig({
    APP_ENV: "local",
    DATABASE_URL: "mysql://local:local@localhost:3306/masari",
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
      DATABASE_URL: "mysql://production:secret@db.internal:3306/masari",
      JWT_SECRET: "production-jwt-secret-longer-than-thirty-two-characters",
      REFRESH_TOKEN_PEPPER: "production-refresh-secret-longer-than-thirty-two-characters",
      CORS_ORIGINS: "https://admin.masari.example",
      APP_RELEASE: "test",
      TRUST_PROXY: "none"
    };
    expect(() => createConfig({ ...base, PUBLIC_ONBOARDING_ENABLED: "true" })).toThrow(/requires OTP_PROVIDER=email/);
    expect(() => createConfig({ ...base, OTP_PROVIDER: "fake" })).toThrow(/forbidden/);
    // Email delivery needs the SMTP settings; Masari sends no SMS.
    expect(() => createConfig({ ...base, OTP_PROVIDER: "email" })).toThrow(/OTP_PROVIDER=email requires EMAIL_DELIVERY=smtp/);
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
