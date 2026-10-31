import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";

const idempotency = vi.hoisted(() => ({ claimIdempotency: vi.fn(), completeIdempotency: vi.fn() }));
vi.mock("../lib/idempotency.js", () => idempotency);

const eligibility = vi.hoisted(() => ({
  requireEligibleOperationalRoute: vi.fn(),
  requirePassengerStopPair: vi.fn(),
  requireMerchantStops: vi.fn()
}));
vi.mock("../services/operationalRouteEligibility.js", () => eligibility);

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  routeFare: { findMany: vi.fn(), create: vi.fn() },
  serviceRoute: { findUnique: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn()
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const fares = await import("../services/routeFares.js");
const { createApp } = await import("../app.js");
const { createCanonicalDemandService } = await import("../services/canonicalDemand.js");

const T0 = new Date("2026-10-29T10:00:00.000Z");
const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "fare_1",
  service_route_id: "route_1",
  item: "passenger_seat",
  amount_minor: 1500,
  currency: "ILS",
  effective_from: new Date("2026-10-01T00:00:00Z"),
  created_at: new Date("2026-10-01T00:00:00Z"),
  ...over
});

describe("fare arithmetic and formatting (integer agorot, no rounding drift)", () => {
  it("formats minor units exactly", () => {
    expect(fares.formatMinor(0)).toBe("0.00");
    expect(fares.formatMinor(5)).toBe("0.05");
    expect(fares.formatMinor(1005)).toBe("10.05");
    expect(fares.formatMinor(1250)).toBe("12.50");
    expect(fares.formatMinor(10_000_000)).toBe("100000.00");
    expect(() => fares.formatMinor(12.5)).toThrow();
    expect(() => fares.formatMinor(-1)).toThrow();
  });

  it("multiplies seats in integers so 0.1 style float errors cannot appear", () => {
    expect(fares.seatFareTotal(1010, 3)).toBe(3030); // 10.10 x 3, float math gives 30.299999...
    expect(fares.seatFareTotal(1, 8)).toBe(8);
    expect(() => fares.seatFareTotal(1500, 0)).toThrow();
    expect(() => fares.seatFareTotal(1500.5, 2)).toThrow();
    expect(() => fares.seatFareTotal(10_000_000, 1000)).toThrow();
  });

  it("accepts only positive integer amounts within the cap", () => {
    for (const ok of [1, 1500, 10_000_000]) expect(fares.isValidFareMinor(ok)).toBe(true);
    for (const bad of [0, -5, 1.5, 10_000_001, NaN, "15", null]) expect(fares.isValidFareMinor(bad)).toBe(false);
  });

  it("maps parcel sizes to fare items and rejects unknown sizes", () => {
    expect(fares.parcelFareItem("S")).toBe("parcel_s");
    expect(fares.parcelFareItem("L")).toBe("parcel_l");
    expect(() => fares.parcelFareItem("XL")).toThrow();
    expect(() => fares.parcelFareItem("passenger_seat")).toThrow();
  });
});

