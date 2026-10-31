import { tmpdir } from "node:os";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";

const prismaMock = vi.hoisted(() => {
  const mock: Record<string, any> = {
    consentDocument: { findMany: vi.fn() },
    onboardingAttempt: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn() },
    onboardingSession: { updateMany: vi.fn(), create: vi.fn() },
    auditEvent: { create: vi.fn() },
    invitation: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn()
  };
  return mock;
});
const consume = vi.hoisted(() => vi.fn());
const dispatch = vi.hoisted(() => vi.fn());

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../lib/abuseCounters.js", () => ({ consumeAbuseCounter: consume }));
vi.mock("../lib/consentContent.js", () => ({ consentDigestMatches: () => true }));
vi.mock("../lib/idempotency.js", () => ({
  claimIdempotency: vi.fn(async () => ({ kind: "claimed", record: { id: "idem_1", claim_version: 1 } })),
  completeIdempotency: vi.fn(async () => undefined),
  failIdempotency: vi.fn(async () => undefined)
}));
vi.mock("../lib/otp.js", async () => ({
  ...(await vi.importActual<typeof import("../lib/otp.js")>("../lib/otp.js")),
  dispatchOtpChallenge: dispatch
}));

const { createApp } = await import("../app.js");

const secrets = {
  INVITATION_CODE_PEPPER: "invitation-test-secret-longer-than-thirty-two-characters",
  PHONE_DIGEST_PEPPER: "phone-test-secret-longer-than-thirty-two-characters",
  OTP_CODE_PEPPER: "otp-test-secret-longer-than-thirty-two-characters",
  ONBOARDING_SESSION_PEPPER: "session-test-secret-longer-than-thirty-two-characters",
  IDEMPOTENCY_KEY_PEPPER: "idempotency-test-secret-longer-than-thirty-two-characters",
  IDEMPOTENCY_PAYLOAD_PEPPER: "payload-test-secret-longer-than-thirty-two-characters",
  ABUSE_KEY_PEPPER: "abuse-test-secret-longer-than-thirty-two-characters"
};

function config(overrides: Record<string, string | undefined> = {}) {
  return createConfig({
    APP_ENV: "local",
    DATABASE_URL: "mysql://local:local@localhost:3306/masari",
    JWT_SECRET: "open-signup-test-jwt-secret-longer-than-thirty-two",
    REFRESH_TOKEN_PEPPER: "open-signup-test-refresh-secret-longer-than-thirty-two",
    CORS_ORIGINS: "http://localhost:5173",
    TRUST_PROXY: "none",
    INVITATIONS_ENABLED: "true",
    PUBLIC_ONBOARDING_ENABLED: "true",
    OTP_PROVIDER: "fake",
    DRIVER_DOCUMENTS_ENABLED: "true",
    DRIVER_DOCUMENTS_DIR: tmpdir(),
    ...secrets,
    ...overrides
  });
}

const base = {
  APP_ENV: "local",
  DATABASE_URL: "mysql://local:local@localhost:3306/masari",
  JWT_SECRET: "open-signup-test-jwt-secret-longer-than-thirty-two",
  REFRESH_TOKEN_PEPPER: "open-signup-test-refresh-secret-longer-than-thirty-two",
  CORS_ORIGINS: "http://localhost:5173",
  TRUST_PROXY: "none"
};

const consentRows = ["terms", "privacy", "adult_self_attestation"].map((type) => ({
  id: `consent_${type}`,
  document_type: type,
  version: "1",
  locale: "en",
  content_body: "body",
  content_digest: "a".repeat(64),
  effective_at: new Date()
}));

describe("open driver / shop-owner signup switch", () => {
  it("is off by default and never needs to be listed", () => {
    expect(config().openSignupEnabled).toBe(false);
    expect(createConfig({ ...base }).openSignupEnabled).toBe(false);
  });

  it("can only be turned on with public onboarding and document storage", () => {
    expect(() => createConfig({ ...base, OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED: "true" })).toThrow(/requires PUBLIC_ONBOARDING_ENABLED/);
    expect(() => config({ OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED: "true", DRIVER_DOCUMENTS_ENABLED: "false" })).toThrow(
      /requires DRIVER_DOCUMENTS_ENABLED/
    );
    expect(config({ OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED: "true" }).openSignupEnabled).toBe(true);
  });

  it("cannot be enabled in staging or production", () => {
    const production = {
      ...base,
      APP_ENV: "production",
      DATABASE_URL: "mysql://production:secret@db.internal:3306/masari",
      JWT_SECRET: "production-jwt-secret-longer-than-thirty-two-characters",
      REFRESH_TOKEN_PEPPER: "production-refresh-secret-longer-than-thirty-two-characters",
      CORS_ORIGINS: "https://admin.masari.example",
      APP_RELEASE: "test"
    };
    expect(() => createConfig({ ...production, OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED: "true", PUBLIC_ONBOARDING_ENABLED: "true" })).toThrow();
    expect(createConfig(production).openSignupEnabled).toBe(false);
  });
});

