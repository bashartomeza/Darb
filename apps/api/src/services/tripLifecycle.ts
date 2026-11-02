import type { Prisma } from "../generated/prisma/client.js";
import { AuditAction, TripStatus } from "../generated/prisma/enums.js";
import { HttpError } from "../middleware/error.js";
import { notifyTripStatus } from "./notifications.js";
import { confirmHandover, tripOrderIds, unconfirmedOrderIds } from "./deliveryHandover.js";

export const LEGACY_TRIP_TRANSITIONS: Readonly<Record<string, readonly TripStatus[]>> = {
  accepted: [TripStatus.pickup_started, TripStatus.cancelled],
  pickup_started: [TripStatus.picked_up, TripStatus.cancelled],
  picked_up: [TripStatus.in_transit, TripStatus.cancelled],
  in_transit: [TripStatus.delivered, TripStatus.cancelled, TripStatus.failed],
  delivered: [TripStatus.completed, TripStatus.failed],
  completed: [],
  cancelled: [],
  failed: [],
  created: [],
};

export const ADMIN_FORWARD_TRIP_TRANSITION: Readonly<Partial<Record<TripStatus, TripStatus>>> = {
  [TripStatus.accepted]: TripStatus.pickup_started,
  [TripStatus.pickup_started]: TripStatus.picked_up,
  [TripStatus.picked_up]: TripStatus.in_transit,
  [TripStatus.in_transit]: TripStatus.delivered,
  [TripStatus.delivered]: TripStatus.completed,
};

export function isLegacyTripTransitionAllowed(current: TripStatus, next: TripStatus) {
  return LEGACY_TRIP_TRANSITIONS[current]?.includes(next) ?? false;
}

export type LegacyTripLifecycleSnapshot = {
  id: string;
  status: TripStatus;
  driver_route_id: string;
  passenger_request_id: string | null;
  merchant_order_id: string | null;
  parcel_batch_id: string | null;
};

type AdvanceOptions = {
  actorId: string;
  expectedStatus: TripStatus;
  /** Admin forward-moves may close unconfirmed handovers; they are recorded as admin_override. */
  adminOverride?: boolean;
};

async function batchMemberOrderIds(tx: Prisma.TransactionClient, batchId: string) {
  const members = await tx.parcelBatchOrder.findMany({
    where: { parcel_batch_id: batchId },
    select: { merchant_order_id: true },
  });
  return members.map((member) => member.merchant_order_id);
}

async function restoreLegacyCapacity(
  tx: Prisma.TransactionClient,
  trip: LegacyTripLifecycleSnapshot,
) {
  const route = await tx.driverRoute.findUnique({
    where: { id: trip.driver_route_id },
    select: { id: true, status: true },
  });
  if (!route) throw new HttpError(409, "driver_route_not_available");

  let seats = 0;
  let parcels = 0;
  if (trip.passenger_request_id) {
    const request = await tx.passengerRequest.findUnique({
      where: { id: trip.passenger_request_id },
      select: { passenger_count: true },
    });
    seats = request?.passenger_count ?? 0;
  }
  if (trip.parcel_batch_id) {
    parcels = await tx.parcel.count({
      where: { batch_id: trip.parcel_batch_id, status: { notIn: ["cancelled", "failed", "expired"] } },
    });
  } else if (trip.merchant_order_id) {
    parcels = await tx.parcel.count({
      where: { order_id: trip.merchant_order_id, status: { notIn: ["cancelled", "failed", "expired"] } },
    });
  }

  if (seats || parcels) {
    await tx.driverRoute.update({
      where: { id: trip.driver_route_id },
      data: {
        seats_available: seats ? { increment: seats } : undefined,
        parcel_capacity_available: parcels ? { increment: parcels } : undefined,
        status: "active",
        completed_at: null,
        cancelled_at: null,
      },
    });
  } else {
    await tx.driverRoute.update({
      where: { id: trip.driver_route_id },
      data: { status: "active", completed_at: null, cancelled_at: null },
    });
  }
}

async function syncMerchantEntities(
  tx: Prisma.TransactionClient,
  trip: LegacyTripLifecycleSnapshot,
  status: TripStatus,
) {
  const orderIds = trip.parcel_batch_id
    ? await batchMemberOrderIds(tx, trip.parcel_batch_id)
    : trip.merchant_order_id
      ? [trip.merchant_order_id]
      : [];
  if (!orderIds.length) return;

  if (status === TripStatus.picked_up) {
    if (trip.parcel_batch_id) {
      await tx.parcelBatch.update({ where: { id: trip.parcel_batch_id }, data: { status: "picked_up" } });
    }
    await tx.parcel.updateMany({ where: { order_id: { in: orderIds } }, data: { status: "picked_up" } });
  }
  if (status === TripStatus.in_transit) {
    if (trip.parcel_batch_id) {
      await tx.parcelBatch.update({ where: { id: trip.parcel_batch_id }, data: { status: "in_transit" } });
    }
    await tx.merchantOrder.updateMany({ where: { id: { in: orderIds } }, data: { status: "in_transit" } });
    await tx.parcel.updateMany({ where: { order_id: { in: orderIds } }, data: { status: "in_transit" } });
  }
  if (status === TripStatus.delivered) {
    if (trip.parcel_batch_id) {
      await tx.parcelBatch.update({ where: { id: trip.parcel_batch_id }, data: { status: "delivered" } });
    }
    await tx.parcel.updateMany({ where: { order_id: { in: orderIds } }, data: { status: "delivered" } });
    await tx.merchantOrder.updateMany({ where: { id: { in: orderIds } }, data: { status: "delivered" } });
  }
  if (status === TripStatus.completed) {
    await tx.merchantOrder.updateMany({ where: { id: { in: orderIds } }, data: { status: "completed" } });
  }
  if (status === TripStatus.cancelled) {
    if (trip.parcel_batch_id) {
      await tx.parcelBatch.update({ where: { id: trip.parcel_batch_id }, data: { status: "cancelled", driver_route_id: null } });
      await tx.parcelBatchOrder.updateMany({ where: { parcel_batch_id: trip.parcel_batch_id, active: true }, data: { active: false, active_membership_key: null } });
    }
    await tx.parcel.updateMany({ where: { order_id: { in: orderIds } }, data: { status: "cancelled" } });
    await tx.merchantOrder.updateMany({ where: { id: { in: orderIds } }, data: { status: "cancelled" } });
  }
  if (status === TripStatus.failed) {
    if (trip.parcel_batch_id) {
      await tx.parcelBatch.update({ where: { id: trip.parcel_batch_id }, data: { status: "failed" } });
      await tx.parcelBatchOrder.updateMany({ where: { parcel_batch_id: trip.parcel_batch_id, active: true }, data: { active: false, active_membership_key: null } });
    }
    await tx.parcel.updateMany({ where: { order_id: { in: orderIds } }, data: { status: "failed" } });
    await tx.merchantOrder.updateMany({ where: { id: { in: orderIds } }, data: { status: "failed" } });
  }
}