describe("tariff versioning (effective-from history)", () => {
  it("uses the newest row already in force and ignores scheduled changes", () => {
    const rows = [
      row({ id: "a", amount_minor: 1000, effective_from: new Date("2026-09-01T00:00:00Z"), created_at: new Date("2026-09-01T00:00:00Z") }),
      row({ id: "b", amount_minor: 1500, effective_from: new Date("2026-10-01T00:00:00Z") }),
      row({ id: "c", amount_minor: 2000, effective_from: new Date("2026-11-01T00:00:00Z") })
    ];
    expect(fares.resolveEffectiveFares(rows as never, T0).get("route_1")?.passenger_seat?.amountMinor).toBe(1500);
    expect(fares.resolveEffectiveFares(rows as never, new Date("2026-11-01T00:00:00Z")).get("route_1")?.passenger_seat?.id).toBe("c");
    expect(fares.resolveEffectiveFares(rows as never, new Date("2026-08-01T00:00:00Z")).size).toBe(0);
  });

  it("breaks effective_from ties by creation time, then id", () => {
    const same = new Date("2026-10-01T00:00:00Z");
    const rows = [
      row({ id: "x", amount_minor: 1100, effective_from: same, created_at: new Date("2026-10-01T00:00:01Z") }),
      row({ id: "y", amount_minor: 1200, effective_from: same, created_at: new Date("2026-10-01T00:00:02Z") })
    ];
    expect(fares.resolveEffectiveFares(rows as never, T0).get("route_1")?.passenger_seat?.amountMinor).toBe(1200);
  });

  it("treats a withdrawal row as no fare, hiding older tariffs, per item", () => {
    const rows = [
      row({ id: "p1", amount_minor: 1500 }),
      row({ id: "p2", amount_minor: null, effective_from: new Date("2026-10-15T00:00:00Z"), created_at: new Date("2026-10-15T00:00:00Z") }),
      row({ id: "s1", item: "parcel_s", amount_minor: 700 })
    ];
    const set = fares.resolveEffectiveFares(rows as never, T0).get("route_1")!;
    expect(set.passenger_seat).toBeNull();
    expect(set.parcel_s?.amountMinor).toBe(700);
    const view = fares.serializeFareSet(set)!;
    expect(view).toMatchObject({
      currency: "ILS",
      estimated: true,
      paid_directly_to_driver: true,
      passenger_seat_minor: null,
      parcel_minor: { S: 700, M: null, L: null }
    });
  });

  it("serializes nothing when no fare is published", () => {
    expect(fares.serializeFareSet(undefined)).toBeNull();
    expect(fares.serializeFareSet(fares.resolveEffectiveFares([], T0).get("route_1"))).toBeNull();
  });
});

