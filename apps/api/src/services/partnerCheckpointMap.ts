import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { LimitedCheckpointDirectory, PartnerTimestamp } from "./limitedCheckpointDirectory.js";

/**
 * Places AweenRayeh partner checkpoints on the map.
 *
 * The partner feed has names, cities, the entering/leaving state ("سالك",
 * "مغلق", "أزمة متوسطة", "أزمة خانقة") and when each last changed, but no
 * coordinates. A position comes first from the researched positions kept in the
 * database (`checkpoint_positions`, keyed by the partner's city and name), then
 * from a committed OpenStreetMap extract (`apps/api/data/osm-checkpoints.json`,
 * ODbL) matched by normalised Arabic name. A row with neither is returned in
 * `unplaced`, never given a guessed position. A state the feed leaves out or words
 * differently stays `unknown`; it is never inferred from a time.
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

/** Drops the definite article from each word ("الجبع" -> "جبع"). */
export function withoutArticle(name: string): string {
  return name
    .split(" ")
    .map((word) => (word.length > 3 && word.startsWith("ال") ? word.slice(2) : word))
    .join(" ");
}

/**
 * Consonant skeleton for spelling variants of the same name, which Arabic
 * transliterations write with or without long vowels ("الكونتينر" /
 * "الكونتينار", "شومرون" / "شمرون", "دير" / "ديار"). The first letter of each
 * word is kept. Too-short skeletons are not used: they would match unrelated
 * places.
 */
export function nameSkeleton(name: string): string | null {
  const skeleton = withoutArticle(name)
    .split(" ")
    .map((word) => word.slice(0, 1) + word.slice(1).replace(/[اوي]/g, ""))
    .join(" ");
  return skeleton.replace(/\s/g, "").length >= 4 ? skeleton : null;
}

export type MatchQuality = "exact" | "article" | "spelling_variant";
export type OsmMatch =
  | { entry: OsmCheckpoint; quality: MatchQuality }
  | { entry: null; reason: "no_name_match" | "ambiguous" | "outside_city" };

type Centre = { lat: number; lng: number };

export class OsmCheckpointIndex {
  private readonly tiers: Array<{ quality: MatchQuality; key: (name: string) => string | null; byKey: Map<string, OsmCheckpoint[]> }> = [
    { quality: "exact", key: (name) => name, byKey: new Map() },
    { quality: "article", key: withoutArticle, byKey: new Map() },
    { quality: "spelling_variant", key: nameSkeleton, byKey: new Map() }
  ];

  constructor(entries: OsmCheckpoint[]) {
    for (const entry of entries) {
      for (const name of osmArabicNames(entry)) {
        for (const tier of this.tiers) {
          const key = tier.key(name);
          if (!key) continue;
          const list = tier.byKey.get(key) ?? [];
          if (!list.includes(entry)) list.push(entry);
          tier.byKey.set(key, list);
        }
      }
    }
  }

  /**
   * Finds the single OSM place for a partner name: exact normalised name
   * first, then without the article, then a spelling variant. Each tier must
   * give one place (nodes within 1 km count as one) near the row's city.
   */
  match(name: string, city?: string | null): OsmMatch {
    // "المعرجات-كرملو": try the whole name, then each alternative on its own.
    const names = [name, ...name.split(/[\/\-–|،,()]/)].map(normaliseArabicName).filter(Boolean);
    // "أريحا - طوباس" names two cities; a place near either one is in the area.
    const centres = (city ?? "")
      .split(/[\/\-–|،,]/)
      .map((part) => CITY_CENTRES[normaliseArabicName(part)])
      .filter((centre): centre is Centre => centre !== undefined);
    const cityDistance = (c: OsmCheckpoint) => Math.min(...centres.map((centre) => distanceKm(c, centre)));

    let sawFar = false;
    for (const tier of this.tiers) {
      const candidates: OsmCheckpoint[] = [];
      for (const value of names) {
        const key = tier.key(value);
        for (const entry of (key && tier.byKey.get(key)) || []) {
          if (!candidates.includes(entry)) candidates.push(entry);
        }
      }
      if (candidates.length === 0) continue;
      const near = centres.length ? candidates.filter((c) => cityDistance(c) <= MAX_CITY_DISTANCE_KM) : candidates;
      if (near.length === 0) {
        sawFar = true;
        continue;
      }
      const ordered = centres.length ? [...near].sort((a, b) => cityDistance(a) - cityDistance(b)) : near;
      const first = ordered[0]!;
      // Several far-apart places share the name and nothing decides between them.
      if (ordered.some((c) => distanceKm(c, first) > SAME_PLACE_KM)) {
        return { entry: null, reason: "ambiguous" };
      }
      return { entry: first, quality: tier.quality };
    }
    return { entry: null, reason: sawFar ? "outside_city" : "no_name_match" };
  }
}

export type PartnerTrafficStatus = "open" | "congested" | "closed" | "unknown";

/** One direction's provider text as a state. Unrecognised wording is `unknown`. */
export function partnerDirectionStatus(value: string | null): PartnerTrafficStatus {
  const text = value ? unifyLetters(value).trim() : "";
  if (text === "سالك" || text === "سالكه" || text === "مفتوح" || text === "مفتوحه") return "open";
  if (text === "مغلق" || text === "مغلقه") return "closed";
  if (text.startsWith("ازمه") || text.startsWith("ازدحام") || text === "مزدحم") return "congested";
  return "unknown";
}

