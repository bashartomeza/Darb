import type { Prisma } from "../generated/prisma/client.js";
import { AuditAction, MatchStatus, TripStatus } from "../generated/prisma/enums.js";
import { config } from "../config.js";
import { HttpError } from "../middleware/error.js";
import { releaseLegacyCapacity } from "./legacyCapacity.js";
import { closeOpenLegacyOrder, OPEN_LEGACY_ORDER_STATUSES, type OpenLegacyOrderStatus } from "./legacyOrderClosure.js";
import { notify } from "./notifications.js";
import { advanceLegacyTrip } from "./tripLifecycle.js";
import { type CancelActorRole, NO_DRIVER_IN_TIME } from "./cancellationReasons.js";

/**
 * Every cancellation of a legacy ride request, order, parcel or trip goes through here, so
 * each one is recorded in `cancellations`, frees capacity exactly once and tells everyone
 * affected (see docs/api/notifications.md, type `cancelled`).
 *
 * Callers pass a transaction. Order cancellations must run at READ COMMITTED, like the
 * existing merchant cancellation (closeOpenLegacyOrder takes locks and re-reads).
 */

type Tx = Prisma.TransactionClient;

export type CancelActor = { userId: string | null; role: CancelActorRole };
export type CancelReason = { code: string; note?: string | null; automatic?: boolean };

export const SYSTEM_ACTOR: CancelActor = { userId: null, role: "system" };
export const NO_DRIVER_REASON: CancelReason = { code: NO_DRIVER_IN_TIME, automatic: true };

/** Trip states before the passenger or parcel is picked up. */
const PRE_PICKUP_TRIP_STATUSES: readonly TripStatus[] = [TripStatus.accepted, TripStatus.pickup_started];
/** Trip states an administrator can still cancel. */
const ADMIN_CANCELLABLE_TRIP_STATUSES: readonly TripStatus[] = [
  TripStatus.accepted,
  TripStatus.pickup_started,
  TripStatus.picked_up,
  TripStatus.in_transit,
];

// ---------------------------------------------------------------- waiting window

/** When the 45-minute (ORDER_AUTO_CANCEL_MINUTES) wait for a driver starts: the booked time if it is later than creation, else creation. */
export function waitingReferenceTime(createdAt: Date, scheduledFor: Date | null | undefined): Date {
  return scheduledFor && scheduledFor.getTime() > createdAt.getTime() ? scheduledFor : createdAt;
}

/** The moment after which a waiting item whose reference time is `reference` is cancelled. */
export function autoCancelDeadline(reference: Date, minutes: number = config.orderAutoCancelMinutes): Date {
  return new Date(reference.getTime() + minutes * 60_000);
}

export function isInsideWaitingWindow(reference: Date, now: Date, minutes: number = config.orderAutoCancelMinutes): boolean {
  return autoCancelDeadline(reference, minutes).getTime() > now.getTime();
}

// ---------------------------------------------------------------- recording + notifying

type Conclude = {
  actor: CancelActor;
  reason: CancelReason;
  passengerRequestId?: string | null;
  merchantOrderId?: string | null;
  tripId?: string | null;
  /** The passenger or merchant/parcel sender who owns the request or order. */
  ownerId: string | null;
  /** The driver of the trip, when there was one. */
  driverUserId?: string | null;
  /** What the owner called it: ride request, order or parcel. */
  kind: "ride" | "order" | "parcel";
  /** False when only the trip was cancelled and the order goes back to waiting. */
  endsOrder: boolean;
  /** Owner is told the order is waiting for another driver (endsOrder false, still inside the window). */
  waiting?: boolean;
  notifyOwner?: boolean;
  notifyDriver?: boolean;
  /** Only this order left a trip that continues with other orders. */
  partial?: boolean;
  /** Extra audit metadata (the batch the order left, offers withdrawn). */
  auditExtra?: Record<string, string | number | string[]>;
};

