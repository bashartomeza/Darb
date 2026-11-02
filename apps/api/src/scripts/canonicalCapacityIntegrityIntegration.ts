import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { DEMO_ACCOUNTS, DEMO_SERVICE_ROUTE_KEY, resetDemoData } from "../modules/demoReset.js";
import { createCapacityReservationService } from "../services/capacityReservations.js";
import { createDriverAvailabilityService } from "../services/driverAvailability.js";

const reservations = createCapacityReservationService(prisma);
const availability = createDriverAvailabilityService(prisma);
let assertions = 0;
const failures: string[] = [];
function check(value: unknown, message: string) {
  assertions += 1;
  if (!value) failures.push(message);
}
async function databaseNow() {
  const rows = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT UTC_TIMESTAMP(3) AS now`;
  return rows[0]!.now;
}
async function waitPast(deadline: Date) {
  while ((await databaseNow()) <= deadline) await new Promise((resolve) => setTimeout(resolve, 25));
}
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.MERCHANT_ORDER_INTEGRATION_CONFIRM_DISPOSABLE !== "true" || !url.pathname.endsWith("_ci") || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("disposable_loopback_database_required");
  }
  await resetDemoData(prisma);
  const driver = await prisma.user.findUniqueOrThrow({ where: { phone: DEMO_ACCOUNTS.driver1.phone } });
  const passenger = await prisma.user.findUniqueOrThrow({ where: { phone: DEMO_ACCOUNTS.passenger.phone } });
  const route = await prisma.serviceRoute.findUniqueOrThrow({ where: { route_key: DEMO_SERVICE_ROUTE_KEY } });
  const routeVersionId = route.current_version_id!;
  let departureOffset = 90;
  async function supply(label: string, versionId = routeVersionId) {
    const created = await availability.createOneOff({ routeVersionId: versionId, departureAt: new Date(Date.now() + departureOffset++ * 60_000), totalSeats: 3, totalParcelCapacity: 4 }, { id: driver.id, idempotencyKey: `canonical-integrity-${label}` });
    return availability.activate(created.resource.id, created.resource.availability_revision, { id: driver.id });
  }
  async function snapshot(driverRouteId: string, key: string) {
    const [row, held, released, expired, claims, audits] = await Promise.all([
      prisma.driverRoute.findUniqueOrThrow({ where: { id: driverRouteId } }),
      prisma.capacityReservation.count({ where: { driver_route_id: driverRouteId, status: "held" } }),
      prisma.capacityReservation.count({ where: { driver_route_id: driverRouteId, status: "released" } }),
      prisma.capacityReservation.count({ where: { driver_route_id: driverRouteId, status: "expired" } }),
      prisma.idempotencyRecord.count({ where: { operation: "capacity_hold", idempotency_key: createHash("sha256").update(key).digest("hex") } }),
      prisma.auditEvent.count({ where: { action: "capacity_reserved" } })
    ]);
    return { seats: row.remaining_seats, parcels: row.remaining_parcel_capacity, held, released, expired, claims, audits };
  }
  const replaySupply = await supply("replay");
  const key = "canonical-integrity-expired-replay";
  const input = { driverRouteId: replaySupply.id, routeVersionId, reservationType: "combined" as const, seatsReserved: 1, parcelUnitsReserved: 2, expiresAt: new Date((await databaseNow()).getTime() + 1_000) };
  const actor = { id: passenger.id, idempotencyKey: key };
  const original = await reservations.hold(input, actor);
  const held = await snapshot(replaySupply.id, key);
  check(held.seats === 2 && held.parcels === 2 && held.held === 1 && held.claims === 1 && held.audits === 1, "combined original hold consumes exactly one seat and two parcels");
  await waitPast(input.expiresAt);
  const expired = await reservations.expireBatch({ now: await databaseNow() });
  check(expired.expired === 1, "explicit expiry owns exactly one standalone hold");
  let replay;
  try { replay = await reservations.hold(input, actor); }
  catch (error) { console.log(JSON.stringify({ case: "expired_exact_replay", error: error instanceof Error ? error.message : "unknown" })); }
  check(replay?.replayed && replay.resource.id === original.resource.id && replay.resource.status === "expired", "same-key same-payload replay after expiry recovers saved reservation");
  const afterReplay = await snapshot(replaySupply.id, key);
  check(afterReplay.seats === 3 && afterReplay.parcels === 4 && afterReplay.held === 0 && afterReplay.expired === 1 && afterReplay.claims === 1 && afterReplay.audits === 1, "expired replay has no duplicate hold, claim, audit, or capacity decrement");
  console.log(JSON.stringify({ case: "expired_exact_replay", held, afterReplay }));

  const releaseSupply = await supply("release-control");
  const releaseKey = "canonical-integrity-release-control";
  const releasedHold = await reservations.hold({ ...input, driverRouteId: releaseSupply.id, expiresAt: new Date(Date.now() + 60_000) }, { id: passenger.id, idempotencyKey: releaseKey });
  await reservations.release(releasedHold.resource.id, "offer_cancelled", { id: passenger.id, idempotencyKey: "canonical-integrity-release" });
  const released = await snapshot(releaseSupply.id, releaseKey);
  check(released.seats === 3 && released.parcels === 4 && released.held === 0 && released.released === 1 && released.claims === 1, "independent combined release restores both dimensions once");
  console.log(JSON.stringify({ case: "combined_release_control", released }));

  for (const target of ["availability", "route"] as const) {
    const row = await supply(`lock-${target}`);
    const holdKey = `canonical-integrity-expired-${target}-wait`;
    const auditBefore = await prisma.auditEvent.count({ where: { action: "capacity_reserved" } });
    let unlock!: () => void;
    let signalLocked!: () => void;
    const unlockPromise = new Promise<void>((resolve) => { unlock = resolve; });
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      if (target === "availability") await tx.$queryRaw`SELECT id FROM driver_routes WHERE id = ${row.id} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM service_routes WHERE id = ${route.id} FOR UPDATE`;
      signalLocked();
      await unlockPromise;
    }, { timeout: 15_000 });
    await locked;
    const expiry = new Date((await databaseNow()).getTime() + 1_800);
    const waiting = reservations.hold({ ...input, driverRouteId: row.id, expiresAt: expiry }, { id: passenger.id, idempotencyKey: holdKey }).then((result) => ({ result, error: undefined }), (error: unknown) => ({ result: undefined, error }));
    let observedWait = false;
    try {
      const waitDeadline = Date.now() + 1_200;
      while (Date.now() < waitDeadline) {
        const waits = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits`;
        if (Number(waits[0]!.count) > 0) { observedWait = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await waitPast(new Date(expiry.getTime() + 50));
    } finally { unlock(); await blocker; }
    const outcome = await waiting;
    const after = await snapshot(row.id, holdKey);
    const errorCode = outcome.error instanceof Error ? outcome.error.message : undefined;
    check(observedWait, `${target} case observes real MySQL lock contention`);
    check(errorCode === "invalid_reservation_expiry", `${target} lock wait past hold expiry rejects new hold`);
    check(after.seats === 3 && after.parcels === 4, `${target} expired wait leaves both capacity dimensions unchanged`);
    check(after.held === 0 && after.released === 0 && after.expired === 0, `${target} expired wait persists no reservation`);
    check(after.claims === 0 && after.audits === auditBefore, `${target} expired wait rolls back idempotency claim and audit`);
    console.log(JSON.stringify({ case: `expired_${target}_lock_wait`, observedWait, rejected: Boolean(outcome.error), errorCode, after, auditBefore }));
  }
  {
    const baseVersion = await prisma.serviceRouteVersion.findUniqueOrThrow({ where: { id: routeVersionId }, include: { stops: { orderBy: { sequence: "asc" } } } });
    const scheduledRoute = await prisma.serviceRoute.create({ data: {
      route_key: "canonical-integrity-scheduled-route", route_group_key: route.route_group_key,
      service_region_key: route.service_region_key, direction: route.direction,
      created_by_user_id: route.created_by_user_id
    } });
    const cutoff = new Date((await databaseNow()).getTime() + 1_800);
    const scheduledVersion = await prisma.serviceRouteVersion.create({ data: {
      service_route_id: scheduledRoute.id, version_number: 1, status: "published",
      name_ar: baseVersion.name_ar, name_en: "TEST ONLY scheduled route",
      origin_stop_id: baseVersion.origin_stop_id, destination_stop_id: baseVersion.destination_stop_id,
      active_until: cutoff, published_at: await databaseNow(),
      created_by_user_id: route.created_by_user_id, published_by_user_id: route.created_by_user_id,
      stops: { create: baseVersion.stops.map((stop) => ({
        stop_id: stop.stop_id, sequence: stop.sequence,
        passenger_pickup: stop.passenger_pickup, passenger_dropoff: stop.passenger_dropoff,
        parcel_pickup: stop.parcel_pickup, parcel_dropoff: stop.parcel_dropoff
      })) }
    } });
    await prisma.serviceRoute.update({ where: { id: scheduledRoute.id }, data: { current_version_id: scheduledVersion.id } });
    const row = await supply("route-schedule-wait", scheduledVersion.id);
    const holdKey = "canonical-integrity-route-window-wait";
    const auditBefore = await prisma.auditEvent.count({ where: { action: "capacity_reserved" } });
    let unlock!: () => void;
    let signalLocked!: () => void;
    const unlockPromise = new Promise<void>((resolve) => { unlock = resolve; });
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM service_routes WHERE id = ${scheduledRoute.id} FOR UPDATE`;
      signalLocked();
      await unlockPromise;
    }, { timeout: 15_000 });
    await locked;
    const expiry = new Date((await databaseNow()).getTime() + 60_000);
    const waiting = reservations.hold({ ...input, routeVersionId: scheduledVersion.id, driverRouteId: row.id, expiresAt: expiry }, { id: passenger.id, idempotencyKey: holdKey }).then((result) => ({ result, error: undefined }), (error: unknown) => ({ result: undefined, error }));
    let observedWait = false;
    try {
      const waitDeadline = Date.now() + 1_200;
      while (Date.now() < waitDeadline) {
        const waits = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits`;
        if (Number(waits[0]!.count) > 0) { observedWait = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await waitPast(new Date(cutoff.getTime() + 50));
    } finally { unlock(); await blocker; }
    const outcome = await waiting;
    const observedNow = await databaseNow();
    const after = await snapshot(row.id, holdKey);
    const errorCode = outcome.error instanceof Error ? outcome.error.message : undefined;
    check(observedWait, "route schedule case observes real MySQL lock contention");
    check(observedNow > cutoff && observedNow < expiry, "route validity window ended while requested hold expiry remains valid");
    check(errorCode === "route_version_not_available", "route active_until crossed during lock wait rejects new hold");
    check(after.seats === 3 && after.parcels === 4, "elapsed route validity leaves both capacity dimensions unchanged");
    check(after.held === 0 && after.released === 0 && after.expired === 0, "elapsed route validity persists no reservation");
    check(after.claims === 0 && after.audits === auditBefore, "elapsed route validity rolls back idempotency claim and audit");
    console.log(JSON.stringify({ case: "route_validity_lock_wait", observedWait, requestedHoldStillValid: observedNow < expiry, routeWindowElapsed: observedNow > cutoff, rejected: Boolean(outcome.error), errorCode, after, auditBefore }));
  }
  console.log(JSON.stringify({ assertions, failures }));
  if (failures.length) throw new Error(`Canonical capacity integrity failed: ${failures.join("; ")}`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "canonical_integrity_failure"); process.exitCode = 1; }).finally(() => prisma.$disconnect());