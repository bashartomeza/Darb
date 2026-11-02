import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError, notFoundHandler } from "../middleware/error.js";
import {
  canonicalDemandService,
  type CanonicalDemandService
} from "../services/canonicalDemand.js";
import {
  orderFareResponse,
  parcelFareResponse,
  passengerFareResponse,
  routeFareService,
  type FareView,
  type RouteFareService
} from "../services/routeFares.js";

const idempotencyKeySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const dateTime = z.string().datetime({ offset: true }).transform((value) => new Date(value));

const passengerSchema = z.strictObject({
  route_version_id: z.string().min(1).max(191),
  pickup_stop_id: z.string().min(1).max(191),
  dropoff_stop_id: z.string().min(1).max(191),
  requested_departure_from: dateTime,
  requested_departure_until: dateTime,
  passenger_count: z.number().int().min(1).max(8)
});

const canonicalParcelSchema = z.strictObject({
  destination_stop_id: z.string().min(1).max(191),
  size: z.enum(["S", "M", "L"]),
  priority: z.enum(["low", "normal", "high"]).default("normal")
});

const merchantSchema = z.strictObject({
  route_version_id: z.string().min(1).max(191),
  pickup_stop_id: z.string().min(1).max(191),
  requested_departure_from: dateTime,
  requested_departure_until: dateTime,
  parcels: z.array(canonicalParcelSchema).min(1).max(50)
});

function requireIdempotencyKey(req: AuthenticatedRequest) {
  const parsed = idempotencyKeySchema.safeParse(req.header("idempotency-key"));
  if (!parsed.success) throw new HttpError(400, "invalid_or_missing_idempotency_key");
  return parsed.data;
}

function passengerResponse(resource: Record<string, unknown>) {
  return {
    id: resource.id,
    status: resource.status,
    mode: resource.canonical_entry_version,
    route_version_id: resource.route_version_id,
    pickup_stop_id: resource.pickup_stop_id,
    dropoff_stop_id: resource.dropoff_stop_id,
    requested_departure_from: resource.requested_departure_from,
    requested_departure_until: resource.requested_departure_until,
    passenger_count: resource.passenger_count,
    // Snapshot taken when the request was created; null if no tariff existed then.
    fare: passengerFareResponse(resource),
    created_at: resource.canonical_created_at
  };
}

function merchantResponse(resource: Record<string, unknown>) {
  return {
    id: resource.id,
    status: resource.status,
    mode: resource.canonical_entry_version,
    route_version_id: resource.route_version_id,
    pickup_stop_id: resource.pickup_stop_id,
    requested_departure_from: resource.requested_departure_from,
    requested_departure_until: resource.requested_departure_until,
    created_at: resource.canonical_created_at,
    fare: orderFareResponse(resource.parcels as Array<Record<string, unknown>> | undefined),
    parcels: ((resource.parcels as Array<Record<string, unknown>> | undefined) ?? []).map((parcel) => ({
      id: parcel.id,
      status: parcel.status,
      mode: parcel.canonical_entry_version,
      route_version_id: parcel.route_version_id,
      destination_stop_id: parcel.destination_stop_id,
      size: parcel.size,
      priority: parcel.priority,
      fare: parcelFareResponse(parcel)
    }))
  };
}

