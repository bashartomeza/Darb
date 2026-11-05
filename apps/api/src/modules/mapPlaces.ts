import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import {
  DEFAULT_PLACE_LIMIT,
  MAP_PLACE_CATEGORIES,
  MAX_PLACE_LIMIT,
  PLACE_REPORT_REASONS,
  bboxSchema,
  categoriesQuerySchema,
  findPlaces
} from "../services/mapPlaces.js";
import { Prisma } from "../generated/prisma/client.js";

const listSchema = z.object({
  bbox: bboxSchema,
  categories: categoriesQuerySchema.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PLACE_LIMIT).default(DEFAULT_PLACE_LIMIT)
});

const reportSchema = z.strictObject({
  reason: z.enum(PLACE_REPORT_REASONS),
  note: z
    .string()
    .transform((value) => value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""))
    .refine((value) => value.length <= 300, "Invalid value")
    .optional()
    .transform((value) => (value ? value : null))
});

export const MAP_PLACES_ATTRIBUTION = "© OpenStreetMap contributors";

/**
 * Places of interest for the map, for every signed-in role (the same audience as
 * `GET /checkpoints`). The phones ask this API, never Overpass.
 *
 * `GET /map/places?bbox=south,west,north,east&categories=cafe,fuel&limit=200` answers the
 * active places inside the box, nearest to its centre first. The box is capped, the
 * result is capped, and `truncated` says when more matched. Responses carry a
 * five-minute private cache lifetime and an ETag, so a re-pan to the same view costs
 * a 304.
 */
export function createMapPlacesRouter() {
  const router = Router();

  router.get("/map/places/categories", requireAuth, (_req, res) => {
    res.set("Cache-Control", "private, max-age=3600").json({ categories: MAP_PLACE_CATEGORIES });
  });

  router.get("/map/places", requireAuth, async (req, res, next) => {
    try {
      const input = listSchema.parse(req.query);
      const result = await findPlaces(prisma, { bbox: input.bbox, categories: input.categories, limit: input.limit });
      res.set("Cache-Control", "private, max-age=300").json({ ...result, attribution: MAP_PLACES_ATTRIBUTION });
    } catch (error) {
      next(error);
    }
  });

  // One report per user and place; reporting again changes nothing.
  router.post("/map/places/:id/report", requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = req.params.id;
      if (typeof id !== "string" || id.length === 0 || id.length > 191) throw new HttpError(400, "invalid_route_param");
      const input = reportSchema.parse(req.body);
      const place = await prisma.mapPlace.findUnique({ where: { id }, select: { id: true } });
      if (!place) throw new HttpError(404, "map_place_not_found");
      try {
        await prisma.mapPlaceReport.create({
          data: { place_id: id, reporter_id: req.user!.id, reason: input.reason, note: input.note }
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
      res.status(202).json({ received: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
