import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

/**
 * Places of interest for the map (docs/maps/places.md). The category list lives in
 * `apps/api/data/map-place-categories.json` so the importer, the API, the admin page
 * and the apps share one list; the rows live in the `map_places` table.
 */

export const MAP_PLACE_CATEGORIES_FILE = fileURLToPath(new URL("../../data/map-place-categories.json", import.meta.url));
export const OSM_PLACES_FILE = fileURLToPath(new URL("../../data/osm-places.json", import.meta.url));

const categoriesFileSchema = z.object({
  categories: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/) })).min(1)
});

export function loadMapPlaceCategories(file = MAP_PLACE_CATEGORIES_FILE): string[] {
  return categoriesFileSchema.parse(JSON.parse(readFileSync(file, "utf8"))).categories.map((category) => category.key);
}

export const MAP_PLACE_CATEGORIES: readonly string[] = loadMapPlaceCategories();

/** Largest bounding box a client may ask for, in degrees on each side (about 110 km). */
export const MAX_BBOX_SPAN_DEGREES = 1.0;
export const DEFAULT_PLACE_LIMIT = 200;
export const MAX_PLACE_LIMIT = 500;
/** Rows read before ranking by distance to the centre of the box. */
export const PLACE_SCAN_CAP = 3000;
export const PLACE_REPORT_REASONS = ["closed", "wrong_location", "wrong_info", "not_exists", "other"] as const;

export type Bbox = { south: number; west: number; north: number; east: number };

/** `south,west,north,east` in degrees, inside the service area and no larger than the span limit. */
export const bboxSchema = z
  .string()
  .transform((value, ctx) => {
    const parts = value.split(",").map((part) => Number(part.trim()));
    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
      ctx.addIssue({ code: "custom", message: "bbox must be south,west,north,east" });
      return z.NEVER;
    }
    const [south, west, north, east] = parts as [number, number, number, number];
    if (south >= north || west >= east || south < 29 || north > 34 || west < 34 || east > 36.5) {
      ctx.addIssue({ code: "custom", message: "bbox is outside the service area" });
      return z.NEVER;
    }
    if (north - south > MAX_BBOX_SPAN_DEGREES || east - west > MAX_BBOX_SPAN_DEGREES) {
      ctx.addIssue({ code: "custom", message: "bbox is too large" });
      return z.NEVER;
    }
    return { south, west, north, east } satisfies Bbox;
  });

export const categoriesQuerySchema = z
  .string()
  .transform((value) => [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))])
  .refine((list) => list.length > 0 && list.length <= 20 && list.every((key) => MAP_PLACE_CATEGORIES.includes(key)), "unknown category");

type PlaceRow = {
  id: string;
  category: string;
  name_ar: string | null;
  name_en: string | null;
  latitude: { toString(): string } | number;
  longitude: { toString(): string } | number;
  phone: string | null;
  opening_hours: string | null;
};

const num = (value: { toString(): string } | number) => Number(value.toString());

/** What the apps receive. Nothing about who edited a row or where it came from. */
export function serializePlace(row: PlaceRow) {
  return {
    id: row.id,
    category: row.category,
    name_ar: row.name_ar,
    name_en: row.name_en,
    lat: num(row.latitude),
    lng: num(row.longitude),
    phone: row.phone,
    opening_hours: row.opening_hours
  };
}

export type PublicPlace = ReturnType<typeof serializePlace>;

/** Squared distance in degrees, longitude scaled by latitude: enough to rank nearby rows. */
function rankDistance(row: PlaceRow, lat: number, lng: number) {
  const dLat = num(row.latitude) - lat;
  const dLng = (num(row.longitude) - lng) * Math.cos((lat * Math.PI) / 180);
  return dLat * dLat + dLng * dLng;
}

/**
 * Active places inside the box, nearest to its centre first, at most [limit]. The
 * answer says when more places matched than were returned, so a client can ask for a
 * smaller box instead of assuming the map is empty there.
 */
export async function findPlaces(
  db: Pick<PrismaClient, "mapPlace">,
  input: { bbox: Bbox; categories?: string[]; limit: number }
) {
  const { bbox, categories, limit } = input;
  const where: Prisma.MapPlaceWhereInput = {
    active: true,
    latitude: { gte: bbox.south, lte: bbox.north },
    longitude: { gte: bbox.west, lte: bbox.east },
    ...(categories && categories.length > 0 ? { category: { in: categories } } : {})
  };
  const rows = await db.mapPlace.findMany({ where, take: PLACE_SCAN_CAP + 1 });
  const scanTruncated = rows.length > PLACE_SCAN_CAP;
  const centreLat = (bbox.south + bbox.north) / 2;
  const centreLng = (bbox.west + bbox.east) / 2;
  const ranked = rows
    .slice(0, PLACE_SCAN_CAP)
    .map((row) => ({ row, distance: rankDistance(row, centreLat, centreLng) }))
    .sort((a, b) => a.distance - b.distance || a.row.id.localeCompare(b.row.id));
  return {
    places: ranked.slice(0, limit).map((entry) => serializePlace(entry.row)),
    truncated: scanTruncated || ranked.length > limit
  };
}

