// Builds apps/api/data/osm-checkpoints.json from OpenStreetMap (ODbL).
//
//   node scripts/checkpoints/fetch-osm-checkpoints.mjs [--out <file>]
//
// Queries the public Overpass API for barrier=checkpoint and military=checkpoint
// features inside the West Bank bounding box and keeps only the id, name, Arabic
// name and position of each one. Nothing is invented: features without a usable
// position are dropped. Public Overpass servers are often busy, so each server is
// tried in turn with exponential backoff.
//
// Data (c) OpenStreetMap contributors, available under the Open Database Licence:
// https://www.openstreetmap.org/copyright
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const BBOX = { south: 31.2, west: 34.85, north: 32.6, east: 35.6 };
export const SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];

export function overpassQuery(bbox = BBOX) {
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return `[out:json][timeout:90];
(
  nwr["barrier"="checkpoint"](${box});
  nwr["military"="checkpoint"](${box});
);
out center tags;`;
}

const finite = (value) => typeof value === "number" && Number.isFinite(value);

/** Keeps only id/name/name:ar/lat/lng for elements that carry a real position. */
export function reduceOverpass(payload, bbox = BBOX) {
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];
  const seen = new Set();
  const out = [];
  for (const element of elements) {
    const lat = finite(element.lat) ? element.lat : element.center?.lat;
    const lng = finite(element.lon) ? element.lon : element.center?.lon;
    if (!finite(lat) || !finite(lng)) continue;
    if (lat < bbox.south || lat > bbox.north || lng < bbox.west || lng > bbox.east) continue;
    const id = `${element.type}/${element.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const tags = element.tags ?? {};
    const name = typeof tags.name === "string" ? tags.name.trim() : "";
    const nameAr = typeof tags["name:ar"] === "string" ? tags["name:ar"].trim() : "";
    out.push({ id, name: name || null, name_ar: nameAr || null, lat: Number(lat.toFixed(7)), lng: Number(lng.toFixed(7)) });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function fetchFrom(server, query, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(server, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "darb-checkpoint-import/1.0" },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCheckpoints({ servers = SERVERS, attempts = 3, timeoutMs = 120_000, log = console.error } = {}) {
  const query = overpassQuery();
  let lastError;
  for (let round = 0; round < attempts; round++) {
    for (const server of servers) {
      try {
        log(`Querying ${server} (attempt ${round + 1}/${attempts})...`);
        return { server, payload: await fetchFrom(server, query, timeoutMs) };
      } catch (error) {
        lastError = error;
        log(`  failed: ${error instanceof Error ? error.message : error}`);
      }
    }
    await sleep(5_000 * 2 ** round);
  }
  throw new Error(`Every Overpass server failed: ${lastError instanceof Error ? lastError.message : lastError}`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("fetch-osm-checkpoints.mjs")) {
  const outIndex = process.argv.indexOf("--out");
  const out = resolve(outIndex > 0 ? process.argv[outIndex + 1] : resolve(import.meta.dirname, "../../apps/api/data/osm-checkpoints.json"));
  const { server, payload } = await fetchCheckpoints();
  const checkpoints = reduceOverpass(payload);
  const file = {
    schema_version: 1,
    source: "OpenStreetMap via the Overpass API",
    source_server: server,
    licence: "ODbL-1.0",
    attribution: "© OpenStreetMap contributors",
    licence_url: "https://www.openstreetmap.org/copyright",
    fetched_at: new Date().toISOString(),
    query: "nwr[barrier=checkpoint] + nwr[military=checkpoint]",
    bbox: BBOX,
    count: checkpoints.length,
    checkpoints
  };
  writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`Wrote ${checkpoints.length} checkpoints to ${out}`);
}