async function conclude(tx: Tx, input: Conclude) {
  const row = await tx.cancellation.create({
    data: {
      actor_user_id: input.actor.userId,
      actor_role: input.actor.role,
      passenger_request_id: input.passengerRequestId ?? null,
      merchant_order_id: input.merchantOrderId ?? null,
      trip_id: input.tripId ?? null,
      reason_code: input.reason.code,
      note: input.reason.note ?? null,
      automatic: input.reason.automatic === true,
      ends_order: input.endsOrder,
    },
  });
  const entityType = input.passengerRequestId ? "PassengerRequest" : "MerchantOrder";
  const entityId = (input.passengerRequestId ?? input.merchantOrderId)!;
  if (input.endsOrder) {
    await tx.auditEvent.create({
      data: {
        user_id: input.actor.userId,
        action: input.passengerRequestId ? AuditAction.passenger_request_cancelled : AuditAction.merchant_order_cancelled,
        entity_type: entityType,
        entity_id: entityId,
        metadata: {
          cancellation_id: row.id,
          action: input.passengerRequestId ? "passenger_request_cancelled" : input.kind === "parcel" ? "passenger_parcel_cancelled" : "merchant_order_cancelled",
          reason: input.reason.code,
          actor_role: input.actor.role,
          automatic: input.reason.automatic === true,
          ...(input.tripId ? { trip_id: input.tripId } : {}),
          ...(input.auditExtra ?? {}),
        },
      },
    });
  }
  const params = {
    kind: input.kind,
    by: input.actor.role,
    reason: input.reason.code,
    automatic: input.reason.automatic === true,
    ends_order: input.endsOrder,
    waiting: input.waiting === true,
    partial: input.partial === true,
  };
  if (input.ownerId && input.notifyOwner !== false && input.ownerId !== input.actor.userId) {
    await notify(tx, {
      userId: input.ownerId,
      type: "cancelled",
      entityType,
      entityId,
      dedupeKey: `cancelled:${row.id}`,
      params: { ...params, audience: "owner" },
    });
  }
  if (input.driverUserId && input.notifyDriver && input.driverUserId !== input.actor.userId) {
    await notify(tx, {
      userId: input.driverUserId,
      type: "cancelled",
      entityType: input.tripId ? "Trip" : entityType,
      entityId: input.tripId ?? entityId,
      dedupeKey: `cancelled:${row.id}`,
      params: { ...params, audience: "driver" },
    });
  }
  return row;
}

async function isParcelOrder(tx: Tx, orderId: string) {
  return (await tx.passengerParcelDetail.count({ where: { order_id: orderId } })) > 0;
}

/** A cancelled parcel's receiver is no longer needed: erase now rather than at retention expiry. */
async function purgeParcelReceiver(tx: Tx, orderId: string) {
  await tx.passengerParcelDetail.updateMany({
    where: { order_id: orderId, receiver_purged_at: null },
    data: { receiver_name: null, receiver_phone: null, note: null, receiver_purged_at: new Date() },
  });
}

// ---------------------------------------------------------------- trips

const tripSelect = {
  id: true,
  status: true,
  driver_route_id: true,
  passenger_request_id: true,
  merchant_order_id: true,
  parcel_batch_id: true,
  driver_route: { select: { driver: { select: { user_id: true } } } },
} satisfies Prisma.TripSelect;
type TripRow = Prisma.TripGetPayload<{ select: typeof tripSelect }>;

async function batchOrderIds(tx: Tx, batchId: string) {
  const members = await tx.parcelBatchOrder.findMany({
    where: { parcel_batch_id: batchId },
    select: { merchant_order_id: true },
    orderBy: { created_at: "asc" },
  });
  return members.map((member) => member.merchant_order_id);
}

async function tripOrderIdList(tx: Tx, trip: TripRow) {
  if (trip.parcel_batch_id) {
    const ids = await batchOrderIds(tx, trip.parcel_batch_id);
    if (ids.length) return ids;
  }
  return trip.merchant_order_id ? [trip.merchant_order_id] : [];
}

