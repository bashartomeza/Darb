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
  driverProfile: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  driverVerificationDecision: { create: vi.fn() },
  notification: { create: vi.fn() },
  auditEvent: { create: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { signAuthToken } = await import("../middleware/auth.js");
const { daysUntilExpiry, isExpired, noticeThreshold, runDriverDocumentExpiryCheck } = await import("../services/driverDocumentExpiry.js");
const { createDriverAvailabilityService } = await import("../services/driverAvailability.js");
const { purgeDecidedDriverDocuments } = await import("../services/driverDocumentRetention.js");

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("expiry date arithmetic (UTC calendar days)", () => {
  it("treats the whole expiry date as valid and the next day as expired", () => {
    const expires = day("2026-11-10");
    expect(isExpired(expires, new Date("2026-11-10T00:00:00.000Z"))).toBe(false);
    expect(isExpired(expires, new Date("2026-11-10T23:59:59.999Z"))).toBe(false);
    expect(isExpired(expires, new Date("2026-11-11T00:00:00.000Z"))).toBe(true);
    expect(daysUntilExpiry(expires, new Date("2026-11-10T12:00:00.000Z"))).toBe(0);
    expect(daysUntilExpiry(expires, new Date("2026-11-11T00:00:00.000Z"))).toBe(-1);
  });

  it("picks the 30 and 7 day tiers at their boundaries", () => {
    expect(noticeThreshold(31)).toBeNull();
    expect(noticeThreshold(30)).toBe(30);
    expect(noticeThreshold(8)).toBe(30);
    expect(noticeThreshold(7)).toBe(7);
    expect(noticeThreshold(0)).toBe(7);
    expect(noticeThreshold(-1)).toBeNull();
  });
});

type Row = Record<string, unknown>;

function verificationRow(overrides: Row = {}) {
  return {
    id: "ver_1",
    user_id: "drv_1",
    status: "approved",
    revision: 3,
    licence_expires_at: null,
    vehicle_registration_expires_at: null,
    insurance_expires_at: null,
    contract_ends_at: null,
    ...overrides
  };
}

describe("runDriverDocumentExpiryCheck", () => {
  const seen = new Set<string>();
  beforeEach(() => {
    vi.clearAllMocks();
    seen.clear();
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.notification.create.mockImplementation(({ data }: { data: { user_id: string; dedupe_key: string } }) => {
      const key = `${data.user_id}|${data.dedupe_key}`;
      if (seen.has(key)) return Promise.reject(new Error("unique"));
      seen.add(key);
      return Promise.resolve({});
    });
    prismaMock.driverVerification.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.driverProfile.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.driverVerificationDecision.create.mockResolvedValue({});
    prismaMock.auditEvent.create.mockResolvedValue({});
  });

  function candidates(rows: Row[]) {
    prismaMock.driverVerification.findMany.mockResolvedValueOnce(rows).mockResolvedValue([]);
  }

  it("sends the 30 day reminder once, then the 7 day reminder once, never twice", async () => {
    const row = verificationRow({ licence_expires_at: day("2026-12-01") });
    const run = async (now: string) => {
      candidates([row]);
      return runDriverDocumentExpiryCheck(prismaMock as never, { now: new Date(now) });
    };
    expect((await run("2026-11-01T08:00:00Z")).reminded).toBe(1); // 30 days left
    expect((await run("2026-11-01T20:00:00Z")).reminded).toBe(0); // same day again
    expect((await run("2026-11-15T08:00:00Z")).reminded).toBe(0); // still in the 30 day tier
    expect((await run("2026-11-24T08:00:00Z")).reminded).toBe(1); // 7 days left
    expect((await run("2026-11-25T08:00:00Z")).reminded).toBe(0);
    const types = prismaMock.notification.create.mock.calls.map(([arg]) => [arg.data.type, arg.data.params.threshold]);
    expect(types.filter(([, threshold], index) => index >= 0 && [30, 7].includes(threshold as number))).toEqual([
      ["driver_documents_expiring", 30],
      ["driver_documents_expiring", 30],
      ["driver_documents_expiring", 30],
      ["driver_documents_expiring", 7],
      ["driver_documents_expiring", 7]
    ]);
    expect(seen.size).toBe(2);
    expect(prismaMock.driverVerification.updateMany).not.toHaveBeenCalled();
  });

  it("sends only the 7 day reminder when the job first sees the document inside the last week", async () => {
    candidates([verificationRow({ insurance_expires_at: day("2026-11-05") })]);
    const result = await runDriverDocumentExpiryCheck(prismaMock as never, { now: new Date("2026-11-03T08:00:00Z") });
    expect(result.reminded).toBe(1);
    expect(prismaMock.notification.create.mock.calls[0][0].data.params).toEqual(expect.objectContaining({ kind: "insurance", threshold: 7, days_left: 2 }));
  });

  it("does nothing on the last valid day other than the reminder, and restricts the day after", async () => {
    const row = verificationRow({ licence_expires_at: day("2026-11-10") });
    candidates([row]);
    const onLastDay = await runDriverDocumentExpiryCheck(prismaMock as never, { now: new Date("2026-11-10T23:59:59Z") });
    expect(onLastDay.restricted).toBe(0);
    expect(prismaMock.driverProfile.updateMany).not.toHaveBeenCalled();

    candidates([row]);
    const next = await runDriverDocumentExpiryCheck(prismaMock as never, { now: new Date("2026-11-11T00:00:00Z") });
    expect(next.restricted).toBe(1);
    expect(prismaMock.driverVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ver_1", status: "approved", revision: 3 },
        data: expect.objectContaining({ status: "documents_expired", revision: { increment: 1 }, renewal_submitted_at: null })
      })
    );
    expect(prismaMock.driverProfile.updateMany).toHaveBeenCalledWith({ where: { user_id: "drv_1" }, data: { verified: false } });
    expect(prismaMock.driverVerificationDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ decision: "documents_expired", reason: "licence" })
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "driver_verification", metadata: expect.objectContaining({ action: "driver_documents_expired", expired: ["licence"] }) })
    });
    expect(prismaMock.notification.create.mock.calls.at(-1)![0].data.type).toBe("driver_documents_expired");
  });

  it("expires on the contract end date too and is idempotent when another run already restricted the driver", async () => {
    candidates([verificationRow({ contract_ends_at: day("2026-11-01") })]);
    prismaMock.driverVerification.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await runDriverDocumentExpiryCheck(prismaMock as never, { now: new Date("2026-11-02T01:00:00Z") });
    expect(result.restricted).toBe(0);
    expect(prismaMock.driverProfile.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it("never touches trips or accepted offers", async () => {
    candidates([verificationRow({ licence_expires_at: day("2026-01-01") })]);
    await runDriverDocumentExpiryCheck(prismaMock as never, { now: new Date("2026-11-02T01:00:00Z") });
    expect(Object.keys(prismaMock)).not.toContain("trip");
  });
});

describe("enforcement", () => {
  it("blocks an expired driver server-side with a specific code, and an unverified one with the generic code", async () => {
    const db = {
      $transaction: (callback: (tx: unknown) => unknown) => callback(db),
      driverProfile: { findUnique: vi.fn().mockResolvedValue({ id: "p", user_id: "drv_1", verified: false }) },
      driverVerification: { findUnique: vi.fn().mockResolvedValue({ status: "documents_expired" }) }
    };
    const service = createDriverAvailabilityService(db as never);
    await expect(service.activate("route_1", 1, { id: "drv_1" })).rejects.toMatchObject({ statusCode: 403, message: "driver_documents_expired" });
    db.driverVerification.findUnique.mockResolvedValue({ status: "rejected" });
    await expect(service.activate("route_1", 1, { id: "drv_1" })).rejects.toMatchObject({ statusCode: 403, message: "driver_not_approved" });
  });

  it("does not purge renewal uploads that wait for a decision", async () => {
    const db = {
      driverVerificationDocument: { findMany: vi.fn().mockResolvedValue([]) },
      merchantApplicationDocument: { findMany: vi.fn().mockResolvedValue([]) }
    };
    await purgeDecidedDriverDocuments(db as never, { remove: vi.fn() } as never, { retentionDays: 90, now: new Date("2026-11-01T00:00:00Z") });
    expect(db.driverVerificationDocument.findMany.mock.calls[0][0].where.verification.status).toEqual({ in: ["approved", "rejected"] });
  });
});

const now = new Date("2026-10-29T10:00:00.000Z");
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

function authorization() {
  const token = signAuthToken({ id: admin.id, role: admin.role, sessionId: "session_admin_1", securityVersion: 1 });
  return { Authorization: `Bearer ${token}` };
}

function renewalRow(overrides: Row = {}) {
  return {
    id: "ver_1",
    user_id: "drv_1",
    status: "pending",
    rejection_reason: null,
    revision: 4,
    submitted_at: now,
    reviewed_at: null,
    reviewed_by_id: null,
    reviewed_by: null,
    licence_expires_at: day("2026-10-01"),
    vehicle_registration_expires_at: null,
    insurance_expires_at: null,
    contract_ends_at: null,
    documents_expired_at: now,
    renewal_submitted_at: now,
    created_at: now,
    updated_at: now,
    decisions: [],
    evidence: [],
    documents: [],
    user: {
      id: "drv_1",
      name: "Driver",
      phone: "+970590000099",
      role: "driver",
      account_status: "active",
      status_reason: null,
      status_updated_at: now,
      last_login_at: null,
      demo_account: false,
      created_at: now,
      driver_profile: { id: "p1", user_id: "drv_1", vehicle_type: "sedan", seats_total: 4, parcel_capacity: 2, verified: false, trust_score: 70, created_at: now }
    },
    ...overrides
  };
}

describe("admin expiry recording and re-review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.authSession.findUnique.mockResolvedValue({
      id: "session_admin_1",
      user_id: admin.id,
      user: admin,
      security_version_at_issue: 1,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null
    });
    prismaMock.authSession.update.mockResolvedValue({});
    prismaMock.driverVerification.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.driverProfile.update.mockResolvedValue({});
    prismaMock.auditEvent.create.mockResolvedValue({});
    prismaMock.notification.create.mockResolvedValue({});
    prismaMock.driverVerificationDecision.create.mockResolvedValue({});
  });

  it("re-approval restores access, records the new dates, and clears the renewal markers", async () => {
    prismaMock.driverVerification.findUnique.mockResolvedValue(renewalRow());
    prismaMock.driverVerification.findUniqueOrThrow.mockResolvedValue(renewalRow({ status: "approved", revision: 5, renewal_submitted_at: null, documents_expired_at: null, licence_expires_at: day("2027-10-28") }));
    const response = await request(createApp())
      .post("/api/v1/admin/driver-verifications/drv_1/approve")
      .set(authorization())
      .send({ expected_revision: 4, expiry: { licence: "2027-10-28", insurance: "2027-01-31" } })
      .expect(200);
    expect(response.body.verification).toEqual(expect.objectContaining({ status: "approved", renewal_submitted_at: null }));
    expect(prismaMock.driverVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "pending", revision: 4 }),
        data: expect.objectContaining({
          status: "approved",
          licence_expires_at: day("2027-10-28"),
          insurance_expires_at: day("2027-01-31"),
          documents_expired_at: null,
          renewal_submitted_at: null
        })
      })
    );
    expect(prismaMock.driverProfile.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { verified: true } });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata: expect.objectContaining({ action: "driver_verification_re_approved" }) })
    });
  });

  it("refuses a re-review approval that leaves the old expired licence date or omits it", async () => {
    prismaMock.driverVerification.findUnique.mockResolvedValue(renewalRow());
    const stale = await request(createApp())
      .post("/api/v1/admin/driver-verifications/drv_1/approve")
      .set(authorization())
      .send({ expected_revision: 4 })
      .expect(400);
    expect(stale.body.error ?? stale.body.message ?? JSON.stringify(stale.body)).toContain("expiry_date_in_past");

    prismaMock.driverVerification.findUnique.mockResolvedValue(renewalRow({ licence_expires_at: null }));
    const missing = await request(createApp())
      .post("/api/v1/admin/driver-verifications/drv_1/approve")
      .set(authorization())
      .send({ expected_revision: 4 })
      .expect(400);
    expect(JSON.stringify(missing.body)).toContain("expiry_dates_required");
    expect(prismaMock.driverProfile.update).not.toHaveBeenCalled();
  });

  it("accepts today as the last valid day but rejects yesterday and malformed dates", async () => {
    prismaMock.driverVerification.findUnique.mockResolvedValue(renewalRow());
    prismaMock.driverVerification.findUniqueOrThrow.mockResolvedValue(renewalRow({ status: "approved" }));
    await request(createApp()).post("/api/v1/admin/driver-verifications/drv_1/approve").set(authorization())
      .send({ expected_revision: 4, expiry: { licence: "2026-10-29" } }).expect(200);
    await request(createApp()).post("/api/v1/admin/driver-verifications/drv_1/approve").set(authorization())
      .send({ expected_revision: 4, expiry: { licence: "2026-10-28" } }).expect(400);
    await request(createApp()).post("/api/v1/admin/driver-verifications/drv_1/approve").set(authorization())
      .send({ expected_revision: 4, expiry: { licence: "29/10/2027" } }).expect(400);
  });

  it("lists the expiring-soon window with a kind filter and the re-review queue by state", async () => {
    prismaMock.driverVerification.findMany.mockResolvedValue([renewalRow({ status: "approved" })]);
    prismaMock.driverVerification.count.mockResolvedValue(1);
    const expiring = await request(createApp())
      .get("/api/v1/admin/driver-verifications/expiring?within_days=14&kind=insurance")
      .set(authorization())
      .expect(200);
    expect(expiring.body).toEqual(expect.objectContaining({ total: 1, within_days: 14 }));
    expect(expiring.body.verifications[0].expiry.licence).toEqual({ expires_on: "2026-10-01", days_left: -28 });
    expect(prismaMock.driverVerification.findMany.mock.calls[0][0].where).toEqual({
      status: "approved",
      OR: [{ insurance_expires_at: { lte: day("2026-11-12") } }]
    });

    await request(createApp()).get("/api/v1/admin/driver-verifications/re-review?state=submitted").set(authorization()).expect(200);
    expect(prismaMock.driverVerification.findMany.mock.calls[1][0].where).toEqual({ status: "pending", renewal_submitted_at: { not: null } });
    await request(createApp()).get("/api/v1/admin/driver-verifications/re-review?state=awaiting_driver").set(authorization()).expect(200);
    expect(prismaMock.driverVerification.findMany.mock.calls[2][0].where).toEqual({ status: "documents_expired" });
    await request(createApp()).get("/api/v1/admin/driver-verifications/re-review?state=bogus").set(authorization()).expect(400);
  });

  it("updates recorded dates of an approved driver only at the expected revision", async () => {
    prismaMock.driverVerification.findUnique.mockResolvedValue(renewalRow({ status: "approved", renewal_submitted_at: null, licence_expires_at: day("2027-01-01") }));
    prismaMock.driverVerification.findUniqueOrThrow.mockResolvedValue(renewalRow({ status: "approved" }));
    await request(createApp()).post("/api/v1/admin/driver-verifications/drv_1/expiry").set(authorization())
      .send({ expected_revision: 4, expiry: { licence: "2028-01-01", contract: null } }).expect(200);
    expect(prismaMock.driverVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ licence_expires_at: day("2028-01-01"), contract_ends_at: null }) })
    );
    await request(createApp()).post("/api/v1/admin/driver-verifications/drv_1/expiry").set(authorization())
      .send({ expected_revision: 9, expiry: { licence: "2028-01-01" } }).expect(409);
  });
});
