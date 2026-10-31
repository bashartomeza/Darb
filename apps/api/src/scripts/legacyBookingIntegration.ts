import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import request from "supertest";
import type { Prisma } from "../generated/prisma/client.js";

assert(process.env.CI_MYSQL_LOOPBACK_QA === "true", "disposable_harness_required");
let url: URL;
try { url = new URL(process.env.DATABASE_URL!); }
catch { throw new Error("isolated_database_required"); }
assert(["127.0.0.1", "localhost"].includes(url.hostname), "loopback_database_required");
assert(/^masari_functional_[a-z_]+_[0-9a-f]{10}_ci$/.test(url.pathname.slice(1)), "isolated_database_required");
assert(url.protocol === "mysql:" && Number(url.port) > 0 && url.port !== "3306", "isolated_mysql_port_required");

const { createApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { signAuthToken } = await import("../middleware/auth.js");
const { createLegacyPassengerCreationService } = await import("../services/legacyPassengerCreation.js");
const { reserveLegacyCapacity } = await import("../services/legacyCapacity.js");
const { createCanonicalDemandService } = await import("../services/canonicalDemand.js");
const { createDriverAvailabilityService } = await import("../services/driverAvailability.js");

const prefix = `booking_${randomUUID()}`;
const phonePrefix = `+97059${randomInt(10000, 99999)}`;
let phoneSequence = 0;
function completeIdentity(suffix: string) {
  return { phone: `${phonePrefix}${String(++phoneSequence).padStart(2, "0")}`,
    email: `${prefix}.${suffix}@example.invalid`, profile_state: "complete" as const,
    phone_verified_at: new Date(), email_verified_at: new Date() };
}
const app = createApp();
const server = createServer(app);
let assertions = 0;
function check(value: unknown, message: string) {
  assert(value, message);
  assertions += 1;
}

try {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const users = await Promise.all([1, 2].map(index => prisma.user.create({ data: {
    name: `${prefix}_${index}`, role: "passenger", ...completeIdentity(`passenger${index}`),
    account_status: "active", email_verified_at: new Date(), demo_account: true,
  } })));
  const tokens = await Promise.all(users.map(async user => {
    const session = await prisma.authSession.create({ data: {
      user_id: user.id, client_type: "mobile", security_version_at_issue: user.security_version,
      expires_at: new Date(Date.now() + 3_600_000),
    } });
    return signAuthToken({ id: user.id, role: "passenger", sessionId: session.id, securityVersion: user.security_version });
  }));
  const body = {
    pickup_label: prefix, pickup_lat: 31.5326, pickup_lng: 35.0998,
    destination_label: "QA Bethlehem", destination_lat: 31.7054, destination_lng: 35.2024,
    preferred_time: new Date(Date.now() + 3_600_000).toISOString(), passenger_count: 1,
  };
  const key = `${prefix}_concurrent`;
  const post = (actor: number, payload: typeof body, idempotencyKey?: string) => {
    const operation = request(server).post("/api/v1/passenger/requests").set("Authorization", `Bearer ${tokens[actor]}`);
    if (idempotencyKey) operation.set("Idempotency-Key", idempotencyKey);
    return operation.send(payload);
  };
  const concurrent = await Promise.all(Array.from({ length: 10 }, () => post(0, body, key)));
  check(concurrent.every(response => response.status === 201), "concurrent HTTP retries all succeed");
  const id = concurrent[0]!.body.request.id as string;
  check(concurrent.every(response => response.body.request.id === id), "ten retries return the same committed resource");
  check(await prisma.passengerRequest.count({ where: { passenger_id: users[0]!.id, pickup_label: prefix } }) === 1,
    "one request exists after ten concurrent retries");
  check(await prisma.auditEvent.count({ where: { entity_id: id, action: "passenger_request_created" } }) === 1,
    "one mandatory creation audit exists");
  check(await prisma.idempotencyRecord.count({ where: { resource_id: id, state: "completed" } }) === 1,
    "one completed idempotency record exists");
  const replay = await post(0, body, key);
  check(replay.status === 201 && replay.body.request.id === id, "lost response recovers original identity");
  check((await post(0, { ...body, passenger_count: 2 }, key)).status === 409, "changed payload conflicts");
  const other = await post(1, body, key);
  check(other.status === 201 && other.body.request.id !== id, "same key is scoped to actor");
  await prisma.idempotencyRecord.updateMany({ where: { resource_id: id }, data: { expires_at: new Date(0) } });
  const retained = await post(0, body, key);
  check(retained.status === 201 && retained.body.request.id === id, "completed identity survives retention timestamp");
  check((await post(0, { ...body, pickup_lat: 31.532601 }, key)).status === 409, "retained key rejects changed coordinate");

  // Fail only the audit delegate inside a real interactive transaction.
  const failingDb = new Proxy(prisma, {
    get(target, property, receiver) {
      if (property !== "$transaction") return Reflect.get(target, property, receiver);
      return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) =>
        target.$transaction(tx => callback(new Proxy(tx, {
          get(transaction, delegate, transactionReceiver) {
            if (delegate === "auditEvent") return { create: async () => { throw new Error("qa_injected_audit_failure"); } };
            return Reflect.get(transaction, delegate, transactionReceiver);
          },
        })), options);
    },
  });
  const failureInput = { ...body, pickup_label: `${prefix}_audit_failure`, preferred_time: new Date(body.preferred_time) };
  const failureActor = { id: users[0]!.id, idempotencyKey: `${prefix}_audit_failure` };
  await assert.rejects(createLegacyPassengerCreationService(failingDb).create(failureInput, failureActor), /qa_injected_audit_failure/);
  check(await prisma.passengerRequest.count({ where: { passenger_id: users[0]!.id, pickup_label: failureInput.pickup_label } }) === 0,
    "real transaction rolls request back after audit failure");
  const service = createLegacyPassengerCreationService(prisma);
  const retried = await service.create(failureInput, failureActor);
  check(!retried.replayed, "same key claims normally after failed transaction rollback");
  const retriedReplay = await service.create(failureInput, failureActor);
  check(retriedReplay.replayed && retriedReplay.resource.id === retried.resource.id, "retry after audit failure remains replayable");
  check((await post(0, { ...body, pickup_label: `${prefix}_without_header` })).status === 201, "legacy no-header client remains compatible");
  const driver = await prisma.user.create({ data: { name: `${prefix}_driver`, ...completeIdentity("driver"), role: "driver",
    account_status: "active", email_verified_at: new Date(), demo_account: true,
    driver_profile: { create: { vehicle_type: "QA", seats_total: 4, parcel_capacity: 5, verified: true } },
  }, include: { driver_profile: true } });
  const driverSession = await prisma.authSession.create({ data: { user_id: driver.id, client_type: "mobile",
    security_version_at_issue: 1, expires_at: new Date(Date.now() + 3_600_000) } });
  const driverToken = signAuthToken({ id: driver.id, role: "driver", sessionId: driverSession.id, securityVersion: 1 });
  const createRoute = (seats = 2) => request(server).post("/api/v1/driver/routes")
    .set("Authorization", `Bearer ${driverToken}`).set("Idempotency-Key", `${prefix}_driver_route`)
    .send({ seats_available: seats, parcel_capacity_available: 5 });
  const routeRetries = await Promise.all(Array.from({ length: 10 }, () => createRoute()));
  check(routeRetries.every(response => response.status === 201), "concurrent driver form retries succeed");
  const routeId = routeRetries[0]!.body.route.id;
  check(routeRetries.every(response => response.body.route.id === routeId), "driver form retries recover one route");
  check(await prisma.driverRoute.count({ where: { driver_id: driver.driver_profile!.id } }) === 1, "driver has one operational route");
  check(await prisma.auditEvent.count({ where: { entity_id: routeId, action: "driver_route_created" } }) === 1, "driver route has one creation audit");
  check((await createRoute(3)).status === 409, "conflicting driver route form cannot create another route");
  check((await post(0, { ...body, preferred_time: new Date(Date.now() - 1_000).toISOString() }, `${prefix}_past`)).status === 400,
    "past preferred departure is rejected before creation");
  const search = () => request(server).post("/api/v1/matches/search").set("Authorization", `Bearer ${tokens[0]}`).send(body);
  const selectedRoute = () => request(server).post("/api/v1/matches/run").set("Authorization", `Bearer ${tokens[0]}`)
    .send({ passengerRequestId: id, driverRouteId: routeId });
  check((await search()).body.results.some((candidate: { id: string }) => candidate.id === routeId), "undated active supply is visible");
  for (const invalidTiming of [
    { departure_at: new Date(0), departed_at: null, availability_window_end: null },
    { departure_at: null, departed_at: new Date(0), availability_window_end: null },
    { departure_at: null, departed_at: null, availability_window_end: new Date(0) },
  ]) {
    await prisma.driverRoute.update({ where: { id: routeId }, data: invalidTiming });
    check(!(await search()).body.results.some((candidate: { id: string }) => candidate.id === routeId), "stale-active timing excludes preview candidate");
    check((await selectedRoute()).status === 409, "stale-active selected route cannot be booked");
    await assert.rejects(prisma.$transaction(tx => reserveLegacyCapacity(tx, { driverRouteId: routeId, seats: 1, parcelUnits: 0 })),
      { message: 'selected_driver_route_unavailable', statusCode: 409 });
    const capacity = await prisma.driverRoute.findUniqueOrThrow({ where: { id: routeId } });
    check(capacity.seats_available === 2, "atomic timing guard leaves capacity unchanged");
  }
  await prisma.driverRoute.update({ where: { id: routeId }, data: { departure_at: null, departed_at: null, availability_window_end: null } });
  const offer = await selectedRoute();
  check(offer.status === 201, "undated legacy route can create selected match");
  const reservedRouteReplay = await createRoute();
  check(reservedRouteReplay.status === 201 && reservedRouteReplay.body.route.id === routeId && reservedRouteReplay.body.route.seats_available === 1,
    "driver keyed retry recovers original route after a held seat changes capacity");
  const matchId = offer.body.match.id as string;
  const accept = () => request(server).post(`/api/v1/matches/${matchId}/accept`).set("Authorization", `Bearer ${driverToken}`);
  await prisma.match.update({ where: { id: matchId }, data: { expires_at: new Date(0) } });
  check((await accept()).status === 409, "expired match cannot be accepted");
  await prisma.match.update({ where: { id: matchId }, data: { expires_at: new Date(Date.now() + 600_000) } });
  for (const invalidTiming of [
    { departure_at: new Date(0), departed_at: null, availability_window_end: null },
    { departure_at: null, departed_at: new Date(0), availability_window_end: null },
    { departure_at: null, departed_at: null, availability_window_end: new Date(0) },
  ]) {
    await prisma.driverRoute.update({ where: { id: routeId }, data: invalidTiming });
    check((await accept()).status === 409, "stale-active route timing prevents match acceptance");
  }
  check(await prisma.trip.count({ where: { passenger_request_id: id } }) === 0, "invalid acceptance attempts leave no trip");
  await prisma.driverRoute.update({ where: { id: routeId }, data: { departure_at: null, departed_at: null, availability_window_end: null } });
  check((await accept()).status === 201, "undated active legacy route remains acceptable");
  await prisma.idempotencyRecord.updateMany({ where: { resource_id: routeId, operation: "legacy_driver_route_create_v1" }, data: { expires_at: new Date(0) } });
  await prisma.driverRoute.update({ where: { id: routeId }, data: { status: "completed", completed_at: new Date() } });
  const completedRouteReplay = await createRoute();
  check(completedRouteReplay.status === 201 && completedRouteReplay.body.route.id === routeId && completedRouteReplay.body.route.status === "completed",
    "driver keyed retry recovers original completed route beyond retention timestamp");
  check(await prisma.driverRoute.count({ where: { driver_id: driver.driver_profile!.id, operational_mode: "legacy" } }) === 1,
    "completed keyed driver retry never creates another legacy route");

  // A bound Date (and MySQL CURRENT_TIMESTAMP in a statement that waits) can
  // become stale while InnoDB acquires the request or capacity row lock.
  // Every expired case must roll back the demand claim and the capacity hold.
  const alternativeDriver = await prisma.user.create({ data: {
    name: `${prefix}_alternative_driver`, ...completeIdentity("alternative_driver"), role: "driver",
    account_status: "active", demo_account: true,
    driver_profile: { create: { vehicle_type: "QA", seats_total: 4, parcel_capacity: 5, verified: true, trust_score: 95 } },
  }, include: { driver_profile: true } });
  const alternativeRoute = await prisma.driverRoute.create({ data: {
    driver_id: alternativeDriver.driver_profile!.id,
    origin_label: "Hebron / PPU / Bab Al-Zawiya", origin_lat: body.pickup_lat, origin_lng: body.pickup_lng,
    destination_label: "Bethlehem", destination_lat: body.destination_lat, destination_lng: body.destination_lng,
    corridor_key: "hebron-ppu-bab-al-zawiya-to-bethlehem", status: "active", seats_available: 2, parcel_capacity_available: 5,
  } });
  const creationBarriers: Array<{ probe: string; passed: boolean }> = [];
  for (const scenario of [
    { name: "request_lock_demand_deadline", lock: "request", deadline: "demand" },
    { name: "route_lock_demand_deadline", lock: "route", deadline: "demand" },
    { name: "route_lock_departure_deadline", lock: "route", deadline: "departure" },
    { name: "route_lock_window_deadline", lock: "route", deadline: "window" },
    { name: "route_lock_future_control", lock: "route", deadline: "future" },
  ] as const) {
    await prisma.driverRoute.update({ where: { id: routeId }, data: {
      status: "active", seats_available: 2, parcel_capacity_available: 5,
      completed_at: null, departure_at: null, departed_at: null, availability_window_end: null,
    } });
    if (scenario.deadline === "future") {
      const preview = await search();
      const selected = preview.body.results?.find((candidate: { id: string }) => candidate.id === routeId);
      check(preview.status === 200 && preview.body.results[0]?.id === alternativeRoute.id &&
        selected && preview.body.results[0].score > selected.score,
      "future control explicitly selects a route behind an eligible higher-ranked alternative");
      console.log(JSON.stringify({ probe: "selected_route_score_control", selected_score: selected.score,
        alternative_score: preview.body.results[0].score, alternative_ranked_first: true }));
    }
    const createdRequest = await post(0, { ...body, pickup_label: `${prefix}_${scenario.name}` }, `${prefix}_${scenario.name}`);
    check(createdRequest.status === 201, `${scenario.name}: demand starts valid`);
    const demandId = createdRequest.body.request.id as string;
    const auditWhere = { user_id: users[0]!.id, action: "match_decision" as const, entity_type: "Match" };
    const auditsBefore = await prisma.auditEvent.count({ where: auditWhere });
    const expires = scenario.deadline !== "future";
    const deadline = new Date(Date.now() + (expires ? 2_500 : 60_000));
    if (scenario.deadline === "demand") {
      await prisma.passengerRequest.update({ where: { id: demandId }, data: { preferred_time: deadline } });
    } else if (scenario.deadline === "departure" || scenario.deadline === "window") {
      await prisma.driverRoute.update({ where: { id: routeId }, data: scenario.deadline === "departure"
        ? { departure_at: deadline } : { availability_window_end: deadline } });
    }
    let release!: () => void;
    let ready!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { ready = resolve; });
    const holder = prisma.$transaction(async tx => {
      if (scenario.lock === "request") await tx.$queryRaw`SELECT id FROM passenger_requests WHERE id = ${demandId} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM driver_routes WHERE id = ${routeId} FOR UPDATE`;
      ready();
      await released;
    }, { timeout: 15_000 });
    await Promise.race([locked, holder.then(() => { throw new Error("creation_barrier_lock_ended_early"); })]);
    const started = Date.now();
    const blocked = request(server).post("/api/v1/matches/run").set("Authorization", `Bearer ${tokens[0]}`)
      .send({ passengerRequestId: demandId, driverRouteId: routeId }).then(response => response);
    const table = scenario.lock === "request" ? "passenger_requests" : "driver_routes";
    let observed = false;
    let releasedAt = 0;
    let releasedAtDb = 0;
    try {
      while (Date.now() < Math.min(deadline.getTime(), started + 2_000)) {
        const waits = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits waits
          INNER JOIN performance_schema.data_locks locks ON locks.ENGINE = waits.ENGINE
            AND locks.ENGINE_LOCK_ID = waits.REQUESTING_ENGINE_LOCK_ID
          WHERE locks.OBJECT_SCHEMA = DATABASE() AND locks.OBJECT_NAME = ${table}
        `;
        if (Number(waits[0]?.count) > 0 && Date.now() < deadline.getTime()) { observed = true; break; }
        await delay(25);
      }
      if (observed && expires) await delay(Math.max(0, deadline.getTime() - Date.now() + 150));
    } finally {
      try {
        const clock = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT UTC_TIMESTAMP(3) AS now`;
        releasedAtDb = clock[0]!.now.getTime();
      } finally {
        releasedAt = Date.now();
        release();
        await holder;
      }
    }
    const response = await blocked;
    const [demandRow, routeRow, offers, trips, alternative, auditsAfter] = await Promise.all([
      prisma.passengerRequest.findUniqueOrThrow({ where: { id: demandId } }),
      prisma.driverRoute.findUniqueOrThrow({ where: { id: routeId } }),
      prisma.match.findMany({ where: { passenger_request_id: demandId } }),
      prisma.trip.count({ where: { passenger_request_id: demandId } }),
      prisma.driverRoute.findUniqueOrThrow({ where: { id: alternativeRoute.id } }),
      prisma.auditEvent.count({ where: auditWhere }),
    ]);
    const rollback = demandRow.status === "pending" && routeRow.seats_available === 2 && offers.length === 0 &&
      trips === 0 && auditsAfter === auditsBefore;
    const futureBinding = response.status === 201 && offers.length === 1 && offers[0]!.driver_route_id === routeId &&
      offers[0]!.legacy_capacity_held && routeRow.seats_available === 1 && demandRow.status === "matched" && auditsAfter === auditsBefore + 1;
    const passed = observed && alternative.seats_available === 2 &&
      (expires ? releasedAtDb > deadline.getTime() && response.status === 409 && rollback : futureBinding);
    creationBarriers.push({ probe: scenario.name, passed });
    console.log(JSON.stringify({ probe: scenario.name, observed_mysql_lock_wait: observed, table,
      deadline_ms: deadline.getTime(), released_at_ms: releasedAt, released_at_db_ms: releasedAtDb, elapsed_ms: Date.now() - started,
      http_status: response.status, demand_status: demandRow.status, seats_available: routeRow.seats_available,
      offer_count: offers.length, held_offer_count: offers.filter(offer => offer.legacy_capacity_held).length,
      trip_count: trips, selected_route_bound: offers[0]?.driver_route_id === routeId,
      match_decision_audits_before: auditsBefore, match_decision_audits_after: auditsAfter,
      alternative_seats_available: alternative.seats_available, passed }));
    // Isolate subsequent cases even on RED: these are disposable synthetic rows.
    await prisma.auditEvent.deleteMany({ where: { entity_id: { in: offers.map(offer => offer.id) } } });
    await prisma.match.deleteMany({ where: { passenger_request_id: demandId } });
  }
  await prisma.driverRoute.update({ where: { id: routeId }, data: { status: "completed", completed_at: new Date(),
    seats_available: 2, departure_at: null, availability_window_end: null } });
  const unavailableDemand = await post(0, { ...body, pickup_label: `${prefix}_unavailable_choice` }, `${prefix}_unavailable_choice`);
  check(unavailableDemand.status === 201, "unavailable-choice demand starts valid");
  const unavailableChoice = await request(server).post("/api/v1/matches/run").set("Authorization", `Bearer ${tokens[0]}`)
    .send({ passengerRequestId: unavailableDemand.body.request.id, driverRouteId: routeId });
  check(unavailableChoice.status === 409 &&
    await prisma.match.count({ where: { passenger_request_id: unavailableDemand.body.request.id } }) === 0 &&
    (await prisma.driverRoute.findUniqueOrThrow({ where: { id: alternativeRoute.id } })).seats_available === 2,
  "unavailable selected route never silently falls back to eligible alternative supply");
  await prisma.driverRoute.update({ where: { id: alternativeRoute.id }, data: { status: "completed", completed_at: new Date() } });
  check(creationBarriers.every(result => result.passed), `creation deadline lock barriers: ${JSON.stringify(creationBarriers)}`);

  const barrierRouteResponse = await request(server).post("/api/v1/driver/routes").set("Authorization", `Bearer ${driverToken}`)
    .set("Idempotency-Key", `${prefix}_barrier_route`).send({ seats_available: 2, parcel_capacity_available: 0 });
  check(barrierRouteResponse.status === 201, "deadline barrier has undated driver supply");
  const barrierRouteId = barrierRouteResponse.body.route.id as string;
  let deadline = new Date(Date.now() + 10_000);
  const barrierRequest = await post(0, { ...body, pickup_label: `${prefix}_barrier`, preferred_time: deadline.toISOString() }, `${prefix}_barrier_request`);
  check(barrierRequest.status === 201, "deadline barrier passenger starts valid");
  const barrierRequestId = barrierRequest.body.request.id as string;
  const barrierMatch = await request(server).post("/api/v1/matches/run").set("Authorization", `Bearer ${tokens[0]}`)
    .send({ passengerRequestId: barrierRequestId, driverRouteId: barrierRouteId });
  check(barrierMatch.status === 201, "deadline barrier has a long-lived proposed match");
  const barrierMatchId = barrierMatch.body.match.id as string;
  // Keep HTTP fixture setup outside the short real lock-wait deadline, which
  // must fit within the application's normal interactive transaction timeout.
  deadline = new Date(Date.now() + 2_500);
  await prisma.passengerRequest.update({ where: { id: barrierRequestId }, data: { preferred_time: deadline } });
  let releaseLock!: () => void;
  let signalLocked!: () => void;
  const lockRelease = new Promise<void>(resolve => { releaseLock = resolve; });
  const lockReady = new Promise<void>(resolve => { signalLocked = resolve; });
  const holder = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM passenger_requests WHERE id = ${barrierRequestId} FOR UPDATE`;
    signalLocked();
    await lockRelease;
  }, { timeout: 15_000 });
  await Promise.race([lockReady, holder.then(() => { throw new Error("barrier_lock_ended_early"); })]);
  const blockedAccept = request(server).post(`/api/v1/matches/${barrierMatchId}/accept`)
    .set("Authorization", `Bearer ${driverToken}`).then(response => response);
  let observedWaitBeforeDeadline = false;
  const barrierStartedAt = Date.now();
  try {
    while (Date.now() < deadline.getTime()) {
      const waiting = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM performance_schema.data_lock_waits waits
        INNER JOIN performance_schema.data_locks locks
          ON locks.ENGINE = waits.ENGINE
          AND locks.ENGINE_LOCK_ID = waits.REQUESTING_ENGINE_LOCK_ID
        WHERE locks.OBJECT_SCHEMA = DATABASE()
          AND locks.OBJECT_NAME = 'passenger_requests'
      `;
      if (Number(waiting[0]?.count) > 0 && Date.now() < deadline.getTime()) { observedWaitBeforeDeadline = true; break; }
      await delay(25);
    }
    if (observedWaitBeforeDeadline) await delay(Math.max(0, deadline.getTime() - Date.now() + 150));
  } finally {
    releaseLock();
    await holder;
  }
  const barrierAcceptance = await blockedAccept;
  console.log(JSON.stringify({ probe: "passenger_deadline_lock_barrier", observedWaitBeforeDeadline,
    elapsed_ms: Date.now() - barrierStartedAt, acceptance_status: barrierAcceptance.status }));
  check(observedWaitBeforeDeadline, "real MySQL UPDATE waited on a passenger lock while the deadline was still future");
  check(barrierAcceptance.status === 409, "deadline crossed during row lock wait prevents acceptance");
  check(await prisma.trip.count({ where: { passenger_request_id: barrierRequestId } }) === 0, "deadline barrier leaves no trip");
  const barrierDemand = await prisma.passengerRequest.findUniqueOrThrow({ where: { id: barrierRequestId } });
  const barrierOffer = await prisma.match.findUniqueOrThrow({ where: { id: barrierMatchId } });
  const barrierRoute = await prisma.driverRoute.findUniqueOrThrow({ where: { id: barrierRouteId } });
  check(barrierDemand.status === "matched" && barrierOffer.status === "proposed" && barrierRoute.status === "active",
    "deadline barrier rolls request, match and route claims back");

  const admin = await prisma.user.create({ data: { name: `${prefix}_admin`, ...completeIdentity("admin"), role: "admin", demo_account: true } });
  const merchant = await prisma.user.create({ data: { name: `${prefix}_merchant`, ...completeIdentity("merchant"), role: "merchant", demo_account: true } });
  const [origin, destination] = await Promise.all([
    prisma.stop.create({ data: { stop_key: `${prefix}_origin`, service_region_key: "qa", name_ar: "بداية", name_en: "QA origin",
      latitude: "31.532600", longitude: "35.099800", created_by_user_id: admin.id } }),
    prisma.stop.create({ data: { stop_key: `${prefix}_destination`, service_region_key: "qa", name_ar: "نهاية", name_en: "QA destination",
      latitude: "31.705400", longitude: "35.202400", created_by_user_id: admin.id } }),
  ]);
  const stable = await prisma.serviceRoute.create({ data: { route_key: prefix, route_group_key: prefix,
    service_region_key: "qa", direction: "outbound", created_by_user_id: admin.id } });
  const version = await prisma.serviceRouteVersion.create({ data: { service_route_id: stable.id, version_number: 1,
    status: "published", name_ar: "اختبار استعادة الحجز", name_en: "QA booking recovery", origin_stop_id: origin.id,
    destination_stop_id: destination.id, created_by_user_id: admin.id, published_by_user_id: admin.id, published_at: new Date(),
    stops: { create: [
      { stop_id: origin.id, sequence: 1, passenger_pickup: true, passenger_dropoff: false, parcel_pickup: true, parcel_dropoff: false },
      { stop_id: destination.id, sequence: 2, passenger_pickup: false, passenger_dropoff: true, parcel_pickup: false, parcel_dropoff: true },
    ] },
  } });
  await prisma.serviceRoute.update({ where: { id: stable.id }, data: { current_version_id: version.id } });
  const demand = createCanonicalDemandService(prisma);
  const availability = createDriverAvailabilityService(prisma);
  const from = new Date(Date.now() + 5_400_000);
  const until = new Date(from.getTime() + 3_600_000);
  const passengerInput = { routeVersionId: version.id, pickupStopId: origin.id, dropoffStopId: destination.id,
    requestedDepartureFrom: from, requestedDepartureUntil: until, passengerCount: 1 };
  const merchantInput = { routeVersionId: version.id, pickupStopId: origin.id, requestedDepartureFrom: from,
    requestedDepartureUntil: until, parcels: [{ destinationStopId: destination.id, size: "S" as const, priority: "normal" as const }] };
  const driverInput = { routeVersionId: version.id, departureAt: from, availabilityWindowEnd: until, totalSeats: 1, totalParcelCapacity: 0 };
  const passengerActor = { id: users[0]!.id, idempotencyKey: `${prefix}_canonical_passenger` };
  const merchantActor = { id: merchant.id, idempotencyKey: `${prefix}_canonical_merchant` };
  const driverActor = { id: driver.id, idempotencyKey: `${prefix}_canonical_driver` };
  const createdPassenger = await demand.createPassengerRequest(passengerInput, passengerActor);
  const createdMerchant = await demand.createMerchantOrder(merchantInput, merchantActor);
  const createdDriver = await availability.createOneOff(driverInput, driverActor);
  const canonicalIds = [createdPassenger.resource.id, createdMerchant.resource.id, createdDriver.resource.id];
  await prisma.idempotencyRecord.updateMany({ where: { resource_id: { in: canonicalIds } }, data: { expires_at: new Date(0) } });
  // Advance only this disposable probe process's clock after valid real-DB creation.
  const actualDate = Date;
  const afterDeparture = from.getTime() + 2 * 86_400_000;
  globalThis.Date = new Proxy(actualDate, {
    construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [afterDeparture], newTarget); },
    get(target, property, receiver) { return property === "now" ? () => afterDeparture : Reflect.get(target, property, receiver); },
  });
  try {
    const passengerReplay = await demand.createPassengerRequest(passengerInput, passengerActor);
    check(passengerReplay.replayed && passengerReplay.resource.id === canonicalIds[0], "canonical passenger recovers after departure and TTL");
    const merchantReplay = await demand.createMerchantOrder(merchantInput, merchantActor);
    check(merchantReplay.replayed && merchantReplay.resource.id === canonicalIds[1], "canonical merchant recovers after departure and TTL");
    const driverReplay = await availability.createOneOff(driverInput, driverActor);
    check(driverReplay.replayed && driverReplay.resource.id === canonicalIds[2], "canonical driver recovers after departure and TTL");
    await assert.rejects(demand.createPassengerRequest({ ...passengerInput, passengerCount: 2 }, passengerActor), /idempotency_conflict/);
    await assert.rejects(demand.createMerchantOrder({ ...merchantInput, parcels: [{ ...merchantInput.parcels[0]!, size: "M" }] }, merchantActor), /idempotency_conflict/);
    await assert.rejects(availability.createOneOff({ ...driverInput, totalSeats: 2 }, driverActor), /idempotency_conflict/);
    assertions += 3;
    await assert.rejects(demand.createPassengerRequest(passengerInput, { ...passengerActor, id: users[1]!.id }), /departure_window_out_of_range/);
    assertions += 1;
  } finally {
    globalThis.Date = actualDate;
  }
  check(await prisma.idempotencyRecord.count({ where: { resource_id: { in: canonicalIds }, state: "completed", claim_version: 1 } }) === 3,
    "canonical retained replays do not replace original completed claims");
  console.log(JSON.stringify({ integration: "legacy_booking_recovery", assertions, status: "passed" }));
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
}
