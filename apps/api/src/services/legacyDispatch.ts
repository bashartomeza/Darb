import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { AuditAction, MatchStatus } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { releaseLegacyCapacity } from "./legacyCapacity.js";
import { OPEN_LEGACY_ORDER_STATUSES } from "./legacyOrderClosure.js";
import { cancelMerchantOrder, cancelPassengerRequest, NO_DRIVER_REASON, SYSTEM_ACTOR } from "./cancellations.js";
import { config } from "../config.js";

const LEGACY_MATCH_TERMINAL_BATCH_STATUSES = ["cancelled", "failed", "expired"] as const;


async function expireMatch(tx: Prisma.TransactionClient, matchId: string, now: Date) {
  const match = await tx.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      driver_route_id: true,
      passenger_request_id: true,
      merchant_order_id: true,
      parcel_batch_id: true,
      legacy_capacity_held: true,
      status: true,
      expires_at: true,
      operational_mode: true,
      canonical_match_version: true,
    },
  });
  if (!match || match.operational_mode !== "legacy" || match.canonical_match_version || !match.expires_at || match.expires_at > now) {
    return false;
  }
  if (match.status !== MatchStatus.proposed && match.status !== MatchStatus.sent_to_driver) return false;

  const changed = await tx.match.updateMany({
    where: {
      id: match.id,
      operational_mode: "legacy",
      status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver] },
      expires_at: { lte: now },
    },
    data: {
      status: MatchStatus.expired,
      expired_at: now,
      legacy_demand_key: null,
      legacy_capacity_held: false,
    },
  });
  if (changed.count !== 1) return false;

  if (match.legacy_capacity_held) {
    let seats = 0;
    if (match.passenger_request_id) {
      const request = await tx.passengerRequest.findUnique({ where: { id: match.passenger_request_id }, select: { passenger_count: true } });
      seats = request?.passenger_count ?? 0;
    }
    const parcelUnits = match.parcel_batch_id
      ? await tx.parcel.count({ where: { batch_id: match.parcel_batch_id, status: { notIn: [...LEGACY_MATCH_TERMINAL_BATCH_STATUSES] } } })
      : match.merchant_order_id
        ? await tx.parcel.count({ where: { order_id: match.merchant_order_id, status: { notIn: [...LEGACY_MATCH_TERMINAL_BATCH_STATUSES] } } })
        : 0;
    if (seats || parcelUnits) {
      await releaseLegacyCapacity(tx, { driverRouteId: match.driver_route_id, seats, parcelUnits });
    }
  }

  if (match.passenger_request_id) {
    await tx.passengerRequest.updateMany({
      where: { id: match.passenger_request_id, status: "matched" },
      data: { status: "pending" },
    });
  }

  if (match.parcel_batch_id) {
    const members = await tx.parcelBatchOrder.findMany({ where: { parcel_batch_id: match.parcel_batch_id }, select: { merchant_order_id: true } });
    const orderIds = members.map((member) => member.merchant_order_id);
    if (orderIds.length) {
      await tx.merchantOrder.updateMany({ where: { id: { in: orderIds }, status: "matched" }, data: { status: "batched" } });
    }
    await tx.parcelBatch.updateMany({
      where: { id: match.parcel_batch_id, status: "proposed" },
      data: { driver_route_id: null, status: "created" },
    });
  } else if (match.merchant_order_id) {
    await tx.merchantOrder.updateMany({
      where: { id: match.merchant_order_id, status: "matched" },
      data: { status: "submitted" },
    });
  }

  await auditEvent(tx, {
    action: AuditAction.match_decision,
    entityType: "Match",
    entityId: match.id,
    metadata: { transition: "expired", worker: "legacy-dispatch" },
  });
  return true;
}

export async function expireLegacyDispatches(
  db: PrismaClient = prisma,
  options: { now?: Date; limit?: number; autoCancelMinutes?: number } = {},
) {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  let matchesExpired = 0;
  let requestsCancelled = 0;
  let ordersCancelled = 0;

  const matches = await db.match.findMany({
    where: {
      operational_mode: "legacy",
      canonical_match_version: null,
      status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver] },
      expires_at: { lte: now },
    },
    select: { id: true },
    orderBy: { expires_at: "asc" },
    take: limit,
  });

  for (const match of matches) {
    const expired = await db.$transaction((tx) => expireMatch(tx, match.id, now));
    if (expired) matchesExpired += 1;
  }

  // Automatic cancellation. A ride request, order or parcel that no driver has accepted is cancelled
  // ORDER_AUTO_CANCEL_MINUTES after its reference time: the booked time when that is later than
  // when it was created, otherwise the creation time. The same cancellation as a person's runs
  // (services/cancellations.ts): pending offers are withdrawn, held capacity is freed once, and
  // the owner and any driver who was offered it are notified. A request or order that shares a
  // batch leaves it alone; the rest of the batch stays together.
  const minutes = options.autoCancelMinutes ?? config.orderAutoCancelMinutes;
  const cutoff = new Date(now.getTime() - minutes * 60_000);

  const overdueRequests = await db.passengerRequest.findMany({
    where: {
      operational_mode: "legacy",
      canonical_entry_version: null,
      status: { in: ["pending", "matched"] },
      created_at: { lte: cutoff },
      preferred_time: { lte: cutoff },
    },
    select: { id: true },
    orderBy: { created_at: "asc" },
    take: limit,
  });
  for (const request of overdueRequests) {
    if (await autoCancel((tx) => cancelPassengerRequest(tx, { requestId: request.id, actor: SYSTEM_ACTOR, reason: NO_DRIVER_REASON }))) {
      requestsCancelled += 1;
    }
  }

  const overdueOrders = await db.merchantOrder.findMany({
    where: {
      operational_mode: "legacy",
      canonical_entry_version: null,
      status: { in: [...OPEN_LEGACY_ORDER_STATUSES] },
      created_at: { lte: cutoff },
      OR: [{ requested_departure_from: null }, { requested_departure_from: { lte: cutoff } }],
    },
    select: { id: true },
    orderBy: { created_at: "asc" },
    take: limit,
  });
  for (const order of overdueOrders) {
    if (await autoCancel((tx) => cancelMerchantOrder(tx, { orderId: order.id, actor: SYSTEM_ACTOR, reason: NO_DRIVER_REASON, now }))) {
      ordersCancelled += 1;
    }
  }

  return { matchesExpired, requestsCancelled, ordersCancelled };

  /** Runs one cancellation in its own transaction; false when the item changed state first. */
  async function autoCancel(run: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    try {
      // Read committed, like manual cancellation: reads after the claim and the batch lock
      // see what concurrent closes committed.
      await db.$transaction(run, { isolationLevel: "ReadCommitted" });
      return true;
    } catch (error) {
      // Accepted, cancelled or matched elsewhere in the meantime: nothing to cancel any more.
      if (error instanceof HttpError && (error.statusCode === 404 || error.statusCode === 409)) return false;
      throw error;
    }
  }
}