export async function advanceLegacyTrip(
  tx: Prisma.TransactionClient,
  trip: LegacyTripLifecycleSnapshot,
  nextStatus: TripStatus,
  options: AdvanceOptions,
) {
  if (trip.status !== options.expectedStatus) throw new HttpError(409, "trip_status_conflict");
  if (!isLegacyTripTransitionAllowed(trip.status, nextStatus)) {
    throw new HttpError(409, "invalid_trip_status_transition");
  }

  if (nextStatus === TripStatus.delivered) {
    // A parcel trip is only delivered once every order's receiver confirmation is on file.
    const missing = await unconfirmedOrderIds(tx, await tripOrderIds(tx, trip));
    if (missing.length && !options.adminOverride) throw new HttpError(409, "delivery_confirmation_required");
    for (const orderId of missing) {
      await confirmHandover(tx, { orderId, method: "admin_override", actorId: options.actorId, tripId: trip.id });
      await tx.auditEvent.create({
        data: {
          user_id: options.actorId,
          action: AuditAction.trip_status_updated,
          entity_type: "Trip",
          entity_id: trip.id,
          metadata: { event: "delivery_confirmed", method: "admin_override", order_id: orderId },
        },
      });
    }
  }

  const completedAt = nextStatus === TripStatus.completed || nextStatus === TripStatus.failed ? new Date() : undefined;
  // A conditional single-record update can return its earlier snapshot after a
  // competing MySQL write. Claim by affected-row count before any side effects.
  const claimed = await tx.trip.updateMany({
    where: { id: trip.id, status: options.expectedStatus },
    data: {
      status: nextStatus,
      started_at: nextStatus === TripStatus.pickup_started ? new Date() : undefined,
      completed_at: completedAt,
      cancelled_by_user_id: nextStatus === TripStatus.cancelled || nextStatus === TripStatus.failed ? options.actorId : undefined,
    },
  });
  if (claimed.count !== 1) throw new HttpError(409, "trip_status_conflict");
  const updated = await tx.trip.findUniqueOrThrow({ where: { id: trip.id } });

  if (nextStatus === TripStatus.pickup_started) {
    await tx.driverRoute.update({ where: { id: trip.driver_route_id }, data: { status: "on_trip", departed_at: null } });
  }
  // Capture and release the reserved legacy capacity before cancellation changes
  // passenger/parcel rows to terminal states. Otherwise parcel counting would
  // observe the newly-cancelled rows and restore zero capacity.
  if (nextStatus === TripStatus.cancelled || nextStatus === TripStatus.failed) {
    await restoreLegacyCapacity(tx, trip);
  }
  if (trip.passenger_request_id) {
    const passengerStatus: Partial<Record<TripStatus, string>> = {
      [TripStatus.picked_up]: "picked_up",
      [TripStatus.in_transit]: "in_transit",
      [TripStatus.delivered]: "delivered",
      [TripStatus.completed]: "completed",
      [TripStatus.cancelled]: "cancelled",
      [TripStatus.failed]: "cancelled",
    };
    const nextPassengerStatus = passengerStatus[nextStatus];
    if (nextPassengerStatus) {
      await tx.passengerRequest.updateMany({ where: { id: trip.passenger_request_id }, data: { status: nextPassengerStatus as any } });
    }
  }

  await syncMerchantEntities(tx, trip, nextStatus);

  if (nextStatus === TripStatus.completed || nextStatus === TripStatus.failed) {
    await tx.driverRoute.update({ where: { id: trip.driver_route_id }, data: { status: "completed", completed_at: new Date() } });
  }
  if (nextStatus === TripStatus.cancelled && trip.status !== TripStatus.accepted) {
    await tx.driverRoute.update({ where: { id: trip.driver_route_id }, data: { status: "completed", completed_at: new Date(), cancelled_at: new Date() } });
  }

  await tx.auditEvent.create({
    data: {
      user_id: options.actorId,
      action: AuditAction.trip_status_updated,
      entity_type: "Trip",
      entity_id: trip.id,
      metadata: { from: trip.status, to: nextStatus },
    },
  });

  await notifyTripStatus(tx, trip, nextStatus);

  return updated;
}
