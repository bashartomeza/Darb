import bcrypt from "bcryptjs";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  authSession: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  refreshToken: { create: vi.fn() },
  auditEvent: { create: vi.fn() },
  $transaction: vi.fn()
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");

const PASSWORD = "a-long-test-passphrase";
const hash = bcrypt.hashSync(PASSWORD, 4);
const base = {
  id: "user_1", name: "Invited", phone: "+970590003001", email: null, email_verified_at: null,
  phone_verified_at: new Date("2026-10-26T10:00:00Z"), password_hash: hash, role: "passenger",
  account_status: "active", profile_state: "complete", security_version: 1, demo_account: false,
  status_reason: null, status_updated_at: new Date(), last_login_at: null, created_at: new Date()
};

function stub(user: Record<string, unknown> | null) {
  prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { phone?: string; email?: string } }) =>
    user && (where.phone === user.phone || where.email === user.email) ? user : null
  );
}

describe("phone sign-in for invited accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.authSession.create.mockResolvedValue({
      id: "session_1", client_type: "mobile", device_name: null, created_at: new Date(), last_used_at: new Date(),
      expires_at: new Date(Date.now() + 86_400_000), revoked_at: null
    });
    prismaMock.refreshToken.create.mockResolvedValue({});
    prismaMock.user.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...base, ...data }));
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.auditEvent.create.mockResolvedValue({});
  });

  const login = (body: Record<string, unknown>, path = "/api/v1/auth/mobile/login") => request(createApp()).post(path).send(body);

  it("signs in with a verified phone and password, without an email", async () => {
    stub(base);
    const response = await login({ phone: "+970590003001", password: PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body.token).toBeTruthy();
    expect(response.body.user).toMatchObject({ role: "passenger", email_verified: true });
  });

  it("accepts the usual formatting of the number", async () => {
    stub(base);
    await login({ phone: "+970 59 000 3001", password: PASSWORD }).expect(200);
  });

  it("refuses a wrong password and an unknown number the same way", async () => {
    stub(base);
    const wrong = await login({ phone: "+970590003001", password: "not-the-password" });
    const unknown = await login({ phone: "+970590009999", password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  it("refuses a phone whose number was never verified", async () => {
    stub({ ...base, phone_verified_at: null });
    await login({ phone: "+970590003001", password: PASSWORD }).expect(401);
  });

  it("never signs an Admin in by phone, on any sign-in path", async () => {
    stub({ ...base, role: "admin" });
    await login({ phone: "+970590003001", password: PASSWORD }).expect(401);
    await login({ phone: "+970590003001", password: PASSWORD }, "/api/v1/auth/admin/login").expect(400);
  });

  it("still blocks a pending account", async () => {
    stub({ ...base, account_status: "pending" });
    const response = await login({ phone: "+970590003001", password: PASSWORD });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("account_unavailable");
  });

  it("does not turn a number without a country code into a guess", async () => {
    stub(base);
    await login({ phone: "0590003001", password: PASSWORD }).expect(401);
  });

  it("needs exactly one identifier", async () => {
    stub(base);
    await login({ password: PASSWORD }).expect(400);
    await login({ email: "a@b.co", phone: "+970590003001", password: PASSWORD }).expect(400);
  });

  it("keeps the email rules: an unverified email still cannot sign in", async () => {
    stub({ ...base, email: "x@example.com", email_verified_at: null, phone_verified_at: null });
    const response = await login({ email: "x@example.com", password: PASSWORD });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("email_verification_required");
  });
});
