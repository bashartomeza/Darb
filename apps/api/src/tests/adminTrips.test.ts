import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  trip: { findUniqueOrThrow: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
  },
  driverRoute: { update: vi.fn() },
  passengerRequest: { update: vi.fn(), updateMany: vi.fn() },
  merchantOrder: { update: vi.fn() },
  parcelBatch: { update: vi.fn() },
  parcel: { updateMany: vi.fn() },
  auditEvent: { create: vi.fn() },
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { signAuthToken } = await import("../middleware/auth.js");

const now = new Date("2026-08-23T12:00:00.000Z");
const admin = {
  email_verified_at: new Date(),
  id: "admin_1",
  name: "QA Admin",
  phone: "+15550000001",
  role: "admin" as const,
  account_status: "active" as const,
  security_version: 1,
  demo_account: false,
};
const passenger = { ...admin, id: "passenger_auth", role: "passenger" as const };
const driver = { ...admin, id: "driver_auth", role: "driver" as const };
const merchant = { ...admin, id: "merchant_auth", role: "merchant" as const };

type AuthUser = typeof admin | typeof passenger | typeof driver | typeof merchant;

function authorization(user: AuthUser = admin) {
  return {
    Authorization: `Bearer ${signAuthToken({
      id: user.id,
      role: user.role,
      sessionId: `session_${user.id}`,
      securityVersion: 1,
    })}`,
  };
}

function sessionFor(user: AuthUser) {
  return {
    id: `session_${user.id}`,
    user_id: user.id,
    user,
    security_version_at_issue: 1,
    expires_at: new Date(Date.now() + 60_000),
    revoked_at: null,
  };
}

function tripRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "trip_legacy",
    driver_id: "driver_profile_1",
    driver_route_id: "route_1",
    passenger_request_id: "request_1",
    merchant_order_id: null,
    parcel_batch_id: null,
    status: "accepted",
    started_at: now,
    completed_at: null,
    created_at: now,
    operational_mode: "legacy",
    canonical_trip_version: null,
    manifest_id: null,
    route_version_id: null,
    route_version: null,
    driver_route: {
      id: "route_1",
      origin_label: "Hebron",
      destination_label: "Bethlehem",
      departure_at: now,
      driver: {
        id: "driver_profile_1",
        vehicle_type: "sedan",
        seats_total: 4,
        parcel_capacity: 3,
        verified: true,
        trust_score: 80,
        user: { id: "driver_user_1", name: "QA Driver", phone: "+15550000002", demo_account: true },
      },
    },
    passenger_request: {
      id: "request_1",
      pickup_label: "Hebron",
      destination_label: "Bethlehem",
      passenger_count: 1,
      passenger: { id: "passenger_1", name: "QA Passenger", phone: "+15550000003", demo_account: false },
    },
    merchant_order: null,
    parcel_batch: null,
    canonical_manifest: null,
    _count: { location_events: 1 },
    ...overrides,
  };
}

