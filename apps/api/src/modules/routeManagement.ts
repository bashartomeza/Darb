import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError, notFoundHandler } from "../middleware/error.js";
import {
  ADMIN_ROUTE_VERSION_HISTORY_LIMIT,
  routeManagementService,
  type RouteManagementService,
  type VersionStopInput
} from "../services/routeManagement.js";
import { routeFareService, type RouteFareService } from "../services/routeFares.js";

const cleanText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).regex(/^[^\u0000-\u001f\u007f]+$/).transform((value) => value.normalize("NFC"));
const optionalText = (maximum: number) => cleanText(maximum).nullable().optional();
const normalizedKey = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .transform((value) => value.toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-"))
  .refine((value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value), "Invalid key");
const id = z.string().min(1).max(191);
const dateValue = z.string().datetime({ offset: true }).transform((value) => new Date(value)).nullable().optional();
const pagination = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25)
};
const idempotencyKey = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);

const routeListSchema = z.strictObject({
  ...pagination,
  search: cleanText(160).optional(),
  status: z.enum(["active", "retired"]).optional(),
  direction: z.enum(["outbound", "inbound", "loop"]).optional(),
  service_region_key: normalizedKey.optional()
});
const createRouteSchema = z.strictObject({
  route_key: normalizedKey,
  route_group_key: normalizedKey,
  service_region_key: normalizedKey,
  direction: z.enum(["outbound", "inbound", "loop"])
});
const createVersionSchema = z
  .strictObject({
    name_ar: cleanText(160).optional(),
    name_en: cleanText(160).optional(),
    description_ar: optionalText(2_000),
    description_en: optionalText(2_000),
    active_from: dateValue,
    active_until: dateValue,
    clone_from_version_id: id.optional()
  })
  .refine((value) => Boolean(value.clone_from_version_id || (value.name_ar && value.name_en)), {
    message: "Bilingual names are required for a new draft"
  });
const updateVersionSchema = z.strictObject({
  expected_revision: z.number().int().positive(),
  name_ar: cleanText(160),
  name_en: cleanText(160),
  description_ar: optionalText(2_000),
  description_en: optionalText(2_000),
  active_from: dateValue,
  active_until: dateValue
});
const versionStopSchema = z.strictObject({
  stop_id: id,
  sequence: z.number().int().positive(),
  passenger_pickup_allowed: z.boolean(),
  passenger_dropoff_allowed: z.boolean(),
  parcel_pickup_allowed: z.boolean(),
  parcel_dropoff_allowed: z.boolean(),
  estimated_offset_seconds: z.number().int().nonnegative().nullable().optional(),
  dwell_seconds: z.number().int().nonnegative().nullable().optional()
});
const replaceStopsSchema = z.strictObject({
  expected_revision: z.number().int().positive(),
  stops: z.array(versionStopSchema).min(2).max(100)
});
const publishSchema = z.strictObject({
  expected_revision: z.number().int().positive(),
  expected_current_version_id: id.nullable()
});
const currentVersionExpectation = z.strictObject({ expected_current_version_id: id.nullable() });
const pauseSchema = currentVersionExpectation.extend({ reason: cleanText(500) });
const resumeSchema = currentVersionExpectation;
const retireVersionSchema = pauseSchema;
const retireRouteSchema = z.strictObject({
  reason: cleanText(500),
  expected_current_version_id: z.null()
});
const reasonSchema = z.strictObject({ reason: cleanText(500) });
const stopListSchema = z.strictObject({
  ...pagination,
  search: cleanText(160).optional(),
  status: z.enum(["active", "retired"]).optional(),
  service_region_key: normalizedKey.optional()
});
const stopSchema = z.strictObject({
  stop_key: normalizedKey,
  service_region_key: normalizedKey,
  name_ar: cleanText(160),
  name_en: cleanText(160),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180)
});
const updateStopSchema = stopSchema.omit({ stop_key: true });
const publicListSchema = z.strictObject(pagination);

