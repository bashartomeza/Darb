import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import { HttpError } from "../middleware/error.js";

/**
 * Operating routes: the predefined city-to-city routes every order names
 * (docs/routes/route-based-orders.md).
 *
 * An operating route is an ordinary ServiceRoute whose current version has
 * exactly two stops, the origin city and the destination city. A city is a
 * Stop keyed `city-<slug>`. Orders and driver routes store the route's current
 * version; matching compares the service route, which survives republishing.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const OPERATING_REGION_KEY = "west-bank";
export const CITY_STOP_PREFIX = "city-";
/** Old app builds send coordinates instead of a route; they ride this one. */
export const LEGACY_DEFAULT_ROUTE_KEY = "hebron-to-bethlehem";
/** New cities must lie inside the West Bank service area. */
export const SERVICE_AREA = { minLatitude: 29.4, maxLatitude: 33.4, minLongitude: 34.2, maxLongitude: 35.95 } as const;

export const PREDEFINED_CITIES = [
  { slug: "hebron", name_ar: "الخليل", name_en: "Hebron", latitude: 31.5326, longitude: 35.0998 },
  { slug: "bethlehem", name_ar: "بيت لحم", name_en: "Bethlehem", latitude: 31.7054, longitude: 35.2024 },
  { slug: "ramallah", name_ar: "رام الله", name_en: "Ramallah", latitude: 31.9038, longitude: 35.2034 },
  { slug: "nablus", name_ar: "نابلس", name_en: "Nablus", latitude: 32.2211, longitude: 35.2544 },
  { slug: "jenin", name_ar: "جنين", name_en: "Jenin", latitude: 32.4637, longitude: 35.2938 },
  { slug: "tulkarm", name_ar: "طولكرم", name_en: "Tulkarm", latitude: 32.3104, longitude: 35.0286 },
  { slug: "qalqilya", name_ar: "قلقيلية", name_en: "Qalqilya", latitude: 32.1896, longitude: 34.9706 },
  { slug: "jericho", name_ar: "أريحا", name_en: "Jericho", latitude: 31.8611, longitude: 35.46 },
  { slug: "salfit", name_ar: "سلفيت", name_en: "Salfit", latitude: 32.0849, longitude: 35.1806 },
  { slug: "tubas", name_ar: "طوباس", name_en: "Tubas", latitude: 32.3209, longitude: 35.3699 }
] as const;

/** Each pair is created in both directions; the listed direction is "outbound". */
export const PREDEFINED_ROUTE_PAIRS = [
  ["hebron", "bethlehem"],
  ["hebron", "ramallah"],
  ["bethlehem", "ramallah"],
  ["ramallah", "nablus"],
  ["nablus", "jenin"],
  ["nablus", "tulkarm"],
  ["nablus", "qalqilya"],
  ["ramallah", "jericho"],
  ["nablus", "salfit"],
  ["nablus", "tubas"]
] as const;

export function cityStopKey(slug: string) {
  return `${CITY_STOP_PREFIX}${slug}`;
}

function citySlug(stopKey: string) {
  return stopKey.startsWith(CITY_STOP_PREFIX) ? stopKey.slice(CITY_STOP_PREFIX.length) : stopKey;
}

export function operatingRouteKey(originSlug: string, destinationSlug: string) {
  return `${originSlug}-to-${destinationSlug}`;
}

/** Origin first in both languages; the Arabic arrow points left, the reading direction. */
export function operatingRouteNames(
  origin: { name_ar: string; name_en: string },
  destination: { name_ar: string; name_en: string }
) {
  return {
    name_ar: `${origin.name_ar} ← ${destination.name_ar}`,
    name_en: `${origin.name_en} → ${destination.name_en}`
  };
}

const noControlCharacters = (value: string) => !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(value);

/** Free-text pickup / drop-off details: trimmed, 3–300 characters. */
export const detailsSchema = z.string().trim().min(3).max(300).refine(noControlCharacters);
export const serviceRouteIdSchema = z.string().trim().min(1).max(191);

// --------------------------------------------------------------------------
// Reading routes
// --------------------------------------------------------------------------

