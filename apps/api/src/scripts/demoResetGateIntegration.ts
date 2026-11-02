import { createConfig, type AppConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
import {
  CANONICAL_MODE,
  DEMO_ACCOUNTS,
  DEMO_STOP_KEYS,
  resetDemoData
} from "../modules/demoReset.js";

const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
if (!databaseName.endsWith("_ci")) {
  throw new Error("M7H1 reset matrix requires a disposable database ending in _ci");
}

let assertions = 0;
function check(value: unknown, message: string) {
  if (!value) throw new Error(`M7H1 reset-matrix assertion failed: ${message}`);
  assertions += 1;
}

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    APP_ENV: "demo",
    DATABASE_URL: process.env.DATABASE_URL!,
    DEMO_RESET_ALLOWED_DATABASES: databaseName,
    JWT_SECRET: "m7h1-reset-jwt-secret-at-least-thirty-two-characters",
    ENABLE_DEMO_FEATURES: "true",
    DEMO_RESET_KEY: "m7h1-reset-key",
    DEMO_PASSENGER_PASSWORD: "m7h1-passenger-password",
    DEMO_DRIVER_PASSWORD: "m7h1-driver-password",
    DEMO_MERCHANT_PASSWORD: "m7h1-merchant-password",
    DEMO_ADMIN_PASSWORD: "m7h1-admin-password",
    LOG_LEVEL: "silent",
    ...overrides
  };
}

async function counts() {
  const [routes, legacyRoutes, canonicalRoutes, requests, canonicalRequests, orders, offers, reservations, trips, manifests] =
    await Promise.all([
      prisma.driverRoute.count(),
      prisma.driverRoute.count({ where: { operational_mode: "legacy", canonical_availability_version: null } }),
      prisma.driverRoute.count({ where: { operational_mode: CANONICAL_MODE, canonical_availability_version: CANONICAL_MODE } }),
      prisma.passengerRequest.count(),
      prisma.passengerRequest.count({ where: { operational_mode: CANONICAL_MODE } }),
      prisma.merchantOrder.count(),
      prisma.match.count({ where: { operational_mode: CANONICAL_MODE } }),
      prisma.capacityReservation.count({ where: { operational_mode: CANONICAL_MODE } }),
      prisma.trip.count({ where: { operational_mode: CANONICAL_MODE } }),
      prisma.canonicalTripManifest.count()
    ]);
  return { routes, legacyRoutes, canonicalRoutes, requests, canonicalRequests, orders, offers, reservations, trips, manifests };
}

async function fixtureSnapshot() {
  const [users, profiles, routes, requests, orders, parcels, scenarios] = await Promise.all([
    prisma.user.findMany({
      where: { demo_account: true },
      select: { name: true, phone: true, role: true, account_status: true, security_version: true },
      orderBy: { phone: "asc" }
    }),
    prisma.driverProfile.findMany({
      select: { vehicle_type: true, seats_total: true, parcel_capacity: true, verified: true, trust_score: true },
      orderBy: { trust_score: "desc" }
    }),
    prisma.driverRoute.findMany({
      select: {
        origin_label: true,
        destination_label: true,
        corridor_key: true,
        seats_available: true,
        parcel_capacity_available: true,
        status: true,
        operational_mode: true,
        canonical_availability_version: true,
        availability_status: true
      },
      orderBy: [{ operational_mode: "asc" }, { seats_available: "desc" }, { parcel_capacity_available: "desc" }]
    }),
    prisma.passengerRequest.findMany({
      select: { pickup_label: true, destination_label: true, passenger_count: true, status: true, operational_mode: true },
      orderBy: { operational_mode: "asc" }
    }),
    prisma.merchantOrder.findMany({
      select: { pickup_label: true, status: true, operational_mode: true },
      orderBy: { operational_mode: "asc" }
    }),
    prisma.parcel.findMany({
      select: { destination_label: true, size: true, priority: true, status: true, operational_mode: true },
      orderBy: { destination_label: "asc" }
    }),
    prisma.demoScenario.findMany({
      select: { scenario_key: true, corridor_key: true, seed_version: true },
      orderBy: { scenario_key: "asc" }
    })
  ]);
  return JSON.stringify({ users, profiles, routes, requests, orders, parcels, scenarios });
}

