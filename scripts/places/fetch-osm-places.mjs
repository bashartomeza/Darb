// Builds apps/api/data/osm-places.json from OpenStreetMap (ODbL).
//
//   node scripts/places/fetch-osm-places.mjs [--out <file>] [--cache-dir <dir>]
//
// Offline research/import tool: the phones never call Overpass. For each category in
// apps/api/data/map-place-categories.json it asks a public Overpass server for the
// matching features inside the bounding box of the West Bank, keeps the ones inside the OSM West Bank
// boundary (relation 1613659, fetched once and tested locally; a server-side area filter times out on the
// public servers) and
// ones within CITY_RADIUS_KM of one of the ten cities the predefined routes join, and
// writes one line per place. Nothing is invented: features without a position are
// dropped, and unnamed features are kept only for categories where a name is not what
// people look for (a fuel station or an ATM). Public Overpass servers are often busy,
// so each server is tried in turn with exponential backoff.
//
// Load the result into the database with `npm run places:import -w apps/api`
// (docs/maps/places.md).
//
// Data (c) OpenStreetMap contributors, available under the Open Database Licence:
// https://www.openstreetmap.org/copyright
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const BBOX = { south: 31.2, west: 34.85, north: 32.6, east: 35.6 };
export const CITY_RADIUS_KM = 30;
/** The OSM "West Bank" boundary relation. */
export const WEST_BANK_RELATION_ID = 1613659;
export const SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];

/** The ten cities of the predefined routes (same list as the API's PREDEFINED_CITIES). */
export const CITIES = [
  { slug: "hebron", name_ar: "الخليل", name_en: "Hebron", lat: 31.5326, lng: 35.0998 },
  { slug: "bethlehem", name_ar: "بيت لحم", name_en: "Bethlehem", lat: 31.7054, lng: 35.2024 },
  { slug: "ramallah", name_ar: "رام الله", name_en: "Ramallah", lat: 31.9038, lng: 35.2034 },
  { slug: "nablus", name_ar: "نابلس", name_en: "Nablus", lat: 32.2211, lng: 35.2544 },
  { slug: "jenin", name_ar: "جنين", name_en: "Jenin", lat: 32.4637, lng: 35.2938 },
  { slug: "tulkarm", name_ar: "طولكرم", name_en: "Tulkarm", lat: 32.3104, lng: 35.0286 },
  { slug: "qalqilya", name_ar: "قلقيلية", name_en: "Qalqilya", lat: 32.1896, lng: 34.9706 },
  { slug: "jericho", name_ar: "أريحا", name_en: "Jericho", lat: 31.8611, lng: 35.46 },
  { slug: "salfit", name_ar: "سلفيت", name_en: "Salfit", lat: 32.0849, lng: 35.1806 },
  { slug: "tubas", name_ar: "طوباس", name_en: "Tubas", lat: 32.3209, lng: 35.3699 }
];

/** Categories where an unnamed feature is still useful on the road. */
export const UNNAMED_OK = new Set(["fuel", "atm", "rest_stop", "ev_charging"]);

export function loadCategories(file = resolve(import.meta.dirname, "../../apps/api/data/map-place-categories.json")) {
  return JSON.parse(readFileSync(file, "utf8")).categories;
}

const tagSelector = ([key, value]) => `["${key}"="${value}"]`;

export function overpassQuery(category, bbox = BBOX) {
  const bboxText = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const lines = category.osm.map((alternative) => `  nwr${alternative.map(tagSelector).join("")}(${bboxText});`);
  return `[out:json][timeout:180];
(
${lines.join("\n")}
);
out center tags;`;
}

/** The query for the West Bank boundary relation, with geometry. */
export const BOUNDARY_QUERY = `[out:json][timeout:120];rel(${WEST_BANK_RELATION_ID});out geom;`;

/**
 * Joins the boundary relation's way members (outer and inner) into closed rings of [lng, lat] points. Ways are
 * chained end to end; a relation whose ways do not close is rejected rather than guessed at.
 */