export const operatingRouteInclude = {
  current_version: {
    include: {
      origin_stop: true,
      destination_stop: true,
      _count: { select: { stops: true } }
    }
  }
} satisfies Prisma.ServiceRouteInclude;

type OperatingRouteRow = Prisma.ServiceRouteGetPayload<{ include: typeof operatingRouteInclude }>;
type StopRow = { id: string; name_ar: string; name_en: string; latitude: unknown; longitude: unknown };

function coordinate(value: unknown) {
  return typeof value === "number" ? value : Number(String(value));
}

export function serializeCity(stop: StopRow) {
  return {
    id: stop.id,
    name_ar: stop.name_ar,
    name_en: stop.name_en,
    latitude: coordinate(stop.latitude),
    longitude: coordinate(stop.longitude)
  };
}

/** A route with exactly its two city stops; the demo corridor and canonical multi-stop routes are not operating routes. */
function hasOperatingShape(route: OperatingRouteRow) {
  const version = route.current_version;
  return Boolean(version?.origin_stop && version.destination_stop && version._count.stops === 2);
}

function isActive(route: OperatingRouteRow) {
  return route.status === "active" && route.current_version?.status === "published";
}

export function serializeOperatingRoute(route: OperatingRouteRow) {
  const version = route.current_version!;
  return {
    id: route.id,
    route_key: route.route_key,
    name_ar: version.name_ar,
    name_en: version.name_en,
    origin: serializeCity(version.origin_stop!),
    destination: serializeCity(version.destination_stop!)
  };
}

function byOriginThenDestination(a: OperatingRouteRow, b: OperatingRouteRow) {
  const origin = a.current_version!.origin_stop!.name_en.localeCompare(b.current_version!.origin_stop!.name_en, "en");
  if (origin !== 0) return origin;
  const destination = a.current_version!.destination_stop!.name_en.localeCompare(b.current_version!.destination_stop!.name_en, "en");
  return destination !== 0 ? destination : a.route_key.localeCompare(b.route_key);
}

/** Public list: active routes only, ordered by origin then destination name. */
export async function listActiveOperatingRoutes(db: Db) {
  const routes = await db.serviceRoute.findMany({
    where: { status: "active", current_version: { is: { status: "published" } } },
    include: operatingRouteInclude
  });
  return routes.filter(hasOperatingShape).sort(byOriginThenDestination);
}

export type ResolvedOperatingRoute = {
  serviceRouteId: string;
  routeVersionId: string;
  routeKey: string;
  nameAr: string;
  nameEn: string;
  origin: { id: string; nameEn: string; latitude: string; longitude: string };
  destination: { id: string; nameEn: string; latitude: string; longitude: string };
};

function resolved(route: OperatingRouteRow | null): ResolvedOperatingRoute {
  if (!route || !hasOperatingShape(route) || !isActive(route)) throw new HttpError(409, "route_unavailable");
  const version = route.current_version!;
  const place = (stop: StopRow) => ({
    id: stop.id,
    nameEn: stop.name_en,
    latitude: coordinate(stop.latitude).toFixed(6),
    longitude: coordinate(stop.longitude).toFixed(6)
  });
  return {
    serviceRouteId: route.id,
    routeVersionId: version.id,
    routeKey: route.route_key,
    nameAr: version.name_ar,
    nameEn: version.name_en,
    origin: place(version.origin_stop!),
    destination: place(version.destination_stop!)
  };
}

/** The route a write names. Unknown, retired or turned-off routes are `409 route_unavailable`. */
export async function resolveOperatingRoute(db: Db, serviceRouteId: string) {
  return resolved(await db.serviceRoute.findUnique({ where: { id: serviceRouteId }, include: operatingRouteInclude }));
}

export async function resolveOperatingRouteByKey(db: Db, routeKey: string) {
  return resolved(await db.serviceRoute.findUnique({ where: { route_key: routeKey }, include: operatingRouteInclude }));
}

/** A driver route's places come from its route's cities; its corridor key is the route key. */
export function driverRoutePlaces(route: ResolvedOperatingRoute) {
  return {
    origin_label: route.origin.nameEn,
    origin_lat: route.origin.latitude,
    origin_lng: route.origin.longitude,
    destination_label: route.destination.nameEn,
    destination_lat: route.destination.latitude,
    destination_lng: route.destination.longitude,
    corridor_key: route.routeKey,
    route_version_id: route.routeVersionId
  };
}

