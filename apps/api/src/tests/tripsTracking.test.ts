import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  match: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  trip: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  driverRoute: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  passengerRequest: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  merchantOrder: { update: vi.fn(), updateMany: vi.fn() },
  parcelBatch: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  parcelBatchOrder: { findMany: vi.fn(), updateMany: vi.fn() },
  parcel: { count: vi.fn(), updateMany: vi.fn() },
  locationEvent: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  deliveryHandover: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");

type Role = "passenger" | "driver" | "merchant" | "admin";

const users: Record<string, { id: string; role: Role; name: string; phone: string; demo_account: boolean }> = {
  driver_1: { id: "driver_1", role: "driver", name: "Driver 1", phone: "+1", demo_account: true },
  driver_2: { id: "driver_2", role: "driver", name: "Driver 2", phone: "+2", demo_account: true },
  passenger_1: { id: "passenger_1", role: "passenger", name: "Passenger 1", phone: "+3", demo_account: true },
  passenger_2: { id: "passenger_2", role: "passenger", name: "Passenger 2", phone: "+4", demo_account: true },
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

const baseMatch = {
  id: "match_1",
  status: "proposed",
  operational_mode: "legacy",
  driver_route_id: "route_1",
  passenger_request_id: "request_1",
  merchant_order_id: "order_1",
  parcel_batch_id: "batch_1",
  driver_route: { id: "route_1", driver_id: "profile_1", driver: { id: "profile_1", user_id: "driver_1" } },
  passenger_request: { id: "request_1", passenger_id: "passenger_1", passenger_count: 1 },
  merchant_order: { id: "order_1", merchant_id: "merchant_1", parcels: [{ id: "parcel_1" }] },
  parcel_batch: { id: "batch_1" }
};

function baseTrip(status = "accepted") {
  return {
    id: "trip_1",
    driver_id: "profile_1",
    driver_route_id: "route_1",
    passenger_request_id: "request_1",
    merchant_order_id: "order_1",
    parcel_batch_id: "batch_1",
    status,
    driver_route: { id: "route_1", driver_id: "profile_1", driver: { id: "profile_1", user_id: "driver_1" } },
    passenger_request: { id: "request_1", passenger_id: "passenger_1", passenger_count: 1 },
    merchant_order: { id: "order_1", merchant_id: "merchant_1", parcels: [{ id: "parcel_1" }] },
    parcel_batch: { id: "batch_1" }
  };
}

describe("trip acceptance, status, and tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$queryRaw.mockImplementation((parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      if (sql.includes("UTC_TIMESTAMP")) return [{ now: new Date() }];
      if (sql.includes("FROM driver_routes")) return [{ id: "route_1", status: prismaMock.driverRoute.updateMany.mock.calls.some(([args]) => args.data?.status === "assigned") ? "assigned" : "active", verified: true, role: "driver", account_status: "active", departure_at: null, availability_window_end: null }];
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
    prismaMock.match.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.match.findMany.mockResolvedValue([]);
    prismaMock.trip.findFirst.mockResolvedValue(null);
    prismaMock.passengerRequest.findUnique.mockResolvedValue({ passenger_count: 1 });
    prismaMock.merchantOrder.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.parcelBatch.findUnique.mockResolvedValue({ id: "batch_1", status: "proposed" });
    prismaMock.parcelBatchOrder.findMany.mockResolvedValue([{ merchant_order_id: "order_1" }]);
    prismaMock.parcelBatchOrder.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.parcel.count.mockResolvedValue(1);
    prismaMock.deliveryHandover.findMany.mockResolvedValue([]);
    prismaMock.deliveryHandover.findUnique.mockResolvedValue(null);
    prismaMock.deliveryHandover.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.driverRoute.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.driverRoute.findUnique.mockResolvedValue({ id: "route_1", status: "assigned" });
    prismaMock.passengerRequest.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.trip.updateMany.mockImplementation(({ data }) => { prismaMock.trip.findUniqueOrThrow.mockResolvedValue(baseTrip(data.status)); return { count: 1 }; });
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
  });

  it("driver can accept own match and creates exactly one trip", async () => {
    prismaMock.match.findUnique.mockResolvedValue(baseMatch);
    prismaMock.trip.findFirst.mockResolvedValue(null);
    prismaMock.trip.create.mockResolvedValue({ id: "trip_1", status: "accepted" });
    prismaMock.match.update.mockResolvedValue({ ...baseMatch, status: "accepted" });

    const response = await request(createApp()).post("/api/v1/matches/match_1/accept").set(auth("driver_1")).expect(201);

    expect(response.body.trip.status).toBe("accepted");
    expect(prismaMock.trip.create).toHaveBeenCalledOnce();
    expect(prismaMock.trip.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          passenger_request_id: "request_1",
          legacy_assignment_key: "passenger:request_1",
          status: "accepted"
        })
      })
    );
    expect(prismaMock.driverRoute.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "route_1", status: "active", departed_at: null }),
      data: { status: "assigned" }
    });
    expect(prismaMock.passengerRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "accepted" } })
    );
  });

  it.each([
    { name: "expired offer", match: { expires_at: new Date(0) }, route: {} },
    { name: "past scheduled departure", match: {}, route: { departure_at: new Date(0) } },
    { name: "departed route with stale active status", match: {}, route: { departed_at: new Date(0) } },
    { name: "expired availability with stale active status", match: {}, route: { availability_window_end: new Date(0) } },
  ])("rejects $name before accepting demand or creating a trip", async ({ match, route }) => {
    prismaMock.match.findUnique.mockResolvedValue({ ...baseMatch, ...match,
      driver_route: { ...baseMatch.driver_route, status: "active", ...route } });
    await request(createApp()).post("/api/v1/matches/match_1/accept").set(auth("driver_1")).expect(409);
    expect(prismaMock.passengerRequest.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.trip.create).not.toHaveBeenCalled();
  });

  it("prevents a duplicate trip for a passenger request even when an older trip used another route", async () => {
    prismaMock.match.findUnique.mockResolvedValue(baseMatch);
    prismaMock.trip.findFirst.mockResolvedValue({
      id: "legacy_trip",
      passenger_request_id: "request_1",
      driver_route_id: "old_route",
      status: "completed"
    });

    await request(createApp())
      .post("/api/v1/matches/match_1/accept")
      .set(auth("driver_1"))
      .expect(409);

    expect(prismaMock.trip.create).not.toHaveBeenCalled();
  });

  it("atomically rejects a passenger deadline that passes while acceptance awaits duplicate lookup", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const initial = new Date("2026-10-16T12:00:00.000Z");
    vi.setSystemTime(initial);
    const deadline = new Date(initial.getTime() + 1_000);
    prismaMock.match.findUnique.mockResolvedValue({ ...baseMatch,
      passenger_request: { ...baseMatch.passenger_request, preferred_time: deadline } });
    prismaMock.trip.findFirst.mockImplementation(async () => {
      vi.setSystemTime(new Date(initial.getTime() + 2_000));
      return null;
    });
    prismaMock.passengerRequest.updateMany.mockImplementation(async ({ where }) => ({
      count: where.preferred_time?.gt >= deadline ? 0 : 1,
    }));
    try {
      await request(createApp()).post("/api/v1/matches/match_1/accept").set(auth("driver_1")).expect(409);
      expect(prismaMock.passengerRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ preferred_time: { gt: new Date(initial.getTime() + 2_000) } }),
      }));
      expect(prismaMock.trip.create).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["passengerRequest", "match", "driverRoute"] as const)(
    "rechecks deadlines after the %s claim waits across its deadline", async claimDelegate => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const initial = new Date("2026-10-16T12:00:00.000Z");
      vi.setSystemTime(initial);
      const deadline = new Date(initial.getTime() + 1_000);
      const preferredTime = claimDelegate === "passengerRequest" ? deadline : new Date(initial.getTime() + 3_600_000);
      const expiresAt = claimDelegate === "match" ? deadline : new Date(initial.getTime() + 600_000);
      const departureAt = claimDelegate === "driverRoute" ? deadline : null;
      prismaMock.match.findUnique.mockResolvedValue({ ...baseMatch, legacy_capacity_held: true, expires_at: expiresAt,
        passenger_request: { ...baseMatch.passenger_request, preferred_time: preferredTime },
        driver_route: { ...baseMatch.driver_route, departure_at: departureAt } });
      prismaMock[claimDelegate].updateMany.mockImplementation(async () => {
        vi.setSystemTime(new Date(initial.getTime() + 2_000));
        return { count: 1 };
      });
      prismaMock.$queryRaw.mockImplementation((parts: TemplateStringsArray) => {
        const sql = parts.join("?");
        if (sql.includes("UTC_TIMESTAMP")) return [{ now: new Date() }];
        if (sql.includes("FROM merchant_orders")) return [{ status: "matched" }];
        if (sql.includes("FROM matches")) return [{ status: "proposed", expires_at: expiresAt }];
        return [{ id: "route_1", status: prismaMock.driverRoute.updateMany.mock.calls.some(([args]) => args.data?.status === "assigned") ? "assigned" : "active", verified: true, role: "driver", account_status: "active", preferred_time: preferredTime, match_expires_at: expiresAt, departure_at: departureAt, departed_at: null, availability_window_end: null }];
      });
      try {
        await request(createApp()).post("/api/v1/matches/match_1/accept").set(auth("driver_1")).expect(409);
        expect(prismaMock.trip.create).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("prevents a second concurrent accept after the match claim is lost", async () => {
    prismaMock.match.findUnique.mockResolvedValue(baseMatch);
    prismaMock.trip.findFirst.mockResolvedValue(null);
    prismaMock.match.updateMany.mockResolvedValue({ count: 0 });

    await request(createApp())
      .post("/api/v1/matches/match_1/accept")
      .set(auth("driver_1"))
      .expect(409);

    expect(prismaMock.trip.create).not.toHaveBeenCalled();
  });

  it("accepting a legacy match claims the reserved capacity exactly once", async () => {
    prismaMock.match.findUnique.mockResolvedValue({ ...baseMatch, legacy_capacity_held: false });
    prismaMock.trip.findFirst.mockResolvedValue(null);
    prismaMock.trip.create.mockResolvedValue({ id: "trip_1", status: "accepted" });
    prismaMock.match.update.mockResolvedValue({ ...baseMatch, status: "accepted", legacy_capacity_held: true });

    await request(createApp()).post("/api/v1/matches/match_1/accept").set(auth("driver_1")).expect(201);

    expect(prismaMock.driverRoute.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "route_1", seats_available: { gte: 1 }, parcel_capacity_available: { gte: 1 } }),
      data: expect.objectContaining({ seats_available: { decrement: 1 }, parcel_capacity_available: { decrement: 1 } })
    }));
    expect(prismaMock.match.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "accepted", legacy_capacity_held: true })
    }));
  });

  it("driver cannot accept another driver route match", async () => {
    prismaMock.match.findUnique.mockResolvedValue({ ...baseMatch, driver_route: { ...baseMatch.driver_route, driver: { user_id: "driver_2" } } });

    await request(createApp()).post("/api/v1/matches/match_1/accept").set(auth("driver_1")).expect(403);
  });

  it("admin can accept demo match", async () => {
    prismaMock.match.findUnique.mockResolvedValue(baseMatch);
    prismaMock.trip.findFirst.mockResolvedValue(null);
    prismaMock.trip.create.mockResolvedValue({ id: "trip_1", status: "accepted" });
    prismaMock.match.update.mockResolvedValue({ ...baseMatch, status: "accepted" });

    await request(createApp()).post("/api/v1/matches/match_1/accept").set(auth("admin_1")).expect(201);
  });

  it("driver cannot reject another driver's match", async () => {
    prismaMock.match.findUnique.mockResolvedValue({
      ...baseMatch,
      driver_route: { ...baseMatch.driver_route, driver: { user_id: "driver_2" } }
    });

    await request(createApp())
      .post("/api/v1/matches/match_1/reject")
      .set(auth("driver_1"))
      .expect(403);

    expect(prismaMock.match.updateMany).not.toHaveBeenCalled();
  });

  it("rejecting a match does not create a trip", async () => {
    prismaMock.match.findUnique.mockResolvedValue(baseMatch);
    prismaMock.match.update.mockResolvedValue({ ...baseMatch, status: "rejected" });

    const response = await request(createApp()).post("/api/v1/matches/match_1/reject").set(auth("driver_1")).expect(200);

    expect(response.body.match.status).toBe("rejected");
    expect(prismaMock.trip.create).not.toHaveBeenCalled();
    expect(prismaMock.passengerRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "request_1", status: "matched" },
      data: { status: "pending" }
    }));
  });

  it("legacy accept and reject never process a canonical match", async () => {
    prismaMock.match.findUnique.mockResolvedValue({
      ...baseMatch,
      route_version_id: "version_1",
      canonical_match_version: "canonical_route_v1",
      operational_mode: "canonical_route_v1"
    });

    await request(createApp()).post("/api/v1/matches/match_1/accept").set(auth("driver_1")).expect(409);
    await request(createApp()).post("/api/v1/matches/match_1/reject").set(auth("driver_1")).expect(409);
    expect(prismaMock.trip.create).not.toHaveBeenCalled();
    expect(prismaMock.match.update).not.toHaveBeenCalled();
    expect(prismaMock.match.updateMany).not.toHaveBeenCalled();
  });

  it("already accepted or rejected match cannot be accepted", async () => {
    prismaMock.match.findUnique.mockResolvedValue({ ...baseMatch, status: "accepted" });
    await request(createApp()).post("/api/v1/matches/match_1/accept").set(auth("driver_1")).expect(409);

    prismaMock.match.findUnique.mockResolvedValue({ ...baseMatch, status: "rejected" });
    await request(createApp()).post("/api/v1/matches/match_1/accept").set(auth("driver_1")).expect(409);
  });

  it("driver, passenger, merchant, and admin can see connected trip", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(baseTrip());

    await request(createApp()).get("/api/v1/trips/trip_1").set(auth("driver_1")).expect(200);
    await request(createApp()).get("/api/v1/trips/trip_1").set(auth("passenger_1")).expect(200);
    await request(createApp()).get("/api/v1/trips/trip_1").set(auth("merchant_1")).expect(200);
    await request(createApp()).get("/api/v1/trips/trip_1").set(auth("admin_1")).expect(200);
  });

  it("unrelated user cannot see trip", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(baseTrip());

    await request(createApp()).get("/api/v1/trips/trip_1").set(auth("passenger_2")).expect(403);
  });

  it("preserves exact passenger request provenance for same-owner Trip lists regardless of ordering", async () => {
    const tripA = {
      ...baseTrip(),
      id: "trip_a",
      passenger_request_id: "request_a",
      created_at: new Date("2026-08-06T10:00:00.000Z")
    };
    const tripB = {
      ...baseTrip(),
      id: "trip_b",
      passenger_request_id: "request_b",
      created_at: new Date("2026-08-06T12:00:00.000Z")
    };
    prismaMock.trip.findMany.mockResolvedValue([tripB, tripA]);

    const first = await request(createApp()).get("/api/v1/trips").set(auth("passenger_1")).expect(200);
    expect(first.body.trips.map((trip: { id: string; passenger_request_id: string }) => [
      trip.id,
      trip.passenger_request_id
    ])).toEqual([
      ["trip_b", "request_b"],
      ["trip_a", "request_a"]
    ]);
    expect(prismaMock.trip.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        operational_mode: "legacy",
        canonical_trip_version: null,
        passenger_request: { passenger_id: "passenger_1" }
      }),
      orderBy: { created_at: "desc" }
    }));

    prismaMock.trip.findMany.mockResolvedValue([tripA, tripB]);
    const reversed = await request(createApp()).get("/api/v1/trips").set(auth("passenger_1")).expect(200);
    expect(reversed.body.trips.find((trip: { id: string }) => trip.id === "trip_a"))
      .toHaveProperty("passenger_request_id", "request_a");
    expect(reversed.body.trips.find((trip: { id: string }) => trip.id === "trip_b"))
      .toHaveProperty("passenger_request_id", "request_b");
  });

  it("valid status sequence works", async () => {
    const statuses = ["accepted", "pickup_started", "picked_up", "in_transit", "delivered"];
    prismaMock.deliveryHandover.findMany.mockResolvedValue([{ merchant_order_id: "order_1" }]);
    prismaMock.trip.findUnique.mockImplementation(() => baseTrip(statuses.shift() ?? "completed"));
    prismaMock.trip.update.mockImplementation(({ data }) => ({ ...baseTrip(data.status), status: data.status }));

    await request(createApp()).post("/api/v1/trips/trip_1/status").set(auth("driver_1")).send({ status: "pickup_started" }).expect(200);
    await request(createApp()).post("/api/v1/trips/trip_1/status").set(auth("driver_1")).send({ status: "picked_up" }).expect(200);
    await request(createApp()).post("/api/v1/trips/trip_1/status").set(auth("driver_1")).send({ status: "in_transit" }).expect(200);
    await request(createApp()).post("/api/v1/trips/trip_1/status").set(auth("driver_1")).send({ status: "delivered" }).expect(200);
    await request(createApp()).post("/api/v1/trips/trip_1/status").set(auth("driver_1")).send({ status: "completed" }).expect(200);
  });

  describe("receiver delivery confirmation", () => {
    const digestOf = async (code: string, key = { secret: "test-only-jwt-secret-with-at-least-thirty-two-characters", version: 1 }) => {
      const { handoverCodeDigest } = await import("../services/deliveryHandover.js");
      return handoverCodeDigest("order_1", code, key);
    };
    const handoverRow = async (extra: Record<string, unknown> = {}) => {
      const { handoverKey } = await import("../services/deliveryHandover.js");
      return {
        id: "handover_1",
        merchant_order_id: "order_1",
        code_digest: await digestOf("123456", handoverKey()),
        key_version: handoverKey().version,
        failed_attempts: 0,
        expires_at: new Date(Date.now() + 60_000),
        confirmed_at: null,
        ...extra
      };
    };

    it("a parcel trip cannot be marked delivered through the plain status route without confirmation", async () => {
      prismaMock.trip.findUnique.mockResolvedValue(baseTrip("in_transit"));
      const response = await request(createApp()).post("/api/v1/trips/trip_1/status").set(auth("driver_1")).send({ status: "delivered" }).expect(409);
      expect(response.body.error).toBe("delivery_confirmation_required");
      expect(prismaMock.trip.updateMany).not.toHaveBeenCalled();
    });

    it("the right receiver code confirms the order and delivers the trip", async () => {
      prismaMock.trip.findUnique.mockResolvedValue(baseTrip("in_transit"));
      prismaMock.deliveryHandover.findUnique.mockResolvedValue(await handoverRow());
      prismaMock.deliveryHandover.findMany.mockResolvedValueOnce([]).mockResolvedValue([{ merchant_order_id: "order_1" }]);
      const response = await request(createApp())
        .post("/api/v1/trips/trip_1/delivery-confirmation").set(auth("driver_1"))
        .send({ method: "receiver_code", code: "123456" }).expect(200);
      expect(response.body.delivered).toBe(true);
      expect(prismaMock.deliveryHandover.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ confirmation_method: "receiver_code", confirmed_by_id: "driver_1", code_digest: null })
      }));
    });

    it("a wrong code spends an attempt and leaves the trip in transit", async () => {
      prismaMock.trip.findUnique.mockResolvedValue(baseTrip("in_transit"));
      prismaMock.deliveryHandover.findUnique.mockResolvedValue(await handoverRow());
      const response = await request(createApp())
        .post("/api/v1/trips/trip_1/delivery-confirmation").set(auth("driver_1"))
        .send({ method: "receiver_code", code: "000000" }).expect(422);
      expect(response.body.error).toBe("invalid_handover_code");
      expect(prismaMock.deliveryHandover.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { failed_attempts: { increment: 1 } }
      }));
      expect(prismaMock.trip.updateMany).not.toHaveBeenCalled();
    });

    it("locks after five wrong guesses and refuses even the right code", async () => {
      prismaMock.trip.findUnique.mockResolvedValue(baseTrip("in_transit"));
      prismaMock.deliveryHandover.findUnique.mockResolvedValue(await handoverRow({ failed_attempts: 5 }));
      prismaMock.deliveryHandover.updateMany.mockResolvedValue({ count: 0 });
      const response = await request(createApp())
        .post("/api/v1/trips/trip_1/delivery-confirmation").set(auth("driver_1"))
        .send({ method: "receiver_code", code: "123456" }).expect(429);
      expect(response.body.error).toBe("handover_locked");
    });

    it("an expired code is refused without spending an attempt", async () => {
      prismaMock.trip.findUnique.mockResolvedValue(baseTrip("in_transit"));
      prismaMock.deliveryHandover.findUnique.mockResolvedValue(await handoverRow({ expires_at: new Date(Date.now() - 1000) }));
      const response = await request(createApp())
        .post("/api/v1/trips/trip_1/delivery-confirmation").set(auth("driver_1"))
        .send({ method: "receiver_code", code: "123456" }).expect(409);
      expect(response.body.error).toBe("handover_expired");
      expect(prismaMock.deliveryHandover.updateMany).not.toHaveBeenCalled();
    });

    it("receiver unavailable needs a real reason, is audited and flagged", async () => {
      prismaMock.trip.findUnique.mockResolvedValue(baseTrip("in_transit"));
      await request(createApp())
        .post("/api/v1/trips/trip_1/delivery-confirmation").set(auth("driver_1"))
        .send({ method: "receiver_unavailable", reason: "short" }).expect(400);

      prismaMock.deliveryHandover.findMany.mockResolvedValueOnce([]).mockResolvedValue([{ merchant_order_id: "order_1" }]);
      await request(createApp())
        .post("/api/v1/trips/trip_1/delivery-confirmation").set(auth("driver_1"))
        .send({ method: "receiver_unavailable", reason: "Nobody answered the door or the phone" }).expect(200);
      expect(prismaMock.deliveryHandover.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ confirmation_method: "receiver_unavailable", unavailable_reason: "Nobody answered the door or the phone" })
      }));
      expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ event: "delivery_confirmed", method: "receiver_unavailable", flagged: true })
        })
      });
    });

    it("only the assigned driver may confirm, and only while in transit", async () => {
      prismaMock.trip.findUnique.mockResolvedValue(baseTrip("in_transit"));
      await request(createApp())
        .post("/api/v1/trips/trip_1/delivery-confirmation").set(auth("driver_2"))
        .send({ method: "receiver_code", code: "123456" }).expect(403);
      await request(createApp())
        .post("/api/v1/trips/trip_1/delivery-confirmation").set(auth("merchant_1"))
        .send({ method: "receiver_code", code: "123456" }).expect(403);
      prismaMock.trip.findUnique.mockResolvedValue(baseTrip("picked_up"));
      await request(createApp())
        .post("/api/v1/trips/trip_1/delivery-confirmation").set(auth("driver_1"))
        .send({ method: "receiver_code", code: "123456" }).expect(409);
    });

    it("an admin forward move records an admin override instead of blocking", async () => {
      prismaMock.trip.findUnique.mockResolvedValue(baseTrip("in_transit"));
      prismaMock.deliveryHandover.updateMany.mockResolvedValue({ count: 1 });
      await request(createApp()).post("/api/v1/trips/trip_1/status").set(auth("admin_1")).send({ status: "delivered" }).expect(200);
      expect(prismaMock.deliveryHandover.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ confirmation_method: "admin_override", confirmed_by_id: "admin_1" })
      }));
    });
  });

  it("invalid status jump is rejected", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(baseTrip("accepted"));

    await request(createApp()).post("/api/v1/trips/trip_1/status").set(auth("driver_1")).send({ status: "delivered" }).expect(409);
  });

  it("pickup start records the actual start time and marks the route on trip", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(baseTrip("accepted"));
    prismaMock.trip.update.mockResolvedValue(baseTrip("pickup_started"));

    await request(createApp())
      .post("/api/v1/trips/trip_1/status")
      .set(auth("driver_1"))
      .send({ status: "pickup_started" })
      .expect(200);

    expect(prismaMock.trip.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "pickup_started", started_at: expect.any(Date) })
      })
    );
    expect(prismaMock.driverRoute.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "on_trip" }) })
    );
  });

  it("driver rejection releases the held legacy capacity", async () => {
    prismaMock.match.findUnique.mockResolvedValue({ ...baseMatch, legacy_capacity_held: true });
    prismaMock.match.update.mockResolvedValue({ ...baseMatch, status: "rejected" });

    await request(createApp()).post("/api/v1/matches/match_1/reject").set(auth("driver_1")).expect(200);

    expect(prismaMock.driverRoute.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "route_1" },
      data: expect.objectContaining({ seats_available: { increment: 1 } })
    }));
  });

  it("trip cancellation persists to the passenger request and closes the route", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(baseTrip("accepted"));
    prismaMock.trip.update.mockResolvedValue(baseTrip("cancelled"));

    await request(createApp())
      .post("/api/v1/trips/trip_1/status")
      .set(auth("driver_1"))
      .send({ status: "cancelled" })
      .expect(200);

    expect(prismaMock.passengerRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "cancelled" } })
    );
    expect(prismaMock.driverRoute.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "active" }) })
    );
  });

  it("trip cancellation after start releases legacy capacity and closes the route", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(baseTrip("in_transit"));
    prismaMock.trip.update.mockResolvedValue(baseTrip("cancelled"));

    await request(createApp())
      .post("/api/v1/trips/trip_1/status")
      .set(auth("driver_1"))
      .send({ status: "cancelled" })
      .expect(200);

    expect(prismaMock.driverRoute.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        seats_available: { increment: 1 },
        parcel_capacity_available: { increment: 1 },
        status: "active"
      })
    }));
    expect(prismaMock.passengerRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "cancelled" } })
    );
    expect(prismaMock.driverRoute.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) })
    );
  });

  it("failed delivery is terminal and synchronizes merchant entities", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(baseTrip("in_transit"));
    prismaMock.trip.update.mockResolvedValue(baseTrip("failed"));

    await request(createApp())
      .post("/api/v1/trips/trip_1/status")
      .set(auth("driver_1"))
      .send({ status: "failed" })
      .expect(200);

    expect(prismaMock.driverRoute.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        seats_available: { increment: 1 },
        parcel_capacity_available: { increment: 1 },
        status: "active"
      })
    }));
    expect(prismaMock.passengerRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "cancelled" } }));
    expect(prismaMock.parcelBatch.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "failed" } }));
    expect(prismaMock.parcel.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "failed" } }));
    expect(prismaMock.merchantOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "failed" } }));
  });

  it("completed is persisted to the passenger request and closes the route", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(baseTrip("delivered"));
    prismaMock.trip.update.mockResolvedValue(baseTrip("completed"));

    await request(createApp()).post("/api/v1/trips/trip_1/status").set(auth("driver_1")).send({ status: "completed" }).expect(200);

    expect(prismaMock.passengerRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "completed" } }));
    expect(prismaMock.driverRoute.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }));
  });

  it("picked_up updates related request, batch, and parcels", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(baseTrip("pickup_started"));
    prismaMock.trip.update.mockResolvedValue(baseTrip("picked_up"));

    await request(createApp()).post("/api/v1/trips/trip_1/status").set(auth("driver_1")).send({ status: "picked_up" }).expect(200);

    expect(prismaMock.passengerRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "picked_up" } }));
    expect(prismaMock.parcelBatch.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "picked_up" } }));
    expect(prismaMock.parcel.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "picked_up" } }));
  });

  it("simulate step creates deterministic location events", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(baseTrip());
    prismaMock.locationEvent.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ sequence: 0 });
    prismaMock.locationEvent.create.mockImplementation(({ data }) => ({ id: `loc_${data.sequence}`, ...data }));

    const first = await request(createApp()).post("/api/v1/trips/trip_1/simulate/step").set(auth("driver_1")).expect(201);
    const second = await request(createApp()).post("/api/v1/trips/trip_1/simulate/step").set(auth("driver_1")).expect(201);

    expect(first.body.location.sequence).toBe(0);
    expect(second.body.location.sequence).toBe(1);
  });

  it("latest location endpoint returns latest event", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(baseTrip());
    prismaMock.locationEvent.findFirst.mockResolvedValue({ id: "loc_2", sequence: 2, lat: "31.585000", lng: "35.123000" });

    const response = await request(createApp()).get("/api/v1/trips/trip_1/location").set(auth("passenger_1")).expect(200);

    expect(response.body.location.sequence).toBe(2);
  });

  it("unauthorized user cannot read unrelated trip location", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(baseTrip());

    await request(createApp()).get("/api/v1/trips/trip_1/location").set(auth("merchant_2")).expect(403);
  });
  it("rejects an expired merchant offer before creating a trip", async () => {
    prismaMock.match.findUnique.mockResolvedValue(baseMatch);
    const original = prismaMock.$queryRaw.getMockImplementation()!;
    prismaMock.$queryRaw.mockImplementation((parts: TemplateStringsArray) => parts.join("?").includes("FROM matches")
      ? [{ status: "proposed", expires_at: new Date(Date.now() - 1) }] : original(parts));
    await request(createApp()).post("/api/v1/matches/match_1/accept").set(auth("driver_1")).expect(409);
    expect(prismaMock.trip.create).not.toHaveBeenCalled();
    expect(prismaMock.match.updateMany).not.toHaveBeenCalled();
  });

  it("revalidates driver approval even when an offer already holds capacity", async () => {
    prismaMock.match.findUnique.mockResolvedValue({ ...baseMatch, legacy_capacity_held: true });
    const original = prismaMock.$queryRaw.getMockImplementation()!;
    prismaMock.$queryRaw.mockImplementation((parts: TemplateStringsArray) => parts.join("?").includes("FROM driver_routes")
      ? [{ status: "active", verified: false, role: "driver", account_status: "active" }] : original(parts));
    await request(createApp()).post("/api/v1/matches/match_1/accept").set(auth("driver_1")).expect(409);
    expect(prismaMock.trip.create).not.toHaveBeenCalled();
  });

});