describe("setFares (audited, append-only)", () => {
  function makeService(existing: unknown[] = []) {
    const created: Array<Record<string, any>> = [];
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "route_1" }]),
      routeFare: {
        findMany: vi.fn().mockResolvedValue(existing),
        create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
          const made = { id: `new_${created.length + 1}`, ...data };
          created.push(made);
          return made;
        })
      },
      auditEvent: { create: vi.fn() }
    };
    const db = { ...tx, $transaction: vi.fn(async (cb: (client: typeof tx) => unknown) => cb(tx)) };
    return { service: fares.createRouteFareService(db as never), tx, created };
  }
  const actor = { id: "admin_1", requestId: "req_1" };

  it("appends history rows, records the actor and writes an audit event", async () => {
    const { service, tx, created } = makeService([row()]);
    const rows = await service.setFares(
      "route_1",
      [{ item: "passenger_seat", amountMinor: 1750 }, { item: "parcel_m", amountMinor: 900 }],
      { reason: "Fuel price adjustment" },
      actor,
      T0
    );
    expect(rows).toHaveLength(2);
    expect(created[0]).toMatchObject({
      service_route_id: "route_1",
      item: "passenger_seat",
      amount_minor: 1750,
      currency: "ILS",
      created_by_user_id: "admin_1",
      reason: "Fuel price adjustment"
    });
    expect(created[0].effective_from).toEqual(T0);
    // Existing rows are never updated or deleted: history is append-only.
    expect(tx.routeFare).not.toHaveProperty("update");
    expect(tx.routeFare).not.toHaveProperty("delete");
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: "admin_1",
        action: "admin_action",
        entity_type: "ServiceRoute",
        entity_id: "route_1",
        metadata: expect.objectContaining({ event: "route_fares_changed", reason: "Fuel price adjustment" })
      })
    });
  });

  it("skips unchanged items and rejects a save that changes nothing", async () => {
    const { service, created } = makeService([row()]);
    await expect(
      service.setFares("route_1", [{ item: "passenger_seat", amountMinor: 1500 }], { reason: "No change" }, actor, T0)
    ).rejects.toMatchObject({ statusCode: 409, message: "fare_unchanged" });
    expect(created).toHaveLength(0);
    const partial = await service.setFares(
      "route_1",
      [{ item: "passenger_seat", amountMinor: 1500 }, { item: "parcel_l", amountMinor: 1200 }],
      { reason: "Add parcel L" },
      actor,
      T0
    );
    expect(partial).toHaveLength(1);
    expect(created[0].item).toBe("parcel_l");
  });

  it("validates amounts, duplicates and the effective date", async () => {
    const { service } = makeService();
    const set = (entries: Array<{ item: any; amountMinor: number | null }>, effectiveFrom?: Date) =>
      service.setFares("route_1", entries, { reason: "Test reason", effectiveFrom }, actor, T0);
    await expect(set([{ item: "passenger_seat", amountMinor: 0 }])).rejects.toMatchObject({ message: "invalid_fare_amount" });
    await expect(set([{ item: "passenger_seat", amountMinor: 12.5 }])).rejects.toMatchObject({ message: "invalid_fare_amount" });
    await expect(set([{ item: "passenger_seat", amountMinor: 10_000_001 }])).rejects.toMatchObject({ message: "invalid_fare_amount" });
    await expect(
      set([{ item: "parcel_s", amountMinor: 5 }, { item: "parcel_s", amountMinor: 6 }])
    ).rejects.toMatchObject({ message: "duplicate_fare_item" });
    await expect(set([])).rejects.toMatchObject({ message: "no_fare_changes" });
    await expect(set([{ item: "parcel_s", amountMinor: 5 }], new Date(T0.getTime() - 3_600_000))).rejects.toMatchObject({
      message: "fare_effective_from_in_past"
    });
    await expect(set([{ item: "parcel_s", amountMinor: 5 }], new Date("2030-01-01T00:00:00Z"))).rejects.toMatchObject({
      message: "fare_effective_from_too_far"
    });
  });

  it("answers 404 when the route does not exist", async () => {
    const { service, tx } = makeService();
    tx.$queryRaw.mockResolvedValue([]);
    await expect(
      service.setFares("missing", [{ item: "parcel_s", amountMinor: 5 }], { reason: "Test reason" }, actor, T0)
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("snapshotting on creation", () => {
  const actor = { id: "owner_1", idempotencyKey: "snapshot-key" };
  const future = (hours: number) => new Date(Date.now() + hours * 3_600_000);
  const route = {
    id: "version_1",
    route: { id: "route_1", routeKey: "hebron-ramallah" },
    stops: []
  };

  function makeDb(tariff: { current: unknown[] }) {
    const db = {
      $transaction: vi.fn(async (cb: (client: any) => unknown) => cb(db)),
      routeFare: { findMany: vi.fn(async () => tariff.current) },
      passengerRequest: { create: vi.fn(async ({ data }: any) => ({ id: "req_1", ...data })) },
      merchantOrder: {
        create: vi.fn(async ({ data }: any) => ({ id: "ord_1", ...data })),
        findUniqueOrThrow: vi.fn()
      },
      parcel: { createMany: vi.fn() },
      canonicalDemandDispatch: { create: vi.fn() },
      auditEvent: { create: vi.fn() }
    };
    return db;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    idempotency.claimIdempotency.mockResolvedValue({ kind: "claimed", record: { id: "claim_1", claim_version: 1 } });
    eligibility.requireEligibleOperationalRoute.mockResolvedValue(route);
    eligibility.requirePassengerStopPair.mockReturnValue({
      pickup: { stopId: "a", stop: { nameEn: "A", latitude: "1", longitude: "1" } },
      dropoff: { stopId: "b", stop: { nameEn: "B", latitude: "2", longitude: "2" } }
    });
    eligibility.requireMerchantStops.mockReturnValue({
      pickup: { stopId: "a", stop: { nameEn: "A", latitude: "1", longitude: "1" } },
      destinations: [
        { stopId: "b", stop: { nameEn: "B", latitude: "2", longitude: "2" } },
        { stopId: "b", stop: { nameEn: "B", latitude: "2", longitude: "2" } }
      ]
    });
  });

  const passengerInput = () => ({
    routeVersionId: "version_1",
    pickupStopId: "a",
    dropoffStopId: "b",
    requestedDepartureFrom: future(2),
    requestedDepartureUntil: future(3),
    passengerCount: 3
  });

  it("freezes the unit and total seat fare on the passenger request", async () => {
    const db = makeDb({ current: [row({ amount_minor: 1010 })] });
    const service = createCanonicalDemandService(db as never);
    await service.createPassengerRequest(passengerInput(), actor);
    const data = db.passengerRequest.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      fare_id: "fare_1",
      fare_unit_minor: 1010,
      fare_total_minor: 3030,
      fare_currency: "ILS"
    });
    // The snapshot is looked up under the same transaction client, for the canonical route (not the version).
    expect(db.routeFare.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ service_route_id: { in: ["route_1"] } }) })
    );
  });

  it("later tariff edits do not alter an existing record; new requests use the new tariff", async () => {
    const tariff = { current: [row({ id: "old", amount_minor: 1000 })] };
    const db = makeDb(tariff);
    const service = createCanonicalDemandService(db as never);
    const first = (await service.createPassengerRequest(passengerInput(), actor)).resource as Record<string, unknown>;
    tariff.current = [row({ id: "new", amount_minor: 2000, effective_from: new Date("2026-10-02T00:00:00Z") }), row({ id: "old", amount_minor: 1000 })];
    const second = (await service.createPassengerRequest(passengerInput(), actor)).resource as Record<string, unknown>;
    expect(first).toMatchObject({ fare_id: "old", fare_unit_minor: 1000, fare_total_minor: 3000 });
    expect(second).toMatchObject({ fare_id: "new", fare_unit_minor: 2000, fare_total_minor: 6000 });
    expect(first.fare_total_minor).toBe(3000); // the first record object is untouched by the edit
  });

  it("replay returns the stored snapshot without consulting the tariff", async () => {
    const stored = { id: "req_1", fare_id: "old", fare_unit_minor: 1000, fare_total_minor: 3000, fare_currency: "ILS" };
    idempotency.claimIdempotency.mockResolvedValue({ kind: "replay", record: { resource_type: "PassengerRequest", resource_id: "req_1" } });
    const db = makeDb({ current: [row({ amount_minor: 9999 })] });
    (db as any).passengerRequest.findFirst = vi.fn().mockResolvedValue(stored);
    const service = createCanonicalDemandService(db as never);
    const result = await service.createPassengerRequest(passengerInput(), actor);
    expect(result).toEqual({ resource: stored, replayed: true });
    expect(db.routeFare.findMany).not.toHaveBeenCalled();
  });

  it("creates the request with null fare fields when no tariff is published", async () => {
    const db = makeDb({ current: [] });
    await createCanonicalDemandService(db as never).createPassengerRequest(passengerInput(), actor);
    expect(db.passengerRequest.create.mock.calls[0]![0].data).toMatchObject({
      fare_id: null,
      fare_unit_minor: null,
      fare_total_minor: null,
      fare_currency: null
    });
  });

  it("snapshots a per-size fare on each parcel", async () => {
    const db = makeDb({
      current: [
        row({ id: "ps", item: "parcel_s", amount_minor: 500 }),
        row({ id: "pl", item: "parcel_l", amount_minor: 1250 })
      ]
    });
    db.merchantOrder.findUniqueOrThrow.mockResolvedValue({ id: "ord_1", parcels: [] });
    await createCanonicalDemandService(db as never).createMerchantOrder(
      {
        routeVersionId: "version_1",
        pickupStopId: "a",
        requestedDepartureFrom: future(2),
        requestedDepartureUntil: future(3),
        parcels: [
          { destinationStopId: "b", size: "S", priority: "normal" },
          { destinationStopId: "b", size: "M", priority: "normal" }
        ]
      },
      actor
    );
    const parcels = db.parcel.createMany.mock.calls[0]![0].data;
    expect(parcels[0]).toMatchObject({ size: "S", fare_id: "ps", fare_minor: 500, fare_currency: "ILS" });
    // No M tariff: the parcel is created with no fare rather than guessing.
    expect(parcels[1]).toMatchObject({ size: "M", fare_id: null, fare_minor: null, fare_currency: null });
  });

  it("builds order totals only when every parcel has a frozen fare", () => {
    expect(fares.orderFareResponse([{ fare_minor: 500, fare_currency: "ILS" }, { fare_minor: 1250, fare_currency: "ILS" }])).toMatchObject({
      total_minor: 1750,
      currency: "ILS",
      estimated: true,
      paid_directly_to_driver: true
    });
    expect(fares.orderFareResponse([{ fare_minor: 500, fare_currency: "ILS" }, { fare_minor: null, fare_currency: null }])).toBeNull();
    expect(fares.orderFareResponse([])).toBeNull();
    expect(fares.passengerFareResponse({ fare_unit_minor: null, fare_total_minor: null, fare_currency: null })).toBeNull();
  });
});

