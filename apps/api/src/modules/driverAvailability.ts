import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError, notFoundHandler } from "../middleware/error.js";
import {
  driverAvailabilityService,
  type DriverAvailabilityService
} from "../services/driverAvailability.js";

const instant = z.string().datetime({ offset: true }).transform((value) => new Date(value));
const createSchema = z.strictObject({
  route_version_id: z.string().min(1).max(191),
  departure_at: instant,
  availability_window_end: instant.nullable().optional(),
  total_seats: z.number().int().min(1).max(8),
  total_parcel_capacity: z.number().int().min(0).max(20)
});
const updateSchema = z.strictObject({
  expected_revision: z.number().int().positive(),
  departure_at: instant.optional(),
  availability_window_end: instant.nullable().optional(),
  total_seats: z.number().int().min(1).max(8).optional(),
  total_parcel_capacity: z.number().int().min(0).max(20).optional()
}).refine((value) => Object.keys(value).some((key) => key !== "expected_revision"), { message: "no_changes" });
const transitionSchema = z.strictObject({ expected_revision: z.number().int().positive() });
const idempotencyKey = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_route_param");
  return value;
}

function serializeAvailability(value: Record<string, unknown>) {
  const version = value.route_version as Record<string, unknown> | null | undefined;
  const route = version?.service_route as Record<string, unknown> | undefined;
  return {
    id: value.id,
    mode: value.canonical_availability_version,
    route_version: version
      ? {
          id: version.id,
          version_number: version.version_number,
          name_ar: version.name_ar,
          name_en: version.name_en,
          direction: route?.direction,
          route: route ? { id: route.id, route_key: route.route_key } : undefined
        }
      : { id: value.route_version_id },
    departure_at: value.departure_at,
    availability_window_end: value.availability_window_end,
    total_seats: value.total_seats,
    remaining_seats: value.remaining_seats,
    total_parcel_capacity: value.total_parcel_capacity,
    remaining_parcel_capacity: value.remaining_parcel_capacity,
    status: value.availability_status,
    revision: value.availability_revision,
    activated_at: value.activated_at,
    paused_at: value.paused_at,
    cancelled_at: value.cancelled_at
  };
}

export function createDriverAvailabilityRouter(
  appConfig: AppConfig,
  service: DriverAvailabilityService = driverAvailabilityService
) {
  const router = Router();
  if (!appConfig.multiRouteEntryEnabled) {
    router.use("/driver/availabilities", notFoundHandler);
    return router;
  }
  router.use("/driver/availabilities", requireAuth, requireRole("driver"));

  router.get("/driver/availabilities", async (req: AuthenticatedRequest, res, next) => {
    try {
      const resources = await service.listOwner(req.user!.id);
      res.json({ availabilities: resources.map((resource) => serializeAvailability(resource as unknown as Record<string, unknown>)) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/driver/availabilities", async (req: AuthenticatedRequest, res, next) => {
    try {
      const key = idempotencyKey.safeParse(req.header("idempotency-key"));
      if (!key.success) throw new HttpError(400, "invalid_or_missing_idempotency_key");
      const input = createSchema.parse(req.body);
      const result = await service.createOneOff(
        {
          routeVersionId: input.route_version_id,
          departureAt: input.departure_at,
          availabilityWindowEnd: input.availability_window_end,
          totalSeats: input.total_seats,
          totalParcelCapacity: input.total_parcel_capacity
        },
        { id: req.user!.id, requestId: req.requestId, idempotencyKey: key.data }
      );
      res.status(result.replayed ? 200 : 201).json({
        availability: serializeAvailability(result.resource as unknown as Record<string, unknown>),
        replayed: result.replayed,
        request_id: req.requestId
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/driver/availabilities/:id", async (req: AuthenticatedRequest, res, next) => {
    try {
      const resource = await service.getOwner(routeParam(req.params.id), req.user!.id);
      res.json({ availability: serializeAvailability(resource as unknown as Record<string, unknown>) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/driver/availabilities/:id", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = updateSchema.parse(req.body);
      const resource = await service.updateOneOff(
        routeParam(req.params.id),
        {
          expectedRevision: input.expected_revision,
          departureAt: input.departure_at,
          availabilityWindowEnd: input.availability_window_end,
          totalSeats: input.total_seats,
          totalParcelCapacity: input.total_parcel_capacity
        },
        { id: req.user!.id, requestId: req.requestId }
      );
      res.json({ availability: serializeAvailability(resource as unknown as Record<string, unknown>), request_id: req.requestId });
    } catch (error) {
      next(error);
    }
  });

  for (const action of ["activate", "pause", "resume", "cancel"] as const) {
    router.post(`/driver/availabilities/:id/${action}`, async (req: AuthenticatedRequest, res, next) => {
      try {
        const input = transitionSchema.parse(req.body);
        const resource = await service[action](
          routeParam(req.params.id),
          input.expected_revision,
          { id: req.user!.id, requestId: req.requestId }
        );
        res.json({ availability: serializeAvailability(resource as unknown as Record<string, unknown>), request_id: req.requestId });
      } catch (error) {
        next(error);
      }
    });
  }
  return router;
}