function pathId(req: AuthenticatedRequest) {
  return id.parse(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
}

function writeActor(req: AuthenticatedRequest) {
  const key = idempotencyKey.safeParse(req.header("idempotency-key"));
  if (!key.success) throw new HttpError(400, "invalid_or_missing_idempotency_key");
  return { id: req.user!.id, requestId: req.requestId, idempotencyKey: key.data };
}

function editActor(req: AuthenticatedRequest) {
  return { id: req.user!.id, requestId: req.requestId };
}

function coordinate(value: unknown) {
  const numeric = typeof value === "object" && value && "toFixed" in value
    ? Number((value as { toFixed(digits: number): string }).toFixed(6))
    : Number(Number(value).toFixed(6));
  return numeric;
}

// Public callers see coordinates only once maps are switched on; admins always
// do. Before M7D the public catalog withheld them unconditionally — see
// docs/api/route-catalog.md for why that changed.
function serializeStop(stop: Record<string, unknown>, admin = true, maps = false) {
  const geo = admin || maps;
  return {
    id: stop.id,
    stop_key: admin ? stop.stop_key : undefined,
    service_region_key: admin ? stop.service_region_key : undefined,
    name_ar: stop.name_ar,
    name_en: stop.name_en,
    latitude: geo ? coordinate(stop.latitude) : undefined,
    longitude: geo ? coordinate(stop.longitude) : undefined,
    status: admin ? stop.status : undefined,
    retired_at: admin ? stop.retired_at : undefined,
    created_at: admin ? stop.created_at : undefined,
    updated_at: admin ? stop.updated_at : undefined
  };
}

function serializeMembership(membership: Record<string, unknown>, admin = true, maps = false) {
  return {
    id: admin ? membership.id : undefined,
    stop_id: admin ? membership.stop_id : undefined,
    sequence: membership.sequence,
    passenger_pickup_allowed: membership.passenger_pickup,
    passenger_dropoff_allowed: membership.passenger_dropoff,
    parcel_pickup_allowed: membership.parcel_pickup,
    parcel_dropoff_allowed: membership.parcel_dropoff,
    estimated_offset_seconds: admin
      ? membership.scheduled_offset_seconds
      : undefined,
    dwell_seconds: admin ? membership.dwell_seconds : undefined,
    stop: serializeStop(membership.stop as Record<string, unknown>, admin, maps)
  };
}

// Only released once the geometry pipeline marks a version `available`; a
// pending or unavailable version reports its status and no points, so clients
// fall back to the ordered stops rather than drawing an invented line.
function serializeGeometry(version: Record<string, unknown>) {
  const ready = version.geometry_status === "available";
  return {
    status: version.geometry_status,
    ready,
    encoding: ready ? version.geometry_encoding : null,
    encoded: ready ? version.encoded_geometry : null,
    precision: version.geometry_precision,
    estimated_distance_m: version.estimated_distance_meters,
    estimated_duration_s: version.estimated_duration_seconds
  };
}

function serializeVersion(version: Record<string, unknown>, admin = true, detail = true, maps = false) {
  const stops = Array.isArray(version.stops)
    ? (version.stops as Array<Record<string, unknown>>)
        .slice(0, 100)
        .map((membership) => serializeMembership(membership, admin, maps))
    : [];
  const count = version._count as { driver_routes?: number } | undefined;
  return {
    id: version.id,
    service_route_id: admin && detail ? version.service_route_id : undefined,
    version_number: version.version_number,
    status: version.status,
    name_ar: version.name_ar,
    name_en: version.name_en,
    description_ar: admin && detail ? version.description_ar : undefined,
    description_en: admin && detail ? version.description_en : undefined,
    active_from: version.active_from,
    active_until: version.active_until,
    origin_stop_id: admin && detail ? version.origin_stop_id : undefined,
    destination_stop_id: admin && detail ? version.destination_stop_id : undefined,
    geometry: detail && (admin || maps)
      ? admin ? {
          status: version.geometry_status,
          ready: version.geometry_status === "available",
          precision: version.geometry_precision,
          estimated_distance_m: version.estimated_distance_meters,
          estimated_duration_s: version.estimated_duration_seconds
        } : serializeGeometry(version)
      : undefined,
    draft_revision: admin && detail ? version.draft_revision : undefined,
    stop_count: admin ? stops.length : undefined,
    stops: detail ? stops : undefined,
    driver_availability_count: admin && detail ? (count?.driver_routes ?? 0) : undefined,
    published_at: admin ? version.published_at : undefined,
    paused_at: admin ? version.paused_at : undefined,
    pause_reason: admin && detail ? version.pause_reason : undefined,
    retired_at: admin ? version.retired_at : undefined,
    retirement_reason: admin && detail ? version.retirement_reason : undefined,
    created_at: admin && detail ? version.created_at : undefined,
    updated_at: admin && detail ? version.updated_at : undefined
  };
}

function serializeRoute(route: Record<string, unknown>, admin = true, detail = true, maps = false) {
  const current = route.current_version as Record<string, unknown> | null | undefined;
  const versions = Array.isArray(route.versions)
    ? detail
      ? (route.versions as Array<Record<string, unknown>>)
        .slice(0, ADMIN_ROUTE_VERSION_HISTORY_LIMIT)
        .map((version) => serializeVersion(version, true))
      : undefined
    : undefined;
  const count = route._count as { versions?: number } | undefined;
  return {
    id: route.id,
    route_key: admin ? route.route_key : undefined,
    route_group_key: admin ? route.route_group_key : undefined,
    service_region_key: admin ? route.service_region_key : undefined,
    direction: route.direction,
    status: route.status,
    current_version_id: admin ? route.current_version_id : undefined,
    current_version: current ? serializeVersion(current, admin, detail, maps) : null,
    version_count: admin ? (count?.versions ?? versions?.length ?? 0) : undefined,
    versions: admin ? versions : undefined,
    retired_at: admin ? route.retired_at : undefined,
    retirement_reason: admin ? route.retirement_reason : undefined,
    created_at: admin ? route.created_at : undefined,
    updated_at: admin ? route.updated_at : undefined
  };
}

function versionInput(input: z.infer<typeof createVersionSchema>) {
  return {
    nameAr: input.name_ar ?? "",
    nameEn: input.name_en ?? "",
    descriptionAr: input.description_ar,
    descriptionEn: input.description_en,
    activeFrom: input.active_from,
    activeUntil: input.active_until,
    cloneFromVersionId: input.clone_from_version_id
  };
}

function stopInput(input: z.infer<typeof stopSchema>) {
  return {
    stopKey: input.stop_key,
    serviceRegionKey: input.service_region_key,
    nameAr: input.name_ar,
    nameEn: input.name_en,
    latitude: input.latitude.toFixed(6),
    longitude: input.longitude.toFixed(6)
  };
}

function routeDisabledHandler(): RequestHandler {
  return notFoundHandler;
}

export function createAdminRouteManagementRouter(
  appConfig: AppConfig,
  service: RouteManagementService = routeManagementService
) {
  const router = Router();
  if (!appConfig.routeManagementEnabled) {
    router.use("/admin/service-routes", routeDisabledHandler());
    router.use("/admin/route-versions", routeDisabledHandler());
    router.use("/admin/stops", routeDisabledHandler());
    return router;
  }
  router.use(["/admin/service-routes", "/admin/route-versions", "/admin/stops"], requireAuth, requireRole("admin"));

  router.get("/admin/service-routes", async (req, res, next) => {
    try {
      const input = routeListSchema.parse(req.query);
      const result = await service.listAdminRoutes({
        page: input.page,
        limit: input.limit,
        search: input.search,
        status: input.status,
        direction: input.direction,
        serviceRegionKey: input.service_region_key
      });
      res.json({ ...result, routes: result.routes.map((route) => serializeRoute(route as unknown as Record<string, unknown>, true, false)) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/service-routes", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = createRouteSchema.parse(req.body);
      const result = await service.createRoute(
        {
          routeKey: input.route_key,
          routeGroupKey: input.route_group_key,
          serviceRegionKey: input.service_region_key,
          direction: input.direction
        },
        writeActor(req)
      );
      res.status(result.replayed ? 200 : 201).json({
        route: serializeRoute(result.resource as unknown as Record<string, unknown>),
        replayed: result.replayed,
        request_id: req.requestId
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/service-routes/:id", async (req: AuthenticatedRequest, res, next) => {
    try {
      const route = await service.getAdminRoute(pathId(req));
      res.json({ route: serializeRoute(route as unknown as Record<string, unknown>) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/service-routes/:id/versions", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = createVersionSchema.parse(req.body);
      const result = await service.createVersion(pathId(req), versionInput(input), writeActor(req));
      res.status(result.replayed ? 200 : 201).json({
        version: serializeVersion(result.resource as unknown as Record<string, unknown>),
        replayed: result.replayed,
        request_id: req.requestId
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/service-routes/:id/retire", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = retireRouteSchema.parse(req.body);
      const result = await service.retireRoute(
        pathId(req),
        { reason: input.reason, expectedCurrentVersionId: input.expected_current_version_id },
        writeActor(req)
      );
      res.json({ route: serializeRoute(result.resource as unknown as Record<string, unknown>), replayed: result.replayed, request_id: req.requestId });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/route-versions/:id", async (req: AuthenticatedRequest, res, next) => {
    try {
      const version = await service.getAdminVersion(pathId(req));
      res.json({ version: serializeVersion(version as unknown as Record<string, unknown>) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/route-versions/:id", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = updateVersionSchema.parse(req.body);
      const version = await service.updateDraft(
        pathId(req),
        {
          expectedRevision: input.expected_revision,
          nameAr: input.name_ar,
          nameEn: input.name_en,
          descriptionAr: input.description_ar,
          descriptionEn: input.description_en,
          activeFrom: input.active_from,
          activeUntil: input.active_until
        },
        editActor(req)
      );
      res.json({ version: serializeVersion(version as unknown as Record<string, unknown>), request_id: req.requestId });
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/route-versions/:id/stops", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = replaceStopsSchema.parse(req.body);
      const stops: VersionStopInput[] = input.stops.map((stop) => ({
        stopId: stop.stop_id,
        sequence: stop.sequence,
        passengerPickupAllowed: stop.passenger_pickup_allowed,
        passengerDropoffAllowed: stop.passenger_dropoff_allowed,
        parcelPickupAllowed: stop.parcel_pickup_allowed,
        parcelDropoffAllowed: stop.parcel_dropoff_allowed,
        estimatedOffsetSeconds: stop.estimated_offset_seconds,
        dwellSeconds: stop.dwell_seconds
      }));
      const version = await service.replaceStops(pathId(req), input.expected_revision, stops, editActor(req));
      res.json({ version: serializeVersion(version as unknown as Record<string, unknown>), request_id: req.requestId });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/route-versions/:id/publish", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = publishSchema.parse(req.body);
      const result = await service.publishVersion(
        pathId(req),
        { expectedRevision: input.expected_revision, expectedCurrentVersionId: input.expected_current_version_id },
        writeActor(req)
      );
      res.json({ version: serializeVersion(result.resource as unknown as Record<string, unknown>), replayed: result.replayed, request_id: req.requestId });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/route-versions/:id/pause", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = pauseSchema.parse(req.body);
      const result = await service.pauseVersion(
        pathId(req),
        { reason: input.reason, expectedCurrentVersionId: input.expected_current_version_id },
        writeActor(req)
      );
      res.json({ version: serializeVersion(result.resource as unknown as Record<string, unknown>), replayed: result.replayed, request_id: req.requestId });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/route-versions/:id/resume", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = resumeSchema.parse(req.body);
      const result = await service.resumeVersion(
        pathId(req),
        { expectedCurrentVersionId: input.expected_current_version_id },
        writeActor(req)
      );
      res.json({ version: serializeVersion(result.resource as unknown as Record<string, unknown>), replayed: result.replayed, request_id: req.requestId });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/route-versions/:id/retire", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = retireVersionSchema.parse(req.body);
      const result = await service.retireVersion(
        pathId(req),
        { reason: input.reason, expectedCurrentVersionId: input.expected_current_version_id },
        writeActor(req)
      );
      res.json({ version: serializeVersion(result.resource as unknown as Record<string, unknown>), replayed: result.replayed, request_id: req.requestId });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/stops", async (req, res, next) => {
    try {
      const input = stopListSchema.parse(req.query);
      const result = await service.listStops({
        page: input.page,
        limit: input.limit,
        search: input.search,
        status: input.status,
        serviceRegionKey: input.service_region_key
      });
      res.json({ ...result, stops: result.stops.map((stop) => serializeStop(stop as unknown as Record<string, unknown>)) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/stops", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = stopSchema.parse(req.body);
      const result = await service.createStop(stopInput(input), writeActor(req));
      res.status(result.replayed ? 200 : 201).json({ stop: serializeStop(result.resource as unknown as Record<string, unknown>), replayed: result.replayed, request_id: req.requestId });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/stops/:id", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = updateStopSchema.parse(req.body);
      const stop = await service.updateStop(
        pathId(req),
        {
          serviceRegionKey: input.service_region_key,
          nameAr: input.name_ar,
          nameEn: input.name_en,
          latitude: input.latitude.toFixed(6),
          longitude: input.longitude.toFixed(6)
        },
        editActor(req)
      );
      res.json({ stop: serializeStop(stop as unknown as Record<string, unknown>), request_id: req.requestId });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/stops/:id/retire", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = reasonSchema.parse(req.body);
      const result = await service.retireStop(pathId(req), input.reason, writeActor(req));
      res.json({ stop: serializeStop(result.resource as unknown as Record<string, unknown>), replayed: result.replayed, request_id: req.requestId });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createRouteCatalogRouter(
  appConfig: AppConfig,
  service: RouteManagementService = routeManagementService,
  fareService: RouteFareService = routeFareService
) {
  const router = Router();
  const maps = appConfig.mapsEnabled && appConfig.routeManagementEnabled;
  router.use(["/routes", "/route-versions"], requireAuth);

  router.get("/routes", async (req, res, next) => {
    try {
      const input = publicListSchema.parse(req.query);
      if (!appConfig.routeManagementEnabled) {
        res.json({ routes: [], page: input.page, limit: input.limit, total: 0, enabled: false });
        return;
      }
      const result = await service.listPublishedRoutes(input.page, input.limit);
      // Display-only estimate; null until an admin publishes a tariff for the route.
      const fares = await fareService.fareViewsForRoutes(result.routes.map((route) => route.id));
      res.json({
        ...result,
        enabled: true,
        routes: result.routes.map((route) => ({
          ...serializeRoute(route as unknown as Record<string, unknown>, false, true, maps),
          fares: fares.get(route.id) ?? null
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/routes/:id", async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!appConfig.routeManagementEnabled) throw new HttpError(404, "route_not_found");
      const route = await service.getPublishedRoute(pathId(req));
      const fares = await fareService.fareViewsForRoutes([route.id]);
      res.json({
        route: {
          ...serializeRoute(route as unknown as Record<string, unknown>, false, true, maps),
          fares: fares.get(route.id) ?? null
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/route-versions/:id/stops", async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!appConfig.routeManagementEnabled) throw new HttpError(404, "route_version_not_found");
      const version = await service.getPublishedVersionStops(pathId(req));
      res.json({
        route_version_id: version.id,
        stops: version.stops.map((membership) => serializeMembership(membership as unknown as Record<string, unknown>, false, maps))
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const routeManagementSerializers = { serializeRoute, serializeVersion, serializeStop };
