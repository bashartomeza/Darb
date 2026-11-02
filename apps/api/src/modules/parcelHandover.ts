import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { auditEvent } from "../lib/audit.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { describeHandover, issueHandover } from "../services/deliveryHandover.js";

/**
 * The sender's side of the receiver handover code. It works for any parcel order, whoever
 * placed it: the order's owner (merchant_id, which also holds a passenger sender's user id)
 * and admins may look; only the owner may re-issue the code.
 */
export const parcelHandoverRouter = Router();

const CLOSED_ORDER_STATUSES = ["delivered", "completed", "cancelled", "failed", "expired"];

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_route_param");
  return value;
}

async function loadOrder(orderId: string, req: AuthenticatedRequest) {
  const order = await prisma.merchantOrder.findUnique({
    where: { id: orderId },
    select: { id: true, merchant_id: true, status: true, delivery_handover: true }
  });
  if (!order) throw new HttpError(404, "order_not_found");
  const isOwner = order.merchant_id === req.user!.id;
  if (!isOwner && req.user!.role !== "admin") throw new HttpError(404, "order_not_found");
  return { order, isOwner };
}

parcelHandoverRouter.get("/parcel-orders/:id/handover", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { order } = await loadOrder(routeParam(req.params.id), req);
    res.json({ handover: describeHandover(order.delivery_handover) });
  } catch (error) {
    next(error);
  }
});

// Issues a code for an order that has none, or replaces the current one (for example after
// five wrong guesses locked it, or when the sender lost it). The code is returned once.
parcelHandoverRouter.post("/parcel-orders/:id/handover/regenerate", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { order, isOwner } = await loadOrder(routeParam(req.params.id), req);
    if (!isOwner) throw new HttpError(403, "forbidden");
    if (CLOSED_ORDER_STATUSES.includes(order.status)) throw new HttpError(409, "order_not_active");
    const issued = await prisma.$transaction(async (tx) => {
      const result = await issueHandover(tx, order.id);
      await auditEvent(tx, {
        userId: req.user!.id,
        action: AuditAction.admin_action,
        entityType: "MerchantOrder",
        entityId: order.id,
        metadata: { action: "delivery_handover_code_issued" }
      });
      return result;
    });
    const row = await prisma.deliveryHandover.findUnique({ where: { merchant_order_id: order.id } });
    res.json({ handover: { ...describeHandover(row), code: issued.code } });
  } catch (error) {
    next(error);
  }
});
