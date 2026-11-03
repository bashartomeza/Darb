import type { Prisma } from "../generated/prisma/client.js";
import { TripStatus } from "../generated/prisma/enums.js";

/**
 * What a passenger or merchant may see of a driver: who drives and which car to
 * look for. The rest of the DriverProfile (national ID and licence numbers, the
 * trust-score breakdown, capacity totals) and the driver's email stay with the
 * driver and Admin. The driver's phone reaches a rider only on an agreed trip
 * that is still running (see `riderDriverPhone`), never in offers or search.
 */
export const publicDriverSelect = {
  vehicle_type: true,
  vehicle_make_model: true,
  vehicle_color: true,
  plate_number: true,
  verified: true,
  trust_score: true,
  user: { select: { name: true } }
} satisfies Prisma.DriverProfileSelect;

/** The driver's user columns a trip detail reads: the name, and the numbers a rider may call. */
export const assignedDriverUserSelect = { name: true, phone: true, contact_phone: true } satisfies Prisma.UserSelect;

export type PublicDriverSource = {
  vehicle_type: string;
  vehicle_make_model?: string | null;
  vehicle_color?: string | null;
  plate_number?: string | null;
  verified: boolean;
  trust_score: number;
  user?: { name: string; phone?: string | null; contact_phone?: string | null } | null;
};

/**
 * Trip statuses in which a rider may call the driver: from the driver's
 * acceptance until the passenger or parcel is dropped off. Not before (an offer
 * is not yet a ride), and not once the trip is delivered, completed, cancelled
 * or failed: later follow-ups go through an incident report to Admin.
 */
export const DRIVER_CONTACT_TRIP_STATUSES: ReadonlySet<string> = new Set<TripStatus>([
  TripStatus.accepted,
  TripStatus.pickup_started,
  TripStatus.picked_up,
  TripStatus.in_transit
]);

/**
 * The number a rider on the trip may call: the driver's verified phone, else the
 * unverified contact number they gave, else null. Always null outside the window.
 */
export function riderDriverPhone(driver: PublicDriverSource, tripStatus: string) {
  if (!DRIVER_CONTACT_TRIP_STATUSES.has(tripStatus)) return null;
  return driver.user?.phone?.trim() || driver.user?.contact_phone?.trim() || null;
}

/** The driver behind a search result or match offer, before any ride is agreed. */
export function publicDriverSummary(driver: PublicDriverSource) {
  return {
    name: driver.user?.name ?? null,
    vehicle_type: driver.vehicle_type,
    verified: driver.verified,
    trust_score: driver.trust_score
  };
}

/**
 * The driver of a trip the caller rides on or sent parcels with: the summary,
 * the car to look for at pickup, and the driver's phone while the trip runs.
 */
export function assignedDriverSummary(driver: PublicDriverSource, tripStatus: string) {
  return {
    ...publicDriverSummary(driver),
    vehicle_make_model: driver.vehicle_make_model ?? null,
    vehicle_color: driver.vehicle_color ?? null,
    plate_number: driver.plate_number ?? null,
    phone: riderDriverPhone(driver, tripStatus)
  };
}

/**
 * The full driver profile as Admin and the driver themself see it on a trip:
 * unchanged, so the nested user keeps only the name, as before.
 */
export function withoutRiderContactFields<T extends { user?: { name: string } | null }>(driver: T): T {
  return driver.user ? { ...driver, user: { name: driver.user.name } } : driver;
}