/** The accepted offers of a trip's demand stop being accepted offers once the trip is gone. */
async function invalidateAcceptedMatches(tx: Tx, trip: TripRow, orderIds: string[]) {
  const or: Prisma.MatchWhereInput[] = [];
  if (trip.passenger_request_id) or.push({ passenger_request_id: trip.passenger_request_id });
  if (trip.parcel_batch_id) or.push({ parcel_batch_id: trip.parcel_batch_id });
  if (orderIds.length) or.push({ merchant_order_id: { in: orderIds } });
  if (!or.length) return;
  await tx.match.updateMany({
    where: { operational_mode: "legacy", driver_route_id: trip.driver_route_id, status: MatchStatus.accepted, OR: or },
    data: { status: MatchStatus.invalidated, legacy_demand_key: null, legacy_capacity_held: false },
  });
}

/**
 * Cancels a whole trip and everything on it: the passenger request and all orders (an admin
 * cancelling, or the only order of the trip being cancelled by its sender). The driver's
 * route goes back to waiting for work when the trip had not picked anything up yet.
 */
async function cancelWholeTrip(tx: Tx, input: { trip: TripRow; actor: CancelActor; reason: CancelReason }) {
  const { trip, actor, reason } = input;
  if (!actor.userId) throw new HttpError(500, "cancellation_actor_required");
  const orderIds = await tripOrderIdList(tx, trip);
  const orders = orderIds.length
    ? await tx.merchantOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, merchant_id: true } })
    : [];
  const request = trip.passenger_request_id
    ? await tx.passengerRequest.findUnique({ where: { id: trip.passenger_request_id }, select: { id: true, passenger_id: true } })
    : null;

  await advanceLegacyTrip(tx, trip, TripStatus.cancelled, {
    actorId: actor.userId,
    expectedStatus: trip.status,
    beforePickup: PRE_PICKUP_TRIP_STATUSES.includes(trip.status),
    skipNotify: true,
  });
  await invalidateAcceptedMatches(tx, trip, orderIds);

  const driverUserId = trip.driver_route.driver?.user_id ?? null;
  let first = true;
  if (request) {
    await conclude(tx, {
      actor, reason, passengerRequestId: request.id, tripId: trip.id, ownerId: request.passenger_id,
      driverUserId, kind: "ride", endsOrder: true, notifyDriver: first,
    });
    first = false;
  }
  for (const order of orders) {
    const parcel = await isParcelOrder(tx, order.id);
    if (parcel) await purgeParcelReceiver(tx, order.id);
    await conclude(tx, {
      actor, reason, merchantOrderId: order.id, tripId: trip.id, ownerId: order.merchant_id,
      driverUserId, kind: parcel ? "parcel" : "order", endsOrder: true, notifyDriver: first,
    });
    first = false;
  }
}

async function findTrip(tx: Tx, where: Prisma.TripWhereInput) {
  return tx.trip.findFirst({ where: { operational_mode: "legacy", ...where }, select: tripSelect, orderBy: { created_at: "desc" } });
}

// ---------------------------------------------------------------- passenger requests

/**
 * Cancels a passenger's ride request: waiting (offers withdrawn, held seats released) or,
 * after a driver accepted, before pickup (the trip is cancelled and the driver told).
 * An administrator (no `ownerId`) can also cancel while the ride is under way.
 */
