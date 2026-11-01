import { Router } from "express";
import type { AppConfig } from "../config.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { notFoundHandler } from "../middleware/error.js";
import { CheckpointService, createCheckpointService } from "../services/checkpoints.js";
import type { PartnerCheckpointMapService } from "../services/partnerCheckpointMap.js";

/**
 * `GET /api/v1/checkpoints` — barriers for the passenger and driver maps.
 *
 * Gated the same way the rest of the canonical surface is: when the feature is
 * off the path does not exist, so a client that ignores `checkpoints_available`
 * gets a 404 rather than an empty list it might mistake for "no barriers".
 */
export function createCheckpointRouter(
  appConfig: AppConfig,
  service?: CheckpointService,
  partnerMap?: PartnerCheckpointMapService
) {
  const router = Router();
  if (!appConfig.checkpointsEnabled || !appConfig.checkpoints) {
    if (appConfig.partnerCheckpointMapEnabled && partnerMap) {
      // Partner rows placed by an OpenStreetMap name match. Same role rule as
      // the limited directory the rows come from.
      router.get("/checkpoints", requireAuth, requireRole("passenger", "driver"), async (_req, res, next) => {
        try {
          res.set("Cache-Control", "no-store").json(await partnerMap.list());
        } catch (error) {
          next(error);
        }
      });
      return router;
    }
    router.use("/checkpoints", notFoundHandler);
    return router;
  }
  const checkpoints = service ?? createCheckpointService(appConfig.checkpoints);

  router.get("/checkpoints", requireAuth, async (_req, res, next) => {
    try {
      const result = await checkpoints.list();
      res.json({
        checkpoints: result.checkpoints,
        fetched_at: result.fetched_at,
        stale: result.stale
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
