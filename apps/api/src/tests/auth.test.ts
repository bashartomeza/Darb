import request from "supertest";
import bcrypt from "bcryptjs";
import { Writable } from "node:stream";
import { createOperationalLogger } from "../lib/logger.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn()
  },
  authSession: { create: vi.fn() },
  externalIdentity: { findUnique: vi.fn(), create: vi.fn() },
  authActionToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  userConsent: { createMany: vi.fn() },
  refreshToken: { create: vi.fn() },
  auditEvent: {
    create: vi.fn()
  }
}));

const verifyGoogleIdTokenMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { config } = await import("../config.js");

function passengerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "user_1",
    name: "Demo Passenger",
    phone: "+970590000001",
    email: "passenger@example.com",
    email_verified_at: new Date(),
    google_sub: null,
    password_hash: null as string | null,
    role: "passenger",
    account_status: "active",
    security_version: 1,
    demo_account: true,
    ...overrides
  };
}

describe("auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.authSession.create.mockResolvedValue({
      id: "session_1",
      client_type: "mobile",
      device_name: null,
      created_at: new Date(),
      last_used_at: new Date(),
      expires_at: new Date(Date.now() + 86_400_000),
      revoked_at: null
    });
    prismaMock.refreshToken.create.mockResolvedValue({});
    prismaMock.user.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(passengerRow(data))
    );
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.auditEvent.create.mockResolvedValue({ id: "audit_1" });
  });

  it.each(["passenger", "driver", "merchant"])("rejects %s at the Admin password boundary before session creation", async (role) => {
    prismaMock.user.findUnique.mockResolvedValue(passengerRow({ role, password_hash: await bcrypt.hash("secret", 4) }));
    await request(createApp()).post("/api/v1/auth/admin/login").send({ email: "passenger@example.com", password: "secret" }).expect(401);
    expect(prismaMock.authSession.create).not.toHaveBeenCalled();
  });

  it("issues an Admin session only for verified active Admin email credentials", async () => {
    prismaMock.user.findUnique.mockResolvedValue(passengerRow({ role: "admin", password_hash: await bcrypt.hash("secret", 4) }));
    const response = await request(createApp()).post("/api/v1/auth/admin/login").send({ email: "passenger@example.com", password: "secret" }).expect(200);
    expect(response.body.access_token).toEqual(expect.any(String));
    expect(response.body.refresh_token).toBeUndefined();
    expect(prismaMock.authSession.create.mock.calls[0][0].data.client_type).toBe("admin");
    await request(createApp()).post("/api/v1/auth/admin/login").send({ phone: "+970590000001", password: "secret" }).expect(400);
  });

  it("Admin Google resolves only linked subjects with the Admin audience", async () => {
    const appConfig = { ...config, googleAuth: { ...config.googleAuth, adminClientIds: ["admin-web"], mobileClientIds: ["mobile"] } };
    const verifier = vi.fn().mockResolvedValue({ sub: "subject", email: "changed@example.com", emailVerified: true });
    prismaMock.externalIdentity.findUnique.mockResolvedValue({ user: passengerRow({ role: "admin" }) });
    const app = createApp(appConfig, { googleVerifier: verifier });
    const response = await request(app).post("/api/v1/auth/admin/google").send({ id_token: "credential" }).expect(200);
    expect(response.body.refresh_token).toBeUndefined();
    expect(verifier).toHaveBeenCalledWith("credential", ["admin-web"]);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.externalIdentity.findUnique).toHaveBeenCalledWith({ where: { provider_provider_subject: { provider: "google", provider_subject: "subject" } }, include: { user: true } });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.externalIdentity.create).not.toHaveBeenCalled();
  });

  it.each([null, "passenger", "driver", "merchant", "suspended_admin"])("refuses ineligible Admin Google identity %s without writes", async (kind) => {
    prismaMock.externalIdentity.findUnique.mockResolvedValue(kind ? { user: passengerRow({ role: kind === "suspended_admin" ? "admin" : kind, account_status: kind === "suspended_admin" ? "suspended" : "active" }) } : null);
    const app = createApp({ ...config, googleAuth: { ...config.googleAuth, adminClientIds: ["admin-web"] } }, { googleVerifier: async () => ({ sub: "subject", email: "admin@example.com", emailVerified: true }) });
    await request(app).post("/api/v1/auth/admin/google").send({ id_token: "credential" }).expect(401);
    expect(prismaMock.authSession.create).not.toHaveBeenCalled();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("reports Admin Google unavailable without an Admin audience and fails closed", async () => {
    const app = createApp({ ...config, googleAuth: { ...config.googleAuth, adminClientIds: [], mobileClientIds: ["mobile"] } });
    const capabilities = await request(app).get("/api/v1/auth/capabilities").expect(200);
    expect(capabilities.body.google_admin_login_available).toBe(false);
    expect(capabilities.body.google_admin_client_id).toBeNull();
    await request(app).post("/api/v1/auth/admin/google").send({ id_token: "credential" }).expect(503);
  });

  it("logs in a seeded account by email and returns a token", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      passengerRow({ password_hash: await bcrypt.hash("test-passenger-password", 4) })
    );

    const response = await request(createApp())
      .post("/api/v1/auth/login")
      .send({ email: "passenger@example.com", password: "test-passenger-password" })
      .expect(200);

    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body.access_token).toBe(response.body.token);
    expect(response.body.refresh_token).toEqual(expect.any(String));
    expect(response.body.session).toEqual(expect.objectContaining({ id: "session_1", is_current: true }));
    expect(response.body.user.role).toBe("passenger");
    expect(response.body.user.email).toBe("passenger@example.com");
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: "passenger@example.com" }
    });
    expect(prismaMock.authSession.create).toHaveBeenCalledOnce();
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: "user_1",
        role: "passenger",
        account_status: "active",
        security_version: 1
      },
      data: { last_login_at: expect.any(Date) }
    });
    expect(prismaMock.refreshToken.create).toHaveBeenCalledOnce();
    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(2);
    const storedHash = prismaMock.refreshToken.create.mock.calls[0]?.[0]?.data?.token_hash;
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(response.body)).not.toContain(storedHash);
  });

  it("normalises the email before lookup", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      passengerRow({ password_hash: await bcrypt.hash("test-passenger-password", 4) })
    );

    await request(createApp())
      .post("/api/v1/auth/login")
      .send({ email: "  Passenger@Example.com ", password: "test-passenger-password" })
      .expect(200);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: "passenger@example.com" }
    });
  });

  it("creates the access credential before the login transaction callback resolves", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      passengerRow({ password_hash: await bcrypt.hash("test-passenger-password", 4) })
    );
    prismaMock.$transaction.mockImplementationOnce(async (callback: (tx: typeof prismaMock) => unknown) => {
      const result = await callback(prismaMock);
      expect(result).toEqual(expect.objectContaining({ kind: "success", token: expect.any(String) }));
      return result;
    });

    await request(createApp())
      .post("/api/v1/auth/login")
      .send({ email: "passenger@example.com", password: "test-passenger-password" })
      .expect(200);
  });

  it("creates an admin session without issuing a browser refresh token", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      passengerRow({
        id: "admin_1",
        name: "Admin",
        email: "admin@example.com",
        role: "admin",
        password_hash: await bcrypt.hash("test-admin-password", 4)
      })
    );
    prismaMock.authSession.create.mockResolvedValue({
      id: "session_admin",
      client_type: "admin",
      device_name: null,
      created_at: new Date(),
      last_used_at: new Date(),
      expires_at: new Date(Date.now() + 3_600_000),
      revoked_at: null
    });

    const response = await request(createApp())
      .post("/api/v1/auth/login")
      .send({ email: "admin@example.com", password: "test-admin-password" })
      .expect(200);

    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body).not.toHaveProperty("refresh_token");
    expect(response.body).not.toHaveProperty("refresh_token_expires_in");
    expect(prismaMock.authSession.create).toHaveBeenCalledOnce();
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
  });

  for (const accountStatus of ["pending", "suspended", "disabled"] as const) {
    it(`blocks login for a ${accountStatus} account with a safe error`, async () => {
      prismaMock.user.findUnique.mockResolvedValue(
        passengerRow({
          demo_account: false,
          security_version: 2,
          account_status: accountStatus,
          password_hash: await bcrypt.hash("test-passenger-password", 4)
        })
      );

      const response = await request(createApp())
        .post("/api/v1/auth/login")
        .send({ email: "passenger@example.com", password: "test-passenger-password" })
        .expect(403);

      expect(response.body).toEqual(
        expect.objectContaining({ error: "account_unavailable", request_id: expect.any(String) })
      );
      expect(response.body).not.toHaveProperty("reason");
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.authSession.create).not.toHaveBeenCalled();
      expect(prismaMock.auditEvent.create).toHaveBeenCalledOnce();
    });
  }

  it("rejects invalid login credentials", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const missingUser = await request(createApp())
      .post("/api/v1/auth/login")
      .send({ email: "passenger@example.com", password: "bad" })
      .expect(401);

    prismaMock.user.findUnique.mockResolvedValue(
      passengerRow({ password_hash: await bcrypt.hash("different-password", 4) })
    );
    const wrongPassword = await request(createApp())
      .post("/api/v1/auth/login")
      .send({ email: "passenger@example.com", password: "bad" })
      .expect(401);

    expect(missingUser.body.error).toBe("invalid_credentials");
    expect(wrongPassword.body.error).toBe("invalid_credentials");
  });

  it("rejects password login for an account that only has Google linked", async () => {
    prismaMock.user.findUnique.mockResolvedValue(passengerRow({ password_hash: null, google_sub: "g-1" }));

    const response = await request(createApp())
      .post("/api/v1/auth/login")
      .send({ email: "passenger@example.com", password: "anything" })
      .expect(401);

    expect(response.body.error).toBe("invalid_credentials");
  });

  it("does not create a session when account eligibility changes before the transaction", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      passengerRow({ password_hash: await bcrypt.hash("test-passenger-password", 4) })
    );
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });

    const response = await request(createApp())
      .post("/api/v1/auth/login")
      .send({ email: "passenger@example.com", password: "test-passenger-password" })
      .expect(403);

    expect(response.body.error).toBe("account_unavailable");
    expect(prismaMock.authSession.create).not.toHaveBeenCalled();
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
  });

  it("allows local admin console CORS preflight", async () => {
    const response = await request(createApp())
      .options("/api/v1/auth/login")
      .set("Origin", "http://localhost:5175")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type")
      .expect(204);

    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5175");
  });
});

