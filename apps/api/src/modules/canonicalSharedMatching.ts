import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { CanonicalRejectReason } from "../generated/prisma/enums.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError, notFoundHandler } from "../middleware/error.js";
import {
  canonicalSharedMatchingService,
  SHARED_MATCH_VERSION,
  type CanonicalSharedMatchingService
} from "../services/canonicalSharedMatching.js";

const id = z.string().min(1).max(191);
const page = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25)
});
const rejectBody = z.strictObject({ reason: z.nativeEnum(CanonicalRejectReason) });
const key = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);

function requireKey(req: AuthenticatedRequest) {
  const parsed = key.safeParse(req.header("idempotency-key"));
  if (!parsed.success) throw new HttpError(400, "invalid_or_missing_idempotency_key");
  return parsed.data;
}

function aggregateOfferResponse(offer: Record<string, any>) {
  if (offer.canonical_match_version !== SHARED_MATCH_VERSION || !offer.canonical_manifest) {
    throw new HttpError(409, "canonical_shared_offer_version_mismatch");
  }
  const manifest = offer.canonical_manifest;
  const composition =
    manifest.passenger_request_count > 0 && manifest.merchant_order_count > 0
      ? "mixed"
      : manifest.passenger_request_count > 0
        ? "passenger_only"
        : "merchant_only";
  const stopEvents = new Map<string, {
    stop_id: string;
    passenger_pickups: number;
    passenger_drop_offs: number;
    parcel_pickups: number;
    parcel_destinations: number;
  }>();
  const event = (stopId: string) => {
    const current = stopEvents.get(stopId) ?? {
      stop_id: stopId,
      passenger_pickups: 0,
      passenger_drop_offs: 0,
      parcel_pickups: 0,
      parcel_destinations: 0
    };
    stopEvents.set(stopId, current);
    return current;
  };
  for (const member of manifest.members) {
    if (member.demand_type === "passenger") {
      event(member.pickup_stop_id).passenger_pickups += member.passenger_seats;
      event(member.drop_off_stop_id).passenger_drop_offs += member.passenger_seats;
    } else {
      event(member.pickup_stop_id).parcel_pickups += member.parcel_units;
      const destinations = (member.destination_summary_json as { stop_ids?: string[] } | null)
        ?.stop_ids ?? [];
      for (const stopId of destinations) event(stopId).parcel_destinations += 1;
    }
  }
  const routeStops = new Map(
    (offer.route_version?.stops ?? []).map((membership: Record<string, any>) => [
      membership.stop?.id,
      {
        sequence: membership.sequence,
        name_ar: membership.stop?.name_ar,
        name_en: membership.stop?.name_en
      }
    ])
  );
  return {
    id: offer.id,
    offer_version: offer.canonical_match_version,
    status: offer.status === "sent_to_driver" ? "offered" : offer.status,
    composition,
    route_version_id: offer.route_version_id,
    route: offer.route_version
      ? {
          id: offer.route_version.id,
          name_ar: offer.route_version.name_ar,
          name_en: offer.route_version.name_en,
          direction: offer.route_version.service_route?.direction,
          stops: offer.route_version.stops.map((membership: Record<string, any>) => ({
            id: membership.stop?.id,
            name_ar: membership.stop?.name_ar,
            name_en: membership.stop?.name_en,
            sequence: membership.sequence
          }))
        }
      : null,
    departure_at: offer.driver_route?.departure_at,
    offered_at: offer.offered_at,
    expires_at: offer.expires_at,
    accepted_at: offer.accepted_at,
    rejected_at: offer.rejected_at,
    expired_at: offer.expired_at,
    reject_reason: offer.reject_reason,
    passenger_request_count: manifest.passenger_request_count,
    passenger_seat_count: manifest.passenger_seat_count,
    merchant_order_count: manifest.merchant_order_count,
    parcel_unit_count: manifest.parcel_unit_count,
    stop_events: [...stopEvents.values()]
      .map((value) => {
        const stop = routeStops.get(value.stop_id) as
          | { sequence: number; name_ar: string; name_en: string }
          | undefined;
        if (!stop) throw new HttpError(409, "canonical_shared_offer_stop_mismatch");
        const { stop_id: _stopId, ...counts } = value;
        return { ...counts, ...stop };
      })
      .sort((left, right) => left.sequence - right.sequence),
    trip: manifest.assigned_trip
      ? {
          id: manifest.assigned_trip.id,
          status: manifest.assigned_trip.status,
          trip_version: manifest.assigned_trip.canonical_trip_version,
          route_version_id: manifest.assigned_trip.route_version_id,
          departure_at: manifest.assigned_trip.driver_route?.departure_at,
          vehicle_type: manifest.assigned_trip.driver_route?.driver?.vehicle_type,
          created_at: manifest.assigned_trip.created_at
        }
      : null,
    created_at: offer.created_at
  };
}

