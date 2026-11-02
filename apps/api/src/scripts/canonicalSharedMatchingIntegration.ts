import { createConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { resetDemoData } from "../modules/demoReset.js";
import { canonicalSharedSerializers } from "../modules/canonicalSharedMatching.js";
import { createCapacityReservationService } from "../services/capacityReservations.js";
import { createCanonicalMatchingService } from "../services/canonicalMatching.js";
import {
  createCanonicalSharedMatchingService,
  GLOBAL_CAPACITY_VERSION,
  SHARED_MANIFEST_VERSION,
  SHARED_MATCH_VERSION,
  SHARED_SNAPSHOT_VERSION,
  SHARED_TRIP_VERSION
} from "../services/canonicalSharedMatching.js";

const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
if (!databaseName.endsWith("_ci")) {
  throw new Error("M7C3C1 harness requires a disposable database ending in _ci");
}

let assertions = 0;
function check(value: unknown, message: string) {
  if (!value) throw new Error(`M7C3C1 assertion failed: ${message}`);
  assertions += 1;
}
async function rejects(action: () => Promise<unknown>, message: string) {
  try {
    await action();
  } catch {
    assertions += 1;
    return;
  }
  throw new Error(`M7C3C1 assertion failed: ${message}`);
}

const mode = "canonical_route_v1";
const now = new Date("2031-02-10T08:00:00.000Z");
const from = new Date("2031-02-10T09:00:00.000Z");
const until = new Date("2031-02-10T11:00:00.000Z");
const departure = new Date("2031-02-10T09:30:00.000Z");
const testConfig = createConfig({
  APP_ENV: "test",
  DATABASE_URL: process.env.DATABASE_URL!,
  DEMO_RESET_ALLOWED_DATABASES: databaseName,
  JWT_SECRET: "m7c3c1-test-jwt-secret-at-least-thirty-two-characters",
  MULTI_ROUTE_ENTRY_ENABLED: "true",
  MULTI_ROUTE_MATCHING_ENABLED: "true",
  CANONICAL_TRIP_CREATION_ENABLED: "true",
  CANONICAL_SHARED_TRIPS_ENABLED: "true",
  DEMO_RESET_KEY: "m7c3c1-test-reset",
  DEMO_PASSENGER_PASSWORD: "m7c3c1-test-passenger",
  DEMO_DRIVER_PASSWORD: "m7c3c1-test-driver",
  DEMO_MERCHANT_PASSWORD: "m7c3c1-test-merchant",
  DEMO_ADMIN_PASSWORD: "m7c3c1-test-admin",
  LOG_LEVEL: "silent"
});
const service = createCanonicalSharedMatchingService(prisma, testConfig);
const capacityReservations = createCapacityReservationService(prisma);
const singleMatching = createCanonicalMatchingService(prisma, testConfig);

let nextId = 1;
const id = (prefix: string) => `m7c3c1_${prefix}_${nextId++}`;

async function seedCatalog() {
  const admin = await prisma.user.create({
    data: {
      id: "m7c3c1_admin",
      name: "M7C3C1 Admin",
      phone: "+970598820001",
      password_hash: "integration-only",
      role: "admin",
      demo_account: true
    }
  });
  const passengers = [];
  const merchants = [];
  const drivers = [];
  for (let index = 0; index < 8; index++) {
    passengers.push(await prisma.user.create({
      data: {
        id: `m7c3c1_passenger_${index}`,
        name: `Passenger ${index}`,
        phone: `+9705988210${String(index).padStart(2, "0")}`,
        password_hash: "integration-only",
        role: "passenger",
        demo_account: true
      }
    }));
    merchants.push(await prisma.user.create({
      data: {
        id: `m7c3c1_merchant_${index}`,
        name: `Merchant ${index}`,
        phone: `+9705988220${String(index).padStart(2, "0")}`,
        password_hash: "integration-only",
        role: "merchant",
        demo_account: true
      }
    }));
    const user = await prisma.user.create({
      data: {
        id: `m7c3c1_driver_user_${index}`,
        name: `Driver ${index}`,
        phone: `+9705988230${String(index).padStart(2, "0")}`,
        password_hash: "integration-only",
        role: "driver",
        demo_account: true
      }
    });
    const profile = await prisma.driverProfile.create({
      data: {
        id: `m7c3c1_driver_profile_${index}`,
        user_id: user.id,
        vehicle_type: index % 2 === 0 ? "van" : "sedan",
        seats_total: 8,
        parcel_capacity: 20,
        verified: true,
        trust_score: 95 - index
      }
    });
    drivers.push({ user, profile });
  }
  const stops = [];
  for (let index = 0; index < 5; index++) {
    stops.push(await prisma.stop.create({
      data: {
        id: `m7c3c1_stop_${index + 1}`,
        stop_key: `m7c3c1-stop-${index + 1}`,
        service_region_key: "palestine-south",
        name_ar: `محطة ${index + 1}`,
        name_en: `Stop ${index + 1}`,
        latitude: 31.5 + index / 100,
        longitude: 35 + index / 100,
        created_by_user_id: admin.id
      }
    }));
  }
  const route = await prisma.serviceRoute.create({
    data: {
      id: "m7c3c1_route",
      route_key: "m7c3c1-hebron-bethlehem",
      route_group_key: "m7c3c1-south",
      service_region_key: "palestine-south",
      direction: "outbound",
      created_by_user_id: admin.id
    }
  });
  const version = await prisma.serviceRouteVersion.create({
    data: {
      id: "m7c3c1_version",
      service_route_id: route.id,
      version_number: 1,
      status: "published",
      name_ar: "الخليل إلى بيت لحم",
      name_en: "Hebron to Bethlehem",
      origin_stop_id: stops[0].id,
      destination_stop_id: stops[4].id,
      active_from: new Date("2020-01-01T00:00:00.000Z"),
      published_at: new Date("2020-01-01T00:00:00.000Z"),
      created_by_user_id: admin.id,
      published_by_user_id: admin.id
    }
  });
  for (let index = 0; index < stops.length; index++) {
    await prisma.routeVersionStop.create({
      data: {
        id: `m7c3c1_membership_${index + 1}`,
        service_route_version_id: version.id,
        stop_id: stops[index].id,
        sequence: index + 1
      }
    });
  }
  await prisma.serviceRoute.update({
    where: { id: route.id },
    data: { current_version_id: version.id }
  });
  return { admin, passengers, merchants, drivers, stops, route, version };
}

type Fixture = Awaited<ReturnType<typeof seedCatalog>>;

async function availability(fixture: Fixture, driverIndex: number, options: {
  seats?: number;
  parcels?: number;
  departureAt?: Date;
} = {}) {
  const seats = options.seats ?? 8;
  const parcels = options.parcels ?? 20;
  return prisma.driverRoute.create({
    data: {
      id: id("availability"),
      driver_id: fixture.drivers[driverIndex].profile.id,
      origin_label: "canonical",
      origin_lat: 31.5,
      origin_lng: 35,
      destination_label: "canonical",
      destination_lat: 31.7,
      destination_lng: 35.2,
      corridor_key: "canonical",
      seats_available: seats,
      parcel_capacity_available: parcels,
      status: "active",
      route_version_id: fixture.version.id,
      departure_at: options.departureAt ?? departure,
      availability_window_end: until,
      total_seats: seats,
      remaining_seats: seats,
      total_parcel_capacity: parcels,
      remaining_parcel_capacity: parcels,
      availability_status: "active",
      canonical_availability_version: mode,
      operational_mode: mode,
      activated_at: now
    }
  });
}

async function passengerDemand(
  fixture: Fixture,
  passengerIndex: number,
  seats = 1,
  departureFrom = from,
  departureUntil = until
) {
  const requestId = id("request");
  const request = await prisma.passengerRequest.create({
    data: {
      id: requestId,
      passenger_id: fixture.passengers[passengerIndex].id,
      pickup_label: "canonical",
      pickup_lat: 31.51,
      pickup_lng: 35.01,
      destination_label: "canonical",
      destination_lat: 31.54,
      destination_lng: 35.04,
      preferred_time: departureFrom,
      passenger_count: seats,
      status: "pending",
      source: mode,
      route_version_id: fixture.version.id,
      pickup_stop_id: fixture.stops[1].id,
      dropoff_stop_id: fixture.stops[4].id,
      canonical_entry_version: mode,
      operational_mode: mode,
      requested_departure_from: departureFrom,
      requested_departure_until: departureUntil,
      canonical_created_at: now
    }
  });
  const dispatch = await prisma.canonicalDemandDispatch.create({
    data: {
      id: id("dispatch"),
      demand_type: "passenger",
      passenger_request_id: request.id,
      route_version_id: fixture.version.id,
      operational_mode: mode
    }
  });
  return { request, dispatch };
}

async function merchantDemand(
  fixture: Fixture,
  merchantIndex: number,
  parcelCount = 2,
  departureFrom = from,
  departureUntil = until
) {
  const order = await prisma.merchantOrder.create({
    data: {
      id: id("order"),
      merchant_id: fixture.merchants[merchantIndex].id,
      pickup_label: "canonical",
      pickup_lat: 31.51,
      pickup_lng: 35.01,
      status: "submitted",
      route_version_id: fixture.version.id,
      pickup_stop_id: fixture.stops[1].id,
      canonical_entry_version: mode,
      operational_mode: mode,
      requested_departure_from: departureFrom,
      requested_departure_until: departureUntil,
      canonical_created_at: now
    }
  });
  for (let index = 0; index < parcelCount; index++) {
    const stop = fixture.stops[2 + (index % 3)];
    await prisma.parcel.create({
      data: {
        id: id("parcel"),
        order_id: order.id,
        destination_label: "canonical",
        destination_lat: 31.52 + index / 1000,
        destination_lng: 35.02 + index / 1000,
        size: "S",
        priority: "normal",
        route_version_id: fixture.version.id,
        destination_stop_id: stop.id,
        canonical_entry_version: mode,
        operational_mode: mode
      }
    });
  }
  const dispatch = await prisma.canonicalDemandDispatch.create({
    data: {
      id: id("dispatch"),
      demand_type: "merchant_order",
      merchant_order_id: order.id,
      route_version_id: fixture.version.id,
      operational_mode: mode
    }
  });
  return { order, dispatch };
}

try {
  check(testConfig.canonicalSharedTripsEnabled, "shared gate enabled");
  check(testConfig.multiRouteEntryEnabled, "entry dependency enabled");
  check(testConfig.multiRouteMatchingEnabled, "matching dependency enabled");
  check(testConfig.canonicalTripCreationEnabled, "Trip dependency enabled");
  const fixture = await seedCatalog();
  check(await prisma.serviceRoute.count() === 1, "one route");
  check(await prisma.serviceRouteVersion.count() === 1, "one route version");
  check(await prisma.routeVersionStop.count() === 5, "five ordered stops");

  const mixedAvailability = await availability(fixture, 0, { seats: 6, parcels: 10 });
  const passengerA = await passengerDemand(fixture, 0, 2);
  const passengerB = await passengerDemand(fixture, 1, 1);
  const orderA = await merchantDemand(fixture, 0, 2);
  const orderB = await merchantDemand(fixture, 1, 2);
  const mixedRun = await service.run({ now, requestId: "mixed-run", throwOnFailure: true });
  check(mixedRun.offered === 1, "one mixed manifest offered");
  check(mixedRun.failed === 0, "mixed runner has no failure");
  check(mixedRun.manifestIds.length === 1, "one manifest ID returned");
  check(mixedRun.offerIds.length === 1, "one offer ID returned");
  const manifest = await prisma.canonicalTripManifest.findUniqueOrThrow({
    where: { id: mixedRun.manifestIds[0] },
    include: {
      members: { include: { dispatch: true }, orderBy: { id: "asc" } },
      reservation: true,
      active_offer: true
    }
  });
  check(manifest.match_version === SHARED_MATCH_VERSION, "shared match version");
  check(manifest.trip_version === SHARED_TRIP_VERSION, "shared Trip version");
  check(manifest.capacity_model === GLOBAL_CAPACITY_VERSION, "global capacity model");
  check(manifest.manifest_schema_version === SHARED_MANIFEST_VERSION, "manifest schema version");
  check(manifest.lifecycle_status === "offered", "manifest offered");
  check(manifest.member_count === 4, "four members aggregated");
  check(manifest.passenger_request_count === 2, "two passenger requests");
  check(manifest.passenger_seat_count === 3, "three passenger seats");
  check(manifest.merchant_order_count === 2, "two merchant orders");
  check(manifest.parcel_unit_count === 4, "four parcel units");
  check(manifest.members.length === 4, "four membership rows");
  check(manifest.members.every((member) => member.member_status === "active"), "members active");
  check(manifest.members.every((member) => member.active_dispatch_key === member.dispatch_id), "active member keys");
  check(manifest.members.every((member) => /^[a-f0-9]{64}$/.test(member.demand_fingerprint)), "member fingerprints");
  check(/^[a-f0-9]{64}$/.test(manifest.manifest_fingerprint), "manifest fingerprint");
  check(manifest.reservation?.reservation_type === "combined", "mixed reservation type");
  check(manifest.reservation?.seats_reserved === 3, "aggregate seats reserved");
  check(manifest.reservation?.parcel_units_reserved === 4, "aggregate parcels reserved");
  check(manifest.reservation?.reservation_fingerprint === manifest.manifest_fingerprint, "reservation fingerprint");
  check(manifest.active_offer?.manifest_id === manifest.id, "offer owned by manifest");
  check(manifest.active_offer?.canonical_match_version === SHARED_MATCH_VERSION, "aggregate offer version");
  check(await prisma.match.count({ where: { manifest_id: manifest.id } }) === 1, "one aggregate offer");
  check(await prisma.capacityReservation.count({ where: { manifest_id: manifest.id } }) === 1, "one aggregate reservation");
  check(await prisma.canonicalDemandAttempt.count({ where: { manifest_id: manifest.id } }) === 4, "one attempt per member");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: mixedAvailability.id } })).remaining_seats === 3, "seats decremented once");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: mixedAvailability.id } })).remaining_parcel_capacity === 6, "parcels decremented once");
  check(await prisma.auditEvent.count({ where: { action: "canonical_manifest_created", entity_id: manifest.id } }) === 1, "one created audit");
  check(await prisma.auditEvent.count({ where: { action: "canonical_manifest_offered", entity_id: manifest.id } }) === 1, "one offered audit");
  check((await service.run({ now })).offered === 0, "second worker cannot claim offered members");

  await rejects(
    () => prisma.canonicalTripManifestMember.create({
      data: {
        id: id("invalid_member"),
        manifest_id: manifest.id,
        dispatch_id: passengerA.dispatch.id,
        demand_type: "passenger",
        member_sequence: 1,
        demand_id: passengerA.request.id,
        passenger_request_id: passengerA.request.id,
        passenger_seats: 2,
        parcel_units: 0,
        pickup_stop_id: fixture.stops[1].id,
        drop_off_stop_id: fixture.stops[4].id,
        demand_fingerprint: "a".repeat(64),
        attempt_number: 1,
        active_dispatch_key: passengerA.dispatch.id,
        route_version_id: fixture.version.id
      }
    }),
    "duplicate active membership rejected"
  );
  await rejects(
    () => prisma.canonicalTripManifestMember.create({
      data: {
        id: id("unrelated_member"),
        manifest_id: manifest.id,
        dispatch_id: passengerA.dispatch.id,
        demand_type: "passenger",
        member_sequence: 2,
        demand_id: passengerB.request.id,
        passenger_request_id: passengerB.request.id,
        passenger_seats: 1,
        parcel_units: 0,
        pickup_stop_id: fixture.stops[1].id,
        drop_off_stop_id: fixture.stops[4].id,
        demand_fingerprint: "b".repeat(64),
        attempt_number: 1,
        active_dispatch_key: null,
        route_version_id: fixture.version.id
      }
    }),
    "unrelated demand membership rejected"
  );

  const driverOffers = await service.listDriverOffers(fixture.drivers[0].user.id);
  check(driverOffers.length === 1, "owner driver sees aggregate offer");
  check((await service.listDriverOffers(fixture.drivers[1].user.id)).length === 0, "other driver cannot see offer");
  const serialized = canonicalSharedSerializers.aggregateOfferResponse(driverOffers[0] as never);
  const encoded = JSON.stringify(serialized);
  check(serialized.passenger_request_count === 2, "serializer passenger count");
  check(serialized.merchant_order_count === 2, "serializer merchant count");
  check(serialized.stop_events.length >= 2, "serializer safe stop events");
  check(!/fingerprint|dispatch|reservation|phone|name"|parcel_description/i.test(encoded), "serializer privacy");

  const accepts = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      service.accept(fixture.drivers[0].user.id, manifest.active_offer_id!, {
        id: fixture.drivers[0].user.id,
        idempotencyKey: `mixed-accept-${index}`,
        requestId: `mixed-accept-${index}`
      })
    )
  );
  check(accepts.length === 10, "ten concurrent accepts return");
  check(new Set(accepts.map((item) => item.trip.id)).size === 1, "ten accepts return one Trip");
  const acceptedManifest = await prisma.canonicalTripManifest.findUniqueOrThrow({
    where: { id: manifest.id },
    include: { members: { include: { dispatch: true } }, assigned_trip: true, accepted_offer: true, reservation: true }
  });
  check(acceptedManifest.lifecycle_status === "accepted", "manifest accepted");
  check(acceptedManifest.active_offer_id === null, "active offer cleared");
  check(acceptedManifest.accepted_offer_id === manifest.active_offer_id, "accepted offer pointer");
  check(Boolean(acceptedManifest.assigned_trip_id), "assigned Trip pointer");
  check(acceptedManifest.assigned_trip?.canonical_trip_version === SHARED_TRIP_VERSION, "shared Trip version");
  check(acceptedManifest.assigned_trip?.route_snapshot_schema_version === SHARED_SNAPSHOT_VERSION, "shared snapshot version");
  check(/^[a-f0-9]{64}$/.test(acceptedManifest.assigned_trip?.route_snapshot_checksum ?? ""), "snapshot checksum");
  check(acceptedManifest.members.every((member) => member.member_status === "accepted"), "members accepted");
  check(acceptedManifest.members.every((member) => member.dispatch.status === "assigned"), "dispatches assigned");
  check(new Set(acceptedManifest.members.map((member) => member.dispatch.assigned_trip_id)).size === 1, "all dispatches share Trip");
  check(acceptedManifest.members.every((member) => member.dispatch.accepted_manifest_id === manifest.id), "dispatch manifest ownership");
  check(await prisma.trip.count({ where: { manifest_id: manifest.id } }) === 1, "one Trip per manifest");
  check(await prisma.trip.count({ where: { driver_route_id: mixedAvailability.id, operational_mode: mode } }) === 1, "one Trip per availability");
  check(acceptedManifest.reservation?.status === "confirmed", "reservation confirmed");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: mixedAvailability.id } })).remaining_seats === 3, "accept no second seat decrement");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: mixedAvailability.id } })).remaining_parcel_capacity === 6, "accept no second parcel decrement");
  check(await prisma.locationEvent.count({ where: { trip_id: acceptedManifest.assigned_trip_id! } }) === 0, "no location events");
  check(await prisma.auditEvent.count({ where: { action: "canonical_shared_trip_created", entity_id: acceptedManifest.assigned_trip_id } }) === 1, "one shared Trip audit");
  check((await prisma.passengerRequest.findUniqueOrThrow({ where: { id: passengerA.request.id } })).status === "matched", "passenger A assigned");
  check((await prisma.passengerRequest.findUniqueOrThrow({ where: { id: passengerB.request.id } })).status === "matched", "passenger B assigned");
  check((await prisma.merchantOrder.findUniqueOrThrow({ where: { id: orderA.order.id } })).status === "assigned", "merchant A assigned");
  check((await prisma.merchantOrder.findUniqueOrThrow({ where: { id: orderB.order.id } })).status === "assigned", "merchant B assigned");
  check(await prisma.parcel.count({ where: { order_id: orderA.order.id, status: "assigned" } }) === 2, "merchant A parcels assigned");
  check(await prisma.parcel.count({ where: { order_id: orderB.order.id, status: "assigned" } }) === 2, "merchant B parcels assigned");
  await rejects(
    () => prisma.canonicalTripManifest.update({
      where: { id: acceptedManifest.id },
      data: { passenger_seat_count: acceptedManifest.passenger_seat_count + 1 }
    }),
    "accepted manifest aggregate totals are immutable"
  );
  await rejects(
    () => prisma.canonicalTripManifestMember.update({
      where: { id: acceptedManifest.members[0]!.id },
      data: { passenger_seats: acceptedManifest.members[0]!.passenger_seats + 1 }
    }),
    "accepted member capacity snapshot is immutable"
  );
  await rejects(
    () => prisma.capacityReservation.update({
      where: { id: acceptedManifest.reservation!.id },
      data: { seats_reserved: acceptedManifest.reservation!.seats_reserved + 1 }
    }),
    "accepted reservation capacity snapshot is immutable"
  );

  await rejects(
    () => prisma.canonicalDemandDispatch.update({
      where: { id: passengerA.dispatch.id },
      data: { assigned_trip_id: "nonexistent", accepted_manifest_id: manifest.id }
    }),
    "cross-manifest dispatch Trip rejected"
  );

  const rejectAvailability = await availability(fixture, 1, { seats: 4, parcels: 4 });
  const rejectDemand = await passengerDemand(fixture, 2, 2);
  const rejectRun = await service.run({ now, requestId: "reject-run" });
  check(rejectRun.offered === 1, "reject scenario offered");
  const rejectManifest = await prisma.canonicalTripManifest.findUniqueOrThrow({
    where: { id: rejectRun.manifestIds[0] },
    include: { active_offer: true }
  });
  const rejectResults = await Promise.all([
    service.reject(fixture.drivers[1].user.id, rejectManifest.active_offer_id!, "driver_declined", {
      id: fixture.drivers[1].user.id,
      idempotencyKey: "reject-replay-key",
      requestId: "reject-1"
    }),
    service.reject(fixture.drivers[1].user.id, rejectManifest.active_offer_id!, "driver_declined", {
      id: fixture.drivers[1].user.id,
      idempotencyKey: "reject-replay-key",
      requestId: "reject-2"
    })
  ]);
  check(rejectResults.length === 2, "reject replay reconciles");
  const rejected = await prisma.canonicalTripManifest.findUniqueOrThrow({
    where: { id: rejectManifest.id },
    include: { members: { include: { dispatch: true } }, reservation: true }
  });
  check(rejected.lifecycle_status === "rejected", "whole manifest rejected");
  check(rejected.members.every((member) => member.member_status === "released"), "members released");
  check(rejected.members.every((member) => member.dispatch.status === "pending"), "members pending independently");
  check(rejected.reservation?.status === "released", "reject reservation released");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: rejectAvailability.id } })).remaining_seats === 4, "reject restores seats once");
  check(await prisma.canonicalDemandAttempt.count({ where: { manifest_id: rejected.id, outcome: "rejected" } }) === 1, "reject outcome once");
  check(await prisma.trip.count({ where: { manifest_id: rejected.id } }) === 0, "reject creates no Trip");
  check((await prisma.canonicalDemandDispatch.findUniqueOrThrow({ where: { id: rejectDemand.dispatch.id } })).attempt_count === 1, "attempt incremented once");
  await rejects(
    () => prisma.match.update({
      where: { id: rejectManifest.active_offer_id! },
      data: {
        status: "sent_to_driver",
        active_manifest_key: rejected.id,
        active_driver_route_key: rejected.driver_route_id,
        rejected_at: null,
        reject_reason: null
      }
    }),
    "terminal shared offer cannot be resurrected"
  );
  await rejects(
    () => prisma.canonicalTripManifest.update({
      where: { id: rejected.id },
      data: {
        lifecycle_status: "offered",
        active_offer_id: rejectManifest.active_offer_id,
        active_availability_key: rejected.driver_route_id,
        rejected_at: null
      }
    }),
    "terminal manifest cannot be resurrected"
  );

  const expiryAvailability = await availability(fixture, 2, { seats: 4, parcels: 5 });
  await merchantDemand(fixture, 2, 3);
  const expiryRun = await service.run({ now, requestId: "expiry-run" });
  check(expiryRun.offered === 1, "expiry scenario offered");
  const expiryManifest = await prisma.canonicalTripManifest.findUniqueOrThrow({
    where: { id: expiryRun.manifestIds[0] },
    include: { active_offer: true }
  });
  const expiryAt = new Date(expiryManifest.active_offer!.expires_at!.getTime() + 1);
  const genericExpiry = await capacityReservations.expireBatch({ now: expiryAt });
  check(genericExpiry.expired === 0, "generic expiry cannot expire shared reservations");
  check(
    (await prisma.capacityReservation.findUniqueOrThrow({
      where: { id: expiryManifest.reservation_id! }
    })).status === "held",
    "shared reservation remains held for shared expiry owner"
  );
  check(
    (await prisma.canonicalTripManifest.findUniqueOrThrow({
      where: { id: expiryManifest.id }
    })).lifecycle_status === "offered",
    "generic expiry leaves shared manifest offered"
  );
  const expiryResults = await Promise.all([
    service.expire({ now: expiryAt, requestId: "expiry-a" }),
    service.expire({ now: expiryAt, requestId: "expiry-b" })
  ]);
  check(expiryResults.reduce((sum, item) => sum + item.expired, 0) === 1, "two expiry workers expire once");
  const expired = await prisma.canonicalTripManifest.findUniqueOrThrow({
    where: { id: expiryManifest.id },
    include: { members: { include: { dispatch: true } }, reservation: true }
  });
  check(expired.lifecycle_status === "expired", "whole manifest expired");
  check(expired.reservation?.status === "expired", "expiry reservation terminal");
  check(expired.members.every((member) => member.member_status === "released"), "expiry members released");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: expiryAvailability.id } })).remaining_parcel_capacity === 5, "expiry restores parcels once");
  check(
    await prisma.canonicalDemandAttempt.count({
      where: { manifest_id: expired.id, outcome: "expired" }
    }) === expired.members.length,
    "expiry exclusion persisted for every member"
  );

  const driftAvailability = await availability(fixture, 3, { seats: 4, parcels: 4 });
  const driftDemand = await passengerDemand(fixture, 3, 1);
  const driftRun = await service.run({ now, requestId: "drift-run" });
  check(driftRun.offered === 1, "drift scenario offered");
  const driftManifest = await prisma.canonicalTripManifest.findUniqueOrThrow({
    where: { id: driftRun.manifestIds[0] },
    include: { active_offer: true }
  });
  await prisma.passengerRequest.update({
    where: { id: driftDemand.request.id },
    data: { passenger_count: 2 }
  });
  await rejects(
    () => service.accept(fixture.drivers[3].user.id, driftManifest.active_offer_id!, {
      id: fixture.drivers[3].user.id,
      idempotencyKey: "drift-accept",
      requestId: "drift"
    }),
    "member drift invalidates acceptance"
  );
  const dissolved = await prisma.canonicalTripManifest.findUniqueOrThrow({
    where: { id: driftManifest.id },
    include: { members: { include: { dispatch: true } }, reservation: true }
  });
  check(dissolved.lifecycle_status === "dissolved", "drift dissolves entire manifest");
  check(dissolved.members.every((member) => member.member_status === "invalidated"), "drift members invalidated");
  check(dissolved.members.every((member) => member.dispatch.status === "pending"), "unaffected drift members pending");
  check(dissolved.reservation?.release_reason === "manifest_invalidated", "drift release category");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: driftAvailability.id } })).remaining_seats === 4, "drift restores capacity");
  check(await prisma.trip.count({ where: { manifest_id: dissolved.id } }) === 0, "drift creates no partial Trip");
  check(
    await prisma.canonicalDemandAttempt.count({
      where: { manifest_id: dissolved.id, outcome: "system_invalidated" }
    }) === dissolved.members.length,
    "system outcome categorical for every member"
  );

  const regroupAvailability = await availability(fixture, 4, { seats: 4, parcels: 4 });
  const regroupRun = await service.run({ now, requestId: "regroup-run" });
  check(regroupRun.offered >= 1, "released demand can regroup");
  const regrouped = await prisma.canonicalTripManifest.findFirstOrThrow({
    where: { id: { in: regroupRun.manifestIds }, members: { some: { dispatch_id: rejectDemand.dispatch.id } } },
    include: { members: true }
  });
  check(regrouped.id !== rejected.id, "new historical manifest used");
  check(regrouped.driver_route_id === regroupAvailability.id, "previous candidate excluded");
  check(await prisma.canonicalTripManifest.count({ where: { id: rejected.id } }) === 1, "old manifest retained");

  await availability(fixture, 0, {
    seats: 4,
    parcels: 4,
    departureAt: new Date(departure.getTime() + 15 * 60_000)
  });
  await passengerDemand(fixture, 4, 1);
  const pausedRouteRun = await service.run({ now, requestId: "paused-route-run" });
  check(pausedRouteRun.offered === 1, "route pause scenario offered");
  const pausedRouteManifest = await prisma.canonicalTripManifest.findUniqueOrThrow({
    where: { id: pausedRouteRun.manifestIds[0] },
    include: { active_offer: true, driver_route: { include: { driver: true } } }
  });
  check(Boolean(pausedRouteManifest.driver_route_id), "route pause scenario owns an availability");
  await prisma.serviceRouteVersion.update({
    where: { id: fixture.version.id },
    data: { status: "paused" }
  });
  await rejects(
    () => service.accept(pausedRouteManifest.driver_route.driver.user_id, pausedRouteManifest.active_offer_id!, {
      id: pausedRouteManifest.driver_route.driver.user_id,
      idempotencyKey: "paused-route-accept",
      requestId: "paused-route-accept"
    }),
    "paused route invalidates acceptance"
  );
  const pausedRouteResult = await prisma.canonicalTripManifest.findUniqueOrThrow({
    where: { id: pausedRouteManifest.id },
    include: { reservation: true }
  });
  check(pausedRouteResult.lifecycle_status === "dissolved", "paused route dissolves manifest");
  check(pausedRouteResult.reservation?.status === "released", "paused route releases hold");
  check(
    await prisma.trip.count({ where: { manifest_id: pausedRouteManifest.id } }) === 0,
    "paused route creates no Trip"
  );
  await prisma.serviceRouteVersion.update({
    where: { id: fixture.version.id },
    data: { status: "published" }
  });
  await prisma.canonicalDemandDispatch.updateMany({
    where: { status: "pending" },
    data: { status: "unavailable", revision: { increment: 1 } }
  });

  const singleFirstFrom = new Date("2031-02-10T10:00:00.000Z");
  const singleFirstUntil = new Date("2031-02-10T10:40:00.000Z");
  const singleFirstCandidate = await availability(fixture, 0, {
    departureAt: new Date("2031-02-10T10:20:00.000Z")
  });
  const sharedFallbackCandidate = await availability(fixture, 7, {
    departureAt: new Date("2031-02-10T10:20:00.000Z")
  });
  const singleFirstDemand = await passengerDemand(
    fixture,
    5,
    1,
    singleFirstFrom,
    singleFirstUntil
  );
  const singleFirstRun = await singleMatching.run({
    routeVersionId: fixture.version.id,
    demandType: "passenger",
    now,
    requestId: "cross-mode-single-first"
  });
  check(singleFirstRun.offered === 1, "single mode creates cross-mode history fixture");
  const singleFirstOffer = await prisma.match.findUniqueOrThrow({
    where: { id: singleFirstRun.offerIds[0] }
  });
  check(singleFirstOffer.driver_route_id === singleFirstCandidate.id, "single mode selects first candidate");
  await singleMatching.reject(
    fixture.drivers[0].user.id,
    singleFirstOffer.id,
    "driver_declined",
    {
      id: fixture.drivers[0].user.id,
      idempotencyKey: "cross-mode-single-reject",
      requestId: "cross-mode-single-reject"
    }
  );
  const sharedAfterSingle = await service.run({
    routeVersionId: fixture.version.id,
    now,
    requestId: "cross-mode-shared-after-single",
    throwOnFailure: true
  });
  check(sharedAfterSingle.offered === 1, "shared mode regroups single-rejected demand");
  const sharedAfterSingleManifest = await prisma.canonicalTripManifest.findUniqueOrThrow({
    where: { id: sharedAfterSingle.manifestIds[0] },
    include: { active_offer: true }
  });
  check(
    sharedAfterSingleManifest.driver_route_id === sharedFallbackCandidate.id,
    "shared mode excludes the terminal single-mode candidate"
  );
  await service.reject(
    fixture.drivers[7].user.id,
    sharedAfterSingleManifest.active_offer_id!,
    "driver_declined",
    {
      id: fixture.drivers[7].user.id,
      idempotencyKey: "cross-mode-shared-cleanup",
      requestId: "cross-mode-shared-cleanup"
    }
  );
  await prisma.canonicalDemandDispatch.update({
    where: { id: singleFirstDemand.dispatch.id },
    data: { status: "unavailable", revision: { increment: 1 } }
  });

  const sharedFirstFrom = new Date("2031-02-10T10:41:00.000Z");
  const sharedFirstUntil = new Date("2031-02-10T11:00:00.000Z");
  const sharedFirstCandidate = await availability(fixture, 1, {
    departureAt: new Date("2031-02-10T10:50:00.000Z")
  });
  const singleFallbackCandidate = await availability(fixture, 6, {
    departureAt: new Date("2031-02-10T10:50:00.000Z")
  });
  const sharedFirstDemand = await passengerDemand(
    fixture,
    6,
    1,
    sharedFirstFrom,
    sharedFirstUntil
  );
  const sharedFirstRun = await service.run({
    routeVersionId: fixture.version.id,
    now,
    requestId: "cross-mode-shared-first",
    throwOnFailure: true
  });
  check(sharedFirstRun.offered === 1, "shared mode creates cross-mode history fixture");
  const sharedFirstManifest = await prisma.canonicalTripManifest.findUniqueOrThrow({
    where: { id: sharedFirstRun.manifestIds[0] },
    include: { active_offer: true }
  });
  check(sharedFirstManifest.driver_route_id === sharedFirstCandidate.id, "shared mode selects first candidate");
  await service.reject(
    fixture.drivers[1].user.id,
    sharedFirstManifest.active_offer_id!,
    "driver_declined",
    {
      id: fixture.drivers[1].user.id,
      idempotencyKey: "cross-mode-shared-reject",
      requestId: "cross-mode-shared-reject"
    }
  );
  const singleAfterShared = await singleMatching.run({
    routeVersionId: fixture.version.id,
    demandType: "passenger",
    now,
    requestId: "cross-mode-single-after-shared"
  });
  check(singleAfterShared.offered === 1, "single mode regroups shared-rejected demand");
  const singleAfterSharedOffer = await prisma.match.findUniqueOrThrow({
    where: { id: singleAfterShared.offerIds[0] }
  });
  check(
    singleAfterSharedOffer.driver_route_id === singleFallbackCandidate.id,
    "single mode excludes the terminal shared-mode candidate"
  );
  await singleMatching.reject(
    fixture.drivers[6].user.id,
    singleAfterSharedOffer.id,
    "driver_declined",
    {
      id: fixture.drivers[6].user.id,
      idempotencyKey: "cross-mode-single-cleanup",
      requestId: "cross-mode-single-cleanup"
    }
  );
  await prisma.canonicalDemandDispatch.update({
    where: { id: sharedFirstDemand.dispatch.id },
    data: { status: "unavailable", revision: { increment: 1 } }
  });

  const legacyUser = await prisma.user.create({
    data: {
      id: "m7c3c1_legacy_passenger",
      name: "Legacy",
      phone: "+970598829999",
      password_hash: "integration-only",
      role: "passenger",
      demo_account: true
    }
  });
  await prisma.passengerRequest.create({
    data: {
      id: "m7c3c1_legacy_request",
      passenger_id: legacyUser.id,
      pickup_label: "legacy",
      pickup_lat: 31.5,
      pickup_lng: 35,
      destination_label: "legacy",
      destination_lat: 31.7,
      destination_lng: 35.2,
      preferred_time: from,
      passenger_count: 1,
      status: "pending"
    }
  });
  const manifestsBeforeLegacyRun = await prisma.canonicalTripManifest.count();
  await service.run({ now, requestId: "legacy-isolation" });
  check(await prisma.canonicalTripManifest.count() === manifestsBeforeLegacyRun, "legacy demand not consumed");
  check((await prisma.passengerRequest.findUniqueOrThrow({ where: { id: "m7c3c1_legacy_request" } })).status === "pending", "legacy state unchanged");
  check(await prisma.locationEvent.count() === 0, "shared matching creates no tracking");
  check(await prisma.parcelBatch.count() === 0, "shared matching creates no legacy batch");
  check(await prisma.comparisonRun.count() === 0, "shared matching creates no comparison");
  await rejects(
    () => prisma.canonicalTripManifest.delete({ where: { id: acceptedManifest.id } }),
    "restrictive foreign keys preserve accepted manifest history"
  );

  const ownershipConstraints = await prisma.$queryRaw<Array<{ constraint_name: string }>>`
    SELECT CONSTRAINT_NAME AS constraint_name
    FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND CONSTRAINT_NAME IN (
        'matches_manifest_reservation_fkey',
        'capacity_reservations_match_manifest_fkey',
        'canonical_manifest_reservation_ownership_fkey'
      )
  `;
  check(ownershipConstraints.length === 3, "all aggregate ownership foreign keys installed");
  const manifestOfferIndexes = await prisma.$queryRaw<Array<{ index_name: string }>>`
    SELECT DISTINCT INDEX_NAME AS index_name
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'matches'
      AND INDEX_NAME = 'matches_manifest_id_key'
      AND NON_UNIQUE = 0
  `;
  check(manifestOfferIndexes.length === 1, "one-offer-per-manifest unique index installed");

  await resetDemoData(prisma);
  await resetDemoData(prisma);
  check(await prisma.canonicalDemandAttempt.count() === 0, "repeated demo reset clears shared attempts");
  check(await prisma.canonicalTripManifestMember.count() === 0, "repeated demo reset clears shared members");
  check(await prisma.canonicalTripManifest.count() === 0, "repeated demo reset clears shared manifests");
  check(await prisma.match.count({ where: { canonical_match_version: SHARED_MATCH_VERSION } }) === 0, "repeated demo reset clears shared offers");
  check(await prisma.trip.count({ where: { canonical_trip_version: SHARED_TRIP_VERSION } }) === 0, "repeated demo reset clears shared Trips");
  check(await prisma.driverRoute.count({ where: { operational_mode: "legacy", canonical_availability_version: null } }) === 2, "shared cleanup preserves two legacy route fixtures");
  check(await prisma.driverRoute.count({ where: { operational_mode: mode, canonical_availability_version: mode } }) === 2, "shared cleanup recreates two canonical availabilities behind full gates");
  check(await prisma.passengerRequest.count({ where: { operational_mode: mode } }) === 0, "shared cleanup leaves no canonical passenger requests");
  check(await prisma.merchantOrder.count({ where: { operational_mode: mode } }) === 0, "shared cleanup leaves no canonical merchant orders");

  check(assertions === 144, `exactly 145 persistent assertions including this count check; got ${assertions + 1}`);
  console.log(`M7C3C1 shared-trip integration passed with ${assertions} assertions.`);
} finally {
  await prisma.$disconnect();
}
