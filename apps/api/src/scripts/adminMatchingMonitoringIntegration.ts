import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { assertMonitoringIntegrationTarget } from "./adminMatchingMonitoringIntegrationSafety.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { BatchRow, MatchRow, Overview, Observed, Page, CurrentOrderParcelsPage } from "../services/adminMatchingMonitoring/contracts.js";

// No env-file loading, Prisma import, connection, or fixture writes before this guard.
const target = { environment: process.env.APP_ENV, url: process.env.DATABASE_URL, allowed: process.env.DEMO_RESET_ALLOWED_DATABASES };
function verifyTarget() {
  assertMonitoringIntegrationTarget(target.environment, target.url, target.allowed);
  assert.equal(process.env.DATABASE_URL, target.url, "Integration target changed during run");
  const url = new URL(target.url!);
  if (decodeURIComponent(url.pathname.slice(1)) === "card7_ci") {
    assert.equal(url.hostname, "127.0.0.1", "Local disposable host mismatch");
    assert.equal(url.port, "3309", "Local disposable port mismatch");
  }
}
verifyTarget();
for (const flag of ["MULTI_ROUTE_ENTRY_ENABLED", "MULTI_ROUTE_MATCHING_ENABLED", "CANONICAL_TRIP_CREATION_ENABLED", "CANONICAL_SHARED_TRIPS_ENABLED"]) {
  assert.notEqual(process.env[flag], "true", "Monitoring integration requires canonical flags disabled");
}
const { prisma } = await import("../lib/prisma.js");
const { signAuthToken } = await import("../middleware/auth.js");
const { MatchStatus, ParcelBatchStatus } = await import("../generated/prisma/enums.js");
async function verifyConnectedTarget() {
  verifyTarget();
  const rows = await prisma.$queryRaw<{ database_name: string; port: number }[]>`SELECT DATABASE() AS database_name, @@port AS port`;
  assert.equal(rows[0]?.database_name, decodeURIComponent(new URL(target.url!).pathname.slice(1)), "Connected database differs from guarded target");
  if (rows[0]?.database_name === "card7_ci") assert.equal(Number(rows[0].port), 3309, "Connected local disposable port mismatch");
}
const prefix = `c7${randomUUID().replaceAll("-", "")}`;
const id = (suffix: string) => `${prefix}_${suffix}`;
const owned = { id: { startsWith: `${prefix}_` } };
const marker = `PRIVATE-${prefix}`;
const phonePrefix = `+1202${randomInt(200, 1000)}`;
let phoneSequence = randomInt(0, 9_991);
const origin = (process.env.API_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const base = `${origin}/api/v1/admin/matching-batching`;
const created = new Date(Date.now() - 86_400_000);
const preferredTime = new Date(Date.now() + 86_400_000);
const old = new Date(Date.now() - 40 * 86_400_000);
const range = { from: new Date(created.getTime() - 1_000).toISOString(), until: new Date(created.getTime() + 1_000).toISOString() };
const query = (values: Record<string, string | number>) => `?${new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]))}`;
const times: Record<string, number[]> = {};
let adminToken = "";
let phase = "setup";
const readBudgetMs = 10_000;

async function get<T>(path: string, token = adminToken, status = 200): Promise<T> {
  const start = performance.now();
  const signal = AbortSignal.timeout(readBudgetMs);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal });
  } catch (error) {
    const pathname = path.split("?")[0]!;
    const fixedPath = pathname === "/overview" || pathname === "/matches" || pathname === "/batches" ? pathname
      : /^\/matches\/[^/]+$/.test(pathname) ? "/matches/:id"
      : /^\/batches\/[^/]+\/parcels$/.test(pathname) ? "/batches/:id/parcels"
      : /^\/batches\/[^/]+$/.test(pathname) ? "/batches/:id" : "/unknown";
    const name = error instanceof Error && ["TimeoutError", "AbortError", "TypeError", "Error"].includes(error.name)
      ? error.name : "UnknownError";
    console.error(JSON.stringify({ phase, pathname: fixedPath, error_name: name,
      elapsed_ms: Math.round(performance.now() - start), timed_out: signal.aborted }));
    throw error;
  }
  const body: unknown = await response.json();
  assert.equal(response.status, status, `${phase}: ${path.split("?")[0]} HTTP status`);
  assert(!JSON.stringify(body).includes(marker), "Private fixture marker escaped projection");
  if (status === 200) {
    const envelope = body as Observed<unknown>;
    keys(envelope, ["observed_at", "scope", "data"]);
    assert.equal(envelope.scope, "production_supported_legacy");
    assert(Number.isFinite(Date.parse(envelope.observed_at)));
    const label = path.split("?")[0]!.replace(/\/matches\/[^/]+/, "/matches/:id").replace(/\/batches\/[^/]+/, "/batches/:id");
    const elapsed = performance.now() - start;
    if (phase === "volume") (times[label] ??= []).push(elapsed);
    assert(elapsed < readBudgetMs, `${label} exceeded disposable fixture ${readBudgetMs}ms budget`);
  }
  return body as T;
}
function keys(value: unknown, expected: string[]) {
  assert(value && typeof value === "object");
  assert.deepEqual(Object.keys(value).sort(), expected.slice().sort());
}
function safeMatch(row: MatchRow) {
  keys(row, ["id", "status", "created_at", "score", "method", "demand_kind", "driver_route", "passenger_request", "merchant_order", "parcel_batch"]);
  keys(row.driver_route, ["id", "status"]);
  if (row.passenger_request) keys(row.passenger_request, ["id", "status", "passenger_count"]);
  if (row.merchant_order) keys(row.merchant_order, ["id", "status", "parcel_count"]);
  if (row.parcel_batch) keys(row.parcel_batch, ["id", "status"]);
  assert.equal(typeof row.score, "string");
  assert(["masari_route_score", "unrecognized"].includes(row.method));
}
function safeBatch(row: BatchRow) {
  keys(row, ["id", "status", "created_at", "merchant_order", "selected_driver_route"]);
  keys(row.merchant_order, ["id", "status", "parcel_count"]);
  if (row.selected_driver_route) keys(row.selected_driver_route, ["id", "status"]);
}
function safePage<T>(page: Page<T>, inspect: (row: T) => void) {
  keys(page.data, ["items", "page", "limit", "total", "has_more", "range"]);
  if (page.data.range) keys(page.data.range, ["from", "until"]);
  page.data.items.forEach(inspect);
  assert.equal(page.data.has_more, page.data.page * page.data.limit < page.data.total);
}
async function session(role: "admin" | "passenger" | "driver" | "merchant", suffix: string = role, state?: "expired" | "revoked") {
  const userId = id(`user_${suffix}`);
  await prisma.user.create({ data: userData(`user_${suffix}`, role) });
  const sessionId = id(`session_${suffix}`);
  await prisma.authSession.create({ data: { id: sessionId, user_id: userId, client_type: "admin", security_version_at_issue: 1,
    expires_at: new Date(Date.now() + (state === "expired" ? -60_000 : 3_600_000)), revoked_at: state === "revoked" ? new Date() : null } });
  return signAuthToken({ id: userId, role, sessionId, securityVersion: 1 });
}
function userData(suffix: string, role: "admin" | "passenger" | "driver" | "merchant") {
  // The auth gate requires completed, verified profiles. Keep random row IDs out of the bounded phone column.
  return { id: id(suffix), name: marker, phone: `${phonePrefix}${String(phoneSequence++).padStart(4, "0")}`,
    email: `${id(suffix)}@example.invalid`, password_hash: marker, role,
    profile_state: "complete" as const, phone_verified_at: created, email_verified_at: created };
}
const location = { destination_label: marker, destination_lat: "31.7", destination_lng: "35.2" };
const pickup = { pickup_label: marker, pickup_lat: "31.5", pickup_lng: "35.1" };
function requestData(suffix: string, extra: Partial<Prisma.PassengerRequestUncheckedCreateInput> = {}): Prisma.PassengerRequestUncheckedCreateInput {
  return { id: id(suffix), passenger_id: id("user_passenger"), ...pickup, ...location, preferred_time: preferredTime, passenger_count: 2, source: "manual", created_at: created, ...extra };
}
function orderData(suffix: string, extra: Partial<Prisma.MerchantOrderUncheckedCreateInput> = {}): Prisma.MerchantOrderUncheckedCreateInput {
  return { id: id(suffix), merchant_id: id("user_merchant"), ...pickup, created_at: created, ...extra };
}
function routeData(suffix: string, extra: Partial<Prisma.DriverRouteUncheckedCreateInput> = {}): Prisma.DriverRouteUncheckedCreateInput {
  return { id: id(suffix), driver_id: id("profile"), origin_label: marker, origin_lat: "31.5", origin_lng: "35.1", ...location,
    corridor_key: prefix, seats_available: 4, parcel_capacity_available: 30, status: "inactive", ...extra };
}
function batchData(suffix: string, extra: Partial<Prisma.ParcelBatchUncheckedCreateInput> = {}): Prisma.ParcelBatchUncheckedCreateInput {
  return { id: id(suffix), merchant_order_id: id("order"), driver_route_id: id("route"), estimated_distance_saved: "1.25", explanation: marker, created_at: created, ...extra };
}
function matchData(suffix: string, extra: Partial<Prisma.MatchUncheckedCreateInput> = {}): Prisma.MatchUncheckedCreateInput {
  return { id: id(suffix), driver_route_id: id("route"), passenger_request_id: id("request"), merchant_order_id: id("order"), parcel_batch_id: id("batch_00"), score: "0.8751", method: "masari_route_score", explanation: marker,
    scoring_breakdown: { private: marker }, created_at: created, ...extra };
}
async function domainSnapshot() {
  // Fixture-owned scalar domain rows only; authSession.last_used_at is intentionally excluded.
  const models = [prisma.user, prisma.driverProfile, prisma.driverRoute, prisma.passengerRequest, prisma.merchantOrder, prisma.parcel, prisma.parcelBatch, prisma.match,
    prisma.serviceRoute, prisma.serviceRouteVersion, prisma.stop, prisma.routeVersionStop] as const;
  const rows = [];
  for (const model of models) rows.push(await (model.findMany as (args: unknown) => Promise<unknown>)({ where: owned, orderBy: { id: "asc" } }));
  return JSON.stringify(rows);
}
async function cleanup() {
  await verifyConnectedTarget();
  // Every predicate names this random run; no reset, global delete, FK disabling, or database drop.
  await prisma.match.deleteMany({ where: owned });
  await prisma.parcelBatch.deleteMany({ where: owned });
  await prisma.parcel.deleteMany({ where: owned });
  await prisma.passengerRequest.deleteMany({ where: owned });
  await prisma.merchantOrder.deleteMany({ where: owned });
  await prisma.driverRoute.deleteMany({ where: owned });
  await prisma.driverProfile.deleteMany({ where: owned });
  await prisma.routeVersionStop.deleteMany({ where: owned });
  await prisma.serviceRouteVersion.deleteMany({ where: owned });
  await prisma.serviceRoute.deleteMany({ where: owned });
  await prisma.stop.deleteMany({ where: owned });
  await prisma.authSession.deleteMany({ where: owned });
  await prisma.user.deleteMany({ where: owned });
  assert.equal(await domainSnapshot(), JSON.stringify(Array.from({ length: 12 }, () => [])), "Fixture domain cleanup incomplete");
  assert.equal(await prisma.authSession.count({ where: owned }), 0);
  console.log("Monitoring fixture cleanup verified: no run-owned rows remain");
}

