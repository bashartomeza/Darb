import request from "supertest";
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ $transaction: vi.fn(), user: { findUnique: vi.fn(), updateMany: vi.fn() }, externalIdentity: { findUnique: vi.fn(), create: vi.fn() }, authActionToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), count: vi.fn() }, authSession: { findUnique: vi.fn(), update: vi.fn() }, trip: { findMany: vi.fn() }, auditEvent: { create: vi.fn() } }));
vi.mock("../lib/prisma.js", () => ({ prisma: db }));
const { createApp } = await import("../app.js");
const { config } = await import("../config.js");
const { signAuthToken } = await import("../middleware/auth.js");
let users: any[], actions: any[], identities: any[], messages: any[], audits: any[];
const cfg = { ...config, authActions: { key: { secret: "test-identity-secret-at-least-32-characters", version: 1 } }, googleAuth: { ...config.googleAuth, mobileClientIds: ["mobile-client"] } };
const verifier = vi.fn();
function app(extra: any = {}, settings = cfg) { return createApp(settings, { googleVerifier: verifier, emailDelivery: { kind: "test", send: async (m: any) => { messages.push(m); } }, ...extra } as any); }
function bearer(id = "u1") { return `Bearer ${signAuthToken({ id, role: "passenger", sessionId: id, securityVersion: 1 })}`; }
const linkPath = "/api/v1/auth/identities/google/link";
function matches(row: any, where: any): boolean { return Object.entries(where).every(([k, v]: any) => k === "OR" ? v.some((w: any) => matches(row, w)) : v && typeof v === "object" && "gte" in v ? row[k] >= v.gte : v && typeof v === "object" && "gt" in v ? row[k] > v.gt : row[k] === v); }
describe("explicit identity linking", () => {
  beforeEach(async () => {
    vi.clearAllMocks(); actions = []; identities = []; messages = []; audits = [];
    users = [{ id: "u1", role: "passenger", email: "owner@example.com", email_verified_at: new Date(), password_hash: await bcrypt.hash("correct-password", 4), security_version: 1, account_status: "active", profile_state: "complete", phone: null, phone_verified_at: null }];
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
  it("records successful linking without credentials", async () => {
    const server = app();
    await request(server).post(linkPath).set("authorization", bearer()).send({ id_token: "raw", current_password: "correct-password" }).expect(200);
    expect(audits).toEqual(expect.arrayContaining([expect.objectContaining({ action: "auth_google_link", user_id: "u1" })]));
    expect(JSON.stringify(audits)).not.toMatch(/correct-password|different@example|14155552671/);
  });
  it("allows only one explicit concurrent link for a provider subject", async () => {
    users.push({ ...users[0], id: "u2", email: "two@example.com" }); const server = app();
    const results = await Promise.all(["u1", "u2"].map((id) => request(server).post(linkPath).set("authorization", bearer(id)).send({ id_token: "raw", current_password: "correct-password" })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]); expect(identities).toHaveLength(1);
  });
  it("blocks inactive users and Admin linking", async () => {
    const server = app();
    users[0].account_status = "suspended";
    await request(server).post(linkPath).set("authorization", bearer()).send({ id_token: "raw", current_password: "correct-password" }).expect(403);
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
  it("expires Google linking email reauthentication within fifteen minutes", async () => {
    users[0].password_hash = null; const server = app(); const before = Date.now();
    await request(server).post(`${linkPath}/start`).set("authorization", bearer()).send({ locale: "en" }).expect(202);
    expect(actions[0].expires_at.getTime() - before).toBeLessThanOrEqual(901000);
    expect(messages[0].expiresAt).toEqual(actions[0].expires_at);
  });
});
