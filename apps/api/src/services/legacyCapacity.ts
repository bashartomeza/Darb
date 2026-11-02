import type { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../middleware/error.js";

export type LegacyCapacityInput = {
  driverRouteId: string;
  seats: number;
  parcelUnits: number;
  passengerRequestId?: string;
};

// Called inside the capacity/acceptance transaction. Check time after the lock,
// so a route that expires during contention cannot receive a committed offer.
export async function requireEligibleLegacyRoute(
  tx: Prisma.TransactionClient,
  driverRouteId: string,
  options: { passengerRequestId?: string | null; matchId?: string; assigned?: boolean } = {},
) {
  const routes = await tx.$queryRaw<Array<{ id: string; status: string; verified: boolean | number; role: string; account_status: string; departure_at: Date | null; availability_window_end: Date | null; departed_at: Date | null; preferred_time: Date | null; match_expires_at: Date | null }>>`
    SELECT dr.id, dr.status, dp.verified, u.role, u.account_status,
           dr.departure_at, dr.availability_window_end, dr.departed_at,
           pr.preferred_time, m.expires_at AS match_expires_at
    FROM driver_routes dr JOIN driver_profiles dp ON dp.id = dr.driver_id JOIN users u ON u.id = dp.user_id
    LEFT JOIN passenger_requests pr ON pr.id = ${options.passengerRequestId ?? null}
    LEFT JOIN matches m ON m.id = ${options.matchId ?? null}
    WHERE dr.id = ${driverRouteId} AND dr.operational_mode = 'legacy' AND dr.canonical_availability_version IS NULL
    FOR UPDATE
  `;
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT UTC_TIMESTAMP(3) AS now`;
  const route = routes[0];
  if (!route || route.status !== (options.assigned ? "assigned" : "active") || !route.verified || route.role !== "driver" || route.account_status !== "active" ||
      route.departed_at ||
      (route.departure_at && route.departure_at <= clock.now) ||
      (route.availability_window_end && route.availability_window_end <= clock.now)) {
    throw new HttpError(409, "selected_driver_route_unavailable");
  }
  if (route.preferred_time && route.preferred_time <= clock.now) throw new HttpError(409, "passenger_request_expired");
  if (route.match_expires_at && route.match_expires_at <= clock.now) throw new HttpError(409, "match_expired");
  return clock.now;
}

export function legacyRouteTimingWhere(now = new Date()): Prisma.DriverRouteWhereInput {
  return {
    departed_at: null,
    AND: [
      { OR: [{ departure_at: null }, { departure_at: { gt: now } }] },
      { OR: [{ availability_window_end: null }, { availability_window_end: { gt: now } }] },
    ],
  };
}

export function isLegacyRouteTimely(route: {
  departure_at?: Date | null;
  departed_at?: Date | null;
  availability_window_end?: Date | null;
}, now = new Date()) {
  return !route.departed_at && (!route.departure_at || route.departure_at > now) &&
    (!route.availability_window_end || route.availability_window_end > now);
}

export async function reserveLegacyCapacity(
  tx: Prisma.TransactionClient,
  input: LegacyCapacityInput,
) {
  if (input.seats < 0 || input.parcelUnits < 0 || (!input.seats && !input.parcelUnits)) {
    throw new HttpError(400, "invalid_capacity_request");
  }

  const now = await requireEligibleLegacyRoute(tx, input.driverRouteId, { passengerRequestId: input.passengerRequestId });

  const result = await tx.driverRoute.updateMany({
    where: {
      id: input.driverRouteId,
      operational_mode: "legacy",
      status: "active",
      ...legacyRouteTimingWhere(now),
      seats_available: { gte: input.seats },
      parcel_capacity_available: { gte: input.parcelUnits },
    },
    data: {
      seats_available: input.seats ? { decrement: input.seats } : undefined,
      parcel_capacity_available: input.parcelUnits ? { decrement: input.parcelUnits } : undefined,
    },
  });

  if (result.count !== 1) {
    throw new HttpError(
      409,
      input.seats && input.parcelUnits
        ? "insufficient_driver_capacity"
        : input.seats
          ? "insufficient_seat_capacity"
          : "insufficient_parcel_capacity",
    );
  }
}

export async function releaseLegacyCapacity(
  tx: Prisma.TransactionClient,
  input: LegacyCapacityInput,
) {
  if (input.seats < 0 || input.parcelUnits < 0 || (!input.seats && !input.parcelUnits)) return;
  await tx.driverRoute.update({
    where: { id: input.driverRouteId },
    data: {
      seats_available: input.seats ? { increment: input.seats } : undefined,
      parcel_capacity_available: input.parcelUnits ? { increment: input.parcelUnits } : undefined,
    },
  });
}

export async function legacyParcelUnits(
  tx: Prisma.TransactionClient,
  options: { parcelBatchId?: string | null; merchantOrderId?: string | null },
) {
  const where: Prisma.ParcelWhereInput | null = options.parcelBatchId
    ? { batch_id: options.parcelBatchId, status: { notIn: ["cancelled", "failed", "expired"] } }
    : options.merchantOrderId
      ? { order_id: options.merchantOrderId, status: { notIn: ["cancelled", "failed", "expired"] } }
      : null;
  if (!where) return 0;
  return tx.parcel.count({ where });
}
