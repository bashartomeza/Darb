import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import { Prisma } from "../generated/prisma/client.js";
import { auditEvent } from "../lib/audit.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { releaseLegacyCapacity } from "../services/legacyCapacity.js";
import { describeHandover, issueHandover } from "../services/deliveryHandover.js";
import { latitudeSchema, longitudeSchema } from "../lib/validation.js";
import { BATCHING_LIMITS } from "../lib/batchingConfig.js";

export const parcelSchema = z.object({
  destination_label: z.string().min(1),
  destination_lat: latitudeSchema,
  destination_lng: longitudeSchema,
  size: z.enum(["S", "M", "L"]),
  priority: z.enum(["low", "normal", "high"]).default("normal")
});

export const createOrderSchema = z.object({
  pickup_label: z.string().min(1),
  pickup_lat: latitudeSchema,
  pickup_lng: longitudeSchema,
  parcels: z.array(parcelSchema).min(1).max(BATCHING_LIMITS.maxParcelsPerOrder)
});

export const MERCHANT_CREATE_OPERATION = "legacy_merchant_order_create_v1";
const MERCHANT_CREATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const merchantCreateIdempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);
export const merchantCreateDigest = (value: string) => createHash("sha256").update(value).digest("hex");

export const merchantRouter = Router();

function serializeLegacyParcel(value: Record<string, unknown>) {
  return {
    id: value.id,
    order_id: value.order_id,
    destination_label: value.destination_label,
    destination_lat: value.destination_lat,
    destination_lng: value.destination_lng,
    size: value.size,
    priority: value.priority,
    status: value.status,
    batch_id: value.batch_id
  };
}

function serializeLegacyBatch(value: Record<string, unknown>) {
  const members = Array.isArray(value.members)
    ? value.members.map((member) => {
        const order = (member as Record<string, unknown>).merchant_order as Record<string, unknown> | undefined;
        return order
          ? {
              id: order.id,
              merchant_id: order.merchant_id,
              pickup_label: order.pickup_label,
              status: order.status,
              parcel_count: (order._count as Record<string, unknown> | undefined)?.parcels ?? 0,
              created_at: order.created_at
            }
          : { merchant_order_id: (member as Record<string, unknown>).merchant_order_id };
      })
    : [];
  const trips = Array.isArray(value.trips) ? value.trips : [];
  const trip = trips.length > 0 ? trips[0] : null;
  return {
    id: value.id,
    merchant_order_id: value.merchant_order_id,
    status: value.status,
    estimated_distance_saved: value.estimated_distance_saved,
    explanation: value.explanation,
    created_at: value.created_at,
    driver_route: value.driver_route,
    member_orders: members,
    order_count: members.length || 1,
    trip_id: trip && typeof trip === "object" ? (trip as Record<string, unknown>).id : null,
    trip_status: trip && typeof trip === "object" ? (trip as Record<string, unknown>).status : null
  };
}

function serializeLegacyMerchantOrder(value: Record<string, unknown>) {
  const directBatches = Array.isArray(value.parcel_batches) ? value.parcel_batches : [];
  const memberBatches = Array.isArray(value.batch_members)
    ? value.batch_members
        .map((member) => (member as Record<string, unknown>).parcel_batch)
        .filter((batch): batch is Record<string, unknown> => Boolean(batch) && typeof batch === "object")
    : [];
  const rawBatches = [...directBatches, ...memberBatches];
  const seen = new Set<string>();
  const batches = rawBatches
    .map((batch) => serializeLegacyBatch(batch as Record<string, unknown>))
    .filter((batch) => {
      if (typeof batch.id !== "string" || seen.has(batch.id)) return false;
      seen.add(batch.id);
      return true;
    });
  const latestBatch = batches[0];
  const tripId = latestBatch?.trip_id ?? null;
  const tripStatus = latestBatch?.trip_status ?? null;
  return {
    id: value.id,
    merchant_id: value.merchant_id,
    pickup_label: value.pickup_label,
    pickup_lat: value.pickup_lat,
    pickup_lng: value.pickup_lng,
    status: value.status,
    created_at: value.created_at,
    trip_id: tripId,
    trip_status: tripStatus,
    parcels: Array.isArray(value.parcels)
      ? value.parcels.map((parcel) => serializeLegacyParcel(parcel as Record<string, unknown>))
      : undefined,
    // Confirmation state only; the code itself is shown once, when it is issued.
    handover: describeHandover((value.delivery_handover ?? null) as Parameters<typeof describeHandover>[0]),
    parcel_batches: batches
  };
}

