import { createConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { DEMO_ACCOUNTS, resetDemoData } from "../modules/demoReset.js";

const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
if (!databaseName.endsWith("_ci")) {
  throw new Error(
    "M7H1 passenger association integration requires a disposable database ending in _ci",
  );
}

let assertions = 0;
function check(value: unknown, message: string) {
  if (!value)
    throw new Error(`M7H1 passenger-association assertion failed: ${message}`);
  assertions += 1;
}

const demoConfig = createConfig({
  APP_ENV: "demo",
  DATABASE_URL: process.env.DATABASE_URL!,
  DEMO_RESET_ALLOWED_DATABASES: databaseName,
  JWT_SECRET: "m7h1-association-jwt-secret-at-least-thirty-two-characters",
  ENABLE_DEMO_FEATURES: "true",
  DEMO_RESET_KEY: "m7h1-association-reset-key",
  DEMO_PASSENGER_PASSWORD: "m7h1-passenger-password",
  DEMO_DRIVER_PASSWORD: "m7h1-driver-password",
  DEMO_MERCHANT_PASSWORD: "m7h1-merchant-password",
  DEMO_ADMIN_PASSWORD: "m7h1-admin-password",
  LOG_LEVEL: "silent",
});

const requestData = (
  passengerId: string,
  label: string,
  createdAt: Date,
  status: "pending" | "cancelled" = "pending",
) => ({
  passenger_id: passengerId,
  pickup_label: `${label} pickup`,
  pickup_lat: "31.532600",
  pickup_lng: "35.099800",
  destination_label: `${label} destination`,
  destination_lat: "31.705400",
  destination_lng: "35.202400",
  preferred_time: new Date("2026-08-07T10:00:00.000Z"),
  passenger_count: 1,
  status,
  source: "m7h1_persistent_association",
  operational_mode: "legacy",
  created_at: createdAt,
});

try {
  await resetDemoData(prisma, demoConfig);
  const owner = await prisma.user.findUniqueOrThrow({
    where: { phone: DEMO_ACCOUNTS.passenger.phone },
  });
  const other = await prisma.user.upsert({
    where: { phone: "+970599990071" },
    create: {
      name: "M7H1 other passenger",
      phone: "+970599990071",
      password_hash: "synthetic-not-a-login-secret",
      role: "passenger",
      account_status: "active",
      demo_account: true,
    },
    update: {
      name: "M7H1 other passenger",
      role: "passenger",
      account_status: "active",
      demo_account: true,
    },
  });
  const route = await prisma.driverRoute.findFirstOrThrow({
    where: { operational_mode: "legacy", canonical_availability_version: null },
    orderBy: { activated_at: "asc" },
  });
  const [requestB, unassigned, cancelled, requestA, crossOwner] =
    await Promise.all([
      prisma.passengerRequest.create({
        data: requestData(owner.id, "B", new Date("2026-08-06T10:02:00.000Z")),
      }),
      prisma.passengerRequest.create({
        data: requestData(
          owner.id,
          "unassigned",
          new Date("2026-08-06T10:03:00.000Z"),
        ),
      }),
      prisma.passengerRequest.create({
        data: requestData(
          owner.id,
          "cancelled",
          new Date("2026-08-06T10:04:00.000Z"),
          "cancelled",
        ),
      }),
      prisma.passengerRequest.create({
        data: requestData(owner.id, "A", new Date("2026-08-06T10:05:00.000Z")),
      }),
      prisma.passengerRequest.create({
        data: requestData(
          other.id,
          "private",
          new Date("2026-08-06T10:06:00.000Z"),
        ),
      }),
    ]);
  const tripA = await prisma.trip.create({
    data: {
      driver_id: route.driver_id,
      driver_route_id: route.id,
      passenger_request_id: requestA.id,
      status: "accepted",
      operational_mode: "legacy",
      created_at: new Date("2026-08-06T10:10:00.000Z"),
    },
  });
  const tripB = await prisma.trip.create({
    data: {
      driver_id: route.driver_id,
      driver_route_id: route.id,
      passenger_request_id: requestB.id,
      status: "accepted",
      operational_mode: "legacy",
      created_at: new Date("2026-08-06T10:20:00.000Z"),
    },
  });
  await prisma.trip.create({
    data: {
      driver_id: route.driver_id,
      driver_route_id: route.id,
      passenger_request_id: crossOwner.id,
      status: "accepted",
      operational_mode: "legacy",
      created_at: new Date("2026-08-06T10:30:00.000Z"),
    },
  });

  const ownerTrips = await prisma.trip.findMany({
    where: {
      operational_mode: "legacy",
      canonical_trip_version: null,
      passenger_request: { passenger_id: owner.id },
      passenger_request_id: {
        in: [requestA.id, requestB.id, unassigned.id, cancelled.id],
      },
    },
    select: { id: true, passenger_request_id: true, created_at: true },
    orderBy: { created_at: "desc" },
  });
  const association = new Map(
    ownerTrips.map((trip) => [trip.passenger_request_id, trip.id]),
  );
  check(
    ownerTrips.length === 2,
    "owner receives only two assigned legacy Trips",
  );
  check(
    ownerTrips[0]?.id === tripB.id,
    "newest Trip B may sort first without changing provenance",
  );
  check(
    association.get(requestA.id) === tripA.id,
    "request A maps only to Trip A",
  );
  check(
    association.get(requestB.id) === tripB.id,
    "request B maps only to Trip B",
  );
  check(!association.has(unassigned.id), "unassigned request has no Trip");
  check(
    !association.has(cancelled.id),
    "cancelled request cannot inherit another Trip",
  );
  check(
    !ownerTrips.some((trip) => trip.passenger_request_id === crossOwner.id),
    "cross-owner Trip is concealed",
  );

  for (const orderBy of [
    { created_at: "asc" },
    { created_at: "desc" },
  ] as const) {
    const requests = await prisma.passengerRequest.findMany({
      where: {
        id: { in: [requestA.id, requestB.id, unassigned.id, cancelled.id] },
        passenger_id: owner.id,
      },
      select: { id: true },
      orderBy,
    });
    const mapped = requests.map(
      (request) => association.get(request.id) ?? null,
    );
    check(
      mapped.filter(Boolean).length === 2,
      `request ordering ${orderBy.created_at} preserves two exact assignments`,
    );
    check(
      requests.every(
        (request, index) =>
          mapped[index] ===
          (request.id === requestA.id
            ? tripA.id
            : request.id === requestB.id
              ? tripB.id
              : null),
      ),
      `request ordering ${orderBy.created_at} cannot cross-associate`,
    );
  }

  const canonicalSingle = await prisma.canonicalDemandDispatch.count({
    where: {
      passenger_request: { passenger_id: owner.id },
      assigned_trip_id: { not: null },
    },
  });
  check(
    canonicalSingle === 0,
    "legacy scenario does not fabricate canonical assignment provenance",
  );
  console.log(
    `M7H1 passenger Trip-association integration passed with ${assertions} assertions; canonical single/shared provenance remains covered by M7C3A/M7C3C1.`,
  );
} finally {
  await prisma.$disconnect();
}
