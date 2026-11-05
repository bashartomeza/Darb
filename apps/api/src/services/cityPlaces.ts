import { z } from "zod";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { config } from "../config.js";
import { auditEvent } from "../lib/audit.js";
import { HttpError } from "../middleware/error.js";
import { CITY_STOP_PREFIX, SERVICE_AREA, resolveOperatingRoute, type ResolvedOperatingRoute } from "./operatingRoutes.js";

/**
 * City places: the named villages and towns a rider or sender picks as pickup
 * and drop-off inside a city of a predefined route (docs/routes/city-places.md).
 * A place belongs to a city by the city's stop key ("city-hebron").
 */

type Db = PrismaClient | Prisma.TransactionClient;

const noControlCharacters = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);

export const placeIdSchema = z.string().trim().min(1).max(191);

/** The optional "more details" text: empty means none, otherwise 1–300 characters. */
export const optionalDetailsSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => (value === undefined || value === null ? null : value.trim().replace(/\s+/g, " ")))
  .refine((value) => value === null || value === "" || (value.length <= 300 && noControlCharacters(value)), "Invalid value")
  .transform((value) => (value === "" ? null : value));

type PlaceRow = {
  id: string;
  city_key: string;
  name_ar: string;
  name_en: string;
  latitude: unknown;
  longitude: unknown;
  approximate: boolean;
  source: string;
  active: boolean;
  sort_order: number;
  created_at?: Date;
  updated_at?: Date;
};

function coordinate(value: unknown) {
  return typeof value === "number" ? value : Number(String(value));
}

/** What the apps need to show and send a place. */
export function serializeCityPlace(row: PlaceRow, lang: "ar" | "en" = "ar") {
  return {
    id: row.id,
    name: lang === "en" ? row.name_en : row.name_ar,
    name_ar: row.name_ar,
    name_en: row.name_en,
    latitude: coordinate(row.latitude),
    longitude: coordinate(row.longitude),
    approximate: row.approximate
  };
}

