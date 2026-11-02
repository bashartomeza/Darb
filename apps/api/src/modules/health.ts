import { Router, type RequestHandler } from "express";
import type { AppConfig } from "../config.js";
import { checkDatabaseReadiness, runWithTimeout, type ReadinessCheck } from "../lib/readiness.js";

function identity(appConfig: AppConfig, requestId: string) {
  return {
    ok: true,
    service: "darb-api",
    environment: appConfig.appEnv,
    release: appConfig.appRelease,
    request_id: requestId
  };
}

export function createHealthRouter(appConfig: AppConfig, readinessCheck: ReadinessCheck = checkDatabaseReadiness) {
  const router = Router();

  const live: RequestHandler = (req, res) => {
    res.json({ ...identity(appConfig, req.requestId), status: "live" });
  };

  router.get("/health", live);
  router.get("/health/live", live);
  router.get("/health/ready", async (req, res) => {
    try {
      await runWithTimeout(readinessCheck, appConfig.readinessTimeoutMs);
      res.json({ ...identity(appConfig, req.requestId), status: "ready" });
    } catch {
      req.operationalLog.warn({ event: "readiness_check_failed" }, "Database readiness check failed");
      res.status(503).json({
        ok: false,
        service: "darb-api",
        status: "not_ready",
        request_id: req.requestId
      });
    }
  });

  return router;
}
