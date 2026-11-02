import type { PrismaClient } from "../generated/prisma/client.js";
import { TripStatus } from "../generated/prisma/enums.js";
import { computeTrustScore, TRUST_TRIP_WINDOW, type TrustResult, type TrustTripInput } from "./trustScore.js";

type Db = Pick<PrismaClient, "driverProfile" | "trip" | "tripRating">;

const FINISHED = [TripStatus.completed, TripStatus.cancelled, TripStatus.failed] as const;

/**
 * Recomputes one driver's trust score from their trips and the passenger
 * ratings they received, and stores the score and its components. Idempotent.
 * Returns null when the driver profile does not exist.
 */
export async function recomputeDriverTrust(db: Db, driverProfileId: string, now: Date = new Date()): Promise<TrustResult | null> {
  const profile = await db.driverProfile.findUnique({ where: { id: driverProfileId }, select: { id: true, user_id: true } });
  if (!profile) return null;

  const [trips, ratingGroups] = await Promise.all([
    db.trip.findMany({
      where: { driver_route: { driver_id: profile.id }, status: { in: [...FINISHED] } },
      select: {
        status: true,
        cancelled_by_user_id: true,
        started_at: true,
        completed_at: true,
        driver_route: { select: { departure_at: true, availability_window_end: true } }
      },
      orderBy: { created_at: "desc" },
      take: TRUST_TRIP_WINDOW
    }),
    db.tripRating.groupBy({
      by: ["passenger_id"],
      where: { driver_id: profile.id },
      _count: { _all: true },
      _avg: { stars: true }
    })
  ]);

  const tripInputs: TrustTripInput[] = trips.map((trip) => ({
    status: trip.status as TrustTripInput["status"],
    cancelledByDriver: trip.status === TripStatus.cancelled && trip.cancelled_by_user_id === profile.user_id,
    scheduledDepartureAt: trip.driver_route.departure_at,
    startedAt: trip.started_at,
    arrivalDeadlineAt: trip.driver_route.availability_window_end,
    completedAt: trip.completed_at
  }));
  const result = computeTrustScore({
    trips: tripInputs,
    ratings: ratingGroups.map((group) => ({ count: group._count._all, averageStars: group._avg.stars ?? 0 }))
  });

  await db.driverProfile.update({
    where: { id: profile.id },
    data: { trust_score: result.score, trust_components: result.components, trust_computed_at: now }
  });
  return result;
}

/**
 * Best-effort recompute for the driver of a trip, called after a trip finishes
 * or is rated. A scoring problem must never fail the trip or rating request;
 * the nightly recompute repairs any miss.
 */
export async function recomputeTrustForTrip(db: Db, tripId: string, onError?: (error: unknown) => void) {
  try {
    const trip = await db.trip.findUnique({ where: { id: tripId }, select: { driver_route: { select: { driver_id: true } } } });
    if (trip) await recomputeDriverTrust(db, trip.driver_route.driver_id);
  } catch (error) {
    onError?.(error);
  }
}

/** Recomputes every driver profile, in pages. Used by the scheduled job. */
export async function recomputeAllDriverTrust(db: Db, options: { batchSize?: number; now?: Date } = {}) {
  const batchSize = options.batchSize ?? 200;
  let cursor: string | undefined;
  let recomputed = 0;
  let failed = 0;
  for (;;) {
    const page = await db.driverProfile.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    if (page.length === 0) break;
    for (const { id } of page) {
      try {
        if (await recomputeDriverTrust(db, id, options.now)) recomputed += 1;
      } catch {
        failed += 1;
      }
    }
    cursor = page[page.length - 1].id;
    if (page.length < batchSize) break;
  }
  return { recomputed, failed };
}
