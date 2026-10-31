import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { toCsv } from "../lib/csv.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";

export const EXPORT_ROW_LIMIT = 5000;

const rangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional()
  })
  .refine((range) => !range.from || !range.to || range.from <= range.to, { message: "invalid_range" });

const exportSchema = rangeSchema.and(z.object({ dataset: z.enum(["requests", "orders", "trips"]) }));

function createdBetween(range: { from?: Date; to?: Date }) {
  if (!range.from && !range.to) return {};
  return { created_at: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } };
}

function byStatus(groups: { status: string; _count: { _all: number } }[]) {
  return Object.fromEntries(groups.map((group) => [group.status, group._count._all]));
}

function total(counts: Record<string, number>) {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

export const reportsRouter = Router();

reportsRouter.use("/admin/reports", requireAuth, requireRole("admin"));
reportsRouter.use("/merchant/reports", requireAuth, requireRole("merchant"));

reportsRouter.get("/admin/reports/summary", async (req: AuthenticatedRequest, res, next) => {
  try {
    const range = rangeSchema.parse(req.query);
    const where = createdBetween(range);
    // Reports describe the corridor product, so canonical records stay out.
    const legacyTrip = { operational_mode: "legacy", ...where };
    const [requests, orders, trips, matches, parcels, drivers, verifiedDrivers, pendingVerifications] = await Promise.all([
      prisma.passengerRequest.groupBy({ by: ["status"], where, _count: { _all: true } }),
      prisma.merchantOrder.groupBy({ by: ["status"], where, _count: { _all: true } }),
      prisma.trip.groupBy({ by: ["status"], where: legacyTrip, _count: { _all: true } }),
      prisma.match.groupBy({ by: ["status"], where, _count: { _all: true } }),
      prisma.parcel.count({ where: { order: where } }),
      prisma.driverProfile.count(),
      prisma.driverProfile.count({ where: { verified: true } }),
      prisma.driverVerification.count({ where: { status: "pending" } })
    ]);
    const requestCounts = byStatus(requests);
    const orderCounts = byStatus(orders);
    const tripCounts = byStatus(trips);
    const matchCounts = byStatus(matches);
    res.json({
      range: { from: range.from ?? null, to: range.to ?? null },
      generated_at: new Date(),
      passenger_requests: { total: total(requestCounts), by_status: requestCounts },
      merchant_orders: { total: total(orderCounts), by_status: orderCounts, parcels },
      trips: { total: total(tripCounts), by_status: tripCounts },
      matches: { total: total(matchCounts), by_status: matchCounts },
      drivers: { total: drivers, verified: verifiedDrivers, pending_verification: pendingVerifications }
    });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get("/admin/reports/export", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = exportSchema.parse(req.query);
    const where = createdBetween(input);
    let csv: string;
    if (input.dataset === "requests") {
      const rows = await prisma.passengerRequest.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: EXPORT_ROW_LIMIT
      });
      csv = toCsv(
        ["id", "status", "pickup", "destination", "passengers", "preferred_time", "created_at"],
        rows.map((r) => [r.id, r.status, r.pickup_label, r.destination_label, r.passenger_count, r.preferred_time, r.created_at])
      );
    } else if (input.dataset === "orders") {
      const rows = await prisma.merchantOrder.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: EXPORT_ROW_LIMIT,
        include: { _count: { select: { parcels: true } } }
      });
      csv = toCsv(
        ["id", "status", "pickup", "parcels", "created_at"],
        rows.map((r) => [r.id, r.status, r.pickup_label, r._count.parcels, r.created_at])
      );
    } else {
      const rows = await prisma.trip.findMany({
        where: { operational_mode: "legacy", ...where },
        orderBy: { created_at: "desc" },
        take: EXPORT_ROW_LIMIT
      });
      csv = toCsv(
        ["id", "status", "driver_route_id", "passenger_request_id", "merchant_order_id", "started_at", "completed_at", "created_at"],
        rows.map((r) => [r.id, r.status, r.driver_route_id, r.passenger_request_id, r.merchant_order_id, r.started_at, r.completed_at, r.created_at])
      );
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="masari-${input.dataset}.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

reportsRouter.get("/merchant/reports/summary", async (req: AuthenticatedRequest, res, next) => {
  try {
    const range = rangeSchema.parse(req.query);
    const merchantId = req.user!.id;
    if (!merchantId) throw new HttpError(401, "unauthorized");
    const where = { merchant_id: merchantId, ...createdBetween(range) };
    const [orders, parcels, trips] = await Promise.all([
      prisma.merchantOrder.groupBy({ by: ["status"], where, _count: { _all: true } }),
      prisma.parcel.count({ where: { order: where } }),
      prisma.trip.groupBy({
        by: ["status"],
        where: { operational_mode: "legacy", merchant_order: where },
        _count: { _all: true }
      })
    ]);
    const orderCounts = byStatus(orders);
    const tripCounts = byStatus(trips);
    res.json({
      range: { from: range.from ?? null, to: range.to ?? null },
      generated_at: new Date(),
      orders: { total: total(orderCounts), by_status: orderCounts, parcels },
      trips: { total: total(tripCounts), by_status: tripCounts }
    });
  } catch (error) {
    next(error);
  }
});
