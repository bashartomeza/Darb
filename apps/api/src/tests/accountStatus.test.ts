import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
  authSession: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  onboardingSession: { updateMany: vi.fn() },
  refreshToken: { updateMany: vi.fn() },
  auditEvent: { create: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { signAuthToken } = await import("../middleware/auth.js");

const now = new Date("2026-07-17T09:00:00.000Z");
const admin = {
  email_verified_at: new Date(),
  id: "admin_1",
  name: "Admin",
  phone: "+970590000005",
  role: "admin" as const,
  account_status: "active",
  security_version: 1,
  demo_account: false
};
const passenger = {
  id: "passenger_1",
  name: "Passenger",
  phone: "+970590000001",
  role: "passenger" as const,
  account_status: "active",
  security_version: 1,
  status_reason: null,
  status_updated_at: now,
  last_login_at: now,
  demo_account: false,
  created_at: now
};

function sessionFor(user: typeof admin | typeof passenger) {
  return {
    id: `session_${user.id}`,
    user_id: user.id,
    user,
    security_version_at_issue: user.security_version,
    expires_at: new Date(Date.now() + 60_000),
    revoked_at: null
  };
}

function authorization(user: typeof admin | typeof passenger = admin) {
  const token = signAuthToken({
    id: user.id,
    role: user.role,
    sessionId: `session_${user.id}`,
    securityVersion: user.security_version
  });
  return { Authorization: `Bearer ${token}` };
}

describe("admin account status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      where.id === "session_admin_1" ? sessionFor(admin) : sessionFor(passenger)
    );
    prismaMock.authSession.findMany.mockResolvedValue([{ id: "session_passenger_1" }]);
    prismaMock.authSession.update.mockResolvedValue({});
    prismaMock.authSession.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.onboardingSession.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUnique.mockResolvedValue(passenger);
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.user.update.mockImplementation(({ data }: { data: { account_status: string; status_reason: string | null } }) => ({
      ...passenger,
      account_status: data.account_status,
      status_reason: data.status_reason,
      status_updated_at: new Date()
    }));
    prismaMock.auditEvent.create.mockResolvedValue({ id: "audit_1" });
  });

  it("suspends a user, revokes sessions, bumps security version, and audits the safe reason", async () => {
    const response = await request(createApp())
      .patch("/api/v1/admin/users/passenger_1/status")
      .set(authorization())
      .send({ status: "suspended", reason: "  Policy   violation  ", expected_status: "active" })
      .expect(200);

    expect(response.body.user).toEqual(
      expect.objectContaining({ id: passenger.id, account_status: "suspended", status_reason: "Policy violation" })
    );
    expect(JSON.stringify(response.body)).not.toMatch(/password_hash|security_version|refresh_token|token_hash/);
    expect(prismaMock.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revoke_reason: "account_suspended" }) })
    );
    expect(prismaMock.onboardingSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user_id: passenger.id, purpose: "pending_status", revoked_at: null }),
        data: expect.objectContaining({ revoke_reason: "account_suspended" })
      })
    );
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ security_version: { increment: 1 } }) })
    );
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: admin.id,
          action: "account_status_changed",
          metadata: expect.objectContaining({
            target_user_id: passenger.id,
            previous_status: "active",
            new_status: "suspended",
            reason: "Policy violation",
            request_id: expect.any(String)
          })
        })
      })
    );
  });

  it("requires a valid reason for suspension or disablement", async () => {
    await request(createApp())
      .patch("/api/v1/admin/users/passenger_1/status")
      .set(authorization())
      .send({ status: "disabled", reason: "  ", expected_status: "active" })
      .expect(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("reactivates without restoring revoked sessions", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...passenger, account_status: "suspended", status_reason: "Policy violation" });
    await request(createApp())
      .patch("/api/v1/admin/users/passenger_1/status")
      .set(authorization())
      .send({ status: "active", expected_status: "suspended" })
      .expect(200);
    expect(prismaMock.authSession.findMany).not.toHaveBeenCalled();
    expect(prismaMock.authSession.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.onboardingSession.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a non-admin before the status transaction", async () => {
    await request(createApp())
      .patch("/api/v1/admin/users/passenger_1/status")
      .set(authorization(passenger))
      .send({ status: "suspended", reason: "Policy violation" })
      .expect(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated status mutation", async () => {
    await request(createApp())
      .patch("/api/v1/admin/users/passenger_1/status")
      .send({ status: "suspended", reason: "Policy violation", expected_status: "active" })
      .expect(401);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("requires the Admin caller's visible expected status before opening a transaction", async () => {
    await request(createApp())
      .patch("/api/v1/admin/users/passenger_1/status")
      .set(authorization())
      .send({ status: "suspended", reason: "Policy violation" })
      .expect(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("disables an active account with the same revocation and security-version semantics", async () => {
    const response = await request(createApp())
      .patch("/api/v1/admin/users/passenger_1/status")
      .set(authorization())
      .send({ status: "disabled", reason: "Access decommissioned", expected_status: "active" })
      .expect(200);
    expect(response.body.user.account_status).toBe("disabled");
    expect(prismaMock.authSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revoke_reason: "account_disabled" }) }));
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ security_version: { increment: 1 } }) }));
  });

  it.each(["driver", "merchant"])("blocks generic activation for a pending %s without writing", async (role) => {
    prismaMock.user.findUnique.mockResolvedValue({ ...passenger, role, account_status: "pending" });
    const response = await request(createApp())
      .patch("/api/v1/admin/users/pending_user/status")
      .set(authorization())
      .send({ status: "active", expected_status: "pending" })
      .expect(409);
    expect(response.body.error).toBe("approval_required");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects a stale expected status with 409 and no write", async () => {
    const response = await request(createApp())
      .patch("/api/v1/admin/users/passenger_1/status")
      .set(authorization())
      .send({ status: "suspended", reason: "Policy violation", expected_status: "suspended" })
      .expect(409);
    expect(response.body.error).toBe("account_status_conflict");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("keeps mutation B authoritative when stale mutation A reuses its active snapshot", async () => {
    let authoritativeStatus = "active";
    prismaMock.user.findUnique.mockImplementation(async () => ({ ...passenger, account_status: authoritativeStatus }));
    prismaMock.user.update.mockImplementation(async ({ data }: { data: { account_status: string; status_reason: string | null } }) => {
      authoritativeStatus = data.account_status;
      return { ...passenger, account_status: authoritativeStatus, status_reason: data.status_reason, status_updated_at: new Date() };
    });

    const mutationB = await request(createApp())
      .patch("/api/v1/admin/users/passenger_1/status")
      .set(authorization())
      .send({ status: "suspended", reason: "Tab B suspension", expected_status: "active" })
      .expect(200);
    expect(mutationB.body.user.account_status).toBe("suspended");

    const staleMutationA = await request(createApp())
      .patch("/api/v1/admin/users/passenger_1/status")
      .set(authorization())
      .send({ status: "disabled", reason: "Tab A stale disable", expected_status: "active" })
      .expect(409);
    expect(staleMutationA.body.error).toBe("account_status_conflict");
    expect(authoritativeStatus).toBe("suspended");
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
  });

  it("prevents current-admin self-suspension", async () => {
    await request(createApp())
      .patch("/api/v1/admin/users/admin_1/status")
      .set(authorization())
      .send({ status: "suspended", reason: "Administrative rotation", expected_status: "active" })
      .expect(409);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("prevents suspending the last active admin", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...passenger,
      id: "admin_2",
      role: "admin",
      name: "Other Admin"
    });
    prismaMock.user.count.mockResolvedValue(0);
    await request(createApp())
      .patch("/api/v1/admin/users/admin_2/status")
      .set(authorization())
      .send({ status: "disabled", reason: "Access decommissioned", expected_status: "active" })
      .expect(409);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("uses serializable isolation for the last-active-admin invariant", async () => {
    await request(createApp())
      .patch("/api/v1/admin/users/passenger_1/status")
      .set(authorization())
      .send({ status: "suspended", reason: "Policy violation", expected_status: "active" })
      .expect(200);

    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable"
    });
  });

  it("maps a serialization conflict to a safe account-status conflict", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(Object.assign(new Error("sensitive database detail"), { code: "P2034" }));

    const response = await request(createApp())
      .patch("/api/v1/admin/users/passenger_1/status")
      .set(authorization())
      .send({ status: "suspended", reason: "Policy violation", expected_status: "active" })
      .expect(409);

    expect(response.body.error).toBe("account_status_conflict");
    expect(JSON.stringify(response.body)).not.toContain("sensitive database detail");
  });
});
