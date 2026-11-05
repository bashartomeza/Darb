import type { Prisma } from "../generated/prisma/client.js";
import { MatchStatus } from "../generated/prisma/enums.js";
import { releaseLegacyCapacity } from "./legacyCapacity.js";
import { notify } from "./notifications.js";

/** Order states in which no driver has taken the order yet. */
export const OPEN_LEGACY_ORDER_STATUSES = ["submitted", "batched", "matched"] as const;
export type OpenLegacyOrderStatus = (typeof OPEN_LEGACY_ORDER_STATUSES)[number];

/** Batch states before a driver accepted it. */
const OPEN_BATCH_STATUSES = ["created", "proposed"] as const;
const TERMINAL_PARCEL_STATUSES = ["cancelled", "failed", "expired"] as const;

export type LegacyOrderClosure = {
  /** The open batch the order was in, if any. */
  batchId: string | null;
  /** Orders still in that batch afterwards; empty when the batch closed with the order. */
  remainingOrderIds: string[];
  /** Driver offers withdrawn because their load changed. */
  withdrawnMatchIds: string[];
};

/**
 * Closes one legacy merchant (or passenger parcel) order that no driver has
 * taken yet, as cancelled or expired, inside the caller's transaction.
 *
 * Only this order closes. When it shares a batch with other orders, it leaves
 * that batch and the others stay together: a pending driver offer for the
 * batch is withdrawn (its load changed) and its held capacity released, the
 * remaining orders go back to `batched`, and the batch can be offered again.
 * If the order was the batch's last member, the batch closes with it.
 *
 * Returns null when the order is no longer in [expectedStatus] (another write
 * got there first); nothing is changed then.
 */
export async function closeOpenLegacyOrder(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    expectedStatus: OpenLegacyOrderStatus;
    outcome: "cancelled" | "expired";
    /** Restricts the claim to this owner (merchant cancellation). */
    merchantId?: string;
    now?: Date;
  },
): Promise<LegacyOrderClosure | null> {
  const now = input.now ?? new Date();
  // The claim is the write lock that serializes closing with matching and acceptance.
  const claimed = await tx.merchantOrder.updateMany({
    where: {
      id: input.orderId,
      status: input.expectedStatus,
      canonical_entry_version: null,
      ...(input.merchantId ? { merchant_id: input.merchantId } : {}),
    },
    data: { status: input.outcome },
  });
  if (claimed.count !== 1) return null;

  const batch = await openBatchFor(tx, input.orderId);
  const matchWhere: Prisma.MatchWhereInput = batch
    ? { parcel_batch_id: batch.id }
    : { merchant_order_id: input.orderId };
  const activeMatches = await tx.match.findMany({
    where: { ...matchWhere, operational_mode: "legacy", status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver] } },
    select: {
      id: true,
      driver_route_id: true,
      legacy_capacity_held: true,
      driver_route: { select: { driver: { select: { user_id: true } } } },
    },
  });

  // Held capacity covers every still-open parcel of the offer, counted before any closes.
  const heldRoutes = new Set(activeMatches.filter((match) => match.legacy_capacity_held).map((match) => match.driver_route_id));
  if (heldRoutes.size) {
    const parcelUnits = await tx.parcel.count({
      where: batch
        ? { batch_id: batch.id, status: { notIn: [...TERMINAL_PARCEL_STATUSES] } }
        : { order_id: input.orderId, status: { notIn: [...TERMINAL_PARCEL_STATUSES] } },
    });
    if (parcelUnits > 0) {
      for (const routeId of heldRoutes) {
        await releaseLegacyCapacity(tx, { driverRouteId: routeId, seats: 0, parcelUnits });
      }
    }
  }
  if (activeMatches.length) {
    await tx.match.updateMany({
      where: { id: { in: activeMatches.map((match) => match.id) }, status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver] } },
      data: input.outcome === "expired"
        ? { status: MatchStatus.expired, expired_at: now, legacy_demand_key: null, legacy_capacity_held: false }
        : { status: MatchStatus.invalidated, legacy_demand_key: null, legacy_capacity_held: false },
    });
    // The driver was waiting on this offer: say it is gone and why, rather
    // than let it silently disappear from the inbox.
    for (const match of activeMatches) {
      await notify(tx, {
        userId: match.driver_route?.driver?.user_id,
        type: "match_withdrawn",
        entityType: "Match",
        entityId: match.id,
        dedupeKey: `match_withdrawn:${match.id}`,
        params: { reason: input.outcome },
      });
    }
  }

  if (!batch) {
    await tx.parcel.updateMany({ where: { order_id: input.orderId }, data: { status: input.outcome } });
    return { batchId: null, remainingOrderIds: [], withdrawnMatchIds: activeMatches.map((match) => match.id) };
  }

  const members = await tx.parcelBatchOrder.findMany({
    where: { parcel_batch_id: batch.id },
    select: { merchant_order_id: true },
    orderBy: { created_at: "asc" },
  });
  const remainingOrderIds = members
    .map((member) => member.merchant_order_id)
    .filter((id) => id !== input.orderId);

  if (!remainingOrderIds.length) {
    // The last order: the batch closes with it, as it always did.
    await tx.parcelBatch.update({ where: { id: batch.id }, data: { status: input.outcome, driver_route_id: null } });
    await tx.parcelBatchOrder.updateMany({ where: { parcel_batch_id: batch.id }, data: { active: false, active_membership_key: null } });
    await tx.parcel.updateMany({ where: { batch_id: batch.id }, data: { status: input.outcome } });
    await tx.parcel.updateMany({ where: { order_id: input.orderId }, data: { status: input.outcome } });
    return { batchId: batch.id, remainingOrderIds: [], withdrawnMatchIds: activeMatches.map((match) => match.id) };
  }

  // The order leaves the batch; the others stay together and can be offered again.
  await tx.parcelBatchOrder.deleteMany({ where: { parcel_batch_id: batch.id, merchant_order_id: input.orderId } });
  await tx.parcel.updateMany({ where: { order_id: input.orderId }, data: { status: input.outcome, batch_id: null } });
  await tx.merchantOrder.updateMany({
    where: { id: { in: remainingOrderIds }, status: "matched" },
    data: { status: "batched" },
  });
  await tx.parcelBatch.update({
    where: { id: batch.id },
    data: {
      status: "created",
      driver_route_id: null,
      // The batch is shown under its lead order; a closed order cannot lead it.
      ...(batch.merchant_order_id === input.orderId ? { merchant_order_id: remainingOrderIds[0] } : {}),
    },
  });
  return { batchId: batch.id, remainingOrderIds, withdrawnMatchIds: activeMatches.map((match) => match.id) };
}

/** The open (not yet accepted, not closed) batch an order belongs to, if any. */
async function openBatchFor(tx: Prisma.TransactionClient, orderId: string) {
  const membership = await tx.parcelBatchOrder.findFirst({
    where: { merchant_order_id: orderId, active: true, parcel_batch: { status: { in: [...OPEN_BATCH_STATUSES] } } },
    select: { parcel_batch: { select: { id: true, merchant_order_id: true } } },
    orderBy: { created_at: "desc" },
  });
  if (membership) return membership.parcel_batch;
  // Batches from before memberships were recorded hang off their lead order only.
  return tx.parcelBatch.findFirst({
    where: { merchant_order_id: orderId, status: { in: [...OPEN_BATCH_STATUSES] } },
    select: { id: true, merchant_order_id: true },
    orderBy: { created_at: "desc" },
  });
}