export async function cancelPassengerRequest(
  tx: Tx,
  input: { requestId: string; ownerId?: string; actor: CancelActor; reason: CancelReason },
) {
  const { requestId, ownerId, actor, reason } = input;
  // Lock before the first snapshot read: matching claims this same request.
  // A cancellation must see every hold committed before it obtains the lock.
  if (ownerId) {
    await tx.$queryRaw`
      SELECT id FROM passenger_requests
      WHERE id = ${requestId} AND passenger_id = ${ownerId} AND canonical_entry_version IS NULL
      FOR UPDATE
    `;
  } else {
    await tx.$queryRaw`
      SELECT id FROM passenger_requests WHERE id = ${requestId} AND canonical_entry_version IS NULL FOR UPDATE
    `;
  }
  const existing = await tx.passengerRequest.findFirst({
    where: { id: requestId, canonical_entry_version: null, ...(ownerId ? { passenger_id: ownerId } : {}) },
  });
  if (!existing) throw new HttpError(404, "request_not_found");

  if (existing.status === "accepted" || (!ownerId && ["picked_up", "in_transit"].includes(existing.status))) {
    const trip = await findTrip(tx, {
      passenger_request_id: existing.id,
      status: { in: [...(ownerId ? PRE_PICKUP_TRIP_STATUSES : ADMIN_CANCELLABLE_TRIP_STATUSES)] },
    });
    if (!trip) throw new HttpError(409, "request_cannot_be_cancelled");
    await cancelWholeTrip(tx, { trip, actor, reason });
    return;
  }

  if (existing.status !== "pending" && existing.status !== "matched") {
    throw new HttpError(409, "request_cannot_be_cancelled");
  }

  const activeMatches = await tx.match.findMany({
    where: {
      passenger_request_id: existing.id,
      operational_mode: "legacy",
      status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver] },
    },
    select: {
      id: true,
      driver_route_id: true,
      legacy_capacity_held: true,
      merchant_order_id: true,
      parcel_batch_id: true,
      driver_route: { select: { driver: { select: { user_id: true } } } },
    },
  });
  const withdrawn: typeof activeMatches = [];
  for (const match of activeMatches) {
    const changed = await tx.match.updateMany({
      where: { id: match.id, status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver] } },
      data: { status: MatchStatus.invalidated, legacy_demand_key: null, legacy_capacity_held: false },
    });
    if (changed.count !== 1) continue;
    withdrawn.push(match);

    const parcelUnits = match.parcel_batch_id
      ? await tx.parcel.count({ where: { batch_id: match.parcel_batch_id, status: { notIn: ["cancelled", "failed", "expired"] } } })
      : match.merchant_order_id
        ? await tx.parcel.count({ where: { order_id: match.merchant_order_id, status: { notIn: ["cancelled", "failed", "expired"] } } })
        : 0;
    if (match.legacy_capacity_held) {
      await releaseLegacyCapacity(tx, { driverRouteId: match.driver_route_id, seats: existing.passenger_count, parcelUnits });
    }

    if (match.parcel_batch_id) {
      const batch = await tx.parcelBatch.findUnique({ where: { id: match.parcel_batch_id }, select: { id: true, status: true } });
      if (batch && ["proposed", "created"].includes(batch.status)) {
        await tx.parcelBatch.update({ where: { id: batch.id }, data: { driver_route_id: null, status: "created" } });
        const members = await tx.parcelBatchOrder.findMany({ where: { parcel_batch_id: batch.id, active: true }, select: { merchant_order_id: true } });
        const memberIds = members.map((member) => member.merchant_order_id);
        if (memberIds.length) {
          await tx.merchantOrder.updateMany({ where: { id: { in: memberIds }, status: "matched" }, data: { status: "batched" } });
        }
      }
    } else if (match.merchant_order_id) {
      await tx.merchantOrder.updateMany({ where: { id: match.merchant_order_id, status: "matched" }, data: { status: "submitted" } });
    }
  }

  const changed = await tx.passengerRequest.updateMany({
    where: { id: existing.id, ...(ownerId ? { passenger_id: ownerId } : {}), status: { in: ["pending", "matched"] } },
    data: { status: "cancelled" },
  });
  if (changed.count !== 1) throw new HttpError(409, "request_cannot_be_cancelled");

  // A driver who was offered this request learns it is gone (same notice as a withdrawn parcel offer).
  for (const match of withdrawn) {
    await notify(tx, {
      userId: match.driver_route?.driver?.user_id,
      type: "match_withdrawn",
      entityType: "Match",
      entityId: match.id,
      dedupeKey: `match_withdrawn:${match.id}`,
      params: { reason: "request_cancelled" },
    });
  }
  await conclude(tx, {
    actor, reason, passengerRequestId: existing.id, ownerId: existing.passenger_id, kind: "ride", endsOrder: true,
  });
}

// ---------------------------------------------------------------- merchant orders and parcels

