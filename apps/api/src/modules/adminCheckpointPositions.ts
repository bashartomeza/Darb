import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { auditEvent } from "../lib/audit.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { Prisma } from "../generated/prisma/client.js";
import { checkpointPositionKey, type PartnerCheckpointMapService } from "../services/partnerCheckpointMap.js";

/**
 * The West Bank, with a small margin. Checkpoint positions are researched pins
 * for partner checkpoints, so anything outside this box is a typo (for
 * example swapped latitude and longitude).
 */
export const WEST_BANK_BOUNDS = { minLatitude: 31.3, maxLatitude: 32.6, minLongitude: 34.85, maxLongitude: 35.6 } as const;
export const CHECKPOINT_CONFIDENCES = ["high", "medium", "low", "unverified"] as const;

const cleanText = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .refine((value) => value.length >= min && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value), "Invalid value");

const optionalNote = z
  .union([cleanText(0, 500), z.null()])
  .transform((value) => (value === null || value === "" ? null : value));

const latitude = z.number().finite().min(WEST_BANK_BOUNDS.minLatitude).max(WEST_BANK_BOUNDS.maxLatitude);
const longitude = z.number().finite().min(WEST_BANK_BOUNDS.minLongitude).max(WEST_BANK_BOUNDS.maxLongitude);

const createSchema = z.strictObject({
  city_ar: cleanText(2, 100),
  name_ar: cleanText(2, 191),
  latitude,
  longitude,
  confidence: z.enum(CHECKPOINT_CONFIDENCES),
  source: cleanText(2, 100),
  dataset_name: z.union([cleanText(0, 191), z.null()]).optional().transform((value) => (value ? value : null)),
  note: optionalNote.optional()
});

const updateSchema = z
  .strictObject({
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    confidence: z.enum(CHECKPOINT_CONFIDENCES).optional(),
    note: optionalNote.optional()
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: "no_changes" });