const merchantOrderInclude = {
  parcels: true,
  delivery_handover: true,
  parcel_batches: {
    select: {
      id: true,
      status: true,
      estimated_distance_saved: true,
      explanation: true,
      created_at: true,
      driver_route: {
        select: {
          id: true,
          origin_label: true,
          destination_label: true,
          corridor_key: true,
          status: true,
          parcel_capacity_available: true
        }
      },
      trips: {
        select: { id: true, status: true, created_at: true },
        orderBy: { created_at: "desc" as const },
        take: 1
      },
      members: {
        select: {
          merchant_order: {
            select: {
              id: true,
              merchant_id: true,
              pickup_label: true,
              status: true,
              created_at: true,
              _count: { select: { parcels: true } }
            }
          }
        },
        orderBy: { created_at: "asc" as const }
      }
    },
    orderBy: { created_at: "desc" as const }
  },
  batch_members: {
    select: {
      parcel_batch_id: true,
      created_at: true,
      parcel_batch: {
        select: {
          id: true,
          status: true,
          estimated_distance_saved: true,
          explanation: true,
          created_at: true,
          driver_route: {
            select: {
              id: true,
              origin_label: true,
              destination_label: true,
              corridor_key: true,
              status: true,
              parcel_capacity_available: true
            }
          },
          trips: {
            select: { id: true, status: true, created_at: true },
            orderBy: { created_at: "desc" as const },
            take: 1
          },
          members: {
            select: { merchant_order_id: true },
            orderBy: { created_at: "asc" as const }
          }
        }
      }
    },
    orderBy: { created_at: "desc" as const },
    take: 1
  }
};

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_route_param");
  }
  return value;
}

merchantRouter.use("/merchant", requireAuth, requireRole("merchant"));

// Read-only reconciliation remains safe even after the client's mutation window.
// Keep the operation key in a header, outside URL/access-log paths.
merchantRouter.get("/merchant/order-operation", async (req: AuthenticatedRequest, res, next) => {
  try {
    const key = merchantCreateIdempotencyKey.parse(req.header("idempotency-key"));
    const record = await prisma.idempotencyRecord.findUnique({
      where: { operation_scope_digest_idempotency_key_key_version: {
        operation: MERCHANT_CREATE_OPERATION,
        scope_digest: merchantCreateDigest(`${MERCHANT_CREATE_OPERATION}:${req.user!.id}`),
        idempotency_key: merchantCreateDigest(key), key_version: 1
      } }
    });
    if (!record) throw new HttpError(404, "merchant_order_operation_not_found");
    if (record.state !== "completed" || record.resource_type !== "MerchantOrder" || !record.resource_id) {
      throw new HttpError(409, "idempotency_replay_unavailable");
    }
    const order = await prisma.merchantOrder.findFirst({
      where: { id: record.resource_id, merchant_id: req.user!.id, canonical_entry_version: null },
      include: { parcels: true, delivery_handover: true }
    });
    if (!order) throw new HttpError(409, "idempotency_replay_unavailable");
    res.json({ order: serializeLegacyMerchantOrder(order as unknown as Record<string, unknown>), replayed: true });
  } catch (error) { next(error); }
});

/**
 * The one merchant order creation path. The single-order endpoint and the bulk
 * upload both call it, so validation shape, idempotency, audit and the
 * transaction isolation level cannot diverge.
 */
