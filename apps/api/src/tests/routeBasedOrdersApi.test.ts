import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../generated/prisma/client.js";

/**
 * Route-based orders (docs/routes/route-based-orders.md): the public route
 * list, every write naming a route, same-route matching and the admin routes.
 */

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  $queryRawUnsafe: vi.fn(),
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn(), findFirst: vi.fn() },
  auditEvent: { create: vi.fn() },
  idempotencyRecord: { create: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  serviceRoute: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  serviceRouteVersion: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  routeVersionStop: { createMany: vi.fn() },
  stop: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  passengerRequest: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn(), groupBy: vi.fn() },
  merchantOrder: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), groupBy: vi.fn() },
  parcel: { count: vi.fn(), updateMany: vi.fn() },
  parcelBatch: { create: vi.fn() },
  driverProfile: { findUnique: vi.fn() },
  driverRoute: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  match: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  deliveryHandover: { findUnique: vi.fn(), create: vi.fn() },
  routeFare: { findMany: vi.fn() }
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../lib/abuseCounters.js", () => ({
  consumeAbuseCounter: vi.fn(async () => ({ allowed: true, count: 1, remaining: 9, retryAfterSeconds: 0 }))
}));

const { createApp } = await import("../app.js");
const { createConfig } = await import("../config.js");
const { CITY, findOperatingRoute, operatingRouteRow, routeSummary } = await import("./operatingRouteFixture.js");

const secret = "test-only-jwt-secret-with-at-least-thirty-two-characters";
type Role = "passenger" | "driver" | "merchant" | "admin";
function auth(id: string, role: Role) {
  const token = jwt.sign({ role, sid: `session_${role}_${id}`, ver: 1 }, secret, { subject: id, expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

const HEBRON_BETHLEHEM = operatingRouteRow();
const RAMALLAH_NABLUS = operatingRouteRow({ origin: CITY.ramallah, destination: CITY.nablus });
const PAUSED = operatingRouteRow({ origin: CITY.bethlehem, destination: CITY.hebron, versionStatus: "paused" });
const ROUTES = [HEBRON_BETHLEHEM, RAMALLAH_NABLUS, PAUSED];

const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString();

/** Driver routes as `rankDriverRoutes` reads them, one per route. */
function supply(id: string, route: typeof HEBRON_BETHLEHEM) {
  return {
    id,
    origin_label: route.current_version.origin_stop.name_en,
    destination_label: route.current_version.destination_stop.name_en,
    origin_lat: route.current_version.origin_stop.latitude,
    origin_lng: route.current_version.origin_stop.longitude,
    corridor_key: route.route_key,
    seats_available: 3,
    parcel_capacity_available: 5,
    departure_at: null,
    departed_at: null,
    availability_window_end: null,
    status: "active",
    route_version: routeSummary(route),
    driver: { id: `profile_${id}`, user_id: `driver_${id}`, verified: true, trust_score: 80, vehicle_type: "sedan", user: { name: `Driver ${id}` } }
  };
}
const SUPPLY = [supply("hb_driver", HEBRON_BETHLEHEM), supply("rn_driver", RAMALLAH_NABLUS)];

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
    const [, role, id] = where.id.split("_");
    return {
      id: where.id, user_id: id, security_version_at_issue: 1, expires_at: new Date(Date.now() + 60_000), revoked_at: null,
      user: { email_verified_at: new Date(), id, role, account_status: "active", security_version: 1 }
    };
  });
  prismaMock.authSession.update.mockResolvedValue({});
  prismaMock.auditEvent.create.mockResolvedValue({});
  prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
  prismaMock.serviceRoute.findUnique.mockImplementation(findOperatingRoute(ROUTES));
  prismaMock.deliveryHandover.findUnique.mockResolvedValue(null);
  prismaMock.deliveryHandover.create.mockResolvedValue({});
  // No route has a fare unless a test publishes one.
  prismaMock.routeFare.findMany.mockResolvedValue([]);
  // Matching filters its supply by the demand's service route.
  prismaMock.driverRoute.findMany.mockImplementation(async ({ where }: any) =>
    SUPPLY.filter((route) => {
      const serviceRouteId = where.route_version?.is?.service_route_id;
      return serviceRouteId ? route.route_version.service_route_id === serviceRouteId : route.corridor_key === where.corridor_key;
    })
  );
});

describe("GET /operating-routes", () => {
  it("is public and lists only active two-city routes in the contract shape", async () => {
    prismaMock.serviceRoute.findMany.mockResolvedValue([
      RAMALLAH_NABLUS,
      HEBRON_BETHLEHEM,
      operatingRouteRow({ id: "demo_corridor", origin: CITY.hebron, destination: CITY.nablus, stops: 3 })
    ]);
    const response = await request(createApp()).get("/api/v1/operating-routes").expect(200);
    expect(response.body.routes).toEqual([
      {
        id: HEBRON_BETHLEHEM.id,
        route_key: "hebron-to-bethlehem",
        name_ar: "الخليل ← بيت لحم",
        name_en: "Hebron → Bethlehem",
        origin: { id: "stop_hebron", name_ar: "الخليل", name_en: "Hebron", latitude: 31.5326, longitude: 35.0998 },
        destination: { id: "stop_bethlehem", name_ar: "بيت لحم", name_en: "Bethlehem", latitude: 31.7054, longitude: 35.2024 },
        // No tariff published for this route yet.
        fares: null
      },
      expect.objectContaining({ id: RAMALLAH_NABLUS.id, route_key: "ramallah-to-nablus" })
    ]);
    expect(prismaMock.serviceRoute.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "active", current_version: { is: { status: "published" } } }
    }));
  });
});

