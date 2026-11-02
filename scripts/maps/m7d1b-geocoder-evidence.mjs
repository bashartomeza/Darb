import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(new URL("../../docs/maps/fixtures/palestine-expanded-public-evidence.json", import.meta.url));
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const provider = process.argv.find((value) => value.startsWith("--provider="))?.slice(11);
const outputPath = process.argv.find((value) => value.startsWith("--output="))?.slice(9);
const adjudicationPath = process.argv.find((value) => value.startsWith("--adjudication="))?.slice(15);
const baseUrl = (process.env.GEOCODER_URL ?? (provider === "photon" ? "http://127.0.0.1:19222" : "http://127.0.0.1:19000")).replace(/\/$/, "");
const timeoutMs = Number(process.env.M7D1B_REQUEST_TIMEOUT_MS ?? 5_000);

if (!["photon", "pelias"].includes(provider)) throw new Error("--provider must be photon or pelias");

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
}

async function requestJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "Darb-M7D1B-geocoder-evidence/1.0" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally { clearTimeout(timer); }
}

function queryText(query) { return query.q ?? query.city; }

function photonUrl(query, locale) {
  const url = new URL(`${baseUrl}/api`);
  url.searchParams.set("q", queryText(query));
  url.searchParams.set("limit", "3"); url.searchParams.set("lang", locale);
  url.searchParams.set("bbox", "34.85,31.3,35.65,32.6");
  url.searchParams.set("lat", "31.9"); url.searchParams.set("lon", "35.2");
  return url;
}

function peliasUrl(query, locale) {
  const url = new URL(`${baseUrl}/v1/search`);
  url.searchParams.set("text", queryText(query)); url.searchParams.set("size", "3"); url.searchParams.set("lang", locale);
  url.searchParams.set("boundary.country", "PS");
  url.searchParams.set("boundary.rect.min_lon", "34.85"); url.searchParams.set("boundary.rect.min_lat", "31.3");
  url.searchParams.set("boundary.rect.max_lon", "35.65"); url.searchParams.set("boundary.rect.max_lat", "32.6");
  url.searchParams.set("focus.point.lat", "31.9"); url.searchParams.set("focus.point.lon", "35.2");
  return url;
}

function normalizeFeature(feature) {
  if (provider === "photon") {
    const properties = feature.properties ?? {}; const [longitude, latitude] = feature.geometry?.coordinates ?? [];
    return { latitude, longitude, name: properties.name ?? null, category: properties.osm_key ?? null, type: properties.osm_value ?? null, provider_metadata: properties };
  }
  const properties = feature.properties ?? {}; const [longitude, latitude] = feature.geometry?.coordinates ?? [];
  return { latitude, longitude, name: properties.label ?? properties.name ?? null, category: properties.category ?? null, type: properties.layer ?? null, provider_metadata: properties };
}

function assess(location, result) {
  if (!result) return { acceptable: false, expected_area_match: false, failure_category: "missing_source_data" };
  const [south, north, west, east] = location.bbox;
  const area = result.latitude >= south && result.latitude <= north && result.longitude >= west && result.longitude <= east;
  if (!area) return { acceptable: false, expected_area_match: false, failure_category: "incorrect_admin_area" };
  if (provider === "photon") {
    const category = location.accept.categories.includes(result.category);
    const type = location.accept.types.includes(result.type);
    return { acceptable: category && type, expected_area_match: true, failure_category: category && type ? null : "ranking_problem" };
  }
  // Pelias does not expose source OSM category/type in search responses. Evidence is
  // conservatively accepted only for its locality layers; venue rows require review.
  const city = location.kind === "city" && ["locality", "localadmin", "county", "region"].includes(result.type);
  return { acceptable: city, expected_area_match: true, failure_category: city ? null : "ranking_problem" };
}

const results = [];
for (const location of fixture.geocode_locations) for (const language of ["ar", "en"]) {
  const query = location.queries[language]; const started = performance.now();
  try {
    const payload = await requestJson(provider === "photon" ? photonUrl(query, language) : peliasUrl(query, language));
    const candidates = (payload.features ?? []).slice(0, 3).map(normalizeFeature); const top = candidates[0] ?? null;
    const assessment = assess(location, top);
    results.push({ fixture_id: location.id, language, query, returned_result: top, candidates, ...assessment, candidate_rank: top ? 1 : null, latency_ms: performance.now() - started });
  } catch (error) {
    results.push({ fixture_id: location.id, language, query, returned_result: null, candidates: [], acceptable: false, expected_area_match: false, candidate_rank: null, failure_category: error.name === "AbortError" ? "timeout" : "transport_error", latency_ms: performance.now() - started });
  }
}

if (adjudicationPath) {
  const adjudication = JSON.parse(await readFile(adjudicationPath, "utf8"));
  for (const result of results) {
    const decision = adjudication.decisions[`${result.fixture_id}/${result.language}`];
    if (!decision) throw new Error(`missing adjudication for ${result.fixture_id}/${result.language}`);
    result.acceptable = decision.acceptable;
    result.failure_category = decision.acceptable ? null : (decision.failure_category ?? result.failure_category);
    result.adjudication = "documented_human_review";
  }
}

const summarize = (items) => ({ acceptable: items.filter((item) => item.acceptable).length, total: items.length, percentage: 100 * items.filter((item) => item.acceptable).length / items.length });
const failureCategories = Object.fromEntries([...new Set(results.filter((item) => !item.acceptable).map((item) => item.failure_category))].sort().map((category) => [category, results.filter((item) => !item.acceptable && item.failure_category === category).length]));
const latencies = results.map((item) => item.latency_ms);
const evidence = {
  provider, fixture_classification: fixture.classification, query_count: results.length,
  methodology: { exact_committed_queries: true, top_result_only: true, candidate_limit: 3, regional_bounds: [34.85, 31.3, 35.65, 32.6], focus: [31.9, 35.2], timeout_ms: timeoutMs, clock: "performance.now monotonic", adjudication: adjudicationPath ? "complete documented human review; affects scoring only, never queries or ranking" : "automated provider-taxonomy check", provider_taxonomy_note: provider === "pelias" ? "Pelias search responses expose layers but not source OSM category/type; human review checks identity, fixture bbox, and semantic class." : "OSM key/value compared to predeclared fixture category/type." },
  arabic: summarize(results.filter((item) => item.language === "ar")), english: summarize(results.filter((item) => item.language === "en")), overall: summarize(results),
  failures: failureCategories, latency_ms: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), maximum: Math.max(...latencies) }, results
};
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
if (outputPath) await writeFile(outputPath, serialized, "utf8"); else process.stdout.write(serialized);
if (evidence.overall.percentage < fixture.search.acceptance_target * 100) process.exitCode = 1;
