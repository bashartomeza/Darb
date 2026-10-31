import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { CanonicalRejectReason } from "../generated/prisma/enums.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError, notFoundHandler } from "../middleware/error.js";
import {
  CANONICAL_MATCH_VERSION,
  canonicalMatchingService,
  type CanonicalMatchingService
} from "../services/canonicalMatching.js";
import { orderFareResponse, parcelFareResponse, passengerFareResponse } from "../services/routeFares.js";

const id = z.string().min(1).max(191);
const idempotencyKey = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const page = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25)
});
const rejectBody = z.strictObject({ reason: z.nativeEnum(CanonicalRejectReason) });

function requireKey(req: AuthenticatedRequest) {
  const parsed = idempotencyKey.safeParse(req.header("idempotency-key"));
  if (!parsed.success) throw new HttpError(400, "invalid_or_missing_idempotency_key");
  return parsed.data;
}

function offerResponse(offer: Record<string, any>) {
  if (offer.canonical_match_version !== CANONICAL_MATCH_VERSION) {
    throw new HttpError(409, "canonical_offer_version_mismatch");
  }
  const passenger = offer.passenger_request;
  const merchant = offer.merchant_order;
  return {
    id: offer.id,
    offer_version: offer.canonical_match_version,
    status:
      offer.status === "sent_to_driver"
        ? "offered"
        : offer.status,
    demand_type: passenger ? "passenger" : "merchant_order",
    route_version_id: offer.route_version_id,
    attempt_number: offer.attempt_number,
    offered_at: offer.offered_at,
    expires_at: offer.expires_at,
    accepted_at: offer.accepted_at,
    rejected_at: offer.rejected_at,
    expired_at: offer.expired_at,
    reject_reason: offer.reject_reason,
    created_at: offer.created_at,
    departure_at: offer.driver_route?.departure_at,
    route: routeResponse(offer.route_version),
    demand: passenger
      ? {
          passenger_count: passenger.passenger_count,
          pickup_stop_id: passenger.pickup_stop_id,
          dropoff_stop_id: passenger.dropoff_stop_id,
          requested_departure_from: passenger.requested_departure_from,
          requested_departure_until: passenger.requested_departure_until,
          // Frozen at request time; shown to the driver before accepting. Estimate only.
          fare: passengerFareResponse(passenger)
        }
      : {
          parcel_count: merchant?._count?.parcels ?? merchant?.parcels?.length,
          pickup_stop_id: merchant?.pickup_stop_id,
          destination_stop_ids: merchant?.parcels?.map((parcel: Record<string, unknown>) => parcel.destination_stop_id),
          requested_departure_from: merchant?.requested_departure_from,
          requested_departure_until: merchant?.requested_departure_until,
          parcels: (merchant?.parcels ?? []).map((parcel: Record<string, unknown>) => ({
            destination_stop_id: parcel.destination_stop_id,
            size: parcel.size,
            fare: parcelFareResponse(parcel)
          })),
          fare: orderFareResponse(merchant?.parcels)
        },
    trip: tripResponse(offer.canonical_trip)
  };
}

function routeResponse(version: Record<string, any> | null | undefined) {
  if (!version) return null;
  return {
    id: version.id,
    name_ar: version.name_ar,
    name_en: version.name_en,
    direction: version.service_route?.direction,
    stops: (version.stops ?? []).map((membership: Record<string, any>) => ({
      id: membership.stop?.id,
      name_ar: membership.stop?.name_ar,
      name_en: membership.stop?.name_en,
      sequence: membership.sequence
    }))
  };
}

function tripResponse(trip: Record<string, any> | null | undefined) {
  if (!trip) return null;
  return {
    id: trip.id,
    status: trip.status,
    ...(typeof trip.canonical_trip_version === "string"
      ? {
          trip_version: trip.canonical_trip_version,
          shared_trip:
            trip.canonical_trip_version === "canonical_shared_trip_v1"
              ? true
              : trip.canonical_trip_version === "canonical_route_trip_v1"
                ? false
                : null
        }
      : {}),
    route_version_id: trip.route_version_id,
    departure_at: trip.driver_route?.departure_at,
    vehicle_type: trip.driver_route?.driver?.vehicle_type,
    created_at: trip.created_at
  };
}

function statusResponse(resource: Record<string, any>, sharedPresentationAvailable = true) {
  const dispatch = resource.canonical_dispatch;
  const assignedTrip = dispatch?.assigned_trip;
  const trip =
    assignedTrip?.canonical_trip_version === "canonical_shared_trip_v1" &&
    !sharedPresentationAvailable
      ? null
      : assignedTrip;
  return {
    id: resource.id,
    status: resource.status,
    route_version_id: resource.route_version_id,
    route: routeResponse(resource.route_version),
    pickup_stop_id: resource.pickup_stop_id,
    dropoff_stop_id: resource.dropoff_stop_id,
    requested_departure_from: resource.requested_departure_from,
    requested_departure_until: resource.requested_departure_until,
    dispatch_status: dispatch?.status ?? "pending",
    offer_pending: dispatch?.status === "offered",
    assigned: dispatch?.status === "assigned",
    assignment_trip_version:
      typeof assignedTrip?.canonical_trip_version === "string"
        ? assignedTrip.canonical_trip_version
        : null,
    passenger_count: resource.passenger_count,
    fare: resource.parcels ? orderFareResponse(resource.parcels) : passengerFareResponse(resource),
    trip: tripResponse(trip),
    created_at: resource.canonical_created_at ?? resource.created_at,
    updated_at: dispatch?.updated_at ?? resource.created_at,
    ...(resource.parcels
      ? {
          parcels: resource.parcels.map((parcel: Record<string, unknown>) => ({
            id: parcel.id,
            status: parcel.status,
            destination_stop_id: parcel.destination_stop_id,
            size: parcel.size,
            fare: parcelFareResponse(parcel)
          }))
        }
      : {})
  };
}

