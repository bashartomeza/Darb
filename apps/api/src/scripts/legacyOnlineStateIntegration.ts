import { createConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { DEMO_ACCOUNTS, resetDemoData } from "../modules/demoReset.js";
import { createLegacyDriverOnlineStateService } from "../services/legacyDriverOnlineState.js";

const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
if (!databaseName.endsWith("_ci")) {
  throw new Error(
    "M7H1 online-state integration requires a disposable database ending in _ci",
  );
}

let assertions = 0;
function check(value: unknown, message: string) {
  if (!value) throw new Error(`M7H1 online-state assertion failed: ${message}`);
  assertions += 1;
}

const demoConfig = createConfig({
  APP_ENV: "demo",
  DATABASE_URL: process.env.DATABASE_URL!,
  DEMO_RESET_ALLOWED_DATABASES: databaseName,
  JWT_SECRET: "m7h1-online-jwt-secret-at-least-thirty-two-characters",
  ENABLE_DEMO_FEATURES: "true",
  DEMO_RESET_KEY: "m7h1-online-reset-key",
  DEMO_PASSENGER_PASSWORD: "m7h1-passenger-password",
  DEMO_DRIVER_PASSWORD: "m7h1-driver-password",
  DEMO_MERCHANT_PASSWORD: "m7h1-merchant-password",
  DEMO_ADMIN_PASSWORD: "m7h1-admin-password",
  MULTI_ROUTE_ENTRY_ENABLED: "true",
  MULTI_ROUTE_MATCHING_ENABLED: "true",
  CANONICAL_TRIP_CREATION_ENABLED: "true",
  LOG_LEVEL: "silent",
});

async function canonicalSnapshot() {
  const [routes, offers, reservations, trips, manifests] = await Promise.all([
    prisma.driverRoute.findMany({
      where: { operational_mode: "canonical_route_v1" },
      select: {
        id: true,
        status: true,
        seats_available: true,
        parcel_capacity_available: true,
        remaining_seats: true,
        remaining_parcel_capacity: true,
        availability_revision: true,
      },
      orderBy: { id: "asc" },
    }),
    prisma.match.count({ where: { operational_mode: "canonical_route_v1" } }),
    prisma.capacityReservation.count({
      where: { operational_mode: "canonical_route_v1" },
    }),
    prisma.trip.count({ where: { operational_mode: "canonical_route_v1" } }),
    prisma.canonicalTripManifest.count(),
  ]);
  return JSON.stringify({ routes, offers, reservations, trips, manifests });
}

try {
  await resetDemoData(prisma, demoConfig);
  const service = createLegacyDriverOnlineStateService(prisma);
  const [driverA, driverB] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { phone: DEMO_ACCOUNTS.driver1.phone },
      include: { driver_profile: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { phone: DEMO_ACCOUNTS.driver2.phone },
      include: { driver_profile: true },
    }),
  ]);
  check(
    driverA.driver_profile?.verified === true &&
      driverB.driver_profile?.verified === true,
    "verified driver fixtures",
  );

  await prisma.driverRoute.updateMany({
    where: {
      driver_id: driverA.driver_profile!.id,
      operational_mode: "legacy",
      canonical_availability_version: null,
    },
    data: { status: "inactive", completed_at: new Date() },
  });
  const canonicalBefore = await canonicalSnapshot();
  const onlineKey = "m7h1-response-loss-online-key";
  const concurrentOnline = await Promise.all(
    Array.from({ length: 10 }, () =>
      service.setState(
        { online: true },
        {
          id: driverA.id,
          idempotencyKey: onlineKey,
          requestId: "online-replay",
        },
      ),
    ),
  );
  check(
    concurrentOnline.every((result) => result.online),
    "ten concurrent exact online replays agree",
  );
  check(
    concurrentOnline.filter((result) => result.changed).length === 1,
    "one online transition wins",
  );
  const routeId = concurrentOnline[0].routeId;
  check(
    concurrentOnline.every((result) => result.routeId === routeId),
    "all online replays return one route",
  );
  check(
    (await prisma.driverRoute.count({
      where: { id: routeId, status: "active", operational_mode: "legacy" },
    })) === 1,
    "authoritative state is online",
  );
  check(
    (await prisma.auditEvent.count({
      where: {
        user_id: driverA.id,
        action: "driver_route_created",
        entity_id: routeId,
      },
    })) === 1,
    "one online audit transition",
  );
  const onlineReplay = await service.setState(
    { online: true },
    { id: driverA.id, idempotencyKey: onlineKey },
  );
  check(
    onlineReplay.replayed &&
      onlineReplay.online &&
      onlineReplay.routeId === routeId,
    "dropped online response replays exactly",
  );

  let conflict = false;
  try {
    await service.setState(
      { online: false, expectedRouteId: routeId },
      { id: driverA.id, idempotencyKey: onlineKey },
    );
  } catch (error) {
    conflict =
      error instanceof Error && error.message === "idempotency_conflict";
  }
  check(conflict, "same actor key with changed desired state conflicts");

  const crossActor = await service.setState(
    { online: true },
    { id: driverB.id, idempotencyKey: onlineKey },
  );
  check(
    (await prisma.driverRoute.count({
      where: { id: crossActor.routeId, driver_id: driverB.driver_profile!.id },
    })) === 1,
    "same raw key is actor-scoped to driver B",
  );
  check(
    (await prisma.driverRoute.count({
      where: {
        id: routeId,
        driver_id: driverA.driver_profile!.id,
        status: "active",
      },
    })) === 1,
    "cross-actor call cannot mutate driver A",
  );

  const offlineKey = "m7h1-response-loss-offline-key";
  const concurrentOffline = await Promise.all(
    Array.from({ length: 10 }, () =>
      service.setState(
        { online: false, expectedRouteId: routeId },
        {
          id: driverA.id,
          idempotencyKey: offlineKey,
          requestId: "offline-replay",
        },
      ),
    ),
  );
  check(
    concurrentOffline.every((result) => !result.online),
    "ten concurrent exact offline replays agree",
  );
  check(
    concurrentOffline.filter((result) => result.changed).length === 1,
    "one offline transition wins",
  );
  check(
    (await prisma.driverRoute.count({
      where: { id: routeId, status: "inactive" },
    })) === 1,
    "authoritative state is offline",
  );
  check(
    (await prisma.auditEvent.count({
      where: {
        user_id: driverA.id,
        action: "driver_route_deactivated",
        entity_id: routeId,
      },
    })) === 1,
    "one offline audit transition",
  );
  const offlineReplay = await service.setState(
    { online: false, expectedRouteId: routeId },
    { id: driverA.id, idempotencyKey: offlineKey },
  );
  check(
    offlineReplay.replayed && !offlineReplay.online,
    "dropped offline response replays exactly",
  );

  await prisma.driverRoute.update({
    where: { id: routeId },
    data: { status: "assigned" },
  });
  let assignedBlocked = false;
  try {
    await service.setState(
      { online: false, expectedRouteId: routeId },
      { id: driverA.id, idempotencyKey: "m7h1-assigned-route-key" },
    );
  } catch (error) {
    assignedBlocked =
      error instanceof Error && error.message === "route_cannot_deactivate";
  }
  check(assignedBlocked, "assigned legacy route cannot be deactivated");
  check(
    (await prisma.driverRoute.count({
      where: { id: routeId, status: "assigned" },
    })) === 1,
    "failed transition rolls back fully",
  );

  check(
    (await canonicalSnapshot()) === canonicalBefore,
    "canonical routes, capacities, offers, reservations, Trips and manifests are unchanged",
  );
  const records = await prisma.idempotencyRecord.findMany({
    where: { operation: "legacy_driver_online_state_v1" },
    select: { idempotency_key: true, request_digest: true, scope_digest: true },
  });
  check(
    records.length === 3,
    "only completed actor-scoped operation records persist",
  );
  check(
    records.every((record) =>
      Object.values(record).every((value) => /^[a-f0-9]{64}$/.test(value)),
    ),
    "only digests are persisted",
  );
  check(
    records.every(
      (record) =>
        record.idempotency_key !== onlineKey &&
        record.idempotency_key !== offlineKey,
    ),
    "raw keys are never persisted",
  );

  console.log(
    `M7H1 legacy online-state integration passed with ${assertions} assertions.`,
  );
} finally {
  await prisma.$disconnect();
}
