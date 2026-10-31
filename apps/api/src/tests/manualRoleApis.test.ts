import request from "supertest";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  user: { findUnique: vi.fn(), count: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  passengerRequest: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  match: { findMany: vi.fn(), updateMany: vi.fn() },
  parcelBatch: { findUnique: vi.fn(), update: vi.fn() },
  parcelBatchOrder: { findMany: vi.fn(), updateMany: vi.fn() },
  merchantOrder: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), count: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  parcel: { count: vi.fn(), updateMany: vi.fn() },
  trip: { findFirst: vi.fn() },
  driverProfile: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  driverRoute: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  driverVerification: { count: vi.fn() },
  incident: { count: vi.fn() },
  deliveryHandover: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");

type Role = "passenger" | "driver" | "merchant" | "admin";

const users: Record<string, { id: string; role: Role; name: string; phone: string; demo_account: boolean }> = {
  passenger_1: { id: "passenger_1", role: "passenger", name: "Passenger 1", phone: "+1", demo_account: true },
  passenger_2: { id: "passenger_2", role: "passenger", name: "Passenger 2", phone: "+2", demo_account: true },
  driver_1: { id: "driver_1", role: "driver", name: "Driver 1", phone: "+3", demo_account: true },
  driver_2: { id: "driver_2", role: "driver", name: "Driver 2", phone: "+4", demo_account: true },
  merchant_1: { id: "merchant_1", role: "merchant", name: "Merchant 1", phone: "+5", demo_account: true },
  merchant_2: { id: "merchant_2", role: "merchant", name: "Merchant 2", phone: "+6", demo_account: true },
  admin_1: { id: "admin_1", role: "admin", name: "Admin 1", phone: "+7", demo_account: true }
};

function token(id: keyof typeof users) {
  return jwt.sign(
    { role: users[id].role, sid: `session_${id}`, ver: 1 },
    "test-only-jwt-secret-with-at-least-thirty-two-characters",
    { subject: id, expiresIn: "1h" }
  );
}

function auth(id: keyof typeof users) {
  return { Authorization: `Bearer ${token(id)}` };
}

const passengerBody = {
  pickup_label: "PPU Main Gate",
  pickup_lat: 31.55,
  pickup_lng: 35.1,
  destination_label: "Bethlehem Center",
  destination_lat: 31.7054,
  destination_lng: 35.2024,
  preferred_time: "2026-07-02T09:00:00.000Z",
  passenger_count: 1
};

const merchantBody = {
  pickup_label: "Hebron Merchant Pickup",
  pickup_lat: 31.5326,
  pickup_lng: 35.0998,
  parcels: [
    { destination_label: "Bethlehem Market", destination_lat: 31.7054, destination_lng: 35.2024, size: "S", priority: "normal" }
  ]
};