describe("admin fare API permissions and validation", () => {
  const secret = "test-only-jwt-secret-with-at-least-thirty-two-characters";
  const env = {
    APP_ENV: "local",
    DATABASE_URL: "mysql://test:test@localhost:3306/masari_test",
    JWT_SECRET: secret,
    CORS_ORIGINS: "http://localhost:5173",
    LOG_LEVEL: "silent",
    ROUTE_MANAGEMENT_ENABLED: "true"
  };
  const users: Record<string, { id: string; role: string }> = {
    admin_1: { id: "admin_1", role: "admin" },
    driver_1: { id: "driver_1", role: "driver" },
    passenger_1: { id: "passenger_1", role: "passenger" },
    merchant_1: { id: "merchant_1", role: "merchant" }
  };
  const auth = (id: string) => ({
    Authorization: `Bearer ${jwt.sign({ role: users[id].role, sid: `session_${id}`, ver: 1 }, secret, { subject: id, expiresIn: "1h" })}`
  });
  const put = (config: ReturnType<typeof createConfig>, headers: Record<string, string>, body: unknown) =>
    request(createApp(config)).put("/api/v1/admin/service-routes/route_1/fares").set(headers).send(body as object);
  const validBody = { changes: [{ item: "passenger_seat", amount_minor: 1500 }], reason: "Initial tariff" };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      const user = where.id ? users[where.id] : undefined;
      return user ? { ...user, name: "N", phone: "+1", demo_account: true, account_status: "active", security_version: 1 } : null;
    });
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const user = users[where.id.replace(/^session_/, "")];
      return user
        ? {
            id: where.id,
            user_id: user.id,
            user: { email_verified_at: new Date(), ...user, name: "N", phone: "+1", demo_account: true, account_status: "active", security_version: 1 },
            security_version_at_issue: 1,
            expires_at: new Date(Date.now() + 60_000),
            revoked_at: null
          }
        : null;
    });
    prismaMock.routeFare.findMany.mockResolvedValue([]);
    prismaMock.serviceRoute.findUnique.mockResolvedValue({ id: "route_1" });
    prismaMock.$queryRaw.mockResolvedValue([{ id: "route_1" }]);
    prismaMock.routeFare.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "fare_new", ...data }));
    prismaMock.$transaction.mockImplementation(async (cb: (client: typeof prismaMock) => unknown) => cb(prismaMock));
  });

  const config = createConfig(env);

  it("rejects anonymous callers", async () => {
    expect((await put(config, {}, validBody)).status).toBe(401);
    expect((await request(createApp(config)).get("/api/v1/admin/service-routes/route_1/fares")).status).toBe(401);
  });

  it.each(["driver_1", "passenger_1", "merchant_1"])("forbids %s from reading or changing fares", async (id) => {
    expect((await put(config, auth(id), validBody)).status).toBe(403);
    expect((await request(createApp(config)).get("/api/v1/admin/service-routes/route_1/fares").set(auth(id))).status).toBe(403);
    expect(prismaMock.routeFare.create).not.toHaveBeenCalled();
  });

  it("lets an admin set a fare and returns the audited history", async () => {
    prismaMock.routeFare.findMany.mockResolvedValue([]);
    const response = await put(config, auth("admin_1"), validBody);
    expect(response.status).toBe(200);
    expect(prismaMock.routeFare.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ item: "passenger_seat", amount_minor: 1500, created_by_user_id: "admin_1", currency: "ILS" })
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalled();
    expect(response.body).toMatchObject({ route_id: "route_1", currency: "ILS", display_only: true });
  });

  it.each([
    ["decimal amount", { changes: [{ item: "passenger_seat", amount_minor: 12.5 }], reason: "Reason" }],
    ["zero amount", { changes: [{ item: "passenger_seat", amount_minor: 0 }], reason: "Reason" }],
    ["string amount", { changes: [{ item: "passenger_seat", amount_minor: "1500" }], reason: "Reason" }],
    ["unknown item", { changes: [{ item: "parcel_xl", amount_minor: 500 }], reason: "Reason" }],
    ["missing reason", { changes: [{ item: "parcel_s", amount_minor: 500 }] }],
    ["extra field", { changes: [{ item: "parcel_s", amount_minor: 500 }], reason: "Reason", currency: "USD" }],
    ["empty changes", { changes: [], reason: "Reason" }]
  ])("rejects an invalid request: %s", async (_name, body) => {
    const response = await put(config, auth("admin_1"), body);
    expect(response.status).toBe(400);
    expect(prismaMock.routeFare.create).not.toHaveBeenCalled();
  });

  it("is not exposed when route management is disabled", async () => {
    const disabled = createConfig({ ...env, ROUTE_MANAGEMENT_ENABLED: "false" });
    expect((await put(disabled, auth("admin_1"), validBody)).status).toBe(404);
  });
});

