import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * City places (docs/routes/city-places.md): the per-route pickup / drop-off
 * lists, order validation against the route's own cities, and the audited
 * admin endpoints.
 */

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  $queryRawUnsafe: vi.fn(),
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn(), findFirst: vi.fn() },
  auditEvent: { create: vi.fn() },
  idempotencyRecord: { create: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  serviceRoute: { findUnique: vi.fn(), findMany: vi.fn() },
  stop: { findMany: vi.fn(), findUnique: vi.fn() },
  cityPlace: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
  passengerRequest: { create: vi.fn() },
  merchantOrder: { create: vi.fn() },
  deliveryHandover: { findUnique: vi.fn(), create: vi.fn() },
  routeFare: { findMany: vi.fn() }
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../lib/abuseCounters.js", () => ({
  consumeAbuseCounter: vi.fn(async () => ({ allowed: true, count: 1, remaining: 9, retryAfterSeconds: 0 }))
}));

const { createApp } = await import("../app.js");
const { CITY, findOperatingRoute, operatingRouteRow, routeSummary } = await import("./operatingRouteFixture.js");

const secret = "test-only-jwt-secret-with-at-least-thirty-two-characters";
type Role = "passenger" | "merchant" | "admin";
function auth(id: string, role: Role) {
  const token = jwt.sign({ role, sid: `session_${role}_${id}`, ver: 1 }, secret, { subject: id, expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

const HEBRON_RAMALLAH = operatingRouteRow({ origin: CITY.hebron, destination: CITY.ramallah });
const RAMALLAH_HEBRON = operatingRouteRow({ origin: CITY.ramallah, destination: CITY.hebron });
const PAUSED = operatingRouteRow({ origin: CITY.bethlehem, destination: CITY.hebron, versionStatus: "paused" });
const ROUTES = [HEBRON_RAMALLAH, RAMALLAH_HEBRON, PAUSED];

function place(id: string, cityKey: string, nameAr: string, nameEn: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    city_key: cityKey,
    name_ar: nameAr,
    name_en: nameEn,
    latitude: "31.600000",
    longitude: "35.100000",
    approximate: true,
    source: "OpenStreetMap place node/1",
    active: true,
    sort_order: 1,
    created_at: new Date("2026-11-01T00:00:00Z"),
    updated_at: new Date("2026-11-01T00:00:00Z"),
    ...extra
  };
}
const HEBRON_CENTRE = place("cp_hebron_00", "city-hebron", "وسط الخليل", "Hebron city centre", { sort_order: 0, latitude: "31.532600", longitude: "35.099800" });
const HALHUL = place("cp_hebron_11", "city-hebron", "حلحول", "Halhul", { latitude: "31.577547", longitude: "35.099316" });
const YATTA = place("cp_hebron_01", "city-hebron", "يطا", "Yatta", { sort_order: 2 });
const RAMALLAH_CENTRE = place("cp_ramallah_00", "city-ramallah", "وسط رام الله", "Ramallah city centre", { sort_order: 0, latitude: "31.903800", longitude: "35.203400" });
const BIRZEIT = place("cp_ramallah_14", "city-ramallah", "بيرزيت", "Bir Zeit", { latitude: "31.9619", longitude: "35.1975" });
const OFF = place("cp_ramallah_99", "city-ramallah", "موقع معطل", "Disabled", { active: false });
const PLACES = [HEBRON_CENTRE, HALHUL, YATTA, RAMALLAH_CENTRE, BIRZEIT, OFF];

const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString();

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
  prismaMock.cityPlace.findMany.mockImplementation(async ({ where }: any) =>
    PLACES.filter((row) => row.city_key === where.city_key && (where.active === undefined || row.active === where.active))
  );
  prismaMock.cityPlace.findUnique.mockImplementation(async ({ where }: any) => PLACES.find((row) => row.id === where.id) ?? null);
  prismaMock.routeFare.findMany.mockResolvedValue([]);
  prismaMock.deliveryHandover.findUnique.mockResolvedValue(null);
  prismaMock.deliveryHandover.create.mockResolvedValue({});
});

