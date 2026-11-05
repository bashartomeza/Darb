#!/usr/bin/env node
// Builds apps/api/data/city-places.json: the villages and towns riders and
// parcel senders pick as pickup / drop-off, per city of the predefined routes.
//
//   node scripts/places/build-city-places.mjs fetch [--out <file>]
//       Downloads OpenStreetMap place nodes inside the West Bank (Overpass API)
//       and picks the best-known places of each city. Needs network access.
//   node scripts/places/build-city-places.mjs sql [--in <file>]
//       Prints the INSERT statement used by the city_places migration.
//
// Selection (documented in docs/routes/city-places.md): every place node is
// assigned to the NEAREST of the ten city centres within 22 km, except for
// Salfit, which uses an explicit list of its governorate's localities (the
// nearest-city rule would otherwise hand them to Ramallah and Nablus and the
// other way round). Per city the town / village nodes are ranked by
// kind (town first), population, Wikipedia presence and distance, and the
// first 24 are kept next to the city centre itself. OpenStreetMap positions
// are village centre points, so every row is flagged approximate.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_FILE = join(root, "apps", "api", "data", "city-places.json");
const MAX_PER_CITY = 24;
const RADIUS_KM = 22;

// Same ten cities and centres as apps/api/src/services/operatingRoutes.ts.
const CITIES = [
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
];

// Localities of the Salfit governorate (by Arabic name) found in OpenStreetMap.
const SALFIT_GOVERNORATE_AR = [
  "بديا", "كفل حارث", "حارس", "إبروقين", "دير إسيتا", "كفر الديك", "قرواة بني حسان", "مردة", "إسكاكا",
  "ياسوف", "جمّاعين", "زيتا جمّاعين", "صرطّه", "فرخة", "خربة قيس", "دير بلوط", "رافات", "الزاوية", "مسحة"
];
// Wrongly matched or duplicate nodes (same name in another governorate).
const SKIP_EN = new Set(["City Center", "Rafat", "Al-Tira", "University Neighborhood", "Ras Al-Joura", "Jaba", "al-Attara"]);

// Sizeable towns OpenStreetMap carries without a population figure.
const PRIORITY_AR = ["عنبتا", "زيتا", "بيت ليد", "علار"];