describe("passenger trips on a route", () => {
  beforeEach(() => {
    prismaMock.passengerRequest.create.mockImplementation(async ({ data }: any) => ({
      id: "request_1", created_at: new Date(), status: "pending", ...data,
      route_version: data.route_version_id === RAMALLAH_NABLUS.current_version.id ? routeSummary(RAMALLAH_NABLUS) : routeSummary(HEBRON_BETHLEHEM)
    }));
  });

  const routeBody = () => ({
    service_route_id: HEBRON_BETHLEHEM.id,
    pickup_details: "  near the PPU main gate ",
    dropoff_details: "Bethlehem bus station",
    preferred_time: inOneHour(),
    passenger_count: 1
  });

  it("creates a legacy request on the route with the cities and the passenger's own text", async () => {
    const response = await request(createApp()).post("/api/v1/passenger/requests").set(auth("p1", "passenger")).send(routeBody()).expect(201);
    expect(prismaMock.passengerRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        pickup_label: "Hebron", pickup_lat: "31.532600", pickup_lng: "35.099800",
        destination_label: "Bethlehem", destination_lat: "31.705400", destination_lng: "35.202400",
        route_version_id: HEBRON_BETHLEHEM.current_version.id,
        pickup_details: "near the PPU main gate",
        dropoff_details: "Bethlehem bus station",
        source: "manual"
      })
    }));
    // Requests stay legacy so the legacy matcher serves them.
    const data = prismaMock.passengerRequest.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("canonical_entry_version");
    expect(data).not.toHaveProperty("operational_mode");
    expect(response.body.request).toMatchObject({
      service_route_id: HEBRON_BETHLEHEM.id,
      route_name_ar: "الخليل ← بيت لحم",
      route_name_en: "Hebron → Bethlehem",
      pickup_details: "near the PPU main gate",
      dropoff_details: "Bethlehem bus station"
    });
  });

  it("maps the old coordinate body to Hebron → Bethlehem", async () => {
    const response = await request(createApp()).post("/api/v1/passenger/requests").set(auth("p1", "passenger")).send({
      pickup_label: "PPU", pickup_lat: 31.55, pickup_lng: 35.1,
      destination_label: "Bethlehem Center", destination_lat: 31.7054, destination_lng: 35.2024,
      preferred_time: inOneHour(), passenger_count: 1
    }).expect(201);
    expect(prismaMock.passengerRequest.create.mock.calls[0][0].data).toMatchObject({
      pickup_label: "PPU", route_version_id: HEBRON_BETHLEHEM.current_version.id
    });
    expect(response.body.request).toMatchObject({ service_route_id: HEBRON_BETHLEHEM.id, pickup_details: null, dropoff_details: null });
  });

  it.each([
    ["a pickup shorter than 3 characters", { pickup_details: "  ab  " }],
    ["a drop-off longer than 300 characters", { dropoff_details: "x".repeat(301) }],
    ["a missing drop-off", { dropoff_details: undefined }],
    ["control characters", { pickup_details: "gate\u0000 1" }]
  ])("rejects %s", async (_label, change) => {
    const response = await request(createApp()).post("/api/v1/passenger/requests").set(auth("p1", "passenger"))
      .send({ ...routeBody(), ...change }).expect(400);
    expect(response.body.error).toBe("validation_error");
    expect(prismaMock.passengerRequest.create).not.toHaveBeenCalled();
  });

  it.each([["unknown", "no_such_route"], ["turned-off", PAUSED.id]])("answers 409 route_unavailable for an %s route", async (_label, id) => {
    const response = await request(createApp()).post("/api/v1/passenger/requests").set(auth("p1", "passenger"))
      .send({ ...routeBody(), service_route_id: id }).expect(409);
    expect(response.body.error).toBe("route_unavailable");
    expect(prismaMock.passengerRequest.create).not.toHaveBeenCalled();
  });

  it("refuses a picked driver route that drives another route", async () => {
    prismaMock.driverRoute.findFirst.mockImplementation(async ({ where }: any) =>
      SUPPLY.find((route) => route.id === where.id && route.route_version.service_route_id === where.route_version?.is?.service_route_id) ?? null
    );
    const response = await request(createApp()).post("/api/v1/passenger/requests").set(auth("p1", "passenger"))
      .send({ ...routeBody(), selected_driver_route_id: "rn_driver" }).expect(409);
    expect(response.body.error).toBe("selected_driver_route_unavailable");
    expect(prismaMock.passengerRequest.create).not.toHaveBeenCalled();
    await request(createApp()).post("/api/v1/passenger/requests").set(auth("p1", "passenger"))
      .send({ ...routeBody(), selected_driver_route_id: "hb_driver" }).expect(201);
  });

  it("serializes the route and the details on reads", async () => {
    prismaMock.passengerRequest.findFirst.mockResolvedValue({
      id: "request_1", passenger_id: "p1", status: "pending", pickup_details: "gate", dropoff_details: "station",
      route_version: routeSummary(HEBRON_BETHLEHEM)
    });
    const response = await request(createApp()).get("/api/v1/passenger/requests/request_1").set(auth("p1", "passenger")).expect(200);
    expect(response.body.request).toMatchObject({ service_route_id: HEBRON_BETHLEHEM.id, route_name_en: "Hebron → Bethlehem", pickup_details: "gate", dropoff_details: "station" });
    expect(prismaMock.passengerRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({ include: { route_version: expect.anything() } }));
  });
});