describe("GET /operating-routes/:id/places", () => {
  it("is public and lists the origin city for pickup and the destination city for drop-off, active only", async () => {
    const response = await request(createApp()).get(`/api/v1/operating-routes/${HEBRON_RAMALLAH.id}/places`).expect(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=300");
    expect(response.body.route_id).toBe(HEBRON_RAMALLAH.id);
    expect(response.body.pickup_city_key).toBe("city-hebron");
    expect(response.body.dropoff_city_key).toBe("city-ramallah");
    expect(response.body.pickup_places.map((row: any) => row.id)).toEqual(["cp_hebron_00", "cp_hebron_11", "cp_hebron_01"]);
    // Disabled places are never offered.
    expect(response.body.dropoff_places.map((row: any) => row.id)).toEqual(["cp_ramallah_00", "cp_ramallah_14"]);
    expect(response.body.pickup_places[1]).toEqual({
      id: "cp_hebron_11", name: "حلحول", name_ar: "حلحول", name_en: "Halhul", latitude: 31.577547, longitude: 35.099316, approximate: true
    });
  });

  it("swaps the lists for the reverse route", async () => {
    const response = await request(createApp()).get(`/api/v1/operating-routes/${RAMALLAH_HEBRON.id}/places`).expect(200);
    expect(response.body.pickup_places.map((row: any) => row.id)).toEqual(["cp_ramallah_00", "cp_ramallah_14"]);
    expect(response.body.dropoff_places.map((row: any) => row.id)).toEqual(["cp_hebron_00", "cp_hebron_11", "cp_hebron_01"]);
  });

  it("returns the name in the requested language", async () => {
    const response = await request(createApp()).get(`/api/v1/operating-routes/${HEBRON_RAMALLAH.id}/places?lang=en`).expect(200);
    expect(response.body.pickup_places[1].name).toBe("Halhul");
  });

  it.each([["unknown", "nope"], ["turned-off", PAUSED.id]])("answers 409 route_unavailable for an %s route", async (_label, id) => {
    const response = await request(createApp()).get(`/api/v1/operating-routes/${id}/places`).expect(409);
    expect(response.body.error).toBe("route_unavailable");
  });
});

describe("passenger requests with places", () => {
  beforeEach(() => {
    prismaMock.passengerRequest.create.mockImplementation(async ({ data }: any) => ({
      id: "request_1", created_at: new Date(), status: "pending", ...data, route_version: routeSummary(HEBRON_RAMALLAH)
    }));
  });
  const body = (change: Record<string, unknown> = {}) => ({
    service_route_id: HEBRON_RAMALLAH.id,
    pickup_place_id: HALHUL.id,
    dropoff_place_id: BIRZEIT.id,
    preferred_time: inOneHour(),
    passenger_count: 1,
    ...change
  });
  const post = (payload: unknown) => request(createApp()).post("/api/v1/passenger/requests").set(auth("p1", "passenger")).send(payload as object);

  it("stores the chosen places, their coordinates and names, with the details left out", async () => {
    const response = await post(body()).expect(201);
    expect(prismaMock.passengerRequest.create.mock.calls[0][0].data).toMatchObject({
      pickup_label: "Hebron",
      pickup_lat: "31.577547",
      pickup_lng: "35.099316",
      destination_label: "Ramallah",
      destination_lat: "31.961900",
      destination_lng: "35.197500",
      pickup_place_id: "cp_hebron_11",
      pickup_place_name_ar: "حلحول",
      pickup_place_name_en: "Halhul",
      dropoff_place_id: "cp_ramallah_14",
      dropoff_place_name_en: "Bir Zeit",
      pickup_details: null,
      dropoff_details: null
    });
    expect(response.body.request).toMatchObject({
      pickup_place_id: "cp_hebron_11",
      pickup_place_name_ar: "حلحول",
      dropoff_place_name_ar: "بيرزيت",
      pickup_details: null
    });
  });

  it("keeps the optional details next to the place", async () => {
    await post(body({ pickup_details: "  next to the mosque ", dropoff_details: "" })).expect(201);
    expect(prismaMock.passengerRequest.create.mock.calls[0][0].data).toMatchObject({
      pickup_place_id: "cp_hebron_11",
      pickup_details: "next to the mosque",
      dropoff_details: null
    });
  });

  it("rejects a pickup place of the destination city", async () => {
    const response = await post(body({ pickup_place_id: BIRZEIT.id })).expect(400);
    expect(response.body.error).toBe("pickup_place_wrong_city");
    expect(prismaMock.passengerRequest.create).not.toHaveBeenCalled();
  });

  it("rejects a drop-off place of the origin city", async () => {
    const response = await post(body({ dropoff_place_id: YATTA.id })).expect(400);
    expect(response.body.error).toBe("dropoff_place_wrong_city");
    expect(prismaMock.passengerRequest.create).not.toHaveBeenCalled();
  });

  it("checks the cities per direction: the same pair is valid on the reverse route only when swapped", async () => {
    prismaMock.passengerRequest.create.mockImplementation(async ({ data }: any) => ({
      id: "request_1", created_at: new Date(), status: "pending", ...data, route_version: routeSummary(RAMALLAH_HEBRON)
    }));
    const swapped = { service_route_id: RAMALLAH_HEBRON.id, pickup_place_id: BIRZEIT.id, dropoff_place_id: HALHUL.id };
    await post(body(swapped)).expect(201);
    const response = await post(body({ service_route_id: RAMALLAH_HEBRON.id })).expect(400);
    expect(response.body.error).toBe("pickup_place_wrong_city");
  });

  it.each([["an unknown place", "cp_missing"], ["a disabled place", OFF.id]])("rejects %s as a drop-off", async (_label, id) => {
    const response = await post(body({ dropoff_place_id: id })).expect(400);
    expect(response.body.error).toBe("dropoff_place_unavailable");
  });

  it("still accepts free text without places from older app builds", async () => {
    await post({
      service_route_id: HEBRON_RAMALLAH.id, pickup_details: "near the gate", dropoff_details: "Ramallah centre",
      preferred_time: inOneHour(), passenger_count: 1
    }).expect(201);
    expect(prismaMock.passengerRequest.create.mock.calls[0][0].data).toMatchObject({
      pickup_lat: "31.532600", pickup_place_id: null, pickup_details: "near the gate"
    });
  });
});

describe("merchant orders with places", () => {
  beforeEach(() => {
    prismaMock.merchantOrder.create.mockImplementation(async ({ data }: any) => ({
      id: "order_1", status: "submitted", created_at: new Date(), merchant_id: data.merchant_id,
      pickup_label: data.pickup_label, pickup_details: data.pickup_details ?? null, route_version_id: data.route_version_id,
      pickup_place_id: data.pickup_place_id, pickup_place_name_ar: data.pickup_place_name_ar, pickup_place_name_en: data.pickup_place_name_en,
      route_version: routeSummary(HEBRON_RAMALLAH),
      parcels: data.parcels.create.map((parcel: Record<string, unknown>, index: number) => ({ id: `parcel_${index}`, order_id: "order_1", ...parcel }))
    }));
  });
  const post = (payload: unknown) => request(createApp()).post("/api/v1/merchant/orders").set(auth("m1", "merchant")).send(payload as object);

  it("stores the pickup place on the order and a drop-off place per parcel", async () => {
    const response = await post({
      service_route_id: HEBRON_RAMALLAH.id,
      pickup_place_id: HALHUL.id,
      parcels: [{ dropoff_place_id: BIRZEIT.id, size: "S" }, { dropoff_place_id: RAMALLAH_CENTRE.id, dropoff_details: "Clock roundabout", size: "M" }]
    }).expect(201);
    const data = prismaMock.merchantOrder.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ pickup_place_id: "cp_hebron_11", pickup_place_name_en: "Halhul", pickup_lat: "31.577547", pickup_details: null });
    expect(data.parcels.create[0]).toMatchObject({ dropoff_place_id: "cp_ramallah_14", destination_lat: "31.961900", dropoff_details: null });
    expect(data.parcels.create[1]).toMatchObject({ dropoff_place_id: "cp_ramallah_00", dropoff_details: "Clock roundabout" });
    expect(response.body.order).toMatchObject({ pickup_place_id: "cp_hebron_11", pickup_place_name_ar: "حلحول" });
    expect(response.body.order.parcels[0]).toMatchObject({ dropoff_place_id: "cp_ramallah_14", dropoff_place_name_ar: "بيرزيت" });
  });

  it("rejects a parcel whose drop-off place is in the origin city", async () => {
    const response = await post({
      service_route_id: HEBRON_RAMALLAH.id,
      pickup_place_id: HALHUL.id,
      parcels: [{ dropoff_place_id: BIRZEIT.id, size: "S" }, { dropoff_place_id: YATTA.id, size: "S" }]
    }).expect(400);
    expect(response.body.error).toBe("dropoff_place_wrong_city");
    expect(prismaMock.merchantOrder.create).not.toHaveBeenCalled();
  });

  it("rejects a pickup place of the destination city", async () => {
    const response = await post({
      service_route_id: HEBRON_RAMALLAH.id,
      pickup_place_id: BIRZEIT.id,
      parcels: [{ dropoff_place_id: BIRZEIT.id, size: "S" }]
    }).expect(400);
    expect(response.body.error).toBe("pickup_place_wrong_city");
  });
});

