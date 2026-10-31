import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { auditEvent } from "../lib/audit.js";
import { lockedCorridorDistanceKm, round } from "../lib/geo.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { runComparisonSimulation } from "../services/matchingComparison.js";

const compareRunSchema = z.object({
  scenarioKey: z.string().default("masari_batch_wins"),
  passengerRequestId: z.string().optional(),
  merchantOrderId: z.string().optional()
});

const simulationQuerySchema = z.object({
  seed: z.coerce.number().int().min(0).max(4294967295).optional(),
  manual_response_delay_min: z.coerce.number().min(0.5).max(30).optional()
}).strict();

export const comparisonRouter = Router();

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_route_param");
  return value;
}

comparisonRouter.post("/compare/run", requireAuth, requireRole("admin"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = compareRunSchema.parse(req.body);
    const order = input.merchantOrderId
      ? await prisma.merchantOrder.findFirst({
          where: { id: input.merchantOrderId, canonical_entry_version: null }, include: { parcels: true }
        })
      : await prisma.merchantOrder.findFirst({
          where: { canonical_entry_version: null }, include: { parcels: true }, orderBy: { created_at: "desc" }
        });
    const passengerRequest = input.passengerRequestId
      ? await prisma.passengerRequest.findFirst({
          where: { id: input.passengerRequestId, canonical_entry_version: null }
        })
      : await prisma.passengerRequest.findFirst({
          where: { canonical_entry_version: null }, orderBy: { created_at: "desc" }
        });

    if (!order && !passengerRequest) throw new HttpError(404, "comparison_inputs_not_found");

    const parcelCount = order?.parcels.length ?? 0;
    const hasPassenger = passengerRequest ? 1 : 0;
    const corridorKm = lockedCorridorDistanceKm();
    const masariTrips = Math.max(1, parcelCount > 0 || hasPassenger ? 1 : 0);
    const nearestDriverTrips = Math.max(1, parcelCount + hasPassenger);
    const masariEstimatedDistance = round(corridorKm * masariTrips, 2);
    const nearestEstimatedDistance = round(corridorKm * nearestDriverTrips, 2);
    const costPerKm = 2;
    const masariEstimatedCost = round(masariEstimatedDistance * costPerKm, 2);
    const nearestEstimatedCost = round(nearestEstimatedDistance * costPerKm, 2);
    const driverUtilization = round((parcelCount + hasPassenger) / Math.max(1, parcelCount + 1), 2);
    const parcelBatchingBenefit =
      parcelCount > 0
        ? `${parcelCount} parcels can use 1 Masari corridor trip instead of ${parcelCount} nearest-driver parcel trips.`
        : "No merchant parcels in this comparison run.";
    const winner = masariEstimatedCost <= nearestEstimatedCost && masariTrips <= nearestDriverTrips ? "masari" : "nearest_driver";

    const run = await prisma.comparisonRun.create({
      data: {
        scenario_key: input.scenarioKey,
        masari_trips: masariTrips,
        nearest_driver_trips: nearestDriverTrips,
        masari_estimated_distance: masariEstimatedDistance.toFixed(2),
        nearest_estimated_distance: nearestEstimatedDistance.toFixed(2),
        masari_estimated_cost: masariEstimatedCost.toFixed(2),
        nearest_estimated_cost: nearestEstimatedCost.toFixed(2),
        parcel_batching_benefit: parcelBatchingBenefit,
        driver_utilization: driverUtilization.toFixed(2),
        winner
      }
    });

    await auditEvent(prisma, {
      userId: req.user!.id,
      action: AuditAction.comparison_run_created,
      entityType: "ComparisonRun",
      entityId: run.id,
      metadata: { winner, scenario_key: input.scenarioKey }
    });

    res.status(201).json({ comparison: run });
  } catch (error) {
    next(error);
  }
});

comparisonRouter.get("/compare/runs/:id", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const run = await prisma.comparisonRun.findUnique({ where: { id: routeParam(req.params.id) } });
    if (!run) throw new HttpError(404, "comparison_run_not_found");
    res.json({ comparison: run });
  } catch (error) {
    next(error);
  }
});

// Simulated comparison of manual dispatch, nearest-driver and Masari matching.
// Pure computation: no database reads or writes, nothing is created.
comparisonRouter.get("/compare/simulation", requireAuth, requireRole("admin"), (req, res, next) => {
  try {
    const query = simulationQuerySchema.parse(req.query);
    res.json({
      simulation: runComparisonSimulation({
        ...(query.seed !== undefined ? { seed: query.seed } : {}),
        ...(query.manual_response_delay_min !== undefined ? { manualResponseDelayMin: query.manual_response_delay_min } : {})
      })
    });
  } catch (error) {
    next(error);
  }
});
