import request from "supertest";
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ $transaction: vi.fn(), user: { findUnique: vi.fn(), updateMany: vi.fn() }, externalIdentity: { findUnique: vi.fn(), create: vi.fn() }, authActionToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), count: vi.fn() }, authSession: { findUnique: vi.fn(), update: vi.fn() }, trip: { findMany: vi.fn() }, auditEvent: { create: vi.fn() } }));
vi.mock("../lib/prisma.js", () => ({ prisma: db }));
const abuse = vi.hoisted(() => ({ count: 0 }));
vi.mock("../lib/abuseCounters.js", () => ({ consumeAbuseCounter: vi.fn(async (_db: unknown, input: { limit: number }) => ({ allowed: ++abuse.count <= input.limit })) }));
const { createApp } = await import("../app.js");
const { config } = await import("../config.js");
const { signAuthToken } = await import("../middleware/auth.js");
let users: any[], actions: any[], identities: any[], messages: any[], audits: any[];
const cfg = { ...config, authActions: { key: { secret: "test-identity-secret-at-least-32-characters", version: 1 } }, googleAuth: { ...config.googleAuth, mobileClientIds: ["mobile-client"] } };
const verifier = vi.fn();
function app(extra: any = {}, settings = cfg) { return createApp(settings, { googleVerifier: verifier, emailDelivery: { kind: "test", send: async (m: any) => { messages.push(m); } }, phoneVerificationProvider: { kind: "test", send: async (m: any) => { messages.push(m); } }, ...extra } as any); }
function bearer(id = "u1") { return `Bearer ${signAuthToken({ id, role: "passenger", sessionId: id, securityVersion: 1 })}`; }
const startPath = "/api/v1/profile/phone/start-verification";
const confirmPath = "/api/v1/profile/phone/confirm-verification";
const linkPath = "/api/v1/auth/identities/google/link";
const phone = "+14155552671";
function matches(row: any, where: any): boolean { return Object.entries(where).every(([k, v]: any) => k === "OR" ? v.some((w: any) => matches(row, w)) : k === "payload" ? row.payload?.phone_digest === v.equals : v && typeof v === "object" && "gte" in v ? row[k] >= v.gte : v && typeof v === "object" && "gt" in v ? row[k] > v.gt : row[k] === v); }
describe("explicit identity linking and verified phone profile", () => {
  beforeEach(async () => {
    vi.clearAllMocks(); abuse.count = 0; actions = []; identities = []; messages = []; audits = [];
    users = [{ id: "u1", role: "passenger", email: "owner@example.com", email_verified_at: new Date(), password_hash: await bcrypt.hash("correct-password", 4), security_version: 1, account_status: "active", profile_state: "phone_required", phone: null, phone_verified_at: null }];
    verifier.mockResolvedValue({ sub: "subject", email: "different@example.com", emailVerified: true });
    db.user.findUnique.mockImplementation(async ({ where }) => users.find((u) => matches(u, where)) ?? null);
    db.user.updateMany.mockImplementation(async ({ where, data }) => { const rows = users.filter((u) => matches(u, where)); rows.forEach((u) => Object.assign(u, data)); return { count: rows.length }; });
    db.externalIdentity.findUnique.mockImplementation(async ({ where }) => identities.find((i) => matches(i, where.provider_provider_subject ?? where.user_id_provider)) ?? null);
    db.externalIdentity.create.mockImplementation(async ({ data }) => { identities.push(data); return data; });
    db.authActionToken.create.mockImplementation(async ({ data }) => { const a = { id: `a${actions.length}`, consumed_at: null, created_at: new Date(), ...data }; actions.push(a); return a; });
    db.authActionToken.findUnique.mockImplementation(async ({ where }) => actions.find((a) => matches(a, where)) ?? null);
    db.authActionToken.count.mockImplementation(async ({ where }) => actions.filter((a) => matches(a, where)).length);
    db.authActionToken.updateMany.mockImplementation(async ({ where, data }) => { const rows = actions.filter((a) => matches(a, where)); rows.forEach((a) => Object.assign(a, data)); return { count: rows.length }; });
    let queue = Promise.resolve();
    db.$transaction.mockImplementation((callback) => { const run = queue.then(async () => { const snapshot = structuredClone({ users, actions, identities, audits }); const { $transaction, ...tx } = db; try { return await callback(tx); } catch (e) { ({ users, actions, identities, audits } = snapshot); throw e; } }); queue = run.catch(() => {}); return run; });
    db.authSession.findUnique.mockImplementation(async ({ where }) => ({ id: where.id, user_id: where.id, user: users.find((u) => u.id === where.id), security_version_at_issue: 1, expires_at: new Date(Date.now() + 600000), revoked_at: null }));
    db.authSession.update.mockResolvedValue({}); db.trip.findMany.mockResolvedValue([]);
    db.auditEvent.create.mockImplementation(async ({ data }) => { audits.push(data); return data; });
  });
  it("requires fresh password before linking and never selects an account by provider email", async () => {
    const server = app();
    await request(server).post(linkPath).set("authorization", bearer()).send({ id_token: "raw" }).expect(403);
    await request(server).post(linkPath).set("authorization", bearer()).send({ id_token: "raw", current_password: "wrong" }).expect(403);
    expect(identities).toHaveLength(0);
    await request(server).post(linkPath).set("authorization", bearer()).send({ id_token: "raw", current_password: "correct-password" }).expect(200);
    expect(identities).toEqual([expect.objectContaining({ user_id: "u1", provider: "google", provider_subject: "subject" })]);
    expect(users[0].email).toBe("owner@example.com"); expect(verifier).toHaveBeenCalledWith("raw", ["mobile-client"]);
  });
  it("rejects subject and existing-provider collisions without identity changes", async () => {
    identities.push({ user_id: "other", provider: "google", provider_subject: "subject" });
    const server = app();
    const r = await request(server).post(linkPath).set("authorization", bearer()).send({ id_token: "raw", current_password: "correct-password" }).expect(409);
    expect(r.body.error).toBe("google_identity_conflict"); expect(identities).toHaveLength(1);
    identities = [{ user_id: "u1", provider: "google", provider_subject: "another" }];
    await request(server).post(linkPath).set("authorization", bearer()).send({ id_token: "raw", current_password: "correct-password" }).expect(409);
    expect(identities[0].provider_subject).toBe("another");
  });
  it("allows a passwordless user to explicitly link with a one-time email proof", async () => {
    users[0].password_hash = null; const server = app();
    await request(server).post(`${linkPath}/start`).set("authorization", bearer()).send({ locale: "en" }).expect(202);
    const proof = messages[0].actionToken;
    await request(server).post(linkPath).set("authorization", bearer()).send({ id_token: "raw", reauthentication_token: proof }).expect(200);
    await request(server).post(linkPath).set("authorization", bearer()).send({ id_token: "raw", reauthentication_token: proof }).expect(400);
    expect(identities).toHaveLength(1);
  });
  it("persists no phone/code and unlocks product flows only after proof", async () => {
    const server = app();
    await request(server).get("/api/v1/trips").set("authorization", bearer()).expect(403);
    const r = await request(server).post(startPath).set("authorization", bearer()).send({ phone: "+1 (415) 555-2671", locale: "en" }).expect(202);
    expect(JSON.stringify(actions)).not.toContain(phone); expect(JSON.stringify(actions)).not.toContain(messages[0].code);
    expect(users[0].phone).toBeNull();
    const body = { action_token: r.body.action_token, phone, code: messages[0].code };
    await request(server).post(confirmPath).set("authorization", bearer()).send(body).expect(200);
    expect(users[0]).toMatchObject({ phone, profile_state: "complete", phone_verified_at: expect.any(Date) });
    await request(server).get("/api/v1/trips").set("authorization", bearer()).expect(200);
    await request(server).post(confirmPath).set("authorization", bearer()).send(body).expect(400);
  });
  it("burns a wrong-code attempt and enforces persistent issuance throttles", async () => {
    const server = app(); const r = await request(server).post(startPath).set("authorization", bearer()).send({ phone, locale: "ar" }).expect(202);
    const code = messages[0].code; const wrong = code === "000000" ? "111111" : "000000";
    await request(server).post(confirmPath).set("authorization", bearer()).send({ action_token: r.body.action_token, phone, code: wrong }).expect(400);
    await request(server).post(confirmPath).set("authorization", bearer()).send({ action_token: r.body.action_token, phone, code }).expect(400);
    for (let i = 0; i < 4; i++) await request(server).post(startPath).set("authorization", bearer()).send({ phone, locale: "ar" }).expect(202);
    await request(server).post(startPath).set("authorization", bearer()).send({ phone, locale: "ar" }).expect(429);
    expect(users[0].profile_state).toBe("phone_required");
  });
  it("rolls back phone collision without completing or consuming the valid proof", async () => {
    const server = app(); const r = await request(server).post(startPath).set("authorization", bearer()).send({ phone, locale: "en" }).expect(202);
    users.push({ id: "other", phone });
    await request(server).post(confirmPath).set("authorization", bearer()).send({ action_token: r.body.action_token, phone, code: messages[0].code }).expect(409);
    expect(users[0].phone).toBeNull(); expect(actions[0].consumed_at).toBeNull();
  });
  it("caps phone_already_in_use answers per account: 409 a few times, then a plain 429", async () => {
    const server = app(); const r = await request(server).post(startPath).set("authorization", bearer()).send({ phone, locale: "en" }).expect(202);
    users.push({ id: "other", phone });
    const body = { action_token: r.body.action_token, phone, code: messages[0].code };
    for (let i = 0; i < 3; i++) await request(server).post(confirmPath).set("authorization", bearer()).send(body).expect(409);
    await request(server).post(confirmPath).set("authorization", bearer()).send(body).expect(429);
  });
  it("rejects invalid phone and fails closed for missing or test production providers", async () => {
    await request(app()).post(startPath).set("authorization", bearer()).send({ phone: "00000", locale: "en" }).expect(400);
    await request(app({ phoneVerificationProvider: undefined })).post(startPath).set("authorization", bearer()).send({ phone, locale: "en" }).expect(503);
    await request(app({}, { ...cfg, isProduction: true })).post(startPath).set("authorization", bearer()).send({ phone, locale: "en" }).expect(503);
    expect(actions).toHaveLength(0);
  });
  it("records successful linking and phone completion without credentials", async () => {
    const server = app();
    await request(server).post(linkPath).set("authorization", bearer()).send({ id_token: "raw", current_password: "correct-password" }).expect(200);
    const r = await request(server).post(startPath).set("authorization", bearer()).send({ phone, locale: "en" }).expect(202);
    await request(server).post(confirmPath).set("authorization", bearer()).send({ action_token: r.body.action_token, phone, code: messages[0].code }).expect(200);
    expect(audits).toEqual(expect.arrayContaining([expect.objectContaining({ action: "auth_google_link", user_id: "u1" }), expect.objectContaining({ action: "otp_verified", user_id: "u1" })]));
    expect(JSON.stringify(audits)).not.toMatch(/correct-password|different@example|14155552671/);
  });
  it("allows only one account to claim a phone under concurrent confirmation", async () => {
    users.push({ ...users[0], id: "u2", email: "two@example.com" }); const server = app();
    const a = await request(server).post(startPath).set("authorization", bearer()).send({ phone, locale: "en" }).expect(202); const codeA = messages[0].code;
    const b = await request(server).post(startPath).set("authorization", bearer("u2")).send({ phone, locale: "en" }).expect(202); const codeB = messages[1].code;
    const results = await Promise.all([request(server).post(confirmPath).set("authorization", bearer()).send({ action_token: a.body.action_token, phone, code: codeA }), request(server).post(confirmPath).set("authorization", bearer("u2")).send({ action_token: b.body.action_token, phone, code: codeB })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(users.filter((u) => u.phone === phone)).toHaveLength(1); expect(users.filter((u) => u.profile_state === "complete")).toHaveLength(1);
  });
  it("allows only one explicit concurrent link for a provider subject", async () => {
    users.push({ ...users[0], id: "u2", email: "two@example.com" }); const server = app();
    const results = await Promise.all(["u1", "u2"].map((id) => request(server).post(linkPath).set("authorization", bearer(id)).send({ id_token: "raw", current_password: "correct-password" })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]); expect(identities).toHaveLength(1);
  });
  it("rejects cross-account, expired, and security-version-stale phone proofs", async () => {
    users.push({ ...users[0], id: "u2", email: "two@example.com" }); const server = app();
    const r = await request(server).post(startPath).set("authorization", bearer()).send({ phone, locale: "en" }).expect(202);
    const body = { action_token: r.body.action_token, phone, code: messages[0].code };
    await request(server).post(confirmPath).set("authorization", bearer("u2")).send(body).expect(400);
    expect(actions[0].consumed_at).toBeNull(); users[0].security_version = 2;
    await request(server).post(confirmPath).set("authorization", bearer()).send(body).expect(401);
    users[0].security_version = 1; actions[0].expires_at = new Date(0);
    await request(server).post(confirmPath).set("authorization", bearer()).send(body).expect(400);
    expect(users[0].phone).toBeNull();
  });
  it("revokes failed delivery and blocks inactive users and Admin linking", async () => {
    const server = app({ phoneVerificationProvider: { kind: "test", send: async () => { throw new Error("provider-secret"); } } });
    await request(server).post(startPath).set("authorization", bearer()).send({ phone, locale: "en" }).expect(503);
    expect(actions[0].consumed_at).toBeInstanceOf(Date); expect(users[0].phone).toBeNull();
    users[0].account_status = "suspended";
    await request(server).post(startPath).set("authorization", bearer()).send({ phone, locale: "en" }).expect(403);
    users[0].account_status = "active"; users[0].role = "admin";
    const admin = `Bearer ${signAuthToken({ id: "u1", role: "admin", sessionId: "u1", securityVersion: 1 })}`;
    await request(server).post(linkPath).set("authorization", admin).send({ id_token: "raw", current_password: "correct-password" }).expect(403);
    expect(identities).toHaveLength(0);
  });
  it("rejects a reset/set email proof at the link boundary and preserves it", async () => {
    users[0].password_hash = null; const server = app();
    await request(server).post("/api/v1/auth/password/set/start").set("authorization", bearer()).send({ locale: "en" }).expect(202);
    await request(server).post(linkPath).set("authorization", bearer()).send({ id_token: "raw", reauthentication_token: messages[0].actionToken }).expect(400);
    expect(actions[0].consumed_at).toBeNull(); expect(identities).toHaveLength(0);
  });
  it("emails the phone code to the verified account email and stores the phone unverified (no SMS)", async () => {
    const { EmailPhoneVerificationProvider } = await import("../services/identityProfile.js");
    const sent: any[] = [];
    const server = app({ phoneVerificationProvider: new EmailPhoneVerificationProvider({ kind: "approved", send: async (m: any) => { sent.push(m); } }) });
    const r = await request(server).post(startPath).set("authorization", bearer()).send({ phone, locale: "en" }).expect(202);
    expect(sent).toEqual([expect.objectContaining({ to: "owner@example.com", purpose: "phone_code", locale: "en" })]);
    expect(JSON.stringify(r.body)).not.toContain(sent[0].actionToken);
    await request(server).post(confirmPath).set("authorization", bearer()).send({ action_token: r.body.action_token, phone, code: sent[0].actionToken }).expect(200);
    // The code proves the mailbox, not the phone: no phone sign-in, profile still completes.
    expect(users[0]).toMatchObject({ phone, profile_state: "complete", phone_verified_at: null });
  });
  it("refuses to email a phone code to an unverified email", async () => {
    const { EmailPhoneVerificationProvider } = await import("../services/identityProfile.js");
    users[0].email_verified_at = null;
    const server = app({ phoneVerificationProvider: new EmailPhoneVerificationProvider({ kind: "approved", send: async () => {} }) });
    await request(server).post(startPath).set("authorization", bearer()).send({ phone, locale: "en" }).expect(403);
    expect(actions).toHaveLength(0);
  });
  it("expires Google linking email reauthentication within fifteen minutes", async () => {
    users[0].password_hash = null; const server = app(); const before = Date.now();
    await request(server).post(`${linkPath}/start`).set("authorization", bearer()).send({ locale: "en" }).expect(202);
    expect(actions[0].expires_at.getTime() - before).toBeLessThanOrEqual(901000);
    expect(messages[0].expiresAt).toEqual(actions[0].expires_at);
  });
});