async function assertState(appConfig: AppConfig, expected: { routes: number; canonicalRoutes: number }, label: string) {
  await resetDemoData(prisma, appConfig);
  const state = await counts();
  check(state.legacyRoutes === 2, `${label}: two legacy routes`);
  check(state.routes === expected.routes, `${label}: total route count`);
  check(state.canonicalRoutes === expected.canonicalRoutes, `${label}: canonical availability count`);
  check(state.requests === 1 && state.canonicalRequests === 0, `${label}: legacy request only`);
  check(state.orders === 1, `${label}: legacy order only`);
  check(state.offers === 0 && state.reservations === 0 && state.trips === 0 && state.manifests === 0, `${label}: no canonical runtime rows`);
}

function requireConfigurationFailure(values: Record<string, string | undefined>, label: string) {
  try {
    createConfig(values);
  } catch {
    assertions += 1;
    return;
  }
  throw new Error(`M7H1 reset-matrix assertion failed: ${label} must fail closed`);
}

try {
  const disabled = createConfig(environment({
    MULTI_ROUTE_ENTRY_ENABLED: "false",
    MULTI_ROUTE_MATCHING_ENABLED: "false",
    CANONICAL_TRIP_CREATION_ENABLED: "false"
  }));
  await assertState(disabled, { routes: 2, canonicalRoutes: 0 }, "all gates false");

  await assertState(createConfig(environment({
    MULTI_ROUTE_ENTRY_ENABLED: "true",
    MULTI_ROUTE_MATCHING_ENABLED: "false",
    CANONICAL_TRIP_CREATION_ENABLED: "false"
  })), { routes: 2, canonicalRoutes: 0 }, "entry only");

  await assertState(createConfig(environment({
    MULTI_ROUTE_ENTRY_ENABLED: "true",
    MULTI_ROUTE_MATCHING_ENABLED: "true",
    CANONICAL_TRIP_CREATION_ENABLED: "false"
  })), { routes: 2, canonicalRoutes: 0 }, "entry and matching");

  const full = createConfig(environment({
    MULTI_ROUTE_ENTRY_ENABLED: "true",
    MULTI_ROUTE_MATCHING_ENABLED: "true",
    CANONICAL_TRIP_CREATION_ENABLED: "true"
  }));
  await assertState(full, { routes: 4, canonicalRoutes: 2 }, "full canonical dispatch");

  await assertState(createConfig(environment({
    MULTI_ROUTE_ENTRY_ENABLED: "true",
    MULTI_ROUTE_MATCHING_ENABLED: "true",
    CANONICAL_TRIP_CREATION_ENABLED: "true",
    CANONICAL_SHARED_TRIPS_ENABLED: "false"
  })), { routes: 4, canonicalRoutes: 2 }, "full dispatch, shared backend false");

  await assertState(createConfig(environment({
    MULTI_ROUTE_ENTRY_ENABLED: "true",
    MULTI_ROUTE_MATCHING_ENABLED: "true",
    CANONICAL_TRIP_CREATION_ENABLED: "true",
    CANONICAL_SHARED_TRIPS_ENABLED: "true",
    CANONICAL_SHARED_TRIP_MOBILE_ENABLED: "false"
  })), { routes: 4, canonicalRoutes: 2 }, "full dispatch, shared backend true");

  const beforeFailures = JSON.stringify(await counts());
  requireConfigurationFailure(environment({ MULTI_ROUTE_ENTRY_ENABLED: "yes" }), "malformed boolean");
  requireConfigurationFailure(environment({
    APP_ENV: "staging",
    CORS_ORIGINS: "https://admin.staging.darb.invalid",
    APP_RELEASE: "m7h1-staging",
    TRUST_PROXY: "1",
    REFRESH_TOKEN_PEPPER: "m7h1-staging-refresh-pepper-at-least-thirty-two",
    MULTI_ROUTE_ENTRY_ENABLED: "true"
  }), "staging canonical seed");
  requireConfigurationFailure(environment({
    APP_ENV: "production",
    CORS_ORIGINS: "https://admin.darb.invalid",
    APP_RELEASE: "m7h1-production",
    TRUST_PROXY: "1",
    REFRESH_TOKEN_PEPPER: "m7h1-production-refresh-pepper-at-least-thirty-two",
    MULTI_ROUTE_ENTRY_ENABLED: "true"
  }), "production canonical seed");
  check(JSON.stringify(await counts()) === beforeFailures, "invalid/production-like configuration mutates no rows");

  await resetDemoData(prisma, full);
  const firstSnapshot = await fixtureSnapshot();
  const firstCounts = JSON.stringify(await counts());
  await resetDemoData(prisma, full);
  check(await fixtureSnapshot() === firstSnapshot, "repeated reset reproduces normalized fixture rows");
  check(JSON.stringify(await counts()) === firstCounts, "repeated reset reproduces counts");

  const unsafeDatabaseUrl = new URL(process.env.DATABASE_URL!);
  unsafeDatabaseUrl.pathname = `/${databaseName}_unlisted`;
  const unsafeDatabase = createConfig(environment({ DATABASE_URL: unsafeDatabaseUrl.toString() }));
  const beforeUnsafeDatabaseReset = `${await fixtureSnapshot()}|${JSON.stringify(await counts())}`;
  try {
    await resetDemoData(prisma, unsafeDatabase);
    throw new Error("M7H1 reset-matrix assertion failed: unsafe database reset unexpectedly succeeded");
  } catch (error) {
    check(
      error instanceof Error && error.message === "demo_reset_database_not_allowed",
      "unlisted database identity blocks reset with the bounded safety code"
    );
  }
  check(
    `${await fixtureSnapshot()}|${JSON.stringify(await counts())}` === beforeUnsafeDatabaseReset,
    "unsafe database block performs zero destructive writes"
  );

  const realUser = await prisma.user.create({
    data: {
      name: "QA Reset Safety User",
      phone: "+972569990099",
      password_hash: "not-used-by-reset-safety-test",
      role: "passenger",
      account_status: "active",
      demo_account: false
    }
  });
  const beforeBlockedReset = `${await fixtureSnapshot()}|${JSON.stringify(await counts())}`;
  try {
    await resetDemoData(prisma, full);
    throw new Error("M7H1 reset-matrix assertion failed: non-demo user reset unexpectedly succeeded");
  } catch (error) {
    check(
      error instanceof Error && error.message === "demo_reset_real_data_present",
      "non-demo user blocks reset with the bounded safety code"
    );
  }
  check(
    `${await fixtureSnapshot()}|${JSON.stringify(await counts())}` === beforeBlockedReset,
    "non-demo user block performs zero destructive writes"
  );
  await prisma.user.delete({ where: { id: realUser.id } });

  const passenger = await prisma.user.findUniqueOrThrow({ where: { phone: DEMO_ACCOUNTS.passenger.phone } });
  const route = await prisma.serviceRoute.findUniqueOrThrow({ where: { route_key: "hebron-ppu-bab-al-zawiya-to-bethlehem" } });
  const versionId = route.current_version_id!;
  const pickup = await prisma.stop.findUniqueOrThrow({ where: { stop_key: DEMO_STOP_KEYS.passengerPickup } });
  const destination = await prisma.stop.findUniqueOrThrow({ where: { stop_key: DEMO_STOP_KEYS.destination } });
  const canonicalRequest = await prisma.passengerRequest.create({
    data: {
      passenger_id: passenger.id,
      pickup_label: pickup.name_en,
      pickup_lat: pickup.latitude,
      pickup_lng: pickup.longitude,
      destination_label: destination.name_en,
      destination_lat: destination.latitude,
      destination_lng: destination.longitude,
      preferred_time: new Date(Date.now() + 3_600_000),
      passenger_count: 1,
      route_version_id: versionId,
      pickup_stop_id: pickup.id,
      dropoff_stop_id: destination.id,
      canonical_entry_version: CANONICAL_MODE,
      requested_departure_from: new Date(Date.now() + 3_600_000),
      requested_departure_until: new Date(Date.now() + 7_200_000),
      canonical_created_at: new Date(),
      operational_mode: CANONICAL_MODE
    }
  });
  await prisma.canonicalDemandDispatch.create({
    data: {
      demand_type: "passenger",
      passenger_request_id: canonicalRequest.id,
      route_version_id: versionId,
      operational_mode: CANONICAL_MODE
    }
  });
  check(await prisma.canonicalDemandDispatch.count() === 1, "pre-existing canonical dispatch created");
  await resetDemoData(prisma, disabled);
  check(await prisma.canonicalDemandDispatch.count() === 0, "reset clears pre-existing canonical dispatch");
  check((await counts()).canonicalRoutes === 0, "restrictive cleanup returns to disabled final state");

  console.log(`M7H1 demo-reset gate matrix passed with ${assertions} assertions; shared manifest/Trip cleanup remains covered by the M7C3C1 harness.`);
} finally {
  await prisma.$disconnect();
}
