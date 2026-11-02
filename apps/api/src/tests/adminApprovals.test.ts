import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  driverVerification: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  driverVerificationDecision: { create: vi.fn() },
  driverVerificationEvidence: { count: vi.fn(), create: vi.fn() },
  auditEvent: { create: vi.fn() },
  authSession: { findMany: vi.fn(), updateMany: vi.fn() },
  refreshToken: { updateMany: vi.fn() },
  onboardingSession: { updateMany: vi.fn() }
}));

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  $transaction: vi.fn()
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");

const admin = { id: "admin_1", role: "admin", name: "A", phone: "+7", demo_account: true };
const passenger = { id: "passenger_1", role: "passenger", name: "P", phone: "+1", demo_account: true };
const people: Record<string, typeof admin> = { admin_1: admin, passenger_1: passenger };

function auth(id: string) {
  const token = jwt.sign({ role: people[id].role, sid: `session_${id}`, ver: 1 }, "test-only-jwt-secret-with-at-least-thirty-two-characters", {
    subject: id,
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

const driverUser = (overrides: Record<string, unknown> = {}) => ({
  id: "drv_user",
  name: "Driver",
  phone: "+970",
  role: "driver",
  account_status: "pending",
  status_reason: null,
  status_updated_at: new Date(),
  last_login_at: null,
  demo_account: false,
  created_at: new Date(),
  driver_profile: null,
  ...overrides
});

const verification = (overrides: Record<string, unknown> = {}) => ({
  id: "ver_1",
  user_id: "drv_user",
  status: "rejected",
  rejection_reason: "Blurry licence",
  revision: 2,
  submitted_at: new Date("2026-10-20T00:00:00Z"),
  reviewed_at: new Date("2026-10-21T00:00:00Z"),
  reviewed_by: { id: "admin_1", name: "A" },
  user: driverUser(),
  decisions: [],
  evidence: [],
  documents: [],
  ...overrides
});

const merchantUser = (overrides: Record<string, unknown> = {}) => ({
  id: "mer_1",
  name: "Shop",
  phone: "+971",
  role: "merchant",
  account_status: "pending",
  status_reason: null,
  status_updated_at: new Date(),
  last_login_at: null,
  demo_account: false,
  created_at: new Date(),
  ...overrides
});

describe("admin approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      const user = where.id ? people[where.id] : undefined;
      return user ? { ...user, account_status: "active", security_version: 1 } : null;
    });
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const user = people[where.id.replace(/^session_/, "")];
      return user
        ? {
            id: where.id,
            user_id: user.id,
            user: { email_verified_at: new Date(), ...user, account_status: "active", security_version: 1 },
            security_version_at_issue: 1,
            expires_at: new Date(Date.now() + 60_000),
            revoked_at: null
          }
        : null;
    });
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    tx.authSession.findMany.mockResolvedValue([]);
  });

  describe("driver evidence", () => {
    const record = (body: Record<string, unknown>) =>
      request(createApp()).post("/api/v1/admin/driver-verifications/drv_user/evidence").set(auth("admin_1")).send(body);

    it("is admin only", async () => {
      await request(createApp())
        .post("/api/v1/admin/driver-verifications/drv_user/evidence")
        .set(auth("passenger_1"))
        .send({ expected_revision: 1, kind: "driver_licence" })
        .expect(403);
    });

    it("records a sighted document kind against the current revision and audits it", async () => {
      tx.driverVerification.findUnique.mockResolvedValue(verification({ status: "pending", revision: 3 }));
      tx.driverVerificationEvidence.count.mockResolvedValue(0);
      tx.driverVerification.findUniqueOrThrow.mockResolvedValue(
        verification({
          status: "pending",
          revision: 3,
          evidence: [
            { id: "e0", revision: 2, kind: "national_id", note: null, recorded_by: null, created_at: new Date() },
            { id: "e1", revision: 3, kind: "driver_licence", note: "Valid to 2028", recorded_by: { id: "admin_1", name: "A" }, created_at: new Date() }
          ]
        })
      );

      const response = await record({ expected_revision: 3, kind: "driver_licence", note: "  Valid   to 2028 " }).expect(201);

      expect(tx.driverVerificationEvidence.create.mock.calls[0][0].data).toEqual({
        verification_id: "ver_1",
        revision: 3,
        kind: "driver_licence",
        note: "Valid to 2028",
        recorded_by_id: "admin_1"
      });
      expect(tx.auditEvent.create).toHaveBeenCalled();
      // Evidence from an earlier revision is not shown as evidence for this one.
      expect(response.body.verification.evidence.status).toBe("recorded");
      expect(response.body.verification.evidence.items.map((item: { id: string }) => item.id)).toEqual(["e1"]);
    });

    it("refuses unknown kinds, stale revisions, decided applications and a full revision", async () => {
      await record({ expected_revision: 1, kind: "passport_number" }).expect(400);

      tx.driverVerification.findUnique.mockResolvedValue(verification({ status: "pending", revision: 3 }));
      await record({ expected_revision: 2, kind: "insurance" }).expect(409);

      tx.driverVerification.findUnique.mockResolvedValue(verification({ status: "approved", revision: 3 }));
      await record({ expected_revision: 3, kind: "insurance" }).expect(409);

      tx.driverVerification.findUnique.mockResolvedValue(verification({ status: "pending", revision: 3 }));
      tx.driverVerificationEvidence.count.mockResolvedValue(10);
      await record({ expected_revision: 3, kind: "insurance" }).expect(409);

      expect(tx.driverVerificationEvidence.create).not.toHaveBeenCalled();
    });
  });

  describe("driver re-review", () => {
    const reopen = (body: Record<string, unknown>) =>
      request(createApp()).post("/api/v1/admin/driver-verifications/drv_user/reopen").set(auth("admin_1")).send(body);

    it("is admin only", async () => {
      await request(createApp())
        .post("/api/v1/admin/driver-verifications/drv_user/reopen")
        .set(auth("passenger_1"))
        .send({ expected_revision: 2, reason: "Documents fixed" })
        .expect(403);
    });

    it("returns a rejected application to pending and keeps the earlier outcome in history", async () => {
      tx.driverVerification.findUnique.mockResolvedValue(verification());
      tx.driverVerification.updateMany.mockResolvedValue({ count: 1 });
      tx.driverVerification.findUniqueOrThrow.mockResolvedValue(
        verification({
          status: "pending",
          rejection_reason: null,
          revision: 3,
          reviewed_at: null,
          reviewed_by: null,
          decisions: [
            { id: "d2", revision: 2, decision: "reopened", reason: "Documents fixed", decided_by: { id: "admin_1", name: "A" }, created_at: new Date() },
            { id: "d1", revision: 2, decision: "rejected", reason: "Blurry licence", decided_by: { id: "admin_1", name: "A" }, created_at: new Date() }
          ]
        })
      );

      const response = await reopen({ expected_revision: 2, reason: "Documents fixed" }).expect(200);

      expect(response.body.verification.status).toBe("pending");
      expect(response.body.verification.history.map((entry: { decision: string }) => entry.decision)).toEqual(["reopened", "rejected"]);
      expect(tx.driverVerification.updateMany.mock.calls[0][0].where).toEqual({ id: "ver_1", status: "rejected", revision: 2 });
      expect(tx.driverVerificationDecision.create.mock.calls[0][0].data).toMatchObject({
        verification_id: "ver_1",
        revision: 2,
        decision: "reopened",
        reason: "Documents fixed",
        decided_by_id: "admin_1"
      });
    });

    it("refuses anything but a rejected application at the expected revision", async () => {
      tx.driverVerification.findUnique.mockResolvedValue(verification({ status: "approved" }));
      await reopen({ expected_revision: 2, reason: "Documents fixed" }).expect(409);

      tx.driverVerification.findUnique.mockResolvedValue(verification({ revision: 5 }));
      await reopen({ expected_revision: 2, reason: "Documents fixed" }).expect(409);

      tx.driverVerification.findUnique.mockResolvedValue(verification({ user: driverUser({ account_status: "disabled" }) }));
      await reopen({ expected_revision: 2, reason: "Documents fixed" }).expect(409);

      expect(tx.driverVerification.updateMany).not.toHaveBeenCalled();
    });

    it("requires a reason and answers 404 for an unknown applicant", async () => {
      await reopen({ expected_revision: 2, reason: "x" }).expect(400);
      tx.driverVerification.findUnique.mockResolvedValue(null);
      await reopen({ expected_revision: 2, reason: "Documents fixed" }).expect(404);
    });

    it("reports a lost race as a conflict", async () => {
      tx.driverVerification.findUnique.mockResolvedValue(verification());
      tx.driverVerification.updateMany.mockResolvedValue({ count: 0 });
      await reopen({ expected_revision: 2, reason: "Documents fixed" }).expect(409);
      expect(tx.driverVerificationDecision.create).not.toHaveBeenCalled();
    });
  });

  describe("merchant approval", () => {
    const decide = (decision: "approve" | "reject", body: Record<string, unknown> = {}) =>
      request(createApp()).post(`/api/v1/admin/merchant-approvals/mer_1/${decision}`).set(auth("admin_1")).send(body);

    it("is admin only", async () => {
      await request(createApp()).post("/api/v1/admin/merchant-approvals/mer_1/approve").set(auth("passenger_1")).send({}).expect(403);
    });

    it("activates a pending merchant and audits it", async () => {
      tx.user.findUnique.mockResolvedValue(merchantUser());
      tx.user.updateMany.mockResolvedValue({ count: 1 });
      tx.user.findUniqueOrThrow.mockResolvedValue(merchantUser({ account_status: "active" }));

      const response = await decide("approve").expect(200);

      expect(response.body.user.account_status).toBe("active");
      expect(tx.user.updateMany.mock.calls[0][0].where).toEqual({ id: "mer_1", role: "merchant", account_status: "pending" });
      expect(tx.user.updateMany.mock.calls[0][0].data).toMatchObject({ account_status: "active", status_reason: null });
      expect(tx.auditEvent.create.mock.calls[0][0].data).toMatchObject({ entity_id: "mer_1", action: "account_status_changed" });
      expect(tx.onboardingSession.updateMany).not.toHaveBeenCalled();
    });

    it("refuses with a reason: disables the account and ends its sessions", async () => {
      tx.user.findUnique.mockResolvedValue(merchantUser());
      tx.user.updateMany.mockResolvedValue({ count: 1 });
      tx.user.findUniqueOrThrow.mockResolvedValue(merchantUser({ account_status: "disabled", status_reason: "Unverifiable business" }));

      const response = await decide("reject", { reason: "Unverifiable business" }).expect(200);

      expect(response.body.user.account_status).toBe("disabled");
      const update = tx.user.updateMany.mock.calls[0][0].data;
      expect(update).toMatchObject({ account_status: "disabled", status_reason: "Unverifiable business", security_version: { increment: 1 } });
      expect(tx.onboardingSession.updateMany).toHaveBeenCalled();
    });

    it("needs a reason to refuse", async () => {
      await decide("reject").expect(400);
      await decide("reject", { reason: "no" }).expect(400);
      expect(tx.user.updateMany).not.toHaveBeenCalled();
    });

    it("only acts on pending merchants", async () => {
      tx.user.findUnique.mockResolvedValue(merchantUser({ account_status: "active" }));
      await decide("approve").expect(409);

      tx.user.findUnique.mockResolvedValue(merchantUser({ role: "driver" }));
      await decide("approve").expect(409);

      tx.user.findUnique.mockResolvedValue(null);
      await decide("approve").expect(404);

      expect(tx.user.updateMany).not.toHaveBeenCalled();
    });

    it("reports a lost race as a conflict", async () => {
      tx.user.findUnique.mockResolvedValue(merchantUser());
      tx.user.updateMany.mockResolvedValue({ count: 0 });
      await decide("approve").expect(409);
    });

    it("will not decide a shop owner who has not submitted the application", async () => {
      tx.user.findUnique.mockResolvedValue(merchantUser({ review_submitted_at: null }));
      const response = await decide("approve").expect(409);
      expect(response.body.error).toBe("application_not_submitted");
      await decide("reject", { reason: "Incomplete papers" }).expect(409);
      expect(tx.user.updateMany).not.toHaveBeenCalled();
    });
  });
});
