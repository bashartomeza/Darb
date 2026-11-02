import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { config } from "../config.js";
import { haversineKm, toNumber, type Point } from "../lib/geo.js";
import { notify } from "./notifications.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** The driver can only be "approaching the pickup" before the passenger is on board. */
export const APPROACHING_ELIGIBLE_STATUSES = ["created", "accepted", "pickup_started"] as const;

export type ApproachingThresholds = {
  /** Fire when the driver is within this many kilometres of the pickup. */
  radiusKm: number;
  /** Fire when the estimated travel time is at most this many minutes (0 disables the ETA trigger). */
  etaMinutes: number;
  /** Assumed average speed used to turn distance into an ETA. */
  assumedSpeedKmh: number;
};

export function configuredApproachingThresholds(): ApproachingThresholds {
  return config.approachingAlert;
}

export type ApproachingReason = "radius" | "eta";

/** Pure decision: which trigger (if any) the driver position satisfies. Boundaries are inclusive. */
export function evaluateApproaching(
  driver: Point,
  pickup: Point,
  thresholds: ApproachingThresholds
): { distanceKm: number; reason: ApproachingReason } | null {
  if (![driver.lat, driver.lng, pickup.lat, pickup.lng].every(Number.isFinite)) return null;
  const distanceKm = haversineKm(driver, pickup);
  if (distanceKm <= thresholds.radiusKm) return { distanceKm, reason: "radius" };
  if (thresholds.etaMinutes > 0 && thresholds.assumedSpeedKmh > 0) {
    const etaMinutes = (distanceKm / thresholds.assumedSpeedKmh) * 60;
    if (etaMinutes <= thresholds.etaMinutes) return { distanceKm, reason: "eta" };
  }
  return null;
}

/**
 * Called whenever a driver location or trip-progress update is recorded. Creates at most one
 * "driver approaching" inbox notification per trip for the passenger. The notification never
 * carries coordinates or distances, only the reason it fired. Best effort: never throws.
 * Returns true only when this call created the notification.
 */
export async function maybeNotifyDriverApproaching(
  db: Db,
  tripId: string,
  driverPoint: Point,
  thresholds: ApproachingThresholds = configuredApproachingThresholds()
): Promise<boolean> {
  try {
    const trip = await db.trip.findUnique({
      where: { id: tripId },
      select: { id: true, status: true, passenger_request: { select: { passenger_id: true, pickup_lat: true, pickup_lng: true } } }
    });
    if (!trip?.passenger_request) return false;
    if (!(APPROACHING_ELIGIBLE_STATUSES as readonly string[]).includes(trip.status)) return false;

    const decision = evaluateApproaching(
      driverPoint,
      { lat: toNumber(trip.passenger_request.pickup_lat), lng: toNumber(trip.passenger_request.pickup_lng) },
      thresholds
    );
    if (!decision) return false;

    const dedupeKey = `driver_approaching:${trip.id}`;
    const userId = trip.passenger_request.passenger_id;
    const already = await db.notification.findFirst({ where: { user_id: userId, dedupe_key: dedupeKey }, select: { id: true } });
    if (already) return false;

    await notify(db, {
      userId,
      type: "driver_approaching",
      entityType: "Trip",
      entityId: trip.id,
      dedupeKey,
      params: { reason: decision.reason }
    });
    return true;
  } catch {
    return false;
  }
}

/** Uses the most recent recorded driver position of the trip, if any. */
export async function maybeNotifyDriverApproachingFromLatest(db: Db, tripId: string): Promise<boolean> {
  try {
    const latest = await db.locationEvent.findFirst({ where: { trip_id: tripId }, orderBy: { sequence: "desc" } });
    if (!latest) return false;
    return await maybeNotifyDriverApproaching(db, tripId, { lat: toNumber(latest.lat), lng: toNumber(latest.lng) });
  } catch {
    return false;
  }
}
