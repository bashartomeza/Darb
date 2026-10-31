import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  authSession: {
    findUnique: vi.fn(),
    update: vi.fn()
  },
  auditEvent: {
    create: vi.fn()
  }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { createConfig } = await import("../config.js");
const { signAuthToken } = await import("../middleware/auth.js");
const { canonicalDemoSeedEnabled, resetDemoData } = await import("../modules/demoReset.js");

function resetConfig(databaseUrl: string, allowedDatabases?: string) {
  return createConfig({
    ...process.env,
    APP_ENV: "demo",
    ENABLE_DEMO_FEATURES: "true",
    DATABASE_URL: databaseUrl,
    DEMO_RESET_ALLOWED_DATABASES: allowedDatabases
  });
}

describe("demo reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seeds canonical dispatch supply only behind the complete dispatch gate", () => {
    expect(
      canonicalDemoSeedEnabled({
        multiRouteEntryEnabled: true,
        multiRouteMatchingEnabled: true,
        canonicalTripCreationEnabled: true
      })
    ).toBe(true);
    expect(
      canonicalDemoSeedEnabled({
        multiRouteEntryEnabled: true,
        multiRouteMatchingEnabled: false,
        canonicalTripCreationEnabled: true
      })
    ).toBe(false);
    expect(
      canonicalDemoSeedEnabled({
        multiRouteEntryEnabled: false,
        multiRouteMatchingEnabled: false,
        canonicalTripCreationEnabled: false
      })
    ).toBe(false);
    expect(
      canonicalDemoSeedEnabled({
        multiRouteEntryEnabled: true,
        multiRouteMatchingEnabled: true,
        canonicalTripCreationEnabled: false
      })
    ).toBe(false);
  });

  it("rejects reset without admin token or reset key", async () => {
    await request(createApp()).post("/api/v1/demo/reset").expect(403);
  });

  it("accepts reset with the demo reset key", async () => {
    prismaMock.$transaction.mockResolvedValue({
      corridor: "Hebron / PPU / Bab Al-Zawiya -> Bethlehem",
      users: { passenger: "+970590000001", drivers: ["+970590000002"], merchant: "+970590000004", admin: "+970590000005" },
      parcels: 5,
      scenarios: 3
    });

    const response = await request(createApp())
      .post("/api/v1/demo/reset")
      .set("x-demo-reset-key", "test-reset-key")
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    expect(prismaMock.auditEvent.create).toHaveBeenCalledOnce();
  });

  it.each([
    ["the permanently protected human database", "mysql://test:test@localhost:3306/masari", "masari"],
    ["an unlisted database", "mysql://test:test@localhost:3306/unknown_database", "masari_demo_ci"],
    ["a malformed database URL", "not-a-database-url", "masari_demo_ci"],
    ["a missing allow-list", "mysql://test:test@localhost:3306/masari_demo_ci", undefined]
  ])("blocks %s before starting a transaction", async (_label, databaseUrl, allowedDatabases) => {
    const response = await request(createApp(resetConfig(databaseUrl, allowedDatabases)))
      .post("/api/v1/demo/reset")
      .set("x-demo-reset-key", "test-reset-key")
      .expect(403);

    expect(response.body.error).toBe("demo_reset_database_not_allowed");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("blocks an authenticated Admin before writes when the database is unsafe", async () => {
    prismaMock.authSession.findUnique.mockResolvedValue({
      id: "session_admin",
      user_id: "admin_1",
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
      security_version_at_issue: 1,
      user: { email_verified_at: new Date(), id: "admin_1", role: "admin", account_status: "active", security_version: 1 }
    });
    prismaMock.authSession.update.mockResolvedValue({});
    const token = signAuthToken({ id: "admin_1", role: "admin", sessionId: "session_admin", securityVersion: 1 });

    const response = await request(createApp(resetConfig("mysql://test:test@localhost:3306/masari", "masari")))
      .post("/api/v1/demo/reset")
      .set("authorization", `Bearer ${token}`)
      .expect(403);

    expect(response.body.error).toBe("demo_reset_database_not_allowed");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("blocks real users inside the serializable transaction before destructive writes", async () => {
    const deleteAuditEvents = vi.fn();
    const tx = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: "real_user" }) },
      auditEvent: { deleteMany: deleteAuditEvents }
    };
    const db = { $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) };

    await expect(resetDemoData(db as never)).rejects.toMatchObject({
      statusCode: 403,
      message: "demo_reset_real_data_present"
    });
    expect(deleteAuditEvents).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("clears session state and recreates deterministic active users", async () => {
    const userCreate = vi
      .fn()
      .mockResolvedValueOnce({ id: "passenger", phone: "+970590000001" })
      .mockResolvedValueOnce({ id: "driver_1", phone: "+970590000002" })
      .mockResolvedValueOnce({ id: "driver_2", phone: "+970590000003" })
      .mockResolvedValueOnce({ id: "merchant", phone: "+970590000004" })
      .mockResolvedValueOnce({ id: "admin", phone: "+970590000005" });
    const tx = {
      auditEvent: { deleteMany: vi.fn(), create: vi.fn() },
      userConsent: { deleteMany: vi.fn() },
      onboardingSession: { deleteMany: vi.fn() },
      invitationRedemption: { deleteMany: vi.fn() },
      onboardingAttempt: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn(), deleteMany: vi.fn() },
      otpChallenge: { deleteMany: vi.fn() },
      invitation: { deleteMany: vi.fn() },
      consentDocument: { deleteMany: vi.fn() },
      consentRelease: { deleteMany: vi.fn() },
      abuseCounter: { deleteMany: vi.fn() },
      idempotencyRecord: { deleteMany: vi.fn() },
      refreshToken: { deleteMany: vi.fn() },
      authSession: { deleteMany: vi.fn() },
      locationEvent: { deleteMany: vi.fn() },
      capacityReservation: { updateMany: vi.fn(), deleteMany: vi.fn() },
      canonicalDemandDispatch: { updateMany: vi.fn(), deleteMany: vi.fn() },
      canonicalDemandAttempt: { deleteMany: vi.fn() },
      canonicalTripManifestMember: { deleteMany: vi.fn() },
      canonicalTripManifest: { updateMany: vi.fn(), deleteMany: vi.fn() },
      trip: { deleteMany: vi.fn() },
      match: { deleteMany: vi.fn() },
      comparisonRun: { deleteMany: vi.fn() },
      parcelBatch: { deleteMany: vi.fn() },
      parcel: { deleteMany: vi.fn(), create: vi.fn() },
      merchantOrder: { deleteMany: vi.fn(), create: vi.fn().mockResolvedValue({ id: "order_1" }) },
      passengerRequest: { deleteMany: vi.fn(), create: vi.fn() },
      driverRoute: {
        deleteMany: vi.fn(),
        // Legacy corridor route, then the two canonical availabilities.
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: "legacy_route_1" })
          .mockResolvedValueOnce({ id: "legacy_route_2" })
          .mockResolvedValueOnce({
            id: "canonical_primary",
            availability_status: "draft",
            availability_revision: 1,
            departure_at: new Date()
          })
          .mockResolvedValueOnce({
            id: "canonical_alternate",
            availability_status: "active",
            availability_revision: 1,
            departure_at: new Date()
          })
      },
      driverProfile: {
        deleteMany: vi.fn(),
        create: vi.fn().mockResolvedValueOnce({ id: "profile_1" }).mockResolvedValueOnce({ id: "profile_2" })
      },
      driverVerification: { createMany: vi.fn() },
      demoScenario: { deleteMany: vi.fn(), createMany: vi.fn() },
      serviceRoute: {
        updateMany: vi.fn(),
        deleteMany: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: "service_route_1" }),
        update: vi.fn()
      },
      serviceRouteVersion: {
        deleteMany: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: "route_version_1" })
      },
      routeFare: { deleteMany: vi.fn() },
      routeVersionStop: { deleteMany: vi.fn(), createMany: vi.fn() },
      stop: {
        deleteMany: vi.fn(),
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: "origin_stop" })
          .mockResolvedValueOnce({ id: "pickup_stop" })
          .mockResolvedValueOnce({ id: "destination_stop" })
      },
      user: { findFirst: vi.fn().mockResolvedValue(null), deleteMany: vi.fn(), create: userCreate }
    };
    const db = { $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) };

    await resetDemoData(db as never);

    expect(tx.refreshToken.deleteMany).toHaveBeenCalledOnce();
    expect(tx.authSession.deleteMany).toHaveBeenCalledOnce();
    expect(tx.invitation.deleteMany).toHaveBeenCalledOnce();
    expect(tx.otpChallenge.deleteMany).toHaveBeenCalledOnce();
    expect(tx.consentRelease.deleteMany).toHaveBeenCalledOnce();
    expect(tx.refreshToken.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.authSession.deleteMany.mock.invocationCallOrder[0]
    );
    expect(tx.authSession.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.user.deleteMany.mock.invocationCallOrder[0]
    );
    // Route fares restrict their route and the admin who set them: they must be cleared first.
    expect(tx.routeFare.deleteMany).toHaveBeenCalledOnce();
    expect(tx.routeFare.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(tx.serviceRoute.deleteMany.mock.invocationCallOrder[0]);
    expect(tx.routeFare.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(tx.user.deleteMany.mock.invocationCallOrder[0]);
    expect(userCreate).toHaveBeenCalledTimes(5);
    expect(tx.driverVerification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ user_id: "driver_1", status: "approved", reviewed_by_id: "admin" }),
        expect.objectContaining({ user_id: "driver_2", status: "approved", reviewed_by_id: "admin" })
      ])
    });
    expect(tx.serviceRouteVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description_ar: expect.stringContaining("مساري"),
        geometry_status: "available",
        estimated_distance_meters: 21_530
      })
    });
    expect(tx.routeVersionStop.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ sequence: 1 }),
        expect.objectContaining({ sequence: 2 }),
        expect.objectContaining({ sequence: 3 })
      ])
    });
    for (const call of userCreate.mock.calls) {
      expect(call[0].data).toEqual(expect.objectContaining({ account_status: "active", security_version: 1 }));
    }
  });
});