/**
 * Cancels one merchant order or passenger parcel.
 *  - Not yet accepted: closes it (see closeOpenLegacyOrder); in a batch only this order leaves it.
 *  - Accepted, before pickup: alone on its trip, the trip is cancelled; in a batch with other
 *    orders, only this order leaves the trip (its capacity is freed) and the trip carries on.
 * An administrator (no `ownerId`) can also cancel an order whose trip is already under way,
 * which cancels the whole trip.
 */
export async function cancelMerchantOrder(
  tx: Tx,
  input: { orderId: string; ownerId?: string; actor: CancelActor; reason: CancelReason; now?: Date },
) {
  const { orderId, ownerId, actor, reason } = input;
  const order = await tx.merchantOrder.findFirst({
    where: { id: orderId, canonical_entry_version: null, ...(ownerId ? { merchant_id: ownerId } : {}) },
    select: { id: true, status: true, merchant_id: true },
  });
  if (!order) throw new HttpError(404, "order_not_found");
  const parcel = await isParcelOrder(tx, order.id);
  const kind = parcel ? "parcel" : "order";

  if ((OPEN_LEGACY_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    const closed = await closeOpenLegacyOrder(tx, {
      orderId: order.id,
      expectedStatus: order.status as OpenLegacyOrderStatus,
      outcome: "cancelled",
      merchantId: ownerId,
      now: input.now,
    });
    // Another write (matching, acceptance) changed the order since it was read.
    if (!closed) throw new HttpError(409, "order_cannot_be_cancelled");
    if (parcel) await purgeParcelReceiver(tx, order.id);
    await conclude(tx, {
      actor, reason, merchantOrderId: order.id, ownerId: order.merchant_id, kind, endsOrder: true,
      auditExtra: {
        ...(closed.batchId ? { parcel_batch_id: closed.batchId, batch_orders_remaining: closed.remainingOrderIds.length } : {}),
        ...(closed.withdrawnMatchIds.length ? { withdrawn_match_ids: closed.withdrawnMatchIds } : {}),
      },
    });
    return { closed, tripId: null as string | null };
  }

  if (order.status !== "assigned" && !(actor.role === "admin" && ["in_transit"].includes(order.status))) {
    throw new HttpError(409, "order_cannot_be_cancelled");
  }
  const trip = await findTrip(tx, {
    status: { in: [...(actor.role === "admin" ? ADMIN_CANCELLABLE_TRIP_STATUSES : PRE_PICKUP_TRIP_STATUSES)] },
    OR: [
      { merchant_order_id: order.id },
      { parcel_batch: { members: { some: { merchant_order_id: order.id } } } },
      { parcel_batch: { merchant_order_id: order.id } },
    ],
  });
  if (!trip) throw new HttpError(409, "order_cannot_be_cancelled");
  const orderIds = await tripOrderIdList(tx, trip);
  const alone = orderIds.filter((id) => id !== order.id).length === 0 && !trip.passenger_request_id;
  const beforePickup = PRE_PICKUP_TRIP_STATUSES.includes(trip.status);

  if (alone || !beforePickup || !trip.parcel_batch_id) {
    await cancelWholeTrip(tx, { trip, actor, reason });
    return { closed: null, tripId: trip.id };
  }

  await removeOrderFromAcceptedTrip(tx, { trip, orderId: order.id, ownerId: order.merchant_id, actor, reason, kind });
  return { closed: null, tripId: trip.id };
}

/** One order of an accepted batch leaves the trip; the others stay and the driver keeps going. */
async function removeOrderFromAcceptedTrip(
  tx: Tx,
  input: { trip: TripRow; orderId: string; ownerId: string; actor: CancelActor; reason: CancelReason; kind: "order" | "parcel" },
) {
  const { trip, orderId, actor, reason } = input;
  const batchId = trip.parcel_batch_id!;
  // The batch is locked before its orders, like every other batch write.
  await tx.$queryRaw`SELECT id FROM parcel_batches WHERE id = ${batchId} FOR UPDATE`;
  const claimed = await tx.merchantOrder.updateMany({
    where: { id: orderId, status: "assigned", canonical_entry_version: null },
    data: { status: "cancelled" },
  });
  if (claimed.count !== 1) throw new HttpError(409, "order_cannot_be_cancelled");

  const parcelUnits = await tx.parcel.count({
    where: { order_id: orderId, status: { notIn: ["cancelled", "failed", "expired"] } },
  });
  if (parcelUnits > 0) await releaseLegacyCapacity(tx, { driverRouteId: trip.driver_route_id, seats: 0, parcelUnits });
  await tx.parcel.updateMany({ where: { order_id: orderId }, data: { status: "cancelled", batch_id: null } });
  await tx.parcelBatchOrder.deleteMany({ where: { parcel_batch_id: batchId, merchant_order_id: orderId } });

  const remaining = await batchOrderIds(tx, batchId);
  const batch = await tx.parcelBatch.findUnique({ where: { id: batchId }, select: { merchant_order_id: true } });
  if (remaining.length && batch?.merchant_order_id === orderId) {
    // The batch and trip are shown under their lead order; a cancelled order cannot lead them.
    await tx.parcelBatch.update({ where: { id: batchId }, data: { merchant_order_id: remaining[0] } });
  }
  if (remaining.length && trip.merchant_order_id === orderId) {
    await tx.trip.update({ where: { id: trip.id }, data: { merchant_order_id: remaining[0] } });
  }
  if (input.kind === "parcel") await purgeParcelReceiver(tx, orderId);
  await conclude(tx, {
    actor, reason, merchantOrderId: orderId, tripId: trip.id, ownerId: input.ownerId,
    driverUserId: trip.driver_route.driver?.user_id ?? null, kind: input.kind, endsOrder: true, notifyDriver: true, partial: true,
  });
}

// ---------------------------------------------------------------- driver

/**
 * A driver cancels an accepted trip before pickup. Only the trip is cancelled (and counts
 * against the driver's trust score, which reads trips cancelled by their driver). The
 * ride request or orders go back to waiting when they are still inside their window and
 * are cancelled automatically (`no_driver_in_time`) when they are not.
 */
export async function driverCancelTrip(
  tx: Tx,
  input: { tripId: string; driverUserId: string; reason: CancelReason; now?: Date },
) {
  const now = input.now ?? new Date();
  const trip = await tx.trip.findFirst({
    where: { id: input.tripId, operational_mode: "legacy" },
    select: tripSelect,
  });
  if (!trip) throw new HttpError(404, "trip_not_found");
  if (trip.driver_route.driver?.user_id !== input.driverUserId) throw new HttpError(403, "forbidden");
  if (!PRE_PICKUP_TRIP_STATUSES.includes(trip.status)) throw new HttpError(409, "trip_cannot_be_cancelled");

  const since = new Date(now.getTime() - 24 * 60 * 60_000);
  const recent = await tx.cancellation.findMany({
    where: { actor_user_id: input.driverUserId, actor_role: "driver", created_at: { gte: since }, trip_id: { not: null } },
    select: { trip_id: true },
    distinct: ["trip_id"],
  });
  if (recent.length >= config.driverCancellationsPerDay) throw new HttpError(429, "driver_cancellation_limit_reached");

  const actor: CancelActor = { userId: input.driverUserId, role: "driver" };
  const orderIds = await tripOrderIdList(tx, trip);
  await advanceLegacyTrip(tx, trip, TripStatus.cancelled, {
    actorId: input.driverUserId,
    expectedStatus: trip.status,
    beforePickup: true,
    skipNotify: true,
    keepDemand: true,
  });
  await invalidateAcceptedMatches(tx, trip, orderIds);

  const lateOrders: Array<{ id: string }> = [];
  let lateRequestId: string | null = null;

  if (trip.passenger_request_id) {
    const request = await tx.passengerRequest.findUnique({
      where: { id: trip.passenger_request_id },
      select: { id: true, passenger_id: true, created_at: true, preferred_time: true },
    });
    if (request) {
      await tx.passengerRequest.updateMany({ where: { id: request.id, status: "accepted" }, data: { status: "pending" } });
      const inside = isInsideWaitingWindow(waitingReferenceTime(request.created_at, request.preferred_time), now);
      await conclude(tx, {
        actor, reason: input.reason, passengerRequestId: request.id, tripId: trip.id, ownerId: request.passenger_id,
        kind: "ride", endsOrder: false, waiting: true, notifyOwner: inside,
      });
      if (!inside) lateRequestId = request.id;
    }
  }

  if (orderIds.length) {
    const orders = await tx.merchantOrder.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, merchant_id: true, created_at: true, requested_departure_from: true },
    });
    if (trip.parcel_batch_id) {
      await tx.merchantOrder.updateMany({ where: { id: { in: orderIds }, status: "assigned" }, data: { status: "batched" } });
      await tx.parcel.updateMany({ where: { order_id: { in: orderIds }, batch_id: trip.parcel_batch_id, status: "assigned" }, data: { status: "batched" } });
      await tx.parcelBatch.update({ where: { id: trip.parcel_batch_id }, data: { status: "created", driver_route_id: null } });
    } else {
      await tx.merchantOrder.updateMany({ where: { id: { in: orderIds }, status: "assigned" }, data: { status: "submitted" } });
      await tx.parcel.updateMany({ where: { order_id: { in: orderIds }, status: "assigned" }, data: { status: "pending" } });
    }
    for (const order of orders) {
      const inside = isInsideWaitingWindow(waitingReferenceTime(order.created_at, order.requested_departure_from), now);
      const parcel = await isParcelOrder(tx, order.id);
      await conclude(tx, {
        actor, reason: input.reason, merchantOrderId: order.id, tripId: trip.id, ownerId: order.merchant_id,
        kind: parcel ? "parcel" : "order", endsOrder: false, waiting: true, notifyOwner: inside,
      });
      if (!inside) lateOrders.push({ id: order.id });
    }
  }

  // Past their window, nobody else may pick them up: they end as the automatic cancellation says.
  if (lateRequestId) {
    await cancelPassengerRequest(tx, { requestId: lateRequestId, actor: SYSTEM_ACTOR, reason: NO_DRIVER_REASON });
  }
  for (const order of lateOrders) {
    await cancelMerchantOrder(tx, { orderId: order.id, actor: SYSTEM_ACTOR, reason: NO_DRIVER_REASON, now });
  }
  return { tripId: trip.id, returnedToWaiting: (trip.passenger_request_id ? 1 : 0) + orderIds.length - lateOrders.length - (lateRequestId ? 1 : 0) };
}

