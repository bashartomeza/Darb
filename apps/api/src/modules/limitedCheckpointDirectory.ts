import { Router } from "express";
import type { AppConfig } from "../config.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { notFoundHandler } from "../middleware/error.js";
import type { LimitedCheckpointDirectoryService } from "../services/limitedCheckpointDirectory.js";
export function createLimitedCheckpointDirectoryRouter(config: AppConfig, service?: LimitedCheckpointDirectoryService) {
  const router = Router();
  if (!config.limitedCheckpointDirectoryEnabled || !service) {
    router.use("/limited-checkpoint-directory", notFoundHandler); return router;
  }
  router.get("/limited-checkpoint-directory", requireAuth, requireRole("passenger", "driver"), async (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    try { res.json(await service.list()); } catch (error) { next(error); }
  });
  return router;
}
