import { Router } from "express";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Prisma, PrismaClient, UserRole } from "../generated/prisma/client.js";
import { config, type AppConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { auditEvent } from "../lib/audit.js";
import { authenticateAuthToken } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { DEMO_ROUTE_POINTS } from "../lib/geo.js";
import {
  assertDemoResetDatabaseSafe,
  DemoResetDatabaseNotAllowedError
} from "../lib/demoResetSafety.js";

export const LOCKED_CORRIDOR_KEY = "hebron-ppu-bab-al-zawiya-to-bethlehem";
export const LOCKED_CORRIDOR_LABEL = "Hebron / PPU / Bab Al-Zawiya -> Bethlehem";
export const DEMO_SERVICE_ROUTE_KEY = LOCKED_CORRIDOR_KEY;
export const DEMO_STOP_KEYS = {
  origin: "demo-bab-al-zawiya",
  passengerPickup: "demo-ppu-main-gate",
  destination: "demo-bethlehem-center"
} as const;

export const DEMO_ACCOUNTS = {
  passenger: { name: "Demo Passenger", phone: "+970590000001", email: "demo.passenger@masari.app" },
  driver1: { name: "Demo Driver Hebron Route", phone: "+970590000002", email: "demo.driver@masari.app" },
  driver2: { name: "Demo Driver Alternate", phone: "+970590000003", email: "demo.driver2@masari.app" },
  merchant: { name: "Demo Merchant", phone: "+970590000004", email: "demo.merchant@masari.app" },
  admin: { name: "Demo Admin", phone: "+970590000005", email: "demo.admin@masari.app" }
} as const;

export const CANONICAL_MODE = "canonical_route_v1";

export function canonicalDemoSeedEnabled(appConfig: {
  multiRouteEntryEnabled: boolean;
  multiRouteMatchingEnabled: boolean;
  canonicalTripCreationEnabled: boolean;
}) {
  return (
    appConfig.multiRouteEntryEnabled &&
    appConfig.multiRouteMatchingEnabled &&
    appConfig.canonicalTripCreationEnabled
  );
}

/**
 * Anchors every seeded timestamp to the moment of the reset.
 *
 * The seed used to hardcode calendar dates, which silently rotted: the
 * canonical matcher only considers availabilities with `departure_at > now`,
 * so a fixed date meant the demo stopped matching the day it passed. Anchoring
 * to the next whole hour keeps the data deterministic in shape (always :00,
 * always the same offsets) while always being in the future.
 */
export function demoSchedule(now: Date = new Date()) {
  const base = new Date(now);
  base.setUTCMinutes(0, 0, 0);
  base.setUTCHours(base.getUTCHours() + 1);
  const at = (hoursFromBase: number) => new Date(base.getTime() + hoursFromBase * 3_600_000);
  return {
    /**
     * The legacy corridor route. Kept distinct from [primaryDeparture] because
     * `driver_routes_one_off_departure_key` is unique on
     * (driver_id, route_version_id, departure_at) and driver 1 owns both rows.
     */
    legacyDeparture: at(2),
    legacyWindowEnd: at(2.5),
    /** The canonical availability the driver activates during the demo. */
    primaryDeparture: at(4),
    primaryWindowEnd: at(4.5),
    /** Deliberately outside the passenger's demo window so ranking stays deterministic. */
    alternateDeparture: at(20),
    alternateWindowEnd: at(20.5),
    /** The window the demo passenger asks for; brackets the primary departure only. */
    passengerFrom: at(3.5),
    passengerUntil: at(5),
    routePublishedAt: new Date(base.getTime() - 30 * 86_400_000)
  };
}

async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

async function createDemoUser(
  tx: Prisma.TransactionClient,
  input: { name: string; phone: string; email: string; password: string; role: UserRole }
) {
  return tx.user.create({
    data: {
      name: input.name,
      phone: input.phone,
      phone_verified_at: new Date(),
      email: input.email,
      email_verified_at: new Date(),
      password_hash: await hashPassword(input.password),
      profile_state: "complete",
      role: input.role,
      account_status: "active",
      security_version: 1,
      demo_account: true
    }
  });
}

export async function resetDemoData(db: PrismaClient = prisma, appConfig: AppConfig = config) {
  const demoConfig = appConfig.demo;
  if (!appConfig.demoFeaturesEnabled || !demoConfig) {
    throw new HttpError(404, "not_found");
  }
  try {
    assertDemoResetDatabaseSafe(appConfig);
  } catch (error) {
    if (error instanceof DemoResetDatabaseNotAllowedError) {
      throw new HttpError(403, error.code);
    }
    throw error;
  }
  const schedule = demoSchedule();
  const seedCanonicalDispatch = canonicalDemoSeedEnabled(appConfig);
  return db.$transaction(async (tx) => {
    const nonDemoUser = await tx.user.findFirst({
      where: { demo_account: false },
      select: { id: true }
    });
    if (nonDemoUser) throw new HttpError(403, "demo_reset_real_data_present");
    const onboardedUsers = await tx.onboardingAttempt.findMany({
      where: { completed_user_id: { not: null } },
      select: { completed_user_id: true }
    });
    const onboardedUserIds = onboardedUsers.flatMap((attempt) =>
      attempt.completed_user_id ? [attempt.completed_user_id] : []
    );
    await tx.auditEvent.deleteMany();
    await tx.userConsent.deleteMany();
    await tx.onboardingSession.deleteMany();
    await tx.invitationRedemption.deleteMany();
    await tx.onboardingAttempt.updateMany({ data: { current_challenge_id: null } });
    await tx.otpChallenge.deleteMany();
    await tx.onboardingAttempt.deleteMany();
    await tx.invitation.deleteMany();
    await tx.consentDocument.deleteMany();
    await tx.consentRelease.deleteMany();
    await tx.abuseCounter.deleteMany();
    await tx.idempotencyRecord.deleteMany();
    await tx.refreshToken.deleteMany();
    await tx.authSession.deleteMany();
    await tx.locationEvent.deleteMany();
    const resetAt = new Date();
    await tx.canonicalDemandAttempt.deleteMany();
    await tx.canonicalDemandDispatch.updateMany({
      data: {
        status: "pending",
        active_match_offer_id: null,
        assigned_trip_id: null,
        active_manifest_id: null,
        accepted_manifest_id: null
      }
    });
    await tx.canonicalTripManifest.updateMany({
      data: {
        lifecycle_status: "dissolved",
        active_offer_id: null,
        accepted_offer_id: null,
        assigned_trip_id: null,
        reservation_id: null,
        active_availability_key: null,
        offered_revision: 2,
        accepted_at: null,
        rejected_at: null,
        expired_at: null,
        dissolved_at: resetAt,
        revision: { increment: 1 }
      }
    });
    await tx.trip.deleteMany();
    await tx.capacityReservation.updateMany({
      where: { manifest_id: { not: null } },
      data: {
        status: "released",
        released_at: resetAt,
        release_reason: "test_cleanup",
        match_id: null,
        revision: { increment: 1 }
      }
    });
    await tx.capacityReservation.updateMany({
      where: { manifest_id: null },
      data: { match_id: null }
    });
    await tx.match.deleteMany();
    await tx.capacityReservation.deleteMany();
    await tx.canonicalTripManifestMember.deleteMany();
    await tx.canonicalTripManifest.deleteMany();
    await tx.canonicalDemandDispatch.deleteMany();
    await tx.comparisonRun.deleteMany();
    await tx.parcelBatch.deleteMany();
    await tx.parcel.deleteMany();
    await tx.merchantOrder.deleteMany();
    await tx.passengerRequest.deleteMany();
    await tx.driverRoute.deleteMany();
    await tx.driverProfile.deleteMany();
    await tx.demoScenario.deleteMany();
    // Tariff history restricts both its route and its admin author, so it goes first.
    await tx.routeFare.deleteMany();
    await tx.serviceRoute.updateMany({ data: { current_version_id: null } });
    await tx.routeVersionStop.deleteMany();
    await tx.serviceRouteVersion.deleteMany();
    await tx.serviceRoute.deleteMany();
    await tx.stop.deleteMany();
    await tx.user.deleteMany({
      where: {
        OR: [
          { demo_account: true },
          ...(onboardedUserIds.length > 0 ? [{ id: { in: onboardedUserIds } }] : [])
        ]
      }
    });

    const passenger = await createDemoUser(tx, {
      ...DEMO_ACCOUNTS.passenger,
      password: demoConfig.passengerPassword,
      role: "passenger"
    });
    const driver1User = await createDemoUser(tx, {
      ...DEMO_ACCOUNTS.driver1,
      password: demoConfig.driverPassword,
      role: "driver"
    });
    const driver2User = await createDemoUser(tx, {
      ...DEMO_ACCOUNTS.driver2,
      password: demoConfig.driverPassword,
      role: "driver"
    });
    const merchant = await createDemoUser(tx, {
      ...DEMO_ACCOUNTS.merchant,
      password: demoConfig.merchantPassword,
      role: "merchant"
    });
    const admin = await createDemoUser(tx, {
      ...DEMO_ACCOUNTS.admin,
      password: demoConfig.adminPassword,
      role: "admin"
    });

    const driver1 = await tx.driverProfile.create({
      data: {
        user_id: driver1User.id,
        vehicle_type: "sedan",
        seats_total: 3,
        parcel_capacity: 5,
        verified: true,
        trust_score: 86
      }
    });

    const driver2 = await tx.driverProfile.create({
      data: {
        user_id: driver2User.id,
        vehicle_type: "van",
        seats_total: 2,
        parcel_capacity: 8,
        verified: true,
        trust_score: 74
      }
    });

    await tx.driverVerification.createMany({
      data: [
        {
          user_id: driver1User.id,
          status: "approved",
          reviewed_at: resetAt,
          reviewed_by_id: admin.id
        },
        {
          user_id: driver2User.id,
          status: "approved",
          reviewed_at: resetAt,
          reviewed_by_id: admin.id
        }
      ]
    });

    const [originStop, passengerPickupStop, destinationStop] = await Promise.all([
      tx.stop.create({
        data: {
          stop_key: DEMO_STOP_KEYS.origin,
          service_region_key: "south-west-bank",
          name_ar: "باب الزاوية",
          name_en: "Bab Al-Zawiya",
          latitude: "31.532600",
          longitude: "35.099800",
          created_by_user_id: admin.id
        }
      }),
      tx.stop.create({
        data: {
          stop_key: DEMO_STOP_KEYS.passengerPickup,
          service_region_key: "south-west-bank",
          name_ar: "بوابة جامعة بوليتكنك فلسطين",
          name_en: "PPU Main Gate",
          latitude: "31.550000",
          longitude: "35.100000",
          created_by_user_id: admin.id
        }
      }),
      tx.stop.create({
        data: {
          stop_key: DEMO_STOP_KEYS.destination,
          service_region_key: "south-west-bank",
          name_ar: "وسط بيت لحم",
          name_en: "Bethlehem Center",
          latitude: "31.705400",
          longitude: "35.202400",
          created_by_user_id: admin.id
        }
      })
    ]);

    const serviceRoute = await tx.serviceRoute.create({
      data: {
        route_key: DEMO_SERVICE_ROUTE_KEY,
        route_group_key: "hebron-bethlehem",
        service_region_key: "south-west-bank",
        direction: "outbound",
        created_by_user_id: admin.id
      }
    });
    const encodedGeometry = JSON.stringify(DEMO_ROUTE_POINTS);
    const routeVersion = await tx.serviceRouteVersion.create({
      data: {
        service_route_id: serviceRoute.id,
        version_number: 1,
        status: "published",
        name_ar: "الخليل / جامعة بوليتكنك فلسطين / باب الزاوية ← بيت لحم",
        name_en: LOCKED_CORRIDOR_LABEL,
        description_ar: "مسار العرض التجريبي الثابت لمساري.",
        description_en: "Masari's deterministic demo corridor.",
        origin_stop_id: originStop.id,
        destination_stop_id: destinationStop.id,
        encoded_geometry: encodedGeometry,
        geometry_encoding: "demo-json-v1",
        geometry_provider: "masari-demo",
        geometry_checksum: createHash("sha256").update(encodedGeometry).digest("hex"),
        geometry_precision: 6,
        estimated_distance_meters: 21_530,
        geometry_status: "available",
        created_by_user_id: admin.id,
        published_by_user_id: admin.id,
        published_at: schedule.routePublishedAt
      }
    });
    await tx.routeVersionStop.createMany({
      data: [
        {
          service_route_version_id: routeVersion.id,
          stop_id: originStop.id,
          sequence: 1,
          passenger_pickup: true,
          passenger_dropoff: false,
          parcel_pickup: true,
          parcel_dropoff: false,
          distance_from_origin_meters: 0
        },
        {
          service_route_version_id: routeVersion.id,
          stop_id: passengerPickupStop.id,
          sequence: 2,
          passenger_pickup: true,
          passenger_dropoff: false,
          parcel_pickup: false,
          parcel_dropoff: false
        },
        {
          service_route_version_id: routeVersion.id,
          stop_id: destinationStop.id,
          sequence: 3,
          passenger_pickup: false,
          passenger_dropoff: true,
          parcel_pickup: false,
          parcel_dropoff: true
        }
      ]
    });
    await tx.serviceRoute.update({
      where: { id: serviceRoute.id },
      data: { current_version_id: routeVersion.id }
    });

    await tx.driverRoute.create({
      data: {
        driver_id: driver1.id,
        origin_label: "Hebron / PPU / Bab Al-Zawiya",
        origin_lat: "31.532600",
        origin_lng: "35.099800",
        destination_label: "Bethlehem",
        destination_lat: "31.705400",
        destination_lng: "35.202400",
        corridor_key: LOCKED_CORRIDOR_KEY,
        seats_available: 2,
        parcel_capacity_available: 5,
        route_version_id: routeVersion.id,
        departure_at: schedule.legacyDeparture,
        availability_window_end: schedule.legacyWindowEnd,
        total_seats: 3,
        remaining_seats: 2,
        total_parcel_capacity: 5,
        remaining_parcel_capacity: 5,
        availability_status: "active",
        status: "active",
        activated_at: new Date()
      }
    });

    await tx.driverRoute.create({
      data: {
        driver_id: driver2.id,
        origin_label: "Bethlehem",
        origin_lat: "31.705400",
        origin_lng: "35.202400",
        destination_label: "Hebron / PPU / Bab Al-Zawiya",
        destination_lat: "31.532600",
        destination_lng: "35.099800",
        corridor_key: LOCKED_CORRIDOR_KEY,
        seats_available: 1,
        parcel_capacity_available: 8,
        status: "inactive"
      }
    });

    // Canonical availabilities: the records the canonical matcher actually
    // queries (`operational_mode` + `canonical_availability_version` both set).
    // The legacy driver_routes above are invisible to it by design, so without
    // these the demand pipeline has nothing to rank.
    const canonicalAvailabilityBase = {
      route_version_id: routeVersion.id,
      canonical_availability_version: CANONICAL_MODE,
      operational_mode: CANONICAL_MODE,
      origin_label: originStop.name_en,
      origin_lat: originStop.latitude,
      origin_lng: originStop.longitude,
      destination_label: destinationStop.name_en,
      destination_lat: destinationStop.latitude,
      destination_lng: destinationStop.longitude,
      corridor_key: serviceRoute.route_key
    } as const;

    // Left in `draft` on purpose: the driver activates it from the app during
    // the demo, so step 2 exercises the real activation transition instead of
    // being pre-done by the seed.
    let canonicalAvailabilities = null;
    if (seedCanonicalDispatch) {
      const primaryAvailability = await tx.driverRoute.create({
        data: {
          ...canonicalAvailabilityBase,
          driver_id: driver1.id,
          seats_available: 3,
          parcel_capacity_available: 5,
          total_seats: 3,
          remaining_seats: 3,
          total_parcel_capacity: 5,
          remaining_parcel_capacity: 5,
          departure_at: schedule.primaryDeparture,
          availability_window_end: schedule.primaryWindowEnd,
          availability_status: "draft",
          status: "inactive"
        }
      });

      // Already active, but departing outside the demo passenger's window. It
      // proves the matcher genuinely filters on departure time rather than just
      // picking the only row, and keeps the ranking deterministic.
      const alternateAvailability = await tx.driverRoute.create({
        data: {
          ...canonicalAvailabilityBase,
          driver_id: driver2.id,
          seats_available: 2,
          parcel_capacity_available: 8,
          total_seats: 2,
          remaining_seats: 2,
          total_parcel_capacity: 8,
          remaining_parcel_capacity: 8,
          departure_at: schedule.alternateDeparture,
          availability_window_end: schedule.alternateWindowEnd,
          availability_status: "active",
          status: "active",
          activated_at: new Date()
        }
      });
      canonicalAvailabilities = {
        primary: {
          id: primaryAvailability.id,
          status: primaryAvailability.availability_status,
          revision: primaryAvailability.availability_revision,
          departure_at: primaryAvailability.departure_at
        },
        alternate: {
          id: alternateAvailability.id,
          status: alternateAvailability.availability_status,
          departure_at: alternateAvailability.departure_at
        }
      };
    }

    await tx.passengerRequest.create({
      data: {
        passenger_id: passenger.id,
        pickup_label: "PPU Main Gate",
        pickup_lat: "31.550000",
        pickup_lng: "35.100000",
        destination_label: "Bethlehem Center",
        destination_lat: "31.705400",
        destination_lng: "35.202400",
        preferred_time: schedule.legacyDeparture,
        passenger_count: 1,
        status: "pending",
        source: "seed"
      }
    });

    const order = await tx.merchantOrder.create({
      data: {
        merchant_id: merchant.id,
        pickup_label: "Hebron Merchant Pickup",
        pickup_lat: "31.532600",
        pickup_lng: "35.099800",
        status: "submitted"
      }
    });

    const parcelDestinations = [
      "Bethlehem Market",
      "Bethlehem University Area",
      "Manger Street",
      "Beit Jala Junction",
      "Bethlehem Center"
    ];

    for (const [index, destination] of parcelDestinations.entries()) {
      await tx.parcel.create({
        data: {
          order_id: order.id,
          destination_label: destination,
          destination_lat: "31.705400",
          destination_lng: "35.202400",
          size: index === 0 ? "M" : "S",
          priority: index < 2 ? "high" : "normal",
          status: "pending"
        }
      });
    }

    await tx.demoScenario.createMany({
      data: [
        {
          scenario_key: "masari_batch_wins",
          corridor_key: LOCKED_CORRIDOR_KEY,
          description: "Masari batches five parcels into one compatible corridor trip.",
          seed_version: "m1"
        },
        {
          scenario_key: "nearest_wrong_direction",
          corridor_key: LOCKED_CORRIDOR_KEY,
          description: "Nearest driver is not the best route fit because direction is wrong.",
          seed_version: "m1"
        },
        {
          scenario_key: "driver_utilization_wins",
          corridor_key: LOCKED_CORRIDOR_KEY,
          description: "Masari improves utilization by combining passenger and parcel demand.",
          seed_version: "m1"
        }
      ]
    });

    await tx.auditEvent.create({
      data: {
        user_id: admin.id,
        action: AuditAction.demo_reset,
        entity_type: "DemoScenario",
        metadata: {
          corridor_key: LOCKED_CORRIDOR_KEY,
          corridor_label: LOCKED_CORRIDOR_LABEL,
          seed_version: "m1"
        }
      }
    });

    return {
      corridor: LOCKED_CORRIDOR_LABEL,
      users: {
        passenger: passenger.phone,
        drivers: [driver1User.phone, driver2User.phone],
        merchant: merchant.phone,
        admin: admin.phone
      },
      parcels: parcelDestinations.length,
      scenarios: 3,
      route_version_id: routeVersion.id,
      stops: {
        origin: originStop.id,
        passenger_pickup: passengerPickupStop.id,
        destination: destinationStop.id
      },
      canonical_availabilities: canonicalAvailabilities,
      passenger_window: {
        from: schedule.passengerFrom,
        until: schedule.passengerUntil
      }
    };
  }, { isolationLevel: "Serializable" });
}

async function canReset(req: { header(name: string): string | undefined }, appConfig: AppConfig) {
  const resetKey = req.header("x-demo-reset-key");
  if (appConfig.demo && resetKey === appConfig.demo.resetKey) {
    return true;
  }

  const authHeader = req.header("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
  if (!token) {
    return false;
  }

  try {
    const user = await authenticateAuthToken(token);
    return user.role === "admin";
  } catch {
    return false;
  }
}

export function createDemoRouter(appConfig: AppConfig = config, db: PrismaClient = prisma) {
  const demoRouter = Router();
  demoRouter.post("/demo/reset", async (req, res, next) => {
    try {
      if (!(await canReset(req, appConfig))) {
        throw new HttpError(403, "demo_reset_forbidden");
      }

      const result = await resetDemoData(db, appConfig);
      await auditEvent(db, {
        action: AuditAction.demo_reset,
        entityType: "DemoScenario",
        metadata: { source: "api", corridor: LOCKED_CORRIDOR_LABEL }
      });

      res.json({ ok: true, seed: result });
    } catch (error) {
      next(error);
    }
  });
  return demoRouter;
}