// ---------------------------------------------------------------- administrators

/** An administrator cancels a trip (any state from accepted to in transit) and everything on it. */
export async function adminCancelTrip(tx: Tx, input: { tripId: string; actorId: string; reason: CancelReason }) {
  const trip = await tx.trip.findFirst({ where: { id: input.tripId, operational_mode: "legacy" }, select: tripSelect });
  if (!trip) throw new HttpError(404, "trip_not_found");
  if (!ADMIN_CANCELLABLE_TRIP_STATUSES.includes(trip.status)) throw new HttpError(409, "trip_cannot_be_cancelled");
  await cancelWholeTrip(tx, { trip, actor: { userId: input.actorId, role: "admin" }, reason: input.reason });
  return { tripId: trip.id };
}

// ---------------------------------------------------------------- reading

type CancellationRow = { reason_code: string; note?: string | null; automatic: boolean; actor_role: string; created_at: Date };

/**
 * What a cancelled item shows its owner: who ended it and why. The free-text note stays
 * with the administrators (see the admin list), as it can be about the other party.
 */
export function serializeCancellation(rows: CancellationRow[] | null | undefined) {
  const row = rows?.[0];
  if (!row) return null;
  return { reason: row.reason_code, by: row.actor_role, automatic: row.automatic, at: row.created_at };
}

/** Prisma include fragment that loads the latest cancellation that ended an order or request. */
export const endedCancellationInclude = {
  cancellations: {
    where: { ends_order: true },
    orderBy: { created_at: "desc" as const },
    take: 1,
    select: { reason_code: true, automatic: true, actor_role: true, created_at: true },
  },
};