const availableDepartureQuery = z.strictObject({
  route_version_id: z.string().min(1).max(191).optional(),
  departure_from: dateTime.optional(),
  departure_until: dateTime.optional(),
  seats: z.coerce.number().int().min(1).max(8).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

/**
 * Driver supply as a passenger may see it.
 *
 * Identity is limited to the driver's display name, vehicle type and trust
 * score — the fields the passenger needs to choose a ride. Phone number and
 * every other account attribute stay server-side.
 */
function availableDepartureResponse(availability: Record<string, any>, fares?: FareView | null) {
  const version = availability.route_version;
  return {
    id: availability.id,
    route_version_id: availability.route_version_id,
    route: version
      ? {
          id: version.id,
          name_ar: version.name_ar,
          name_en: version.name_en,
          direction: version.service_route?.direction,
          fares: fares ?? null,
          stops: (version.stops ?? []).map((membership: Record<string, any>) => ({
            id: membership.stop?.id,
            name_ar: membership.stop?.name_ar,
            name_en: membership.stop?.name_en,
            sequence: membership.sequence,
            passenger_pickup: membership.passenger_pickup,
            passenger_dropoff: membership.passenger_dropoff
          }))
        }
      : null,
    origin_label: availability.origin_label,
    destination_label: availability.destination_label,
    departure_at: availability.departure_at,
    availability_window_end: availability.availability_window_end,
    remaining_seats: availability.remaining_seats,
    remaining_parcel_capacity: availability.remaining_parcel_capacity,
    driver: {
      name: availability.driver?.user?.name,
      vehicle_type: availability.driver?.vehicle_type,
      trust_score: availability.driver?.trust_score,
      verified: availability.driver?.verified
    }
  };
}

export function createCanonicalDemandRouter(
  appConfig: AppConfig,
  service: CanonicalDemandService = canonicalDemandService,
  fareService: RouteFareService = routeFareService
) {
  const router = Router();
  if (!appConfig.multiRouteEntryEnabled) {
    router.use("/passenger/route-requests", notFoundHandler);
    router.use("/passenger/available-departures", notFoundHandler);
    router.use("/merchant/route-orders", notFoundHandler);
    return router;
  }

  router.get(
    "/passenger/available-departures",
    requireAuth,
    requireRole("passenger"),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const query = availableDepartureQuery.parse(req.query);
        const availabilities = await service.listAvailableDepartures({
          routeVersionId: query.route_version_id,
          departureFrom: query.departure_from,
          departureUntil: query.departure_until,
          seats: query.seats,
          limit: query.limit
        });
        const fares = await fareService.fareViewsForRoutes(
          availabilities.flatMap((availability) => {
            const routeId = (availability as unknown as Record<string, any>).route_version?.service_route_id;
            return typeof routeId === "string" ? [routeId] : [];
          })
        );
        res.json({
          departures: availabilities.map((availability) => {
            const record = availability as unknown as Record<string, any>;
            return availableDepartureResponse(record, fares.get(record.route_version?.service_route_id));
          }),
          server_now: new Date(),
          request_id: req.requestId
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/passenger/route-requests",
    requireAuth,
    requireRole("passenger"),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const input = passengerSchema.parse(req.body);
        const result = await service.createPassengerRequest(
          {
            routeVersionId: input.route_version_id,
            pickupStopId: input.pickup_stop_id,
            dropoffStopId: input.dropoff_stop_id,
            requestedDepartureFrom: input.requested_departure_from,
            requestedDepartureUntil: input.requested_departure_until,
            passengerCount: input.passenger_count
          },
          { id: req.user!.id, requestId: req.requestId, idempotencyKey: requireIdempotencyKey(req) }
        );
        res.status(result.replayed ? 200 : 201).json({
          request: passengerResponse(result.resource as unknown as Record<string, unknown>),
          matching:
            appConfig.multiRouteMatchingEnabled && appConfig.canonicalTripCreationEnabled
              ? { enabled: true, status: "pending_internal_dispatch" }
              : { enabled: false, status: "not_active_in_m7c1" },
          replayed: result.replayed,
          request_id: req.requestId
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/merchant/route-orders",
    requireAuth,
    requireRole("merchant"),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const input = merchantSchema.parse(req.body);
        const result = await service.createMerchantOrder(
          {
            routeVersionId: input.route_version_id,
            pickupStopId: input.pickup_stop_id,
            requestedDepartureFrom: input.requested_departure_from,
            requestedDepartureUntil: input.requested_departure_until,
            parcels: input.parcels.map((parcel) => ({
              destinationStopId: parcel.destination_stop_id,
              size: parcel.size,
              priority: parcel.priority
            }))
          },
          { id: req.user!.id, requestId: req.requestId, idempotencyKey: requireIdempotencyKey(req) }
        );
        res.status(result.replayed ? 200 : 201).json({
          order: merchantResponse(result.resource as unknown as Record<string, unknown>),
          batching: { enabled: false, status: "not_active_in_m7c1" },
          matching:
            appConfig.multiRouteMatchingEnabled && appConfig.canonicalTripCreationEnabled
              ? { enabled: true, status: "pending_internal_dispatch" }
              : { enabled: false, status: "not_active_in_m7c1" },
          replayed: result.replayed,
          request_id: req.requestId
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const canonicalDemandSerializers = { passengerResponse, merchantResponse };