describe("matching by service route", () => {
  it("searches only driver routes on the same route", async () => {
    const response = await request(createApp()).post("/api/v1/matches/search").set(auth("p1", "passenger"))
      .send({ service_route_id: RAMALLAH_NABLUS.id, preferred_time: inOneHour(), passenger_count: 1 }).expect(200);
    expect(response.body.results.map((result: { id: string }) => result.id)).toEqual(["rn_driver"]);
    expect(response.body.results[0]).toMatchObject({ service_route_id: RAMALLAH_NABLUS.id, route_name_en: "Ramallah → Nablus" });
    const where = prismaMock.driverRoute.findMany.mock.calls[0][0].where;
    expect(where.route_version).toEqual({ is: { service_route_id: RAMALLAH_NABLUS.id } });
    expect(where).not.toHaveProperty("corridor_key");
  });

  it("shows each driver's price in the search results: their own, else the route default", async () => {
    const tariffRow = { service_route_id: RAMALLAH_NABLUS.id, currency: "ILS", effective_from: new Date("2026-01-01T00:00:00Z"), created_at: new Date("2026-01-01T00:00:00Z") };
    prismaMock.routeFare.findMany.mockResolvedValue([
      { ...tariffRow, id: "fare_seat", item: "passenger_seat", amount_minor: 2000, min_minor: 1500, max_minor: 2500 }
    ]);
    const priced = { ...SUPPLY[1]!, id: "rn_priced", seat_price_minor: 2400 };
    prismaMock.driverRoute.findMany.mockResolvedValue([SUPPLY[1], priced]);
    const response = await request(createApp()).post("/api/v1/matches/search").set(auth("p1", "passenger"))
      .send({ service_route_id: RAMALLAH_NABLUS.id, preferred_time: inOneHour(), passenger_count: 2 }).expect(200);
    const byId = Object.fromEntries(response.body.results.map((result: { id: string; fare: unknown }) => [result.id, result.fare]));
    expect(byId.rn_driver).toMatchObject({ unit_minor: 2000, total_minor: 4000, currency: "ILS" });
    expect(byId.rn_priced).toMatchObject({ unit_minor: 2400, total_minor: 4800 });
  });

  it("no longer limits coordinate searches to a Bethlehem destination", async () => {
    const response = await request(createApp()).post("/api/v1/matches/search").set(auth("p1", "passenger")).send({
      pickup_label: "Hebron", pickup_lat: 31.53, pickup_lng: 35.1,
      destination_label: "Somewhere else", destination_lat: 32.2, destination_lng: 35.25,
      preferred_time: inOneHour(), passenger_count: 1
    }).expect(200);
    expect(response.body.results.map((result: { id: string }) => result.id)).toEqual(["hb_driver"]);
  });

  it("answers 409 route_unavailable when searching a turned-off route", async () => {
    const response = await request(createApp()).post("/api/v1/matches/search").set(auth("p1", "passenger"))
      .send({ service_route_id: PAUSED.id, preferred_time: inOneHour(), passenger_count: 1 }).expect(409);
    expect(response.body.error).toBe("route_unavailable");
  });

  describe("POST /matches/run", () => {
    beforeEach(() => {
      prismaMock.passengerRequest.findUnique.mockResolvedValue({
        id: "request_1", passenger_id: "p1", status: "pending", passenger_count: 1,
        pickup_lat: "31.532600", pickup_lng: "35.099800", preferred_time: new Date(Date.now() + 3_600_000),
        canonical_entry_version: null, selected_driver_route_id: null,
        route_version: { service_route_id: HEBRON_BETHLEHEM.id }
      });
      prismaMock.match.findMany.mockResolvedValue([]);
      prismaMock.match.findFirst.mockResolvedValue(null);
      prismaMock.passengerRequest.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.driverRoute.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => parts.join("?").includes("UTC_TIMESTAMP")
        ? [{ now: new Date() }]
        : [{ id: "hb_driver", status: "active", verified: true, role: "driver", account_status: "active", departure_at: null, departed_at: null, availability_window_end: null, preferred_time: new Date(Date.now() + 3_600_000), match_expires_at: null }]);
      prismaMock.match.create.mockImplementation(async ({ data }: any) => ({
        id: "match_1", ...data,
        driver_route: { ...SUPPLY[0], driver: SUPPLY[0]!.driver },
        passenger_request: { id: "request_1", passenger_id: "p1", pickup_details: "gate", dropoff_details: "station", route_version: routeSummary(HEBRON_BETHLEHEM) },
        merchant_order: null,
        parcel_batch: null
      }));
    });

    it("never matches a driver route on another route", async () => {
      const response = await request(createApp()).post("/api/v1/matches/run").set(auth("p1", "passenger"))
        .send({ passengerRequestId: "request_1", driverRouteId: "rn_driver" }).expect(409);
      expect(response.body.error).toBe("selected_driver_route_unavailable");
      expect(prismaMock.match.create).not.toHaveBeenCalled();
    });

    it("offers the best driver on the same route and embeds the route and details", async () => {
      const response = await request(createApp()).post("/api/v1/matches/run").set(auth("p1", "passenger"))
        .send({ passengerRequestId: "request_1" }).expect(201);
      expect(prismaMock.match.create.mock.calls[0][0].data).toMatchObject({ driver_route_id: "hb_driver" });
      // Legacy matches never carry a route version; the canonical shape check forbids it.
      expect(prismaMock.match.create.mock.calls[0][0].data).not.toHaveProperty("route_version_id");
      expect(response.body.candidatesConsidered).toBe(1);
      expect(response.body.match.passenger_request).toMatchObject({
        service_route_id: HEBRON_BETHLEHEM.id, route_name_ar: "الخليل ← بيت لحم", pickup_details: "gate", dropoff_details: "station"
      });
      expect(response.body.match.explanation).toContain("Hebron → Bethlehem");
    });

    it("saves the request at the offered driver's own price and returns it", async () => {
      const tariffRow = { service_route_id: HEBRON_BETHLEHEM.id, currency: "ILS", effective_from: new Date("2026-01-01T00:00:00Z"), created_at: new Date("2026-01-01T00:00:00Z") };
      prismaMock.routeFare.findMany.mockResolvedValue([
        { ...tariffRow, id: "fare_seat", item: "passenger_seat", amount_minor: 1500, min_minor: 1200, max_minor: 2000 }
      ]);
      prismaMock.driverRoute.findUnique.mockResolvedValue({
        seat_price_minor: 1300, parcel_s_price_minor: null, parcel_m_price_minor: null, parcel_l_price_minor: null,
        route_version: { service_route_id: HEBRON_BETHLEHEM.id }
      });
      const saved = {
        id: "request_1", passenger_id: "p1", pickup_details: "gate", dropoff_details: "station",
        fare_id: "fare_seat", fare_unit_minor: 1300, fare_total_minor: 1300, fare_currency: "ILS", route_version: routeSummary(HEBRON_BETHLEHEM)
      };
      prismaMock.passengerRequest.findUniqueOrThrow.mockResolvedValue(saved);
      const response = await request(createApp()).post("/api/v1/matches/run").set(auth("p1", "passenger"))
        .send({ passengerRequestId: "request_1" }).expect(201);
      expect(prismaMock.passengerRequest.update).toHaveBeenCalledWith({
        where: { id: "request_1" },
        data: { fare_id: "fare_seat", fare_unit_minor: 1300, fare_total_minor: 1300, fare_currency: "ILS" }
      });
      expect(response.body.match.passenger_request.fare).toMatchObject({ currency: "ILS", unit_minor: 1300, total_minor: 1300 });
    });

    it("keeps requests from before routes on the locked corridor", async () => {
      prismaMock.passengerRequest.findUnique.mockResolvedValue({
        id: "request_old", passenger_id: "p1", status: "pending", passenger_count: 1,
        pickup_lat: "31.55", pickup_lng: "35.1", preferred_time: new Date(Date.now() + 3_600_000),
        canonical_entry_version: null, selected_driver_route_id: null, route_version: null
      });
      await request(createApp()).post("/api/v1/matches/run").set(auth("p1", "passenger")).send({ passengerRequestId: "request_old" }).expect(404);
      expect(prismaMock.driverRoute.findMany.mock.calls[0][0].where).toMatchObject({ corridor_key: "hebron-ppu-bab-al-zawiya-to-bethlehem" });
    });
  });
});