try {
  await verifyConnectedTarget();
  adminToken = await session("admin");
  const baseline = (await get<Observed<Overview>>(`/overview${query(range)}`)).data;
  const roles = await Promise.all([session("passenger"), session("driver"), session("merchant")]);
  const expired = await session("admin", "expired", "expired");
  const revoked = await session("admin", "revoked", "revoked");
  for (const role of ["passenger", "driver", "merchant"] as const) {
    await prisma.user.create({ data: { ...userData(`demo_${role}`, role), demo_account: true } });
  }
  await prisma.driverProfile.createMany({ data: [
    { id: id("profile"), user_id: id("user_driver"), vehicle_type: marker, seats_total: 4, parcel_capacity: 30 },
    { id: id("demo_profile"), user_id: id("demo_driver"), vehicle_type: marker, seats_total: 4, parcel_capacity: 30 },
  ] });
  await prisma.driverRoute.createMany({ data: [routeData("route"), routeData("demo_route", { driver_id: id("demo_profile") })] });
  await prisma.passengerRequest.createMany({ data: [requestData("request"), requestData("old_request", { created_at: old }), requestData("seed_request", { source: "seed" }),
    requestData("unknown_request", { source: "unknown" }), requestData("demo_request", { passenger_id: id("demo_passenger") })] });
  await prisma.merchantOrder.createMany({ data: [orderData("order"), orderData("empty_order", { created_at: old }), orderData("demo_order", { merchant_id: id("demo_merchant") })] });
  await prisma.parcel.createMany({ data: Array.from({ length: 26 }, (_, index) => ({ id: id(`parcel_${String(index).padStart(2, "0")}`), order_id: id("order"), ...location, size: marker, priority: marker, batch_id: null })) });

  // Legal canonical demand rows require catalog ownership and stop memberships, even though monitoring excludes them.
  await prisma.serviceRoute.create({ data: { id: id("catalog"), route_key: prefix, route_group_key: prefix, service_region_key: prefix, direction: "outbound", created_by_user_id: id("user_admin") } });
  await prisma.serviceRouteVersion.create({ data: { id: id("version"), service_route_id: id("catalog"), version_number: 1, name_ar: marker, name_en: marker, created_by_user_id: id("user_admin") } });
  for (let index = 0; index < 2; index++) {
    await prisma.stop.create({ data: { id: id(`stop${index}`), stop_key: id(`stop${index}`), service_region_key: prefix, name_ar: marker, name_en: marker, latitude: "31.5", longitude: "35.1", created_by_user_id: id("user_admin") } });
    await prisma.routeVersionStop.create({ data: { id: id(`membership${index}`), service_route_version_id: id("version"), stop_id: id(`stop${index}`), sequence: index + 1 } });
  }
  const canonical = { operational_mode: "canonical_route_v1", canonical_entry_version: "canonical_route_v1", route_version_id: id("version"), pickup_stop_id: id("stop0"), requested_departure_from: created,
    requested_departure_until: new Date(created.getTime() + 3_600_000), canonical_created_at: created };
  await prisma.passengerRequest.create({ data: requestData("canonical_request", { ...canonical, dropoff_stop_id: id("stop1") }) });
  await prisma.merchantOrder.create({ data: orderData("canonical_order", canonical) });
  await prisma.parcel.create({ data: { id: id("canonical_parcel"), order_id: id("canonical_order"), ...location, size: marker, priority: marker, operational_mode: "canonical_route_v1", canonical_entry_version: "canonical_route_v1", route_version_id: id("version"), destination_stop_id: id("stop1"), batch_id: id("batch_00") } });
  const batchStatuses = Object.values(ParcelBatchStatus);
  const expectedBatchCounts = { created: 7, proposed: 7, assigned: 7, picked_up: 7, in_transit: 7, delivered: 7, cancelled: 6, failed: 6, expired: 6 };
  const matchStatuses = Object.values(MatchStatus);
  await prisma.parcelBatch.createMany({ data: Array.from({ length: 60 }, (_, index) => batchData(`batch_${String(index).padStart(2, "0")}`, { status: batchStatuses[index % batchStatuses.length] })) });
  await prisma.parcelBatch.createMany({ data: [batchData("old_batch", { created_at: old }), batchData("empty_batch", { merchant_order_id: id("empty_order"), driver_route_id: null, created_at: old }),
    batchData("excluded_demo_batch", { merchant_order_id: id("demo_order") }), batchData("excluded_driver_batch", { driver_route_id: id("demo_route") }), batchData("excluded_canonical_batch", { merchant_order_id: id("canonical_order") })] });
  await prisma.match.createMany({ data: Array.from({ length: 60 }, (_, index) => matchData(`match_${String(index).padStart(2, "0")}`, {
    status: matchStatuses[index % 6], passenger_request_id: index % 3 === 1 ? null : id("request"), merchant_order_id: index % 3 === 0 ? null : id("order"), method: index === 59 ? marker : "masari_route_score" })) });
  await prisma.match.create({ data: matchData("old_match", { created_at: old, status: "accepted" }) });
  const excludedMatches: string[] = [];
  for (const [suffix, extra] of [
    ["seed", { passenger_request_id: id("seed_request") }], ["unknown", { passenger_request_id: id("unknown_request") }], ["demo_passenger", { passenger_request_id: id("demo_request") }],
    ["demo_driver", { driver_route_id: id("demo_route") }], ["demo_merchant", { merchant_order_id: id("demo_order") }], ["canonical_passenger", { passenger_request_id: id("canonical_request") }],
    ["canonical_order", { merchant_order_id: id("canonical_order") }], ["nested_batch", { parcel_batch_id: id("excluded_demo_batch") }], ["no_demand", { passenger_request_id: null, merchant_order_id: null }],
  ] satisfies [string, Partial<Prisma.MatchUncheckedCreateInput>][]) {
    await prisma.match.create({ data: matchData(`excluded_${suffix}`, extra) });
    excludedMatches.push(id(`excluded_${suffix}`));
  }
  // Keep this cohort outside the existing volume/default date ranges. Match
  // order and batch order are independent; neither may weaken the other's gate.
  const relationCreated = new Date(created.getTime() - 8 * 86_400_000);
  const relationRange = { from: new Date(relationCreated.getTime() - 1).toISOString(), until: new Date(relationCreated.getTime() + 1).toISOString() };
  const optionalRelations = [
    ["passenger_null_batch", { merchant_order_id: null, parcel_batch_id: null }],
    ["merchant_null_batch", { passenger_request_id: null, parcel_batch_id: null }],
    ["combined_null_batch", { parcel_batch_id: null }],
    ["different_orders", { parcel_batch_id: id("empty_batch") }],
    ["empty_direct_order", { merchant_order_id: id("empty_order") }],
    ["empty_order_null_batch", { passenger_request_id: null, merchant_order_id: id("empty_order"), parcel_batch_id: null }]
  ] satisfies [string, Partial<Prisma.MatchUncheckedCreateInput>][];
  await prisma.match.createMany({ data: optionalRelations.map(([suffix, extra]) => matchData(`relation_${suffix}`, { ...extra, created_at: relationCreated })) });
  for (const [suffix, extra] of [
    ["direct_demo", { merchant_order_id: id("demo_order") }],
    ["batch_demo", { parcel_batch_id: id("excluded_demo_batch") }],
    ["direct_canonical", { merchant_order_id: id("canonical_order") }],
    ["batch_canonical", { parcel_batch_id: id("excluded_canonical_batch") }],
    ["batch_driver", { parcel_batch_id: id("excluded_driver_batch") }],
    ["no_demand_null_batch", { passenger_request_id: null, merchant_order_id: null, parcel_batch_id: null }]
  ] satisfies [string, Partial<Prisma.MatchUncheckedCreateInput>][]) {
    await prisma.match.create({ data: matchData(`relation_${suffix}`, { ...extra, created_at: relationCreated }) });
    excludedMatches.push(id(`relation_${suffix}`));
  }
  phase = "HTTP contract";
  const snapshot = await domainSnapshot();
  const relationPage = await get<Page<MatchRow>>(`/matches${query({ ...relationRange, search: id("route"), limit: 50 })}`);
  safePage(relationPage, safeMatch);
  assert.equal(relationPage.data.total, optionalRelations.length);
  assert.deepEqual(relationPage.data.items.map(row => row.id).sort(), optionalRelations.map(([suffix]) => id(`relation_${suffix}`)).sort());
  for (const [suffix, extra] of optionalRelations) {
    const detail = await get<Observed<MatchRow>>(`/matches/${id(`relation_${suffix}`)}`);
    safeMatch(detail.data);
    if ("parcel_batch_id" in extra && extra.parcel_batch_id === null) assert.equal(detail.data.parcel_batch, null);
  }
  const paths = ["/overview", "/matches", `/matches/${id("match_02")}`, "/batches", `/batches/${id("batch_00")}`, `/batches/${id("batch_00")}/parcels`];
  for (const path of paths) {
    await get(path, "", 401);
    for (const token of roles) await get(path, token, 403);
    await get(path, expired, 401);
    await get(path, revoked, 401);
    await get(`${path}?cursor=malformed`, adminToken, 400);
  }
  for (const path of ["/matches", "/batches"]) {
    for (const values of [{ limit: "51" }, { page: "0" }, { page: "1.5" }, { status: "completed" }, { search: "x".repeat(192) }, { from: "bad", until: "bad" },
      { from: range.until, until: range.from }, { from: old.toISOString(), until: range.until }, { from: range.from }, { from: range.from, until: new Date(Date.now() + 86_400_000).toISOString() }] as Record<string, string>[]) {
      await get(`${path}${query(values)}`, adminToken, 400);
    }
    await get(`${path}?status=accepted&status=accepted`, adminToken, 400);
    await get(`${path}/${"x".repeat(192)}`, adminToken, 400);
    await get(`${path}/%20`, adminToken, 400);
    await get(`${path}/${id("missing")}`, adminToken, 404);
  }
  await get("/matches?demand_kind=all", adminToken, 400);
  const allMatches: MatchRow[] = [];
  const allBatches: BatchRow[] = [];
  for (let page = 1; page <= 3; page++) {
    const matches = await get<Page<MatchRow>>(`/matches${query({ ...range, search: id("route"), page })}`);
    const batches = await get<Page<BatchRow>>(`/batches${query({ ...range, search: id("route"), page })}`);
    safePage(matches, safeMatch); safePage(batches, safeBatch);
    for (const result of [matches, batches]) { assert.equal(result.data.total, 60); assert.equal(result.data.limit, 25); assert.equal(result.data.items.length, page === 3 ? 10 : 25); }
    allMatches.push(...matches.data.items); allBatches.push(...batches.data.items);
  }
  assert.deepEqual(allMatches.map((row) => row.id), Array.from({ length: 60 }, (_, index) => id(`match_${String(59 - index).padStart(2, "0")}`)));
  assert.deepEqual(allBatches.map((row) => row.id), Array.from({ length: 60 }, (_, index) => id(`batch_${String(59 - index).padStart(2, "0")}`)));
  for (const [path, inspect] of [["/matches", safeMatch], ["/batches", safeBatch]] as const) {
    const result = await get<Page<MatchRow & BatchRow>>(`${path}${query({ ...range, search: id("route"), limit: 50 })}`);
    safePage(result, inspect); assert.equal(result.data.items.length, 50); assert.equal(result.data.total, 60);
    assert.equal((await get<Page<unknown>>(`${path}${query({ ...range, search: prefix })}`)).data.total, 0, "Search is exact, not prefix");
  }
  for (const status of matchStatuses) assert.equal((await get<Page<MatchRow>>(`/matches${query({ ...range, search: id("route"), status })}`)).data.total, 10, `Match count for ${status}`);
  for (const status of batchStatuses) assert.equal((await get<Page<BatchRow>>(`/batches${query({ ...range, search: id("route"), status })}`)).data.total, expectedBatchCounts[status], `Batch count for ${status}`);
  for (const demand_kind of ["passenger_only", "merchant_only", "combined"]) assert.equal((await get<Page<MatchRow>>(`/matches${query({ ...range, search: id("route"), demand_kind })}`)).data.total, 20);
  for (const [search, total] of [[id("request"), 40], [id("order"), 40], [id("batch_00"), 60], [id("match_02"), 1]] as const) {
    assert.equal((await get<Page<MatchRow>>(`/matches${query({ ...range, search })}`)).data.total, total);
  }
  for (const [search, total] of [[id("order"), 60], [id("batch_00"), 1]] as const) {
    assert.equal((await get<Page<BatchRow>>(`/batches${query({ ...range, search })}`)).data.total, total);
  }
  for (const path of ["/matches", "/batches"]) {
    assert.equal((await get<Page<unknown>>(`${path}${query({ from: created.toISOString(), until: range.until, search: id("route") })}`)).data.total, 60, "Creation lower bound is inclusive");
    assert.equal((await get<Page<unknown>>(`${path}${query({ from: range.from, until: created.toISOString(), search: id("route") })}`)).data.total, 0, "Creation upper bound is exclusive");
  }
  const combined = await get<Observed<MatchRow>>(`/matches/${id("match_02")}`);
  safeMatch(combined.data); assert.equal(combined.data.demand_kind, "combined"); assert.equal(combined.data.score, "0.8751"); assert.equal(combined.data.status, "accepted");
  assert.equal(combined.data.passenger_request?.passenger_count, 2); assert.equal(combined.data.merchant_order?.parcel_count, 26);
  assert.equal((await get<Observed<MatchRow>>(`/matches/${id("match_59")}`)).data.method, "unrecognized");
  const detail = await get<Observed<BatchRow>>(`/batches/${id("batch_00")}`); safeBatch(detail.data); assert.equal(detail.data.merchant_order.parcel_count, 26);
  const empty = await get<Observed<BatchRow>>(`/batches/${id("empty_batch")}`); safeBatch(empty.data); assert.equal(empty.data.selected_driver_route, null); assert.equal(empty.data.merchant_order.parcel_count, 0);
  assert.equal((await get<Observed<MatchRow>>(`/matches/${id("old_match")}`)).data.status, "accepted");
  assert.equal((await get<Page<MatchRow>>(`/matches${query({ search: id("old_match") })}`)).data.total, 0);
  const defaultRange = (await get<Page<MatchRow>>(`/matches${query({ search: id("route") })}`)).data.range!;
  assert.equal(Date.parse(defaultRange.until) - Date.parse(defaultRange.from), 7 * 86_400_000);
  const parcelIds: string[] = [];
  for (let page = 1; page <= 2; page++) {
    const parcels = await get<CurrentOrderParcelsPage>(`/batches/${id("batch_00")}/parcels?page=${page}`);
    keys(parcels.data, ["items", "page", "limit", "total", "has_more", "range", "contents_semantics", "merchant_order_id"]);
    assert.equal(parcels.data.contents_semantics, "current_eligible_order_contents"); assert.equal(parcels.data.merchant_order_id, id("order"));
    assert.equal(parcels.data.total, 26); assert.equal(parcels.data.range, null); assert.equal(parcels.data.items.length, page === 1 ? 25 : 1);
    parcels.data.items.forEach((row) => keys(row, ["id", "status"])); parcelIds.push(...parcels.data.items.map((row) => row.id));
  }
  assert.deepEqual(parcelIds, Array.from({ length: 26 }, (_, index) => id(`parcel_${String(index).padStart(2, "0")}`)));
  assert.equal((await get<CurrentOrderParcelsPage>(`/batches/${id("batch_00")}/parcels?limit=50`)).data.items.length, 26);
  await get(`/batches/${id("batch_00")}/parcels?limit=51`, adminToken, 400);
  await get(`/batches/${id("missing")}/parcels`, adminToken, 404);
  for (const values of [{ from: "bad", until: "bad" }, { from: range.until, until: range.from }, { from: old.toISOString(), until: range.until }, { from: range.from, until: new Date(Date.now() + 86_400_000).toISOString() }]) {
    await get(`/overview${query(values)}`, adminToken, 400);
  }
  for (const excluded of excludedMatches) {
    await get(`/matches/${excluded}`, adminToken, 404);
    assert.equal((await get<Page<MatchRow>>(`/matches${query({ ...range, search: excluded })}`)).data.total, 0);
  }
  for (const suffix of ["excluded_demo_batch", "excluded_driver_batch", "excluded_canonical_batch"]) {
    await get(`/batches/${id(suffix)}`, adminToken, 404); await get(`/batches/${id(suffix)}/parcels`, adminToken, 404);
    assert.equal((await get<Page<BatchRow>>(`/batches${query({ ...range, search: id(suffix) })}`)).data.total, 0);
  }
  const overview = (await get<Observed<Overview>>(`/overview${query(range)}`)).data;
  keys(overview, ["range", "pending_passenger_requests", "submitted_merchant_orders", "match_results_by_status", "batches_by_status", "active_batches", "capabilities"]);
  keys(overview.match_results_by_status, matchStatuses); keys(overview.batches_by_status, batchStatuses); keys(overview.range, ["from", "until"]);
  assert.deepEqual(overview.capabilities, { canonical_monitoring: "unavailable", failed_attempt_history: "not_recorded", completed_batches: "not_supported" });
  assert.equal(overview.pending_passenger_requests - baseline.pending_passenger_requests, 2);
  assert.equal(overview.submitted_merchant_orders - baseline.submitted_merchant_orders, 2);
  for (const status of matchStatuses) assert.equal(overview.match_results_by_status[status] - baseline.match_results_by_status[status], 10);
  for (const status of batchStatuses) assert.equal(overview.batches_by_status[status] - baseline.batches_by_status[status], expectedBatchCounts[status] + (status === "created" ? 2 : 0), `Overview batch count for ${status}`);
  assert.equal(overview.active_batches - baseline.active_batches, 30, "Only created + assigned + picked_up + in_transit are active");
  assert.equal(await domainSnapshot(), snapshot, "Monitoring GET sequence wrote fixture domain rows");

  phase = "concurrency";
  // A deliberate fixture edit demonstrates current contents and shrinking member pages.
  await prisma.parcel.update({ where: { id: id("parcel_25") }, data: { order_id: id("empty_order") } });
  const changedContents = await get<CurrentOrderParcelsPage>(`/batches/${id("batch_00")}/parcels?page=2`);
  assert.equal(changedContents.data.total, 25); assert.deepEqual(changedContents.data.items, []); assert.equal(changedContents.data.has_more, false);
  const movedContents = await get<CurrentOrderParcelsPage>(`/batches/${id("empty_batch")}/parcels`);
  assert.deepEqual(movedContents.data.items.map((row) => row.id), [id("parcel_25")]);
  await prisma.parcel.update({ where: { id: id("parcel_25") }, data: { order_id: id("order") } });
  // Race real HTTP observations with atomic controlled fixture updates. Each response must describe one committed state.
  const concurrentReads = Array.from({ length: 8 }, async () => {
    const response = await get<Page<MatchRow>>(`/matches${query({ ...range, search: id("route"), status: "proposed", limit: 50 })}`);
    assert([0, 10].includes(response.data.total)); assert.equal(response.data.items.length, response.data.total);
    assert(response.data.items.every((row) => row.status === "proposed"));
  });
  await prisma.match.updateMany({ where: { ...owned, status: "proposed" }, data: { status: "rejected" } });
  await Promise.all(concurrentReads);
  const shrunk = await get<Page<MatchRow>>(`/matches${query({ ...range, search: id("route"), status: "proposed", page: 2 })}`);
  assert.equal(shrunk.data.total, 0); assert.deepEqual(shrunk.data.items, []); assert.equal(shrunk.data.has_more, false);
  for (let iteration = 0; iteration < 4; iteration++) {
    const reads = Array.from({ length: 3 }, () => get<Observed<Overview>>(`/overview${query(range)}`));
    await prisma.parcelBatch.updateMany({ where: { id: id("batch_00") }, data: { status: iteration % 2 ? "created" : "proposed" } });
    for (const observation of await Promise.all(reads)) {
      const counts = observation.data.batches_by_status;
      assert.equal(observation.data.active_batches, counts.created + counts.assigned + counts.picked_up + counts.in_transit);
      assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), Object.values(overview.batches_by_status).reduce((sum, count) => sum + count, 0));
    }
  }
  phase = "volume setup";
  for (let offset = 0; offset < 10_000; offset += 1_000) {
    await prisma.match.createMany({ data: Array.from({ length: 1_000 }, (_, index) => matchData(`bulk_${String(offset + index).padStart(5, "0")}`, { status: "accepted" })) });
  }
  phase = "volume";
  const volumeSnapshot = await domainSnapshot();
  // Measure real HTTP before instrumented service calls so profiling cannot warm these reads first.
  for (let iteration = 0; iteration < 3; iteration++) {
    await get(`/overview${query(range)}`);
    const unfiltered = await get<Page<MatchRow>>(`/matches${query({ ...range, search: id("route"), limit: 25 })}`);
    assert.equal(unfiltered.data.total, 10_060); safePage(unfiltered, safeMatch);
    const result = await get<Page<MatchRow>>(`/matches${query({ ...range, search: id("route"), status: "accepted", page: 2, limit: 50 })}`);
    assert.equal(result.data.total, 10_010); safePage(result, safeMatch);
    assert.equal((await get<Page<MatchRow>>(`/matches${query({ ...range, search: id("bulk_00000") })}`)).data.total, 1);
    await get(`/matches/${id("bulk_00000")}`);
    await get(`/batches${query({ ...range, search: id("route"), limit: 50 })}`);
    await get(`/batches/${id("batch_00")}`);
    await get(`/batches/${id("batch_00")}/parcels`);
  }

  // Independently instrument the same production query service: SQL events count actual SQL,
  // not Prisma calls, and exclude the HTTP authSession read/touch overhead.
  const { PrismaClient } = await import("../generated/prisma/client.js");
  const { PrismaMariaDb } = await import("@prisma/adapter-mariadb");
  const { createMonitoringService } = await import("../services/adminMatchingMonitoring/service.js");
  const url = new URL(target.url!);
  const measured = new PrismaClient({ adapter: new PrismaMariaDb({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)), connectionLimit: 2 }), log: [{ emit: "event", level: "query" }] });
  let sqlCount = 0;
  const capturedQueries: { query: string; params: string; duration: number }[] = [];
  measured.$on("query", (event) => { sqlCount++; if (/^SELECT\b/i.test(event.query)) capturedQueries.push(event); });
  const service = createMonitoringService(measured);
  async function measure(label: string, operation: () => Promise<unknown>) {
    sqlCount = 0;
    const start = performance.now();
    try { await operation(); }
    catch (error) {
      console.log(JSON.stringify({ failed_service: label, sql_queries: sqlCount, elapsed_ms: Math.round(performance.now() - start), select_durations_ms: capturedQueries.map((entry) => entry.duration) }));
      throw error;
    }
    const elapsed = performance.now() - start;
    assert(elapsed < readBudgetMs, `${label} query budget exceeded`);
    assert(sqlCount > 0 && sqlCount <= 12, `${label} SQL query count must be bounded`);
    console.log(JSON.stringify({ service: label, sql_queries: sqlCount, elapsed_ms: Math.round(elapsed) }));
    return sqlCount;
  }
  try {
    const small = await measure("matches limit25", () => service.matches({ ...range, page: 1, limit: 25, search: id("route") }));
    const large = await measure("matches limit50", () => service.matches({ ...range, page: 1, limit: 50, search: id("route") }));
    assert.equal(small, large, "Match query count grows with page size (N+1)");
    await measure("matches exact-ID", () => service.matches({ ...range, page: 1, limit: 25, search: id("bulk_00000") }));
    await measure("matches status/date page2", () => service.matches({ ...range, page: 2, limit: 50, status: "accepted" }));
    await measure("overview", () => service.overview(range));
    await measure("match detail", () => service.match(id("bulk_00000")));
    const batches25 = await measure("batches limit25", () => service.batches({ ...range, page: 1, limit: 25, search: id("route") }));
    assert.equal(await measure("batches limit50", () => service.batches({ ...range, page: 1, limit: 50, search: id("route") })), batches25);
    await measure("batch detail", () => service.batch(id("batch_00")));
    await measure("current order parcels", () => service.parcels(id("batch_00"), { page: 1, limit: 25 }));
  } finally {
    try {
      const slowest = capturedQueries.slice().sort((left, right) => right.duration - left.duration)[0];
      assert(slowest, "Expected SELECT query evidence");
      // Explain the slowest observed read, even when every read is comfortably below budget.
      // Query text/parameters stay in memory; output contains only non-sensitive plan columns.
      const plan = await measured.$queryRawUnsafe<Record<string, unknown>[]>(`EXPLAIN ${slowest.query}`, ...JSON.parse(slowest.params) as unknown[]);
      console.log(JSON.stringify({ explain_slowest_select_ms: slowest.duration, plan: plan.map((row) => ({ table: row.table, access_type: row.type, key: row.key, estimated_rows: String(row.rows) })) }));
    } finally { await measured.$disconnect(); }
  }
  assert.equal(await domainSnapshot(), volumeSnapshot, "Volume GET/service reads wrote domain fixtures");
  for (const [endpoint, samples] of Object.entries(times)) console.log(JSON.stringify({ endpoint, samples: samples.length, max_elapsed_ms: Math.round(Math.max(...samples)), eligible_bulk_matches: 10_000 }));
  console.log("Monitoring MySQL integration passed: auth, six HTTP endpoints, exclusions, safe keys, dates/status, pagination, read-only snapshots, concurrency, 10,000-match volume");
} catch (error) {
  // Prisma errors may contain connection information: emit only the failing phase and safe assertion text.
  const frame = error instanceof Error ? error.stack?.match(/adminMatchingMonitoringIntegration\.js:\d+:\d+/)?.[0] : undefined;
  if (error instanceof assert.AssertionError) console.error(`Monitoring integration ${phase}${frame ? ` at ${frame}` : ""}: ${error.message}`);
  else {
    console.error(`Monitoring integration failed during ${phase}${frame ? ` at ${frame}` : ""}; details suppressed to protect connection information`);
  }
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch { console.error(`Monitoring fixture cleanup failed; inspect only disposable rows with prefix ${prefix}_`); process.exitCode = 1; }
  await prisma.$disconnect();
}
