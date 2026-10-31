import request from "supertest";
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  authSession: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  refreshToken: { updateMany: vi.fn() },
  auditEvent: { create: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { createOrResetAdmin, listAdmins, validateAdminInput, AdminBootstrapError } = await import("../services/adminBootstrap.js");
const { parseCliArgs, stripTrailingNewline } = await import("../scripts/adminCliInput.js");

const PASSWORD = "correct horse battery staple";
const guard = { demoFeaturesEnabled: false, databaseName: "masari_prod", demoResetAllowedDatabases: ["masari_demo"], allowDemoDatabase: false };
const db = prismaMock as never;
const base = { email: "Owner@Example.com", name: "Owner", password: PASSWORD, resetPassword: false, dryRun: false, guard };

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  return "no_error";
}

describe("admin bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.create.mockResolvedValue({});
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.authSession.findMany.mockResolvedValue([{ id: "s1" }]);
    prismaMock.authSession.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.auditEvent.create.mockResolvedValue({});
  });

  it("creates a verified, active admin with an audit event and canonical email", async () => {
    const result = await createOrResetAdmin(db, base);
    expect(result).toMatchObject({ action: "created", dryRun: false, email: "owner@example.com" });
    const data = prismaMock.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ email: "owner@example.com", name: "Owner", role: "admin", account_status: "active", profile_state: "complete", demo_account: false });
    expect(data.email_verified_at).toBeInstanceOf(Date);
    expect(data.password_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(data.password_hash).not.toContain(PASSWORD);
    const audit = prismaMock.auditEvent.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: "admin_action", user_id: data.id, entity_id: data.id });
    expect(JSON.stringify(prismaMock.auditEvent.create.mock.calls)).not.toContain(PASSWORD);
    expect(JSON.stringify(prismaMock.auditEvent.create.mock.calls)).not.toContain(data.password_hash);
  });

  it("produces a hash the real admin login route accepts", async () => {
    await createOrResetAdmin(db, base);
    const created = prismaMock.user.create.mock.calls[0][0].data;
    prismaMock.user.findUnique.mockResolvedValue({ ...created, phone: null, security_version: 1, last_login_at: null });
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.authSession.create.mockResolvedValue({ id: "sess", client_type: "admin", device_name: null, created_at: new Date(), last_used_at: new Date(), expires_at: new Date(Date.now() + 60_000), revoked_at: null });
    const ok = await request(createApp()).post("/api/v1/auth/admin/login").send({ email: "owner@example.com", password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.access_token).toEqual(expect.any(String));
    await request(createApp()).post("/api/v1/auth/admin/login").send({ email: "owner@example.com", password: `${PASSWORD}x` }).expect(401);
  });

  it("refuses an existing email without writing", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1", role: "passenger", email: "owner@example.com" });
    expect(await rejection(createOrResetAdmin(db, base))).toBe("email_already_exists");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("enforces the staff password policy", async () => {
    expect(await rejection(createOrResetAdmin(db, { ...base, password: "short-password" }))).toBe("password_too_short");
    expect(await rejection(createOrResetAdmin(db, { ...base, password: "a".repeat(73) }))).toBe("password_invalid");
    expect(await rejection(createOrResetAdmin(db, { ...base, password: "ا".repeat(40) }))).toBe("password_invalid");
    expect(() => validateAdminInput({ email: "not-an-email" })).toThrow(AdminBootstrapError);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("requires a name to create", async () => {
    expect(await rejection(createOrResetAdmin(db, { ...base, name: undefined }))).toBe("name_required");
  });

  it("dry-run writes nothing", async () => {
    const result = await createOrResetAdmin(db, { ...base, dryRun: true });
    expect(result).toMatchObject({ action: "created", dryRun: true });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
    prismaMock.user.findUnique.mockResolvedValue({ id: "a1", role: "admin", email_verified_at: new Date() });
    await createOrResetAdmin(db, { ...base, resetPassword: true, dryRun: true });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("reset-password bumps security_version, revokes sessions and audits", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "a1", role: "admin", email_verified_at: new Date() });
    const result = await createOrResetAdmin(db, { ...base, resetPassword: true });
    expect(result.action).toBe("password_reset");
    const update = prismaMock.user.update.mock.calls[0][0];
    expect(update.data.security_version).toEqual({ increment: 1 });
    expect(await bcrypt.compare(PASSWORD, update.data.password_hash)).toBe(true);
    expect(prismaMock.authSession.updateMany).toHaveBeenCalled();
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalled();
    expect(prismaMock.auditEvent.create.mock.calls[0][0].data.metadata).toMatchObject({ operation: "admin_password_reset_cli" });
  });

  it("reset-password refuses unknown and non-admin accounts", async () => {
    expect(await rejection(createOrResetAdmin(db, { ...base, resetPassword: true }))).toBe("admin_not_found");
    prismaMock.user.findUnique.mockResolvedValue({ id: "p1", role: "passenger" });
    expect(await rejection(createOrResetAdmin(db, { ...base, resetPassword: true }))).toBe("admin_not_found");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("refuses demo environments, demo databases and demo data unless explicitly allowed", async () => {
    expect(await rejection(createOrResetAdmin(db, { ...base, guard: { ...guard, demoFeaturesEnabled: true } }))).toBe("demo_environment_refused");
    expect(await rejection(createOrResetAdmin(db, { ...base, guard: { ...guard, databaseName: "masari_demo" } }))).toBe("demo_database_refused");
    prismaMock.user.count.mockResolvedValue(3);
    expect(await rejection(createOrResetAdmin(db, base))).toBe("demo_accounts_present_refused");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    const allowed = await createOrResetAdmin(db, { ...base, guard: { ...guard, demoFeaturesEnabled: true, allowDemoDatabase: true } });
    expect(allowed.action).toBe("created");
  });

  it("lists admins without selecting any hash", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    await listAdmins(db);
    const args = prismaMock.user.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ role: "admin" });
    expect(Object.keys(args.select).sort()).toEqual(["account_status", "created_at", "email", "last_login_at"]);
  });

  it("CLI parsing rejects a password argument", () => {
    expect(() => parseCliArgs(["--password=hunter2hunter2hunter2"])).toThrow("password_must_not_be_a_cli_argument");
    expect(() => parseCliArgs(["--password", "x"])).toThrow();
    const parsed = parseCliArgs(["--email", "a@b.co", "--name=Owner", "--dry-run", "--password-stdin"]);
    expect(parsed.values.get("email")).toBe("a@b.co");
    expect(parsed.values.get("name")).toBe("Owner");
    expect(parsed.flags.has("dry-run")).toBe(true);
    expect(stripTrailingNewline("secret\r\n")).toBe("secret");
    expect(stripTrailingNewline("secret\n\n")).toBe("secret\n");
  });
});
