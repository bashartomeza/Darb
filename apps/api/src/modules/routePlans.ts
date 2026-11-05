import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { MAX_PLAN_WAYPOINTS, type RoutePlanner } from "../services/routePlanner.js";

/** The area Darb serves (same box as the mobile apps); keeps the endpoint from being an open routing proxy. */
const AREA = { minLat: 29.4, maxLat: 33.4, minLng: 34.2, maxLng: 35.95 };

const waypoint = z.strictObject({
  latitude: z.number().min(AREA.minLat).max(AREA.maxLat),
  longitude: z.number().min(AREA.minLng).max(AREA.maxLng)
});
const bodySchema = z.strictObject({ waypoints: z.array(waypoint).min(2).max(MAX_PLAN_WAYPOINTS) });

/**
 * `POST /api/v1/route-plans` - a road route that takes live checkpoint status into account.
 *
 * Mounted only when a checkpoint source is configured (same gate as `GET /checkpoints`),
 * so a client that ignores `checkpoints_available` gets a 404 and falls back to its own line.
 * `roles` mirrors the checkpoint feed's: any signed-in role for the coordinate feed,
 * passengers and drivers for the partner map.
 */
export function createRoutePlansRouter(
  appConfig: AppConfig,
  planner: RoutePlanner | undefined,
  roles: Array<"passenger" | "driver" | "merchant" | "admin"> | "any"
) {
  const router = Router();
  if (!planner) return router;
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: appConfig.checkpointRouting.rateLimitPerMinute,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    keyGenerator: (req: AuthenticatedRequest) => req.user?.id ?? "unauthenticated",
    handler: (req, res) => res.status(429).json({ error: "route_plan_rate_limited", request_id: req.requestId })
  });
  const guards = roles === "any" ? [requireAuth] : [requireAuth, requireRole(...roles)];
  router.post("/route-plans", ...guards, limiter, async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = bodySchema.parse(req.body);
      const plan = await planner.plan(body.waypoints.map((p) => ({ lat: p.latitude, lng: p.longitude })));
      res.set("Cache-Control", "no-store").json({ plan, request_id: req.requestId });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
