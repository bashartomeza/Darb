import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { HttpError } from "../middleware/error.js";
import { toNumber, type Point } from "../lib/geo.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** `location_events.source` of a position the assigned driver's phone reported. */
export const DRIVER_GPS_SOURCE = "driver_gps";

/** The driver shares a position from acceptance until drop-off. */
export const LIVE_TRACKING_STATUSES = ["accepted", "pickup_started", "picked_up", "in_transit"] as const;

/** Riders stop seeing the driver once the trip is over, like the driver's phone. */
export const TERMINAL_TRIP_STATUSES = ["delivered", "completed", "cancelled", "failed"] as const;

/** At most one stored point per trip in this window; extra posts are answered but not kept. */
export const MIN_STORE_INTERVAL_MS = 10_000;
/** A point older than this is shown as stale ("last seen"), not as the driver's live position. */
export const STALE_AFTER_SECONDS = 120;
/** A fix older than this when it arrives is useless for live tracking and is refused. */
export const MAX_FIX_AGE_MS = 120_000;
/** Tolerated phone clock drift ahead of the server. */
export const MAX_CLOCK_SKEW_MS = 60_000;
/** Coarser fixes would put the driver on the wrong street or village. */
export const MAX_ACCURACY_METERS = 150;

/**
 * Where a driver's reported position may lie. SERVICE_AREA in operatingRoutes.ts
 * (latitude 29.4-33.4, longitude 34.2-35.95) is a loose check for admin-made
 * cities and covers Gaza, most of Israel and parts of Jordan and Egypt. Every
 * operating route runs inside the West Bank, so tracking uses its own tighter
 * box: Gaza and the coastal plain (longitude below 34.88) fall outside it, as
 * does everything north of Jenin and south of Hebron's villages. A box cannot
 * follow the Green Line, so some Israeli towns next to it still pass; the check
 * only refuses coordinates that cannot belong to a Darb trip (spoofed or a
 * broken GPS fix), not every point off the routes.
 */
export const WEST_BANK_TRACKING_AREA = {
  minLatitude: 31.33,
  maxLatitude: 32.56,
  minLongitude: 34.88,
  maxLongitude: 35.6
} as const;

export function isInsideTrackingArea(point: Point) {
  return (
    point.lat >= WEST_BANK_TRACKING_AREA.minLatitude &&
    point.lat <= WEST_BANK_TRACKING_AREA.maxLatitude &&
    point.lng >= WEST_BANK_TRACKING_AREA.minLongitude &&
    point.lng <= WEST_BANK_TRACKING_AREA.maxLongitude
  );
}

export type DriverFix = { point: Point; accuracyMeters: number; fixTime: Date };

/** Refuses fixes that cannot be shown as the driver's live position. Throws 422. */
export function validateDriverFix(fix: DriverFix, now: Date) {
  if (!isInsideTrackingArea(fix.point)) throw new HttpError(422, "location_outside_service_area");
  if (fix.accuracyMeters > MAX_ACCURACY_METERS) throw new HttpError(422, "location_accuracy_too_low");
  const age = now.getTime() - fix.fixTime.getTime();
  if (age > MAX_FIX_AGE_MS || age < -MAX_CLOCK_SKEW_MS) throw new HttpError(422, "location_timestamp_out_of_range");
}

export type RecordResult =
  | { stored: true; location: { id: string; sequence: number; recorded_at: Date } }
  | { stored: false; reason: "rate_limited"; retryAfterSeconds: number };

/**
 * Stores the assigned driver's fix for an active trip, at most one per
 * MIN_STORE_INTERVAL_MS. The trip row is locked so two posts in flight cannot
 * both pass the interval check or take the same sequence, and the status is
 * re-read under that lock. The fix time is clamped to the server clock so a
 * phone running ahead never makes a point look fresher than it is.
 */
export async function recordDriverFix(
  db: PrismaClient,
  input: { tripId: string; driverId: string; fix: DriverFix; now: Date }
): Promise<RecordResult> {
  const recordedAt = new Date(Math.min(input.fix.fixTime.getTime(), input.now.getTime()));
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM trips WHERE id = ${input.tripId} FOR UPDATE
    `;
    if (!locked[0]) throw new HttpError(404, "trip_not_found");
    if (!(LIVE_TRACKING_STATUSES as readonly string[]).includes(locked[0].status)) {
      throw new HttpError(409, "trip_not_tracking");
    }
    const lastGps = await tx.locationEvent.findFirst({
      where: { trip_id: input.tripId, source: DRIVER_GPS_SOURCE },
      orderBy: { recorded_at: "desc" },
      select: { recorded_at: true }
    });
    if (lastGps) {
      const sinceLast = recordedAt.getTime() - lastGps.recorded_at.getTime();
      if (sinceLast < MIN_STORE_INTERVAL_MS) {
        return {
          stored: false as const,
          reason: "rate_limited" as const,
          retryAfterSeconds: Math.max(1, Math.ceil((MIN_STORE_INTERVAL_MS - Math.max(0, sinceLast)) / 1000))
        };
      }
    }
    const latest = await tx.locationEvent.findFirst({
      where: { trip_id: input.tripId },
      orderBy: { sequence: "desc" },
      select: { sequence: true }
    });
    const location = await tx.locationEvent.create({
      data: {
        trip_id: input.tripId,
        driver_id: input.driverId,
        lat: input.fix.point.lat.toFixed(6),
        lng: input.fix.point.lng.toFixed(6),
        source: DRIVER_GPS_SOURCE,
        sequence: latest ? latest.sequence + 1 : 0,
        recorded_at: recordedAt
      },
      select: { id: true, sequence: true, recorded_at: true }
    });
    return { stored: true as const, location };
  });
}

type StoredLocation = {
  id: string;
  trip_id: string;
  lat: unknown;
  lng: unknown;
  source: string;
  sequence: number;
  recorded_at: Date;
};

/**
 * The latest point as riders and the driver read it: no driver id, plus how old
 * it is by the server clock and whether it is too old to call live.
 */
export function serializeTripLocation(location: StoredLocation, now: Date) {
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - location.recorded_at.getTime()) / 1000));
  return {
    id: location.id,
    trip_id: location.trip_id,
    lat: toNumber(location.lat).toFixed(6),
    lng: toNumber(location.lng).toFixed(6),
    source: location.source,
    sequence: location.sequence,
    recorded_at: location.recorded_at.toISOString(),
    age_seconds: ageSeconds,
    stale: ageSeconds > STALE_AFTER_SECONDS
  };
}

export async function latestTripLocation(db: Db, tripId: string, options: { includeSimulated: boolean }) {
  return db.locationEvent.findFirst({
    where: { trip_id: tripId, ...(options.includeSimulated ? {} : { source: DRIVER_GPS_SOURCE }) },
    orderBy: [{ sequence: "desc" }, { recorded_at: "desc" }, { id: "desc" }]
  });
}
