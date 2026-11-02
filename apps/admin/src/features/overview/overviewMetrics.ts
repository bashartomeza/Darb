import type { Trip } from "../../api";

/**
 * The operational trip window begins when pickup starts and ends when delivery
 * is recorded. `accepted` is assigned but pre-pickup; `delivered` has already
 * propagated delivery/completion to the linked demand and only awaits trip
 * closeout. `created`, `completed`, and `cancelled` are also outside this set.
 */
export const ACTIVE_TRIP_STATUSES = ["pickup_started", "picked_up", "in_transit"] as const;

const ACTIVE_TRIP_STATUS_SET: ReadonlySet<string> = new Set(ACTIVE_TRIP_STATUSES);

export function isActiveTripStatus(status: string) {
  return ACTIVE_TRIP_STATUS_SET.has(status);
}

export function activeTrips(trips: Trip[]) {
  return trips.filter((trip) => isActiveTripStatus(trip.status));
}
