import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../generated/prisma/client.js";

vi.mock("../lib/prisma.js", () => ({ prisma: {} }));
const {
  ensurePredefinedRoutes,
  listActiveOperatingRoutes,
  PREDEFINED_CITIES,
  resolveOperatingRoute,
  serializeOperatingRoute
} = await import("../services/operatingRoutes.js");
const { CITY, findOperatingRoute, operatingRouteRow } = await import("./operatingRouteFixture.js");
const { createLegacyDriverOnlineStateService } = await import("../services/legacyDriverOnlineState.js");

type Row = Record<string, any>;

/** An in-memory catalogue with just the calls ensurePredefinedRoutes makes. */
function fakeCatalogue(options: { admin?: boolean; stops?: Row[]; routes?: Row[] } = {}) {
  let next = 0;
  const stops: Row[] = [...(options.stops ?? [])];
  const routes: Row[] = [...(options.routes ?? [])];
  const versions: Row[] = [];
  const memberships: Row[] = [];
  const db: any = {
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
    user: { findFirst: vi.fn(async () => (options.admin === false ? null : { id: "admin_1" })) },
    stop: {
      findMany: vi.fn(async ({ where }: any) => stops.filter((stop) => where.stop_key.in.includes(stop.stop_key))),
      findUnique: vi.fn(async ({ where }: any) => stops.find((stop) => stop.stop_key === where.stop_key) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const stop = { id: `stop_${++next}`, status: "active", ...data };
        stops.push(stop);
        return stop;
      }),
      update: vi.fn()
    },
    serviceRoute: {
      findMany: vi.fn(async ({ where }: any) => routes.filter((route) => where.route_key.in.includes(route.route_key))),
      create: vi.fn(async ({ data }: any) => {
        const route = { id: `route_${++next}`, status: "active", current_version_id: null, ...data };
        routes.push(route);
        return route;
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(routes.find((route) => route.id === where.id)!, data))
    },
    serviceRouteVersion: {
      create: vi.fn(async ({ data }: any) => {
        const version = { id: `version_${++next}`, ...data };
        versions.push(version);
        return version;
      }),
      update: vi.fn()
    },
    routeVersionStop: { createMany: vi.fn(async ({ data }: any) => memberships.push(...data)) },
    auditEvent: { create: vi.fn() }
  };
  return { db, stops, routes, versions, memberships };
}

