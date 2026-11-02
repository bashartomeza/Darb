import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { AuditAction, MatchStatus } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";
import { releaseLegacyCapacity } from "./legacyCapacity.js";

const LEGACY_MATCH_TERMINAL_BATCH_STATUSES = ["cancelled", "failed", "expired"] as const;

async function releaseMatchCapacity(tx: Prisma.TransactionClient, match: {
  id: string;
  driver_route_id: string;
  passenger_request_id: string | null;
  merchant_order_id: string | null;
  parcel_batch_id: string | null;
  legacy_capacity_held: boolean;
}) {
  if (!match.legacy_capacity_held) return;
  let seats = 0;
  if (match.passenger_request_id) {
    const request = await tx.passengerRequest.findUnique({
      where: { id: match.passenger_request_id },
      select: { passenger_count: true },
    });
    seats = request?.passenger_count ?? 0;
  }
  let parcelUnits = 0;
  if (match.parcel_batch_id) {
    parcelUnits = await tx.parcel.count({
      where: { batch_id: match.parcel_batch_id, status: { notIn: [...LEGACY_MATCH_TERMINAL_BATCH_STATUSES] } },
    });
  } else if (match.merchant_order_id) {
    parcelUnits = await tx.parcel.count({
      where: { order_id: match.merchant_order_id, status: { notIn: [...LEGACY_MATCH_TERMINAL_BATCH_STATUSES] } },
    });
  }
  if (seats || parcelUnits) {
    await releaseLegacyCapacity(tx, {
      driverRouteId: match.driver_route_id,
      seats,
      parcelUnits,
    });
  }
}

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
  options: { now?: Date; limit?: number } = {},
) {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  let matchesExpired = 0;
  let requestsExpired = 0;
  let ordersExpired = 0;

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

  const overdueRequests = await db.passengerRequest.findMany({
    where: {
      operational_mode: "legacy",
      canonical_entry_version: null,
      status: { in: ["pending", "matched"] },
      preferred_time: { lte: now },
    },
    select: { id: true },
    orderBy: { preferred_time: "asc" },
    take: limit,
  });

  for (const request of overdueRequests) {
    const expired = await db.$transaction(async (tx) => {
      const activeMatches = await tx.match.findMany({
        where: {
          passenger_request_id: request.id,
          operational_mode: "legacy",
          status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver] },
        },
        select: {
          id: true,
          driver_route_id: true,
          passenger_request_id: true,
          merchant_order_id: true,
          parcel_batch_id: true,
          legacy_capacity_held: true,
        },
      });
      for (const match of activeMatches) {
        const changed = await tx.match.updateMany({
          where: { id: match.id, status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver] } },
          data: { status: MatchStatus.expired, expired_at: now, legacy_demand_key: null, legacy_capacity_held: false },
        });
        if (changed.count === 1 && match.legacy_capacity_held) {
          await releaseMatchCapacity(tx, { ...match, id: match.id });
        }
      }
      const changedRequest = await tx.passengerRequest.updateMany({
        where: { id: request.id, status: { in: ["pending", "matched"] } },
        data: { status: "expired" },
      });
      if (changedRequest.count !== 1) return false;
      await auditEvent(tx, {
        action: AuditAction.passenger_request_cancelled,
        entityType: "PassengerRequest",
        entityId: request.id,
        metadata: { transition: "expired", worker: "legacy-dispatch" },
      });
      return true;
    });
    if (expired) requestsExpired += 1;
  }

  const overdueOrders = await db.merchantOrder.findMany({
    where: {
      operational_mode: "legacy",
      canonical_entry_version: null,
      status: { in: ["submitted", "batched", "matched"] },
      requested_departure_until: { not: null, lte: now },
    },
    select: { id: true },
    orderBy: { requested_departure_until: "asc" },
    take: limit,
  });

  for (const order of overdueOrders) {
    const expired = await db.$transaction(async (tx) => {
      const batches = await tx.parcelBatch.findMany({ where: { merchant_order_id: order.id }, select: { id: true, driver_route_id: true } });
      const memberBatches = await tx.parcelBatchOrder.findMany({ where: { merchant_order_id: order.id, active: true }, select: { parcel_batch_id: true } });
      const batchIds = [...new Set([...batches.map((b) => b.id), ...memberBatches.map((b) => b.parcel_batch_id)])];
      for (const batchId of batchIds) {
        const activeMatches = await tx.match.findMany({
          where: { parcel_batch_id: batchId, operational_mode: "legacy", status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver] } },
          select: { id: true, driver_route_id: true, passenger_request_id: true, merchant_order_id: true, parcel_batch_id: true, legacy_capacity_held: true },
        });
        for (const match of activeMatches) {
          const changed = await tx.match.updateMany({ where: { id: match.id, status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver] } }, data: { status: MatchStatus.expired, expired_at: now, legacy_demand_key: null, legacy_capacity_held: false } });
          if (changed.count === 1 && match.legacy_capacity_held) await releaseMatchCapacity(tx, { ...match, id: match.id });
        }
        await tx.parcelBatch.update({ where: { id: batchId }, data: { status: "expired", driver_route_id: null } });
        await tx.parcelBatchOrder.updateMany({ where: { parcel_batch_id: batchId, active: true }, data: { active: false, active_membership_key: null } });
        await tx.parcel.updateMany({ where: { batch_id: batchId }, data: { status: "expired" } });
      }
      const changed = await tx.merchantOrder.updateMany({ where: { id: order.id, status: { in: ["submitted", "batched", "matched"] } }, data: { status: "expired" } });
      if (changed.count !== 1) return false;
      await tx.parcel.updateMany({ where: { order_id: order.id, status: { in: ["pending", "batched"] } }, data: { status: "expired" } });
      return true;
    });
    if (expired) ordersExpired += 1;
  }

  return { matchesExpired, requestsExpired, ordersExpired };
}
