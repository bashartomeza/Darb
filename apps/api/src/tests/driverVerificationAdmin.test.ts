import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: { findUnique: vi.fn(), update: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  driverVerification: {
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn()
  },
  driverProfile: { create: vi.fn(), update: vi.fn() },
  driverVerificationDecision: { create: vi.fn() },
  auditEvent: { create: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { signAuthToken } = await import("../middleware/auth.js");

const now = new Date("2026-08-19T10:00:00.000Z");
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
const passenger = { ...admin, id: "passenger_1", role: "passenger" as const };
const candidate = {
  id: "driver_user_1",
  name: "Pending Driver",
  phone: "+970590000099",
  role: "driver" as const,
  account_status: "pending" as const,
  status_reason: null,
  status_updated_at: now,
  last_login_at: null,
  demo_account: false,
  created_at: now,
  driver_profile: null
};
const pendingVerification = {
  id: "verification_1",
  user_id: candidate.id,
  status: "pending" as const,
  rejection_reason: null,
  revision: 1,
  submitted_at: now,
  reviewed_at: null,
  reviewed_by_id: null,
  created_at: now,
  updated_at: now,
  user: candidate,
  decisions: [],
  evidence: [],
  documents: [],
  reviewed_by: null
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
  const token = signAuthToken({ id: user.id, role: user.role, sessionId: `session_${user.id}`, securityVersion: 1 });
  return { Authorization: `Bearer ${token}` };
}

function approvedVerification() {
  return {
    ...pendingVerification,
    status: "approved" as const,
    revision: 2,
    reviewed_at: now,
    reviewed_by_id: admin.id,
    reviewed_by: { id: admin.id, name: admin.name },
    user: {
      ...candidate,
      account_status: "active" as const,
      driver_profile: {
        id: "profile_1",
        user_id: candidate.id,
        vehicle_type: "sedan",
        seats_total: 4,
        parcel_capacity: 6,
        verified: true,
        trust_score: 70,
        created_at: now
      }
    }
  };
}

describe("Admin driver verification lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      where.id === "session_admin_1" ? sessionFor(admin) : sessionFor(passenger)
    );
    prismaMock.authSession.update.mockResolvedValue({});
    prismaMock.driverVerification.findMany.mockResolvedValue([pendingVerification]);
    prismaMock.driverVerification.count.mockResolvedValue(1);
    prismaMock.driverVerification.findUnique.mockResolvedValue(pendingVerification);
    prismaMock.driverVerification.findUniqueOrThrow.mockResolvedValue(approvedVerification());
    prismaMock.driverVerification.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.driverProfile.create.mockResolvedValue(approvedVerification().user.driver_profile);
    prismaMock.driverProfile.update.mockResolvedValue({});
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.auditEvent.create.mockResolvedValue({ id: "audit_1" });
  });

  it("protects every verification endpoint with 401 and 403", async () => {
    const endpoints = [
      { method: "get", path: "/api/v1/admin/driver-verifications" },
      { method: "get", path: `/api/v1/admin/driver-verifications/${candidate.id}` },
      { method: "post", path: `/api/v1/admin/driver-verifications/${candidate.id}/approve`, body: { expected_revision: 1, profile: { vehicle_type: "sedan", seats_total: 4, parcel_capacity: 6 } } },
      { method: "post", path: `/api/v1/admin/driver-verifications/${candidate.id}/reject`, body: { expected_revision: 1, reason: "Documents are unclear" } }
    ] as const;

    for (const endpoint of endpoints) {
      await request(createApp())[endpoint.method](endpoint.path).send("body" in endpoint ? endpoint.body : undefined).expect(401);
      await request(createApp())[endpoint.method](endpoint.path).set(authorization(passenger)).send("body" in endpoint ? endpoint.body : undefined).expect(403);
    }
    expect(prismaMock.driverVerification.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("lists only the requested lifecycle state with safe candidate data", async () => {
    const response = await request(createApp())
      .get("/api/v1/admin/driver-verifications?status=pending&page=1&limit=25")
      .set(authorization())
      .expect(200);

    expect(response.body).toEqual(expect.objectContaining({ page: 1, limit: 25, total: 1 }));
    expect(response.body.verifications[0]).toEqual(expect.objectContaining({ status: "pending", revision: 1, evidence: { status: "not_collected", items: [], documents: [] } }));
    expect(prismaMock.driverVerification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "pending", user: { review_submitted_at: { not: null } } }, skip: 0, take: 25 }));
    expect(JSON.stringify(response.body)).not.toMatch(/password_hash|security_version|token_hash/);
  });

  it("returns real detail by driver user id", async () => {
    const response = await request(createApp())
      .get(`/api/v1/admin/driver-verifications/${candidate.id}`)
      .set(authorization())
      .expect(200);

    expect(response.body.verification.candidate).toEqual(expect.objectContaining({ id: candidate.id, account_status: "pending" }));
    expect(response.body.verification.driver_profile).toBeNull();
  });

  it("approves atomically, creates an explicit profile, activates pending onboarding, and audits", async () => {
    const response = await request(createApp())
      .post(`/api/v1/admin/driver-verifications/${candidate.id}/approve`)
      .set(authorization())
      .send({ expected_revision: 1, profile: { vehicle_type: "  family   sedan ", seats_total: 4, parcel_capacity: 6 } })
      .expect(200);

    expect(response.body.verification).toEqual(expect.objectContaining({ status: "approved", revision: 2 }));
    expect(prismaMock.driverVerification.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "pending", revision: 1 }), data: expect.objectContaining({ status: "approved", revision: { increment: 1 } }) }));
    expect(prismaMock.driverProfile.create).toHaveBeenCalledWith({ data: expect.objectContaining({ user_id: candidate.id, vehicle_type: "family sedan", verified: true }) });
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ account_status: "active" }) }));
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "admin_action", metadata: expect.objectContaining({ action: "driver_verification_approved", target_user_id: candidate.id }) }) }));
    expect(prismaMock.driverVerificationDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ verification_id: "verification_1", revision: 1, decision: "approved", decided_by_id: "admin_1" }) });
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("refuses to decide an application the applicant has not submitted for review", async () => {
    prismaMock.driverVerification.findUnique.mockResolvedValue({
      ...pendingVerification,
      user: { ...candidate, review_submitted_at: null }
    });
    const approve = await request(createApp())
      .post(`/api/v1/admin/driver-verifications/${candidate.id}/approve`)
      .set(authorization())
      .send({ expected_revision: 1, profile: { vehicle_type: "sedan", seats_total: 4, parcel_capacity: 6 } })
      .expect(409);
    expect(approve.body.error).toBe("application_not_submitted");
    await request(createApp())
      .post(`/api/v1/admin/driver-verifications/${candidate.id}/reject`)
      .set(authorization())
      .send({ expected_revision: 1, reason: "Incomplete" })
      .expect(409);
    expect(prismaMock.driverVerification.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects with a normalized persisted reason and disables an existing verified profile", async () => {
    const existingProfile = { ...approvedVerification().user.driver_profile, verified: false };
    prismaMock.driverVerification.findUnique.mockResolvedValue({ ...pendingVerification, user: { ...candidate, account_status: "active", driver_profile: existingProfile } });
    prismaMock.driverVerification.findUniqueOrThrow.mockResolvedValue({ ...pendingVerification, status: "rejected", revision: 2, rejection_reason: "Licence image is unreadable", reviewed_at: now, reviewed_by: { id: admin.id, name: admin.name }, user: { ...candidate, account_status: "active", driver_profile: existingProfile } });

    const response = await request(createApp())
      .post(`/api/v1/admin/driver-verifications/${candidate.id}/reject`)
      .set(authorization())
      .send({ expected_revision: 1, reason: "  Licence   image is unreadable  " })
      .expect(200);

    expect(response.body.verification).toEqual(expect.objectContaining({ status: "rejected", rejection_reason: "Licence image is unreadable" }));
    expect(prismaMock.driverProfile.update).toHaveBeenCalledWith({ where: { id: "profile_1" }, data: { verified: false } });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.driverVerificationDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ decision: "rejected", reason: "Licence image is unreadable", revision: 1 }) });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ action: "driver_verification_rejected", reason: "Licence image is unreadable" }) }) }));
  });

  it("requires a rejection reason and a real profile payload when no profile exists", async () => {
    await request(createApp()).post(`/api/v1/admin/driver-verifications/${candidate.id}/reject`).set(authorization()).send({ expected_revision: 1, reason: "  " }).expect(400);
    await request(createApp()).post(`/api/v1/admin/driver-verifications/${candidate.id}/approve`).set(authorization()).send({ expected_revision: 1 }).expect(400);
    await request(createApp()).post(`/api/v1/admin/driver-verifications/${candidate.id}/approve`).set(authorization()).send({ expected_revision: 1, profile: { vehicle_type: "   ", seats_total: 4, parcel_capacity: 6 } }).expect(400);
    expect(prismaMock.driverVerification.updateMany).not.toHaveBeenCalled();
  });

  it("rejects stale or duplicate decisions without changing downstream state", async () => {
    prismaMock.driverVerification.updateMany.mockResolvedValue({ count: 0 });

    const response = await request(createApp())
      .post(`/api/v1/admin/driver-verifications/${candidate.id}/approve`)
      .set(authorization())
      .send({ expected_revision: 1, profile: { vehicle_type: "sedan", seats_total: 4, parcel_capacity: 6 } })
      .expect(409);

    expect(response.body.error).toBe("driver_verification_state_conflict");
    expect(prismaMock.driverProfile.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("does not reactivate a suspended account through approval", async () => {
    prismaMock.driverVerification.findUnique.mockResolvedValue({ ...pendingVerification, user: { ...candidate, account_status: "suspended" } });

    const response = await request(createApp())
      .post(`/api/v1/admin/driver-verifications/${candidate.id}/approve`)
      .set(authorization())
      .send({ expected_revision: 1, profile: { vehicle_type: "sedan", seats_total: 4, parcel_capacity: 6 } })
      .expect(409);

    expect(response.body.error).toBe("driver_account_status_conflict");
    expect(prismaMock.driverVerification.updateMany).not.toHaveBeenCalled();
  });

  it("maps serialization races to a safe conflict", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(Object.assign(new Error("sensitive database detail"), { code: "P2034" }));
    const response = await request(createApp())
      .post(`/api/v1/admin/driver-verifications/${candidate.id}/reject`)
      .set(authorization())
      .send({ expected_revision: 1, reason: "Documents are unclear" })
      .expect(409);
    expect(response.body.error).toBe("driver_verification_state_conflict");
    expect(JSON.stringify(response.body)).not.toContain("sensitive database detail");
  });
});