describe("ensurePredefinedRoutes", () => {
  it("creates the 10 city stops and 20 published two-stop routes", async () => {
    const { db, stops, routes, versions, memberships } = fakeCatalogue();
    const result = await ensurePredefinedRoutes(db);

    expect(result).toMatchObject({ createdStops: 10, createdRoutes: 20 });
    expect(stops.map((stop) => stop.stop_key).sort()).toEqual(PREDEFINED_CITIES.map((city) => `city-${city.slug}`).sort());
    expect(stops.every((stop) => stop.service_region_key === "west-bank" && stop.created_by_user_id === "admin_1")).toBe(true);
    expect(routes).toHaveLength(20);
    expect(new Set(routes.map((route) => route.route_key)).size).toBe(20);
    expect(routes.map((route) => route.route_key)).toEqual(expect.arrayContaining(["hebron-to-bethlehem", "bethlehem-to-hebron", "nablus-to-tubas", "tubas-to-nablus"]));

    const forward = routes.find((route) => route.route_key === "hebron-to-bethlehem")!;
    const version = versions.find((row) => row.id === forward.current_version_id)!;
    expect(version).toMatchObject({
      status: "published",
      version_number: 1,
      name_ar: "الخليل ← بيت لحم",
      name_en: "Hebron → Bethlehem",
      origin_stop_id: result.stops.hebron!.id,
      destination_stop_id: result.stops.bethlehem!.id
    });
    expect(memberships.filter((row) => row.service_route_version_id === version.id)).toEqual([
      expect.objectContaining({ sequence: 1, stop_id: result.stops.hebron!.id, passenger_pickup: true, parcel_pickup: true, passenger_dropoff: false, parcel_dropoff: false }),
      expect.objectContaining({ sequence: 2, stop_id: result.stops.bethlehem!.id, passenger_pickup: false, parcel_pickup: false, passenger_dropoff: true, parcel_dropoff: true })
    ]);
    // Each route is created in its own transaction.
    expect(db.$transaction).toHaveBeenCalledTimes(20);
  });

  it("is idempotent and never edits or re-activates what already exists", async () => {
    const first = fakeCatalogue();
    await ensurePredefinedRoutes(first.db);
    // An admin turned one route off and retired another; neither may come back.
    const paused = first.routes.find((route) => route.route_key === "hebron-to-ramallah")!;
    const retired = first.routes.find((route) => route.route_key === "ramallah-to-hebron")!;
    retired.status = "retired";
    const again = fakeCatalogue({ stops: first.stops, routes: first.routes });

    const result = await ensurePredefinedRoutes(again.db);

    expect(result).toMatchObject({ createdStops: 0, createdRoutes: 0 });
    expect(again.db.stop.create).not.toHaveBeenCalled();
    expect(again.db.serviceRoute.create).not.toHaveBeenCalled();
    expect(again.db.stop.update).not.toHaveBeenCalled();
    expect(again.db.serviceRoute.update).not.toHaveBeenCalled();
    expect(again.db.serviceRouteVersion.update).not.toHaveBeenCalled();
    expect(result.routes["hebron-to-ramallah"]!.id).toBe(paused.id);
    expect(retired.status).toBe("retired");
  });

  it("creates only the missing rows and does not route through a retired city", async () => {
    const hebron = { id: "existing_hebron", stop_key: "city-hebron", status: "retired", name_ar: "الخليل", name_en: "Hebron", latitude: "31.5", longitude: "35.1" };
    const { db } = fakeCatalogue({ stops: [hebron] });
    const result = await ensurePredefinedRoutes(db);
    expect(result.createdStops).toBe(9);
    // Hebron's four routes are skipped while its stop is retired.
    expect(result.createdRoutes).toBe(16);
    expect(result.routes["hebron-to-bethlehem"]).toBeUndefined();
  });

  it("skips a route another API instance created at the same moment", async () => {
    const { db } = fakeCatalogue();
    const create = db.serviceRoute.create.getMockImplementation();
    db.serviceRoute.create.mockImplementationOnce(async () => {
      throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
    }).mockImplementation(create);
    const result = await ensurePredefinedRoutes(db);
    expect(result.createdRoutes).toBe(19);
  });

  it("creates nothing without an admin to attribute the rows to", async () => {
    const { db } = fakeCatalogue({ admin: false });
    await expect(ensurePredefinedRoutes(db)).resolves.toMatchObject({ skipped: "no_admin", createdRoutes: 0 });
    expect(db.stop.create).not.toHaveBeenCalled();
  });

  it("attributes the rows to the given actor inside the caller's transaction", async () => {
    const { db, stops } = fakeCatalogue();
    const { $transaction: _ignored, ...tx } = db;
    await ensurePredefinedRoutes(tx, "admin_seed");
    expect(db.user.findFirst).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(stops.every((stop) => stop.created_by_user_id === "admin_seed")).toBe(true);
  });
});