describe("merchant orders on a route", () => {
  beforeEach(() => {
    prismaMock.merchantOrder.create.mockImplementation(async ({ data }: any) => ({
      id: "order_1", status: "submitted", created_at: new Date(), merchant_id: data.merchant_id,
      pickup_label: data.pickup_label, pickup_details: data.pickup_details ?? null, route_version_id: data.route_version_id,
      route_version: routeSummary(HEBRON_BETHLEHEM),
      parcels: data.parcels.create.map((parcel: Record<string, unknown>, index: number) => ({ id: `parcel_${index}`, order_id: "order_1", ...parcel }))
    }));
  });

  it("creates the order and its parcels on the route, with the receiver phone in E.164", async () => {
    const response = await request(createApp()).post("/api/v1/merchant/orders").set(auth("m1", "merchant")).send({
      service_route_id: HEBRON_BETHLEHEM.id,
      pickup_details: "store, Ein Sarah street",
      parcels: [
        { dropoff_details: "Manger Street 12", size: "small", priority: "high", receiver_name: "Sami", receiver_phone: "0591234567" },
        { dropoff_details: "Beit Jala junction", size: "M" }
      ]
    }).expect(201);
    const data = prismaMock.merchantOrder.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      merchant_id: "m1", pickup_label: "Hebron", pickup_lat: "31.532600", pickup_details: "store, Ein Sarah street",
      route_version_id: HEBRON_BETHLEHEM.current_version.id, status: "submitted"
    });
    expect(data.parcels.create).toEqual([
      expect.objectContaining({ destination_label: "Bethlehem", dropoff_details: "Manger Street 12", size: "S", priority: "high", receiver_name: "Sami", receiver_phone: "+970591234567", route_version_id: HEBRON_BETHLEHEM.current_version.id }),
      expect.objectContaining({ dropoff_details: "Beit Jala junction", size: "M", priority: "normal", receiver_name: null, receiver_phone: null })
    ]);
    expect(response.body.order).toMatchObject({
      service_route_id: HEBRON_BETHLEHEM.id, route_name_en: "Hebron → Bethlehem", pickup_details: "store, Ein Sarah street"
    });
    expect(response.body.order.parcels[0]).toMatchObject({ dropoff_details: "Manger Street 12", receiver_name: "Sami" });
    expect(JSON.stringify(response.body)).not.toContain("+970591234567");
    expect(response.body.order.handover.code).toMatch(/^\d{6}$/);
  });

  it("answers 409 route_unavailable and 400 for a bad receiver phone", async () => {
    const base = { service_route_id: PAUSED.id, pickup_details: "store", parcels: [{ dropoff_details: "street", size: "S" }] };
    expect((await request(createApp()).post("/api/v1/merchant/orders").set(auth("m1", "merchant")).send(base).expect(409)).body.error).toBe("route_unavailable");
    const phone = await request(createApp()).post("/api/v1/merchant/orders").set(auth("m1", "merchant"))
      .send({ ...base, service_route_id: HEBRON_BETHLEHEM.id, parcels: [{ dropoff_details: "street", size: "S", receiver_phone: "12" }] });
    expect(phone.status).toBe(400);
    expect(prismaMock.merchantOrder.create).not.toHaveBeenCalled();
  });

  it("batches only orders on the same service route", async () => {
    const order = {
      id: "order_1", merchant_id: "m1", status: "submitted", canonical_entry_version: null,
      pickup_lat: "31.532600", pickup_lng: "35.099800",
      route_version: { service_route_id: HEBRON_BETHLEHEM.id, name_en: "Hebron → Bethlehem" },
      parcels: [{ id: "parcel_1", destination_lat: "31.705400", destination_lng: "35.202400", size: "S" }],
      parcel_batches: [], batch_members: []
    };
    prismaMock.merchantOrder.findUnique.mockResolvedValue(order);
    prismaMock.merchantOrder.findMany.mockResolvedValue([]);
    prismaMock.merchantOrder.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.parcelBatch.create.mockImplementation(async ({ data }: any) => ({ id: "batch_1", ...data }));
    prismaMock.parcel.updateMany.mockResolvedValue({ count: 1 });
    const response = await request(createApp()).post("/api/v1/merchant/orders/order_1/batch").set(auth("m1", "merchant")).expect(201);
    expect(prismaMock.merchantOrder.findMany.mock.calls[0][0].where).toMatchObject({
      merchant_id: "m1", route_version: { is: { service_route_id: HEBRON_BETHLEHEM.id } }
    });
    expect(response.body.batch.explanation).toContain("Hebron → Bethlehem route");
  });

  describe("bulk CSV by route", () => {
    const csv = [
      "route_key,pickup_details,dropoff_details,size,priority,receiver_name,receiver_phone",
      "hebron-to-bethlehem,Main store,Manger Street,S,high,Sami,0591234567",
      "hebron-to-bethlehem,Main store,Beit Jala,medium,,,",
      "hebron-to-bethlehem,Second store,University gate,L,low,,",
      "ramallah-to-nablus,Main store,Rafidia,S,normal,,",
      "no-such-route,Main store,Somewhere,S,normal,,"
    ].join("\n");

    it("previews one order per route and pickup, and flags unavailable routes", async () => {
      const response = await request(createApp()).post("/api/v1/merchant/orders/bulk/preview").set(auth("m1", "merchant")).send({ csv }).expect(200);
      expect(response.body.orders).toEqual([
        expect.objectContaining({ rows: [2, 3], route_key: "hebron-to-bethlehem", pickup_details: "Main store", parcel_count: 2, service_route_id: HEBRON_BETHLEHEM.id }),
        expect.objectContaining({ rows: [4], route_key: "hebron-to-bethlehem", pickup_details: "Second store", parcel_count: 1 }),
        expect.objectContaining({ rows: [5], route_key: "ramallah-to-nablus", parcel_count: 1 })
      ]);
      expect(response.body.errors).toEqual([expect.objectContaining({ row: 6, field: "route_key", code: "route_unavailable" })]);
    });

    it("creates each order through the shared creation path on its route", async () => {
      prismaMock.idempotencyRecord.create.mockImplementation(async ({ data }: any) => ({ id: `record_${data.idempotency_key}`, state: "processing", claim_version: 1, ...data }));
      prismaMock.idempotencyRecord.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.idempotencyRecord.findUniqueOrThrow.mockResolvedValue({ id: "record", state: "completed" });
      const response = await request(createApp()).post("/api/v1/merchant/orders/bulk").set(auth("m1", "merchant"))
        .set("Idempotency-Key", "bulk-upload-0001").send({ csv, skip_invalid: true }).expect(201);
      expect(response.body.summary).toMatchObject({ created: 3, failed: 1 });
      const creates = prismaMock.merchantOrder.create.mock.calls.map(([args]) => args.data);
      expect(creates.map((data) => [data.route_version_id, data.pickup_details, data.parcels.create.length])).toEqual([
        [HEBRON_BETHLEHEM.current_version.id, "Main store", 2],
        [HEBRON_BETHLEHEM.current_version.id, "Second store", 1],
        [RAMALLAH_NABLUS.current_version.id, "Main store", 1]
      ]);
      expect(creates[0].parcels.create[0]).toMatchObject({ dropoff_details: "Manger Street", receiver_phone: "+970591234567", size: "S", priority: "high" });
    });

    it("reports bad details and phones per row in English and Arabic", async () => {
      const bad = ["route_key,pickup_details,dropoff_details,size,receiver_phone", "hebron-to-bethlehem,ab,Manger Street,S,", "hebron-to-bethlehem,Main store,Manger Street,S,12"].join("\n");
      const response = await request(createApp()).post("/api/v1/merchant/orders/bulk/preview").set(auth("m1", "merchant")).send({ csv: bad }).expect(200);
      expect(response.body.errors).toEqual([
        expect.objectContaining({ row: 2, field: "pickup_details", code: "row_invalid_length", message_ar: expect.any(String) }),
        expect.objectContaining({ row: 3, field: "receiver_phone", code: "row_invalid_phone" })
      ]);
    });
  });
});

