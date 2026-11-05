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
 * Whether the request's pickup coordinate is a place the passenger chose. A
 * route request stores its origin city's centre there and the exact pickup as
 * typed text (`pickup_details`), so its coordinate says nothing about where the
 * passenger waits: a driver crossing the city centre is not "approaching" them.
 */
export function hasRealPickupCoordinate(request: { pickup_details?: string | null; pickup_place_id?: string | null }) {
  // A chosen place has its own coordinate; only free text leaves the city centre.
  return Boolean(request.pickup_place_id) || !request.pickup_details?.trim();
}

/**
 * Called whenever a driver location or trip-progress update is recorded. Creates at most one
 * "driver approaching" inbox notification per trip for the passenger. The notification never
 * carries coordinates or distances, only the reason it fired. Best effort: never throws.
 * Returns true only when this call created the notification.
 *
 * - A request with a real pickup coordinate fires when the driver's position is within the
 *   configured radius or ETA of it.
 * - A route request (pickup typed as text) has no point to measure against, so it fires when the
 *   driver marks the pickup as started (`pickup_started`), the driver's own "on my way to you".
 *   Positions are ignored for it, whatever they are.
 */
export async function maybeNotifyDriverApproaching(
  db: Db,
  tripId: string,
  driverPoint: Point | null,
  thresholds: ApproachingThresholds = configuredApproachingThresholds()
): Promise<boolean> {
  try {
    const trip = await db.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true,
        status: true,
        passenger_request: { select: { passenger_id: true, pickup_lat: true, pickup_lng: true, pickup_details: true, pickup_place_id: true } }
      }
    });
    if (!trip?.passenger_request) return false;
    if (!(APPROACHING_ELIGIBLE_STATUSES as readonly string[]).includes(trip.status)) return false;

    let reason: ApproachingReason | "pickup_started";
    if (hasRealPickupCoordinate(trip.passenger_request)) {
      if (!driverPoint) return false;
      const decision = evaluateApproaching(
        driverPoint,
        { lat: toNumber(trip.passenger_request.pickup_lat), lng: toNumber(trip.passenger_request.pickup_lng) },
        thresholds
      );
      if (!decision) return false;
      reason = decision.reason;
    } else {
      if (trip.status !== "pickup_started") return false;
      reason = "pickup_started";
    }

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
      params: { reason }
    });
    return true;
  } catch {
    return false;
  }
}

/** After a status change: uses the most recent recorded driver position of the trip, if any. */
export async function maybeNotifyDriverApproachingFromLatest(db: Db, tripId: string): Promise<boolean> {
  try {
    const latest = await db.locationEvent.findFirst({ where: { trip_id: tripId }, orderBy: { sequence: "desc" } });
    return await maybeNotifyDriverApproaching(db, tripId, latest ? { lat: toNumber(latest.lat), lng: toNumber(latest.lng) } : null);
  } catch {
    return false;
  }
}
