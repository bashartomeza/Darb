import { Router } from "express";
import type { AppConfig } from "../config.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { notFoundHandler } from "../middleware/error.js";
import type { CheckpointDirectoryService } from "../services/checkpointDirectory.js";

export function createCheckpointDirectoryRouter(config: AppConfig, directory?: CheckpointDirectoryService) {
  const router = Router();
  if (!config.checkpointDirectoryEnabled || !directory) {
    router.use("/checkpoint-directory", notFoundHandler);
    return router;
  }
  router.get("/checkpoint-directory", requireAuth, requireRole("passenger", "driver"), (_req, res, next) => {
    try { res.set("Cache-Control", "no-store").json(directory.list()); } catch (error) { next(error); }
  });
  return router;
}
