import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { routeFareService } from "./routeFares.js";
import {
  requireEligibleOperationalRoute,
  requireMerchantStops,
  requirePassengerStopPair
} from "./operationalRouteEligibility.js";

export const CANONICAL_ENTRY_VERSION = "canonical_route_v1";
export const CANONICAL_ENTRY_LIMITS = {
  earliestDepartureMinutes: 10,
  latestDepartureDays: 30,
  maximumWindowHours: 4,
  maximumPassengerCount: 8,
  maximumParcels: 50
} as const;

type Actor = { id: string; requestId?: string; idempotencyKey: string };

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function validateDepartureWindow(from: Date, until: Date, now = new Date()) {
  const earliest = now.getTime() + CANONICAL_ENTRY_LIMITS.earliestDepartureMinutes * 60_000;
  const latest = now.getTime() + CANONICAL_ENTRY_LIMITS.latestDepartureDays * 86_400_000;
  if (from.getTime() < earliest || from.getTime() > latest) throw new HttpError(400, "departure_window_out_of_range");
  if (until <= from || until.getTime() - from.getTime() > CANONICAL_ENTRY_LIMITS.maximumWindowHours * 3_600_000) {
    throw new HttpError(400, "invalid_departure_window");
  }
}

async function claimCreate(
  tx: Prisma.TransactionClient,
  operation: string,
  actor: Actor,
  payload: unknown
) {
  const claim = await claimIdempotency(tx, {
    operation,
    scopeDigest: digest(`${operation}:${actor.id}`),
    keyDigest: digest(actor.idempotencyKey),
    keyVersion: 1,
    requestDigest: digest(JSON.stringify({ actor_id: actor.id, payload })),
    expiresAt: new Date(Date.now() + 86_400_000),
    retainCompleted: true,
  });
  if (claim.kind === "conflict") throw new HttpError(409, "idempotency_conflict");
  if (claim.kind === "in_progress") throw new HttpError(409, "idempotency_in_progress");
  if (claim.kind === "failed") throw new HttpError(409, "idempotency_failed");
  return claim;
}

export type CanonicalPassengerInput = {
  routeVersionId: string;
  pickupStopId: string;
  dropoffStopId: string;
  requestedDepartureFrom: Date;
  requestedDepartureUntil: Date;
  passengerCount: number;
};

export type CanonicalMerchantInput = {
  routeVersionId: string;
  pickupStopId: string;
  requestedDepartureFrom: Date;
  requestedDepartureUntil: Date;
  parcels: Array<{ destinationStopId: string; size: "S" | "M" | "L"; priority: "low" | "normal" | "high" }>;
};

/**
 * Extension points for callers that create a parcel order on behalf of a
 * different kind of sender (for example an ordinary passenger). The order,
 * parcels and dispatch row are still created by this one code path; the hooks
 * run inside the same transaction, only for a new (non-replayed) creation.
 */
export type CanonicalMerchantOrderOptions = {
  /** Idempotency operation name; defaults to the merchant operation. */
  operation?: string;
  /** Extra values folded into the idempotency request digest. */
  digestExtension?: unknown;
  beforeCreate?: (tx: Prisma.TransactionClient) => Promise<void>;
  afterCreate?: (
    tx: Prisma.TransactionClient,
    created: { orderId: string; parcelIds: string[]; routeVersionId: string }
  ) => Promise<void>;
  /** Extra audit metadata for the creation event. */
  auditMetadata?: Record<string, string | number | boolean>;
};

export type AvailableDepartureQuery = {
  routeVersionId?: string;
  departureFrom?: Date;
  departureUntil?: Date;
  seats?: number;
  limit?: number;
};

