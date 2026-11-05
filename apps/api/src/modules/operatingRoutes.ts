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
import { routeFareService } from "../services/routeFares.js";
import {
  createCityPlace,
  createPlaceSchema,
  listAdminPlaces,
  listPlaceCities,
  listPlacesForRoute,
  updateCityPlace,
  updatePlaceSchema
} from "../services/cityPlaces.js";

const idSchema = z.string().trim().min(1).max(191);
const noControlCharacters = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);
const cityName = z.string().trim().min(2).max(80).refine(noControlCharacters);

const createRouteSchema = z.strictObject({
  origin_city_id: idSchema,
  destination_city_id: idSchema,
  both_directions: z.boolean().default(false)
});
const toggleSchema = z.strictObject({ active: z.boolean() });
const listPlacesQuery = z.object({
  city_key: z.string().trim().min(1).max(80).optional(),
  search: z.string().trim().max(100).optional()
});
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
      // Each route's default prices and the range drivers may charge within,
      // so prices show before booking and in the driver's route picker.
      const fares = await routeFareService.fareViewsForRoutes(routes.map((route) => route.id), new Date(), db);
      res.json({ routes: routes.map((route) => ({ ...serializeOperatingRoute(route), fares: fares.get(route.id) ?? null })) });
    } catch (error) {
      next(error);
    }
  });

  /**
   * The villages and towns to pick from for one route: pickup places of its
   * origin city and drop-off places of its destination city (so the reverse
   * route lists them the other way round). Public like the route list, and
   * cache-friendly: the body only changes when an admin edits places.
   */
  router.get("/operating-routes/:id/places", async (req, res, next) => {
    try {
      const lang = req.query.lang === "en" ? "en" : "ar";
      res.set("Cache-Control", "public, max-age=300");
      res.json(await listPlacesForRoute(db, pathId(req.params.id), lang));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/** Admin management of operating routes and cities. Not gated by ROUTE_MANAGEMENT_ENABLED. */
export function createAdminOperatingRoutesRouter(db: PrismaClient = prisma) {
  const router = Router();
  router.use(["/admin/operating-routes", "/admin/cities", "/admin/city-places"], requireAuth, requireRole("admin"));

  router.get("/admin/operating-routes", async (req: AuthenticatedRequest, res, next) => {
    try {
      // A fresh database may have had no admin when the API started; the first
      // admin to open the list completes the predefined set.
      await ensurePredefinedRoutes(db, req.user!.id);
      const routes = await listAdminOperatingRoutes(db);
      // Current prices for the list; history and edits use the fares endpoint.
      const fares = await routeFareService.fareViewsForRoutes(routes.map((route) => route.id), new Date(), db);
      res.json({ routes: routes.map((route) => ({ ...route, fares: fares.get(route.id) ?? null })) });
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

  /** Places of every city (or one, or a search), with each city's place counts. Disabled places are included. */
  router.get("/admin/city-places", async (req, res, next) => {
    try {
      const query = listPlacesQuery.parse(req.query);
      const [cities, places] = await Promise.all([
        listPlaceCities(db),
        listAdminPlaces(db, { cityKey: query.city_key, search: query.search })
      ]);
      res.json({ cities, places });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/city-places", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = createPlaceSchema.parse(req.body);
      res.status(201).json({ place: await createCityPlace(db, input, { id: req.user!.id, requestId: req.requestId }) });
    } catch (error) {
      next(error);
    }
  });

  /** Rename, move, reorder, disable or re-enable a place. Places are never deleted. */
  router.patch("/admin/city-places/:id", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = updatePlaceSchema.parse(req.body);
      res.json({ place: await updateCityPlace(db, pathId(req.params.id), input, { id: req.user!.id, requestId: req.requestId }) });
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
