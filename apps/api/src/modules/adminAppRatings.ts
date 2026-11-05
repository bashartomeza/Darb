import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { Prisma } from "../generated/prisma/client.js";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const dateInput = z
  .string()
  .trim()
  .refine((value) => DATE_ONLY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "Invalid date");

const listSchema = z
  .object({
    stars: z.coerce.number().int().min(1).max(5).optional(),
    /** YYYY-MM-DD, inclusive, on the date the rating was last saved (UTC). */
    from: dateInput.optional(),
    to: dateInput.optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25)
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, { message: "invalid_range", path: ["from"] });

type RatingRow = {
  stars: number;
  feedback: string | null;
  created_at: Date;
  updated_at: Date;
  user: { id: string; name: string; role: string };
};

function serialize(row: RatingRow) {
  return {
    user: { id: row.user.id, name: row.user.name, role: row.user.role },
    stars: row.stars,
    feedback: row.feedback,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export const adminAppRatingsRouter = Router();

adminAppRatingsRouter.use("/admin/app-ratings", requireAuth, requireRole("admin"));

/**
 * Ratings users gave the app from Settings, newest first. The summary (average
 * and 1-5 distribution) covers the date range only, so a star filter narrows
 * the list without changing the overall picture.
 */
adminAppRatingsRouter.get("/admin/app-ratings", async (req, res, next) => {
  try {
    const input = listSchema.parse(req.query);
    const updated: Prisma.DateTimeFilter = {};
    if (input.from) updated.gte = new Date(`${input.from}T00:00:00.000Z`);
    if (input.to) updated.lt = new Date(new Date(`${input.to}T00:00:00.000Z`).getTime() + DAY_MS);
    const range: Prisma.AppRatingWhereInput = input.from || input.to ? { updated_at: updated } : {};
    const where: Prisma.AppRatingWhereInput = { ...range, ...(input.stars ? { stars: input.stars } : {}) };

    const [rows, total, groups] = await Promise.all([
      prisma.appRating.findMany({
        where,
        orderBy: [{ updated_at: "desc" }, { user_id: "asc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        include: { user: { select: { id: true, name: true, role: true } } }
      }),
      prisma.appRating.count({ where }),
      prisma.appRating.groupBy({ by: ["stars"], where: range, _count: { _all: true } })
    ]);

    const distribution: Record<"1" | "2" | "3" | "4" | "5", number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    let count = 0;
    let sum = 0;
    for (const group of groups) {
      const key = String(group.stars) as keyof typeof distribution;
      if (!(key in distribution)) continue;
      distribution[key] += group._count._all;
      count += group._count._all;
      sum += group.stars * group._count._all;
    }

    res.json({
      ratings: rows.map(serialize),
      page: input.page,
      limit: input.limit,
      total,
      summary: { count, average: count ? Math.round((sum / count) * 100) / 100 : null, distribution }
    });
  } catch (error) {
    next(error);
  }
});