const listSchema = z.object({
  search: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

type PositionRow = {
  id: string;
  city_ar: string;
  name_ar: string;
  latitude: { toString(): string } | number;
  longitude: { toString(): string } | number;
  confidence: string;
  source: string;
  dataset_name: string | null;
  note: string | null;
  created_at: Date;
  updated_at: Date;
};

function serialize(row: PositionRow) {
  return {
    id: row.id,
    city_ar: row.city_ar,
    name_ar: row.name_ar,
    latitude: Number(row.latitude.toString()),
    longitude: Number(row.longitude.toString()),
    confidence: row.confidence,
    source: row.source,
    dataset_name: row.dataset_name,
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string" || value.length === 0 || value.length > 191) throw new HttpError(400, "invalid_route_param");
  return value;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Researched positions for partner checkpoints the OpenStreetMap extract cannot
 * place. The partner map looks a row up by city and name with spelling
 * differences ignored, so uniqueness is checked the same way.
 */
export function createAdminCheckpointPositionsRouter(partnerMap?: Pick<PartnerCheckpointMapService, "list">) {
  const router = Router();
  router.use("/admin/checkpoint-positions", requireAuth, requireRole("admin"));

  router.get("/admin/checkpoint-positions", async (req, res, next) => {
    try {
      const input = listSchema.parse(req.query);
      const where: Prisma.CheckpointPositionWhereInput = {
        ...(input.city ? { city_ar: input.city } : {}),
        ...(input.search ? { OR: [{ name_ar: { contains: input.search } }, { city_ar: { contains: input.search } }] } : {})
      };
      const [rows, total] = await Promise.all([
        prisma.checkpointPosition.findMany({
          where,
          orderBy: [{ city_ar: "asc" }, { name_ar: "asc" }, { id: "asc" }],
          skip: (input.page - 1) * input.limit,
          take: input.limit
        }),
        prisma.checkpointPosition.count({ where })
      ]);
      res.json({ positions: rows.map(serialize), page: input.page, limit: input.limit, total });
    } catch (error) {
      next(error);
    }
  });

  /** Partner checkpoints with no position at all. Optional: absent when the partner map is off. */
  router.get("/admin/checkpoint-positions/unplaced", async (_req, res, next) => {
    try {
      if (!partnerMap) {
        res.json({ available: false, unplaced: [] });
        return;
      }
      const map = await partnerMap.list().catch(() => null);
      if (!map) {
        res.json({ available: false, unplaced: [] });
        return;
      }
      res.json({
        available: true,
        fetched_at: map.fetched_at,
        unplaced: map.unplaced.map((row) => ({ id: row.id, city_ar: row.city, name_ar: row.name_ar, reason: row.reason }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/checkpoint-positions", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = createSchema.parse(req.body);
      const key = checkpointPositionKey(input.city_ar, input.name_ar);
      const created = await prisma.$transaction(async (tx) => {
        const existing = await tx.checkpointPosition.findMany({ select: { city_ar: true, name_ar: true } });
        if (existing.some((row) => checkpointPositionKey(row.city_ar, row.name_ar) === key)) {
          throw new HttpError(409, "checkpoint_position_exists");
        }
        const row = await tx.checkpointPosition.create({
          data: {
            city_ar: input.city_ar,
            name_ar: input.name_ar,
            latitude: input.latitude,
            longitude: input.longitude,
            confidence: input.confidence,
            source: input.source,
            dataset_name: input.dataset_name,
            note: input.note ?? null
          }
        });
        await auditEvent(tx, {
          userId: req.user!.id,
          action: AuditAction.admin_action,
          entityType: "CheckpointPosition",
          entityId: row.id,
          metadata: {
            action: "checkpoint_position_created",
            city_ar: row.city_ar,
            name_ar: row.name_ar,
            latitude: input.latitude,
            longitude: input.longitude,
            confidence: input.confidence,
            request_id: req.requestId ?? null
          }
        });
        return row;
      });
      res.status(201).json({ position: serialize(created) });
    } catch (error) {
      next(isUniqueViolation(error) ? new HttpError(409, "checkpoint_position_exists") : error);
    }
  });

  router.patch("/admin/checkpoint-positions/:id", async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = routeParam(req.params.id);
      const input = updateSchema.parse(req.body);
      const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.checkpointPosition.findUnique({ where: { id } });
        if (!current) throw new HttpError(404, "checkpoint_position_not_found");
        const data = {
          ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
          ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
          ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
          ...(input.note !== undefined ? { note: input.note } : {})
        };
        const row = await tx.checkpointPosition.update({ where: { id }, data });
        await auditEvent(tx, {
          userId: req.user!.id,
          action: AuditAction.admin_action,
          entityType: "CheckpointPosition",
          entityId: id,
          metadata: {
            action: "checkpoint_position_updated",
            before: {
              latitude: Number(current.latitude.toString()),
              longitude: Number(current.longitude.toString()),
              confidence: current.confidence,
              note: current.note
            },
            changes: data,
            request_id: req.requestId ?? null
          }
        });
        return row;
      });
      res.json({ position: serialize(updated) });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/checkpoint-positions/:id", async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = routeParam(req.params.id);
      await prisma.$transaction(async (tx) => {
        const current = await tx.checkpointPosition.findUnique({ where: { id } });
        if (!current) throw new HttpError(404, "checkpoint_position_not_found");
        await tx.checkpointPosition.delete({ where: { id } });
        await auditEvent(tx, {
          userId: req.user!.id,
          action: AuditAction.admin_action,
          entityType: "CheckpointPosition",
          entityId: id,
          metadata: {
            action: "checkpoint_position_deleted",
            city_ar: current.city_ar,
            name_ar: current.name_ar,
            latitude: Number(current.latitude.toString()),
            longitude: Number(current.longitude.toString()),
            confidence: current.confidence,
            request_id: req.requestId ?? null
          }
        });
      });
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