describe("fares on route orders", () => {
  const hourAgo = () => new Date(Date.now() - 3_600_000);
  /** Tariff rows for Hebron → Bethlehem only, as `routeFare.findMany` returns them. */
  const HB_FARES = () => [
    { id: "fare_seat", service_route_id: HEBRON_BETHLEHEM.id, item: "passenger_seat", amount_minor: 1250, currency: "ILS", effective_from: hourAgo(), created_at: hourAgo() },
    { id: "fare_s", service_route_id: HEBRON_BETHLEHEM.id, item: "parcel_s", amount_minor: 800, currency: "ILS", effective_from: hourAgo(), created_at: hourAgo() },
    { id: "fare_m", service_route_id: HEBRON_BETHLEHEM.id, item: "parcel_m", amount_minor: 1500, currency: "ILS", effective_from: hourAgo(), created_at: hourAgo() }
  ];

  beforeEach(() => {
    prismaMock.routeFare.findMany.mockImplementation(async ({ where }: any) =>
      HB_FARES().filter((row) => where.service_route_id.in.includes(row.service_route_id)));
    prismaMock.passengerRequest.create.mockImplementation(async ({ data }: any) => ({
      id: "request_1", created_at: new Date(), status: "pending", ...data, route_version: routeSummary(HEBRON_BETHLEHEM)
    }));
    prismaMock.merchantOrder.create.mockImplementation(async ({ data }: any) => ({
      id: "order_1", status: "submitted", created_at: new Date(), ...data, route_version: routeSummary(HEBRON_BETHLEHEM),
      parcels: data.parcels.create.map((parcel: Record<string, unknown>, index: number) => ({ id: `parcel_${index}`, order_id: "order_1", ...parcel }))
    }));
  });

  const passengerBody = (serviceRouteId: string, passengers = 2) => ({
    service_route_id: serviceRouteId, pickup_details: "PPU main gate", dropoff_details: "Bethlehem bus station",
    preferred_time: inOneHour(), passenger_count: passengers
  });

  it("freezes the seat fare times the party size on a passenger request and returns it", async () => {
    const response = await request(createApp()).post("/api/v1/passenger/requests").set(auth("p1", "passenger"))
      .send(passengerBody(HEBRON_BETHLEHEM.id, 3)).expect(201);
    expect(prismaMock.routeFare.findMany.mock.calls[0][0].where.service_route_id).toEqual({ in: [HEBRON_BETHLEHEM.id] });
    expect(prismaMock.passengerRequest.create.mock.calls[0][0].data).toMatchObject({
      fare_id: "fare_seat", fare_unit_minor: 1250, fare_total_minor: 3750, fare_currency: "ILS"
    });
    expect(response.body.request.fare).toEqual({
      currency: "ILS", unit_minor: 1250, total_minor: 3750, estimated: true, paid_directly_to_driver: true
    });
  });

  it("still creates a passenger request on a route without a fare, with a null fare", async () => {
    const response = await request(createApp()).post("/api/v1/passenger/requests").set(auth("p1", "passenger"))
      .send(passengerBody(RAMALLAH_NABLUS.id)).expect(201);
    expect(prismaMock.passengerRequest.create.mock.calls[0][0].data).toMatchObject({
      fare_id: null, fare_unit_minor: null, fare_total_minor: null, fare_currency: null
    });
    expect(response.body.request.fare).toBeNull();
  });

  it("returns the frozen fare on passenger request reads", async () => {
    prismaMock.passengerRequest.findFirst.mockResolvedValue({
      id: "request_1", passenger_id: "p1", status: "pending", passenger_count: 2, route_version: routeSummary(HEBRON_BETHLEHEM),
      fare_id: "fare_seat", fare_unit_minor: 1250, fare_total_minor: 2500, fare_currency: "ILS"
    });
    const response = await request(createApp()).get("/api/v1/passenger/requests/request_1").set(auth("p1", "passenger")).expect(200);
    expect(response.body.request.fare).toMatchObject({ currency: "ILS", unit_minor: 1250, total_minor: 2500 });
  });

  it("freezes each parcel's size fare on a merchant order and returns the parcel and order fares", async () => {
    const response = await request(createApp()).post("/api/v1/merchant/orders").set(auth("m1", "merchant")).send({
      service_route_id: HEBRON_BETHLEHEM.id,
      pickup_details: "store, Ein Sarah street",
      parcels: [{ dropoff_details: "Manger Street 12", size: "S" }, { dropoff_details: "Beit Jala junction", size: "M" }]
    }).expect(201);
    expect(prismaMock.merchantOrder.create.mock.calls[0][0].data.parcels.create).toEqual([
      expect.objectContaining({ size: "S", fare_id: "fare_s", fare_minor: 800, fare_currency: "ILS" }),
      expect.objectContaining({ size: "M", fare_id: "fare_m", fare_minor: 1500, fare_currency: "ILS" })
    ]);
    expect(response.body.order.parcels.map((parcel: { fare: { total_minor: number } }) => parcel.fare.total_minor)).toEqual([800, 1500]);
    expect(response.body.order.fare).toEqual({
      currency: "ILS", unit_minor: null, total_minor: 2300, estimated: true, paid_directly_to_driver: true
    });
  });

  it("leaves a size without a fare null and gives no misleading order total", async () => {
    const response = await request(createApp()).post("/api/v1/merchant/orders").set(auth("m1", "merchant")).send({
      service_route_id: HEBRON_BETHLEHEM.id,
      pickup_details: "store",
      parcels: [{ dropoff_details: "Manger Street 12", size: "S" }, { dropoff_details: "Beit Jala junction", size: "L" }]
    }).expect(201);
    expect(prismaMock.merchantOrder.create.mock.calls[0][0].data.parcels.create[1]).toMatchObject({ size: "L", fare_id: null, fare_minor: null, fare_currency: null });
    expect(response.body.order.parcels[0].fare).toMatchObject({ total_minor: 800 });
    expect(response.body.order.parcels[1].fare).toBeNull();
    expect(response.body.order.fare).toBeNull();
  });

  it("still creates a merchant order on a route without a fare, with null fares", async () => {
    const response = await request(createApp()).post("/api/v1/merchant/orders").set(auth("m1", "merchant")).send({
      service_route_id: RAMALLAH_NABLUS.id, pickup_details: "store", parcels: [{ dropoff_details: "Rafidia", size: "S" }]
    }).expect(201);
    expect(prismaMock.merchantOrder.create.mock.calls[0][0].data.parcels.create[0]).toMatchObject({ fare_id: null, fare_minor: null, fare_currency: null });
    expect(response.body.order.fare).toBeNull();
    expect(response.body.order.parcels[0].fare).toBeNull();
  });
});