describe("Admin trip management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.authSession.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        sessionFor(where.id === "session_admin_1" ? admin : where.id === "session_driver_auth" ? driver : where.id === "session_merchant_auth" ? merchant : passenger),
    );
    prismaMock.authSession.update.mockResolvedValue({});
    prismaMock.trip.findMany.mockResolvedValue([tripRow()]);
    prismaMock.trip.count.mockResolvedValue(1);
    prismaMock.trip.findUnique.mockResolvedValue(tripRow({
      location_events: [{
        id: "location_2",
        lat: "31.532000",
        lng: "35.099000",
        source: "simulated",
        sequence: 2,
        recorded_at: now,
      }],
    }));
    prismaMock.trip.updateMany.mockImplementation(({ data }) => { prismaMock.trip.findUniqueOrThrow.mockResolvedValue(tripRow({ status: data.status })); return { count: 1 }; });
    prismaMock.trip.update.mockImplementation(({ data }: { data: { status: string } }) => tripRow({ status: data.status }));
    prismaMock.auditEvent.create.mockResolvedValue({ id: "audit_1" });
    prismaMock.$transaction.mockImplementation(
      (operation: ((tx: typeof prismaMock) => unknown) | unknown[]) =>
        Array.isArray(operation) ? Promise.all(operation) : operation(prismaMock),
    );
  });

  it("requires authentication and the Admin role for list and detail", async () => {
    await request(createApp()).get("/api/v1/admin/trips").expect(401);
    await request(createApp()).get("/api/v1/admin/trips/trip_legacy").expect(401);
    await request(createApp()).get("/api/v1/admin/trips").set(authorization(passenger)).expect(403);
    await request(createApp()).get("/api/v1/admin/trips/trip_legacy").set(authorization(passenger)).expect(403);
    await request(createApp()).get("/api/v1/admin/trips").set(authorization(driver)).expect(403);
    await request(createApp()).get("/api/v1/admin/trips/trip_legacy").set(authorization(merchant)).expect(403);
    expect(prismaMock.trip.findMany).not.toHaveBeenCalled();
  });

  it("lists all trip kinds with bounded pagination and deterministic ordering", async () => {
    prismaMock.trip.findMany.mockResolvedValue([
      tripRow(),
      tripRow({ id: "trip_canonical", operational_mode: "canonical_route_v1", canonical_trip_version: "canonical_route_v1" }),
      tripRow({ id: "trip_shared", operational_mode: "canonical_route_v1", canonical_trip_version: "canonical_shared_v1", manifest_id: "manifest_1" }),
    ]);
    prismaMock.trip.count.mockResolvedValue(3);

    const response = await request(createApp())
      .get("/api/v1/admin/trips?page=2&limit=25")
      .set(authorization())
      .expect(200);

    expect(response.body.trips.map((trip: { kind: string }) => trip.kind)).toEqual([
      "legacy",
      "canonical",
      "shared",
    ]);
    expect(response.body).toMatchObject({ page: 2, limit: 25, total: 3 });
    expect(prismaMock.trip.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 25,
      take: 25,
      orderBy: [{ created_at: "desc" }, { id: "asc" }],
    }));
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Array), { isolationLevel: "RepeatableRead" });

    await request(createApp()).get("/api/v1/admin/trips?limit=101").set(authorization()).expect(400);
  });

  it("combines bounded search, status, and canonical kind filters server-side", async () => {
    await request(createApp())
      .get("/api/v1/admin/trips?search=QA%20Driver&status=accepted&kind=canonical")
      .set(authorization())
      .expect(200);

    expect(prismaMock.trip.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: "accepted",
        AND: [
          { manifest_id: null, OR: [{ operational_mode: { not: "legacy" } }, { canonical_trip_version: { not: null } }] },
          { OR: expect.any(Array) },
        ],
      }),
    }));
    await request(createApp()).get(`/api/v1/admin/trips?search=${"x".repeat(101)}`).set(authorization()).expect(400);
  });

  it("uses a safe directory projection without route snapshots or integrity internals", async () => {
    const response = await request(createApp()).get("/api/v1/admin/trips").set(authorization()).expect(200);
    expect(response.body.trips[0]).toMatchObject({
      id: "trip_legacy",
      kind: "legacy",
      has_stored_location: true,
      supported_admin_transition: "pickup_started",
      demo_context: true,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/route_snapshot|checksum|password_hash|security_version/i);
    const select = prismaMock.trip.findMany.mock.calls[0]![0].select;
    expect(select).not.toHaveProperty("route_snapshot_json");
    expect(select).not.toHaveProperty("route_snapshot_checksum");
  });

  it("returns detail with only the latest stored location and its honest source", async () => {
    const response = await request(createApp())
      .get("/api/v1/admin/trips/trip_legacy")
      .set(authorization())
      .expect(200);

    expect(response.body.trip.latest_stored_location).toEqual({
      lat: "31.532000",
      lng: "35.099000",
      source: "simulated",
      sequence: 2,
      recorded_at: now.toISOString(),
    });
    expect(prismaMock.trip.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "trip_legacy" },
      select: expect.objectContaining({
        location_events: { select: expect.any(Object), orderBy: [{ recorded_at: "desc" }, { sequence: "desc" }, { id: "asc" }], take: 1 },
      }),
    }));
  });

  it("returns 404 for missing detail and null when no stored location exists", async () => {
    prismaMock.trip.findUnique.mockResolvedValueOnce(null);
    await request(createApp()).get("/api/v1/admin/trips/missing").set(authorization()).expect(404);
    prismaMock.trip.findUnique.mockResolvedValueOnce(tripRow({ location_events: [], _count: { location_events: 0 } }));
    const response = await request(createApp()).get("/api/v1/admin/trips/trip_legacy").set(authorization()).expect(200);
    expect(response.body.trip.latest_stored_location).toBeNull();
    expect(response.body.trip.has_stored_location).toBe(false);
  });

  it("requires expected status and rejects Admin cancellation and created transitions", async () => {
    await request(createApp())
      .post("/api/v1/admin/trips/trip_legacy/status")
      .set(authorization())
      .send({ status: "pickup_started" })
      .expect(400);
    await request(createApp())
      .post("/api/v1/admin/trips/trip_legacy/status")
      .set(authorization())
      .send({ status: "cancelled", expected_status: "accepted" })
      .expect(400);

    prismaMock.trip.findUnique.mockResolvedValueOnce(tripRow({ status: "created" }));
    await request(createApp())
      .post("/api/v1/admin/trips/trip_legacy/status")
      .set(authorization())
      .send({ status: "pickup_started", expected_status: "created" })
      .expect(409);
    expect(prismaMock.trip.updateMany).not.toHaveBeenCalled();
  });

  it.each(["completed", "cancelled"] as const)("blocks mutation from terminal %s trips", async (terminalStatus) => {
    prismaMock.trip.findUnique.mockResolvedValueOnce(tripRow({ status: terminalStatus }));
    await request(createApp())
      .post("/api/v1/admin/trips/trip_legacy/status")
      .set(authorization())
      .send({ status: "pickup_started", expected_status: terminalStatus })
      .expect(409);
    expect(prismaMock.trip.updateMany).not.toHaveBeenCalled();
  });

  it("rejects stale Admin status with zero writes", async () => {
    prismaMock.trip.findUnique.mockResolvedValueOnce(tripRow({ status: "picked_up" }));
    const response = await request(createApp())
      .post("/api/v1/admin/trips/trip_legacy/status")
      .set(authorization())
      .send({ status: "picked_up", expected_status: "pickup_started" })
      .expect(409);

    expect(response.body.error).toBe("trip_status_conflict");
    expect(prismaMock.trip.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.driverRoute.update).not.toHaveBeenCalled();
    expect(prismaMock.passengerRequest.update).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("turns a concurrent conditional-write miss into 409 before related writes", async () => {
    prismaMock.trip.updateMany.mockResolvedValueOnce({ count: 0 });
    const response = await request(createApp())
      .post("/api/v1/admin/trips/trip_legacy/status")
      .set(authorization())
      .send({ status: "pickup_started", expected_status: "accepted" })
      .expect(409);

    expect(response.body.error).toBe("trip_status_conflict");
    expect(prismaMock.driverRoute.update).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("advances legacy trips through the shared transaction and keeps canonical/shared read-only", async () => {
    prismaMock.trip.findUniqueOrThrow.mockResolvedValueOnce({
      ...tripRow({ status: "pickup_started" }),
      route_snapshot_json: { private: true },
      route_snapshot_checksum: "must-not-leak",
    });
    const response = await request(createApp())
      .post("/api/v1/admin/trips/trip_legacy/status")
      .set(authorization())
      .send({ status: "pickup_started", expected_status: "accepted" })
      .expect(200);
    expect(response.body.trip).toEqual({ id: "trip_legacy", status: "pickup_started" });
    expect(JSON.stringify(response.body)).not.toMatch(/route_snapshot|checksum|private/);
    expect(prismaMock.trip.updateMany).toHaveBeenCalledWith({
      where: { id: "trip_legacy", status: "accepted" },
      data: { status: "pickup_started", started_at: expect.any(Date), completed_at: undefined },
    });
    expect(prismaMock.driverRoute.update).toHaveBeenCalledOnce();
    expect(prismaMock.auditEvent.create).toHaveBeenCalledOnce();

    prismaMock.trip.findUnique.mockResolvedValueOnce(tripRow({
      id: "trip_canonical",
      operational_mode: "canonical_route_v1",
      canonical_trip_version: "canonical_route_v1",
    }));
    await request(createApp())
      .post("/api/v1/admin/trips/trip_canonical/status")
      .set(authorization())
      .send({ status: "pickup_started", expected_status: "accepted" })
      .expect(409);
    expect(prismaMock.trip.updateMany).toHaveBeenCalledTimes(1);
  });
});