/** The route fields every route-based order or driver route serializes. */
export const routeSummarySelect = {
  select: { service_route_id: true, name_ar: true, name_en: true }
} as const;

export type RouteSummary = { service_route_id: string; name_ar: string; name_en: string } | null | undefined;

export function routeFields(version: RouteSummary) {
  return {
    service_route_id: version?.service_route_id ?? null,
    route_name_ar: version?.name_ar ?? null,
    route_name_en: version?.name_en ?? null
  };
}

/** A raw row with a `route_version` summary, flattened into the route fields. */
export function withRouteFields<T extends { route_version?: RouteSummary }>(row: T) {
  const { route_version: version, ...rest } = row;
  return { ...rest, ...routeFields(version) };
}

// --------------------------------------------------------------------------
// Creating routes
// --------------------------------------------------------------------------

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

/** Runs [operation] in its own transaction when [db] is a client; inside the caller's when it is one. */
async function inTransaction<T>(db: Db, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  if ("$transaction" in db && typeof db.$transaction === "function") {
    return (db as PrismaClient).$transaction(operation);
  }
  return operation(db as Prisma.TransactionClient);
}

type CityStop = { id: string; stop_key: string; name_ar: string; name_en: string; status?: string };

/** Creates a route already published with its two city stops, as one unit. */
async function createPublishedRoute(
  tx: Prisma.TransactionClient,
  input: {
    origin: CityStop;
    destination: CityStop;
    direction: "outbound" | "inbound";
    groupKey: string;
    actorId: string;
    source: "predefined" | "admin";
  }
) {
  const routeKey = operatingRouteKey(citySlug(input.origin.stop_key), citySlug(input.destination.stop_key));
  const names = operatingRouteNames(input.origin, input.destination);
  const now = new Date();
  const route = await tx.serviceRoute.create({
    data: {
      route_key: routeKey,
      route_group_key: input.groupKey,
      service_region_key: OPERATING_REGION_KEY,
      direction: input.direction,
      created_by_user_id: input.actorId
    }
  });
  const version = await tx.serviceRouteVersion.create({
    data: {
      service_route_id: route.id,
      version_number: 1,
      status: "published",
      ...names,
      origin_stop_id: input.origin.id,
      destination_stop_id: input.destination.id,
      created_by_user_id: input.actorId,
      published_by_user_id: input.actorId,
      published_at: now
    }
  });
  await tx.routeVersionStop.createMany({
    data: [
      {
        service_route_version_id: version.id,
        stop_id: input.origin.id,
        sequence: 1,
        passenger_pickup: true,
        passenger_dropoff: false,
        parcel_pickup: true,
        parcel_dropoff: false,
        distance_from_origin_meters: 0
      },
      {
        service_route_version_id: version.id,
        stop_id: input.destination.id,
        sequence: 2,
        passenger_pickup: false,
        passenger_dropoff: true,
        parcel_pickup: false,
        parcel_dropoff: true
      }
    ]
  });
  await tx.serviceRoute.update({ where: { id: route.id }, data: { current_version_id: version.id } });
  await auditEvent(tx, {
    userId: input.actorId,
    action: AuditAction.route_version_published,
    entityType: "ServiceRouteVersion",
    entityId: version.id,
    metadata: { route_id: route.id, transition: "created_published", reason_code: input.source === "admin" ? "admin_operating_route" : "predefined_route" }
  });
  return { id: route.id, route_key: routeKey, current_version_id: version.id };
}

export type EnsurePredefinedRoutesResult = {
  skipped?: "no_admin";
  createdStops: number;
  createdRoutes: number;
  /** City stops by slug (existing or created). */
  stops: Record<string, { id: string; stop_key: string; name_ar: string; name_en: string; latitude: unknown; longitude: unknown }>;
  /** Routes by route_key (existing or created). */
  routes: Record<string, { id: string; current_version_id: string | null }>;
};