describe("drivers on a route", () => {
  beforeEach(() => {
    prismaMock.driverProfile.findUnique.mockResolvedValue({ id: "profile_1", user_id: "d1" });
    prismaMock.$queryRaw.mockResolvedValue([{ id: "profile_1" }]);
    prismaMock.driverRoute.findFirst.mockResolvedValue(null);
    prismaMock.driverRoute.create.mockImplementation(async ({ data }: any) => ({
      id: "route_1", status: "active", ...data, route_version: routeSummary(RAMALLAH_NABLUS)
    }));
  });

  it("creates the driver route on the chosen route and serializes it", async () => {
    const response = await request(createApp()).post("/api/v1/driver/routes").set(auth("d1", "driver"))
      .send({ service_route_id: RAMALLAH_NABLUS.id, seats_available: 3, parcel_capacity_available: 4 }).expect(201);
    expect(prismaMock.driverRoute.create.mock.calls[0][0].data).toMatchObject({
      origin_label: "Ramallah", destination_label: "Nablus", corridor_key: "ramallah-to-nablus",
      route_version_id: RAMALLAH_NABLUS.current_version.id, seats_available: 3, parcel_capacity_available: 4
    });
    expect(response.body.route).toMatchObject({ service_route_id: RAMALLAH_NABLUS.id, route_name_ar: "رام الله ← نابلس", route_name_en: "Ramallah → Nablus" });
  });

  it("puts an older build that names no route on Hebron → Bethlehem", async () => {
    await request(createApp()).post("/api/v1/driver/routes").set(auth("d1", "driver")).send({ seats_available: 2 }).expect(201);
    expect(prismaMock.driverRoute.create.mock.calls[0][0].data).toMatchObject({ corridor_key: "hebron-to-bethlehem", seats_available: 2 });
  });

  it("refuses a turned-off route", async () => {
    const paused = await request(createApp()).post("/api/v1/driver/routes").set(auth("d1", "driver")).send({ service_route_id: PAUSED.id }).expect(409);
    expect(paused.body.error).toBe("route_unavailable");
    expect(prismaMock.driverRoute.create).not.toHaveBeenCalled();
  });

  describe("with the driver's own prices", () => {
    beforeEach(() => {
      const tariffRow = { service_route_id: RAMALLAH_NABLUS.id, currency: "ILS", effective_from: new Date("2026-01-01T00:00:00Z"), created_at: new Date("2026-01-01T00:00:00Z") };
      prismaMock.routeFare.findMany.mockResolvedValue([
        { ...tariffRow, id: "fare_seat", item: "passenger_seat", amount_minor: 2000, min_minor: 1500, max_minor: 2500 },
        { ...tariffRow, id: "fare_l", item: "parcel_l", amount_minor: 1500, min_minor: 1000, max_minor: 2000 }
      ]);
    });

    it("stores prices inside the admin range and returns them", async () => {
      const response = await request(createApp()).post("/api/v1/driver/routes").set(auth("d1", "driver"))
        .send({ service_route_id: RAMALLAH_NABLUS.id, seats_available: 3, parcel_capacity_available: 4, prices: { passenger_seat: 2500, parcel_l: 1000 } })
        .expect(201);
      expect(prismaMock.driverRoute.create.mock.calls[0][0].data).toMatchObject({
        seat_price_minor: 2500, parcel_s_price_minor: null, parcel_m_price_minor: null, parcel_l_price_minor: 1000
      });
      expect(response.body.route.prices).toEqual({ currency: "ILS", passenger_seat_minor: 2500, parcel_minor: { S: null, M: null, L: 1000 } });
    });

    it("refuses a price outside the range with a clear error and opens no route", async () => {
      const response = await request(createApp()).post("/api/v1/driver/routes").set(auth("d1", "driver"))
        .send({ service_route_id: RAMALLAH_NABLUS.id, seats_available: 3, prices: { passenger_seat: 2600 } }).expect(422);
      expect(response.body.error).toBe("driver_price_out_of_range");
      expect(prismaMock.driverRoute.create).not.toHaveBeenCalled();
    });

    it("leaves every price to the route default when none is sent", async () => {
      const response = await request(createApp()).post("/api/v1/driver/routes").set(auth("d1", "driver"))
        .send({ service_route_id: RAMALLAH_NABLUS.id, seats_available: 3 }).expect(201);
      expect(prismaMock.driverRoute.create.mock.calls[0][0].data).toMatchObject({ seat_price_minor: null, parcel_l_price_minor: null });
      expect(response.body.route.prices).toMatchObject({ passenger_seat_minor: null });
    });

    it("passes the prices to the online-state service", async () => {
      const service = { setState: vi.fn().mockResolvedValue({ online: true, routeId: "route_1", replayed: false, changed: true }) };
      const app = createApp(undefined, { legacyDriverOnlineStateService: service as never });
      await request(app).put("/api/v1/driver/online-state").set(auth("d1", "driver")).set("Idempotency-Key", "online-key-0002")
        .send({ online: true, service_route_id: RAMALLAH_NABLUS.id, prices: { passenger_seat: 1800 } }).expect(200);
      expect(service.setState).toHaveBeenCalledWith(
        { online: true, expectedRouteId: undefined, serviceRouteId: RAMALLAH_NABLUS.id, prices: { passenger_seat: 1800 } },
        expect.anything()
      );
      // Not an integer number of agorot: refused before any route is touched.
      await request(app).put("/api/v1/driver/online-state").set(auth("d1", "driver")).set("Idempotency-Key", "online-key-0003")
        .send({ online: true, service_route_id: RAMALLAH_NABLUS.id, prices: { passenger_seat: 18.5 } }).expect(400);
    });
  });

  it("passes the route to the online-state service and rejects unknown fields", async () => {
    const service = { setState: vi.fn().mockResolvedValue({ online: true, routeId: "route_1", replayed: false, changed: true }) };
    const app = createApp(undefined, { legacyDriverOnlineStateService: service as never });
    await request(app).put("/api/v1/driver/online-state").set(auth("d1", "driver")).set("Idempotency-Key", "online-key-0001")
      .send({ online: true, service_route_id: RAMALLAH_NABLUS.id }).expect(200);
    expect(service.setState).toHaveBeenCalledWith(
      { online: true, expectedRouteId: undefined, serviceRouteId: RAMALLAH_NABLUS.id },
      expect.objectContaining({ id: "d1", idempotencyKey: "online-key-0001" })
    );
  });
});

