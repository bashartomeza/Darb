import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { DEMO_ACCOUNTS, DEMO_SERVICE_ROUTE_KEY, DEMO_STOP_KEYS, resetDemoData } from "../modules/demoReset.js";
import { createCanonicalDemandService } from "../services/canonicalDemand.js";
import { createCapacityReservationService } from "../services/capacityReservations.js";
import { createDriverAvailabilityService } from "../services/driverAvailability.js";
import { requireEligibleOperationalRoute } from "../services/operationalRouteEligibility.js";

let checks = 0;
function check(condition: unknown, message: string) {
  if (!condition) throw new Error(`M7C1 integration check failed: ${message}`);
  checks += 1;
}
async function rejects(work: () => Promise<unknown>, pattern: RegExp, message: string) {
  try {
    await work();
  } catch (error) {
    if (!pattern.test(String(error))) throw new Error(`M7C1 integration check failed: ${message}`);
    return;
  }
  throw new Error(`M7C1 integration check failed: ${message}`);
}

const driverService = createDriverAvailabilityService(prisma);
const demandService = createCanonicalDemandService(prisma);
const capacityService = createCapacityReservationService(prisma);

async function createAvailability(input: {
  driverId: string;
  routeVersionId: string;
  departureOffsetMinutes: number;
  seats: number;
  parcels: number;
  key: string;
}) {
  const departureAt = new Date(Date.now() + input.departureOffsetMinutes * 60_000);
  const created = await driverService.createOneOff(
    {
      routeVersionId: input.routeVersionId,
      departureAt,
      availabilityWindowEnd: new Date(departureAt.getTime() + 30 * 60_000),
      totalSeats: input.seats,
      totalParcelCapacity: input.parcels
    },
    { id: input.driverId, requestId: randomUUID(), idempotencyKey: input.key }
  );
  const active = await driverService.activate(created.resource.id, created.resource.availability_revision, {
    id: input.driverId,
    requestId: randomUUID()
  });
  return active;
}