describe("fare exposure in responses", () => {
  it("shows the frozen snapshot on request, order and parcel responses", async () => {
    const { canonicalDemandSerializers } = await import("../modules/canonicalDemand.js");
    const { canonicalMatchingSerializers } = await import("../modules/canonicalMatching.js");
    const passenger = canonicalDemandSerializers.passengerResponse({
      id: "r1", fare_unit_minor: 1010, fare_total_minor: 3030, fare_currency: "ILS"
    });
    expect(passenger.fare).toEqual({
      currency: "ILS", unit_minor: 1010, total_minor: 3030, estimated: true, paid_directly_to_driver: true
    });
    const order = canonicalDemandSerializers.merchantResponse({
      id: "o1",
      parcels: [{ id: "p1", size: "S", fare_minor: 500, fare_currency: "ILS" }, { id: "p2", size: "L", fare_minor: 1250, fare_currency: "ILS" }]
    });
    expect(order.fare?.total_minor).toBe(1750);
    expect(order.parcels[1]!.fare?.total_minor).toBe(1250);
    expect(canonicalDemandSerializers.passengerResponse({ id: "r2" }).fare).toBeNull();
    const status = canonicalMatchingSerializers.statusResponse({
      id: "r1", passenger_count: 3, fare_unit_minor: 1010, fare_total_minor: 3030, fare_currency: "ILS"
    });
    expect(status.fare).toMatchObject({ total_minor: 3030 });
  });
});