describe("admin city places", () => {
  it("is admin only", async () => {
    await request(createApp()).get("/api/v1/admin/city-places").set(auth("p1", "passenger")).expect(403);
    await request(createApp()).get("/api/v1/admin/city-places").expect(401);
  });

  it("lists places (disabled included) with each city's counts", async () => {
    prismaMock.stop.findMany.mockResolvedValue([CITY.hebron, CITY.ramallah]);
    prismaMock.cityPlace.groupBy.mockResolvedValue([
      { city_key: "city-hebron", active: true, _count: { _all: 3 } },
      { city_key: "city-ramallah", active: true, _count: { _all: 2 } },
      { city_key: "city-ramallah", active: false, _count: { _all: 1 } }
    ]);
    prismaMock.cityPlace.findMany.mockResolvedValue([HEBRON_CENTRE, OFF]);
    const response = await request(createApp()).get("/api/v1/admin/city-places?search=h").set(auth("a1", "admin")).expect(200);
    expect(response.body.cities).toEqual([
      { city_key: "city-hebron", name_ar: "الخليل", name_en: "Hebron", places_total: 3, places_active: 3 },
      { city_key: "city-ramallah", name_ar: "رام الله", name_en: "Ramallah", places_total: 3, places_active: 2 }
    ]);
    expect(response.body.places.map((row: any) => row.active)).toEqual([true, false]);
  });

  it("creates a place, marks it admin-verified and audits it", async () => {
    prismaMock.stop.findUnique.mockResolvedValue({ status: "active" });
    prismaMock.cityPlace.aggregate.mockResolvedValue({ _max: { sort_order: 24 } });
    prismaMock.cityPlace.create.mockImplementation(async ({ data }: any) => place("cp_new", data.city_key, data.name_ar, data.name_en, { ...data, sort_order: data.sort_order }));
    const response = await request(createApp()).post("/api/v1/admin/city-places").set(auth("a1", "admin"))
      .send({ city_key: "city-hebron", name_ar: "بيت كاحل", name_en: "Beit Kahel", latitude: 31.5967, longitude: 35.1281 }).expect(201);
    expect(prismaMock.cityPlace.create.mock.calls[0][0].data).toMatchObject({
      city_key: "city-hebron", approximate: false, source: "admin", sort_order: 25, latitude: "31.596700"
    });
    expect(response.body.place).toMatchObject({ id: "cp_new", city_key: "city-hebron", name_ar: "بيت كاحل", source: "admin" });
    expect(prismaMock.auditEvent.create.mock.calls[0][0].data).toMatchObject({
      user_id: "a1", entity_type: "CityPlace", entity_id: "cp_new"
    });
  });

  it("rejects coordinates outside the service area and unknown cities", async () => {
    const valid = { city_key: "city-hebron", name_ar: "بيت كاحل", name_en: "Beit Kahel", latitude: 31.5967, longitude: 35.1281 };
    await request(createApp()).post("/api/v1/admin/city-places").set(auth("a1", "admin")).send({ ...valid, latitude: 48.8 }).expect(400);
    await request(createApp()).post("/api/v1/admin/city-places").set(auth("a1", "admin")).send({ ...valid, city_key: "hebron" }).expect(400);
    prismaMock.stop.findUnique.mockResolvedValue(null);
    const response = await request(createApp()).post("/api/v1/admin/city-places").set(auth("a1", "admin")).send(valid).expect(404);
    expect(response.body.error).toBe("city_not_found");
    expect(prismaMock.cityPlace.create).not.toHaveBeenCalled();
  });

  it("answers 409 city_place_exists for a duplicate name in the city", async () => {
    prismaMock.stop.findUnique.mockResolvedValue({ status: "active" });
    prismaMock.cityPlace.aggregate.mockResolvedValue({ _max: { sort_order: 1 } });
    prismaMock.cityPlace.create.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "P2002" }));
    const response = await request(createApp()).post("/api/v1/admin/city-places").set(auth("a1", "admin"))
      .send({ city_key: "city-hebron", name_ar: "حلحول", name_en: "Halhul", latitude: 31.57, longitude: 35.1 }).expect(409);
    expect(response.body.error).toBe("city_place_exists");
  });

  it("disables a place and audits the change", async () => {
    prismaMock.cityPlace.update.mockImplementation(async ({ data }: any) => ({ ...HALHUL, ...data }));
    const response = await request(createApp()).patch(`/api/v1/admin/city-places/${HALHUL.id}`).set(auth("a1", "admin")).send({ active: false }).expect(200);
    expect(prismaMock.cityPlace.update).toHaveBeenCalledWith({ where: { id: HALHUL.id }, data: { active: false } });
    expect(response.body.place.active).toBe(false);
    expect(prismaMock.auditEvent.create.mock.calls[0][0].data.metadata).toMatchObject({ action: "city_place_disabled", city_key: "city-hebron" });
  });

  it("moving a place makes its position admin-set", async () => {
    prismaMock.cityPlace.update.mockImplementation(async ({ data }: any) => ({ ...HALHUL, ...data }));
    await request(createApp()).patch(`/api/v1/admin/city-places/${HALHUL.id}`).set(auth("a1", "admin")).send({ latitude: 31.58, longitude: 35.1 }).expect(200);
    expect(prismaMock.cityPlace.update.mock.calls[0][0].data).toMatchObject({ latitude: "31.580000", approximate: false, source: "admin" });
  });

  it("answers 404 for an unknown place and 400 for an empty change", async () => {
    await request(createApp()).patch("/api/v1/admin/city-places/nope").set(auth("a1", "admin")).send({ active: true }).expect(404);
    await request(createApp()).patch(`/api/v1/admin/city-places/${HALHUL.id}`).set(auth("a1", "admin")).send({}).expect(400);
  });
});
