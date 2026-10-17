import request from "supertest";
import bcrypt from "bcryptjs";
import { Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  $transaction: vi.fn(), user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  authActionToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  authSession: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  refreshToken: { create: vi.fn(), updateMany: vi.fn() }, userConsent: { createMany: vi.fn() }, auditEvent: { create: vi.fn() }, trip: { findMany: vi.fn() }
}));
vi.mock("../lib/prisma.js", () => ({ prisma: db }));
const { createApp } = await import("../app.js");
const { config } = await import("../config.js");
const { signAuthToken } = await import("../middleware/auth.js");
const { createOperationalLogger } = await import("../lib/logger.js");
const documents = ["terms", "privacy", "adult_self_attestation"].map((type, index) => ({
  id: `doc_${index}`, document_type: type, locale: "en", content_digest: String(index + 1).repeat(64)
}));
const registration = { name: "Passenger", email: "  Owner+tag@Example.COM ", password: "correct horse battery staple", locale: "en" };
const consents = documents.map((d) => ({ id: d.id, type: d.document_type, content_hash: d.content_digest }));
const actions: any[] = [];
const users: any[] = [];
const messages: any[] = [];
let legalReady = true;
const appConfig = { ...config, authActions: { key: { secret: "test-auth-action-secret-at-least-32-characters", version: 1 } } };
function app() {
  return createApp(appConfig, {
    emailDelivery: { kind: "test", send: async (message: any) => { messages.push(message); } },
    consentReleaseService: { current: async () => ({ ready: legalReady, release: legalReady ? { documents } : null }) } as any
  });
}
function actor(overrides: any = {}) {
  return { id: "user_1", email: "owner+tag@example.com", name: "Passenger", phone: null, phone_verified_at: null,
    profile_state: "complete", email_verified_at: new Date(), password_hash: null, role: "passenger",
    account_status: "active", security_version: 1, demo_account: false, ...overrides };
}
async function start(server = app()) {
  return request(server).post("/api/v1/auth/mobile/register/start").send(registration).expect(202);
}
function complete(body: any, proof = messages.at(-1)?.actionToken) {
  return { registration_token: body.registration_token, email_verification_token: proof, locale: "en", consents,
    adult_self_attestation: true };
}
function bearer(user: any) {
  db.authSession.findUnique.mockResolvedValue({ id: "session_1", user_id: user.id, user, security_version_at_issue: user.security_version,
    expires_at: new Date(Date.now() + 600_000), revoked_at: null });
  return `Bearer ${signAuthToken({ id: user.id, role: user.role, sessionId: "session_1", securityVersion: user.security_version })}`;
}