export function createCanonicalMatchingRouter(
  appConfig: AppConfig,
  service: CanonicalMatchingService = canonicalMatchingService
) {
  const router = Router();
  if (!appConfig.multiRouteEntryEnabled) {
    router.use("/driver/canonical-match-offers", notFoundHandler);
    router.use("/passenger/route-requests", notFoundHandler);
    router.use("/merchant/route-orders", notFoundHandler);
    return router;
  }

  if (!appConfig.multiRouteMatchingEnabled || !appConfig.canonicalTripCreationEnabled) {
    router.use("/driver/canonical-match-offers", notFoundHandler);
  } else {
  router.get("/driver/canonical-match-offers", requireAuth, requireRole("driver"), async (req: AuthenticatedRequest, res, next) => {
    try {
      const query = page.parse(req.query);
      await service.assertDriverEligible(req.user!.id);
      const result = await service.listDriverOffers(req.user!.id, query);
      res.json({
        offers: result.offers.map((offer) => offerResponse(offer)),
        next_cursor: result.nextCursor,
        server_now: new Date(),
        request_id: req.requestId
      });
    } catch (error) { next(error); }
  });

  router.get("/driver/canonical-match-offers/:id", requireAuth, requireRole("driver"), async (req: AuthenticatedRequest, res, next) => {
    try {
      await service.assertDriverEligible(req.user!.id);
      const offer = await service.getDriverOffer(req.user!.id, id.parse(req.params.id));
      res.json({ offer: offerResponse(offer), server_now: new Date(), request_id: req.requestId });
    } catch (error) { next(error); }
  });

  router.post("/driver/canonical-match-offers/:id/accept", requireAuth, requireRole("driver"), async (req: AuthenticatedRequest, res, next) => {
    try {
      await service.assertDriverEligible(req.user!.id);
      const result = await service.accept(req.user!.id, id.parse(req.params.id), {
        id: req.user!.id,
        requestId: req.requestId,
        idempotencyKey: requireKey(req)
      });
      const offer = await service.getDriverOffer(req.user!.id, id.parse(req.params.id));
      res.json({
        offer: offerResponse(offer),
        trip: tripResponse(offer.canonical_trip) ?? {
          id: result.trip.id,
          status: result.trip.status,
          route_version_id: result.trip.route_version_id
        },
        replayed: result.replayed,
        server_now: new Date(),
        request_id: req.requestId
      });
    } catch (error) { next(error); }
  });

  router.post("/driver/canonical-match-offers/:id/reject", requireAuth, requireRole("driver"), async (req: AuthenticatedRequest, res, next) => {
    try {
      await service.assertDriverEligible(req.user!.id);
      const body = rejectBody.parse(req.body);
      const result = await service.reject(req.user!.id, id.parse(req.params.id), body.reason, {
        id: req.user!.id,
        requestId: req.requestId,
        idempotencyKey: requireKey(req)
      });
      const offer = await service.getDriverOffer(req.user!.id, id.parse(req.params.id));
      res.json({
        offer: offerResponse(offer),
        replayed: result.replayed,
        server_now: new Date(),
        request_id: req.requestId
      });
    } catch (error) { next(error); }
  });
  }

  router.get("/passenger/route-requests", requireAuth, requireRole("passenger"), async (req: AuthenticatedRequest, res, next) => {
    try {
      const query = page.parse(req.query);
      const resources = await service.passengerStatus(req.user!.id, undefined, query.limit);
      res.json({ requests: resources.map((resource) => statusResponse(resource, appConfig.canonicalSharedTripMobileEnabled)), server_now: new Date(), request_id: req.requestId });
    } catch (error) { next(error); }
  });

  router.get("/passenger/route-requests/:id", requireAuth, requireRole("passenger"), async (req: AuthenticatedRequest, res, next) => {
    try {
      const resources = await service.passengerStatus(req.user!.id, id.parse(req.params.id), 1);
      if (!resources[0]) throw new HttpError(404, "canonical_route_request_not_found");
      res.json({ request: statusResponse(resources[0], appConfig.canonicalSharedTripMobileEnabled), server_now: new Date(), request_id: req.requestId });
    } catch (error) { next(error); }
  });

  router.get("/merchant/route-orders", requireAuth, requireRole("merchant"), async (req: AuthenticatedRequest, res, next) => {
    try {
      const query = page.parse(req.query);
      const resources = await service.merchantStatus(req.user!.id, undefined, query.limit);
      res.json({ orders: resources.map((resource) => statusResponse(resource, appConfig.canonicalSharedTripMobileEnabled)), server_now: new Date(), request_id: req.requestId });
    } catch (error) { next(error); }
  });

  router.get("/merchant/route-orders/:id", requireAuth, requireRole("merchant"), async (req: AuthenticatedRequest, res, next) => {
    try {
      const resources = await service.merchantStatus(req.user!.id, id.parse(req.params.id), 1);
      if (!resources[0]) throw new HttpError(404, "canonical_route_order_not_found");
      res.json({ order: statusResponse(resources[0], appConfig.canonicalSharedTripMobileEnabled), server_now: new Date(), request_id: req.requestId });
    } catch (error) { next(error); }
  });
  return router;
}

export const canonicalMatchingSerializers = { offerResponse, statusResponse };
