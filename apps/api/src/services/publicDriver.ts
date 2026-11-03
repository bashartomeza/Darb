import type { Prisma } from "../generated/prisma/client.js";

/**
 * What a passenger or merchant may see of a driver: who drives and which car to
 * look for. The rest of the DriverProfile (national ID and licence numbers, the
 * trust-score breakdown, capacity totals) and the driver's phone and email stay
 * with the driver and Admin.
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

export type PublicDriverSource = {
  vehicle_type: string;
  vehicle_make_model?: string | null;
  vehicle_color?: string | null;
  plate_number?: string | null;
  verified: boolean;
  trust_score: number;
  user?: { name: string } | null;
};

/** The driver behind a search result or match offer, before any ride is agreed. */
export function publicDriverSummary(driver: PublicDriverSource) {
  return {
    name: driver.user?.name ?? null,
    vehicle_type: driver.vehicle_type,
    verified: driver.verified,
    trust_score: driver.trust_score
  };
}

/** The driver of a trip the caller is on: the summary plus the car to look for at pickup. */
export function assignedDriverSummary(driver: PublicDriverSource) {
  return {
    ...publicDriverSummary(driver),
    vehicle_make_model: driver.vehicle_make_model ?? null,
    vehicle_color: driver.vehicle_color ?? null,
    plate_number: driver.plate_number ?? null
  };
}