describe("driver online state on a route", () => {
  function onlineDb(
    current: Array<{ id: string; status: string }> = [],
    currentRouteId?: string,
    vehicle: { seats_total: number; parcel_capacity: number } = { seats_total: 4, parcel_capacity: 6 }
  ) {
    const db: any = {
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
      $queryRaw: vi.fn(async (parts: TemplateStringsArray) =>
        parts.join("?").includes("FROM driver_profiles") ? [{ id: "profile_1", verified: true, ...vehicle }] : current),
      idempotencyRecord: {
        create: vi.fn(async ({ data }: any) => ({ id: "record_1", state: "processing", claim_version: 1, ...data })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "record_1" })
      },
      serviceRoute: { findUnique: vi.fn(findOperatingRoute()) },
      driverRoute: {
        create: vi.fn(async ({ data }: any) => ({ id: "route_new", ...data })),
        update: vi.fn(),
        findFirst: vi.fn(async ({ where }: any) =>
          where.route_version.is.service_route_id === currentRouteId ? { id: where.id } : null)
      },
      auditEvent: { create: vi.fn() }
    };
    return db;
  }
  const actor = { id: "driver_1", idempotencyKey: "online-key-0001" };

  it("goes online on the chosen route", async () => {
    const db = onlineDb();
    const result = await createLegacyDriverOnlineStateService(db).setState({ online: true, serviceRouteId: "service_route_hebron_bethlehem" }, actor);
    expect(result).toMatchObject({ online: true, routeId: "route_new", changed: true });
    expect(db.driverRoute.create.mock.calls[0][0].data).toMatchObject({
      driver_id: "profile_1", origin_label: "Hebron", destination_label: "Bethlehem",
      corridor_key: "hebron-to-bethlehem", route_version_id: "route_version_hebron_bethlehem", status: "active", operational_mode: "legacy"
    });
  });

  it("opens the route with the vehicle's seats and parcel space, not one seat and none", async () => {
    const db = onlineDb([], undefined, { seats_total: 4, parcel_capacity: 6 });
    await createLegacyDriverOnlineStateService(db).setState({ online: true, serviceRouteId: "service_route_hebron_bethlehem" }, actor);
    expect(db.driverRoute.create.mock.calls[0][0].data).toMatchObject({ seats_available: 4, parcel_capacity_available: 6 });
    // Older builds that name no route get the same capacity.
    const legacy = onlineDb([], undefined, { seats_total: 2, parcel_capacity: 8 });
    await createLegacyDriverOnlineStateService(legacy).setState({ online: true }, actor);
    expect(legacy.driverRoute.create.mock.calls[0][0].data).toMatchObject({ seats_available: 2, parcel_capacity_available: 8 });
  });

  it.each([
    [{ seats_total: 12, parcel_capacity: 50 }, { seats_available: 8, parcel_capacity_available: 20 }],
    [{ seats_total: -1, parcel_capacity: -3 }, { seats_available: 0, parcel_capacity_available: 0 }],
    [{ seats_total: 0, parcel_capacity: 5 }, { seats_available: 0, parcel_capacity_available: 5 }]
  ])("holds the vehicle %j to the explicit route limits", async (vehicle, expected) => {
    const db = onlineDb([], undefined, vehicle);
    await createLegacyDriverOnlineStateService(db).setState({ online: true, serviceRouteId: "service_route_hebron_bethlehem" }, actor);
    expect(db.driverRoute.create.mock.calls[0][0].data).toMatchObject(expected);
  });

  it("lets a parcel be reserved on a route opened by going online", async () => {
    const { reserveLegacyCapacity } = await import("../services/legacyCapacity.js");
    const db = onlineDb([], undefined, { seats_total: 3, parcel_capacity: 5 });
    const rows = new Map<string, Row>();
    db.driverRoute.create = vi.fn(async ({ data }: any) => {
      const row = { id: "route_new", ...data };
      rows.set(row.id, row);
      return row;
    });
    // Eligibility and the guarded decrement, as MySQL would answer them.
    const profileQuery = db.$queryRaw.getMockImplementation();
    db.$queryRaw = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const sql = parts.join("?");
      if (sql.includes("UTC_TIMESTAMP")) return [{ now: new Date() }];
      if (sql.includes("FROM driver_routes dr")) {
        const row = rows.get(values.find((value) => rows.has(value as string)) as string);
        return row ? [{ id: row.id, status: row.status, verified: true, role: "driver", account_status: "active",
          departure_at: null, availability_window_end: null, departed_at: null, preferred_time: null, match_expires_at: null }] : [];
      }
      return profileQuery!(parts, ...values);
    });
    db.driverRoute.updateMany = vi.fn(async ({ where, data }: any) => {
      const row = rows.get(where.id);
      if (!row || row.seats_available < where.seats_available.gte ||
        row.parcel_capacity_available < where.parcel_capacity_available.gte) return { count: 0 };
      row.seats_available -= data.seats_available?.decrement ?? 0;
      row.parcel_capacity_available -= data.parcel_capacity_available?.decrement ?? 0;
      return { count: 1 };
    });

    const { routeId } = await createLegacyDriverOnlineStateService(db).setState({ online: true, serviceRouteId: "service_route_hebron_bethlehem" }, actor);
    await expect(reserveLegacyCapacity(db, { driverRouteId: routeId, seats: 0, parcelUnits: 2 })).resolves.toBeUndefined();
    await expect(reserveLegacyCapacity(db, { driverRouteId: routeId, seats: 2, parcelUnits: 0 })).resolves.toBeUndefined();
    expect(rows.get(routeId)).toMatchObject({ seats_available: 1, parcel_capacity_available: 3 });
    await expect(reserveLegacyCapacity(db, { driverRouteId: routeId, seats: 0, parcelUnits: 4 }))
      .rejects.toMatchObject({ statusCode: 409, message: "insufficient_parcel_capacity" });
  });

  it("puts an older build that names no route on Hebron → Bethlehem, and needs a live route", async () => {
    const db = onlineDb();
    await expect(createLegacyDriverOnlineStateService(db).setState({ online: true }, actor))
      .resolves.toMatchObject({ online: true, routeId: "route_new" });
    expect(db.driverRoute.create.mock.calls[0][0].data).toMatchObject({ corridor_key: "hebron-to-bethlehem" });
    await expect(createLegacyDriverOnlineStateService(onlineDb()).setState({ online: true, serviceRouteId: "gone" }, actor))
      .rejects.toMatchObject({ statusCode: 409, message: "route_unavailable" });
  });

  it("keeps an active driver route on the same route and refuses switching routes while online", async () => {
    const same = onlineDb([{ id: "route_live", status: "active" }], "service_route_hebron_bethlehem");
    await expect(createLegacyDriverOnlineStateService(same).setState({ online: true, serviceRouteId: "service_route_hebron_bethlehem" }, actor))
      .resolves.toMatchObject({ routeId: "route_live", changed: false });
    const other = onlineDb([{ id: "route_live", status: "active" }], "service_route_hebron_bethlehem");
    await expect(createLegacyDriverOnlineStateService(other).setState({ online: true, serviceRouteId: "service_route_ramallah_nablus" }, actor))
      .rejects.toMatchObject({ statusCode: 409, message: "route_already_active" });
    // Without a route the active one is simply kept, as before.
    await expect(createLegacyDriverOnlineStateService(onlineDb([{ id: "route_live", status: "active" }])).setState({ online: true }, actor))
      .resolves.toMatchObject({ routeId: "route_live" });
  });
});

