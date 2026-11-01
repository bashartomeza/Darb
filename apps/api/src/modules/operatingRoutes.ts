import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import {
  createCity,
  createOperatingRoutes,
  ensurePredefinedRoutes,
  listActiveOperatingRoutes,
  listAdminOperatingRoutes,
  listCities,
  serializeOperatingRoute,
  setOperatingRouteActive
} from "../services/operatingRoutes.js";

const idSchema = z.string().trim().min(1).max(191);
const noControlCharacters = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);
const cityName = z.string().trim().min(2).max(80).refine(noControlCharacters);

const createRouteSchema = z.strictObject({
  origin_city_id: idSchema,
  destination_city_id: idSchema,
  both_directions: z.boolean().default(false)
});
const toggleSchema = z.strictObject({ active: z.boolean() });
const createCitySchema = z.strictObject({
  name_ar: cityName,
  name_en: cityName,
  latitude: z.number().finite(),
  longitude: z.number().finite()
});

function pathId(value: string | string[] | undefined) {
  if (typeof value !== "string" || value.length > 191) throw new HttpError(400, "invalid_route_param");
  return value;
}

/**
 * The predefined routes every order names. The list is public (no sign-in) so
 * the apps can show it before an account exists; writes that name a route
 * check it themselves and answer `409 route_unavailable`.
 */
export function createOperatingRoutesRouter(db: PrismaClient = prisma) {
  const router = Router();

  router.get("/operating-routes", async (_req, res, next) => {
    try {
      const routes = await listActiveOperatingRoutes(db);
      res.json({ routes: routes.map(serializeOperatingRoute) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/** Admin management of operating routes and cities. Not gated by ROUTE_MANAGEMENT_ENABLED. */
export function createAdminOperatingRoutesRouter(db: PrismaClient = prisma) {
  const router = Router();
  router.use(["/admin/operating-routes", "/admin/cities"], requireAuth, requireRole("admin"));

  router.get("/admin/operating-routes", async (req: AuthenticatedRequest, res, next) => {
    try {
      // A fresh database may have had no admin when the API started; the first
      // admin to open the list completes the predefined set.
      await ensurePredefinedRoutes(db, req.user!.id);
      res.json({ routes: await listAdminOperatingRoutes(db) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/operating-routes", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = createRouteSchema.parse(req.body);
      const routes = await createOperatingRoutes(
        db,
        { originCityId: input.origin_city_id, destinationCityId: input.destination_city_id, bothDirections: input.both_directions },
        { id: req.user!.id, requestId: req.requestId }
      );
      res.status(201).json({ routes });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/operating-routes/:id", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = toggleSchema.parse(req.body);
      const route = await setOperatingRouteActive(db, pathId(req.params.id), input.active, {
        id: req.user!.id,
        requestId: req.requestId
      });
      res.json({ route });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/cities", async (_req, res, next) => {
    try {
      res.json({ cities: await listCities(db) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/cities", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = createCitySchema.parse(req.body);
      const city = await createCity(
        db,
        { nameAr: input.name_ar, nameEn: input.name_en, latitude: input.latitude, longitude: input.longitude },
        { id: req.user!.id, requestId: req.requestId }
      );
      res.status(201).json({ city });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
