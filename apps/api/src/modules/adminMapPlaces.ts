import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { auditEvent } from "../lib/audit.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { AuditAction } from "../generated/prisma/enums.js";
import type { Prisma } from "../generated/prisma/client.js";
import { MAP_PLACE_CATEGORIES } from "../services/mapPlaces.js";
import { WEST_BANK_BOUNDS } from "./adminCheckpointPositions.js";

const cleanText = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .refine((value) => value.length >= min && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value), "Invalid value");

const nullableText = (max: number) =>
  z.union([cleanText(0, max), z.null()]).transform((value) => (value === null || value === "" ? null : value));

const category = z.string().refine((key) => MAP_PLACE_CATEGORIES.includes(key), "unknown category");
const latitude = z.number().finite().min(WEST_BANK_BOUNDS.minLatitude).max(WEST_BANK_BOUNDS.maxLatitude);
const longitude = z.number().finite().min(WEST_BANK_BOUNDS.minLongitude).max(WEST_BANK_BOUNDS.maxLongitude);
const phone = z.union([z.string().trim().regex(/^[+\d][\d\s().-]{4,30}$/), z.null(), z.literal("")]).transform((value) => (value ? value : null));

const createSchema = z
  .strictObject({
    category,
    name_ar: nullableText(191).optional(),
    name_en: nullableText(191).optional(),
    latitude,
    longitude,
    phone: phone.optional(),
    opening_hours: nullableText(500).optional()
  })
  .refine((value) => Boolean(value.name_ar || value.name_en), { message: "name_required" });

const updateSchema = z
  .strictObject({
    category: category.optional(),
    name_ar: nullableText(191).optional(),
    name_en: nullableText(191).optional(),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    phone: phone.optional(),
    opening_hours: nullableText(500).optional(),
    active: z.boolean().optional()
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: "no_changes" });

