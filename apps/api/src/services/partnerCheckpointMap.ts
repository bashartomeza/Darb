import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { LimitedCheckpointDirectory, PartnerTimestamp } from "./limitedCheckpointDirectory.js";

/**
 * Places AweenRayeh partner checkpoints on the map.
 *
 * The partner feed has names, cities and "last changed" times only: no
 * coordinates and no open/closed state. Positions come from a committed
 * OpenStreetMap extract (`apps/api/data/osm-checkpoints.json`, ODbL), matched by
 * normalised Arabic name. A row that does not match exactly one place is
 * returned in `unplaced`, never given a guessed position. Official traffic
 * state stays `unknown` because the partner does not publish one.
 */

const osmEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  name_ar: z.string().nullable(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});
const osmFileSchema = z.object({
  source: z.string(),
  licence: z.string(),
  attribution: z.string(),
  fetched_at: z.string(),
  checkpoints: z.array(osmEntrySchema)
});
export type OsmCheckpointFile = z.infer<typeof osmFileSchema>;
export type OsmCheckpoint = z.infer<typeof osmEntrySchema>;

export const OSM_CHECKPOINTS_FILE = fileURLToPath(new URL("../../data/osm-checkpoints.json", import.meta.url));

export function loadOsmCheckpoints(file = OSM_CHECKPOINTS_FILE): OsmCheckpointFile {
  return osmFileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** Words that describe the kind of place rather than name it (stored normalised). */
const GENERIC_WORDS = new Set(
  ["حاجز", "نقطة", "تفتيش", "معبر", "العسكري", "العسكرية", "الإسرائيلي", "الإسرائيلية", "بوابة", "مدخل"].map(unifyLetters)
);

function unifyLetters(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[ً-ٰٟۖ-ۭـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ئ/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

/**
 * Normalises an Arabic checkpoint name for matching: removes diacritics and
 * tatweel, unifies alef/hamza/ya/ta-marbuta spellings, maps Arabic-Indic digits,
 * drops punctuation and generic words such as "حاجز".
 */
export function normaliseArabicName(value: string): string {
  const unified = unifyLetters(value).replace(/[^ء-ي0-9\s]/g, " ");
  return unified
    .split(/\s+/)
    .filter((word) => word && !GENERIC_WORDS.has(word))
    .join(" ");
}

/** Arabic names an OSM entry is known by. Mixed-script names keep their Arabic part. */
export function osmArabicNames(entry: Pick<OsmCheckpoint, "name" | "name_ar">): string[] {
  const names = new Set<string>();
  for (const raw of [entry.name_ar, entry.name]) {
    if (!raw) continue;
    for (const part of raw.split(/[\/\-–|،,]/)) {
      const arabic = part.match(/[؀-ۿ][؀-ۿ\s]*/g)?.join(" ") ?? "";
      const name = normaliseArabicName(arabic);
      if (name) names.add(name);
    }
  }
  return [...names];
}

/**
 * City centres, used only to choose between same-named places and to reject a
 * match that is clearly in another city. They are never used as a pin.
 */
const CITY_CENTRES: Record<string, { lat: number; lng: number }> = {
  [normaliseArabicName("الخليل")]: { lat: 31.5326, lng: 35.0998 },
  [normaliseArabicName("بيت لحم")]: { lat: 31.7054, lng: 35.2024 },
  [normaliseArabicName("القدس")]: { lat: 31.7683, lng: 35.2137 },
  [normaliseArabicName("رام الله")]: { lat: 31.9038, lng: 35.2034 },
  [normaliseArabicName("نابلس")]: { lat: 32.2211, lng: 35.2544 },
  [normaliseArabicName("جنين")]: { lat: 32.4637, lng: 35.2938 },
  [normaliseArabicName("طولكرم")]: { lat: 32.3104, lng: 35.0286 },
  [normaliseArabicName("قلقيلية")]: { lat: 32.1896, lng: 34.9706 },
  [normaliseArabicName("سلفيت")]: { lat: 32.0849, lng: 35.1806 },
  [normaliseArabicName("طوباس")]: { lat: 32.3209, lng: 35.3699 },
  [normaliseArabicName("أريحا")]: { lat: 31.8611, lng: 35.46 }
};
/** A match further than this from its city centre is treated as another place. */
export const MAX_CITY_DISTANCE_KM = 40;
/** OSM often maps one checkpoint as several nodes; closer than this is one place. */
const SAME_PLACE_KM = 1;

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export type OsmMatch = { entry: OsmCheckpoint } | { entry: null; reason: "no_name_match" | "ambiguous" | "outside_city" };

export class OsmCheckpointIndex {
  private readonly byName = new Map<string, OsmCheckpoint[]>();

  constructor(entries: OsmCheckpoint[]) {
    for (const entry of entries) {
      for (const name of osmArabicNames(entry)) {
        const list = this.byName.get(name) ?? [];
        list.push(entry);
        this.byName.set(name, list);
      }
    }
  }

  match(name: string, city?: string | null): OsmMatch {
    // "المعرجات-كرملو": try the whole name, then each alternative on its own.
    const keys = [name, ...name.split(/[\/\-–|،,]/)].map(normaliseArabicName).filter(Boolean);
    const seen = new Set<string>();
    const candidates: OsmCheckpoint[] = [];
    for (const key of keys) {
      for (const entry of this.byName.get(key) ?? []) {
        if (!seen.has(entry.id)) {
          seen.add(entry.id);
          candidates.push(entry);
        }
      }
    }
    if (candidates.length === 0) return { entry: null, reason: "no_name_match" };
    // "أريحا - طوباس" names two cities; a place near either one is in the area.
    const centres = (city ?? "")
      .split(/[\/\-–|،,]/)
      .map((part) => CITY_CENTRES[normaliseArabicName(part)])
      .filter((centre): centre is { lat: number; lng: number } => centre !== undefined);
    const cityDistance = (c: OsmCheckpoint) => Math.min(...centres.map((centre) => distanceKm(c, centre)));
    const near = centres.length ? candidates.filter((c) => cityDistance(c) <= MAX_CITY_DISTANCE_KM) : candidates;
    if (near.length === 0) return { entry: null, reason: "outside_city" };
    const ordered = centres.length ? [...near].sort((a, b) => cityDistance(a) - cityDistance(b)) : near;
    const first = ordered[0]!;
    // Several far-apart places share the name and nothing decides between them.
    if (ordered.some((c) => distanceKm(c, first) > SAME_PLACE_KM)) {
      return { entry: null, reason: "ambiguous" };
    }
    return { entry: first };
  }
}

export type PartnerMapCheckpoint = {
  id: string;
  name_ar: string;
  name_en: null;
  city: string;
  latitude: number;
  longitude: number;
  status: "unknown";
  updated_at: null;
  entering_status_last_updated: string;
  leaving_status_last_updated: string;
  timezone_specified: boolean;
  position_source: "openstreetmap";
  position_osm_id: string;
};
export type PartnerUnplacedCheckpoint = {
  id: string;
  name_ar: string;
  city: string;
  entering_status_last_updated: string;
  leaving_status_last_updated: string;
  timezone_specified: boolean;
  reason: "no_name_match" | "ambiguous" | "outside_city";
};

const tzSpecified = (a: PartnerTimestamp, b: PartnerTimestamp) => a.timezone_specified && b.timezone_specified;

export function placePartnerCheckpoints(directory: LimitedCheckpointDirectory, index: OsmCheckpointIndex, osm: Pick<OsmCheckpointFile, "attribution" | "licence" | "fetched_at">) {
  const checkpoints: PartnerMapCheckpoint[] = [];
  const unplaced: PartnerUnplacedCheckpoint[] = [];
  for (const row of directory.checkpoints) {
    const match = index.match(row.checkpoint_name_ar, row.city_ar);
    const base = {
      id: `aweenrayeh:${row.provider_checkpoint_id}`,
      name_ar: row.checkpoint_name_ar,
      city: row.city_ar,
      entering_status_last_updated: row.entering_status_last_updated.raw,
      leaving_status_last_updated: row.leaving_status_last_updated.raw,
      timezone_specified: tzSpecified(row.entering_status_last_updated, row.leaving_status_last_updated)
    };
    if (match.entry) {
      checkpoints.push({
        ...base,
        name_en: null,
        latitude: match.entry.lat,
        longitude: match.entry.lng,
        // The partner publishes no traffic state; it is never inferred from a time.
        status: "unknown",
        updated_at: null,
        position_source: "openstreetmap",
        position_osm_id: match.entry.id
      });
    } else {
      unplaced.push({ ...base, reason: match.reason });
    }
  }
  return {
    source: "aweenrayeh_partner" as const,
    checkpoints,
    unplaced,
    fetched_at: directory.fetched_at,
    stale: false,
    position_attribution: osm.attribution,
    position_licence: osm.licence,
    positions_fetched_at: osm.fetched_at
  };
}

export class PartnerCheckpointMapService {
  private readonly index: OsmCheckpointIndex;
  constructor(
    private readonly directory: { list(): Promise<LimitedCheckpointDirectory> },
    private readonly osm: OsmCheckpointFile = loadOsmCheckpoints()
  ) {
    this.index = new OsmCheckpointIndex(osm.checkpoints);
  }

  async list() {
    return placePartnerCheckpoints(await this.directory.list(), this.index, this.osm);
  }
}
