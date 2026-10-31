import request from "supertest";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scoreDriverRoute } from "../modules/matching.js";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  passengerRequest: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  merchantOrder: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  driverRoute: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  match: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  parcelBatch: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  parcelBatchOrder: { findMany: vi.fn(), updateMany: vi.fn() },
  parcel: { count: vi.fn(), updateMany: vi.fn() },
  comparisonRun: { create: vi.fn(), findUnique: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const jwtSecret = "test-only-jwt-secret-with-at-least-thirty-two-characters";

const { createApp } = await import("../app.js");

type Role = "passenger" | "driver" | "merchant" | "admin";

const users: Record<string, { id: string; role: Role; name: string; phone: string; demo_account: boolean }> = {
  passenger_1: { id: "passenger_1", role: "passenger", name: "Passenger 1", phone: "+1", demo_account: true },
  passenger_2: { id: "passenger_2", role: "passenger", name: "Passenger 2", phone: "+2", demo_account: true },
  merchant_1: { id: "merchant_1", role: "merchant", name: "Merchant 1", phone: "+3", demo_account: true },
  merchant_2: { id: "merchant_2", role: "merchant", name: "Merchant 2", phone: "+4", demo_account: true },
  admin_1: { id: "admin_1", role: "admin", name: "Admin 1", phone: "+5", demo_account: true }
};

function token(id: keyof typeof users) {
  return jwt.sign({ role: users[id].role, sid: `session_${id}`, ver: 1 }, jwtSecret, {
    subject: id,
    expiresIn: "1h"
  });
}

function auth(id: keyof typeof users) {
  return { Authorization: `Bearer ${token(id)}` };
}

const passengerRequest = {
  id: "req_1",
  passenger_id: "passenger_1",
  pickup_lat: "31.550000",
  pickup_lng: "35.100000",
  passenger_count: 1,
  preferred_time: new Date("2026-07-02T10:00:00.000Z"),
  status: "pending"
};

const merchantOrder = {
  id: "order_1",
  merchant_id: "merchant_1",
  pickup_lat: "31.550000", pickup_lng: "35.100000",
  status: "submitted",
  parcels: Array.from({ length: 5 }, (_, index) => ({ id: `parcel_${index}`, status: "pending" })),
  parcel_batches: [], batch_members: []
};

const compatibleRoute = {
  id: "route_compatible",
  origin_label: "Hebron / PPU / Bab Al-Zawiya",
  destination_label: "Bethlehem",
  origin_lat: "31.532600",
  origin_lng: "35.099800",
  seats_available: 2,
  parcel_capacity_available: 5,
  departure_at: new Date(Date.now() + 3_600_000),
  availability_window_end: new Date(Date.now() + 5_400_000),
  status: "active",
  corridor_key: "hebron-ppu-bab-al-zawiya-to-bethlehem",
  driver: {
    id: "driver_profile_1",
    verified: true,
    trust_score: 86,
    vehicle_type: "sedan",
    user: { name: "Driver One" }
  }
};

const wrongDirectionRoute = {
  id: "route_wrong_direction",
  origin_label: "Bethlehem",
  destination_label: "Hebron / PPU / Bab Al-Zawiya",
  origin_lat: "31.705400",
  origin_lng: "35.202400",
  seats_available: 2,
  parcel_capacity_available: 5,
  departure_at: new Date(Date.now() + 3_600_000),
  availability_window_end: new Date(Date.now() + 5_400_000),
  status: "active",
  corridor_key: "hebron-ppu-bab-al-zawiya-to-bethlehem",
  driver: {
    id: "driver_profile_2",
    verified: true,
    trust_score: 95,
    vehicle_type: "van",
    user: { name: "Driver Two" }
  }
};

describe("matching, batching, comparison", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-02T08:00:00.000Z"));
    vi.clearAllMocks();
    prismaMock.$queryRaw.mockImplementation((parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      if (sql.includes("UTC_TIMESTAMP")) return [{ now: new Date() }];
      if (sql.includes("FROM driver_routes")) return [{ id: "route_compatible", status: "active", verified: true, role: "driver", account_status: "active", preferred_time: passengerRequest.preferred_time, departure_at: compatibleRoute.departure_at, departed_at: null, availability_window_end: compatibleRoute.availability_window_end }];
      if (sql.includes("FROM merchant_orders")) return [{ status: "matched" }];
      if (sql.includes("FROM matches")) return [{ status: "proposed", expires_at: new Date(Date.now() + 60_000) }];
      throw new Error("unexpected_test_raw_query");
    });
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
    prismaMock.match.findFirst.mockResolvedValue(null);
    prismaMock.match.findMany.mockResolvedValue([]);
    prismaMock.merchantOrder.findMany.mockResolvedValue([]);
    prismaMock.merchantOrder.updateMany.mockImplementation(({ where }) => ({ count: Array.isArray(where.id?.in) ? where.id.in.length : 1 }));
    prismaMock.driverRoute.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.parcelBatchOrder.findMany.mockResolvedValue([]);
    prismaMock.parcelBatchOrder.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.parcel.count.mockResolvedValue(0);
    prismaMock.parcel.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.passengerRequest.update.mockResolvedValue({});
    prismaMock.passengerRequest.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));

  });

  it("route-compatible driver scores higher than nearest wrong-direction driver", () => {
    const compatible = scoreDriverRoute({ route: compatibleRoute, passengerRequest, parcelCount: 0 });
    const wrongDirection = scoreDriverRoute({ route: wrongDirectionRoute, passengerRequest, parcelCount: 0 });

    expect(compatible.finalScore).toBeGreaterThan(wrongDirection.finalScore);
  });

  it("previews ranked passenger candidates without creating a match", async () => {
    prismaMock.driverRoute.findMany.mockResolvedValue([wrongDirectionRoute, compatibleRoute]);

    const response = await request(createApp())
      .post("/api/v1/matches/search")
      .set(auth("passenger_1"))
      .send({
        pickup_label: "PPU Main Gate",
        pickup_lat: 31.55,
        pickup_lng: 35.1,
        destination_label: "Bethlehem Center",
        destination_lat: 31.7054,
        destination_lng: 35.2024,
        preferred_time: "2026-07-02T10:00:00.000Z",
        passenger_count: 1
      })
      .expect(200);

    expect(response.body.results).toHaveLength(2);
    expect(response.body.results[0]).toMatchObject({
      id: "route_compatible",
      driver: {
        name: "Driver One",
        vehicle_type: "sedan",
        trust_score: 86,
        verified: true
      },
      origin_label: "Hebron / PPU / Bab Al-Zawiya",
      destination_label: "Bethlehem",
      seats_available: 2
    });
    expect(response.body.results[0].score).toEqual(expect.any(Number));
    expect(response.body.results[0].scoring_breakdown.finalScore).toBe(
      response.body.results[0].score
    );
    expect(prismaMock.match.create).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain("+1");
  });

  it("excludes past, departed and expired stale-active routes while retaining undated legacy supply", async () => {
    prismaMock.driverRoute.findMany.mockResolvedValue([
      { ...compatibleRoute, id: "past", departure_at: new Date(0) },
      { ...compatibleRoute, id: "departed", departure_at: null, departed_at: new Date(0) },
      { ...compatibleRoute, id: "expired", departure_at: null, availability_window_end: new Date(0) },
      { ...compatibleRoute, id: "undated", departure_at: null, departed_at: null, availability_window_end: null },
    ]);
    const response = await request(createApp()).post("/api/v1/matches/search").set(auth("passenger_1"))
      .send({ pickup_label: "PPU", pickup_lat: 31.55, pickup_lng: 35.1,
        destination_label: "Bethlehem", destination_lat: 31.7054, destination_lng: 35.2024,
        preferred_time: new Date(Date.now() + 3_600_000).toISOString(), passenger_count: 1 }).expect(200);
    expect(response.body.results.map((route: { id: string }) => route.id)).toEqual(["undated"]);
    expect(prismaMock.match.create).not.toHaveBeenCalled();
  });

  it("rejects booking an explicitly selected route after its scheduled departure", async () => {
    prismaMock.passengerRequest.findUnique.mockResolvedValue({ ...passengerRequest,
      preferred_time: new Date(Date.now() + 3_600_000) });
    prismaMock.driverRoute.findMany.mockResolvedValue([{ ...compatibleRoute, departure_at: new Date(0) }]);
    prismaMock.match.create.mockImplementation(({ data }) => ({ id: "must_not_exist", ...data, driver_route: compatibleRoute }));
    await request(createApp()).post("/api/v1/matches/run").set(auth("passenger_1"))
      .send({ passengerRequestId: passengerRequest.id, driverRouteId: compatibleRoute.id }).expect(409);
    expect(prismaMock.match.create).not.toHaveBeenCalled();
    expect(prismaMock.driverRoute.updateMany).not.toHaveBeenCalled();
  });

  it.each(["demand", "departure", "window"] as const)("rejects match creation when %s expires during a row lock wait", async boundary => {
    prismaMock.passengerRequest.findUnique.mockResolvedValue(passengerRequest);
    prismaMock.driverRoute.findMany.mockResolvedValue([compatibleRoute]);
    prismaMock.match.create.mockImplementation(({ data }) => ({ id: "expired_offer", ...data, driver_route: compatibleRoute }));
    // The DB clock has crossed one deadline after the capacity claim acquires
    // its lock; the pre-transaction application clock still sees valid supply.
    prismaMock.$queryRaw.mockImplementation(async (query: TemplateStringsArray) => query.join("").includes("TIMESTAMP")
      ? [{ now: new Date("2026-07-02T10:00:00.001Z") }]
      : [{ id: "route_compatible", status: "active", verified: true, role: "driver", account_status: "active", preferred_time: new Date(boundary === "demand" ? "2026-07-02T10:00:00.000Z" : "2026-07-02T11:00:00.000Z"),
        departure_at: boundary === "departure" ? new Date("2026-07-02T10:00:00.000Z") : null,
        departed_at: null,
        availability_window_end: boundary === "window" ? new Date("2026-07-02T10:00:00.000Z") : null }]);
    const response = await request(createApp()).post("/api/v1/matches/run").set(auth("passenger_1"))
      .send({ passengerRequestId: passengerRequest.id, driverRouteId: compatibleRoute.id });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe(boundary === "demand" ? "passenger_request_expired" : "selected_driver_route_unavailable");
    expect(prismaMock.match.create).not.toHaveBeenCalled();
  });

  it("never substitutes another candidate when the selected route is unavailable", async () => {
    prismaMock.passengerRequest.findUnique.mockResolvedValue(passengerRequest);
    prismaMock.driverRoute.findMany.mockResolvedValue([compatibleRoute]);
    const response = await request(createApp()).post("/api/v1/matches/run").set(auth("passenger_1"))
      .send({ passengerRequestId: passengerRequest.id, driverRouteId: "unavailable_selected_route" });
    expect(response.status).toBe(409);
    expect(prismaMock.match.create).not.toHaveBeenCalled();
    expect(prismaMock.driverRoute.updateMany).not.toHaveBeenCalled();
  });

  it("keeps match preview passenger-only", async () => {
    await request(createApp())
      .post("/api/v1/matches/search")
      .set(auth("merchant_1"))
      .send({
        pickup_label: "PPU Main Gate",
        pickup_lat: 31.55,
        pickup_lng: 35.1,
        destination_label: "Bethlehem Center",
        destination_lat: 31.7054,
        destination_lng: 35.2024,
        preferred_time: "2026-07-02T10:00:00.000Z",
        passenger_count: 1
      })
      .expect(403);

    expect(prismaMock.driverRoute.findMany).not.toHaveBeenCalled();
  });

  it("inactive and unverified routes are ignored by candidate query", async () => {
    prismaMock.passengerRequest.findUnique.mockResolvedValue(passengerRequest);
    prismaMock.driverRoute.findMany.mockResolvedValue([compatibleRoute]);
    prismaMock.match.create.mockImplementation(({ data }) => ({ id: "match_1", ...data, driver_route: compatibleRoute }));

    await request(createApp())
      .post("/api/v1/matches/run")
      .set(auth("passenger_1"))
      .send({ passengerRequestId: "req_1" })
      .expect(201);

    expect(prismaMock.driverRoute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "active", driver: { verified: true, user: { role: "driver", account_status: "active" } } })
      })
    );
  });

  it("capacity mismatch is rejected", async () => {
    prismaMock.passengerRequest.findUnique.mockResolvedValue({ ...passengerRequest, passenger_count: 9 });
    prismaMock.driverRoute.findMany.mockResolvedValue([compatibleRoute]);

    await request(createApp())
      .post("/api/v1/matches/run")
      .set(auth("passenger_1"))
      .send({ passengerRequestId: "req_1" })
      .expect(404);
  });

  it("non-owner cannot run match for another user's request", async () => {
    prismaMock.passengerRequest.findUnique.mockResolvedValue({ ...passengerRequest, passenger_id: "passenger_2" });

    await request(createApp())
      .post("/api/v1/matches/run")
      .set(auth("passenger_1"))
      .send({ passengerRequestId: "req_1" })
      .expect(403);
  });

  it("checks ownership before disclosing canonical matcher isolation", async () => {
    prismaMock.passengerRequest.findUnique.mockResolvedValue({
      ...passengerRequest,
      passenger_id: "passenger_2",
      canonical_entry_version: "canonical_route_v1",
      route_version_id: "version_1"
    });

    await request(createApp())
      .post("/api/v1/matches/run")
      .set(auth("passenger_1"))
      .send({ passengerRequestId: "req_1" })
      .expect(403);
  });

  it("never sends canonical demand to the legacy matcher", async () => {
    prismaMock.passengerRequest.findUnique.mockResolvedValue({
      ...passengerRequest,
      canonical_entry_version: "canonical_route_v1",
      route_version_id: "version_1"
    });

    await request(createApp())
      .post("/api/v1/matches/run")
      .set(auth("passenger_1"))
      .send({ passengerRequestId: "req_1" })
      .expect(409);

    expect(prismaMock.driverRoute.findMany).not.toHaveBeenCalled();
  });

  it("matching persists and returns scoring breakdown", async () => {
    prismaMock.passengerRequest.findUnique.mockResolvedValue(passengerRequest);
    prismaMock.merchantOrder.findUnique.mockResolvedValue(null);
    prismaMock.driverRoute.findMany.mockResolvedValue([wrongDirectionRoute, compatibleRoute]);
    prismaMock.match.create.mockImplementation(({ data }) => ({ id: "match_1", ...data, driver_route: compatibleRoute }));

    const response = await request(createApp())
      .post("/api/v1/matches/run")
      .set(auth("passenger_1"))
      .send({ passengerRequestId: "req_1" })
      .expect(201);

    expect(response.body.match.driver_route_id).toBe("route_compatible");
    expect(response.body.scoringBreakdown.finalScore).toEqual(expect.any(Number));
    expect(prismaMock.passengerRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "req_1",
          passenger_id: "passenger_1",
          status: { in: ["pending", "matched"] }
        }),
        data: { status: "matched" }
      })
    );
    expect(prismaMock.match.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          passenger_request_id: "req_1",
          legacy_demand_key: "passenger:req_1",
          status: "proposed"
        })
      })
    );
  });

  it("reserves real driver capacity when a passenger match is created", async () => {
    prismaMock.passengerRequest.findUnique.mockResolvedValue(passengerRequest);
    prismaMock.merchantOrder.findUnique.mockResolvedValue(null);
    prismaMock.driverRoute.findMany.mockResolvedValue([compatibleRoute]);
    prismaMock.match.create.mockImplementation(({ data }) => ({ id: "match_capacity", ...data, driver_route: compatibleRoute }));

    await request(createApp())
      .post("/api/v1/matches/run")
      .set(auth("passenger_1"))
      .send({ passengerRequestId: "req_1" })
      .expect(201);

    expect(prismaMock.driverRoute.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "route_compatible",
        seats_available: { gte: 1 },
        parcel_capacity_available: { gte: 0 }
      }),
      data: expect.objectContaining({ seats_available: { decrement: 1 } })
    }));
    expect(prismaMock.match.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ legacy_capacity_held: true })
    }));
  });

  it("does not rematch a passenger to a route they already rejected", async () => {
    prismaMock.passengerRequest.findUnique.mockResolvedValue(passengerRequest);
    prismaMock.merchantOrder.findUnique.mockResolvedValue(null);
    prismaMock.match.findMany.mockResolvedValue([{ driver_route_id: "route_compatible" }]);
    prismaMock.driverRoute.findMany.mockResolvedValue([compatibleRoute]);

    await request(createApp())
      .post("/api/v1/matches/run")
      .set(auth("passenger_1"))
      .send({ passengerRequestId: "req_1" })
      .expect(404);

    expect(prismaMock.match.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate active matching for the same passenger request", async () => {
    prismaMock.passengerRequest.findUnique.mockResolvedValue(passengerRequest);
    prismaMock.merchantOrder.findUnique.mockResolvedValue(null);
    prismaMock.driverRoute.findMany.mockResolvedValue([compatibleRoute]);
    prismaMock.match.findFirst.mockResolvedValue({ id: "existing_match" });

    await request(createApp())
      .post("/api/v1/matches/run")
      .set(auth("passenger_1"))
      .send({ passengerRequestId: "req_1" })
      .expect(409);

    expect(prismaMock.match.create).not.toHaveBeenCalled();
  });

  it("does not resurrect a passenger request that was cancelled during matching", async () => {
    prismaMock.passengerRequest.findUnique.mockResolvedValue(passengerRequest);
    prismaMock.merchantOrder.findUnique.mockResolvedValue(null);
    prismaMock.driverRoute.findMany.mockResolvedValue([compatibleRoute]);
    prismaMock.passengerRequest.updateMany.mockResolvedValue({ count: 0 });

    await request(createApp())
      .post("/api/v1/matches/run")
      .set(auth("passenger_1"))
      .send({ passengerRequestId: "req_1" })
      .expect(409);

    expect(prismaMock.match.create).not.toHaveBeenCalled();
  });

  it("creates the match for the passenger-selected candidate", async () => {
    const selectedRoute = {
      ...compatibleRoute,
      id: "route_selected",
      driver: {
        ...compatibleRoute.driver,
        id: "driver_profile_selected",
        trust_score: 70,
        user: { name: "Selected Driver" }
      }
    };
    prismaMock.passengerRequest.findUnique.mockResolvedValue(passengerRequest);
    prismaMock.merchantOrder.findUnique.mockResolvedValue(null);
    prismaMock.driverRoute.findMany.mockResolvedValue([compatibleRoute, selectedRoute]);
    prismaMock.match.create.mockImplementation(({ data }) => ({
      id: "match_selected",
      ...data,
      driver_route: selectedRoute
    }));

    const response = await request(createApp())
      .post("/api/v1/matches/run")
      .set(auth("passenger_1"))
      .send({ passengerRequestId: "req_1", driverRouteId: "route_selected" })
      .expect(201);

    expect(response.body.match.driver_route_id).toBe("route_selected");
    expect(prismaMock.match.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ driver_route_id: "route_selected" })
      })
    );
  });

  it("rejects a selected candidate that is no longer available", async () => {
    prismaMock.passengerRequest.findUnique.mockResolvedValue(passengerRequest);
    prismaMock.merchantOrder.findUnique.mockResolvedValue(null);
    prismaMock.driverRoute.findMany.mockResolvedValue([compatibleRoute]);

    const response = await request(createApp())
      .post("/api/v1/matches/run")
      .set(auth("passenger_1"))
      .send({ passengerRequestId: "req_1", driverRouteId: "route_gone" })
      .expect(409);

    expect(response.body.error).toBe("selected_driver_route_unavailable");
    expect(prismaMock.match.create).not.toHaveBeenCalled();
  });

  it("combined matching links the merchant's persisted parcel batch", async () => {
    prismaMock.parcelBatchOrder.findMany.mockResolvedValue([{ merchant_order_id: "order_1" }]);
    prismaMock.parcel.count.mockResolvedValue(5);
    prismaMock.passengerRequest.findUnique.mockResolvedValue(passengerRequest);
    prismaMock.merchantOrder.findUnique.mockResolvedValue({
      ...merchantOrder,
      status: "batched",
      parcel_batches: [{ id: "batch_1" }]
    });
    prismaMock.driverRoute.findMany.mockResolvedValue([compatibleRoute]);
    prismaMock.match.create.mockImplementation(({ data }) => ({ id: "match_1", ...data, driver_route: compatibleRoute }));

    await request(createApp())
      .post("/api/v1/matches/run")
      .set(auth("admin_1"))
      .send({ passengerRequestId: "req_1", merchantOrderId: "order_1" })
      .expect(201);

    expect(prismaMock.merchantOrder.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          parcel_batches: expect.objectContaining({ orderBy: { created_at: "desc" }, take: 1 })
        })
      })
    );
    expect(prismaMock.match.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parcel_batch_id: "batch_1" }) })
    );
  });

  it("GET match returns saved result for owner", async () => {
    prismaMock.match.findUnique.mockResolvedValue({
      id: "match_1",
      scoring_breakdown: { finalScore: 0.9 },
      passenger_request: passengerRequest,
      merchant_order: null,
      driver_route: compatibleRoute,
      parcel_batch: null
    });

    const response = await request(createApp()).get("/api/v1/matches/match_1").set(auth("passenger_1")).expect(200);
    expect(response.body.scoringBreakdown.finalScore).toBe(0.9);
  });

  it("batches multiple compatible real merchant orders into one persisted batch", async () => {
    const secondOrder = {
      ...merchantOrder,
      id: "order_2",
      parcels: [
        { id: "parcel_5", status: "pending" },
        { id: "parcel_6", status: "pending" }
      ]
    };
    prismaMock.merchantOrder.findUnique.mockResolvedValue(merchantOrder);
    prismaMock.merchantOrder.findMany.mockResolvedValue([merchantOrder, secondOrder]);
    prismaMock.parcelBatch.create.mockImplementation(({ data }) => ({
      id: "batch_multi",
      status: "created",
      ...data,
      members: data.members?.create?.map((member: { merchant_order_id: string }) => ({ merchant_order_id: member.merchant_order_id })) ?? []
    }));

    const response = await request(createApp())
      .post("/api/v1/merchant/orders/order_1/batch")
      .set(auth("merchant_1"))
      .expect(201);

    expect(response.body.batch.id).toBe("batch_multi");
    expect(prismaMock.parcelBatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        merchant_order_id: "order_1",
        members: {
          create: [
            expect.objectContaining({ merchant_order_id: "order_1", active: true, active_membership_key: "order_1" }),
            expect.objectContaining({ merchant_order_id: "order_2", active: true, active_membership_key: "order_2" })
          ]
        }
      })
    }));
    expect(prismaMock.merchantOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["order_1", "order_2"] }, merchant_id: "merchant_1", canonical_entry_version: null, status: "submitted" },
      data: { status: "batched" }
    }));
    expect(prismaMock.parcel.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ order_id: { in: ["order_1", "order_2"] } }),
      data: expect.objectContaining({ status: "batched", batch_id: "batch_multi" })
    }));
  });

  it("merchant can batch own order into one batch", async () => {
    prismaMock.merchantOrder.findUnique.mockResolvedValue(merchantOrder);
    prismaMock.driverRoute.findFirst.mockResolvedValue(compatibleRoute);
    prismaMock.parcelBatch.create.mockResolvedValue({ id: "batch_1", status: "created", explanation: "5 parcels are compatible" });
    prismaMock.merchantOrder.update.mockResolvedValue({ ...merchantOrder, status: "batched" });

    const response = await request(createApp())
      .post("/api/v1/merchant/orders/order_1/batch")
      .set(auth("merchant_1"))
      .expect(201);

    expect(response.body.batch.id).toBe("batch_1");
  });

  it("non-merchant cannot batch order unless admin", async () => {
    await request(createApp()).post("/api/v1/merchant/orders/order_1/batch").set(auth("passenger_1")).expect(403);
  });

  it("merchant cannot batch another merchant's order", async () => {
    prismaMock.merchantOrder.findUnique.mockResolvedValue({ ...merchantOrder, merchant_id: "merchant_2" });

    await request(createApp()).post("/api/v1/merchant/orders/order_1/batch").set(auth("merchant_1")).expect(403);
  });

  it("invalid order state is rejected for batching", async () => {
    prismaMock.merchantOrder.findUnique.mockResolvedValue({ ...merchantOrder, status: "completed" });

    await request(createApp()).post("/api/v1/merchant/orders/order_1/batch").set(auth("merchant_1")).expect(409);
  });

  it("never sends a canonical order to legacy batching", async () => {
    prismaMock.merchantOrder.findUnique.mockResolvedValue({
      ...merchantOrder,
      canonical_entry_version: "canonical_route_v1",
      route_version_id: "version_1"
    });

    await request(createApp())
      .post("/api/v1/merchant/orders/order_1/batch")
      .set(auth("merchant_1"))
      .expect(409);

    expect(prismaMock.driverRoute.findFirst).not.toHaveBeenCalled();
  });

  it("an already batched order cannot create a duplicate batch", async () => {
    prismaMock.merchantOrder.findUnique.mockResolvedValue({
      ...merchantOrder,
      status: "batched",
      parcel_batches: [{ id: "batch_existing" }]
    });

    const response = await request(createApp())
      .post("/api/v1/merchant/orders/order_1/batch")
      .set(auth("merchant_1"))
      .expect(409);

    expect(response.body.error).toBe("order_already_batched");
    expect(prismaMock.parcelBatch.create).not.toHaveBeenCalled();
  });

  it("admin can run comparison and Masari wins seeded scenario", async () => {
    prismaMock.merchantOrder.findFirst.mockResolvedValue(merchantOrder);
    prismaMock.passengerRequest.findFirst.mockResolvedValue(passengerRequest);
    prismaMock.comparisonRun.create.mockImplementation(({ data }) => ({ id: "comparison_1", ...data }));

    const response = await request(createApp())
      .post("/api/v1/compare/run")
      .set(auth("admin_1"))
      .send({ scenarioKey: "masari_batch_wins" })
      .expect(201);

    expect(response.body.comparison.winner).toBe("masari");
    expect(response.body.comparison.masari_trips).toBe(1);
    expect(response.body.comparison.nearest_driver_trips).toBeGreaterThan(1);
    expect(prismaMock.merchantOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { canonical_entry_version: null } })
    );
    expect(prismaMock.passengerRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { canonical_entry_version: null } })
    );
  });

  it("does not accept explicit canonical demand in the legacy comparison", async () => {
    prismaMock.merchantOrder.findFirst.mockResolvedValue(null);
    prismaMock.passengerRequest.findFirst.mockResolvedValue(null);

    await request(createApp())
      .post("/api/v1/compare/run")
      .set(auth("admin_1"))
      .send({ passengerRequestId: "canonical_request" })
      .expect(404);

    expect(prismaMock.passengerRequest.findFirst).toHaveBeenCalledWith({
      where: { id: "canonical_request", canonical_entry_version: null }
    });
    expect(prismaMock.comparisonRun.create).not.toHaveBeenCalled();
  });

  it("non-admin cannot run comparison", async () => {
    await request(createApp()).post("/api/v1/compare/run").set(auth("merchant_1")).send({}).expect(403);
  });

  it("GET comparison run returns saved result", async () => {
    prismaMock.comparisonRun.findUnique.mockResolvedValue({ id: "comparison_1", winner: "masari" });

    const response = await request(createApp()).get("/api/v1/compare/runs/comparison_1").set(auth("admin_1")).expect(200);
    expect(response.body.comparison.winner).toBe("masari");
  });
  it("rejects departed merchant candidates before reserving capacity", async () => {
    prismaMock.merchantOrder.findUnique.mockResolvedValue(merchantOrder);
    prismaMock.driverRoute.findMany.mockResolvedValue([{ ...compatibleRoute, departure_at: new Date(Date.now() - 1) }]);
    await request(createApp()).post("/api/v1/matches/run").set(auth("merchant_1")).send({ merchantOrderId: "order_1" }).expect(404);
    expect(prismaMock.match.create).not.toHaveBeenCalled();
    expect(prismaMock.driverRoute.updateMany).not.toHaveBeenCalled();
  });

  it("creates no batch when a selected submitted order loses its claim", async () => {
    prismaMock.merchantOrder.findUnique.mockResolvedValue(merchantOrder);
    prismaMock.merchantOrder.updateMany.mockResolvedValue({ count: 0 });
    await request(createApp()).post("/api/v1/merchant/orders/order_1/batch").set(auth("merchant_1")).send({}).expect(409);
    expect(prismaMock.parcelBatch.create).not.toHaveBeenCalled();
    expect(prismaMock.parcel.updateMany).not.toHaveBeenCalled();
  });

});