describe("operating route reads", () => {
  it("lists only active two-stop routes, ordered by origin then destination", async () => {
    const rows = [
      operatingRouteRow({ origin: CITY.ramallah, destination: CITY.nablus }),
      operatingRouteRow({ origin: CITY.hebron, destination: CITY.ramallah }),
      operatingRouteRow({ origin: CITY.hebron, destination: CITY.bethlehem }),
      // The demo corridor has three stops: not an operating route.
      operatingRouteRow({ id: "demo_corridor", origin: CITY.hebron, destination: CITY.nablus, stops: 3 })
    ];
    const db = { serviceRoute: { findMany: vi.fn().mockResolvedValue(rows) } };
    const routes = await listActiveOperatingRoutes(db as never);
    expect(routes.map((route) => route.route_key)).toEqual(["hebron-to-bethlehem", "hebron-to-ramallah", "ramallah-to-nablus"]);
    expect(db.serviceRoute.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "active", current_version: { is: { status: "published" } } }
    }));
    expect(serializeOperatingRoute(routes[0]!)).toEqual({
      id: "service_route_hebron_bethlehem",
      route_key: "hebron-to-bethlehem",
      name_ar: "الخليل ← بيت لحم",
      name_en: "Hebron → Bethlehem",
      origin: { id: "stop_hebron", name_ar: "الخليل", name_en: "Hebron", latitude: 31.5326, longitude: 35.0998 },
      destination: { id: "stop_bethlehem", name_ar: "بيت لحم", name_en: "Bethlehem", latitude: 31.7054, longitude: 35.2024 }
    });
  });

  it.each([
    ["unknown", null],
    ["turned off", operatingRouteRow({ versionStatus: "paused" })],
    ["retired", operatingRouteRow({ status: "retired" })],
    ["not a two-city route", operatingRouteRow({ stops: 3 })]
  ])("refuses a write on a %s route with 409 route_unavailable", async (_label, row) => {
    const db = { serviceRoute: { findUnique: vi.fn().mockResolvedValue(row) } };
    await expect(resolveOperatingRoute(db as never, "any")).rejects.toMatchObject({ statusCode: 409, message: "route_unavailable" });
  });

  it("resolves an active route to its version and city centres", async () => {
    const db = { serviceRoute: { findUnique: vi.fn().mockResolvedValue(operatingRouteRow()) } };
    await expect(resolveOperatingRoute(db as never, "service_route_hebron_bethlehem")).resolves.toMatchObject({
      serviceRouteId: "service_route_hebron_bethlehem",
      routeVersionId: "route_version_hebron_bethlehem",
      routeKey: "hebron-to-bethlehem",
      origin: { nameEn: "Hebron", latitude: "31.532600", longitude: "35.099800" },
      destination: { nameEn: "Bethlehem", latitude: "31.705400", longitude: "35.202400" }
    });
  });
});