describe("email authentication lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks(); actions.length = 0; users.length = 0; messages.length = 0; legalReady = true;
    db.$transaction.mockImplementation(async (callback: any) => {
      const savedActions = structuredClone(actions); const savedUsers = structuredClone(users);
      try { return await callback(db); } catch (error) {
        actions.splice(0, actions.length, ...savedActions); users.splice(0, users.length, ...savedUsers); throw error;
      }
    });
    db.user.findUnique.mockImplementation(async ({ where }: any) => users.find((u) => Object.entries(where).every(([k, v]) => u[k] === v)) ?? null);
    db.user.create.mockImplementation(async ({ data }: any) => { const u = actor(data); users.push(u); return u; });
    db.user.updateMany.mockResolvedValue({ count: 1 });
    db.user.update.mockImplementation(async ({ where, data }: any) => {
      const u = users.find((u) => u.id === where.id)!;
      Object.assign(u, { ...data, ...(data.security_version ? { security_version: u.security_version + data.security_version.increment } : {}) }); return u;
    });
    db.authActionToken.create.mockImplementation(async ({ data }: any) => { const a = { id: `action_${actions.length}`, consumed_at: null, ...data }; actions.push(a); return a; });
    db.authActionToken.findUnique.mockImplementation(async ({ where }: any) => actions.find((a) => a.token_digest === where.token_digest) ?? null);
    db.authActionToken.updateMany.mockImplementation(async ({ where, data }: any) => {
      const matching = actions.filter((a) => Object.entries(where).every(([k, v]: any) => k === "expires_at" ? a[k] > v.gt : a[k] === v));
      matching.forEach((a) => Object.assign(a, data)); return { count: matching.length };
    });
    db.authSession.create.mockResolvedValue({ id: "session_1", client_type: "mobile", device_name: null, created_at: new Date(), last_used_at: new Date(), expires_at: new Date(Date.now() + 600_000), revoked_at: null });
    db.authSession.findMany.mockResolvedValue([{ id: "session_1" }]); db.authSession.updateMany.mockResolvedValue({ count: 1 });
    db.authSession.update.mockResolvedValue({}); db.refreshToken.create.mockResolvedValue({}); db.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    db.userConsent.createMany.mockResolvedValue({ count: 3 }); db.auditEvent.create.mockResolvedValue({});
    db.trip.findMany.mockResolvedValue([]);
  });

  it("creates no account at start and seals the registration data separately from emailed proof", async () => {
    const r = await start();
    expect(users).toHaveLength(0); expect(r.body.next_action).toBe("verify_email");
    expect(messages[0].to).toBe("owner+tag@example.com");
    expect(JSON.stringify(actions)).not.toContain("owner"); expect(JSON.stringify(actions)).not.toContain(registration.password);
    expect(JSON.stringify(r.body)).not.toContain(messages[0].actionToken);
    expect(JSON.stringify(r.body)).not.toContain(registration.password);
  });
  it("requires proof and current consent before passenger account/session creation", async () => {
    const server = app(); const r = await start(server);
    await request(server).post("/api/v1/auth/mobile/register/complete").send({ ...complete(r.body), consents: [] }).expect(400);
    expect(users).toHaveLength(0);
    const response = await request(server).post("/api/v1/auth/mobile/register/complete").send(complete(r.body)).expect(201);
    expect(response.body.user).toMatchObject({ role: "passenger", phone: null, profile_state: "complete" });
    expect(response.body.access_token).toEqual(expect.any(String)); expect(users[0].email_verified_at).toBeInstanceOf(Date);
    expect(await bcrypt.compare(registration.password, users[0].password_hash)).toBe(true);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(db.userConsent.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([expect.objectContaining({ consent_document_id: "doc_0", user_id: "user_1" })]) });
    await request(server).post("/api/v1/auth/mobile/register/complete").send(complete(r.body)).expect(400);
    expect(users).toHaveLength(1);
  });
  it("rejects mismatched consent without burning valid proof", async () => {
    const server = app(); const r = await start(server);
    await request(server).post("/api/v1/auth/mobile/register/complete").send({ ...complete(r.body), consents: consents.map((c) => ({ ...c, content_hash: "f".repeat(64) })) }).expect(409);
    expect(users).toHaveLength(0); expect(actions[0].consumed_at).toBeNull();
  });
  it("fails closed without legal releases or delivery", async () => {
    await request(createApp(appConfig)).post("/api/v1/auth/mobile/register/start").send(registration).expect(503);
    legalReady = false; const r = await start();
    await request(app()).post("/api/v1/auth/mobile/register/complete").send(complete(r.body)).expect(409);
    expect(users).toHaveLength(0);
  });
  it("binds proof to exactly one registration and rejects tampering and expiry", async () => {
    const r = await start(); const proof = messages[0].actionToken; const other = await start();
    await request(app()).post("/api/v1/auth/mobile/register/complete").send(complete(other.body, proof)).expect(400);
    await request(app()).post("/api/v1/auth/mobile/register/complete").send(complete({ registration_token: r.body.registration_token + "x" }, proof)).expect(400);
    actions[0].expires_at = new Date(0);
    await request(app()).post("/api/v1/auth/mobile/register/complete").send(complete(r.body, proof)).expect(400);
    expect(users).toHaveLength(0);
  });
  it("rolls back proof and user when consent persistence fails", async () => {
    const r = await start(); db.userConsent.createMany.mockRejectedValueOnce(new Error("write failure"));
    await request(app()).post("/api/v1/auth/mobile/register/complete").send(complete(r.body)).expect(500);
    expect(users).toHaveLength(0); expect(actions[0].consumed_at).toBeNull();
  });
  it("does not silently link an email collision", async () => {
    const r = await start(); users.push(actor());
    await request(app()).post("/api/v1/auth/mobile/register/complete").send(complete(r.body)).expect(409);
    expect(users).toHaveLength(1); expect(db.authSession.create).not.toHaveBeenCalled();
  });
  it.each(["short", "a".repeat(73), "😀".repeat(19)])("rejects weak or bcrypt-truncated password %s", async (password) => {
    await request(app()).post("/api/v1/auth/mobile/register/start").send({ ...registration, password }).expect(400);
    expect(messages).toHaveLength(0);
  });
  it("disables the old immediate-registration bypass", async () => {
    await request(app()).post("/api/v1/auth/register").send(registration).expect(410); expect(users).toHaveLength(0);
  });
  it("requires verified email at both password login routes", async () => {
    users.push(actor({ password_hash: await bcrypt.hash(registration.password, 4), email_verified_at: null }));
    for (const path of ["/auth/login", "/auth/mobile/login"]) {
      await request(app()).post(`/api/v1${path}`).send({ email: registration.email, password: registration.password }).expect(403);
    }
    expect(db.authSession.create).not.toHaveBeenCalled();
  });
  it.each(["/auth/mobile/login", "/auth/mobile/login/", "/AUTH/MOBILE/LOGIN"])("rejects Admin credentials on the mobile login variant %s", async (path) => {
    users.push(actor({ role: "admin", password_hash: await bcrypt.hash(registration.password, 4) }));
    const response = await request(app()).post(`/api/v1${path}`).send({ email: registration.email, password: registration.password }).expect(401);
    expect(response.body.error).toBe("invalid_credentials");
    expect(db.authSession.create).not.toHaveBeenCalled();
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });
  it("reset start is generic and confirmation revokes sessions plus increments security version once", async () => {
    users.push(actor({ password_hash: await bcrypt.hash(registration.password, 4) }));
    const unknown = await request(app()).post("/api/v1/auth/password/reset/start").send({ email: "unknown@example.com", locale: "en" }).expect(202);
    const known = await request(app()).post("/api/v1/auth/password/reset/start").send({ email: registration.email, locale: "en" }).expect(202);
    expect(known.body).toEqual(unknown.body);
    const payload = { action_token: messages[0].actionToken, password: "a different strong password" };
    await request(app()).post("/api/v1/auth/password/reset/confirm").send(payload).expect(200);
    expect(users[0].security_version).toBe(2); expect(await bcrypt.compare(payload.password, users[0].password_hash)).toBe(true);
    expect(db.authSession.updateMany).toHaveBeenCalled(); expect(db.refreshToken.updateMany).toHaveBeenCalled();
    await request(app()).post("/api/v1/auth/password/reset/confirm").send(payload).expect(400);
    expect(users[0].security_version).toBe(2);
  });
  it("password set requires fresh reauthentication and revokes existing sessions", async () => {
    const u = actor({ password_hash: await bcrypt.hash(registration.password, 4) }); users.push(u);
    const token = bearer(u);
    await request(app()).post("/api/v1/auth/password/set").set("Authorization", token).send({ password: "a different strong password" }).expect(403);
    await request(app()).post("/api/v1/auth/password/set").set("Authorization", token).send({ password: "a different strong password", current_password: registration.password }).expect(200);
    expect(users[0].security_version).toBe(2); expect(db.authSession.updateMany).toHaveBeenCalled();
  });
  it("verifies existing email through one-time proof", async () => {
    users.push(actor({ email_verified_at: null }));
    await request(app()).post("/api/v1/auth/email/verify/start").send({ email: registration.email, locale: "en" }).expect(202);
    const payload = { action_token: messages[0].actionToken };
    await request(app()).post("/api/v1/auth/email/verify/confirm").send(payload).expect(200);
    expect(users[0].email_verified_at).toBeInstanceOf(Date);
    await request(app()).post("/api/v1/auth/email/verify/confirm").send(payload).expect(400);
  });
  it("exchanges a registration email proof once before consent", async () => {
    const r = await start(); const first = messages[0].actionToken;
    const proof = await request(app()).post("/api/v1/auth/email/verify/confirm").send({ action_token: first, registration_token: r.body.registration_token }).expect(200);
    expect(users).toHaveLength(0); expect(proof.body.next_action).toBe("consent_required");
    await request(app()).post("/api/v1/auth/mobile/register/complete").send(complete(r.body, first)).expect(400);
    await request(app()).post("/api/v1/auth/mobile/register/complete").send(complete(r.body, proof.body.email_verification_token)).expect(201);
  });
  it("sets a passwordless account password only with its own fresh emailed proof", async () => {
    users.push(actor()); const token = bearer(users[0]);
    await request(app()).post("/api/v1/auth/password/set/start").set("Authorization", token).send({ locale: "en" }).expect(202);
    await request(app()).post("/api/v1/auth/password/set").set("Authorization", token).send({ password: registration.password, reauthentication_token: messages[0].actionToken }).expect(200);
    expect(users[0].security_version).toBe(2); expect(await bcrypt.compare(registration.password, users[0].password_hash)).toBe(true);
  });
  it("limits case/space aliases of the same email as one identity", async () => {
    const server = createApp({ ...appConfig, rateLimits: { ...appConfig.rateLimits, login: { windowMs: 60000, max: 2 } } }, {
      emailDelivery: { kind: "test", send: async () => {} }
    });
    for (const email of ["rate@example.com", "other@example.com"]) {
      await request(server).post("/api/v1/auth/password/reset/start").send({ email, locale: "en" }).expect(202);
    }
    await request(server).post("/api/v1/auth/password/reset/start").send({ email: "  RATE@EXAMPLE.COM  ", locale: "en" }).expect(202);
    await request(server).post("/api/v1/auth/password/reset/start").send({ email: "rate@example.com", locale: "en" }).expect(429);
  });
  it("blocks products for a legacy complete-phone session without verified email", async () => {
    const u = actor({ profile_state: "complete", email_verified_at: null }); users.push(u);
    const response = await request(app()).get("/api/v1/trips").set("Authorization", bearer(u)).expect(403);
    expect(response.body.error).toBe("email_verification_required");
    await request(app()).get("/api/v1/me").set("Authorization", bearer(u)).expect(200);
  });
  it("exposes the effective legal documents even with invitation onboarding disabled", async () => {
    const response = await request(app()).get("/api/v1/auth/consents?locale=en").expect(200);
    expect(response.body.documents).toHaveLength(3);
    expect(response.body.documents[0]).toMatchObject({ id: "doc_0", type: "terms", content_hash: "1".repeat(64), locale: "en" });
    legalReady = false;
    await request(app()).get("/api/v1/auth/consents?locale=en").expect(503);
  });
  it("rejects privileged fields and duplicate consent types", async () => {
    await request(app()).post("/api/v1/auth/mobile/register/start").send({ ...registration, role: "admin" }).expect(400);
    const r = await start();
    await request(app()).post("/api/v1/auth/mobile/register/complete").send({ ...complete(r.body), consents: [consents[0], consents[0], consents[0]] }).expect(409);
    expect(users).toHaveLength(0);
  });
  it("rejects reset proof after security version changes or for the wrong action purpose", async () => {
    users.push(actor({ password_hash: await bcrypt.hash(registration.password, 4) }));
    await request(app()).post("/api/v1/auth/password/reset/start").send({ email: registration.email, locale: "en" }).expect(202);
    users[0].security_version = 2;
    await request(app()).post("/api/v1/auth/password/reset/confirm").send({ action_token: messages[0].actionToken, password: registration.password }).expect(400);
    expect(users[0].security_version).toBe(2);
    const r = await start();
    await request(app()).post("/api/v1/auth/password/reset/confirm").send({ action_token: messages.at(-1).actionToken, password: registration.password }).expect(400);
    expect(r.body.next_action).toBe("verify_email");
  });
  it("redacts registration and reauthentication credentials from structured logs", () => {
    let output = "";
    const stream = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
    const logger = createOperationalLogger({ ...appConfig, logLevel: "info" }, stream);
    for (const field of ["registration_token", "email_verification_token", "reauthentication_token", "current_password"]) {
      logger.info({ context: { [field]: "sensitive-lifecycle-credential" } }, "auth lifecycle");
    }
    expect(output).not.toContain("sensitive-lifecycle-credential");
  });
  it.each(["/auth/password/reset/start", "/auth/email/verify/start"])("returns the same response before a delayed delivery settles at %s", async (path) => {
    users.push(actor({ password_hash: await bcrypt.hash(registration.password, 4) }));
    let release!: () => void;
    const delivery = new Promise<void>((resolve) => { release = resolve; });
    const server = createApp(appConfig, { emailDelivery: { kind: "test", send: () => delivery } });
    const known = request(server).post(`/api/v1${path}`).send({ email: registration.email, locale: "en" }).then((r) => r);
    try {
      const unknown = await request(server).post(`/api/v1${path}`).send({ email: "unknown@example.com", locale: "en" }).expect(202);
      const result = await Promise.race([known, new Promise<"delivery_blocked">((resolve) => setTimeout(() => resolve("delivery_blocked"), 250))]);
      expect(result).not.toBe("delivery_blocked");
      expect(result).toMatchObject({ status: 202, body: unknown.body });
    } finally { release(); await known; }
  });
  it("revokes a proof when detached delivery fails and retains a safe operational event", async () => {
    users.push(actor({ password_hash: await bcrypt.hash(registration.password, 4) }));
    let rejectDelivery!: (error: Error) => void;
    const delivery = new Promise<void>((_resolve, reject) => { rejectDelivery = reject; });
    let output = "";
    const stream = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
    const logger = createOperationalLogger({ ...appConfig, logLevel: "info" }, stream);
    const server = createApp(appConfig, { logger, emailDelivery: { kind: "test", send: () => delivery } });
    const response = request(server).post("/api/v1/auth/password/reset/start").send({ email: registration.email, locale: "en" }).then((r) => r);
    await vi.waitFor(() => expect(actions).toHaveLength(1));
    rejectDelivery(new Error("provider-secret-response"));
    await response;
    await vi.waitFor(() => expect(actions[0].consumed_at).toBeInstanceOf(Date));
    expect(output).toContain("auth_email_delivery_failed");
    expect(output).not.toContain("provider-secret-response");
  });
  it("rejects unrelated email on password-set start and throttles varying aliases as one authenticated account", async () => {
    users.push(actor()); const token = bearer(users[0]);
    const server = createApp({ ...appConfig, rateLimits: { ...appConfig.rateLimits, login: { windowMs: 60000, max: 2 } } }, {
      emailDelivery: { kind: "test", send: async () => {} }
    });
    await request(server).post("/api/v1/auth/password/set/start").set("Authorization", token).send({ locale: "en", email: "first@example.com" }).expect(400);
    await request(server).post("/api/v1/auth/password/set/start").set("Authorization", token).send({ locale: "en", email: "second@example.com" }).expect(400);
    await request(server).post("/api/v1/auth/password/set/start").set("Authorization", token).send({ locale: "en", email: "third@example.com" }).expect(429);
    expect(messages).toHaveLength(0);
  });
});