const listSchema = z.object({
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(40).optional(),
  city: z.string().trim().max(40).optional(),
  active: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const reportListSchema = z.object({
  status: z.enum(["open", "resolved", "dismissed"]).default("open"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const reportUpdateSchema = z.strictObject({
  status: z.enum(["resolved", "dismissed"]),
  deactivate_place: z.boolean().optional()
});

type Row = {
  id: string;
  category: string;
  name_ar: string | null;
  name_en: string | null;
  latitude: { toString(): string } | number;
  longitude: { toString(): string } | number;
  phone: string | null;
  opening_hours: string | null;
  city: string | null;
  source: string;
  osm_id: string | null;
  active: boolean;
  admin_edited: boolean;
  created_at: Date;
  updated_at: Date;
};

const num = (value: { toString(): string } | number) => Number(value.toString());

function serialize(row: Row) {
  return {
    id: row.id,
    category: row.category,
    name_ar: row.name_ar,
    name_en: row.name_en,
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    phone: row.phone,
    opening_hours: row.opening_hours,
    city: row.city,
    source: row.source,
    osm_id: row.osm_id,
    active: row.active,
    admin_edited: row.admin_edited,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string" || value.length === 0 || value.length > 191) throw new HttpError(400, "invalid_route_param");
  return value;
}

/** Admin side of the map places: browse, edit, add, switch off, and work through user reports. */
export function createAdminMapPlacesRouter() {
  const router = Router();
  router.use("/admin/map-places", requireAuth, requireRole("admin"));
  router.use("/admin/map-place-reports", requireAuth, requireRole("admin"));

  router.get("/admin/map-places/categories", (_req, res) => {
    res.json({ categories: MAP_PLACE_CATEGORIES });
  });

  /** Counts per category, per city and per category and city; the numbers to quote after an import. */
  router.get("/admin/map-places/summary", async (_req, res, next) => {
    try {
      const groups = await prisma.mapPlace.groupBy({ by: ["category", "city", "active"], _count: { _all: true } });
      const byCategory: Record<string, { active: number; inactive: number }> = {};
      const byCity: Record<string, number> = {};
      for (const group of groups) {
        const entry = (byCategory[group.category] ??= { active: 0, inactive: 0 });
        entry[group.active ? "active" : "inactive"] += group._count._all;
        if (group.active) byCity[group.city ?? "other"] = (byCity[group.city ?? "other"] ?? 0) + group._count._all;
      }
      res.json({ by_category: byCategory, by_city: byCity });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/map-places", async (req, res, next) => {
    try {
      const input = listSchema.parse(req.query);
      const where: Prisma.MapPlaceWhereInput = {
        ...(input.category ? { category: input.category } : {}),
        ...(input.city ? { city: input.city } : {}),
        ...(input.active ? { active: input.active === "true" } : {}),
        ...(input.search ? { OR: [{ name_ar: { contains: input.search } }, { name_en: { contains: input.search } }] } : {})
      };
      const [rows, total] = await Promise.all([
        prisma.mapPlace.findMany({
          where,
          orderBy: [{ category: "asc" }, { city: "asc" }, { id: "asc" }],
          skip: (input.page - 1) * input.limit,
          take: input.limit
        }),
        prisma.mapPlace.count({ where })
      ]);
      res.json({ places: rows.map(serialize), page: input.page, limit: input.limit, total });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/map-places", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = createSchema.parse(req.body);
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.mapPlace.create({
          data: {
            category: input.category,
            name_ar: input.name_ar ?? null,
            name_en: input.name_en ?? null,
            latitude: input.latitude,
            longitude: input.longitude,
            phone: input.phone ?? null,
            opening_hours: input.opening_hours ?? null,
            source: "admin",
            admin_edited: true
          }
        });
        await auditEvent(tx, {
          userId: req.user!.id,
          action: AuditAction.admin_action,
          entityType: "MapPlace",
          entityId: row.id,
          metadata: {
            action: "map_place_created",
            category: input.category,
            name_ar: input.name_ar ?? null,
            name_en: input.name_en ?? null,
            latitude: input.latitude,
            longitude: input.longitude,
            request_id: req.requestId ?? null
          }
        });
        return row;
      });
      res.status(201).json({ place: serialize(created) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/map-places/:id", async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = routeParam(req.params.id);
      const input = updateSchema.parse(req.body);
      const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.mapPlace.findUnique({ where: { id } });
        if (!current) throw new HttpError(404, "map_place_not_found");
        const data: Prisma.MapPlaceUpdateInput = {
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.name_ar !== undefined ? { name_ar: input.name_ar } : {}),
          ...(input.name_en !== undefined ? { name_en: input.name_en } : {}),
          ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
          ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.opening_hours !== undefined ? { opening_hours: input.opening_hours } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          // Any edit protects the row from the next import.
          admin_edited: true
        };
        const row = await tx.mapPlace.update({ where: { id }, data });
        await auditEvent(tx, {
          userId: req.user!.id,
          action: AuditAction.admin_action,
          entityType: "MapPlace",
          entityId: id,
          metadata: {
            action: input.active === false ? "map_place_disabled" : input.active === true && !current.active ? "map_place_enabled" : "map_place_updated",
            before: serialize(current as Row),
            changes: input,
            request_id: req.requestId ?? null
          }
        });
        return row;
      });
      res.json({ place: serialize(updated) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/map-place-reports", async (req, res, next) => {
    try {
      const input = reportListSchema.parse(req.query);
      const where = { status: input.status };
      const [rows, total] = await Promise.all([
        prisma.mapPlaceReport.findMany({
          where,
          orderBy: [{ created_at: "desc" }, { id: "asc" }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          include: { place: true }
        }),
        prisma.mapPlaceReport.count({ where })
      ]);
      res.json({
        reports: rows.map((row) => ({
          id: row.id,
          reason: row.reason,
          note: row.note,
          status: row.status,
          created_at: row.created_at,
          resolved_at: row.resolved_at,
          place: serialize(row.place as Row)
        })),
        page: input.page,
        limit: input.limit,
        total
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/map-place-reports/:id", async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = routeParam(req.params.id);
      const input = reportUpdateSchema.parse(req.body);
      const report = await prisma.$transaction(async (tx) => {
        const current = await tx.mapPlaceReport.findUnique({ where: { id } });
        if (!current) throw new HttpError(404, "map_place_report_not_found");
        const row = await tx.mapPlaceReport.update({ where: { id }, data: { status: input.status, resolved_at: new Date() } });
        if (input.deactivate_place) {
          await tx.mapPlace.update({ where: { id: current.place_id }, data: { active: false, admin_edited: true } });
        }
        await auditEvent(tx, {
          userId: req.user!.id,
          action: AuditAction.admin_action,
          entityType: "MapPlaceReport",
          entityId: id,
          metadata: {
            action: "map_place_report_reviewed",
            status: input.status,
            place_id: current.place_id,
            place_deactivated: input.deactivate_place === true,
            request_id: req.requestId ?? null
          }
        });
        return row;
      });
      res.json({ report: { id: report.id, status: report.status, resolved_at: report.resolved_at } });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
