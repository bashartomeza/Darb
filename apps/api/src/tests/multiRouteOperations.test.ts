import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";
import { HttpError } from "../middleware/error.js";
import {
  requireMerchantStops,
  requirePassengerStopPair,
  type EligibleOperationalRoute
} from "../services/operationalRouteEligibility.js";

const prismaMock = vi.hoisted(() => ({
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() }
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");

type Role = "passenger" | "driver" | "merchant" | "admin";
const users: Record<string, { id: string; role: Role; account_status: "active" | "pending" | "suspended" | "disabled" }> = {
  passenger_1: { id: "passenger_1", role: "passenger", account_status: "active" },
  driver_1: { id: "driver_1", role: "driver", account_status: "active" },
  merchant_1: { id: "merchant_1", role: "merchant", account_status: "active" },
  admin_1: { id: "admin_1", role: "admin", account_status: "active" },
  pending_driver: { id: "pending_driver", role: "driver", account_status: "pending" },
  suspended_passenger: { id: "suspended_passenger", role: "passenger", account_status: "suspended" },
  disabled_merchant: { id: "disabled_merchant", role: "merchant", account_status: "disabled" }
};

const environment = {
  APP_ENV: "local",
  DATABASE_URL: "mysql://test:test@localhost:3306/darb_test",
  JWT_SECRET: "test-only-jwt-secret-with-at-least-thirty-two-characters",
  CORS_ORIGINS: "http://localhost:5173",
  LOG_LEVEL: "silent",
  MULTI_ROUTE_ENTRY_ENABLED: "true"
};
const enabledConfig = createConfig(environment);
const disabledConfig = createConfig({ ...environment, MULTI_ROUTE_ENTRY_ENABLED: "false" });

function auth(id: keyof typeof users) {
  const user = users[id];
  const token = jwt.sign(
    { role: user.role, sid: `session_${id}`, ver: 1 },
    environment.JWT_SECRET,
    { subject: id, expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}` };
}

const departure = () => new Date(Date.now() + 3_600_000);
const until = () => new Date(Date.now() + 7_200_000);
const version = {
  id: "version_1",
  version_number: 1,
  name_ar: "الخليل إلى بيت لحم",
  name_en: "Hebron to Bethlehem",
  service_route: { id: "route_1", route_key: "hebron-bethlehem-outbound", direction: "outbound" }
};
const availability = {
  id: "availability_1",
  route_version_id: "version_1",
  canonical_availability_version: "canonical_route_v1",
  route_version: version,
  departure_at: departure(),
  availability_window_end: until(),
  total_seats: 4,
  remaining_seats: 4,
  total_parcel_capacity: 10,
  remaining_parcel_capacity: 10,
  availability_status: "draft",
  availability_revision: 1,
  origin_lat: "must-not-leak",
  idempotency_fingerprint: "must-not-leak"
};

function driverServiceMock() {
  return {
    listOwner: vi.fn().mockResolvedValue([availability]),
    getOwner: vi.fn().mockResolvedValue(availability),
    createOneOff: vi.fn().mockResolvedValue({ resource: availability, replayed: false }),
    updateOneOff: vi.fn().mockResolvedValue({ ...availability, availability_revision: 2 }),
    activate: vi.fn().mockResolvedValue({ ...availability, availability_status: "active", availability_revision: 2 }),
    pause: vi.fn().mockResolvedValue({ ...availability, availability_status: "paused", availability_revision: 2 }),
    resume: vi.fn().mockResolvedValue({ ...availability, availability_status: "active", availability_revision: 2 }),
    cancel: vi.fn().mockResolvedValue({ ...availability, availability_status: "cancelled", availability_revision: 2 })
  };
}

const passengerResource = {
  id: "request_1",
  status: "pending",
  canonical_entry_version: "canonical_route_v1",
  route_version_id: "version_1",
  pickup_stop_id: "stop_1",
  dropoff_stop_id: "stop_3",
  requested_departure_from: departure(),
  requested_departure_until: until(),
  passenger_count: 2,
  canonical_created_at: new Date(),
  pickup_lat: "must-not-leak"
};
const merchantResource = {
  id: "order_1",
  status: "submitted",
  canonical_entry_version: "canonical_route_v1",
  route_version_id: "version_1",
  pickup_stop_id: "stop_1",
  requested_departure_from: departure(),
  requested_departure_until: until(),
  canonical_created_at: new Date(),
  pickup_lng: "must-not-leak",
  parcels: [{
    id: "parcel_1", status: "pending", canonical_entry_version: "canonical_route_v1",
    route_version_id: "version_1", destination_stop_id: "stop_3", size: "S", priority: "normal",
    destination_lat: "must-not-leak"
  }]
};

function demandServiceMock() {
  return {
    createPassengerRequest: vi.fn().mockResolvedValue({ resource: passengerResource, replayed: false }),
    createMerchantOrder: vi.fn().mockResolvedValue({ resource: merchantResource, replayed: false })
  };
}

function app(config = enabledConfig) {
  const driver = driverServiceMock();
  const demand = demandServiceMock();
  return {
    server: createApp(config, { driverAvailabilityService: driver as never, canonicalDemandService: demand as never }),
    driver,
    demand
  };
}

describe("M7C1 operational APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const user = users[where.id.replace(/^session_/, "")];
      return user ? {
        id: where.id,
        user_id: user.id,
        user: { email_verified_at: new Date(), ...user, security_version: 1 },
        security_version_at_issue: 1,
        expires_at: new Date(Date.now() + 60_000),
        revoked_at: null
      } : null;
    });
    prismaMock.authSession.update.mockResolvedValue({});
  });

  it("hides every canonical entry endpoint when the gate is disabled", async () => {
    const target = app(disabledConfig);
    await request(target.server).post("/api/v1/passenger/route-requests").send({}).expect(404);
    await request(target.server).get("/api/v1/driver/availabilities").set(auth("driver_1")).expect(404);
    await request(target.server).post("/api/v1/passenger/route-requests").set(auth("passenger_1")).send({}).expect(404);
    await request(target.server).post("/api/v1/merchant/route-orders").set(auth("merchant_1")).send({}).expect(404);
  });

  it("requires trusted active role sessions", async () => {
    const target = app();
    await request(target.server).get("/api/v1/driver/availabilities").expect(401);
    await request(target.server).get("/api/v1/driver/availabilities").set(auth("passenger_1")).expect(403);
    await request(target.server).get("/api/v1/driver/availabilities").set(auth("pending_driver")).expect(403);
    await request(target.server).post("/api/v1/passenger/route-requests").set(auth("suspended_passenger")).send({}).expect(403);
    await request(target.server).post("/api/v1/merchant/route-orders").set(auth("disabled_merchant")).send({}).expect(403);
  });

  it("creates, lists, reads, updates, and transitions only safe driver availability summaries", async () => {
    const target = app();
    const body = {
      route_version_id: "version_1",
      departure_at: departure().toISOString(),
      availability_window_end: until().toISOString(),
      total_seats: 4,
      total_parcel_capacity: 10
    };
    await request(target.server).post("/api/v1/driver/availabilities").set(auth("driver_1")).send(body).expect(400);
    const created = await request(target.server)
      .post("/api/v1/driver/availabilities")
      .set(auth("driver_1"))
      .set("Idempotency-Key", "availability-create-001")
      .send(body)
      .expect(201);
    expect(created.body.availability.route_version.name_ar).toBe("الخليل إلى بيت لحم");
    expect(created.body.availability.mode).toBe("canonical_route_v1");
    expect(JSON.stringify(created.body)).not.toContain("must-not-leak");
    await request(target.server).get("/api/v1/driver/availabilities").set(auth("driver_1")).expect(200);
    await request(target.server).get("/api/v1/driver/availabilities/availability_1").set(auth("driver_1")).expect(200);
    await request(target.server)
      .patch("/api/v1/driver/availabilities/availability_1")
      .set(auth("driver_1"))
      .send({ expected_revision: 1, total_seats: 3 })
      .expect(200);
    for (const action of ["activate", "pause", "resume", "cancel"] as const) {
      await request(target.server)
        .post(`/api/v1/driver/availabilities/availability_1/${action}`)
        .set(auth("driver_1"))
        .send({ expected_revision: 1 })
        .expect(200);
      expect(target.driver[action]).toHaveBeenCalledWith(
        "availability_1", 1, expect.objectContaining({ id: "driver_1", requestId: expect.any(String) })
      );
    }
  });

  it("rejects arbitrary or mixed availability fields", async () => {
    const target = app();
    await request(target.server)
      .post("/api/v1/driver/availabilities")
      .set(auth("driver_1"))
      .set("Idempotency-Key", "availability-create-002")
      .send({
        route_version_id: "version_1", departure_at: departure().toISOString(), total_seats: 1,
        total_parcel_capacity: 0, origin_lat: 31.5
      })
      .expect(400);
    expect(target.driver.createOneOff).not.toHaveBeenCalled();
  });

  it("creates an idempotent canonical passenger request without coordinates or legacy matcher entry", async () => {
    const target = app();
    const response = await request(target.server)
      .post("/api/v1/passenger/route-requests")
      .set(auth("passenger_1"))
      .set("Idempotency-Key", "passenger-route-request-001")
      .send({
        route_version_id: "version_1", pickup_stop_id: "stop_1", dropoff_stop_id: "stop_3",
        requested_departure_from: departure().toISOString(), requested_departure_until: until().toISOString(),
        passenger_count: 2
      })
      .expect(201);
    expect(response.body.request.mode).toBe("canonical_route_v1");
    expect(response.body.matching).toEqual({ enabled: false, status: "not_active_in_m7c1" });
    expect(JSON.stringify(response.body)).not.toContain("must-not-leak");
    expect(target.demand.createPassengerRequest).toHaveBeenCalledWith(
      expect.objectContaining({ routeVersionId: "version_1", pickupStopId: "stop_1", dropoffStopId: "stop_3" }),
      expect.objectContaining({ id: "passenger_1", idempotencyKey: "passenger-route-request-001" })
    );
  });

  it("creates one-route merchant demand and rejects arbitrary coordinates", async () => {
    const target = app();
    const payload = {
      route_version_id: "version_1", pickup_stop_id: "stop_1",
      requested_departure_from: departure().toISOString(), requested_departure_until: until().toISOString(),
      parcels: [{ destination_stop_id: "stop_3", size: "S", priority: "normal" }]
    };
    await request(target.server)
      .post("/api/v1/merchant/route-orders")
      .set(auth("merchant_1"))
      .set("Idempotency-Key", "merchant-route-order-001")
      .send({ ...payload, pickup_lat: 31.5 })
      .expect(400);
    const response = await request(target.server)
      .post("/api/v1/merchant/route-orders")
      .set(auth("merchant_1"))
      .set("Idempotency-Key", "merchant-route-order-002")
      .send(payload)
      .expect(201);
    expect(response.body.order.parcels[0]).toEqual(expect.objectContaining({ destination_stop_id: "stop_3" }));
    expect(response.body.batching.enabled).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain("must-not-leak");
  });

  it("accepts the 50-parcel boundary and rejects one parcel over the limit", async () => {
    const target = app();
    const base = {
      route_version_id: "version_1",
      pickup_stop_id: "stop_1",
      requested_departure_from: departure().toISOString(),
      requested_departure_until: until().toISOString()
    };
    const parcel = { destination_stop_id: "stop_3", size: "S", priority: "normal" };

    await request(target.server)
      .post("/api/v1/merchant/route-orders")
      .set(auth("merchant_1"))
      .set("Idempotency-Key", "merchant-route-order-boundary")
      .send({ ...base, parcels: Array.from({ length: 50 }, () => parcel) })
      .expect(201);
    await request(target.server)
      .post("/api/v1/merchant/route-orders")
      .set(auth("merchant_1"))
      .set("Idempotency-Key", "merchant-route-order-over-limit")
      .send({ ...base, parcels: Array.from({ length: 51 }, () => parcel) })
      .expect(400);

    expect(target.demand.createMerchantOrder).toHaveBeenCalledTimes(1);
    expect(target.demand.createMerchantOrder).toHaveBeenCalledWith(
      expect.objectContaining({ parcels: expect.arrayContaining([expect.objectContaining({ destinationStopId: "stop_3" })]) }),
      expect.objectContaining({ id: "merchant_1", idempotencyKey: "merchant-route-order-boundary" })
    );
  });

  it("conceals an unrelated driver availability through the service boundary", async () => {
    const target = app();
    target.driver.getOwner.mockRejectedValueOnce(new HttpError(404, "availability_not_found"));
    await request(target.server).get("/api/v1/driver/availabilities/other_driver").set(auth("driver_1")).expect(404);
  });
});

describe("M7C1 route and future matching helpers", () => {
  const route: EligibleOperationalRoute = {
    id: "version_1", versionNumber: 1, nameAr: "مسار", nameEn: "Route", direction: "outbound",
    route: { id: "route_1", routeKey: "route-1" },
    stops: [
      { stopId: "a", sequence: 1, passengerPickup: true, passengerDropoff: false, parcelPickup: true, parcelDropoff: false, stop: { id: "a", stopKey: "a", nameAr: "أ", nameEn: "A", latitude: {} as never, longitude: {} as never } },
      { stopId: "b", sequence: 2, passengerPickup: true, passengerDropoff: true, parcelPickup: false, parcelDropoff: true, stop: { id: "b", stopKey: "b", nameAr: "ب", nameEn: "B", latitude: {} as never, longitude: {} as never } },
      { stopId: "c", sequence: 3, passengerPickup: false, passengerDropoff: true, parcelPickup: false, parcelDropoff: true, stop: { id: "c", stopKey: "c", nameAr: "ج", nameEn: "C", latitude: {} as never, longitude: {} as never } }
    ]
  };

  it("enforces permissions and downstream stop order", () => {
    expect(requirePassengerStopPair(route, "a", "c").dropoff.sequence).toBe(3);
    expect(() => requirePassengerStopPair(route, "c", "a")).toThrow(/stop_permission_denied|invalid_stop_order/);
    expect(requireMerchantStops(route, "a", ["b", "c"]).destinations).toHaveLength(2);
    expect(() => requireMerchantStops(route, "b", ["c"])).toThrow(/stop_permission_denied/);
  });
});
