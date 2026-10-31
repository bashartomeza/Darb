import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { auditEvent } from "../lib/audit.js";
import { lockedCorridorDistanceKm, round, toNumber } from "../lib/geo.js";
import { BATCHING_LIMITS, type ParcelSize } from "../lib/batchingConfig.js";
import { planBatches } from "../services/batchPlanner.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { LOCKED_CORRIDOR_KEY, LOCKED_CORRIDOR_LABEL } from "./demoReset.js";
import { AuditAction } from "../generated/prisma/enums.js";

export const batchingRouter = Router();

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_route_param");
  return value;
}

export async function createParcelBatch(req: AuthenticatedRequest, orderId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.merchantOrder.findUnique({
      where: { id: orderId },
      include: {
        parcels: true,
        parcel_batches: { select: { id: true, status: true }, orderBy: { created_at: "desc" }, take: 20 },
        batch_members: { select: { parcel_batch_id: true, active: true }, orderBy: { created_at: "desc" }, take: 20 }
      }
    });
    if (!order) throw new HttpError(404, "order_not_found");
    if (req.user!.role !== "admin" && (req.user!.role !== "merchant" || order.merchant_id !== req.user!.id)) {
      throw new HttpError(403, "forbidden");
    }
    if (order.canonical_entry_version) throw new HttpError(409, "canonical_batching_not_enabled");
    if (order.parcels.length < 1 || order.parcels.length > BATCHING_LIMITS.maxParcelsPerOrder) throw new HttpError(400, "invalid_parcel_count");
    const hasActiveBatch = order.parcel_batches.some((batch) => !["cancelled", "failed", "expired"].includes(batch.status));
    const hasActiveBatchMembership = order.batch_members.some((member) => member.active);
    if (hasActiveBatch || hasActiveBatchMembership) throw new HttpError(409, "order_already_batched");
    if (order.status !== "submitted") throw new HttpError(409, "order_not_batchable");

    // A compatible batch keeps one merchant's pickup point and groups real,
    // still-submitted orders whose dropoffs lie close together along the route
    // and fit one driver's capacity. Further orders form separate batches.
    // No synthetic orders are ever created.
    const pool = await tx.merchantOrder.findMany({
      where: {
        merchant_id: order.merchant_id,
        status: "submitted",
        canonical_entry_version: null,
        parcel_batches: { none: { status: { notIn: ["cancelled", "failed", "expired"] } } },
        batch_members: { none: { active: true } },
        parcels: { some: {} }
      },
      include: { parcels: true },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
      take: BATCHING_LIMITS.maxOrdersPerBatch * 2
    });
    const candidates = [order, ...pool.filter((candidate) => candidate.id !== order.id)];
    const plan = planBatches(
      candidates.map((candidate) => ({
        id: candidate.id,
        pickup: { lat: toNumber(candidate.pickup_lat), lng: toNumber(candidate.pickup_lng) },
        parcels: candidate.parcels.map((parcel) => ({
          lat: toNumber(parcel.destination_lat),
          lng: toNumber(parcel.destination_lng),
          size: (parcel.size === "L" || parcel.size === "M" ? parcel.size : "S") as ParcelSize
        }))
      })),
      undefined,
      { seedId: order.id }
    );
    const planned = plan.batches.find((candidate) => candidate.order_ids.includes(order.id));
    if (!planned) throw new HttpError(400, "order_exceeds_batch_capacity");
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const selectedOrders = planned.order_ids.map((id) => byId.get(id)!);
    const parcelCount = planned.parcel_count;
    if (selectedOrders.length < 1 || parcelCount < 1) throw new HttpError(400, "invalid_batch_contents");

    const corridorKm = lockedCorridorDistanceKm();
    const estimatedDistanceSaved = round(Math.max(0, parcelCount * corridorKm - corridorKm), 2);
    const orderWord = selectedOrders.length === 1 ? "order" : "orders";
    const explanation =
      `${selectedOrders.length} compatible merchant ${orderWord} with ${parcelCount} parcels share the ` +
      `${LOCKED_CORRIDOR_LABEL} pickup corridor and can be assigned together to one driver capacity allocation.`;

    const orderIds = selectedOrders.map((candidate) => candidate.id);
    const claimed = await tx.merchantOrder.updateMany({
      where: { id: { in: orderIds }, merchant_id: order.merchant_id, canonical_entry_version: null, status: "submitted" },
      data: { status: "batched" }
    });
    if (claimed.count !== orderIds.length) throw new HttpError(409, "order_not_batchable");

    let batch;
    try {
      batch = await tx.parcelBatch.create({
        data: {
          merchant_order_id: order.id,
          status: "created",
          estimated_distance_saved: estimatedDistanceSaved.toFixed(2),
          explanation,
          members: {
            create: selectedOrders.map((candidate) => ({
              merchant_order_id: candidate.id,
              active: true,
              active_membership_key: candidate.id
            }))
          }
        },
        include: {
          merchant_order: { include: { parcels: true } },
          driver_route: true,
          members: { include: { merchant_order: { select: { id: true, merchant_id: true, pickup_label: true, status: true } } } }
        }
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw new HttpError(409, "order_already_batched");
      }
      throw error;
    }

    await tx.parcel.updateMany({ where: { order_id: { in: orderIds }, status: "pending" }, data: { status: "batched", batch_id: batch.id } });

    await auditEvent(tx, {
      userId: req.user!.id,
      action: AuditAction.parcel_batch_created,
      entityType: "ParcelBatch",
      entityId: batch.id,
      metadata: { parcel_count: parcelCount, merchant_order_count: selectedOrders.length, estimated_distance_saved: estimatedDistanceSaved }
    });

    return { batch, orderIds };
  });

  return result.batch;
}

batchingRouter.post("/merchant/orders/:id/batch", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (req.user!.role !== "merchant" && req.user!.role !== "admin") throw new HttpError(403, "forbidden");
    const batch = await createParcelBatch(req, routeParam(req.params.id));
    res.status(201).json({ batch });
  } catch (error) {
    next(error);
  }
});