export async function createLegacyMerchantOrder(
  userId: string,
  input: z.infer<typeof createOrderSchema>,
  key: string | undefined
) {
  const normalized = {
    pickup_label: input.pickup_label,
    pickup_lat: input.pickup_lat.toFixed(6),
    pickup_lng: input.pickup_lng.toFixed(6),
    parcels: input.parcels.map((parcel) => ({
      destination_label: parcel.destination_label,
      destination_lat: parcel.destination_lat.toFixed(6),
      destination_lng: parcel.destination_lng.toFixed(6),
      size: parcel.size,
      priority: parcel.priority
    }))
  };
  const result = await prisma.$transaction(async (tx) => {
    const claim = key === undefined ? undefined : await claimIdempotency(tx, {
      operation: MERCHANT_CREATE_OPERATION,
      scopeDigest: merchantCreateDigest(`${MERCHANT_CREATE_OPERATION}:${userId}`),
      keyDigest: merchantCreateDigest(key),
      keyVersion: 1,
      requestDigest: merchantCreateDigest(JSON.stringify(normalized)),
      preserveCompleted: true,
      // Completed keys are never reclaimed into a different order. Mobile
      // creation retries stop at seven days; older recovery uses read-only lookup.
      expiresAt: new Date(Date.now() + MERCHANT_CREATE_RETENTION_MS)
    });
    if (claim?.kind === "conflict") throw new HttpError(409, "idempotency_conflict");
    if (claim?.kind === "failed") throw new HttpError(409, "idempotency_failed");
    if (claim?.kind === "in_progress") throw new HttpError(409, "idempotency_in_progress");
    if (claim?.kind === "replay") {
      if (claim.record.resource_type !== "MerchantOrder" || !claim.record.resource_id) {
        throw new HttpError(409, "idempotency_replay_unavailable");
      }
      const original = await tx.merchantOrder.findFirst({
        where: { id: claim.record.resource_id, merchant_id: userId, canonical_entry_version: null },
        include: { parcels: true, delivery_handover: true }
      });
      if (!original) throw new HttpError(409, "idempotency_replay_unavailable");
      return { order: original, replayed: true, handoverCode: null as string | null };
    }

    const created = await tx.merchantOrder.create({
      data: {
        merchant_id: userId,
        pickup_label: normalized.pickup_label,
        pickup_lat: normalized.pickup_lat,
        pickup_lng: normalized.pickup_lng,
        status: "submitted",
        parcels: {
          create: normalized.parcels.map((parcel) => ({
            ...parcel,
            status: "pending" as const
          }))
        }
      },
      include: { parcels: true, delivery_handover: true }
    });
    // The receiver's handover code; the sender passes it on, the driver enters it at delivery.
    const handover = await issueHandover(tx, created.id);
    const order = { ...created, delivery_handover: await tx.deliveryHandover.findUnique({ where: { merchant_order_id: created.id } }) };
    await auditEvent(tx, {
      userId,
      action: AuditAction.merchant_order_created,
      entityType: "MerchantOrder",
      entityId: order.id,
      metadata: { parcel_count: order.parcels.length }
    });
    if (claim?.kind === "claimed") {
      await completeIdempotency(tx, {
        recordId: claim.record.id,
        claimVersion: claim.record.claim_version,
        resourceType: "MerchantOrder",
        resourceId: order.id,
        responseStatus: 201
      });
    }
    return { order, replayed: false, handoverCode: handover.code };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return result;
}

merchantRouter.post("/merchant/orders", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = createOrderSchema.parse(req.body);
    // Old clients without an Idempotency-Key remain supported; new clients send
    // one durable key per user-confirmed order to obtain replay-safe creation.
    const rawKey = req.header("idempotency-key");
    const key = rawKey === undefined ? undefined : merchantCreateIdempotencyKey.parse(rawKey);
    const result = await createLegacyMerchantOrder(req.user!.id, input, key);
    const serialized = serializeLegacyMerchantOrder(result.order as unknown as Record<string, unknown>);
    res.status(result.replayed ? 200 : 201).json({
      order: result.handoverCode ? { ...serialized, handover: { ...serialized.handover, code: result.handoverCode } } : serialized,
      ...(key === undefined ? {} : { replayed: result.replayed })
    });
  } catch (error) {
    next(error && typeof error === "object" && "code" in error && error.code === "P2034"
      ? new HttpError(409, "transaction_retry_required") : error);
  }
});

