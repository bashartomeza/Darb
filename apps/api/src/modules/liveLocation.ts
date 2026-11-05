import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { maybeNotifyDriverApproaching } from "../services/driverApproaching.js";
import {
  LIVE_TRACKING_STATUSES,
  STALE_AFTER_SECONDS,
  TERMINAL_TRIP_STATUSES,
  latestTripLocation,
  recordDriverFix,
  serializeTripLocation,
  validateDriverFix
} from "../services/liveLocation.js";
import { getVisibleTrip } from "./trips.js";

const driverFixSchema = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    accuracy_m: z.number().finite().nonnegative().max(100_000),
    recorded_at: z.string().datetime({ offset: true })
  })
  .strict();

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_route_param");
  return value;
}

/**
 * Live driver location for legacy trips. The assigned driver's phone posts its
 * position while the trip runs; everyone who can open the trip reads the latest
 * point with its age. Demo builds keep the simulator in trips.ts.
 */
export function createLiveLocationRouter(appConfig: AppConfig) {
  const router = Router();

  router.post("/trips/:id/location", requireAuth, requireRole("driver"), async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!appConfig.liveTrackingEnabled) throw new HttpError(404, "live_tracking_disabled");
      const input = driverFixSchema.parse(req.body);
      const trip = await getVisibleTrip(routeParam(req.params.id), req);
      if (trip.driver_route.driver.user_id !== req.user!.id) throw new HttpError(403, "forbidden");
      if (!(LIVE_TRACKING_STATUSES as readonly string[]).includes(trip.status)) throw new HttpError(409, "trip_not_tracking");

      const now = new Date();
      const fix = { point: { lat: input.lat, lng: input.lng }, accuracyMeters: input.accuracy_m, fixTime: new Date(input.recorded_at) };
      validateDriverFix(fix, now);
      const result = await recordDriverFix(prisma, { tripId: trip.id, driverId: trip.driver_id, fix, now });
      if (!result.stored) {
        res.json({ stored: false, reason: result.reason, retry_after_seconds: result.retryAfterSeconds });
        return;
      }
      // Each point is a row of its own; auditing every one would double the
      // writes of a running trip without saying anything new.
      await maybeNotifyDriverApproaching(prisma, trip.id, fix.point);
      res.status(201).json({
        stored: true,
        location: { id: result.location.id, sequence: result.location.sequence, recorded_at: result.location.recorded_at.toISOString() }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/trips/:id/location", requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const trip = await getVisibleTrip(routeParam(req.params.id), req);
      const rider = req.user!.role !== "admin" && req.user!.role !== "driver";
      // Once the trip is over, riders no longer see where the driver is.
      if (rider && (TERMINAL_TRIP_STATUSES as readonly string[]).includes(trip.status)) {
        res.json({ location: null, stale_after_seconds: STALE_AFTER_SECONDS });
        return;
      }
      // Outside demo builds only real phone positions count, never a leftover simulated row.
      const location = await latestTripLocation(prisma, trip.id, { includeSimulated: appConfig.demoFeaturesEnabled });
      res.json({
        location: location ? serializeTripLocation(location, new Date()) : null,
        stale_after_seconds: STALE_AFTER_SECONDS
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
