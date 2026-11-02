import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  parseBatchQuery,
  parseMatchQuery,
  parseMonitoringId,
  parsePageQuery,
  parseRange,
  type MonitoringService
} from "../services/adminMatchingMonitoring/contracts.js";
import { createMonitoringService } from "../services/adminMatchingMonitoring/service.js";

const emptyQuery = z.object({}).strict();

export function createAdminMatchingMonitoringRouter(
  service: MonitoringService = createMonitoringService(prisma)
): Router {
  const router = Router();

  router.use("/admin/matching-batching", requireAuth, requireRole("admin"));

  router.get("/admin/matching-batching/overview", async (req, res) => {
    const now = new Date();
    res.json(await service.overview(parseRange(req.query, now)));
  });

  router.get("/admin/matching-batching/matches", async (req, res) => {
    const now = new Date();
    res.json(await service.matches(parseMatchQuery(req.query, now)));
  });

  router.get("/admin/matching-batching/matches/:id", async (req, res) => {
    emptyQuery.parse(req.query);
    res.json(await service.match(parseMonitoringId(req.params.id)));
  });

  router.get("/admin/matching-batching/batches", async (req, res) => {
    const now = new Date();
    res.json(await service.batches(parseBatchQuery(req.query, now)));
  });

  router.get("/admin/matching-batching/batches/:id", async (req, res) => {
    emptyQuery.parse(req.query);
    res.json(await service.batch(parseMonitoringId(req.params.id)));
  });

  router.get("/admin/matching-batching/batches/:id/parcels", async (req, res) => {
    res.json(await service.parcels(parseMonitoringId(req.params.id), parsePageQuery(req.query)));
  });

  return router;
}
