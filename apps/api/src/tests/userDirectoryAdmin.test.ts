import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
  passengerRequest: { count: vi.fn() },
  merchantOrder: { count: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { signAuthToken } = await import("../middleware/auth.js");

const now = new Date("2026-08-23T10:00:00.000Z");
const admin = { email_verified_at: new Date(), id: "admin_1", name: "QA Admin", phone: "+15550000001", role: "admin" as const, account_status: "active", security_version: 1, demo_account: false };
const passengerAuth = { ...admin, id: "passenger_auth", role: "passenger" as const };

const baseUser = {
  id: "user_without_operations",
  name: "QA No Operations",
  phone: "+15550000010",
  role: "passenger" as const,
  account_status: "active" as const,
  status_reason: null,
  status_updated_at: now,
  last_login_at: null,
  demo_account: false,
  created_at: now,
  driver_profile: null,
  driver_verification: null
};

function sessionFor(user: typeof admin | typeof passengerAuth) {
  return { id: `session_${user.id}`, user_id: user.id, user, security_version_at_issue: 1, expires_at: new Date(Date.now() + 60_000), revoked_at: null };
}

function authorization(user: typeof admin | typeof passengerAuth = admin) {
  return { Authorization: `Bearer ${signAuthToken({ id: user.id, role: user.role, sessionId: `session_${user.id}`, securityVersion: 1 })}` };
}

describe("Admin user directory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => where.id === "session_admin_1" ? sessionFor(admin) : sessionFor(passengerAuth));
    prismaMock.authSession.update.mockResolvedValue({});
    prismaMock.user.findMany.mockResolvedValue([baseUser]);
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.user.findUnique.mockResolvedValue(baseUser);
    prismaMock.authSession.aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { last_used_at: null } });
    prismaMock.passengerRequest.count.mockResolvedValue(0);
    prismaMock.merchantOrder.count.mockResolvedValue(0);
  });

  it("requires authentication and Admin role for list and detail", async () => {
    await request(createApp()).get("/api/v1/admin/users").expect(401);
    await request(createApp()).get(`/api/v1/admin/users/${baseUser.id}`).expect(401);
    await request(createApp()).get("/api/v1/admin/users").set(authorization(passengerAuth)).expect(403);
    await request(createApp()).get(`/api/v1/admin/users/${baseUser.id}`).set(authorization(passengerAuth)).expect(403);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it("lists a user with no profile, request, or order through the complete User table", async () => {
    const response = await request(createApp()).get("/api/v1/admin/users").set(authorization()).expect(200);
    expect(response.body).toEqual({ users: [expect.objectContaining({ id: baseUser.id, role_context: { kind: "passenger" } })], page: 1, limit: 50, total: 1 });
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {}, skip: 0, take: 50, orderBy: [{ created_at: "desc" }, { id: "asc" }] }));
  });

  it("uses bounded pagination and deterministic ordering", async () => {
    await request(createApp()).get("/api/v1/admin/users?page=3&limit=25").set(authorization()).expect(200);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 50, take: 25, orderBy: [{ created_at: "desc" }, { id: "asc" }] }));
    await request(createApp()).get("/api/v1/admin/users?limit=101").set(authorization()).expect(400);
  });

  it("applies name and phone searches server-side", async () => {
    await request(createApp()).get("/api/v1/admin/users?search=QA%20No%20Operations").set(authorization()).expect(200);
    expect(prismaMock.user.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { OR: expect.arrayContaining([{ name: { contains: "QA No Operations" } }]) } }));
    await request(createApp()).get("/api/v1/admin/users?search=%2B15550000010").set(authorization()).expect(200);
    expect(prismaMock.user.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { OR: expect.arrayContaining([{ phone: { contains: "+15550000010" } }]) } }));
  });

  it("combines role, status, demo, and search filters", async () => {
    await request(createApp()).get("/api/v1/admin/users?role=driver&account_status=pending&demo_account=false&search=QA").set(authorization()).expect(200);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ role: "driver", account_status: "pending", demo_account: false, OR: expect.any(Array) }) }));
  });

  it("returns only the safe directory projection", async () => {
    const response = await request(createApp()).get("/api/v1/admin/users").set(authorization()).expect(200);
    expect(JSON.stringify(response.body)).not.toMatch(/password_hash|phone_digest|security_version|refresh_token|token_hash|otp|invitation|abuse|jwt/i);
    const select = prismaMock.user.findMany.mock.calls[0]![0].select;
    expect(select).not.toHaveProperty("password_hash");
    expect(select).not.toHaveProperty("phone_digest");
    expect(select).not.toHaveProperty("security_version");
  });

  it.each([
    ["passenger", baseUser, { kind: "passenger" }],
    ["approved driver", { ...baseUser, id: "approved_driver", role: "driver", driver_profile: { id: "profile_1", vehicle_type: "sedan", seats_total: 4, parcel_capacity: 3, verified: true, trust_score: 80 }, driver_verification: { id: "verification_1", status: "approved", revision: 2, submitted_at: now, reviewed_at: now, reviewed_by: { id: admin.id, name: admin.name } } }, expect.objectContaining({ kind: "driver", driver_profile_verified: true, driver_verification_status: "approved" })],
    ["pending driver", { ...baseUser, id: "pending_driver", role: "driver", account_status: "pending", driver_verification: { id: "verification_2", status: "pending", revision: 1, submitted_at: now, reviewed_at: null, reviewed_by: null } }, expect.objectContaining({ kind: "driver", driver_profile_exists: false, driver_verification_status: "pending" })],
    ["pending merchant", { ...baseUser, id: "pending_merchant", role: "merchant", account_status: "pending" }, { kind: "merchant", merchant_approval_connected: true, application_submitted: true }]
  ])("returns safe %s detail with authoritative role context", async (_label, user, roleContext) => {
    prismaMock.user.findUnique.mockResolvedValue(user);
    const response = await request(createApp()).get(`/api/v1/admin/users/${user.id}`).set(authorization()).expect(200);
    expect(response.body.user).toEqual(expect.objectContaining({ id: user.id, role_context: roleContext, active_session_count: 0 }));
    expect(JSON.stringify(response.body)).not.toMatch(/password_hash|phone_digest|security_version|refresh_token|token_hash|otp|invitation|abuse|jwt/i);
  });

  it("returns 404 without running relation summary queries", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await request(createApp()).get("/api/v1/admin/users/missing").set(authorization()).expect(404);
    expect(prismaMock.authSession.aggregate).not.toHaveBeenCalled();
  });
});
