import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({ prisma: {} }));

const fares = await import("../services/routeFares.js");
const { createLegacyDriverOnlineStateService } = await import("../services/legacyDriverOnlineState.js");
const { findOperatingRoute, HEBRON_TO_BETHLEHEM } = await import("./operatingRouteFixture.js");

const ROUTE = HEBRON_TO_BETHLEHEM.id;
const AT = new Date("2026-11-03T10:00:00.000Z");

/** Tariff rows as `routeFare.findMany` returns them for Hebron → Bethlehem. */
function tariff() {
  const base = { service_route_id: ROUTE, currency: "ILS", effective_from: new Date("2026-11-01T00:00:00Z"), created_at: new Date("2026-11-01T00:00:00Z") };
  return [
    // Seat: default 15.00, drivers may charge 12.00 to 20.00.
    { ...base, id: "fare_seat", item: "passenger_seat", amount_minor: 1500, min_minor: 1200, max_minor: 2000 },
    // Small parcel: default 8.00, drivers may charge 6.00 to 10.00.
    { ...base, id: "fare_s", item: "parcel_s", amount_minor: 800, min_minor: 600, max_minor: 1000 },
    // Medium parcel: fixed at 12.00 (no range).
    { ...base, id: "fare_m", item: "parcel_m", amount_minor: 1200, min_minor: null, max_minor: null }
    // Large parcel: no fare published.
  ];
}

function tariffSet() {
  return fares.resolveEffectiveFares(tariff() as never, AT).get(ROUTE);
}

describe("driver prices inside the admin range", () => {
  it("accepts prices within the range and stores them per item", () => {
    expect(fares.validateDriverPrices(tariffSet(), { passenger_seat: 1200, parcel_s: 1000 })).toEqual({
      seat_price_minor: 1200,
      parcel_s_price_minor: 1000,
      parcel_m_price_minor: null,
      parcel_l_price_minor: null
    });
  });

  it.each([
    ["below the minimum", { passenger_seat: 1199 }],
    ["above the maximum", { passenger_seat: 2001 }],
    ["a parcel above its maximum", { parcel_s: 1001 }]
  ])("refuses a price %s", (_name, prices) => {
    expect(() => fares.validateDriverPrices(tariffSet(), prices)).toThrow(
      expect.objectContaining({ statusCode: 422, message: "driver_price_out_of_range" })
    );
  });

  it("refuses a price for an item whose default is fixed or not published, but allows the fixed default itself", () => {
    expect(() => fares.validateDriverPrices(tariffSet(), { parcel_m: 1300 })).toThrow(
      expect.objectContaining({ statusCode: 422, message: "driver_price_fixed" })
    );
    expect(() => fares.validateDriverPrices(tariffSet(), { parcel_l: 900 })).toThrow(
      expect.objectContaining({ statusCode: 422, message: "driver_price_fixed" })
    );
    expect(fares.validateDriverPrices(tariffSet(), { parcel_m: 1200 }).parcel_m_price_minor).toBe(1200);
  });

  it("charges the route default when the driver set no price", () => {
    const set = tariffSet();
    expect(fares.driverFareFor(set, {}, "passenger_seat")).toEqual({ fareId: "fare_seat", unitMinor: 1500, currency: "ILS", source: "route_default" });
    expect(fares.driverFareFor(set, { seat_price_minor: null }, "passenger_seat")?.unitMinor).toBe(1500);
    expect(fares.driverFareFor(set, { seat_price_minor: 1800 }, "passenger_seat")).toEqual({ fareId: "fare_seat", unitMinor: 1800, currency: "ILS", source: "driver" });
    expect(fares.driverFareFor(set, {}, "parcel_l")).toBeNull();
    expect(fares.driverFareView(set, { seat_price_minor: 1800 })).toMatchObject({
      passenger_seat_minor: 1800,
      parcel_minor: { S: 800, M: 1200, L: null }
    });
  });
});

describe("going online with prices", () => {
  function onlineDb() {
    const db: any = {
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
      $queryRaw: vi.fn(async (parts: TemplateStringsArray) =>
        parts.join("?").includes("FROM driver_profiles") ? [{ id: "profile_1", verified: true, seats_total: 4, parcel_capacity: 6 }] : []),
      idempotencyRecord: {
        create: vi.fn(async ({ data }: any) => ({ id: "record_1", state: "processing", claim_version: 1, ...data })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "record_1" })
      },
      serviceRoute: { findUnique: vi.fn(findOperatingRoute()) },
      routeFare: { findMany: vi.fn(async () => tariff()) },
      driverRoute: { create: vi.fn(async ({ data }: any) => ({ id: "route_new", ...data })) },
      auditEvent: { create: vi.fn() }
    };
    return db;
  }
  const actor = { id: "driver_1", idempotencyKey: "online-key-0001" };

  it("stores prices inside the range on the driver route", async () => {
    const db = onlineDb();
    await createLegacyDriverOnlineStateService(db).setState(
      { online: true, serviceRouteId: ROUTE, prices: { passenger_seat: 1800, parcel_s: 700 } },
      actor
    );
    expect(db.driverRoute.create.mock.calls[0][0].data).toMatchObject({
      seat_price_minor: 1800,
      parcel_s_price_minor: 700,
      parcel_m_price_minor: null,
      parcel_l_price_minor: null
    });
  });

  it("refuses a price outside the range and opens no route", async () => {
    const db = onlineDb();
    await expect(
      createLegacyDriverOnlineStateService(db).setState({ online: true, serviceRouteId: ROUTE, prices: { passenger_seat: 2500 } }, actor)
    ).rejects.toMatchObject({ statusCode: 422, message: "driver_price_out_of_range" });
    expect(db.driverRoute.create).not.toHaveBeenCalled();
  });

  it("uses the route defaults when the driver sets no price, without reading the tariff", async () => {
    const db = onlineDb();
    await createLegacyDriverOnlineStateService(db).setState({ online: true, serviceRouteId: ROUTE }, actor);
    expect(db.driverRoute.create.mock.calls[0][0].data).toMatchObject({
      seat_price_minor: null,
      parcel_s_price_minor: null,
      parcel_m_price_minor: null,
      parcel_l_price_minor: null
    });
    expect(db.routeFare.findMany).not.toHaveBeenCalled();
  });
});