describe("manual role APIs", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-02T08:00:00.000Z"));
    vi.clearAllMocks();
    prismaMock.$queryRaw.mockResolvedValue([{ id: "req_1" }]);
    prismaMock.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (!where.id) return null;
      const user = users[where.id];
      return user ? { ...user, account_status: "active", security_version: 1 } : null;
    });
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const user = users[where.id.replace(/^session_/, "")];
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
    prismaMock.authSession.update.mockResolvedValue({});
    prismaMock.auditEvent.create.mockResolvedValue({ id: "audit_1" });
    prismaMock.passengerRequest.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.passengerRequest.findUniqueOrThrow.mockImplementation(({ where }: { where: { id: string } }) => ({ id: where.id, status: "cancelled", passenger_id: "passenger_1" }));
    prismaMock.match.findMany.mockResolvedValue([]);
    prismaMock.match.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.trip.findFirst.mockResolvedValue(null);
    prismaMock.parcel.count.mockResolvedValue(0);
    prismaMock.parcelBatch.findUnique.mockResolvedValue(null);
    prismaMock.parcelBatchOrder.findMany.mockResolvedValue([]);
    prismaMock.merchantOrder.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.merchantOrder.findUniqueOrThrow.mockImplementation(({ where }: { where: { id: string } }) => ({ id: where.id, merchant_id: "merchant_1", status: "cancelled", parcels: [], parcel_batches: [], batch_members: [] }));
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.deliveryHandover.findUnique.mockResolvedValue(null);
    prismaMock.deliveryHandover.create.mockResolvedValue({});
    prismaMock.$queryRaw.mockResolvedValue([{ id: "profile_1" }]);
    prismaMock.driverRoute.findFirst.mockResolvedValue(null);
  });

  it("passenger can create request", async () => {
    prismaMock.passengerRequest.create.mockResolvedValue({ id: "req_1", status: "pending", passenger_id: "passenger_1" });

    const response = await request(createApp())
      .post("/api/v1/passenger/requests")
      .set(auth("passenger_1"))
      .send(passengerBody)
      .expect(201);

    expect(response.body.request.status).toBe("pending");
    expect(prismaMock.passengerRequest.create).toHaveBeenCalledOnce();
  });

  it("rejects a past passenger departure before inserting a request", async () => {
    prismaMock.passengerRequest.create.mockResolvedValue({ id: "must_not_exist", status: "pending" });
    await request(createApp()).post("/api/v1/passenger/requests").set(auth("passenger_1"))
      .send({ ...passengerBody, preferred_time: new Date(Date.now() - 1_000).toISOString() }).expect(400);
    expect(prismaMock.passengerRequest.create).not.toHaveBeenCalled();
  });

  it("accepts valid coordinate boundaries and existing numeric-string inputs", async () => {
    prismaMock.passengerRequest.create.mockResolvedValue({ id: "req_boundary", status: "pending" });
    await request(createApp())
      .post("/api/v1/passenger/requests")
      .set(auth("passenger_1"))
      .send({
        ...passengerBody,
        pickup_lat: "-90",
        pickup_lng: "-180",
        destination_lat: "90",
        destination_lng: "180"
      })
      .expect(201);

    expect(prismaMock.passengerRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pickup_lat: "-90.000000",
          pickup_lng: "-180.000000",
          destination_lat: "90.000000",
          destination_lng: "180.000000"
        })
      })
    );
  });

  it("rejects out-of-range and non-finite passenger coordinates", async () => {
    for (const invalid of [
      { pickup_lat: 90.0001 },
      { pickup_lng: -180.0001 },
      { destination_lat: "NaN" },
      { destination_lng: "Infinity" }
    ]) {
      await request(createApp())
        .post("/api/v1/passenger/requests")
        .set(auth("passenger_1"))
        .send({ ...passengerBody, ...invalid })
        .expect(400);
    }
    expect(prismaMock.passengerRequest.create).not.toHaveBeenCalled();
  });

  it("non-passenger cannot create request", async () => {
    await request(createApp()).post("/api/v1/passenger/requests").set(auth("driver_1")).send(passengerBody).expect(403);
  });

  it("passenger cannot read another passenger request", async () => {
    prismaMock.passengerRequest.findFirst.mockResolvedValue(null);

    await request(createApp()).get("/api/v1/passenger/requests/req_other").set(auth("passenger_1")).expect(404);
  });

  it("passenger can cancel own pending request", async () => {
    prismaMock.passengerRequest.findFirst.mockResolvedValue({ id: "req_1", status: "pending", passenger_id: "passenger_1" });
    prismaMock.passengerRequest.update.mockResolvedValue({ id: "req_1", status: "cancelled", passenger_id: "passenger_1" });

    const response = await request(createApp())
      .patch("/api/v1/passenger/requests/req_1/cancel")
      .set(auth("passenger_1"))
      .expect(200);

    expect(response.body.request.status).toBe("cancelled");
    expect(prismaMock.passengerRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "cancelled" } })
    );
    expect(prismaMock.match.updateMany).not.toHaveBeenCalled();
  });

  it("combined passenger cancellation releases parcel capacity and reopens merchant batching", async () => {
    prismaMock.passengerRequest.findFirst.mockResolvedValue({
      id: "req_1",
      status: "matched",
      passenger_id: "passenger_1",
      passenger_count: 1
    });
    prismaMock.match.findMany.mockResolvedValue([{
      id: "match_1",
      driver_route_id: "route_1",
      legacy_capacity_held: true,
      merchant_order_id: "order_1",
      parcel_batch_id: "batch_1"
    }]);
    prismaMock.parcel.count.mockResolvedValue(3);
    prismaMock.parcelBatch.findUnique.mockResolvedValue({ id: "batch_1", status: "proposed" });
    prismaMock.parcelBatchOrder.findMany.mockResolvedValue([
      { merchant_order_id: "order_1" },
      { merchant_order_id: "order_2" }
    ]);
    prismaMock.passengerRequest.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.passengerRequest.findUniqueOrThrow.mockImplementation(({ where }: { where: { id: string } }) => ({ id: where.id, status: "cancelled", passenger_id: "passenger_1" }));
    prismaMock.passengerRequest.findFirst.mockResolvedValueOnce({
      id: "req_1", status: "matched", passenger_id: "passenger_1", passenger_count: 1
    });

    const response = await request(createApp())
      .patch("/api/v1/passenger/requests/req_1/cancel")
      .set(auth("passenger_1"))
      .expect(200);

    expect(response.body.request.status).toBe("cancelled");
    expect(prismaMock.driverRoute.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "route_1" },
      data: expect.objectContaining({
        seats_available: { increment: 1 },
        parcel_capacity_available: { increment: 3 }
      })
    }));
    expect(prismaMock.parcelBatch.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "batch_1" },
      data: { driver_route_id: null, status: "created" }
    }));
    expect(prismaMock.merchantOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["order_1", "order_2"] }, status: "matched" },
      data: { status: "batched" }
    }));
  });

  it("merchant can cancel a matched batched order and releases reserved parcel capacity", async () => {
    prismaMock.merchantOrder.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.merchantOrder.findFirst.mockResolvedValue({
      id: "order_1",
      merchant_id: "merchant_1",
      status: "matched",
      canonical_entry_version: null,
      parcels: [{ id: "parcel_1", status: "batched" }],
      parcel_batches: [{ id: "batch_1", driver_route_id: "route_1", status: "proposed" }],
      batch_members: []
    });
    prismaMock.parcelBatchOrder.findMany.mockResolvedValue([{ merchant_order_id: "order_1" }, { merchant_order_id: "order_2" }]);
    prismaMock.match.findMany.mockResolvedValue([{ id: "match_1", driver_route_id: "route_1", legacy_capacity_held: true }]);
    prismaMock.parcel.count.mockResolvedValue(3);

    const response = await request(createApp())
      .patch("/api/v1/merchant/orders/order_1/cancel")
      .set(auth("merchant_1"))
      .expect(200);

    expect(response.body.order.status).toBe("cancelled");
    expect(prismaMock.driverRoute.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "route_1" },
      data: expect.objectContaining({ parcel_capacity_available: { increment: 3 } })
    }));
    expect(prismaMock.match.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "invalidated", legacy_demand_key: null, legacy_capacity_held: false }
    }));
    expect(prismaMock.parcelBatchOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { active: false, active_membership_key: null }
    }));
  });

  it("invalid cancel state is rejected", async () => {
    prismaMock.passengerRequest.findFirst.mockResolvedValue({ id: "req_1", status: "accepted", passenger_id: "passenger_1" });

    await request(createApp()).patch("/api/v1/passenger/requests/req_1/cancel").set(auth("passenger_1")).expect(409);
  });

  it("driver can create locked corridor route", async () => {
    prismaMock.driverProfile.findUnique.mockResolvedValue({ id: "profile_1", user_id: "driver_1" });
    prismaMock.driverRoute.create.mockResolvedValue({ id: "route_1", corridor_key: "hebron-ppu-bab-al-zawiya-to-bethlehem", status: "active" });

    const response = await request(createApp())
      .post("/api/v1/driver/routes")
      .set(auth("driver_1"))
      .send({ seats_available: 2, parcel_capacity_available: 5 })
      .expect(201);

    expect(response.body.route.status).toBe("active");
  });

  it("rolls driver route creation back when its audit fails", async () => {
    let routes: unknown[] = [];
    prismaMock.driverProfile.findUnique.mockResolvedValue({ id: "profile_1", user_id: "driver_1" });
    prismaMock.driverRoute.create.mockImplementation(async ({ data }) => {
      const row = { id: "route_1", ...data }; routes.push(row); return row;
    });
    prismaMock.auditEvent.create.mockRejectedValueOnce(new Error("audit unavailable"));
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => {
      const before = [...routes];
      try { return await callback(prismaMock); } catch (error) { routes = before; throw error; }
    });
    await request(createApp()).post("/api/v1/driver/routes").set(auth("driver_1"))
      .send({ seats_available: 2, parcel_capacity_available: 5 }).expect(500);
    expect(routes).toHaveLength(0);
  });

  it("recovers an exact driver route creation retry without another operational route", async () => {
    prismaMock.driverProfile.findUnique.mockResolvedValue({ id: "profile_1", user_id: "driver_1" });
    prismaMock.driverRoute.findFirst.mockResolvedValue({ id: "original_route", status: "active", seats_available: 2, parcel_capacity_available: 5 });
    const response = await request(createApp()).post("/api/v1/driver/routes").set(auth("driver_1"))
      .send({ seats_available: 2, parcel_capacity_available: 5 }).expect(201);
    expect(response.body.route.id).toBe("original_route");
    expect(prismaMock.driverRoute.create).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw).toHaveBeenCalledOnce();
  });

  it("does not create another route while a driver has a different operational route", async () => {
    prismaMock.driverProfile.findUnique.mockResolvedValue({ id: "profile_1", user_id: "driver_1" });
    prismaMock.driverRoute.findFirst.mockResolvedValue({ id: "existing_route", status: "active", seats_available: 1, parcel_capacity_available: 0 });
    await request(createApp()).post("/api/v1/driver/routes").set(auth("driver_1"))
      .send({ seats_available: 2, parcel_capacity_available: 5 }).expect(409);
    expect(prismaMock.driverRoute.create).not.toHaveBeenCalled();
  });

  it("non-driver cannot create route", async () => {
    await request(createApp()).post("/api/v1/driver/routes").set(auth("passenger_1")).send({}).expect(403);
  });

  it("route outside corridor is rejected", async () => {
    await request(createApp())
      .post("/api/v1/driver/routes")
      .set(auth("driver_1"))
      .send({ origin_label: "Ramallah", destination_label: "Nablus" })
      .expect(400);
  });

  it("driver can deactivate own active route", async () => {
    prismaMock.driverRoute.findFirst.mockResolvedValue({ id: "route_1", status: "active" });
    prismaMock.driverRoute.update.mockResolvedValue({ id: "route_1", status: "inactive" });

    const response = await request(createApp()).patch("/api/v1/driver/routes/route_1/deactivate").set(auth("driver_1")).expect(200);
    expect(response.body.route.status).toBe("inactive");
  });

  it("driver cannot deactivate another driver route", async () => {
    prismaMock.driverRoute.findFirst.mockResolvedValue(null);

    await request(createApp()).patch("/api/v1/driver/routes/route_other/deactivate").set(auth("driver_1")).expect(404);
  });

  it("legacy role queries and mutations exclude canonical operational records", async () => {
    prismaMock.passengerRequest.findMany.mockResolvedValue([]);
    prismaMock.driverRoute.findMany.mockResolvedValue([]);
    prismaMock.driverRoute.findFirst.mockResolvedValue(null);
    prismaMock.merchantOrder.findMany.mockResolvedValue([]);
    prismaMock.merchantOrder.findFirst.mockResolvedValue(null);

    await request(createApp()).get("/api/v1/passenger/requests").set(auth("passenger_1")).expect(200);
    await request(createApp()).get("/api/v1/driver/routes").set(auth("driver_1")).expect(200);
    await request(createApp()).patch("/api/v1/driver/routes/canonical/deactivate").set(auth("driver_1")).expect(404);
    await request(createApp()).get("/api/v1/merchant/orders").set(auth("merchant_1")).expect(200);
    await request(createApp()).get("/api/v1/merchant/orders/canonical").set(auth("merchant_1")).expect(404);

    expect(prismaMock.passengerRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ canonical_entry_version: null }) })
    );
    expect(prismaMock.driverRoute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ canonical_availability_version: null }) })
    );
    expect(prismaMock.driverRoute.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ canonical_availability_version: null }) })
    );
    expect(prismaMock.merchantOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ canonical_entry_version: null }) })
    );
    expect(prismaMock.merchantOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ canonical_entry_version: null }) })
    );
  });

  it("legacy serializers do not expose canonical routing internals", async () => {
    const internal = {
      route_version_id: "version_private",
      pickup_stop_id: "stop_private",
      destination_stop_id: "stop_private",
      canonical_entry_version: "canonical_route_v1",
      canonical_availability_version: "canonical_route_v1",
      operational_mode: "canonical_route_v1",
      requested_departure_from: new Date(),
      requested_departure_until: new Date(),
      canonical_created_at: new Date()
    };
    prismaMock.passengerRequest.create.mockResolvedValue({
      id: "req_legacy",
      passenger_id: "passenger_1",
      status: "pending",
      ...internal
    });
    prismaMock.driverProfile.findUnique.mockResolvedValue({ id: "profile_1", user_id: "driver_1" });
    prismaMock.driverRoute.create.mockResolvedValue({ id: "route_legacy", status: "active", ...internal });
    prismaMock.merchantOrder.create.mockResolvedValue({
      id: "order_legacy",
      merchant_id: "merchant_1",
      status: "submitted",
      ...internal,
      parcels: [{ id: "parcel_legacy", status: "pending", ...internal }]
    });

    const responses = await Promise.all([
      request(createApp()).post("/api/v1/passenger/requests").set(auth("passenger_1")).send(passengerBody).expect(201),
      request(createApp()).post("/api/v1/driver/routes").set(auth("driver_1")).send({}).expect(201),
      request(createApp()).post("/api/v1/merchant/orders").set(auth("merchant_1")).send(merchantBody).expect(201)
    ]);
    for (const [index, response] of responses.entries()) {
      const body = JSON.stringify(response.body);
      expect(body).not.toContain("canonical_route_v1");
      expect(body).not.toContain("operational_mode");
      if (index !== 1) {
        expect(body).not.toContain("version_private");
        expect(body).not.toContain("stop_private");
      }
    }
  });

  it("merchant can create order with parcels", async () => {
    prismaMock.merchantOrder.create.mockResolvedValue({ id: "order_1", status: "submitted", parcels: [{ id: "parcel_1", status: "pending" }] });

    const response = await request(createApp()).post("/api/v1/merchant/orders").set(auth("merchant_1")).send(merchantBody).expect(201);
    expect(response.body.order.parcels).toHaveLength(1);
  });

  it("a new merchant order hands the sender a six-digit receiver code and stores only its digest", async () => {
    prismaMock.merchantOrder.create.mockResolvedValue({ id: "order_1", status: "submitted", parcels: [{ id: "parcel_1", status: "pending" }] });
    prismaMock.deliveryHandover.findUnique.mockResolvedValueOnce(null).mockResolvedValue({
      code_digest: "a".repeat(64), failed_attempts: 0, expires_at: new Date(Date.now() + 1000), confirmed_at: null, confirmation_method: null, unavailable_reason: null
    });

    const response = await request(createApp()).post("/api/v1/merchant/orders").set(auth("merchant_1")).send(merchantBody).expect(201);

    expect(response.body.order.handover.code).toMatch(/^\d{6}$/);
    expect(response.body.order.handover).toMatchObject({ issued: true, confirmed: false, attempts_remaining: 5 });
    const stored = prismaMock.deliveryHandover.create.mock.calls[0][0].data;
    expect(stored.code_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(response.body.order.handover.code);
  });

  it("rejects out-of-range and non-finite merchant pickup and parcel coordinates", async () => {
    const invalidBodies = [
      { ...merchantBody, pickup_lat: -90.0001 },
      { ...merchantBody, pickup_lng: 180.0001 },
      {
        ...merchantBody,
        parcels: [{ ...merchantBody.parcels[0], destination_lat: "NaN" }]
      },
      {
        ...merchantBody,
        parcels: [{ ...merchantBody.parcels[0], destination_lng: "-Infinity" }]
      }
    ];
    for (const body of invalidBodies) {
      await request(createApp()).post("/api/v1/merchant/orders").set(auth("merchant_1")).send(body).expect(400);
    }
    expect(prismaMock.merchantOrder.create).not.toHaveBeenCalled();
  });

  it("non-merchant cannot create order", async () => {
    await request(createApp()).post("/api/v1/merchant/orders").set(auth("driver_1")).send(merchantBody).expect(403);
  });

  it("merchant cannot view another merchant order", async () => {
    prismaMock.merchantOrder.findFirst.mockResolvedValue(null);

    await request(createApp()).get("/api/v1/merchant/orders/order_other").set(auth("merchant_1")).expect(404);
  });

  it("merchant order reads include safe persisted batch summaries", async () => {
    const order = {
      id: "order_1",
      merchant_id: "merchant_1",
      status: "batched",
      parcels: [{ id: "parcel_1", status: "pending" }],
      parcel_batches: [
        {
          id: "batch_1",
          status: "created",
          estimated_distance_saved: "43.06",
          explanation: "Three parcels share one corridor trip.",
          created_at: new Date("2026-07-13T08:00:00.000Z"),
          driver_route: {
            id: "route_1",
            origin_label: "Hebron / PPU / Bab Al-Zawiya",
            destination_label: "Bethlehem",
            corridor_key: "hebron-ppu-bab-al-zawiya-to-bethlehem",
            status: "active",
            parcel_capacity_available: 5
          }
        }
      ]
    };
    prismaMock.merchantOrder.findMany.mockResolvedValue([order]);
    prismaMock.merchantOrder.findFirst.mockResolvedValue(order);

    const list = await request(createApp()).get("/api/v1/merchant/orders").set(auth("merchant_1")).expect(200);
    const detail = await request(createApp()).get("/api/v1/merchant/orders/order_1").set(auth("merchant_1")).expect(200);

    expect(list.body.orders[0].parcel_batches[0]).toEqual(
      expect.objectContaining({ id: "batch_1", status: "created", estimated_distance_saved: "43.06" })
    );
    expect(detail.body.order.parcel_batches[0].driver_route).toEqual(
      expect.objectContaining({ id: "route_1", destination_label: "Bethlehem" })
    );
    expect(JSON.stringify(detail.body)).not.toContain("driver_id");
  });

  it("invalid parcel count is rejected", async () => {
    await request(createApp())
      .post("/api/v1/merchant/orders")
      .set(auth("merchant_1"))
      .send({ ...merchantBody, parcels: [] })
      .expect(400);
  });

  it("admin can read dashboard", async () => {
    prismaMock.user.count.mockResolvedValue(5);
    prismaMock.driverProfile.count.mockResolvedValue(2);
    prismaMock.driverRoute.count.mockResolvedValue(2);
    prismaMock.passengerRequest.count.mockResolvedValue(1);
    prismaMock.merchantOrder.count.mockResolvedValue(1);
    prismaMock.parcel.count.mockResolvedValue(5);
    prismaMock.driverRoute.groupBy.mockResolvedValue([{ driver_id: "d1" }, { driver_id: "d2" }]);
    prismaMock.driverVerification.count.mockResolvedValue(3);
    prismaMock.incident.count.mockResolvedValue(4);
    prismaMock.passengerRequest.findMany.mockResolvedValue([{ id: "req_1" }]);
    prismaMock.merchantOrder.findMany.mockResolvedValue([{ id: "order_1", parcels: [] }]);
    prismaMock.driverRoute.findMany.mockResolvedValue([{ id: "route_1" }]);

    const response = await request(createApp()).get("/api/v1/admin/dashboard").set(auth("admin_1")).expect(200);
    expect(response.body.counts.users).toBe(5);
    expect(response.body.counts.active_drivers).toBe(2);
    expect(prismaMock.driverRoute.groupBy.mock.calls[0][0].where).toEqual({
      status: { in: ["active", "assigned", "on_trip"] },
      driver: { verified: true }
    });
    expect(response.body.counts.pending_driver_approvals).toBe(3);
    expect(response.body.counts.open_incidents).toBe(4);
  });

  it("non-admin cannot read dashboard", async () => {
    await request(createApp()).get("/api/v1/admin/dashboard").set(auth("driver_1")).expect(403);
  });

  it("admin endpoints return records", async () => {
    const unsafeUser = {
      ...users.driver_1,
      created_at: new Date("2026-07-13T08:00:00.000Z"),
      password_hash: "must-never-leak"
    };
    prismaMock.driverProfile.findMany.mockResolvedValue([{ id: "profile_1", user: unsafeUser, routes: [] }]);
    prismaMock.passengerRequest.findMany.mockResolvedValue([{ id: "req_1", passenger: unsafeUser }]);
    prismaMock.merchantOrder.findMany.mockResolvedValue([{ id: "order_1", merchant: unsafeUser, parcels: [] }]);
    prismaMock.driverRoute.findMany.mockResolvedValue([{ id: "route_1", driver: { id: "profile_1", user: unsafeUser } }]);

    const responses = await Promise.all([
      request(createApp()).get("/api/v1/admin/drivers").set(auth("admin_1")).expect(200),
      request(createApp()).get("/api/v1/admin/requests").set(auth("admin_1")).expect(200),
      request(createApp()).get("/api/v1/admin/orders").set(auth("admin_1")).expect(200),
      request(createApp()).get("/api/v1/admin/routes").set(auth("admin_1")).expect(200)
    ]);

    for (const response of responses) {
      expect(JSON.stringify(response.body)).not.toContain("password_hash");
      expect(JSON.stringify(response.body)).not.toContain("must-never-leak");
      expect(JSON.stringify(response.body)).toContain("Driver 1");
    }
    expect(prismaMock.driverProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining({ user: expect.objectContaining({ select: expect.any(Object) }) }) })
    );
  });
});