describe("open signup start endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consume.mockResolvedValue({ allowed: true });
    prismaMock.consentDocument.findMany.mockResolvedValue(consentRows);
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.onboardingAttempt.findFirst.mockResolvedValue(null);
    prismaMock.onboardingAttempt.findMany.mockResolvedValue([]);
    prismaMock.onboardingAttempt.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "attempt_1",
      status: "created",
      ...data
    }));
    prismaMock.onboardingAttempt.findUniqueOrThrow.mockImplementation(async () => ({
      id: "attempt_1",
      status: "otp_sent",
      phone_e164: "+970590000001",
      expires_at: new Date(Date.now() + 600_000)
    }));
    prismaMock.onboardingSession.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "session_1", ...data }));
    dispatch.mockResolvedValue({ accepted: true, challengeId: "challenge_1" });
  });

  const start = (app: ReturnType<typeof createApp>, body: Record<string, unknown> = {}) =>
    request(app)
      .post("/api/v1/onboarding/attempts")
      .set("idempotency-key", "open-signup-key-1")
      .send({ role: "driver", phone: "+970590000001", email: "Applicant@Example.com", locale: "en", ...body });

  it("answers 404 and writes nothing while the switch is off", async () => {
    const response = await start(createApp(config())).expect(404);
    expect(response.body.error).toBe("onboarding_unavailable");
    expect(prismaMock.onboardingAttempt.create).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("reports the open roles only when the switch is on", async () => {
    const off = await request(createApp(config())).get("/api/v1/onboarding/config").expect(200);
    expect(off.body.open_registration_roles).toEqual([]);
    const on = await request(createApp(config({ OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED: "true" }))).get("/api/v1/onboarding/config").expect(200);
    expect(on.body.open_registration_roles).toEqual(["driver", "merchant"]);
  });

  it("starts an invitation-less attempt for a driver and sends the one-time code", async () => {
    const response = await start(createApp(config({ OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED: "true" }))).expect(201);
    expect(response.body.onboarding_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.body.next_action).toBe("verify_otp");
    expect(JSON.stringify(response.body)).not.toContain("+970590000001");
    const data = prismaMock.onboardingAttempt.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ intended_role: "driver", phone_e164: "+970590000001", delivery_email: "applicant@example.com" });
    expect(data).not.toHaveProperty("invitation_id");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("requires the email the one-time code is sent to, and never takes one with an invitation", async () => {
    const app = createApp(config({ OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED: "true" }));
    await start(app, { email: undefined }).expect(400);
    await start(app, { email: "not-an-email" }).expect(400);
    await start(app, { invitation_code: "ABCDEFGHJKLMNPQRSTUV2345" }).expect(400);
    expect(prismaMock.onboardingAttempt.create).not.toHaveBeenCalled();
  });

  it("supersedes the older open attempt for the same phone", async () => {
    prismaMock.onboardingAttempt.findMany.mockResolvedValue([{ id: "old_attempt" }]);
    await start(createApp(config({ OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED: "true" })), { role: "merchant" }).expect(201);
    expect(prismaMock.onboardingAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["old_attempt"] } }, data: expect.objectContaining({ status: "cancelled" }) })
    );
    expect(prismaMock.onboardingSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ onboarding_attempt_id: { in: ["old_attempt"] } }) })
    );
  });

  it("never opens passenger registration without an invitation", async () => {
    await start(createApp(config({ OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED: "true" })), { role: "passenger" }).expect(404);
    expect(prismaMock.onboardingAttempt.create).not.toHaveBeenCalled();
  });

  it("applies per-IP, per-phone and global caps before creating anything", async () => {
    await start(createApp(config({ OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED: "true", OPEN_SIGNUP_MAX_STARTS_PER_HOUR: "7" }))).expect(201);
    const buckets = consume.mock.calls.map((call) => call[1]);
    expect(buckets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bucketType: "open_start_ip", limit: 10, windowSeconds: 3_600 }),
        expect.objectContaining({ bucketType: "open_start_phone", limit: 5, windowSeconds: 86_400 }),
        expect.objectContaining({ bucketType: "open_start_email", limit: 5, windowSeconds: 86_400 }),
        expect.objectContaining({ bucketType: "otp_email_day", windowSeconds: 86_400 }),
        expect.objectContaining({ bucketType: "open_start_global", limit: 7, windowSeconds: 3_600 })
      ])
    );
  });

  it("answers 429 and sends no code when a cap is exceeded", async () => {
    consume.mockResolvedValue({ allowed: false });
    await start(createApp(config({ OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED: "true" }))).expect(429);
    expect(prismaMock.onboardingAttempt.create).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("gives the same answer whether or not the number already has an account", async () => {
    // The start path never looks the phone up in users, so it cannot differ.
    prismaMock.user = { findUnique: vi.fn() };
    await start(createApp(config({ OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED: "true" }))).expect(201);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    delete prismaMock.user;
  });
});
