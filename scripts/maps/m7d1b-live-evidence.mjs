import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(new URL("../../docs/maps/fixtures/palestine-expanded-public-evidence.json", import.meta.url));
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const mode = process.argv.find((argument) => argument.startsWith("--mode="))?.slice(7) ?? "validate";
const valhallaUrl = (process.env.VALHALLA_URL ?? "http://127.0.0.1:18002").replace(/\/$/, "");
const nominatimUrl = (process.env.NOMINATIM_URL ?? "http://127.0.0.1:18080").replace(/\/$/, "");
const requestTimeoutMs = Number(process.env.M7D1B_REQUEST_TIMEOUT_MS ?? 5_000);
const userAgent = "Darb-M7D1B-evidence/1.0";

export function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function decodePolyline6(encoded) {
  let index = 0; let latitude = 0; let longitude = 0; const points = [];
  while (index < encoded.length) {
    let byte; let shift = 0; let result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    latitude += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    longitude += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([latitude / 1_000_000, longitude / 1_000_000]);
  }
  return points;
}

function distanceMeters(first, second) {
  const radians = Math.PI / 180; const radius = 6_371_000;
  const deltaLatitude = (second[0] - first[0]) * radians;
  const deltaLongitude = (second[1] - first[1]) * radians;
  const value = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(first[0] * radians) * Math.cos(second[0] * radians) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(value));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timeout); }
}