// ----- importer ---------------------------------------------------------------------------

const importPlaceSchema = z.object({
  id: z.string().regex(/^(node|way|relation)\/\d+$/),
  c: z.string().refine((key) => MAP_PLACE_CATEGORIES.includes(key), "unknown category"),
  ar: z.string().max(191).nullable(),
  en: z.string().max(191).nullable(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  ph: z.string().max(40).nullable(),
  oh: z.string().max(500).nullable(),
  city: z.string().max(40).nullable()
});

const importFileSchema = z.object({ places: z.array(importPlaceSchema) });
export type ImportPlace = z.infer<typeof importPlaceSchema>;

export function loadPlacesFile(file = OSM_PLACES_FILE): ImportPlace[] {
  return importFileSchema.parse(JSON.parse(readFileSync(file, "utf8"))).places;
}

type ExistingRow = {
  id: string;
  osm_id: string | null;
  category: string;
  name_ar: string | null;
  name_en: string | null;
  latitude: { toString(): string } | number;
  longitude: { toString(): string } | number;
  phone: string | null;
  opening_hours: string | null;
  city: string | null;
  active: boolean;
  admin_edited: boolean;
};

const BATCH = 500;

export type ImportResult = { created: number; updated: number; unchanged: number; skipped_admin_edited: number; deactivated: number };

/**
 * Loads the extract into `map_places`, keyed by OSM id. New places are added, places
 * whose OSM data changed are updated, and a row an admin has touched is never
 * overwritten. Places missing from a newer extract are only switched off when
 * [deactivateMissing] is set, so a partial extract cannot empty the map.
 */
export async function importPlaces(
  db: Pick<PrismaClient, "mapPlace">,
  places: ImportPlace[],
  options: { deactivateMissing?: boolean; dryRun?: boolean } = {}
): Promise<ImportResult> {
  const existing = (await db.mapPlace.findMany({ where: { osm_id: { not: null } } })) as ExistingRow[];
  const byOsm = new Map(existing.map((row) => [row.osm_id as string, row]));
  const result: ImportResult = { created: 0, updated: 0, unchanged: 0, skipped_admin_edited: 0, deactivated: 0 };
  const toCreate: Prisma.MapPlaceCreateManyInput[] = [];
  const seen = new Set<string>();

  for (const place of places) {
    seen.add(place.id);
    const row = byOsm.get(place.id);
    if (!row) {
      toCreate.push({
        category: place.c,
        name_ar: place.ar,
        name_en: place.en,
        latitude: place.lat,
        longitude: place.lng,
        phone: place.ph,
        opening_hours: place.oh,
        city: place.city,
        source: "osm",
        osm_id: place.id
      });
      result.created += 1;
      continue;
    }
    if (row.admin_edited) {
      result.skipped_admin_edited += 1;
      continue;
    }
    const same =
      row.category === place.c &&
      row.name_ar === place.ar &&
      row.name_en === place.en &&
      num(row.latitude) === place.lat &&
      num(row.longitude) === place.lng &&
      row.phone === place.ph &&
      row.opening_hours === place.oh &&
      row.city === place.city;
    if (same) {
      result.unchanged += 1;
      continue;
    }
    result.updated += 1;
    if (!options.dryRun) {
      await db.mapPlace.update({
        where: { id: row.id },
        data: {
          category: place.c,
          name_ar: place.ar,
          name_en: place.en,
          latitude: place.lat,
          longitude: place.lng,
          phone: place.ph,
          opening_hours: place.oh,
          city: place.city
        }
      });
    }
  }

  if (!options.dryRun) {
    for (let index = 0; index < toCreate.length; index += BATCH) {
      await db.mapPlace.createMany({ data: toCreate.slice(index, index + BATCH), skipDuplicates: true });
    }
  }

  if (options.deactivateMissing) {
    const missing = existing.filter((row) => row.active && !row.admin_edited && !seen.has(row.osm_id as string));
    result.deactivated = missing.length;
    if (!options.dryRun && missing.length > 0) {
      for (let index = 0; index < missing.length; index += BATCH) {
        await db.mapPlace.updateMany({ where: { id: { in: missing.slice(index, index + BATCH).map((row) => row.id) } }, data: { active: false } });
      }
    }
  }
  return result;
}