const strip = (value) => String(value ?? "").replace(/[‎‏‪-‮]/g, "").replace(/\s+/g, " ").trim();
const hasArabic = (value) => /[؀-ۿ]/.test(value);
const hasLatin = (value) => /[A-Za-z]/.test(value);
const norm = (value) => strip(value).replace(/[ً-ٟـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");

function km(a, b, c, d) {
  const t = (x) => (x * Math.PI) / 180;
  const h = Math.sin(t(c - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

async function overpass(query) {
  const servers = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  for (const server of servers) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(server, {
        method: "POST",
        headers: { "user-agent": "DarbPlacesImport/1.0 (darb.aynur.ps)", accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query })
      }).catch(() => null);
      const text = response?.ok ? await response.text() : "";
      if (text.startsWith("{")) return { server, json: JSON.parse(text) };
      await new Promise((resolve) => setTimeout(resolve, 8000));
    }
  }
  throw new Error("Overpass API unavailable");
}

async function fetchPlaces(out) {
  const query = '[out:json][timeout:120];rel(1703814);map_to_area->.wb;node["place"~"^(city|town|village)$"](area.wb);out;';
  const { server, json } = await overpass(query);
  const candidates = [];
  for (const element of json.elements) {
    const nameAr = strip(element.tags["name:ar"] ?? (hasArabic(element.tags.name ?? "") ? element.tags.name : "")).replace(/^[ً-ٟ]+/, "");
    const nameEn = strip(element.tags["name:en"] ?? "");
    if (!hasArabic(nameAr) || !hasLatin(nameEn) || SKIP_EN.has(nameEn)) continue;
    let best = null;
    let bestKm = Infinity;
    for (const city of CITIES) {
      const distance = km(element.lat, element.lon, city.latitude, city.longitude);
      if (distance < bestKm) { best = city; bestKm = distance; }
    }
    const salfit = SALFIT_GOVERNORATE_AR.some((name) => norm(name) === norm(nameAr));
    let city = best;
    if (salfit) {
      city = CITIES.find((c) => c.slug === "salfit");
      bestKm = km(element.lat, element.lon, city.latitude, city.longitude);
    } else if (best.slug === "salfit") {
      // Not a Salfit locality: give it to the nearest other city.
      const others = CITIES.filter((c) => c.slug !== "salfit").map((c) => ({ c, d: km(element.lat, element.lon, c.latitude, c.longitude) }));
      others.sort((a, b) => a.d - b.d);
      city = others[0].c;
      bestKm = others[0].d;
    }
    if (bestKm > RADIUS_KM) continue;
    // The city itself is added as the centre place below.
    if (CITIES.some((c) => norm(c.name_ar) === norm(nameAr))) continue;
    const place = element.tags.place;
    candidates.push({
      city: city.slug,
      name_ar: nameAr,
      name_en: nameEn,
      latitude: Number(element.lat.toFixed(6)),
      longitude: Number(element.lon.toFixed(6)),
      distance: bestKm,
      score: (place === "town" || place === "city" ? 1_000_000 : 0) + (Number(element.tags.population) || 0) + (element.tags.wikipedia || element.tags["wikipedia:ar"] ? 500 : 0) + (PRIORITY_AR.some((n) => norm(n) === norm(nameAr)) ? 100_000 : 0),
      osm: `node/${element.id}`
    });
  }
  const places = [];
  for (const city of CITIES) {
    const key = `city-${city.slug}`;
    let order = 0;
    const row = (fields) => ({ id: `cp_${city.slug}_${String(order).padStart(2, "0")}`, city_key: key, ...fields, sort_order: order++, active: true, approximate: true });
    places.push(row({ name_ar: `وسط ${city.name_ar}`, name_en: `${city.name_en} city centre`, latitude: city.latitude, longitude: city.longitude, centre: true, source: "city centre of the route stop" }));
    const seen = new Set([norm(city.name_ar)]);
    const mine = candidates.filter((c) => c.city === city.slug).sort((a, b) => b.score - a.score || a.distance - b.distance);
    for (const c of mine) {
      if (order > MAX_PER_CITY) break;
      if (seen.has(norm(c.name_ar))) continue;
      seen.add(norm(c.name_ar));
      places.push(row({ name_ar: c.name_ar, name_en: c.name_en, latitude: c.latitude, longitude: c.longitude, centre: false, source: `OpenStreetMap place ${c.osm}` }));
    }
  }
  const data = {
    schema_version: 1,
    source: "OpenStreetMap via the Overpass API (place nodes inside the West Bank relation); city centres from the route stops",
    source_server: server,
    licence: "ODbL-1.0",
    attribution: "© OpenStreetMap contributors",
    fetched_at: new Date().toISOString(),
    approximate: "Every position is a village or town centre point from a map extract, not a street address. Admins correct or disable a place in the admin app.",
    cities: CITIES.map((c) => ({ city_key: `city-${c.slug}`, name_ar: c.name_ar, name_en: c.name_en, count: places.filter((p) => p.city_key === `city-${c.slug}`).length })),
    places
  };
  writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
  for (const city of data.cities) console.log(`${city.city_key}: ${city.count}`);
}

const quote = (value) => `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

function printSql(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const rows = data.places.map(
    (p) =>
      `    (${quote(p.id)}, ${quote(p.city_key)}, ${quote(p.name_ar)}, ${quote(p.name_en)}, ${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}, ${p.approximate ? 1 : 0}, ${quote(p.source)}, ${p.active ? 1 : 0}, ${p.sort_order}, CURRENT_TIMESTAMP(3))`
  );
  console.log(
    "INSERT INTO `city_places` (`id`, `city_key`, `name_ar`, `name_en`, `latitude`, `longitude`, `approximate`, `source`, `active`, `sort_order`, `updated_at`) VALUES\n" +
      rows.join(",\n") + ";"
  );
}

const [command, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : fallback);
if (command === "fetch") await fetchPlaces(flag("--out", DEFAULT_FILE));
else if (command === "sql") printSql(flag("--in", DEFAULT_FILE));
else {
  console.error("usage: build-city-places.mjs fetch|sql [--out|--in <file>]");
  process.exit(2);
}