async function main() {
  const database = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  check(database.endsWith("_ci"), "disposable database suffix");
  const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  check(migrations.length > 0, "migration history is present");
  check(migrations.some((migration) => migration.migration_name === "20260722130000_multi_route_operational_foundation"), "M7C1 migration current");
  check(migrations.some((migration) => migration.migration_name === "20260722180000_harden_multi_route_operations"), "M7C1 review hardening migration current");
  check(migrations.some((migration) => migration.migration_name === "20260722200000_enforce_operational_mode_and_expiry_quarantine"), "M7C1 follow-up hardening migration current");
  check(migrations.some((migration) => migration.migration_name === "20260727110000_harden_canonical_assignment_integrity"), "M7C3A assignment hardening migration current");

  await resetDemoData(prisma);
  const [admin, passenger, driver1, driver2, merchant] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { phone: DEMO_ACCOUNTS.admin.phone } }),
    prisma.user.findUniqueOrThrow({ where: { phone: DEMO_ACCOUNTS.passenger.phone } }),
    prisma.user.findUniqueOrThrow({ where: { phone: DEMO_ACCOUNTS.driver1.phone } }),
    prisma.user.findUniqueOrThrow({ where: { phone: DEMO_ACCOUNTS.driver2.phone } }),
    prisma.user.findUniqueOrThrow({ where: { phone: DEMO_ACCOUNTS.merchant.phone } })
  ]);
  const route = await prisma.serviceRoute.findUniqueOrThrow({
    where: { route_key: DEMO_SERVICE_ROUTE_KEY },
    include: { current_version: { include: { stops: { include: { stop: true }, orderBy: { sequence: "asc" } } } } }
  });
  const version = route.current_version!;
  const origin = version.stops.find((membership) => membership.stop.stop_key === DEMO_STOP_KEYS.origin)!;
  const pickup = version.stops.find((membership) => membership.stop.stop_key === DEMO_STOP_KEYS.passengerPickup)!;
  const destination = version.stops.find((membership) => membership.stop.stop_key === DEMO_STOP_KEYS.destination)!;
  check((await requireEligibleOperationalRoute(prisma, version.id)).stops.length === 3, "published current route eligible");
  check(version.name_ar.includes("الخليل") && destination.stop.name_ar === "وسط بيت لحم", "canonical Arabic text round-trips");

  const second = await prisma.$transaction(async (tx) => {
    const [a, b] = await Promise.all([
      tx.stop.create({ data: { stop_key: "m7c1-second-origin", service_region_key: "south-west-bank", name_ar: "بداية ثانية", name_en: "Second origin", latitude: "31.600000", longitude: "35.120000", created_by_user_id: admin.id } }),
      tx.stop.create({ data: { stop_key: "m7c1-second-destination", service_region_key: "south-west-bank", name_ar: "نهاية ثانية", name_en: "Second destination", latitude: "31.650000", longitude: "35.160000", created_by_user_id: admin.id } })
    ]);
    const stable = await tx.serviceRoute.create({ data: { route_key: "m7c1-second-route", route_group_key: "m7c1-second", service_region_key: "south-west-bank", direction: "outbound", created_by_user_id: admin.id } });
    const current = await tx.serviceRouteVersion.create({ data: { service_route_id: stable.id, version_number: 1, status: "published", name_ar: "مسار ثان", name_en: "Second route", origin_stop_id: a.id, destination_stop_id: b.id, published_by_user_id: admin.id, published_at: new Date(), created_by_user_id: admin.id, stops: { create: [
      { stop_id: a.id, sequence: 1, passenger_pickup: true, passenger_dropoff: false, parcel_pickup: true, parcel_dropoff: false },
      { stop_id: b.id, sequence: 2, passenger_pickup: false, passenger_dropoff: true, parcel_pickup: false, parcel_dropoff: true }
    ] } } });
    await tx.serviceRoute.update({ where: { id: stable.id }, data: { current_version_id: current.id } });
    const stale = await tx.serviceRouteVersion.create({ data: { service_route_id: stable.id, version_number: 2, status: "published", name_ar: "نسخة غير حالية", name_en: "Non-current", origin_stop_id: a.id, destination_stop_id: b.id, published_by_user_id: admin.id, published_at: new Date(), created_by_user_id: admin.id, stops: { create: [
      { stop_id: a.id, sequence: 1, passenger_pickup: true, passenger_dropoff: false, parcel_pickup: true, parcel_dropoff: false },
      { stop_id: b.id, sequence: 2, passenger_pickup: false, passenger_dropoff: true, parcel_pickup: false, parcel_dropoff: true }
    ] } } });
    return { stable, current, stale, origin: a, destination: b };
  });

  const from = new Date(Date.now() + 90 * 60_000);
  const until = new Date(from.getTime() + 60 * 60_000);
  const passengerCreate = await demandService.createPassengerRequest({
    routeVersionId: version.id, pickupStopId: pickup.stop_id, dropoffStopId: destination.stop_id,
    requestedDepartureFrom: from, requestedDepartureUntil: until, passengerCount: 2
  }, { id: passenger.id, requestId: randomUUID(), idempotencyKey: "m7c1-passenger-create-1" });
  check(passengerCreate.resource.route_version_id === version.id, "passenger canonical references persisted");
  const passengerReplay = await demandService.createPassengerRequest({
    routeVersionId: version.id, pickupStopId: pickup.stop_id, dropoffStopId: destination.stop_id,
    requestedDepartureFrom: from, requestedDepartureUntil: until, passengerCount: 2
  }, { id: passenger.id, requestId: randomUUID(), idempotencyKey: "m7c1-passenger-create-1" });
  check(passengerReplay.replayed && passengerReplay.resource.id === passengerCreate.resource.id, "passenger exact replay");
  await rejects(() => demandService.createPassengerRequest({
    routeVersionId: version.id, pickupStopId: second.origin.id, dropoffStopId: destination.stop_id,
    requestedDepartureFrom: from, requestedDepartureUntil: until, passengerCount: 1
  }, { id: passenger.id, idempotencyKey: "m7c1-passenger-cross-route" }), /invalid_route_stop/, "passenger cross-route stop rejected");
  await rejects(() => demandService.createPassengerRequest({
    routeVersionId: version.id, pickupStopId: destination.stop_id, dropoffStopId: pickup.stop_id,
    requestedDepartureFrom: from, requestedDepartureUntil: until, passengerCount: 1
  }, { id: passenger.id, idempotencyKey: "m7c1-passenger-reverse" }), /stop_permission_denied|invalid_stop_order/, "passenger reverse order rejected");

  const merchantCreate = await demandService.createMerchantOrder({
    routeVersionId: version.id, pickupStopId: origin.stop_id,
    requestedDepartureFrom: from, requestedDepartureUntil: until,
    parcels: [
      { destinationStopId: destination.stop_id, size: "S", priority: "normal" },
      { destinationStopId: destination.stop_id, size: "M", priority: "high" }
    ]
  }, { id: merchant.id, requestId: randomUUID(), idempotencyKey: "m7c1-merchant-create-1" });
  check(merchantCreate.resource.parcels.every((parcel) => parcel.route_version_id === version.id), "merchant one-route parcels persisted");
  const merchantOrdersBeforeBoundary = await prisma.merchantOrder.count({ where: { merchant_id: merchant.id } });
  const boundaryParcels = Array.from({ length: 50 }, () => ({
    destinationStopId: destination.stop_id, size: "S", priority: "normal"
  } as const));
  const boundaryOrder = await demandService.createMerchantOrder({
    routeVersionId: version.id, pickupStopId: origin.stop_id,
    requestedDepartureFrom: from, requestedDepartureUntil: until, parcels: boundaryParcels
  }, { id: merchant.id, idempotencyKey: "m7c1-merchant-fifty-parcels" });
  check(boundaryOrder.resource.parcels.length === 50, "canonical merchant boundary accepts fifty parcels atomically");
  await rejects(() => demandService.createMerchantOrder({
    routeVersionId: version.id, pickupStopId: origin.stop_id,
    requestedDepartureFrom: from, requestedDepartureUntil: until,
    parcels: [...boundaryParcels, boundaryParcels[0]!]
  }, { id: merchant.id, idempotencyKey: "m7c1-merchant-fifty-one-parcels" }), /invalid_parcel_count/, "canonical merchant rejects fifty-one parcels");
  check(await prisma.merchantOrder.count({ where: { merchant_id: merchant.id } }) === merchantOrdersBeforeBoundary + 1, "fifty-one parcel rejection leaves no partial order");
  await rejects(() => demandService.createMerchantOrder({
    routeVersionId: version.id, pickupStopId: origin.stop_id,
    requestedDepartureFrom: from, requestedDepartureUntil: until,
    parcels: [{ destinationStopId: second.destination.id, size: "S", priority: "normal" }]
  }, { id: merchant.id, idempotencyKey: "m7c1-merchant-cross-route" }), /invalid_route_stop/, "merchant cross-route parcel rejected");
  await rejects(() => prisma.passengerRequest.create({ data: {
    passenger_id: passenger.id, pickup_label: "derived", pickup_lat: "31.600000", pickup_lng: "35.120000",
    destination_label: "derived", destination_lat: destination.stop.latitude, destination_lng: destination.stop.longitude,
    preferred_time: from, passenger_count: 1, source: "canonical_route_v1", route_version_id: version.id,
    pickup_stop_id: second.origin.id, dropoff_stop_id: destination.stop_id, canonical_entry_version: "canonical_route_v1",
    requested_departure_from: from, requested_departure_until: until, canonical_created_at: new Date(),
    operational_mode: "canonical_route_v1"
  } }), /foreign key|P2003/i, "database rejects direct passenger cross-route membership");
  await rejects(() => prisma.parcel.create({ data: {
    order_id: merchantCreate.resource.id, destination_label: "derived", destination_lat: second.destination.latitude,
    destination_lng: second.destination.longitude, size: "S", priority: "normal", status: "pending",
    route_version_id: second.current.id, destination_stop_id: second.destination.id,
    canonical_entry_version: "canonical_route_v1", operational_mode: "canonical_route_v1"
  } }), /foreign key|P2003/i, "database rejects direct parcel/order route disagreement");

  const duplicateDeparture = new Date(Date.now() + 120 * 60_000);
  const duplicateInput = {
    routeVersionId: version.id, departureAt: duplicateDeparture,
    availabilityWindowEnd: new Date(duplicateDeparture.getTime() + 30 * 60_000), totalSeats: 2, totalParcelCapacity: 4
  };
  const duplicateRace = await Promise.allSettled([
    driverService.createOneOff(duplicateInput, { id: driver1.id, idempotencyKey: "m7c1-duplicate-a" }),
    driverService.createOneOff(duplicateInput, { id: driver1.id, idempotencyKey: "m7c1-duplicate-b" })
  ]);
  check(duplicateRace.filter((result) => result.status === "fulfilled").length === 1, "duplicate availability race has one winner");
  const duplicateWinner = duplicateRace.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof driverService.createOneOff>>> => result.status === "fulfilled")!.value.resource;
  const active = await driverService.activate(duplicateWinner.id, duplicateWinner.availability_revision, { id: driver1.id });
  await rejects(() => driverService.getOwner(active.id, driver2.id), /availability_not_found/, "driver owner isolation");

  const exactReplayAvailability = await createAvailability({
    driverId: driver1.id, routeVersionId: version.id, departureOffsetMinutes: 125,
    seats: 2, parcels: 0, key: "m7c1-exact-replay-availability"
  });
  const exactExpiry = new Date(Date.now() + 10 * 60_000);
  const exactRetries = await Promise.allSettled(Array.from({ length: 10 }, () => capacityService.hold({
    driverRouteId: exactReplayAvailability.id, routeVersionId: version.id, reservationType: "passenger",
    seatsReserved: 1, parcelUnitsReserved: 0, expiresAt: exactExpiry
  }, { id: passenger.id, idempotencyKey: "m7c1-exact-concurrent-hold" })));
  check(exactRetries.every((result) => result.status === "fulfilled"), "concurrent exact hold retries all resolve");
  const exactResults = exactRetries.filter(
    (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof capacityService.hold>>> => result.status === "fulfilled"
  );
  check(new Set(exactResults.map((result) => result.value.resource.id)).size === 1 && exactResults.every((result) => result.value.resource.status === "held"), "concurrent exact hold callers receive one reservation identity and state");
  check(await prisma.capacityReservation.count({ where: { driver_route_id: exactReplayAvailability.id } }) === 1, "concurrent exact hold creates one reservation");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: exactReplayAvailability.id } })).remaining_seats === 1, "concurrent exact hold decrements once");
  check(await prisma.auditEvent.count({ where: { action: "capacity_reserved", entity_id: exactRetries[0].status === "fulfilled" ? exactRetries[0].value.resource.id : "" } }) === 1, "concurrent exact hold audits once");
  const exactKeyDigest = createHash("sha256").update("m7c1-exact-concurrent-hold").digest("hex");
  const exactClaims = await prisma.idempotencyRecord.findMany({
    where: { operation: "capacity_hold", idempotency_key: exactKeyDigest }
  });
  check(exactClaims.length === 1 && exactClaims[0]?.state === "completed", "concurrent exact hold leaves one completed idempotency claim");
  const responseLossRetry = await capacityService.hold({
    driverRouteId: exactReplayAvailability.id, routeVersionId: version.id, reservationType: "passenger",
    seatsReserved: 1, parcelUnitsReserved: 0, expiresAt: exactExpiry
  }, { id: passenger.id, idempotencyKey: "m7c1-exact-concurrent-hold" });
  check(responseLossRetry.replayed && responseLossRetry.resource.id === exactResults[0]!.value.resource.id && responseLossRetry.resource.status === "held", "post-commit response-loss retry returns the original logical result");

  const approvalAvailability = await createAvailability({
    driverId: driver2.id, routeVersionId: version.id, departureOffsetMinutes: 126,
    seats: 1, parcels: 0, key: "m7c1-approval-availability"
  });
  await prisma.driverProfile.update({ where: { user_id: driver2.id }, data: { verified: false } });
  await rejects(() => capacityService.hold({
    driverRouteId: approvalAvailability.id, routeVersionId: version.id, reservationType: "passenger",
    seatsReserved: 1, parcelUnitsReserved: 0, expiresAt: new Date(Date.now() + 10 * 60_000)
  }, { id: passenger.id, idempotencyKey: "m7c1-unapproved-hold" }), /availability_not_reservable/, "approval revocation blocks new hold");
  await prisma.driverProfile.update({ where: { user_id: driver2.id }, data: { verified: true } });
  const approvalBefore = await prisma.driverRoute.findUniqueOrThrow({ where: { id: approvalAvailability.id } });
  for (const accountStatus of ["suspended", "disabled"] as const) {
    await prisma.user.update({ where: { id: driver2.id }, data: { account_status: accountStatus } });
    await rejects(() => capacityService.hold({
      driverRouteId: approvalAvailability.id, routeVersionId: version.id, reservationType: "passenger",
      seatsReserved: 1, parcelUnitsReserved: 0, expiresAt: new Date(Date.now() + 10 * 60_000)
    }, { id: passenger.id, idempotencyKey: `m7c1-${accountStatus}-driver-hold` }), /availability_not_reservable/, `${accountStatus} driver account blocks new hold`);
  }
  await prisma.user.update({ where: { id: driver2.id }, data: { account_status: "active" } });
  await prisma.user.update({ where: { id: driver2.id }, data: { role: "passenger" } });
  await rejects(() => capacityService.hold({
    driverRouteId: approvalAvailability.id, routeVersionId: version.id, reservationType: "passenger",
    seatsReserved: 1, parcelUnitsReserved: 0, expiresAt: new Date(Date.now() + 10 * 60_000)
  }, { id: passenger.id, idempotencyKey: "m7c1-non-driver-owner-hold" }), /availability_not_reservable/, "non-driver availability owner blocks new hold");
  await prisma.user.update({ where: { id: driver2.id }, data: { role: "driver" } });
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: approvalAvailability.id } })).remaining_seats === approvalBefore.remaining_seats, "blocked driver holds do not consume capacity");

  const pauseRaceAvailability = await createAvailability({
    driverId: driver2.id, routeVersionId: version.id, departureOffsetMinutes: 127,
    seats: 1, parcels: 0, key: "m7c1-route-pause-race-availability"
  });
  let releasePause!: () => void;
  let announcePause!: () => void;
  const pauseRelease = new Promise<void>((resolve) => { releasePause = resolve; });
  const pauseLocked = new Promise<void>((resolve) => { announcePause = resolve; });
  const pauseTransaction = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM service_routes WHERE id = ${route.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM service_route_versions WHERE id = ${version.id} FOR UPDATE`;
    await tx.serviceRouteVersion.update({ where: { id: version.id }, data: { status: "paused" } });
    announcePause();
    await pauseRelease;
  });
  await pauseLocked;
  const pausedAttempts = Promise.allSettled([
    capacityService.hold({
      driverRouteId: pauseRaceAvailability.id, routeVersionId: version.id, reservationType: "passenger",
      seatsReserved: 1, parcelUnitsReserved: 0, expiresAt: new Date(Date.now() + 10 * 60_000)
    }, { id: passenger.id, idempotencyKey: "m7c1-route-pause-race-hold" }),
    demandService.createPassengerRequest({
      routeVersionId: version.id, pickupStopId: pickup.stop_id, dropoffStopId: destination.stop_id,
      requestedDepartureFrom: from, requestedDepartureUntil: until, passengerCount: 1
    }, { id: passenger.id, idempotencyKey: "m7c1-route-pause-race-demand" })
  ]);
  await new Promise((resolve) => setTimeout(resolve, 25));
  releasePause();
  await pauseTransaction;
  const [pausedHold, pausedDemand] = await pausedAttempts;
  check(pausedHold.status === "rejected" && /route_version_not_available/.test(String(pausedHold.reason)), "route pause wins against concurrent hold");
  check(pausedDemand.status === "rejected" && /route_version_not_available/.test(String(pausedDemand.reason)), "route pause wins against concurrent demand creation");
  check(await prisma.capacityReservation.count({ where: { driver_route_id: pauseRaceAvailability.id } }) === 0, "route pause race leaves no reservation");
  await prisma.serviceRouteVersion.update({ where: { id: version.id }, data: { status: "published" } });

  let releaseStop!: () => void;
  let announceStop!: () => void;
  const stopRelease = new Promise<void>((resolve) => { releaseStop = resolve; });
  const stopLocked = new Promise<void>((resolve) => { announceStop = resolve; });
  const stopRetirement = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM stops WHERE id = ${pickup.stop_id} FOR UPDATE`;
    await tx.stop.update({ where: { id: pickup.stop_id }, data: { status: "retired", retired_at: new Date() } });
    announceStop();
    await stopRelease;
  });
  await stopLocked;
  const stoppedDemand = demandService.createPassengerRequest({
    routeVersionId: version.id, pickupStopId: pickup.stop_id, dropoffStopId: destination.stop_id,
    requestedDepartureFrom: from, requestedDepartureUntil: until, passengerCount: 1
  }, { id: passenger.id, idempotencyKey: "m7c1-stop-retirement-race" });
  await new Promise((resolve) => setTimeout(resolve, 25));
  releaseStop();
  await stopRetirement;
  await rejects(() => stoppedDemand, /route_version_not_available/, "stop retirement serializes against demand eligibility");
  await prisma.stop.update({ where: { id: pickup.stop_id }, data: { status: "active", retired_at: null } });

  const cancelRaceAvailability = await createAvailability({
    driverId: driver2.id, routeVersionId: version.id, departureOffsetMinutes: 128,
    seats: 1, parcels: 0, key: "m7c1-cancel-race-availability"
  });
  const cancelRace = await Promise.allSettled([
    capacityService.hold({
      driverRouteId: cancelRaceAvailability.id, routeVersionId: version.id, reservationType: "passenger",
      seatsReserved: 1, parcelUnitsReserved: 0, expiresAt: new Date(Date.now() + 10 * 60_000)
    }, { id: passenger.id, idempotencyKey: "m7c1-cancel-race-hold" }),
    driverService.cancel(cancelRaceAvailability.id, cancelRaceAvailability.availability_revision, { id: driver2.id })
  ]);
  check(cancelRace.some((result) => result.status === "fulfilled"), "cancel versus hold has a winner");
  const cancelRaceFinal = await prisma.driverRoute.findUniqueOrThrow({ where: { id: cancelRaceAvailability.id } });
  const cancelRaceReservations = await prisma.capacityReservation.count({
    where: { driver_route_id: cancelRaceAvailability.id, status: { in: ["held", "confirmed"] } }
  });
  check(!(cancelRaceFinal.availability_status === "cancelled" && cancelRaceReservations > 0), "cancel versus hold never strands a reservation");

  const cancelHeldAvailability = await createAvailability({
    driverId: driver2.id, routeVersionId: version.id, departureOffsetMinutes: 129,
    seats: 1, parcels: 0, key: "m7c1-cancel-held-availability"
  });
  const cancelHeld = await capacityService.hold({
    driverRouteId: cancelHeldAvailability.id, routeVersionId: version.id, reservationType: "passenger",
    seatsReserved: 1, parcelUnitsReserved: 0, expiresAt: new Date(Date.now() + 10 * 60_000)
  }, { id: passenger.id, idempotencyKey: "m7c1-cancel-held-hold" });
  await rejects(() => driverService.cancel(cancelHeldAvailability.id, cancelHeldAvailability.availability_revision, { id: driver2.id }), /availability_has_reservations/, "canonical cancellation rejects a held reservation");
  await capacityService.confirm(cancelHeld.resource.id, { id: passenger.id, idempotencyKey: "m7c1-cancel-confirm" });
  await rejects(() => driverService.cancel(cancelHeldAvailability.id, cancelHeldAvailability.availability_revision, { id: driver2.id }), /availability_has_reservations/, "canonical cancellation rejects a confirmed reservation");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: cancelHeldAvailability.id } })).remaining_seats === 0, "rejected cancellation preserves confirmed capacity accounting");

  const cancelReleaseAvailability = await createAvailability({
    driverId: driver2.id, routeVersionId: version.id, departureOffsetMinutes: 131,
    seats: 1, parcels: 0, key: "m7c1-cancel-release-availability"
  });
  const cancelReleaseHold = await capacityService.hold({
    driverRouteId: cancelReleaseAvailability.id, routeVersionId: version.id, reservationType: "passenger",
    seatsReserved: 1, parcelUnitsReserved: 0, expiresAt: new Date(Date.now() + 10 * 60_000)
  }, { id: passenger.id, idempotencyKey: "m7c1-cancel-release-hold" });
  const cancelReleaseRace = await Promise.allSettled([
    driverService.cancel(cancelReleaseAvailability.id, cancelReleaseAvailability.availability_revision, { id: driver2.id }),
    capacityService.release(cancelReleaseHold.resource.id, "offer_cancelled", { id: passenger.id, idempotencyKey: "m7c1-cancel-release" })
  ]);
  const cancelReleaseFinal = await prisma.driverRoute.findUniqueOrThrow({ where: { id: cancelReleaseAvailability.id } });
  const cancelReleaseReservation = await prisma.capacityReservation.findUniqueOrThrow({ where: { id: cancelReleaseHold.resource.id } });
  check(cancelReleaseReservation.status === "released" && cancelReleaseFinal.remaining_seats === 1, "cancel versus release restores exact capacity and leaves no held reservation");
  const terminal = cancelReleaseFinal.availability_status === "cancelled"
    ? cancelReleaseFinal
    : await driverService.cancel(cancelReleaseAvailability.id, cancelReleaseFinal.availability_revision, { id: driver2.id });
  await rejects(() => driverService.resume(terminal.id, terminal.availability_revision, { id: driver2.id }), /availability_cannot_resume/, "cancelled availability cannot resume");
  await rejects(() => capacityService.hold({
    driverRouteId: terminal.id, routeVersionId: version.id, reservationType: "passenger",
    seatsReserved: 1, parcelUnitsReserved: 0, expiresAt: new Date(Date.now() + 10 * 60_000)
  }, { id: passenger.id, idempotencyKey: "m7c1-cancelled-terminal-hold" }), /availability_not_reservable/, "cancelled availability rejects new holds");
  check(terminal.availability_status === "cancelled", "canonical cancellation reaches one terminal state");

  await prisma.serviceRouteVersion.update({ where: { id: version.id }, data: { status: "paused" } });
  await rejects(() => requireEligibleOperationalRoute(prisma, version.id), /route_version_not_available/, "paused version rejected");
  await prisma.serviceRouteVersion.update({ where: { id: version.id }, data: { status: "published" } });
  await prisma.serviceRoute.update({ where: { id: second.stable.id }, data: { status: "retired" } });
  await rejects(() => requireEligibleOperationalRoute(prisma, second.current.id), /route_version_not_available/, "retired route rejected");
  await prisma.serviceRoute.update({ where: { id: second.stable.id }, data: { status: "active" } });
  await rejects(() => requireEligibleOperationalRoute(prisma, second.stale.id), /route_version_not_available/, "non-current version rejected");

  const seatExpiry = new Date(Date.now() + 10 * 60_000);
  const seatHolds = await Promise.allSettled([0, 1, 2].map((index) => capacityService.hold({
    driverRouteId: active.id, routeVersionId: version.id, reservationType: "passenger",
    seatsReserved: 1, parcelUnitsReserved: 0, expiresAt: seatExpiry
  }, { id: passenger.id, requestId: randomUUID(), idempotencyKey: `m7c1-seat-hold-${index}` })));
  check(seatHolds.filter((result) => result.status === "fulfilled").length === 2, "concurrent seat holds exact winners");
  const activeAfterSeats = await prisma.driverRoute.findUniqueOrThrow({ where: { id: active.id } });
  check(activeAfterSeats.remaining_seats === 0, "seat capacity never negative");
  const firstSeatIndex = seatHolds.findIndex((result) => result.status === "fulfilled");
  const holdReplay = await capacityService.hold({
    driverRouteId: active.id, routeVersionId: version.id, reservationType: "passenger",
    seatsReserved: 1, parcelUnitsReserved: 0, expiresAt: seatExpiry
  }, { id: passenger.id, idempotencyKey: `m7c1-seat-hold-${firstSeatIndex}` });
  check(holdReplay.replayed, "capacity exact hold replay");
  await rejects(() => capacityService.hold({
    driverRouteId: active.id, routeVersionId: version.id, reservationType: "passenger",
    seatsReserved: 2, parcelUnitsReserved: 0, expiresAt: seatExpiry
  }, { id: passenger.id, idempotencyKey: `m7c1-seat-hold-${firstSeatIndex}` }), /idempotency_conflict/, "same key different hold payload conflict");
  const reservationCountBefore = await prisma.capacityReservation.count({ where: { driver_route_id: active.id } });
  await rejects(() => capacityService.hold({
    driverRouteId: active.id, routeVersionId: version.id, reservationType: "combined",
    seatsReserved: 1, parcelUnitsReserved: 1, expiresAt: new Date(Date.now() + 10 * 60_000)
  }, { id: passenger.id, idempotencyKey: "m7c1-insufficient" }), /insufficient_capacity/, "insufficient capacity rollback");
  check(await prisma.capacityReservation.count({ where: { driver_route_id: active.id } }) === reservationCountBefore, "insufficient hold creates no row");

  const parcelAvailability = await createAvailability({ driverId: driver1.id, routeVersionId: version.id, departureOffsetMinutes: 130, seats: 1, parcels: 2, key: "m7c1-parcel-availability" });
  const parcelHolds = await Promise.allSettled([0, 1, 2].map((index) => capacityService.hold({
    driverRouteId: parcelAvailability.id, routeVersionId: version.id, reservationType: "parcel",
    seatsReserved: 0, parcelUnitsReserved: 1, expiresAt: new Date(Date.now() + 10 * 60_000)
  }, { id: merchant.id, idempotencyKey: `m7c1-parcel-hold-${index}` })));
  check(parcelHolds.filter((result) => result.status === "fulfilled").length === 2, "concurrent parcel holds exact winners");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: parcelAvailability.id } })).remaining_parcel_capacity === 0, "parcel capacity never negative");

  const combinedAvailability = await createAvailability({ driverId: driver1.id, routeVersionId: version.id, departureOffsetMinutes: 140, seats: 2, parcels: 2, key: "m7c1-combined-availability" });
  const combined = await capacityService.hold({
    driverRouteId: combinedAvailability.id, routeVersionId: version.id, reservationType: "combined",
    seatsReserved: 1, parcelUnitsReserved: 1, expiresAt: new Date(Date.now() + 10 * 60_000)
  }, { id: passenger.id, idempotencyKey: "m7c1-combined-hold" });
  check(combined.resource.seats_reserved === 1 && combined.resource.parcel_units_reserved === 1, "combined hold reserves both dimensions");
  const confirmRace = await Promise.allSettled([
    capacityService.confirm(combined.resource.id, { id: passenger.id, idempotencyKey: "m7c1-confirm-a" }),
    capacityService.confirm(combined.resource.id, { id: passenger.id, idempotencyKey: "m7c1-confirm-b" })
  ]);
  check(confirmRace.every((result) => result.status === "fulfilled"), "concurrent confirm is idempotent");
  check((await prisma.capacityReservation.findUniqueOrThrow({ where: { id: combined.resource.id } })).status === "confirmed", "confirm terminal state persisted");

  const releaseAvailability = await createAvailability({ driverId: driver1.id, routeVersionId: version.id, departureOffsetMinutes: 150, seats: 2, parcels: 2, key: "m7c1-release-availability" });
  const releaseHold = await capacityService.hold({ driverRouteId: releaseAvailability.id, routeVersionId: version.id, reservationType: "combined", seatsReserved: 1, parcelUnitsReserved: 1, expiresAt: new Date(Date.now() + 10 * 60_000) }, { id: passenger.id, idempotencyKey: "m7c1-release-hold" });
  const releaseRace = await Promise.allSettled([
    capacityService.release(releaseHold.resource.id, "offer_rejected", { id: passenger.id, idempotencyKey: "m7c1-release-a" }),
    capacityService.release(releaseHold.resource.id, "offer_rejected", { id: passenger.id, idempotencyKey: "m7c1-release-b" })
  ]);
  check(releaseRace.every((result) => result.status === "fulfilled"), "concurrent release is idempotent");
  const afterRelease = await prisma.driverRoute.findUniqueOrThrow({ where: { id: releaseAvailability.id } });
  check(afterRelease.remaining_seats === 2 && afterRelease.remaining_parcel_capacity === 2, "released capacity restored exactly once");

  const updateReleaseAvailability = await createAvailability({
    driverId: driver2.id, routeVersionId: version.id, departureOffsetMinutes: 155,
    seats: 2, parcels: 0, key: "m7c1-update-release-availability"
  });
  const updateReleaseHold = await capacityService.hold({
    driverRouteId: updateReleaseAvailability.id, routeVersionId: version.id, reservationType: "passenger",
    seatsReserved: 1, parcelUnitsReserved: 0, expiresAt: new Date(Date.now() + 10 * 60_000)
  }, { id: passenger.id, idempotencyKey: "m7c1-update-release-hold" });
  const updateReleasePaused = await driverService.pause(
    updateReleaseAvailability.id, updateReleaseAvailability.availability_revision, { id: driver2.id }
  );
  const updateReleaseRace = await Promise.allSettled([
    capacityService.release(updateReleaseHold.resource.id, "offer_cancelled", {
      id: passenger.id, idempotencyKey: "m7c1-update-release-release"
    }),
    driverService.updateOneOff(updateReleaseAvailability.id, {
      expectedRevision: updateReleasePaused.availability_revision, totalParcelCapacity: 1
    }, { id: driver2.id })
  ]);
  check(
    updateReleaseRace.every((result) => result.status === "fulfilled"),
    `capacity update versus release completes without lost accounting (${updateReleaseRace.map((result) =>
      result.status === "fulfilled" ? "fulfilled" : String(result.reason)
    ).join(",")})`
  );
  const updateReleaseFinal = await prisma.driverRoute.findUniqueOrThrow({ where: { id: updateReleaseAvailability.id } });
  check(
    updateReleaseFinal.total_seats === 2 && updateReleaseFinal.remaining_seats === 2 &&
    updateReleaseFinal.total_parcel_capacity === 1 && updateReleaseFinal.remaining_parcel_capacity === 1,
    "capacity update versus release restores exact total"
  );

  const seatUpdateHoldAvailability = await createAvailability({
    driverId: driver2.id, routeVersionId: version.id, departureOffsetMinutes: 157,
    seats: 2, parcels: 0, key: "m7c1-seat-update-hold-availability"
  });
  const seatUpdateHoldPaused = await driverService.pause(
    seatUpdateHoldAvailability.id, seatUpdateHoldAvailability.availability_revision, { id: driver2.id }
  );
  const seatUpdateHoldRace = await Promise.allSettled([
    driverService.updateOneOff(seatUpdateHoldAvailability.id, {
      expectedRevision: seatUpdateHoldPaused.availability_revision, totalSeats: 1
    }, { id: driver2.id }),
    capacityService.hold({
      driverRouteId: seatUpdateHoldAvailability.id, routeVersionId: version.id, reservationType: "passenger",
      seatsReserved: 1, parcelUnitsReserved: 0, expiresAt: new Date(Date.now() + 10 * 60_000)
    }, { id: passenger.id, idempotencyKey: "m7c1-seat-update-concurrent-hold" })
  ]);
  check(seatUpdateHoldRace[0].status === "fulfilled" && seatUpdateHoldRace[1].status === "rejected", "seat update versus hold has the paused update as sole winner");
  const seatUpdateHoldFinal = await prisma.driverRoute.findUniqueOrThrow({ where: { id: seatUpdateHoldAvailability.id } });
  check(seatUpdateHoldFinal.total_seats === 1 && seatUpdateHoldFinal.remaining_seats === 1 && await prisma.capacityReservation.count({ where: { driver_route_id: seatUpdateHoldAvailability.id } }) === 0, "seat update versus hold has exact unreserved capacity");
  check(await prisma.auditEvent.count({ where: { action: "driver_availability_updated", entity_id: seatUpdateHoldAvailability.id } }) === 1, "seat update versus hold audits exactly once");

  const parcelUpdateHoldAvailability = await createAvailability({
    driverId: driver2.id, routeVersionId: version.id, departureOffsetMinutes: 158,
    seats: 1, parcels: 2, key: "m7c1-parcel-update-hold-availability"
  });
  const parcelUpdateHoldPaused = await driverService.pause(
    parcelUpdateHoldAvailability.id, parcelUpdateHoldAvailability.availability_revision, { id: driver2.id }
  );
  const parcelUpdateHoldRace = await Promise.allSettled([
    driverService.updateOneOff(parcelUpdateHoldAvailability.id, {
      expectedRevision: parcelUpdateHoldPaused.availability_revision, totalParcelCapacity: 4
    }, { id: driver2.id }),
    capacityService.hold({
      driverRouteId: parcelUpdateHoldAvailability.id, routeVersionId: version.id, reservationType: "parcel",
      seatsReserved: 0, parcelUnitsReserved: 1, expiresAt: new Date(Date.now() + 10 * 60_000)
    }, { id: merchant.id, idempotencyKey: "m7c1-parcel-update-concurrent-hold" })
  ]);
  check(parcelUpdateHoldRace[0].status === "fulfilled" && parcelUpdateHoldRace[1].status === "rejected", "parcel update versus hold has the paused update as sole winner");
  const parcelUpdateHoldFinal = await prisma.driverRoute.findUniqueOrThrow({ where: { id: parcelUpdateHoldAvailability.id } });
  check(parcelUpdateHoldFinal.total_parcel_capacity === 4 && parcelUpdateHoldFinal.remaining_parcel_capacity === 4 && await prisma.capacityReservation.count({ where: { driver_route_id: parcelUpdateHoldAvailability.id } }) === 0, "parcel update versus hold has exact unreserved capacity");
  check(await prisma.auditEvent.count({ where: { action: "driver_availability_updated", entity_id: parcelUpdateHoldAvailability.id } }) === 1, "parcel update versus hold audits exactly once");

  const updateExpiryAvailability = await createAvailability({
    driverId: driver2.id, routeVersionId: version.id, departureOffsetMinutes: 159,
    seats: 2, parcels: 2, key: "m7c1-update-expiry-availability"
  });
  const updateExpiryAt = new Date(Date.now() + 60_000);
  const updateExpiryHold = await capacityService.hold({
    driverRouteId: updateExpiryAvailability.id, routeVersionId: version.id, reservationType: "combined",
    seatsReserved: 1, parcelUnitsReserved: 1, expiresAt: updateExpiryAt
  }, { id: passenger.id, idempotencyKey: "m7c1-update-expiry-hold" });
  const updateExpiryPaused = await driverService.pause(
    updateExpiryAvailability.id, updateExpiryAvailability.availability_revision, { id: driver2.id }
  );
  const updateExpiryRace = await Promise.allSettled([
    driverService.updateOneOff(updateExpiryAvailability.id, {
      expectedRevision: updateExpiryPaused.availability_revision, totalParcelCapacity: 4
    }, { id: driver2.id }),
    capacityService.expireBatch({ now: new Date(updateExpiryAt.getTime() + 1), limit: 100 })
  ]);
  check(updateExpiryRace.every((result) => result.status === "fulfilled"), "capacity update versus expiry completes without lost accounting");
  const updateExpiryFinal = await prisma.driverRoute.findUniqueOrThrow({ where: { id: updateExpiryAvailability.id } });
  check(updateExpiryFinal.total_seats === 2 && updateExpiryFinal.remaining_seats === 2 && updateExpiryFinal.total_parcel_capacity === 4 && updateExpiryFinal.remaining_parcel_capacity === 4 && (await prisma.capacityReservation.findUniqueOrThrow({ where: { id: updateExpiryHold.resource.id } })).status === "expired", "capacity update versus expiry restores exact updated totals");
  check(await prisma.auditEvent.count({ where: { action: "driver_availability_updated", entity_id: updateExpiryAvailability.id } }) === 1 && await prisma.auditEvent.count({ where: { action: "capacity_expired", entity_id: updateExpiryHold.resource.id } }) === 1, "capacity update versus expiry audits each transition once");

  const bothUpdateReleaseAvailability = await createAvailability({
    driverId: driver2.id, routeVersionId: version.id, departureOffsetMinutes: 160,
    seats: 1, parcels: 2, key: "m7c1-both-update-release-availability"
  });
  const bothUpdateReleaseHold = await capacityService.hold({
    driverRouteId: bothUpdateReleaseAvailability.id, routeVersionId: version.id, reservationType: "combined",
    seatsReserved: 1, parcelUnitsReserved: 1, expiresAt: new Date(Date.now() + 10 * 60_000)
  }, { id: passenger.id, idempotencyKey: "m7c1-both-update-release-hold" });
  const bothUpdateReleasePaused = await driverService.pause(
    bothUpdateReleaseAvailability.id, bothUpdateReleaseAvailability.availability_revision, { id: driver2.id }
  );
  const bothUpdateReleaseRace = await Promise.allSettled([
    driverService.updateOneOff(bothUpdateReleaseAvailability.id, {
      expectedRevision: bothUpdateReleasePaused.availability_revision, totalSeats: 2, totalParcelCapacity: 5
    }, { id: driver2.id }),
    capacityService.release(bothUpdateReleaseHold.resource.id, "offer_cancelled", {
      id: passenger.id, idempotencyKey: "m7c1-both-update-release"
    })
  ]);
  check(bothUpdateReleaseRace.every((result) => result.status === "fulfilled"), "both-capacity update versus combined release completes");
  const bothUpdateReleaseFinal = await prisma.driverRoute.findUniqueOrThrow({ where: { id: bothUpdateReleaseAvailability.id } });
  check(bothUpdateReleaseFinal.total_seats === 2 && bothUpdateReleaseFinal.remaining_seats === 2 && bothUpdateReleaseFinal.total_parcel_capacity === 5 && bothUpdateReleaseFinal.remaining_parcel_capacity === 5 && (await prisma.capacityReservation.findUniqueOrThrow({ where: { id: bothUpdateReleaseHold.resource.id } })).status === "released", "both-capacity update versus release restores exact updated totals");
  check(await prisma.auditEvent.count({ where: { action: "driver_availability_updated", entity_id: bothUpdateReleaseAvailability.id } }) === 1 && await prisma.auditEvent.count({ where: { action: "capacity_released", entity_id: bothUpdateReleaseHold.resource.id } }) === 1, "both-capacity update versus release audits each transition once");

  const routeBAvailability = await createAvailability({
    driverId: driver2.id, routeVersionId: second.current.id, departureOffsetMinutes: 156,
    seats: 1, parcels: 0, key: "m7c1-route-b-availability"
  });
  const secondPassenger = await demandService.createPassengerRequest({
    routeVersionId: second.current.id, pickupStopId: second.origin.id, dropoffStopId: second.destination.id,
    requestedDepartureFrom: from, requestedDepartureUntil: until, passengerCount: 1
  }, { id: passenger.id, idempotencyKey: "m7c1-second-route-passenger" });
  const secondMerchant = await demandService.createMerchantOrder({
    routeVersionId: second.current.id, pickupStopId: second.origin.id,
    requestedDepartureFrom: from, requestedDepartureUntil: until,
    parcels: [{ destinationStopId: second.destination.id, size: "S", priority: "normal" }]
  }, { id: merchant.id, idempotencyKey: "m7c1-second-route-merchant" });
  await rejects(() => prisma.match.create({ data: {
    driver_route_id: updateReleaseAvailability.id, route_version_id: version.id,
    passenger_request_id: secondPassenger.resource.id,
    canonical_match_version: "canonical_route_v1", operational_mode: "canonical_route_v1",
    score: "0.5000", method: "invalid_passenger_route", explanation: "must fail", scoring_breakdown: { review: true }
  } }), /constraint|foreign key|P2003|P2004/i, "database rejects canonical match/passenger route disagreement");
  await rejects(() => prisma.match.create({ data: {
    driver_route_id: updateReleaseAvailability.id, route_version_id: version.id,
    merchant_order_id: secondMerchant.resource.id,
    canonical_match_version: "canonical_route_v1", operational_mode: "canonical_route_v1",
    score: "0.5000", method: "invalid_merchant_route", explanation: "must fail", scoring_breakdown: { review: true }
  } }), /constraint|foreign key|P2003|P2004/i, "database rejects canonical match/merchant route disagreement");
  await rejects(() => capacityService.hold({
    driverRouteId: routeBAvailability.id, routeVersionId: version.id,
    reservationType: "passenger", seatsReserved: 1, parcelUnitsReserved: 0,
    expiresAt: new Date(Date.now() + 10 * 60_000)
  }, { id: passenger.id, idempotencyKey: "m7c1-cross-route-match-hold" }), /availability_not_reservable/, "service rejects cross-route match reservation");
  await rejects(() => prisma.capacityReservation.create({ data: {
    driver_route_id: routeBAvailability.id, route_version_id: version.id,
    reservation_type: "passenger", seats_reserved: 1, parcel_units_reserved: 0,
    expires_at: new Date(Date.now() + 10 * 60_000), idempotency_fingerprint: "a".repeat(64)
  } }), /foreign key|P2003/i, "database rejects cross-route match reservation");
  await rejects(() => prisma.match.create({ data: {
    driver_route_id: routeBAvailability.id, route_version_id: version.id,
    canonical_match_version: "canonical_route_v1", operational_mode: "canonical_route_v1", score: "0.5000", method: "invalid_review_foundation",
    explanation: "must fail", scoring_breakdown: { review: true }
  } }), /constraint|foreign key|P2003|P2004/i, "database rejects canonical match/availability route disagreement");

  const decisionAvailability = await createAvailability({ driverId: driver1.id, routeVersionId: version.id, departureOffsetMinutes: 165, seats: 1, parcels: 1, key: "m7c1-decision-availability" });
  const decisionHold = await capacityService.hold({ driverRouteId: decisionAvailability.id, routeVersionId: version.id, reservationType: "combined", seatsReserved: 1, parcelUnitsReserved: 1, expiresAt: new Date(Date.now() + 10 * 60_000) }, { id: passenger.id, idempotencyKey: "m7c1-decision-hold" });
  const decisionRace = await Promise.allSettled([
    capacityService.confirm(decisionHold.resource.id, { id: passenger.id, idempotencyKey: "m7c1-decision-confirm" }),
    capacityService.release(decisionHold.resource.id, "offer_cancelled", { id: passenger.id, idempotencyKey: "m7c1-decision-release" })
  ]);
  check(decisionRace.filter((result) => result.status === "fulfilled").length >= 1, "confirm versus release has a winner");
  check(["confirmed", "released"].includes((await prisma.capacityReservation.findUniqueOrThrow({ where: { id: decisionHold.resource.id } })).status), "confirm versus release terminal state valid");

  const expiryAvailability = await createAvailability({ driverId: driver1.id, routeVersionId: version.id, departureOffsetMinutes: 170, seats: 1, parcels: 1, key: "m7c1-expiry-availability" });
  const expiryAt = new Date(Date.now() + 60_000);
  const expiryHold = await capacityService.hold({ driverRouteId: expiryAvailability.id, routeVersionId: version.id, reservationType: "combined", seatsReserved: 1, parcelUnitsReserved: 1, expiresAt: expiryAt }, { id: passenger.id, idempotencyKey: "m7c1-expiry-hold" });
  const expiryRace = await Promise.allSettled([
    capacityService.confirm(expiryHold.resource.id, { id: passenger.id, idempotencyKey: "m7c1-expiry-confirm" }),
    capacityService.expireBatch({ now: new Date(expiryAt.getTime() + 1), limit: 10 })
  ]);
  check(expiryRace.some((result) => result.status === "fulfilled"), "expiry versus confirm completes safely");
  const expiryFinal = await prisma.capacityReservation.findUniqueOrThrow({ where: { id: expiryHold.resource.id } });
  check(["confirmed", "expired"].includes(expiryFinal.status), "expiry versus confirm terminal state valid");
  const expiryCapacity = await prisma.driverRoute.findUniqueOrThrow({ where: { id: expiryAvailability.id } });
  check(expiryCapacity.remaining_seats! >= 0 && expiryCapacity.remaining_seats! <= expiryCapacity.total_seats!, "capacity remains within seat total");
  check(expiryCapacity.remaining_parcel_capacity! >= 0 && expiryCapacity.remaining_parcel_capacity! <= expiryCapacity.total_parcel_capacity!, "capacity remains within parcel total");

  const poisonAvailability = await createAvailability({
    driverId: driver2.id, routeVersionId: version.id, departureOffsetMinutes: 175,
    seats: 2, parcels: 0, key: "m7c1-expiry-poison-availability"
  });
  const validPoisonExpiry = new Date(Date.now() + 60_000);
  const validPoisonHold = await capacityService.hold({
    driverRouteId: poisonAvailability.id, routeVersionId: version.id, reservationType: "passenger",
    seatsReserved: 1, parcelUnitsReserved: 0, expiresAt: validPoisonExpiry
  }, { id: passenger.id, idempotencyKey: "m7c1-expiry-valid-hold" });
  await prisma.capacityReservation.create({ data: {
    driver_route_id: poisonAvailability.id, route_version_id: version.id,
    reservation_type: "passenger", seats_reserved: 2, parcel_units_reserved: 0,
    expires_at: new Date(validPoisonExpiry.getTime() - 1), idempotency_fingerprint: "b".repeat(64)
  } });
  const poisonResult = await capacityService.expireBatch({ now: new Date(validPoisonExpiry.getTime() + 1), limit: 10 });
  check(poisonResult.failed >= 1 && poisonResult.expired >= 1, "invalid expiry candidate does not poison bounded batch");
  check((await prisma.capacityReservation.findUniqueOrThrow({ where: { id: validPoisonHold.resource.id } })).status === "expired", "valid expiry candidate reaches terminal state after poison");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: poisonAvailability.id } })).remaining_seats === 2, "valid expiry restores capacity despite poison candidate");
  await capacityService.expireBatch({ now: new Date(validPoisonExpiry.getTime() + 2), limit: 10 });
  await capacityService.expireBatch({ now: new Date(validPoisonExpiry.getTime() + 3), limit: 10 });
  const quarantined = await prisma.capacityReservation.findFirstOrThrow({
    where: { driver_route_id: poisonAvailability.id, status: "held" }
  });
  check(quarantined.expiry_failure_count === 3 && quarantined.expiry_last_failed_at !== null, "poison expiry candidate is durably quarantined after three failures");
  const afterQuarantine = await capacityService.expireBatch({ now: new Date(validPoisonExpiry.getTime() + 4), limit: 10 });
  check(afterQuarantine.examined === 0 && afterQuarantine.failedIds.length === 0, "quarantined expiry candidate cannot starve later batches");

  const operationalAudits = await prisma.auditEvent.findMany({
    where: { action: { in: [
      "driver_availability_created", "driver_availability_activated", "driver_availability_paused",
      "driver_availability_cancelled", "canonical_passenger_request_created", "canonical_merchant_order_created",
      "capacity_reserved", "capacity_confirmed", "capacity_released", "capacity_expired"
    ] } },
    select: { metadata: true }
  });
  const allowedAuditKeys = new Set([
    "route_version_id", "seats", "parcel_units", "passenger_count", "parcel_count",
    "transition", "reason_code", "request_id", "schema_version"
  ]);
  check(operationalAudits.length > 0 && operationalAudits.every((event) =>
    event.metadata !== null && typeof event.metadata === "object" && !Array.isArray(event.metadata) &&
    Object.keys(event.metadata).every((key) => allowedAuditKeys.has(key))
  ), "persisted operational audit metadata uses the approved allowlist");
  check(!/(latitude|longitude|pickup_lat|destination_lat|phone|password|token|idempotency)/i.test(JSON.stringify(operationalAudits)), "persisted operational audit metadata excludes private payload values");

  // Seeded legacy rows sit on the predefined Hebron → Bethlehem route: they
  // carry its version but stay legacy (no canonical version, stops or window).
  const legacyRequest = await prisma.passengerRequest.findFirstOrThrow({ where: { source: "seed" } });
  check(legacyRequest.route_version_id !== null && legacyRequest.canonical_entry_version === null &&
    legacyRequest.pickup_stop_id === null && legacyRequest.operational_mode === "legacy", "legacy passenger remains valid");
  const legacyOrder = await prisma.merchantOrder.findFirstOrThrow({ where: { canonical_entry_version: null } });
  check(legacyOrder.route_version_id === legacyRequest.route_version_id && legacyOrder.pickup_stop_id === null, "legacy merchant order remains valid");
  check(await prisma.parcel.count({ where: { order_id: legacyOrder.id, route_version_id: legacyOrder.route_version_id, destination_stop_id: null } }) === 5, "legacy parcels remain valid");
  const legacyRoute = await prisma.driverRoute.findFirstOrThrow({ where: { canonical_availability_version: null, corridor_key: "hebron-to-bethlehem" } });
  check(legacyRoute.route_version_id === legacyRequest.route_version_id, "legacy DriverRoute remains valid");

  const linkedLegacyRoute = await prisma.driverRoute.findFirstOrThrow({
    where: { route_version_id: { not: null }, canonical_availability_version: null }
  });
  check(linkedLegacyRoute.operational_mode === "legacy", "linked demo availability is explicitly legacy mode");
  await rejects(() => prisma.match.create({ data: {
    driver_route_id: linkedLegacyRoute.id, route_version_id: linkedLegacyRoute.route_version_id!,
    canonical_match_version: "canonical_route_v1", operational_mode: "canonical_route_v1",
    score: "0.5000", method: "invalid_mode_crossing", explanation: "must fail", scoring_breakdown: { review: true }
  } }), /constraint|foreign key|P2003|P2004/i, "database rejects canonical match on legacy-mode availability");
  await rejects(() => prisma.match.create({ data: {
    driver_route_id: updateReleaseAvailability.id,
    score: "0.5000", method: "invalid_legacy_mode_crossing", explanation: "must fail", scoring_breakdown: { review: true }
  } }), /constraint|foreign key|P2003|P2004/i, "database rejects legacy match on canonical-mode availability");
  await rejects(() => prisma.capacityReservation.create({ data: {
    driver_route_id: linkedLegacyRoute.id, route_version_id: linkedLegacyRoute.route_version_id!,
    reservation_type: "passenger", seats_reserved: 1, parcel_units_reserved: 0,
    expires_at: new Date(Date.now() + 10 * 60_000), idempotency_fingerprint: "c".repeat(64)
  } }), /foreign key|P2003/i, "database rejects canonical reservation on legacy-mode availability");

  const legacyMatch = await prisma.match.create({ data: { driver_route_id: legacyRoute.id, score: "0.5000", method: "m7c1_legacy_check", explanation: "legacy compatibility", scoring_breakdown: { check: true } } });
  check(legacyMatch.route_version_id === null && legacyMatch.canonical_match_version === null, "legacy match remains valid");
  const legacyTrip = await prisma.trip.create({ data: { driver_id: legacyRoute.driver_id, driver_route_id: legacyRoute.id } });
  check(legacyTrip.route_version_id === null && legacyTrip.route_snapshot_json === null, "legacy trip remains valid");

  await resetDemoData(prisma);
  const counts = await Promise.all([
    prisma.capacityReservation.count(), prisma.serviceRoute.count(), prisma.serviceRouteVersion.count(),
    prisma.stop.count(), prisma.passengerRequest.count(), prisma.merchantOrder.count(), prisma.parcel.count()
  ]);
  check(counts[0] === 0, "demo reset removes reservation history before availability");
  check(counts.slice(1).join(",") === "21,21,13,1,1,5", "demo reset restores deterministic aggregate counts");
  await resetDemoData(prisma);
  check(await prisma.capacityReservation.count() === 0 && await prisma.driverRoute.count() === 2, "demo reset is idempotent");
  check(await prisma.auditEvent.count({ where: { action: "demo_reset" } }) === 1, "reset leaves only bounded deterministic audit state");

  check(checks === 79, `expected 79 persistent-state assertions, received ${checks}`);
  console.log("M7C1 real-MySQL operational and concurrency integration passed: 79 persistent-state assertions");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "M7C1 integration failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