export function createCanonicalDemandService(db: PrismaClient = prisma) {
  return {
    /**
     * Active driver availabilities a passenger could still be matched to.
     *
     * Exists because there was no passenger-facing view of driver supply at
     * all — `/driver/availabilities` is `requireRole("driver")`, so the app had
     * nothing real to show and fell back to sample cards. The filters mirror
     * the candidate query in `canonicalMatching.createOfferForDispatch` so what
     * a passenger sees is what the matcher would actually consider; the only
     * intentional difference is that this is read-only and holds no capacity.
     */
    async listAvailableDepartures(query: AvailableDepartureQuery = {}) {
      const now = new Date();
      const limit = Math.min(Math.max(query.limit ?? 25, 1), 50);
      const availabilities = await db.driverRoute.findMany({
        where: {
          operational_mode: CANONICAL_ENTRY_VERSION,
          canonical_availability_version: CANONICAL_ENTRY_VERSION,
          status: "active",
          availability_status: "active",
          ...(query.routeVersionId ? { route_version_id: query.routeVersionId } : { route_version_id: { not: null } }),
          departure_at: {
            gt: now,
            ...(query.departureFrom ? { gte: query.departureFrom } : {}),
            ...(query.departureUntil ? { lte: query.departureUntil } : {})
          },
          remaining_seats: { gte: query.seats ?? 1 },
          // An availability already holding or committed to a canonical offer
          // is not bookable, so it must not be advertised.
          canonical_matches: { none: { operational_mode: CANONICAL_ENTRY_VERSION, status: { in: ["sent_to_driver", "accepted"] } } },
          trips: { none: { operational_mode: CANONICAL_ENTRY_VERSION } },
          driver: { verified: true, user: { role: "driver", account_status: "active" } }
        },
        include: {
          driver: { include: { user: { select: { name: true } } } },
          route_version: { include: { service_route: true, stops: { include: { stop: true }, orderBy: { sequence: "asc" } } } }
        },
        orderBy: [{ departure_at: "asc" }, { id: "asc" }],
        take: limit
      });
      return availabilities;
    },

    async createPassengerRequest(input: CanonicalPassengerInput, actor: Actor) {
      if (!Number.isInteger(input.passengerCount) || input.passengerCount < 1 || input.passengerCount > CANONICAL_ENTRY_LIMITS.maximumPassengerCount) {
        throw new HttpError(400, "invalid_passenger_count");
      }
      return db.$transaction(async (tx) => {
        const payload = {
          route_version_id: input.routeVersionId,
          pickup_stop_id: input.pickupStopId,
          dropoff_stop_id: input.dropoffStopId,
          requested_departure_from: input.requestedDepartureFrom.toISOString(),
          requested_departure_until: input.requestedDepartureUntil.toISOString(),
          passenger_count: input.passengerCount
        };
        const claim = await claimCreate(tx, "canonical_passenger_request_create", actor, payload);
        if (claim.kind === "replay") {
          if (claim.record.resource_type !== "PassengerRequest" || !claim.record.resource_id) {
            throw new HttpError(409, "idempotency_replay_unavailable");
          }
          const resource = await tx.passengerRequest.findFirst({
            where: { id: claim.record.resource_id, passenger_id: actor.id, canonical_entry_version: CANONICAL_ENTRY_VERSION }
          });
          if (!resource) throw new HttpError(409, "idempotency_replay_unavailable");
          return { resource, replayed: true };
        }
        validateDepartureWindow(input.requestedDepartureFrom, input.requestedDepartureUntil);
        const route = await requireEligibleOperationalRoute(tx, input.routeVersionId, {
          requiredStopIds: [input.pickupStopId, input.dropoffStopId],
          lockForUpdate: true
        });
        const { pickup, dropoff } = requirePassengerStopPair(route, input.pickupStopId, input.dropoffStopId);
        const now = new Date();
        // Frozen now: later tariff edits must not change this request.
        const fare = await routeFareService.passengerSnapshot(tx, route.route.id, input.passengerCount, now);
        const resource = await tx.passengerRequest.create({
          data: {
            passenger_id: actor.id,
            pickup_label: pickup.stop.nameEn,
            pickup_lat: pickup.stop.latitude,
            pickup_lng: pickup.stop.longitude,
            destination_label: dropoff.stop.nameEn,
            destination_lat: dropoff.stop.latitude,
            destination_lng: dropoff.stop.longitude,
            preferred_time: input.requestedDepartureFrom,
            passenger_count: input.passengerCount,
            status: "pending",
            source: CANONICAL_ENTRY_VERSION,
            route_version_id: route.id,
            pickup_stop_id: pickup.stopId,
            dropoff_stop_id: dropoff.stopId,
            canonical_entry_version: CANONICAL_ENTRY_VERSION,
            requested_departure_from: input.requestedDepartureFrom,
            requested_departure_until: input.requestedDepartureUntil,
            canonical_created_at: now,
            operational_mode: CANONICAL_ENTRY_VERSION,
            ...fare
          }
        });
        await tx.canonicalDemandDispatch.create({
          data: {
            demand_type: "passenger",
            passenger_request_id: resource.id,
            route_version_id: route.id,
            operational_mode: CANONICAL_ENTRY_VERSION
          }
        });
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.canonical_passenger_request_created,
          entityType: "PassengerRequest",
          entityId: resource.id,
          metadata: {
            route_version_id: route.id,
            passenger_count: input.passengerCount,
            schema_version: CANONICAL_ENTRY_VERSION,
            request_id: actor.requestId
          }
        });
        await completeIdempotency(tx, {
          recordId: claim.record.id,
          claimVersion: claim.record.claim_version,
          resourceType: "PassengerRequest",
          resourceId: resource.id,
          responseStatus: 201
        });
        return { resource, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    },

    async createMerchantOrder(input: CanonicalMerchantInput, actor: Actor, options: CanonicalMerchantOrderOptions = {}) {
      if (input.parcels.length < 1 || input.parcels.length > CANONICAL_ENTRY_LIMITS.maximumParcels) {
        throw new HttpError(400, "invalid_parcel_count");
      }
      return db.$transaction(async (tx) => {
        const payload = {
          route_version_id: input.routeVersionId,
          pickup_stop_id: input.pickupStopId,
          requested_departure_from: input.requestedDepartureFrom.toISOString(),
          requested_departure_until: input.requestedDepartureUntil.toISOString(),
          parcels: input.parcels.map((parcel) => ({
            destination_stop_id: parcel.destinationStopId,
            size: parcel.size,
            priority: parcel.priority
          }))
        };
        const claim = await claimCreate(
          tx,
          options.operation ?? "canonical_merchant_order_create",
          actor,
          options.digestExtension === undefined ? payload : { ...payload, extension: options.digestExtension }
        );
        if (claim.kind === "replay") {
          if (claim.record.resource_type !== "MerchantOrder" || !claim.record.resource_id) {
            throw new HttpError(409, "idempotency_replay_unavailable");
          }
          const resource = await tx.merchantOrder.findFirst({
            where: { id: claim.record.resource_id, merchant_id: actor.id, canonical_entry_version: CANONICAL_ENTRY_VERSION },
            include: { parcels: true }
          });
          if (!resource) throw new HttpError(409, "idempotency_replay_unavailable");
          return { resource, replayed: true };
        }
        validateDepartureWindow(input.requestedDepartureFrom, input.requestedDepartureUntil);
        const destinationIds = input.parcels.map((parcel) => parcel.destinationStopId);
        const route = await requireEligibleOperationalRoute(tx, input.routeVersionId, {
          requiredStopIds: [input.pickupStopId, ...destinationIds],
          lockForUpdate: true
        });
        const { pickup, destinations } = requireMerchantStops(route, input.pickupStopId, destinationIds);
        await options.beforeCreate?.(tx);
        const now = new Date();
        const fares = await routeFareService.parcelSnapshots(
          tx,
          route.route.id,
          input.parcels.map((parcel) => parcel.size),
          now
        );
        const createdOrder = await tx.merchantOrder.create({
          data: {
            merchant_id: actor.id,
            pickup_label: pickup.stop.nameEn,
            pickup_lat: pickup.stop.latitude,
            pickup_lng: pickup.stop.longitude,
            status: "submitted",
            route_version_id: route.id,
            pickup_stop_id: pickup.stopId,
            canonical_entry_version: CANONICAL_ENTRY_VERSION,
            requested_departure_from: input.requestedDepartureFrom,
            requested_departure_until: input.requestedDepartureUntil,
            canonical_created_at: now,
            operational_mode: CANONICAL_ENTRY_VERSION
          }
        });
        await tx.parcel.createMany({
          data: input.parcels.map((parcel, index) => ({
            order_id: createdOrder.id,
            destination_label: destinations[index].stop.nameEn,
            destination_lat: destinations[index].stop.latitude,
            destination_lng: destinations[index].stop.longitude,
            size: parcel.size,
            priority: parcel.priority,
            status: "pending" as const,
            route_version_id: route.id,
            destination_stop_id: destinations[index].stopId,
            canonical_entry_version: CANONICAL_ENTRY_VERSION,
            operational_mode: CANONICAL_ENTRY_VERSION,
            ...fares[index]
          }))
        });
        const resource = await tx.merchantOrder.findUniqueOrThrow({
          where: { id: createdOrder.id },
          include: { parcels: true }
        });
        await options.afterCreate?.(tx, {
          orderId: resource.id,
          parcelIds: resource.parcels.map((parcel) => parcel.id),
          routeVersionId: route.id
        });
        await tx.canonicalDemandDispatch.create({
          data: {
            demand_type: "merchant_order",
            merchant_order_id: resource.id,
            route_version_id: route.id,
            operational_mode: CANONICAL_ENTRY_VERSION
          }
        });
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.canonical_merchant_order_created,
          entityType: "MerchantOrder",
          entityId: resource.id,
          metadata: {
            route_version_id: route.id,
            parcel_count: resource.parcels.length,
            schema_version: CANONICAL_ENTRY_VERSION,
            request_id: actor.requestId,
            ...options.auditMetadata
          }
        });
        await completeIdempotency(tx, {
          recordId: claim.record.id,
          claimVersion: claim.record.claim_version,
          resourceType: "MerchantOrder",
          resourceId: resource.id,
          responseStatus: 201
        });
        return { resource, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    }
  };
}

export type CanonicalDemandService = ReturnType<typeof createCanonicalDemandService>;
export const canonicalDemandService = createCanonicalDemandService();