export function boundaryRings(payload) {
  const relation = payload?.elements?.find((element) => element.type === "relation");
  if (!relation) throw new Error("boundary relation missing from the answer");
  const pending = (relation.members ?? [])
    .filter((member) => member.type === "way" && Array.isArray(member.geometry) && member.geometry.length > 1 && (member.role === "outer" || member.role === "inner"))
    .map((member) => member.geometry.map((point) => [point.lon, point.lat]));
  const same = (p, q) => p[0] === q[0] && p[1] === q[1];
  const rings = [];
  while (pending.length > 0) {
    let ring = pending.shift();
    let progressed = true;
    while (!same(ring[0], ring[ring.length - 1]) && progressed) {
      progressed = false;
      for (let i = 0; i < pending.length; i++) {
        const way = pending[i];
        const end = ring[ring.length - 1];
        if (same(way[0], end)) ring = ring.concat(way.slice(1));
        else if (same(way[way.length - 1], end)) ring = ring.concat(way.slice(0, -1).reverse());
        else continue;
        pending.splice(i, 1);
        progressed = true;
        break;
      }
    }
    if (!same(ring[0], ring[ring.length - 1])) throw new Error("boundary ring does not close");
    rings.push(ring);
  }
  if (rings.length === 0) throw new Error("boundary has no rings");
  return rings;
}

/** Even-odd test over all rings, so inner rings (enclaves) are holes. */
export function insideRings(rings, lat, lng) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const toRad = (degrees) => (degrees * Math.PI) / 180;

export function distanceKm(aLat, aLng, bLat, bLng) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** The nearest covered city and its distance. */
export function nearestCity(lat, lng) {
  let best = null;
  for (const city of CITIES) {
    const km = distanceKm(lat, lng, city.lat, city.lng);
    if (!best || km < best.km) best = { city, km };
  }
  return best;
}

const clean = (value, max) => {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
};

function firstPhone(tags) {
  const raw = clean(tags.phone ?? tags["contact:phone"] ?? tags["phone:mobile"] ?? tags["contact:mobile"], 120);
  if (!raw) return null;
  const first = raw.split(/[;,]/)[0].trim();
  return /^[+\d][\d\s().-]{4,30}$/.test(first) ? first : null;
}