merchantRouter.patch("/merchant/orders/:id/cancel", async (req: AuthenticatedRequest, res, next) => {
  try {
    const orderId = routeParam(req.params.id);
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.merchantOrder.findFirst({
        where: { id: orderId, merchant_id: req.user!.id, canonical_entry_version: null },
        include: {
          parcels: true,
          parcel_batches: { select: { id: true, driver_route_id: true, status: true }, orderBy: { created_at: "desc" }, take: 1 },
          batch_members: {
            where: { active: true },
            select: { parcel_batch_id: true, parcel_batch: { select: { id: true, driver_route_id: true, status: true } } },
            take: 1
          }
        }
      });
      if (!order) throw new HttpError(404, "order_not_found");
      if (!["submitted", "batched", "matched"].includes(order.status)) {
        throw new HttpError(409, "order_cannot_be_cancelled");
      }
      const batch = order.parcel_batches[0] ?? order.batch_members[0]?.parcel_batch ?? null;
      if (batch) {
        const members = await tx.parcelBatchOrder.findMany({ where: { parcel_batch_id: batch.id }, select: { merchant_order_id: true } });
        const ids = [...new Set([order.id, ...members.map((member) => member.merchant_order_id)])];
        // A current write claim serializes cancellation with matching/acceptance,
        // including cancellation through a secondary order in the same batch.
        const claimed = await tx.merchantOrder.updateMany({
          where: { id: { in: ids }, merchant_id: req.user!.id, canonical_entry_version: null, status: order.status },
          data: { status: "cancelled" }
        });
        if (claimed.count !== ids.length) throw new HttpError(409, "order_cannot_be_cancelled");
        const activeMatches = await tx.match.findMany({
          where: { parcel_batch_id: batch.id, operational_mode: "legacy", status: { in: ["proposed", "sent_to_driver"] } },
          select: { id: true, driver_route_id: true, legacy_capacity_held: true }
        });
        const reservedParcelUnits = await tx.parcel.count({
          where: { batch_id: batch.id, status: { notIn: ["cancelled", "failed", "expired"] } }
        });
        if (reservedParcelUnits > 0) {
          const routeIds = new Set(activeMatches.filter((match) => match.legacy_capacity_held).map((match) => match.driver_route_id));
          for (const routeId of routeIds) {
            await releaseLegacyCapacity(tx, {
              driverRouteId: routeId,
              seats: 0,
              parcelUnits: reservedParcelUnits
            });
          }
        }
        await tx.match.updateMany({
          where: { id: { in: activeMatches.map((match) => match.id) } },
          data: { status: "invalidated", legacy_demand_key: null, legacy_capacity_held: false }
        });
        await tx.parcelBatch.update({ where: { id: batch.id }, data: { status: "cancelled", driver_route_id: null } });
        await tx.parcelBatchOrder.updateMany({ where: { parcel_batch_id: batch.id }, data: { active: false, active_membership_key: null } });
        await tx.parcel.updateMany({ where: { batch_id: batch.id }, data: { status: "cancelled" } });
      } else {
        const claimed = await tx.merchantOrder.updateMany({
          where: { id: order.id, merchant_id: req.user!.id, canonical_entry_version: null, status: order.status },
          data: { status: "cancelled" }
        });
        if (claimed.count !== 1) throw new HttpError(409, "order_cannot_be_cancelled");
        const activeMatches = await tx.match.findMany({
          where: { merchant_order_id: order.id, operational_mode: "legacy", status: { in: ["proposed", "sent_to_driver"] } },
          select: { id: true, driver_route_id: true, legacy_capacity_held: true }
        });
        const reservedParcelUnits = await tx.parcel.count({
          where: { order_id: order.id, status: { notIn: ["cancelled", "failed", "expired"] } }
        });
        if (reservedParcelUnits > 0) {
          const routeIds = new Set(activeMatches.filter((match) => match.legacy_capacity_held).map((match) => match.driver_route_id));
          for (const routeId of routeIds) {
            await releaseLegacyCapacity(tx, {
              driverRouteId: routeId,
              seats: 0,
              parcelUnits: reservedParcelUnits
            });
          }
        }
        await tx.match.updateMany({
          where: { id: { in: activeMatches.map((match) => match.id) } },
          data: { status: "invalidated", legacy_demand_key: null, legacy_capacity_held: false }
        });
        await tx.parcel.updateMany({ where: { order_id: order.id }, data: { status: "cancelled" } });
        await tx.merchantOrder.update({ where: { id: order.id }, data: { status: "cancelled" } });
      }
      await auditEvent(tx, {
        userId: req.user!.id,
        action: AuditAction.admin_action,
        entityType: "MerchantOrder",
        entityId: order.id,
        metadata: { action: "merchant_order_cancelled" }
      });
      return tx.merchantOrder.findUniqueOrThrow({ where: { id: order.id }, include: merchantOrderInclude });
    }, { isolationLevel: "ReadCommitted" });
    res.json({ order: serializeLegacyMerchantOrder(result as unknown as Record<string, unknown>) });
  } catch (error) {
    next(error);
  }
});

merchantRouter.get("/merchant/orders", async (req: AuthenticatedRequest, res, next) => {
  try {
    const orders = await prisma.merchantOrder.findMany({
      where: { merchant_id: req.user!.id, canonical_entry_version: null },
      include: merchantOrderInclude,
      orderBy: { created_at: "desc" }
    });
    res.json({ orders: orders.map((order) => serializeLegacyMerchantOrder(order as unknown as Record<string, unknown>)) });
  } catch (error) {
    next(error);
  }
});

merchantRouter.get("/merchant/orders/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const orderId = routeParam(req.params.id);
    const order = await prisma.merchantOrder.findFirst({
      where: { id: orderId, merchant_id: req.user!.id, canonical_entry_version: null },
      include: merchantOrderInclude
    });
    if (!order) {
      throw new HttpError(404, "order_not_found");
    }
    res.json({ order: serializeLegacyMerchantOrder(order as unknown as Record<string, unknown>) });
  } catch (error) {
    next(error);
  }
});