/**
 * Creates the predefined city stops and routes that are missing, keyed by
 * stop_key / route_key. Idempotent; never edits, re-publishes or re-activates
 * a row that already exists, whatever an admin did to it. Safe to run from
 * several API instances at once: a duplicate created concurrently is skipped.
 * Rows are attributed to [actorId], or to the oldest admin when omitted; with
 * no admin at all nothing is created.
 */
export async function ensurePredefinedRoutes(db: Db, actorId?: string): Promise<EnsurePredefinedRoutesResult> {
  const actor =
    actorId ??
    (await db.user.findFirst({
      where: { role: "admin" },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
      select: { id: true }
    }))?.id;
  if (!actor) return { skipped: "no_admin", createdStops: 0, createdRoutes: 0, stops: {}, routes: {} };

  const stopKeys = PREDEFINED_CITIES.map((city) => cityStopKey(city.slug));
  const existingStops = await db.stop.findMany({ where: { stop_key: { in: stopKeys } } });
  const stops: EnsurePredefinedRoutesResult["stops"] = {};
  for (const stop of existingStops) stops[citySlug(stop.stop_key)] = stop;
  let createdStops = 0;
  for (const city of PREDEFINED_CITIES) {
    if (stops[city.slug]) continue;
    try {
      stops[city.slug] = await db.stop.create({
        data: {
          stop_key: cityStopKey(city.slug),
          service_region_key: OPERATING_REGION_KEY,
          name_ar: city.name_ar,
          name_en: city.name_en,
          latitude: city.latitude.toFixed(6),
          longitude: city.longitude.toFixed(6),
          created_by_user_id: actor
        }
      });
      createdStops += 1;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await db.stop.findUnique({ where: { stop_key: cityStopKey(city.slug) } });
      if (raced) stops[city.slug] = raced;
    }
  }

  const wanted = PREDEFINED_ROUTE_PAIRS.flatMap(([first, second]) => [
    { origin: first, destination: second, direction: "outbound" as const, groupKey: `${first}-${second}` },
    { origin: second, destination: first, direction: "inbound" as const, groupKey: `${first}-${second}` }
  ]);
  const routeKeys = wanted.map((route) => operatingRouteKey(route.origin, route.destination));
  const existingRoutes = await db.serviceRoute.findMany({
    where: { route_key: { in: routeKeys } },
    select: { id: true, route_key: true, current_version_id: true }
  });
  const routes: EnsurePredefinedRoutesResult["routes"] = {};
  for (const route of existingRoutes) routes[route.route_key] = { id: route.id, current_version_id: route.current_version_id };
  let createdRoutes = 0;
  for (const route of wanted) {
    const key = operatingRouteKey(route.origin, route.destination);
    if (routes[key]) continue;
    const origin = stops[route.origin];
    const destination = stops[route.destination];
    // A city an admin retired is not brought back through a new route.
    if (!origin || !destination || (origin as CityStop).status === "retired" || (destination as CityStop).status === "retired") continue;
    try {
      const created = await inTransaction(db, (tx) =>
        createPublishedRoute(tx, {
          origin,
          destination,
          direction: route.direction,
          groupKey: route.groupKey,
          actorId: actor,
          source: "predefined"
        })
      );
      routes[key] = { id: created.id, current_version_id: created.current_version_id };
      createdRoutes += 1;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return { createdStops, createdRoutes, stops, routes };
}

// --------------------------------------------------------------------------
// Admin
// --------------------------------------------------------------------------

type Actor = { id: string; requestId?: string };

async function ordersCountByRoute(db: Db, routeIds: string[]) {
  if (routeIds.length === 0) return new Map<string, number>();
  const versions = await db.serviceRouteVersion.findMany({
    where: { service_route_id: { in: routeIds } },
    select: { id: true, service_route_id: true }
  });
  const routeOfVersion = new Map(versions.map((version) => [version.id, version.service_route_id]));
  const versionIds = versions.map((version) => version.id);
  const counts = new Map<string, number>();
  if (versionIds.length === 0) return counts;
  const [passengers, orders] = await Promise.all([
    db.passengerRequest.groupBy({ by: ["route_version_id"], where: { route_version_id: { in: versionIds } }, _count: { _all: true } }),
    db.merchantOrder.groupBy({ by: ["route_version_id"], where: { route_version_id: { in: versionIds } }, _count: { _all: true } })
  ]);
  for (const row of [...passengers, ...orders]) {
    const routeId = row.route_version_id ? routeOfVersion.get(row.route_version_id) : undefined;
    if (routeId) counts.set(routeId, (counts.get(routeId) ?? 0) + row._count._all);
  }
  return counts;
}

async function serializeAdminRoutes(db: Db, routes: OperatingRouteRow[]) {
  const counts = await ordersCountByRoute(db, routes.map((route) => route.id));
  return routes.map((route) => ({
    ...serializeOperatingRoute(route),
    active: isActive(route),
    orders_count: counts.get(route.id) ?? 0
  }));
}

/** Active and turned-off operating routes; retired routes are not listed. */
export async function listAdminOperatingRoutes(db: Db) {
  const routes = await db.serviceRoute.findMany({
    where: { status: "active", current_version: { is: { status: { in: ["published", "paused"] } } } },
    include: operatingRouteInclude
  });
  return serializeAdminRoutes(db, routes.filter(hasOperatingShape).sort(byOriginThenDestination));
}

async function loadCity(db: Db, id: string) {
  const stop = await db.stop.findUnique({ where: { id } });
  if (!stop || !stop.stop_key.startsWith(CITY_STOP_PREFIX)) throw new HttpError(404, "city_not_found");
  if (stop.status !== "active") throw new HttpError(409, "city_retired");
  return stop;
}

/** An existing route (any status) for this direction, by key or by its current endpoints. */
async function directionExists(db: Db, origin: CityStop, destination: CityStop) {
  const key = operatingRouteKey(citySlug(origin.stop_key), citySlug(destination.stop_key));
  const byKey = await db.serviceRoute.findUnique({ where: { route_key: key }, select: { id: true } });
  if (byKey) return true;
  const byEndpoints = await db.serviceRoute.findFirst({
    where: {
      status: "active",
      current_version: { is: { origin_stop_id: origin.id, destination_stop_id: destination.id, status: { in: ["published", "paused"] } } }
    },
    select: { id: true }
  });
  return Boolean(byEndpoints);
}

/**
 * Creates and publishes origin → destination and, when asked, the way back.
 * `409 route_exists` when the requested direction already exists; with
 * [bothDirections] an existing way back is kept as it is.
 */
export async function createOperatingRoutes(
  db: PrismaClient,
  input: { originCityId: string; destinationCityId: string; bothDirections: boolean },
  actor: Actor
) {
  if (input.originCityId === input.destinationCityId) throw new HttpError(400, "identical_route_endpoints");
  const createdIds = await db.$transaction(async (tx) => {
    const origin = await loadCity(tx, input.originCityId);
    const destination = await loadCity(tx, input.destinationCityId);
    if (await directionExists(tx, origin, destination)) throw new HttpError(409, "route_exists");
    const groupKey = `${citySlug(origin.stop_key)}-${citySlug(destination.stop_key)}`.slice(0, 80);
    const ids: string[] = [];
    try {
      ids.push((await createPublishedRoute(tx, { origin, destination, direction: "outbound", groupKey, actorId: actor.id, source: "admin" })).id);
      if (input.bothDirections && !(await directionExists(tx, destination, origin))) {
        ids.push(
          (await createPublishedRoute(tx, { origin: destination, destination: origin, direction: "inbound", groupKey, actorId: actor.id, source: "admin" })).id
        );
      }
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, "route_exists");
      throw error;
    }
    for (const id of ids) {
      await auditEvent(tx, {
        userId: actor.id,
        action: AuditAction.route_created,
        entityType: "ServiceRoute",
        entityId: id,
        metadata: { request_id: actor.requestId ?? null, reason_code: "operating_routes" }
      });
    }
    return ids;
  });
  const routes = await db.serviceRoute.findMany({ where: { id: { in: createdIds } }, include: operatingRouteInclude });
  return serializeAdminRoutes(db, routes.sort(byOriginThenDestination));
}

/** Turns a route off (pauses its current version) or back on (resumes it). Idempotent. */
export async function setOperatingRouteActive(db: PrismaClient, routeId: string, active: boolean, actor: Actor) {
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: string; current_version_id: string | null }>>`
      SELECT id, status, current_version_id FROM service_routes WHERE id = ${routeId} FOR UPDATE
    `;
    const route = locked[0];
    if (!route) throw new HttpError(404, "route_not_found");
    if (route.status !== "active" || !route.current_version_id) throw new HttpError(409, "route_unavailable");
    const versions = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status FROM service_route_versions WHERE id = ${route.current_version_id} FOR UPDATE
    `;
    const version = versions[0];
    if (!version || (version.status !== "published" && version.status !== "paused")) {
      throw new HttpError(409, "route_unavailable");
    }
    if (active && version.status === "paused") {
      await tx.serviceRouteVersion.update({
        where: { id: version.id },
        data: { status: "published", paused_at: null, paused_by_user_id: null, pause_reason: null }
      });
      await auditEvent(tx, {
        userId: actor.id,
        action: AuditAction.route_version_resumed,
        entityType: "ServiceRouteVersion",
        entityId: version.id,
        metadata: { request_id: actor.requestId ?? null, transition: "paused_to_published", reason_code: "operating_routes" }
      });
    } else if (!active && version.status === "published") {
      await tx.serviceRouteVersion.update({
        where: { id: version.id },
        data: { status: "paused", paused_at: new Date(), paused_by_user_id: actor.id, pause_reason: "turned_off_by_admin" }
      });
      await auditEvent(tx, {
        userId: actor.id,
        action: AuditAction.route_version_paused,
        entityType: "ServiceRouteVersion",
        entityId: version.id,
        metadata: { request_id: actor.requestId ?? null, transition: "published_to_paused", reason_code: "operating_routes" }
      });
    }
  });
  const route = await db.serviceRoute.findUnique({ where: { id: routeId }, include: operatingRouteInclude });
  if (!route || !hasOperatingShape(route)) throw new HttpError(404, "route_not_found");
  return (await serializeAdminRoutes(db, [route]))[0]!;
}

export async function listCities(db: Db) {
  const stops = await db.stop.findMany({
    where: { stop_key: { startsWith: CITY_STOP_PREFIX }, status: "active" },
    orderBy: [{ name_en: "asc" }, { id: "asc" }]
  });
  return stops.map(serializeCity);
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function isInsideServiceArea(latitude: number, longitude: number) {
  return (
    latitude >= SERVICE_AREA.minLatitude &&
    latitude <= SERVICE_AREA.maxLatitude &&
    longitude >= SERVICE_AREA.minLongitude &&
    longitude <= SERVICE_AREA.maxLongitude
  );
}

/** Adds a city (a `city-<slug>` stop). `409 city_exists` when a city has that English name. */
export async function createCity(
  db: PrismaClient,
  input: { nameAr: string; nameEn: string; latitude: number; longitude: number },
  actor: Actor
) {
  if (!isInsideServiceArea(input.latitude, input.longitude)) throw new HttpError(400, "city_outside_service_area");
  // Names written only in Arabic letters still get a stable, unique key.
  const slug = slugify(input.nameEn) || `place-${randomUUID().slice(0, 8)}`;
  const stopKey = cityStopKey(slug);
  const duplicate = await db.stop.findFirst({
    where: { OR: [{ stop_key: stopKey }, { stop_key: { startsWith: CITY_STOP_PREFIX }, name_en: input.nameEn }] },
    select: { id: true }
  });
  if (duplicate) throw new HttpError(409, "city_exists");
  try {
    const stop = await db.$transaction(async (tx) => {
      const created = await tx.stop.create({
        data: {
          stop_key: stopKey,
          service_region_key: OPERATING_REGION_KEY,
          name_ar: input.nameAr,
          name_en: input.nameEn,
          latitude: input.latitude.toFixed(6),
          longitude: input.longitude.toFixed(6),
          created_by_user_id: actor.id
        }
      });
      await auditEvent(tx, {
        userId: actor.id,
        action: AuditAction.stop_created,
        entityType: "Stop",
        entityId: created.id,
        metadata: { request_id: actor.requestId ?? null, reason_code: "operating_routes" }
      });
      return created;
    });
    return serializeCity(stop);
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "city_exists");
    throw error;
  }
}