/** The full row for the admin app. */
export function serializeAdminCityPlace(row: PlaceRow) {
  return {
    id: row.id,
    city_key: row.city_key,
    name_ar: row.name_ar,
    name_en: row.name_en,
    latitude: coordinate(row.latitude),
    longitude: coordinate(row.longitude),
    approximate: row.approximate,
    source: row.source,
    active: row.active,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function byName(lang: "ar" | "en") {
  return (a: PlaceRow, b: PlaceRow) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return (lang === "en" ? a.name_en : a.name_ar).localeCompare(lang === "en" ? b.name_en : b.name_ar, lang);
  };
}

/** Active places of one city. The city centre has sort_order 0 and comes first. */
export async function listActivePlaces(db: Db, cityKey: string, lang: "ar" | "en" = "ar") {
  const rows = await db.cityPlace.findMany({ where: { city_key: cityKey, active: true } });
  return rows.sort(byName(lang));
}

/**
 * The choices for one route: pickup places of its origin city and drop-off
 * places of its destination city. The reverse route lists them the other way
 * round, because every route direction is its own route.
 */
export async function listPlacesForRoute(db: Db, serviceRouteId: string, lang: "ar" | "en" = "ar") {
  const route = await resolveOperatingRoute(db, serviceRouteId);
  const [pickup, dropoff] = await Promise.all([
    listActivePlaces(db, route.origin.stopKey, lang),
    listActivePlaces(db, route.destination.stopKey, lang)
  ]);
  return {
    route_id: route.serviceRouteId,
    pickup_city_key: route.origin.stopKey,
    dropoff_city_key: route.destination.stopKey,
    pickup_places: pickup.map((row) => serializeCityPlace(row, lang)),
    dropoff_places: dropoff.map((row) => serializeCityPlace(row, lang))
  };
}

export type PlaceSide = "pickup" | "dropoff";

export type ResolvedPlace = {
  /** Null for free-text orders from older app builds. */
  place: { id: string; nameAr: string; nameEn: string; latitude: string; longitude: string } | null;
  /** The optional extra text; null when none was given. */
  details: string | null;
};

/**
 * Validates one end of an order. With a place id the place must exist, be
 * active and belong to the city of that end of the route; the text is then
 * only extra detail. Without one, the order is a free-text order from an older
 * app build: accepted with 3–300 characters of text unless
 * ROUTE_PLACES_REQUIRED is on.
 */
export async function resolveOrderPlace(
  db: Db,
  side: PlaceSide,
  cityKey: string,
  input: { placeId?: string | null; details?: string | null },
  /** Bulk files carry text only: accepted even when places are required. */
  freeTextOnly = false
): Promise<ResolvedPlace> {
  const details = input.details?.trim() ? input.details.trim() : null;
  if (!input.placeId) {
    if (config.routePlacesRequired && !freeTextOnly) throw new HttpError(400, `${side}_place_required`);
    if (!details || details.length < 3) throw new HttpError(400, `${side}_details_required`);
    return { place: null, details };
  }
  const row = await db.cityPlace.findUnique({ where: { id: input.placeId } });
  if (!row || !row.active) throw new HttpError(400, `${side}_place_unavailable`);
  if (row.city_key !== cityKey) throw new HttpError(400, `${side}_place_wrong_city`);
  return {
    place: {
      id: row.id,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      latitude: coordinate(row.latitude).toFixed(6),
      longitude: coordinate(row.longitude).toFixed(6)
    },
    details
  };
}

/** The columns an order stores for one end: place id and names, and the optional text. */
export function placeColumns(side: PlaceSide, resolved: ResolvedPlace) {
  const prefix = side;
  return {
    [`${prefix}_place_id`]: resolved.place?.id ?? null,
    [`${prefix}_place_name_ar`]: resolved.place?.nameAr ?? null,
    [`${prefix}_place_name_en`]: resolved.place?.nameEn ?? null,
    [`${prefix}_details`]: resolved.details
  } as Record<string, string | null>;
}

/** Cities in the order every route end refers to them: [origin, destination] stop keys. */
export function routeCityKeys(route: ResolvedOperatingRoute) {
  return { origin: route.origin.stopKey, destination: route.destination.stopKey };
}

// --------------------------------------------------------------------------
// Admin
// --------------------------------------------------------------------------

type Actor = { id: string; requestId?: string };

const cleanText = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .refine((value) => value.length >= min && value.length <= max && noControlCharacters(value), "Invalid value");

const latitude = z.number().finite().min(SERVICE_AREA.minLatitude).max(SERVICE_AREA.maxLatitude);
const longitude = z.number().finite().min(SERVICE_AREA.minLongitude).max(SERVICE_AREA.maxLongitude);
export const cityKeySchema = z.string().trim().regex(new RegExp(`^${CITY_STOP_PREFIX}[a-z0-9-]{1,70}$`));

export const createPlaceSchema = z.strictObject({
  city_key: cityKeySchema,
  name_ar: cleanText(2, 160),
  name_en: cleanText(2, 160),
  latitude,
  longitude,
  sort_order: z.number().int().min(0).max(10_000).optional()
});

export const updatePlaceSchema = z
  .strictObject({
    name_ar: cleanText(2, 160).optional(),
    name_en: cleanText(2, 160).optional(),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    active: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(10_000).optional()
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: "no_changes" });

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

/** Cities (stops keyed city-*) with how many places each has. */
export async function listPlaceCities(db: Db) {
  const [stops, groups] = await Promise.all([
    db.stop.findMany({ where: { stop_key: { startsWith: CITY_STOP_PREFIX } }, orderBy: { name_en: "asc" } }),
    db.cityPlace.groupBy({ by: ["city_key", "active"], _count: { _all: true } })
  ]);
  const counts = new Map<string, { total: number; active: number }>();
  for (const group of groups) {
    const entry = counts.get(group.city_key) ?? { total: 0, active: 0 };
    entry.total += group._count._all;
    if (group.active) entry.active += group._count._all;
    counts.set(group.city_key, entry);
  }
  const known = new Set(stops.map((stop) => stop.stop_key));
  const cities = stops.map((stop) => ({
    city_key: stop.stop_key,
    name_ar: stop.name_ar,
    name_en: stop.name_en,
    places_total: counts.get(stop.stop_key)?.total ?? 0,
    places_active: counts.get(stop.stop_key)?.active ?? 0
  }));
  // Seeded places of a city whose stop row does not exist yet (fresh database).
  for (const [key, count] of counts) {
    if (known.has(key)) continue;
    cities.push({ city_key: key, name_ar: key, name_en: key, places_total: count.total, places_active: count.active });
  }
  return cities;
}

export async function listAdminPlaces(db: Db, filter: { cityKey?: string; search?: string }) {
  const rows = await db.cityPlace.findMany({
    where: {
      ...(filter.cityKey ? { city_key: filter.cityKey } : {}),
      ...(filter.search ? { OR: [{ name_ar: { contains: filter.search } }, { name_en: { contains: filter.search } }] } : {})
    },
    orderBy: [{ city_key: "asc" }, { sort_order: "asc" }, { name_ar: "asc" }]
  });
  return rows.map(serializeAdminCityPlace);
}

export async function createCityPlace(db: PrismaClient, input: z.infer<typeof createPlaceSchema>, actor: Actor) {
  const city = await db.stop.findUnique({ where: { stop_key: input.city_key }, select: { status: true } });
  if (!city) throw new HttpError(404, "city_not_found");
  try {
    return await db.$transaction(async (tx) => {
      const last = await tx.cityPlace.aggregate({ where: { city_key: input.city_key }, _max: { sort_order: true } });
      const row = await tx.cityPlace.create({
        data: {
          city_key: input.city_key,
          name_ar: input.name_ar,
          name_en: input.name_en,
          latitude: input.latitude.toFixed(6),
          longitude: input.longitude.toFixed(6),
          approximate: false,
          source: "admin",
          sort_order: input.sort_order ?? (last._max.sort_order ?? 0) + 1
        }
      });
      await auditEvent(tx, {
        userId: actor.id,
        action: AuditAction.admin_action,
        entityType: "CityPlace",
        entityId: row.id,
        metadata: {
          action: "city_place_created",
          city_key: row.city_key,
          name_ar: row.name_ar,
          name_en: row.name_en,
          latitude: input.latitude,
          longitude: input.longitude,
          request_id: actor.requestId ?? null
        }
      });
      return serializeAdminCityPlace(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "city_place_exists");
    throw error;
  }
}

export async function updateCityPlace(db: PrismaClient, id: string, input: z.infer<typeof updatePlaceSchema>, actor: Actor) {
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.cityPlace.findUnique({ where: { id } });
      if (!current) throw new HttpError(404, "city_place_not_found");
      const moved = input.latitude !== undefined || input.longitude !== undefined;
      const data: Prisma.CityPlaceUpdateInput = {
        ...(input.name_ar !== undefined ? { name_ar: input.name_ar } : {}),
        ...(input.name_en !== undefined ? { name_en: input.name_en } : {}),
        ...(input.latitude !== undefined ? { latitude: input.latitude.toFixed(6) } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude.toFixed(6) } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.sort_order !== undefined ? { sort_order: input.sort_order } : {}),
        // A position set by an admin is no longer a raw map-extract guess.
        ...(moved ? { approximate: false, source: "admin" } : {})
      };
      const row = await tx.cityPlace.update({ where: { id }, data });
      await auditEvent(tx, {
        userId: actor.id,
        action: AuditAction.admin_action,
        entityType: "CityPlace",
        entityId: id,
        metadata: {
          action: input.active !== undefined && Object.keys(input).length === 1 ? (input.active ? "city_place_enabled" : "city_place_disabled") : "city_place_updated",
          city_key: current.city_key,
          before: {
            name_ar: current.name_ar,
            name_en: current.name_en,
            latitude: coordinate(current.latitude),
            longitude: coordinate(current.longitude),
            active: current.active,
            sort_order: current.sort_order
          },
          changes: input,
          request_id: actor.requestId ?? null
        }
      });
      return serializeAdminCityPlace(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "city_place_exists");
    throw error;
  }
}
