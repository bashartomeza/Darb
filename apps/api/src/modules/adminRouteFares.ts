import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError, notFoundHandler } from "../middleware/error.js";
import {
  FARE_ITEMS,
  MAX_FARE_MINOR,
  routeFareService,
  type RouteFareService,
  type RouteFareSet
} from "../services/routeFares.js";

const id = z.string().min(1).max(191);
const reason = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .regex(/^[^\u0000-\u001f\u007f]+$/)
  .transform((value) => value.normalize("NFC"));

const changeSchema = z.strictObject({
  item: z.enum(FARE_ITEMS),
  // Integer agorot only: the client converts "12.50" to 1250, the server never rounds money.
  amount_minor: z.number().int().min(1).max(MAX_FARE_MINOR).nullable()
});
const setFaresSchema = z.strictObject({
  changes: z.array(changeSchema).min(1).max(FARE_ITEMS.length),
  effective_from: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  reason
});

function currentItems(set: RouteFareSet) {
  return Object.fromEntries(
    FARE_ITEMS.map((item) => [
      item,
      set[item]
        ? {
            fare_id: set[item]!.id,
            amount_minor: set[item]!.amountMinor,
            currency: set[item]!.currency,
            effective_from: set[item]!.effectiveFrom
          }
        : null
    ])
  );
}

type HistoryRow = {
  id: string;
  item: string;
  amount_minor: number | null;
  currency: string;
  effective_from: Date;
  reason: string | null;
  created_at: Date;
  created_by?: { id: string; name: string } | null;
};

function historyResponse(row: HistoryRow) {
  return {
    id: row.id,
    item: row.item,
    amount_minor: row.amount_minor,
    currency: row.currency,
    effective_from: row.effective_from,
    reason: row.reason,
    created_at: row.created_at,
    created_by: row.created_by ? { id: row.created_by.id, name: row.created_by.name } : null
  };
}

export function createAdminRouteFaresRouter(appConfig: AppConfig, service: RouteFareService = routeFareService) {
  const router = Router();
  if (!appConfig.routeManagementEnabled) {
    router.use("/admin/service-routes/:id/fares", notFoundHandler);
    return router;
  }
  router.use("/admin/service-routes/:id/fares", requireAuth, requireRole("admin"));

  async function respond(routeId: string, req: AuthenticatedRequest, res: import("express").Response, status = 200) {
    const now = new Date();
    const { rows, currentSet } = await service.history(routeId, now);
    res.status(status).json({
      route_id: routeId,
      currency: "ILS",
      display_only: true,
      current: currentItems(currentSet),
      history: rows.map((row) => historyResponse(row as unknown as HistoryRow)),
      server_now: now,
      request_id: req.requestId
    });
  }

  router.get("/admin/service-routes/:id/fares", async (req: AuthenticatedRequest, res, next) => {
    try {
      await respond(id.parse(req.params.id), req, res);
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/service-routes/:id/fares", async (req: AuthenticatedRequest, res, next) => {
    try {
      const routeId = id.parse(req.params.id);
      const input = setFaresSchema.safeParse(req.body);
      if (!input.success) throw new HttpError(400, "invalid_fare_request");
      await service.setFares(
        routeId,
        input.data.changes.map((change) => ({ item: change.item, amountMinor: change.amount_minor })),
        { effectiveFrom: input.data.effective_from, reason: input.data.reason },
        { id: req.user!.id, requestId: req.requestId }
      );
      await respond(routeId, req, res);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