describe("admin operating routes", () => {
  const admin = auth("a1", "admin");

  it("is admin-only and does not need ROUTE_MANAGEMENT_ENABLED", async () => {
    const app = createApp(createConfig({ ...process.env, ROUTE_MANAGEMENT_ENABLED: "false" }));
    await request(app).get("/api/v1/admin/operating-routes").expect(401);
    await request(app).get("/api/v1/admin/operating-routes").set(auth("p1", "passenger")).expect(403);
    await request(app).post("/api/v1/admin/cities").set(auth("m1", "merchant")).send({}).expect(403);
    prismaMock.user.findFirst.mockResolvedValue({ id: "a1" });
    prismaMock.stop.findMany.mockResolvedValue([]);
    prismaMock.serviceRoute.findMany.mockResolvedValue([]);
    await request(app).get("/api/v1/admin/cities").set(admin).expect(200);
  });

  it("lists active and turned-off routes with their order counts", async () => {
    // Everything predefined already exists, so the list creates nothing.
    prismaMock.stop.findMany.mockResolvedValue(
      ["hebron", "bethlehem", "ramallah", "nablus", "jenin", "tulkarm", "qalqilya", "jericho", "salfit", "tubas"].map((slug) => ({ id: slug, stop_key: `city-${slug}`, status: "active" }))
    );
    prismaMock.serviceRoute.findMany.mockImplementation(async ({ where }: any) => where.route_key
      ? where.route_key.in.map((key: string) => ({ id: key, route_key: key, current_version_id: `v_${key}` }))
      : [HEBRON_BETHLEHEM, PAUSED]);
    prismaMock.serviceRouteVersion.findMany.mockResolvedValue([
      { id: HEBRON_BETHLEHEM.current_version.id, service_route_id: HEBRON_BETHLEHEM.id },
      { id: "older_version", service_route_id: HEBRON_BETHLEHEM.id }
    ]);
    prismaMock.passengerRequest.groupBy.mockResolvedValue([{ route_version_id: HEBRON_BETHLEHEM.current_version.id, _count: { _all: 2 } }]);
    prismaMock.merchantOrder.groupBy.mockResolvedValue([{ route_version_id: "older_version", _count: { _all: 3 } }]);

    const response = await request(createApp()).get("/api/v1/admin/operating-routes").set(admin).expect(200);
    expect(response.body.routes).toEqual([
      expect.objectContaining({ id: PAUSED.id, route_key: "bethlehem-to-hebron", active: false, orders_count: 0 }),
      expect.objectContaining({ id: HEBRON_BETHLEHEM.id, active: true, orders_count: 5, origin: expect.objectContaining({ name_en: "Hebron" }) })
    ]);
    expect(prismaMock.serviceRoute.create).not.toHaveBeenCalled();
  });

  describe("creating routes", () => {
    beforeEach(() => {
      const cities: Record<string, object> = {
        [CITY.ramallah.id]: { ...CITY.ramallah, status: "active" },
        [CITY.nablus.id]: { ...CITY.nablus, status: "active" },
        demo_stop: { id: "demo_stop", stop_key: "demo-bethlehem-center", status: "active" }
      };
      prismaMock.stop.findUnique.mockImplementation(async ({ where }: any) => cities[where.id] ?? null);
      prismaMock.serviceRoute.findFirst.mockResolvedValue(null);
      prismaMock.serviceRoute.create.mockImplementation(async ({ data }: any) => ({ id: `new_${data.route_key}`, ...data }));
      prismaMock.serviceRouteVersion.create.mockImplementation(async ({ data }: any) => ({ id: `version_${data.service_route_id}`, ...data }));
      prismaMock.serviceRouteVersion.findMany.mockResolvedValue([]);
    });

    it("creates and publishes both directions with their two city stops", async () => {
      prismaMock.serviceRoute.findUnique.mockResolvedValue(null);
      prismaMock.serviceRoute.findMany.mockResolvedValue([
        operatingRouteRow({ id: "new_nablus-to-ramallah", origin: CITY.nablus, destination: CITY.ramallah }),
        operatingRouteRow({ id: "new_ramallah-to-nablus", origin: CITY.ramallah, destination: CITY.nablus })
      ]);
      const response = await request(createApp()).post("/api/v1/admin/operating-routes").set(admin)
        .send({ origin_city_id: CITY.ramallah.id, destination_city_id: CITY.nablus.id, both_directions: true }).expect(201);
      expect(prismaMock.serviceRoute.create.mock.calls.map(([args]) => [args.data.route_key, args.data.direction])).toEqual([
        ["ramallah-to-nablus", "outbound"],
        ["nablus-to-ramallah", "inbound"]
      ]);
      expect(prismaMock.serviceRouteVersion.create.mock.calls[0][0].data).toMatchObject({
        status: "published", name_ar: "رام الله ← نابلس", name_en: "Ramallah → Nablus",
        origin_stop_id: CITY.ramallah.id, destination_stop_id: CITY.nablus.id, published_by_user_id: "a1"
      });
      expect(prismaMock.routeVersionStop.createMany).toHaveBeenCalledTimes(2);
      expect(response.body.routes).toHaveLength(2);
      expect(response.body.routes[0]).toMatchObject({ active: true, orders_count: 0 });
    });

    it("answers 409 route_exists for a direction that already exists", async () => {
      prismaMock.serviceRoute.findUnique.mockResolvedValue({ id: "existing" });
      const response = await request(createApp()).post("/api/v1/admin/operating-routes").set(admin)
        .send({ origin_city_id: CITY.ramallah.id, destination_city_id: CITY.nablus.id, both_directions: false }).expect(409);
      expect(response.body.error).toBe("route_exists");
      expect(prismaMock.serviceRoute.create).not.toHaveBeenCalled();
    });

    it("maps a concurrent duplicate to route_exists and refuses non-city stops", async () => {
      prismaMock.serviceRoute.findUnique.mockResolvedValue(null);
      prismaMock.serviceRoute.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }));
      await request(createApp()).post("/api/v1/admin/operating-routes").set(admin)
        .send({ origin_city_id: CITY.ramallah.id, destination_city_id: CITY.nablus.id }).expect(409);
      const notCity = await request(createApp()).post("/api/v1/admin/operating-routes").set(admin)
        .send({ origin_city_id: "demo_stop", destination_city_id: CITY.nablus.id }).expect(404);
      expect(notCity.body.error).toBe("city_not_found");
    });
  });

  it("turns a route off and back on through its current version", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: HEBRON_BETHLEHEM.id, status: "active", current_version_id: HEBRON_BETHLEHEM.current_version.id }])
      .mockResolvedValueOnce([{ id: HEBRON_BETHLEHEM.current_version.id, status: "published" }]);
    prismaMock.serviceRoute.findUnique.mockResolvedValue(operatingRouteRow({ versionStatus: "paused" }));
    prismaMock.serviceRouteVersion.findMany.mockResolvedValue([]);
    const off = await request(createApp()).patch(`/api/v1/admin/operating-routes/${HEBRON_BETHLEHEM.id}`).set(admin).send({ active: false }).expect(200);
    expect(prismaMock.serviceRouteVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: HEBRON_BETHLEHEM.current_version.id },
      data: expect.objectContaining({ status: "paused", paused_by_user_id: "a1" })
    }));
    expect(off.body.route).toMatchObject({ id: HEBRON_BETHLEHEM.id, active: false });

    vi.clearAllMocks();
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => ({
      id: where.id, user_id: "a1", security_version_at_issue: 1, expires_at: new Date(Date.now() + 60_000), revoked_at: null,
      user: { email_verified_at: new Date(), id: "a1", role: "admin", account_status: "active", security_version: 1 }
    }));
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: HEBRON_BETHLEHEM.id, status: "active", current_version_id: HEBRON_BETHLEHEM.current_version.id }])
      .mockResolvedValueOnce([{ id: HEBRON_BETHLEHEM.current_version.id, status: "paused" }]);
    prismaMock.serviceRoute.findUnique.mockResolvedValue(HEBRON_BETHLEHEM);
    prismaMock.serviceRouteVersion.findMany.mockResolvedValue([]);
    const on = await request(createApp()).patch(`/api/v1/admin/operating-routes/${HEBRON_BETHLEHEM.id}`).set(admin).send({ active: true }).expect(200);
    expect(prismaMock.serviceRouteVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "published", paused_at: null, paused_by_user_id: null, pause_reason: null }
    }));
    expect(on.body.route.active).toBe(true);
  });

  describe("cities", () => {
    it("lists the city stops", async () => {
      prismaMock.stop.findMany.mockResolvedValue([{ ...CITY.bethlehem }, { ...CITY.hebron }]);
      const response = await request(createApp()).get("/api/v1/admin/cities").set(admin).expect(200);
      expect(response.body.cities).toEqual([
        { id: "stop_bethlehem", name_ar: "بيت لحم", name_en: "Bethlehem", latitude: 31.7054, longitude: 35.2024 },
        { id: "stop_hebron", name_ar: "الخليل", name_en: "Hebron", latitude: 31.5326, longitude: 35.0998 }
      ]);
      expect(prismaMock.stop.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { stop_key: { startsWith: "city-" }, status: "active" } }));
    });

    it("adds a city inside the service area and refuses one outside it", async () => {
      prismaMock.stop.findFirst.mockResolvedValue(null);
      prismaMock.stop.create.mockImplementation(async ({ data }: any) => ({ id: "stop_new", ...data }));
      const created = await request(createApp()).post("/api/v1/admin/cities").set(admin)
        .send({ name_ar: "بيت جالا", name_en: "Beit Jala", latitude: 31.7149, longitude: 35.1874 }).expect(201);
      expect(created.body.city).toEqual({ id: "stop_new", name_ar: "بيت جالا", name_en: "Beit Jala", latitude: 31.7149, longitude: 35.1874 });
      expect(prismaMock.stop.create.mock.calls[0][0].data).toMatchObject({ stop_key: "city-beit-jala", service_region_key: "west-bank", created_by_user_id: "a1" });

      const outside = await request(createApp()).post("/api/v1/admin/cities").set(admin)
        .send({ name_ar: "عمان", name_en: "Amman", latitude: 31.95, longitude: 35.93 + 0.1 }).expect(400);
      expect(outside.body.error).toBe("city_outside_service_area");
      prismaMock.stop.findFirst.mockResolvedValue({ id: "stop_new" });
      const duplicate = await request(createApp()).post("/api/v1/admin/cities").set(admin)
        .send({ name_ar: "بيت جالا", name_en: "Beit Jala", latitude: 31.7149, longitude: 35.1874 }).expect(409);
      expect(duplicate.body.error).toBe("city_exists");
    });
  });
});