async function postValhalla(action, payload) {
  const response = await fetchWithTimeout(`${valhallaUrl}/${action}`, {
    method: "POST", headers: { "content-type": "application/json", "user-agent": userAgent }, body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`${action} HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

export function validateFixture(data = fixture) {
  const errors = [];
  if (data.classification !== "public-canonical-evidence-no-user-location-data") errors.push("unexpected classification");
  if (data.geocode_locations.length < 30) errors.push("fewer than 30 bilingual locations");
  for (const location of data.geocode_locations) {
    if (!location.id || !location.queries?.ar || !location.queries?.en) errors.push(`missing bilingual query: ${location.id}`);
    if (location.bbox?.length !== 4 || !location.accept?.categories?.length || !location.accept?.types?.length) errors.push(`incomplete acceptance rule: ${location.id}`);
  }
  const requiredLocalRoutes = ["intra-hebron-ppu-bab", "bethlehem-local", "ramallah-al-bireh-local", "nablus-local", "jericho-local", "jenin-local", "tulkarm-local", "qalqilya-local"];
  for (const id of requiredLocalRoutes) if (!data.routes.some((route) => route.id === id)) errors.push(`missing route: ${id}`);
  if (data.restriction_controls.length < 3) errors.push("missing restriction controls");
  const ppu = data.route_locations["ppu-main"]; const bab = data.route_locations["bab-al-zawiya"];
  if (distanceMeters(ppu, [31.5073157, 35.0908933]) > 1) errors.push("PPU fixture regressed");
  if (distanceMeters(bab, [31.5275134, 35.1018593]) > 1) errors.push("Bab Al-Zawiya fixture regressed");
  return { pass: errors.length === 0, errors, location_count: data.geocode_locations.length, query_count: data.geocode_locations.length * 2, route_count: data.routes.length, restriction_control_count: data.restriction_controls.length };
}

async function runGeocodes() {
  const results = [];
  for (const location of fixture.geocode_locations) for (const locale of ["ar", "en"]) {
    const query = location.queries[locale]; const url = new URL(`${nominatimUrl}/search`);
    url.searchParams.set("format", "jsonv2"); url.searchParams.set("limit", "3"); url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", locale); url.searchParams.set("viewbox", fixture.search.viewbox.join(",")); url.searchParams.set("bounded", "1");
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const started = performance.now();
    try {
      const response = await fetchWithTimeout(url, { headers: { "user-agent": userAgent } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const [top] = await response.json(); const latencyMs = performance.now() - started;
      if (!top) { results.push({ id: location.id, locale, query, pass: false, reason: "no_result", latency_ms: latencyMs }); continue; }
      const latitude = Number(top.lat); const longitude = Number(top.lon); const [south, north, west, east] = location.bbox;
      const areaMatch = latitude >= south && latitude <= north && longitude >= west && longitude <= east;
      const categoryMatch = location.accept.categories.includes(top.category); const typeMatch = location.accept.types.includes(top.type);
      const pass = areaMatch && categoryMatch && typeMatch;
      results.push({ id: location.id, locale, query, pass, reason: pass ? "accepted" : !areaMatch ? "outside_expected_area" : !categoryMatch ? "wrong_category" : "wrong_type", latitude, longitude, category: top.category, type: top.type, display_name: top.display_name, latency_ms: latencyMs });
    } catch (error) { results.push({ id: location.id, locale, query, pass: false, reason: error.name === "AbortError" ? "timeout" : "transport_error", error: error.message, latency_ms: performance.now() - started }); }
  }
  const summarize = (items) => ({ accepted: items.filter((item) => item.pass).length, total: items.length, rate: items.filter((item) => item.pass).length / items.length });
  const latencies = results.map((item) => item.latency_ms);
  return { methodology: { top_result_only: true, bounded_viewbox: fixture.search.viewbox, accept_language: true, explicit_timeout_ms: requestTimeoutMs, clock: "performance.now monotonic", acceptance: "expected bbox plus predeclared category and type" }, overall: summarize(results), arabic: summarize(results.filter((item) => item.locale === "ar")), english: summarize(results.filter((item) => item.locale === "en")), latency_ms: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), maximum: Math.max(...latencies) }, results };
}

async function traceLeg(encodedPolyline) {
  return postValhalla("trace_attributes", { encoded_polyline: encodedPolyline, costing: "auto", shape_match: "map_snap", filters: { action: "include", attributes: ["edge.length", "edge.use", "edge.road_class", "edge.traversability", "edge.surface", "edge.unpaved", "edge.destination_only", "edge.part_of_complex_restriction", "edge.begin_shape_index", "edge.end_shape_index"] } });
}

async function calculateRoute(id, orderedPoints, locationOptions = []) {
  const started = performance.now();
  const response = await postValhalla("route", { locations: orderedPoints.map(([lat, lon], index) => ({ lat, lon, ...(locationOptions[index] ?? {}) })), costing: "auto", units: "kilometers", directions_options: { units: "kilometers", language: "en-US" } });
  const latencyMs = performance.now() - started; const decoded = []; const edges = []; const encoded = [];
  for (const leg of response.trip.legs) {
    const points = decodePolyline6(leg.shape); decoded.push(...(decoded.length ? points.slice(1) : points)); encoded.push(leg.shape);
    edges.push(...(await traceLeg(leg.shape)).edges);
  }
  let maximumSegmentMeters = 0;
  for (let index = 1; index < decoded.length; index++) maximumSegmentMeters = Math.max(maximumSegmentMeters, distanceMeters(decoded[index - 1], decoded[index]));
  const pedestrianUses = new Set(["footway", "pedestrian", "steps", "path"]);
  return { id, pass: Number.isFinite(response.trip.summary.length) && Number.isFinite(response.trip.summary.time) && decoded.length > 1 && maximumSegmentMeters < 1_000 && distanceMeters(orderedPoints[0], decoded[0]) < 150 && distanceMeters(orderedPoints.at(-1), decoded.at(-1)) < 150 && edges.every((edge) => !pedestrianUses.has(edge.use)), distance_km: response.trip.summary.length, duration_s: response.trip.summary.time, latency_ms: latencyMs, legs: response.trip.legs.length, maneuvers: response.trip.legs.reduce((count, leg) => count + leg.maneuvers.length, 0), points: decoded.length, maximum_segment_m: maximumSegmentMeters, origin_snap_m: distanceMeters(orderedPoints[0], decoded[0]), destination_snap_m: distanceMeters(orderedPoints.at(-1), decoded.at(-1)), edge_count: edges.length, pedestrian_edge_count: edges.filter((edge) => pedestrianUses.has(edge.use)).length, unpaved_edge_count: edges.filter((edge) => edge.unpaved).length, destination_only_edge_count: edges.filter((edge) => edge.destination_only).length, geometry_sha256: createHash("sha256").update(encoded.join("|")).digest("hex") };
}

async function runRoutes() {
  const results = [];
  for (const route of fixture.routes) results.push(await calculateRoute(route.id, route.ordered_location_ids.map((id) => fixture.route_locations[id])));
  for (const control of fixture.restriction_controls) {
    const result = await calculateRoute(control.id, [control.origin, control.destination], [control.origin_options, control.destination_options]);
    result.pass = result.pass && result.distance_km * 1_000 >= control.minimum_expected_route_meters; results.push(result);
  }
  return { methodology: { costing: "auto", geometry: "polyline6", explicit_timeout_ms: requestTimeoutMs, trace_attributes: true, human_review_required: true }, passed: results.filter((result) => result.pass).length, total: results.length, results };
}

async function routeRequest(route) {
  const points = route.ordered_location_ids.map((id) => fixture.route_locations[id]); const started = performance.now();
  try { await postValhalla("route", { locations: points.map(([lat, lon]) => ({ lat, lon })), costing: "auto", units: "kilometers" }); return { pass: true, latency_ms: performance.now() - started }; }
  catch (error) { return { pass: false, latency_ms: performance.now() - started, error: error.message }; }
}

async function waitForValhalla() {
  const started = performance.now();
  while (performance.now() - started < 15_000) {
    try { const response = await fetchWithTimeout(`${valhallaUrl}/status`, { headers: { "user-agent": userAgent } }); if (response.ok) return performance.now() - started; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Valhalla readiness timeout");
}

async function runPerformance() {
  const errors = []; const cold = []; const restartReady = []; const container = process.env.VALHALLA_CONTAINER;
  if (container) for (let index = 0; index < 20; index++) {
    const started = performance.now(); const restarted = spawnSync("docker", ["restart", container], { encoding: "utf8", timeout: 20_000 });
    if (restarted.status !== 0) throw new Error(`docker restart failed at sample ${index + 1}`);
    await waitForValhalla(); restartReady.push(performance.now() - started);
    const result = await routeRequest(fixture.routes[index % fixture.routes.length]); result.pass ? cold.push(result.latency_ms) : errors.push(result);
  }
  await routeRequest(fixture.routes[0]); const warm = [];
  for (let index = 0; index < 100; index++) { const result = await routeRequest(fixture.routes[index % fixture.routes.length]); result.pass ? warm.push(result.latency_ms) : errors.push(result); }
  const batch = async (routes) => { const results = await Promise.all(routes.map(routeRequest)); errors.push(...results.filter((result) => !result.pass)); const values = results.filter((result) => result.pass).map((result) => result.latency_ms); return { total: results.length, passed: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), maximum: Math.max(...values) }; };
  return { methodology: { clock: "performance.now monotonic", percentile: "nearest-rank ceil(p*n)", request_timeout_ms: requestTimeoutMs, cold: container ? "20 process restarts retaining graph and OS cache; readiness excluded from route latency" : "NOT_EXECUTED: set VALHALLA_CONTAINER", warm: "100 sequential after warmup", concurrency: "Promise.all bounded batch of 20" }, cold: cold.length ? { total: cold.length, p50: percentile(cold, 0.5), p95: percentile(cold, 0.95), maximum: Math.max(...cold) } : null, restart_to_ready: restartReady.length ? { total: restartReady.length, p50: percentile(restartReady, 0.5), p95: percentile(restartReady, 0.95), maximum: Math.max(...restartReady) } : null, warm: { total: warm.length, p50: percentile(warm, 0.5), p95: percentile(warm, 0.95), maximum: Math.max(...warm) }, concurrency: { identical_hebron: await batch(Array(20).fill(fixture.routes[1])), identical_corrected_ppu: await batch(Array(20).fill(fixture.routes[0])), mixed: await batch(Array.from({ length: 20 }, (_, index) => fixture.routes[index % fixture.routes.length])) }, errors: errors.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = { fixture_validation: validateFixture() };
  if (["geocode", "all"].includes(mode)) output.geocoding = await runGeocodes();
  if (["route", "all"].includes(mode)) output.routing = await runRoutes();
  if (["performance", "all"].includes(mode)) output.performance = await runPerformance();
  if (!["validate", "geocode", "route", "performance", "all"].includes(mode)) throw new Error("mode must be validate, geocode, route, performance, or all");
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.fixture_validation.pass || output.geocoding?.overall.rate < fixture.search.acceptance_target || output.routing?.passed !== output.routing?.total || output.performance?.errors) process.exitCode = 1;
}
