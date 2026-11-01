import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  user: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  driverProfile: { findUnique: vi.fn() },
  driverVerification: { findUnique: vi.fn() },
  driverRoute: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { signAuthToken } = await import("../middleware/auth.js");

type Role = "passenger" | "driver" | "merchant" | "admin";

function account(id: string, role: Role, accountStatus: string) {
  return {
    id,
    role,
    name: id,
    phone: "+970590000099",
    account_status: accountStatus,
    security_version: 1,
    profile_state: "complete",
    email_verified_at: new Date(),
    demo_account: false
  };
}

function bearer(user: ReturnType<typeof account>) {
  const token = signAuthToken({ id: user.id, role: user.role, sessionId: `session_${user.id}`, securityVersion: 1 });
  return { Authorization: `Bearer ${token}` };
}

function sessionFor(user: ReturnType<typeof account>) {
  return { id: `session_${user.id}`, user_id: user.id, user, security_version_at_issue: 1, expires_at: new Date(Date.now() + 60_000), revoked_at: null };
}

// A submitted driver application stays account_status=pending while under review and after rejection
// (the rejection is recorded on DriverVerification), so both are "not active" to the session layer.
const pendingDriver = account("driver_pending", "driver", "pending");
const rejectedDriver = account("driver_rejected", "driver", "pending");
const approvedDriver = account("driver_ok", "driver", "active");
const passenger = account("passenger_1", "passenger", "active");
const merchant = account("merchant_1", "merchant", "active");
const admin = account("admin_1", "admin", "active");
const everyone = [pendingDriver, rejectedDriver, approvedDriver, passenger, merchant, admin];

const driverRoutes: Array<["get" | "post" | "put" | "patch", string]> = [
  ["get", "/api/v1/driver/routes"],
  ["get", "/api/v1/driver/routes/active"],
  ["get", "/api/v1/driver/performance"],
  ["post", "/api/v1/driver/routes"],
  ["put", "/api/v1/driver/online-state"],
  ["patch", "/api/v1/driver/routes/route_1/deactivate"],
  ["get", "/api/v1/driver/availabilities"],
  ["post", "/api/v1/driver/availabilities"]
];

describe("driver endpoints are closed to applicants that are not approved", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const user = everyone.find((candidate) => `session_${candidate.id}` === where.id);
      return user ? sessionFor(user) : null;
    });
    prismaMock.authSession.update.mockResolvedValue({});
    prismaMock.driverVerification.findUnique.mockResolvedValue({ status: "rejected", rejection_reason: "Blurry licence" });
    prismaMock.driverProfile.findUnique.mockResolvedValue({ id: "profile_1", user_id: "x", verified: false });
  });

  for (const [label, driver] of [["pending", pendingDriver], ["rejected", rejectedDriver]] as const) {
    it.each(driverRoutes)(`${label} driver gets 403 on %s %s`, async (method, path) => {
      const response = await request(createApp())[method](path).set(bearer(driver)).set("Idempotency-Key", "k".repeat(16)).send({});
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("account_unavailable");
      expect(prismaMock.driverRoute.create).not.toHaveBeenCalled();
      expect(prismaMock.driverRoute.updateMany).not.toHaveBeenCalled();
    });
  }

  it.each(driverRoutes.filter(([, path]) => !path.includes("availabilities")))("a passenger or merchant gets 403 forbidden on %s %s", async (method, path) => {
    for (const user of [passenger, merchant]) {
      const response = await request(createApp())[method](path).set(bearer(user)).set("Idempotency-Key", "k".repeat(16)).send({});
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("forbidden");
    }
  });

  it("an unauthenticated caller gets 401 and a driver cannot reach admin routes", async () => {
    await request(createApp()).get("/api/v1/driver/routes").expect(401);
    await request(createApp()).get("/api/v1/admin/driver-verifications").set(bearer(approvedDriver)).expect(403);
    await request(createApp())
      .post("/api/v1/admin/driver-verifications/driver_pending/approve")
      .set(bearer(pendingDriver))
      .send({ expected_revision: 1 })
      .expect(403);
  });

  it("an applicant or ordinary user cannot change their own role or status through the admin APIs", async () => {
    for (const user of [pendingDriver, passenger, merchant, approvedDriver]) {
      const response = await request(createApp())
        .patch(`/api/v1/admin/users/${user.id}/status`)
        .set(bearer(user))
        .send({ status: "active", expected_status: "pending", role: "admin" });
      expect([401, 403]).toContain(response.status);
    }
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("an admin cannot activate a pending driver through the generic status endpoint", async () => {
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.user.findUnique.mockResolvedValue({ ...pendingDriver, status_reason: null, status_updated_at: new Date(), last_login_at: null, created_at: new Date() });
    const response = await request(createApp())
      .patch(`/api/v1/admin/users/${pendingDriver.id}/status`)
      .set(bearer(admin))
      .send({ status: "active", expected_status: "pending" });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("approval_required");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
