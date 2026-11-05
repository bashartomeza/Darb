import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { recomputeTrustForTrip } from "../services/driverTrust.js";
import { CANCEL_ACTOR_ROLES, ALL_CANCEL_REASON_CODES, CANCEL_REASONS, cancelBodySchema } from "../services/cancellationReasons.js";
import { adminCancelTrip, cancelMerchantOrder, cancelPassengerRequest } from "../services/cancellations.js";

/**
 * Administrator cancellations (any unfinished request, order or trip, with a reason) and
 * the cancellation history.
 */
export const adminCancellationsRouter = Router();
adminCancellationsRouter.use(
  ["/admin/cancellations", "/admin/requests", "/admin/orders", "/admin/trips/:id/cancel"],
  requireAuth,
  requireRole("admin")
);

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_route_param");
  return value;
}

function retryable(error: unknown) {
  return error && typeof error === "object" && "code" in error && error.code === "P2034"
    ? new HttpError(409, "transaction_retry_required")
    : error;
}

adminCancellationsRouter.post("/admin/requests/:id/cancel", async (req: AuthenticatedRequest, res, next) => {
  try {
    const requestId = routeParam(req.params.id);
    const input = cancelBodySchema("admin").parse(req.body ?? {});
    await prisma.$transaction(
      (tx) => cancelPassengerRequest(tx, {
        requestId,
        actor: { userId: req.user!.id, role: "admin" },
        reason: { code: input.reason, note: input.note }
      }),
      { isolationLevel: "ReadCommitted" }
    );
    res.json({ cancelled: true });
  } catch (error) {
    next(retryable(error));
  }
});

adminCancellationsRouter.post("/admin/orders/:id/cancel", async (req: AuthenticatedRequest, res, next) => {
  try {
    const orderId = routeParam(req.params.id);
    const input = cancelBodySchema("admin").parse(req.body ?? {});
    const outcome = await prisma.$transaction(
      (tx) => cancelMerchantOrder(tx, {
        orderId,
        actor: { userId: req.user!.id, role: "admin" },
        reason: { code: input.reason, note: input.note }
      }),
      { isolationLevel: "ReadCommitted" }
    );
    if (outcome.tripId) await recomputeTrustForTrip(prisma, outcome.tripId);
    res.json({ cancelled: true });
  } catch (error) {
    next(retryable(error));
  }
});

adminCancellationsRouter.post("/admin/trips/:id/cancel", async (req: AuthenticatedRequest, res, next) => {
  try {
    const tripId = routeParam(req.params.id);
    const input = cancelBodySchema("admin").parse(req.body ?? {});
    await prisma.$transaction(
      (tx) => adminCancelTrip(tx, { tripId, actorId: req.user!.id, reason: { code: input.reason, note: input.note } }),
      { isolationLevel: "ReadCommitted" }
    );
    res.json({ cancelled: true });
  } catch (error) {
    next(retryable(error));
  }
});

const listQuerySchema = z.object({
  cursor: z.string().min(1).max(191).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  kind: z.enum(["automatic", "manual"]).optional(),
  role: z.enum(CANCEL_ACTOR_ROLES).optional(),
  reason: z.string().refine((value) => ALL_CANCEL_REASON_CODES.includes(value)).optional(),
});

adminCancellationsRouter.get("/admin/cancellations", async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const where: Prisma.CancellationWhereInput = {
      ...(query.from || query.to ? { created_at: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
      ...(query.kind ? { automatic: query.kind === "automatic" } : {}),
      ...(query.role ? { actor_role: query.role } : {}),
      ...(query.reason ? { reason_code: query.reason } : {}),
    };
    const rows = await prisma.cancellation.findMany({
      where,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        actor_role: true,
        actor: { select: { id: true, name: true } },
        trip_id: true,
        reason_code: true,
        note: true,
        automatic: true,
        ends_order: true,
        created_at: true,
        passenger_request: { select: { id: true, status: true, passenger: { select: { id: true, name: true } } } },
        merchant_order: {
          select: { id: true, status: true, merchant: { select: { id: true, name: true } }, passenger_parcel: { select: { order_id: true } } }
        },
      },
    });
    const page = rows.slice(0, query.limit);
    res.json({
      cancellations: page.map((row) => ({
        id: row.id,
        created_at: row.created_at,
        kind: row.automatic ? "automatic" : "manual",
        by_role: row.actor_role,
        by: row.actor,
        reason: row.reason_code,
        note: row.note,
        // "requeued": only the trip was cancelled and the order went back to waiting for another driver.
        outcome: row.ends_order ? "cancelled" : "requeued",
        trip_id: row.trip_id,
        order: row.passenger_request
          ? { type: "ride", id: row.passenger_request.id, status: row.passenger_request.status, owner: row.passenger_request.passenger }
          : row.merchant_order
            ? {
                type: row.merchant_order.passenger_parcel ? "parcel" : "merchant_order",
                id: row.merchant_order.id,
                status: row.merchant_order.status,
                owner: row.merchant_order.merchant,
              }
            : null,
      })),
      next_cursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
      reasons: CANCEL_REASONS,
    });
  } catch (error) {
    next(error);
  }
});
