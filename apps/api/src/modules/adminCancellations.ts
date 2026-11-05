import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { recomputeTrustForTrip } from "../services/driverTrust.js";
import { CANCEL_ACTOR_ROLES, ALL_CANCEL_REASON_CODES, cancelBodySchema } from "../services/cancellationReasons.js";
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
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  kind: z.enum(["auto", "manual"]).optional(),
  role: z.enum(CANCEL_ACTOR_ROLES).optional(),
  reason: z.string().refine((value) => ALL_CANCEL_REASON_CODES.includes(value)).optional(),
});

adminCancellationsRouter.get("/admin/cancellations", async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const where: Prisma.CancellationWhereInput = {
      ...(query.from || query.to ? { created_at: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
      ...(query.kind ? { automatic: query.kind === "auto" } : {}),
      ...(query.role ? { actor_role: query.role } : {}),
      ...(query.reason ? { reason_code: query.reason } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.cancellation.count({ where }),
      prisma.cancellation.findMany({
        where,
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          actor_role: true,
          actor: { select: { id: true, name: true } },
          passenger_request_id: true,
          merchant_order_id: true,
          trip_id: true,
          reason_code: true,
          note: true,
          automatic: true,
          ends_order: true,
          created_at: true,
        },
      }),
    ]);
    res.json({
      cancellations: rows,
      page: query.page,
      limit: query.limit,
      total,
    });
  } catch (error) {
    next(error);
  }
});