export function createCanonicalSharedMatchingRouter(
  appConfig: AppConfig,
  service: CanonicalSharedMatchingService = canonicalSharedMatchingService
) {
  const router = Router();
  // The old "/driver/canonical-shared-match-offers" alias was removed: no client used it.
  const paths = ["/driver/canonical-shared-offers"] as const;
  if (!appConfig.canonicalSharedTripMobileEnabled) {
    for (const path of paths) router.use(path, notFoundHandler);
    return router;
  }
  for (const path of paths) {
    router.get(path, requireAuth, requireRole("driver"), async (req: AuthenticatedRequest, res, next) => {
      try {
        const query = page.parse(req.query);
        await service.assertDriverEligible(req.user!.id);
        const result = await service.listDriverOfferPage(req.user!.id, query);
        res.json({
          offers: result.offers.map(aggregateOfferResponse),
          next_cursor: result.nextCursor,
          server_now: new Date(),
          request_id: req.requestId
        });
      } catch (error) { next(error); }
    });
    router.get(`${path}/:id`, requireAuth, requireRole("driver"), async (req: AuthenticatedRequest, res, next) => {
      try {
        await service.assertDriverEligible(req.user!.id);
        const offer = await service.getDriverOffer(req.user!.id, id.parse(req.params.id));
        res.json({
          offer: aggregateOfferResponse(offer),
          server_now: new Date(),
          request_id: req.requestId
        });
      } catch (error) { next(error); }
    });
    router.post(`${path}/:id/accept`, requireAuth, requireRole("driver"), async (req: AuthenticatedRequest, res, next) => {
      try {
        await service.assertDriverEligible(req.user!.id);
        const offerId = id.parse(req.params.id);
        const result = await service.accept(req.user!.id, offerId, {
          id: req.user!.id,
          requestId: req.requestId,
          idempotencyKey: requireKey(req)
        });
        const offer = await service.getDriverOffer(req.user!.id, offerId);
        res.json({
          offer: aggregateOfferResponse(offer),
          trip: {
            id: result.trip.id,
            status: result.trip.status,
            trip_version: result.trip.canonical_trip_version,
            route_version_id: result.trip.route_version_id
          },
          replayed: result.replayed,
          server_now: new Date(),
          request_id: req.requestId
        });
      } catch (error) { next(error); }
    });
    router.post(`${path}/:id/reject`, requireAuth, requireRole("driver"), async (req: AuthenticatedRequest, res, next) => {
      try {
        await service.assertDriverEligible(req.user!.id);
        const offerId = id.parse(req.params.id);
        const body = rejectBody.parse(req.body);
        const result = await service.reject(req.user!.id, offerId, body.reason, {
          id: req.user!.id,
          requestId: req.requestId,
          idempotencyKey: requireKey(req)
        });
        const offer = await service.getDriverOffer(req.user!.id, offerId);
        res.json({
          offer: aggregateOfferResponse(offer),
          replayed: result.replayed,
          server_now: new Date(),
          request_id: req.requestId
        });
      } catch (error) { next(error); }
    });
  }
  return router;
}

export const canonicalSharedSerializers = { aggregateOfferResponse };