describe("retired immediate registration", () => {
  it("returns registration_flow_required and never creates a user or session", async () => {
    vi.clearAllMocks();
    const response = await request(createApp()).post("/api/v1/auth/register")
      .send({ name: "Sara", email: "sara@example.com", password: "supersecret1" }).expect(410);
    expect(response.body.error).toBe("registration_flow_required");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.authSession.create).not.toHaveBeenCalled();
  });
});

describe("auth google", () => {
  const configured = { ...config, authActions: { key: { secret: "google-action-test-secret-32-characters-long", version: 1 } },
    googleAuth: { mobileClientIds: ["mobile-client"], adminClientIds: ["admin-client"], passengerSignupMode: "open" as const, passengerAllowlist: [] } };
  const documents = ["terms", "privacy", "adult_self_attestation"].map((type, i) => ({ id: `doc_${i}`, document_type: type, locale: "en", content_digest: String(i + 1).repeat(64) }));
  function googleApp() { return createApp(configured, { googleVerifier: verifyGoogleIdTokenMock,
    consentReleaseService: { current: async () => ({ ready: true, release: { documents } }) } as any }); }
  beforeEach(() => {
    vi.clearAllMocks(); verifyGoogleIdTokenMock.mockReset();
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.authSession.create.mockResolvedValue({ id: "session_1", client_type: "mobile", device_name: null,
      created_at: new Date(), last_used_at: new Date(), expires_at: new Date(Date.now() + 86400000), revoked_at: null });
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 }); prismaMock.refreshToken.create.mockResolvedValue({});
    prismaMock.auditEvent.create.mockResolvedValue({}); prismaMock.externalIdentity.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.authActionToken.create.mockImplementation(async ({ data }: any) => ({ id: "action_1", ...data }));
    verifyGoogleIdTokenMock.mockResolvedValue({ sub: "google-1", email: "passenger@example.com", emailVerified: true });
  });
  it("fails closed when Google has no endpoint-specific audience", async () => {
    await request(createApp()).post("/api/v1/auth/mobile/google").send({ id_token: "x" }).expect(503);
    expect(verifyGoogleIdTokenMock).not.toHaveBeenCalled();
  });
  it("publishes login capabilities before authentication without exposing allowlist data", async () => {
    const response = await request(googleApp()).get("/api/v1/auth/capabilities").expect(200);
    expect(response.body).toMatchObject({ google_mobile_login_available: true, google_passenger_signup_mode: "open" });
    expect(response.body.passenger_allowlist).toBeUndefined();
    const disabled = await request(createApp()).get("/api/v1/auth/capabilities").expect(200);
    expect(disabled.body).toMatchObject({ google_mobile_login_available: false, google_passenger_signup_mode: "disabled" });
  });
  it.each(["/auth/google", "/auth/mobile/google"])("issues a consent grant without account creation at %s", async (path) => {
    const r = await request(googleApp()).post("/api/v1" + path).send({ id_token: "valid-token" }).expect(202);
    expect(r.body).toMatchObject({ registration_token: expect.any(String), next_action: "consent_required" });
    expect(r.body.access_token).toBeUndefined(); expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.authSession.create).not.toHaveBeenCalled(); expect(prismaMock.externalIdentity.create).not.toHaveBeenCalled();
  });
  it("returns explicit-link-required on email collision with no writes", async () => {
    prismaMock.user.findUnique.mockResolvedValue(passengerRow());
    const r = await request(googleApp()).post("/api/v1/auth/mobile/google").send({ id_token: "valid-token" }).expect(409);
    expect(r.body.error).toBe("explicit_link_required"); expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled(); expect(prismaMock.authSession.create).not.toHaveBeenCalled();
  });
  it("completes the consent grant as a restricted passenger through the HTTP endpoint", async () => {
    const server = googleApp();
    const start = await request(server).post("/api/v1/auth/mobile/google").send({ id_token: "valid-token" }).expect(202);
    const stored = prismaMock.authActionToken.create.mock.calls[0][0].data;
    prismaMock.authActionToken.findUnique.mockResolvedValue({ id: "action_1", consumed_at: null, ...stored });
    prismaMock.authActionToken.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.create.mockImplementation(async ({ data }: any) => passengerRow(data));
    const result = await request(server).post("/api/v1/auth/mobile/google/complete-registration").send({
      registration_token: start.body.registration_token, name: "Passenger", locale: "en", adult_self_attestation: true,
      consents: documents.map((d) => ({ id: d.id, type: d.document_type, content_hash: d.content_digest }))
    }).expect(201);
    expect(result.body.user).toMatchObject({ role: "passenger", phone: null, profile_state: "phone_required", email_verified: true });
    expect(result.body.access_token).toEqual(expect.any(String));
    expect(prismaMock.externalIdentity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ provider: "google", provider_subject: "google-1", user_id: "user_1" }) });
  });
  it("creates a normal session for the existing linked mobile identity", async () => {
    prismaMock.externalIdentity.findUnique.mockResolvedValue({ id: "ext", user: passengerRow() });
    const r = await request(googleApp()).post("/api/v1/auth/mobile/google").send({ id_token: "valid-token" }).expect(200);
    expect(r.body.access_token).toEqual(expect.any(String)); expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
  it("rejects unverified or invalid credentials without forwarding verifier details", async () => {
    verifyGoogleIdTokenMock.mockResolvedValue({ sub: "g", email: "p@example.com", emailVerified: false });
    const r = await request(googleApp()).post("/api/v1/auth/mobile/google").send({ id_token: "valid-token" }).expect(401);
    expect(r.body.error).toBe("invalid_google_token");
    verifyGoogleIdTokenMock.mockRejectedValue(new Error("raw-credential-leak"));
    const r2 = await request(googleApp()).post("/api/v1/auth/mobile/google").send({ id_token: "raw-credential-leak" }).expect(401);
    expect(JSON.stringify(r2.body)).not.toContain("raw-credential-leak");
  });
  it("keeps Google credentials and provider error details out of operational logs", async () => {
    const output: string[] = [];
    const logger = createOperationalLogger({ ...configured, logLevel: "info" }, new Writable({ write(chunk, _encoding, callback) { output.push(String(chunk)); callback(); } }));
    verifyGoogleIdTokenMock.mockRejectedValue(new Error("secret-provider-credential private-google-email@example.com"));
    await request(createApp(configured, { googleVerifier: verifyGoogleIdTokenMock, logger })).post("/api/v1/auth/mobile/google")
      .send({ id_token: "secret-provider-credential" }).expect(401);
    expect(output.join("")).not.toMatch(/secret-provider-credential|private-google-email/);
    expect(output.join("")).toContain("authentication_failed");
  });
});