/** Keeps only the fields the app uses, for elements with a position, inside the radius, once each. */
export function reduceOverpass(payload, categoryKey, { seen = new Set(), bbox = BBOX, rings = null } = {}) {
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];
  const out = [];
  for (const element of elements) {
    const lat = finite(element.lat) ? element.lat : element.center?.lat;
    const lng = finite(element.lon) ? element.lon : element.center?.lon;
    if (!finite(lat) || !finite(lng)) continue;
    if (lat < bbox.south || lat > bbox.north || lng < bbox.west || lng > bbox.east) continue;
    const id = `${element.type}/${element.id}`;
    if (seen.has(id)) continue;
    const tags = element.tags ?? {};
    // Out-of-service features are not worth a stop.
    if (tags["disused"] === "yes" || tags["abandoned"] === "yes" || tags["access"] === "private") continue;
    const nameAr = clean(tags["name:ar"], 191);
    const nameEn = clean(tags["name:en"], 191);
    const name = clean(tags.name, 191);
    // `name` is Arabic in most of the West Bank data; use it for Arabic when name:ar is missing and it contains Arabic letters.
    const arabic = nameAr ?? (name && /[؀-ۿ]/.test(name) ? name : null);
    const latin = nameEn ?? (name && !/[؀-ۿ]/.test(name) ? name : null);
    if (!arabic && !latin && !UNNAMED_OK.has(categoryKey)) continue;
    if (rings && !insideRings(rings, lat, lng)) continue;
    const near = nearestCity(lat, lng);
    if (!near || near.km > CITY_RADIUS_KM) continue;
    seen.add(id);
    out.push({
      id,
      c: categoryKey,
      ar: arabic,
      en: latin,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      ph: firstPhone(tags),
      oh: clean(tags.opening_hours, 500),
      city: near.city.slug
    });
  }
  return out;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function fetchFrom(server, query, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(server, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "darb-places-import/1.0 (offline research import)" },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    // Overpass answers 200 with a "remark" (and no elements) when a query ran out of time or memory, and a
    // mirror whose area index is out of date answers an area query with nothing. Neither is a real
    // "there are none"; every category here has places, so an empty answer is retried elsewhere.
    if (payload?.remark) throw new Error(`Overpass remark: ${String(payload.remark).slice(0, 120)}`);
    if (!Array.isArray(payload?.elements) || payload.elements.length === 0) throw new Error("empty answer");
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchQuery(label, query, { servers = SERVERS, attempts = 6, timeoutMs = 240_000, log = console.error } = {}) {
  let lastError;
  for (let round = 0; round < attempts; round++) {
    for (const server of servers) {
      try {
        log(`[${label}] querying ${server} (attempt ${round + 1}/${attempts})...`);
        return { server, payload: await fetchFrom(server, query, timeoutMs) };
      } catch (error) {
        lastError = error;
        log(`  failed: ${error instanceof Error ? error.message : error}`);
      }
    }
    await sleep(Math.min(15_000 * 2 ** round, 240_000));
  }
  throw new Error(`Every Overpass server failed for ${label}: ${lastError instanceof Error ? lastError.message : lastError}`);
}

export const fetchCategory = (category, options) => fetchQuery(category.key, overpassQuery(category), options);

export function summarize(places) {
  const byCategory = {};
  const byCity = {};
  for (const place of places) {
    byCategory[place.c] = (byCategory[place.c] ?? 0) + 1;
    byCity[place.city] = (byCity[place.city] ?? 0) + 1;
  }
  return { by_category: byCategory, by_city: byCity };
}

if (process.argv[1]?.endsWith("fetch-osm-places.mjs")) {
  const outIndex = process.argv.indexOf("--out");
  const out = resolve(outIndex > 0 ? process.argv[outIndex + 1] : resolve(import.meta.dirname, "../../apps/api/data/osm-places.json"));
  // --cache-dir keeps each category's Overpass answer, so a run that is interrupted (public servers
  // are often at capacity) resumes with the categories it still needs.
  const cacheIndex = process.argv.indexOf("--cache-dir");
  const cacheDir = cacheIndex > 0 ? resolve(process.argv[cacheIndex + 1]) : null;
  if (cacheDir) mkdirSync(cacheDir, { recursive: true });
  const cached = async (name, load) => {
    const cacheFile = cacheDir ? resolve(cacheDir, `${name}.json`) : null;
    if (cacheFile && existsSync(cacheFile)) {
      console.error(`[${name}] using cached answer`);
      return JSON.parse(readFileSync(cacheFile, "utf8"));
    }
    const value = await load();
    if (cacheFile) writeFileSync(cacheFile, JSON.stringify(value));
    return value;
  };
  const boundary = await cached("boundary", async () => ({ server: "", payload: (await fetchQuery("boundary", BOUNDARY_QUERY)).payload }));
  const rings = boundaryRings(boundary.payload);
  console.error(`West Bank boundary: ${rings.length} ring(s)`);
  const categories = loadCategories();
  const seen = new Set();
  const places = [];
  let server = "";
  for (const category of categories) {
    const cacheFile = cacheDir ? resolve(cacheDir, `${category.key}.json`) : null;
    let result;
    if (cacheFile && existsSync(cacheFile)) {
      result = JSON.parse(readFileSync(cacheFile, "utf8"));
      console.error(`[${category.key}] using cached answer`);
    } else {
      result = await fetchCategory(category);
      if (cacheFile) writeFileSync(cacheFile, JSON.stringify(result));
    }
    server = result.server;
    const reduced = reduceOverpass(result.payload, category.key, { seen, rings });
    places.push(...reduced);
    console.error(`[${category.key}] kept ${reduced.length}`);
    await sleep(2_000);
  }
  places.sort((a, b) => a.c.localeCompare(b.c) || a.id.localeCompare(b.id, "en", { numeric: true }));
  const header = {
    schema_version: 1,
    source: "OpenStreetMap via the Overpass API",
    source_server: server,
    licence: "ODbL-1.0",
    attribution: "© OpenStreetMap contributors",
    licence_url: "https://www.openstreetmap.org/copyright",
    fetched_at: new Date().toISOString(),
    area: "OSM West Bank boundary (relation 1613659), within " + CITY_RADIUS_KM + " km of the ten route cities",
    count: places.length,
    ...summarize(places)
  };
  // One place per line keeps refresh diffs reviewable.
  const body = places.map((place) => `    ${JSON.stringify(place)}`).join(",\n");
  const head = JSON.stringify(header, null, 2).replace(/\n}$/, "");
  writeFileSync(out, `${head},\n  "places": [\n${body}\n  ]\n}\n`);
  console.log(`Wrote ${places.length} places to ${out}`);
  console.log(JSON.stringify(summarize(places)));
}