/** Worst direction wins; "open" only when both directions are open. */
export function partnerOverallStatus(entering: string | null, leaving: string | null): PartnerTrafficStatus {
  const both = [partnerDirectionStatus(entering), partnerDirectionStatus(leaving)];
  if (both.includes("closed")) return "closed";
  if (both.includes("congested")) return "congested";
  return both.every((s) => s === "open") ? "open" : "unknown";
}

type PartnerStatusFields = {
  status: PartnerTrafficStatus;
  entering_status: string | null;
  leaving_status: string | null;
  entering_status_last_updated: string;
  leaving_status_last_updated: string;
  timezone_specified: boolean;
};

export type CheckpointPositionConfidence = "high" | "medium" | "low" | "unverified";

/** A researched position from `checkpoint_positions`. */
export type ResearchedCheckpointPosition = {
  city_ar: string;
  name_ar: string;
  latitude: number;
  longitude: number;
  confidence: CheckpointPositionConfidence;
};

export interface CheckpointPositionStore {
  list(): Promise<ResearchedCheckpointPosition[]>;
}

/** Reads `checkpoint_positions`. Prisma is loaded on first use, so tests without a database never touch it. */
export function createPrismaCheckpointPositionStore(): CheckpointPositionStore {
  return {
    async list() {
      const { prisma } = await import("../lib/prisma.js");
      const rows = await prisma.checkpointPosition.findMany({
        select: { city_ar: true, name_ar: true, latitude: true, longitude: true, confidence: true }
      });
      return rows.map((row) => ({ ...row, latitude: Number(row.latitude), longitude: Number(row.longitude) }));
    }
  };
}

/** Same partner row, whatever the spacing or alef/hamza/ta-marbuta spelling. */
export function checkpointPositionKey(city: string, name: string): string {
  const clean = (value: string) => unifyLetters(value).replace(/\s+/g, " ").trim();
  return `${clean(city)}|${clean(name)}`;
}

type PlacedBase = {
  id: string;
  name_ar: string;
  name_en: null;
  city: string;
  latitude: number;
  longitude: number;
  updated_at: null;
};

export type PartnerMapCheckpoint = PartnerStatusFields & PlacedBase & (
  | {
      position_source: "openstreetmap";
      position_osm_id: string;
      /** How the name matched: exactly, without "ال", or as a spelling variant. */
      position_match: MatchQuality;
    }
  | {
      position_source: "darb_research";
      position_confidence: CheckpointPositionConfidence;
      /** Low or unverified: the pin may be off by a gate or more, and the apps say so. */
      position_approximate: boolean;
    }
);
export type PartnerUnplacedCheckpoint = PartnerStatusFields & {
  id: string;
  name_ar: string;
  city: string;
  reason: "no_name_match" | "ambiguous" | "outside_city";
};

const tzSpecified = (a: PartnerTimestamp, b: PartnerTimestamp) => a.timezone_specified && b.timezone_specified;

export function placePartnerCheckpoints(
  directory: LimitedCheckpointDirectory,
  index: OsmCheckpointIndex,
  osm: Pick<OsmCheckpointFile, "attribution" | "licence" | "fetched_at">,
  researched: ResearchedCheckpointPosition[] = []
) {
  const checkpoints: PartnerMapCheckpoint[] = [];
  const unplaced: PartnerUnplacedCheckpoint[] = [];
  const byKey = new Map(researched.map((position) => [checkpointPositionKey(position.city_ar, position.name_ar), position]));
  for (const row of directory.checkpoints) {
    const position = byKey.get(checkpointPositionKey(row.city_ar, row.checkpoint_name_ar));
    const base = {
      id: `aweenrayeh:${row.provider_checkpoint_id}`,
      name_ar: row.checkpoint_name_ar,
      city: row.city_ar,
      status: partnerOverallStatus(row.entering_status, row.leaving_status),
      entering_status: row.entering_status,
      leaving_status: row.leaving_status,
      entering_status_last_updated: row.entering_status_last_updated.raw,
      leaving_status_last_updated: row.leaving_status_last_updated.raw,
      timezone_specified: tzSpecified(row.entering_status_last_updated, row.leaving_status_last_updated)
    };
    if (position) {
      checkpoints.push({
        ...base,
        name_en: null,
        latitude: position.latitude,
        longitude: position.longitude,
        updated_at: null,
        position_source: "darb_research",
        position_confidence: position.confidence,
        position_approximate: position.confidence === "low" || position.confidence === "unverified"
      });
      continue;
    }
    const match = index.match(row.checkpoint_name_ar, row.city_ar);
    if (match.entry) {
      checkpoints.push({
        ...base,
        name_en: null,
        latitude: match.entry.lat,
        longitude: match.entry.lng,
        updated_at: null,
        position_source: "openstreetmap",
        position_osm_id: match.entry.id,
        position_match: match.quality
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
    private readonly osm: OsmCheckpointFile = loadOsmCheckpoints(),
    private readonly positions: CheckpointPositionStore = createPrismaCheckpointPositionStore()
  ) {
    this.index = new OsmCheckpointIndex(osm.checkpoints);
  }

  async list() {
    const directory = await this.directory.list();
    // A database hiccup must not empty the map: fall back to the OpenStreetMap matches.
    const researched = await this.positions.list().catch(() => []);
    return placePartnerCheckpoints(directory, this.index, this.osm, researched);
  }
}
