import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  buildReport,
  computeSuccessMetrics,
  previousWindow,
  successMetricsCsv,
  type TripRow,
  type Window
} from "../services/successMetrics.js";

export const SUCCESS_METRICS_TRIP_LIMIT = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SPAN_DAYS = 366;

const rangeSchema = z
  .object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })
  .refine((range) => !range.from || !range.to || range.from <= range.to, { message: "invalid_range" })
  .refine((range) => !range.from || !range.to || range.to.getTime() - range.from.getTime() <= MAX_SPAN_DAYS * DAY_MS, {
    message: "range_too_long"
  });

/** Default to the last 30 days so an unfiltered call is bounded. */
export function resolveWindow(input: { from?: Date; to?: Date }, now = new Date()): Window {
  const to = input.to ?? now;
  const from = input.from ?? new Date(to.getTime() - 30 * DAY_MS);
  return { from, to };
}

async function loadInput(window: Window) {
  const created = { gte: window.from, lte: window.to };
  const [trips, activeDrivers, verifiedActiveDrivers] = await Promise.all([
    prisma.trip.findMany({
      where: { operational_mode: "legacy", created_at: created },
      orderBy: { created_at: "asc" },
      take: SUCCESS_METRICS_TRIP_LIMIT,
      select: {
        id: true,
        status: true,
        created_at: true,
        driver_route_id: true,
        passenger_request: { select: { created_at: true } },
        merchant_order_id: true,
        parcel_batch: { select: { members: { select: { merchant_order: { select: { _count: { select: { parcels: true } } } } } } } }
      }
    }),
    prisma.driverProfile.count({ where: { user: { account_status: "active" } } }),
    prisma.driverProfile.count({ where: { verified: true, user: { account_status: "active" } } })
  ]);

  const ids = trips.map((trip) => trip.id);
  const events = ids.length
    ? await prisma.auditEvent.findMany({
        where: { action: "trip_status_updated", entity_type: "Trip", entity_id: { in: ids } },
        orderBy: { created_at: "asc" },
        select: { entity_id: true, metadata: true }
      })
    : [];
  const transitions = new Map<string, { from: string; to: string }[]>();
  for (const event of events) {
    const meta = event.metadata as { from?: unknown; to?: unknown } | null;
    if (!event.entity_id || typeof meta?.from !== "string" || typeof meta?.to !== "string") continue;
    const list = transitions.get(event.entity_id) ?? [];
    list.push({ from: meta.from, to: meta.to });
    transitions.set(event.entity_id, list);
  }

  const rows: TripRow[] = trips.map((trip) => {
    const members = trip.parcel_batch?.members ?? [];
    return {
      status: trip.status,
      created_at: trip.created_at,
      driver_route_id: trip.driver_route_id,
      request_created_at: trip.passenger_request?.created_at ?? null,
      served_units: trip.parcel_batch ? members.length : 1,
      batch_parcels: trip.parcel_batch ? members.reduce((sum, member) => sum + member.merchant_order._count.parcels, 0) : null,
      transitions: transitions.get(trip.id) ?? []
    };
  });
  return { trips: rows, verification: { active_drivers: activeDrivers, verified_active_drivers: verifiedActiveDrivers } };
}

async function buildWindowReport(window: Window) {
  const [current, previous] = await Promise.all([loadInput(window), loadInput(previousWindow(window))]);
  return buildReport(computeSuccessMetrics(current), computeSuccessMetrics(previous));
}

export const adminSuccessMetricsRouter = Router();
adminSuccessMetricsRouter.use("/admin/success-metrics", requireAuth, requireRole("admin"));

adminSuccessMetricsRouter.get("/admin/success-metrics", async (req, res, next) => {
  try {
    const window = resolveWindow(rangeSchema.parse(req.query));
    const metrics = await buildWindowReport(window);
    res.json({ range: { from: window.from, to: window.to }, generated_at: new Date(), metrics });
  } catch (error) {
    next(error);
  }
});

adminSuccessMetricsRouter.get("/admin/success-metrics/export", async (req, res, next) => {
  try {
    const window = resolveWindow(rangeSchema.parse(req.query));
    const metrics = await buildWindowReport(window);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="masari-success-metrics.csv"');
    res.send(successMetricsCsv(metrics, window));
  } catch (error) {
    next(error);
  }
});
