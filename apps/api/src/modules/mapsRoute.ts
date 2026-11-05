import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import type { AppConfig } from "../config.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { parseWaypoints, RouteProxyError, type RouteProxyService } from "../maps/routeProxy.js";

/**
 * `GET /api/v1/maps/route?waypoints=lat,lng;lat,lng` for any signed-in user.
 * Answers in the OSRM route shape so the mobile parser is shared, and carries
 * the provider's attribution. The provider key never leaves the server.
 */
export function createMapsRouteRouter(config: AppConfig, service: RouteProxyService) {
  const router = Router();
  const limit = config.routeProxy.userRatePerMinute;
  router.get(
    "/maps/route",
    requireAuth,
    rateLimit({
      windowMs: 60_000,
      limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
      keyGenerator: (req: AuthenticatedRequest) => req.user?.id ?? "unauthenticated",
      handler: (req, res) => res.status(429).json({ error: "route_rate_limited", request_id: req.requestId })
    }),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const waypoints = parseWaypoints(req.query.waypoints, config.routeProxy.maxWaypoints);
        const { route, cacheStatus } = await service.route(waypoints);
        res.setHeader("Cache-Control", "private, no-store");
        res.json({
          code: "Ok",
          routes: [
            {
              distance: route.distanceMeters,
              duration: route.durationSeconds,
              geometry: { type: "LineString", coordinates: route.coordinates }
            }
          ],
          provider: service.provider,
          attribution: service.attribution,
          cache_status: cacheStatus,
          request_id: req.requestId
        });
      } catch (error) {
        if (error instanceof RouteProxyError) {
          req.operationalLog?.warn(
            { event: "maps_route_failed", actor_id: req.user?.id, provider: service.provider, result: error.code },
            "Route proxy request failed"
          );
          res.status(error.status).json({ error: error.code, request_id: req.requestId });
          return;
        }
        next(error);
      }
    }
  );
  return router;
}