describe("the order's saved fare follows the driver who is offered and takes it", () => {
  function pricingTx(input: { driverPrices?: Record<string, number | null>; request?: Record<string, unknown> | null; parcels?: Array<Record<string, unknown>> }) {
    const tx: any = {
      driverRoute: {
        findUnique: vi.fn(async () => ({
          seat_price_minor: null,
          parcel_s_price_minor: null,
          parcel_m_price_minor: null,
          parcel_l_price_minor: null,
          ...input.driverPrices,
          route_version: { service_route_id: ROUTE }
        }))
      },
      routeFare: { findMany: vi.fn(async () => tariff()) },
      passengerRequest: { findUnique: vi.fn(async () => input.request ?? null), update: vi.fn() },
      parcel: { findMany: vi.fn(async () => input.parcels ?? []), update: vi.fn() },
      auditEvent: { create: vi.fn() }
    };
    return tx;
  }
  const request = (over: Record<string, unknown> = {}) => ({
    id: "request_1",
    passenger_count: 2,
    // Saved at booking from the route default.
    fare_id: "fare_seat",
    fare_unit_minor: 1500,
    fare_total_minor: 3000,
    fare_currency: "ILS",
    route_version: { service_route_id: ROUTE },
    ...over
  });

  it("sets the passenger request to the driver's own seat price and records the change", async () => {
    const tx = pricingTx({ driverPrices: { seat_price_minor: 1800 }, request: request() });
    const result = await fares.routeFareService.applyDriverFare(tx, {
      driverRouteId: "driver_route_1",
      passengerRequestId: "request_1",
      matchId: "match_1",
      stage: "accepted",
      actorId: "driver_1",
      at: AT
    });
    expect(result.passengerChanged).toBe(true);
    expect(tx.passengerRequest.update).toHaveBeenCalledWith({
      where: { id: "request_1" },
      data: { fare_id: "fare_seat", fare_unit_minor: 1800, fare_total_minor: 3600, fare_currency: "ILS" }
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: "driver_1",
        entity_type: "PassengerRequest",
        entity_id: "request_1",
        metadata: expect.objectContaining({
          event: "fare_set_to_driver_price",
          stage: "accepted",
          match_id: "match_1",
          changes: [expect.objectContaining({ source: "driver", before: expect.objectContaining({ unit_minor: 1500 }), after: expect.objectContaining({ unit_minor: 1800, total_minor: 3600 }) })]
        })
      })
    });
  });

  it("keeps the route default when the driver set no price, writing nothing", async () => {
    const tx = pricingTx({ request: request() });
    const result = await fares.routeFareService.applyDriverFare(tx, {
      driverRouteId: "driver_route_1",
      passengerRequestId: "request_1",
      matchId: "match_1",
      stage: "offered",
      actorId: "passenger_1",
      at: AT
    });
    expect(result.passengerChanged).toBe(false);
    expect(tx.passengerRequest.update).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it("prices each parcel at the driver's price for its size, else the default", async () => {
    const parcel = (id: string, size: string) => ({
      id, order_id: "order_1", size, fare_id: null, fare_minor: null, fare_currency: null, route_version: { service_route_id: ROUTE }
    });
    const tx = pricingTx({ driverPrices: { parcel_s_price_minor: 950 }, parcels: [parcel("p_s", "S"), parcel("p_m", "M"), parcel("p_l", "L")] });
    const result = await fares.routeFareService.applyDriverFare(tx, {
      driverRouteId: "driver_route_1",
      merchantOrderIds: ["order_1"],
      matchId: "match_1",
      stage: "accepted",
      actorId: "driver_1",
      at: AT
    });
    expect(result.parcelsChanged).toBe(2);
    expect(tx.parcel.update).toHaveBeenCalledWith({ where: { id: "p_s" }, data: { fare_id: "fare_s", fare_minor: 950, fare_currency: "ILS" } });
    expect(tx.parcel.update).toHaveBeenCalledWith({ where: { id: "p_m" }, data: { fare_id: "fare_m", fare_minor: 1200, fare_currency: "ILS" } });
    // No large-parcel fare: that parcel keeps what it has rather than an invented price.
    expect(tx.parcel.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p_l" } }));
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it("never reprices demand on another route or a driver route without one", async () => {
    const other = pricingTx({ driverPrices: { seat_price_minor: 1800 }, request: request({ route_version: { service_route_id: "other_route" } }) });
    await fares.routeFareService.applyDriverFare(other, {
      driverRouteId: "driver_route_1", passengerRequestId: "request_1", matchId: "m", stage: "accepted", actorId: "d", at: AT
    });
    expect(other.passengerRequest.update).not.toHaveBeenCalled();
    const corridor = pricingTx({ request: request() });
    corridor.driverRoute.findUnique.mockResolvedValue({ seat_price_minor: 1800, route_version: null });
    await fares.routeFareService.applyDriverFare(corridor, {
      driverRouteId: "driver_route_1", passengerRequestId: "request_1", matchId: "m", stage: "accepted", actorId: "d", at: AT
    });
    expect(corridor.routeFare.findMany).not.toHaveBeenCalled();
    expect(corridor.passengerRequest.update).not.toHaveBeenCalled();
  });
});
