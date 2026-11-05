import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { pagedWhere, listPageOrderBy, listPageResult, parseListPage } from "../lib/pagination.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { latitudeSchema, legacyLabelSchema, longitudeSchema } from "../lib/validation.js";
import { legacyPassengerCreationService, passengerRequestInclude } from "../services/legacyPassengerCreation.js";
import { cancelPassengerRequest, serializeCancellation } from "../services/cancellations.js";
import { cancelBodySchema } from "../services/cancellationReasons.js";
import { routeFields, serviceRouteIdSchema, type RouteSummary } from "../services/operatingRoutes.js";
import { optionalDetailsSchema, placeIdSchema } from "../services/cityPlaces.js";
import { passengerFareResponse } from "../services/routeFares.js";

/** Older app builds: coordinates for each end; mapped to the Hebron → Bethlehem route. */
const createPassengerRequestSchema = z.object({
  pickup_label: legacyLabelSchema,
  pickup_lat: latitudeSchema,
  pickup_lng: longitudeSchema,
  destination_label: legacyLabelSchema,
  destination_lat: latitudeSchema,
  destination_lng: longitudeSchema,
  preferred_time: z.coerce.date(),
  passenger_count: z.coerce.number().int().min(1).max(4),
  selected_driver_route_id: z.string().trim().min(1).max(191).optional()
});
/**
 * Route-based body: a predefined route, the pickup and drop-off places (ids
 * from GET /operating-routes/:id/places) and optional extra text. Older app
 * builds send text only; see docs/routes/city-places.md.
 */
const createRoutePassengerRequestSchema = z.object({
  service_route_id: serviceRouteIdSchema,
  pickup_place_id: placeIdSchema.optional(),
  dropoff_place_id: placeIdSchema.optional(),
  pickup_details: optionalDetailsSchema,
  dropoff_details: optionalDetailsSchema,
  preferred_time: z.coerce.date(),
  passenger_count: z.coerce.number().int().min(1).max(4),
  selected_driver_route_id: z.string().trim().min(1).max(191).optional()
});

export function parsePassengerRequestBody(body: unknown) {
  return body && typeof body === "object" && "service_route_id" in body
    ? createRoutePassengerRequestSchema.parse(body)
    : createPassengerRequestSchema.parse(body);
}
const idempotencyKeySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional();

export const passengerRouter = Router();

export function serializeLegacyPassengerRequest(value: Record<string, unknown>) {
  return {
    id: value.id,
    passenger_id: value.passenger_id,
    pickup_label: value.pickup_label,
    pickup_lat: value.pickup_lat,
    pickup_lng: value.pickup_lng,
    destination_label: value.destination_label,
    destination_lat: value.destination_lat,
    destination_lng: value.destination_lng,
    preferred_time: value.preferred_time,
    passenger_count: value.passenger_count,
    status: value.status,
    source: value.source,
    selected_driver_route_id: value.selected_driver_route_id ?? null,
    ...routeFields(value.route_version as RouteSummary),
    pickup_details: value.pickup_details ?? null,
    dropoff_details: value.dropoff_details ?? null,
    pickup_place_id: value.pickup_place_id ?? null,
    pickup_place_name_ar: value.pickup_place_name_ar ?? null,
    pickup_place_name_en: value.pickup_place_name_en ?? null,
    dropoff_place_id: value.dropoff_place_id ?? null,
    dropoff_place_name_ar: value.dropoff_place_name_ar ?? null,
    dropoff_place_name_en: value.dropoff_place_name_en ?? null,
    // The seat fare frozen at booking; null when the route had no fare.
    fare: passengerFareResponse(value),
    // Who ended the request and why, once it is cancelled; otherwise null.
    cancellation: value.status === "cancelled" ? serializeCancellation(value.cancellations as never) : null,
    created_at: value.created_at
  };
}

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_route_param");
  }
  return value;
}

passengerRouter.use("/passenger", requireAuth, requireRole("passenger"));

passengerRouter.post("/passenger/requests", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = parsePassengerRequestBody(req.body);
    const idempotencyKey = idempotencyKeySchema.parse(req.header("idempotency-key"));
    const result = await legacyPassengerCreationService.create(input, { id: req.user!.id, idempotencyKey });
    res.status(201).json({ request: serializeLegacyPassengerRequest(result.resource as unknown as Record<string, unknown>) });
  } catch (error) {
    next(error);
  }
});

passengerRouter.get("/passenger/requests", async (req: AuthenticatedRequest, res, next) => {
  try {
    const page = parseListPage(req.query);
    const rows = await prisma.passengerRequest.findMany({
      where: pagedWhere({ passenger_id: req.user!.id, canonical_entry_version: null }, page),
      include: passengerRequestInclude,
      orderBy: listPageOrderBy,
      take: page.limit + 1
    });
    const { items: requests, nextCursor } = listPageResult(rows, page);
    res.json({
      requests: requests.map((request) => serializeLegacyPassengerRequest(request as unknown as Record<string, unknown>)),
      next_cursor: nextCursor
    });
  } catch (error) {
    next(error);
  }
});

passengerRouter.get("/passenger/requests/active", async (req: AuthenticatedRequest, res, next) => {
  try {
    const requests = await prisma.passengerRequest.findMany({
      where: {
        passenger_id: req.user!.id,
        canonical_entry_version: null,
        status: { in: ["pending", "matched", "accepted", "picked_up", "in_transit", "delivered"] }
      },
      include: passengerRequestInclude,
      orderBy: { created_at: "desc" }
    });
    res.json({ requests: requests.map((request) => serializeLegacyPassengerRequest(request as unknown as Record<string, unknown>)) });
  } catch (error) {
    next(error);
  }
});

passengerRouter.get("/passenger/requests/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const requestId = routeParam(req.params.id);
    const request = await prisma.passengerRequest.findFirst({
      where: { id: requestId, passenger_id: req.user!.id, canonical_entry_version: null },
      include: passengerRequestInclude
    });
    if (!request) {
      throw new HttpError(404, "request_not_found");
    }
    res.json({ request: serializeLegacyPassengerRequest(request as unknown as Record<string, unknown>) });
  } catch (error) {
    next(error);
  }
});

passengerRouter.patch("/passenger/requests/:id/cancel", async (req: AuthenticatedRequest, res, next) => {
  try {
    const requestId = routeParam(req.params.id);
    const input = cancelBodySchema("rider").parse(req.body ?? {});
    const request = await prisma.$transaction(async (tx) => {
      await cancelPassengerRequest(tx, {
        requestId,
        ownerId: req.user!.id,
        actor: { userId: req.user!.id, role: "passenger" },
        reason: { code: input.reason, note: input.note },
      });
      return tx.passengerRequest.findUniqueOrThrow({ where: { id: requestId }, include: passengerRequestInclude });
    });

    res.json({ request: serializeLegacyPassengerRequest(request as unknown as Record<string, unknown>) });
  } catch (error) {
    next(error);
  }
});
