import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { legacyRouteTimingWhere } from "./legacyCapacity.js";
import {
  LEGACY_DEFAULT_ROUTE_KEY,
  resolveOperatingRoute,
  resolveOperatingRouteByKey,
  routeSummarySelect
} from "./operatingRoutes.js";

const OPERATION = "legacy_passenger_request_create_v1";

/** The body older app builds send: a place name and coordinates for each end. */
export type LegacyPassengerCoordinateInput = {
  pickup_label: string;
  pickup_lat: number;
  pickup_lng: number;
  destination_label: string;
  destination_lat: number;
  destination_lng: number;
  preferred_time: Date;
  passenger_count: number;
  /** The driver route the passenger picked; saved on the request as its matching pin. */
  selected_driver_route_id?: string;
};

/** The route-based body: a predefined route plus the exact pickup and drop-off as text. */
export type RoutePassengerInput = {
  service_route_id: string;
  pickup_details: string;
  dropoff_details: string;
  preferred_time: Date;
  passenger_count: number;
  selected_driver_route_id?: string;
};

export type LegacyPassengerCreationInput = LegacyPassengerCoordinateInput | RoutePassengerInput;
type Actor = { id: string; idempotencyKey?: string };
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function isRoutePassengerInput(input: LegacyPassengerCreationInput): input is RoutePassengerInput {
  return "service_route_id" in input && typeof input.service_route_id === "string";
}

/** Every passenger request read returns its route summary alongside the row. */
export const passengerRequestInclude = { route_version: routeSummarySelect } as const;

/** The supply filter matching ranks from, narrowed to the one route the passenger picked. */
function selectableRouteWhere(routeId: string, seats: number, now: Date, serviceRouteId: string): Prisma.DriverRouteWhereInput {
  return {
    id: routeId,
    status: "active",
    // A pick on another route is never a valid pin for this request.
    route_version: { is: { service_route_id: serviceRouteId } },
    canonical_availability_version: null,
    operational_mode: "legacy",
    seats_available: { gte: seats },
    driver: { verified: true, user: { role: "driver", account_status: "active" } },
    ...legacyRouteTimingWhere(now),
  };
}

export function createLegacyPassengerCreationService(db: PrismaClient = prisma) {
  return {
    async create(input: LegacyPassengerCreationInput, actor: Actor) {
      return db.$transaction(async (tx) => {
        // New fields only join the fingerprint when sent, so keys issued for
        // the coordinate body keep their original request digest.
        const payload = isRoutePassengerInput(input)
          ? {
              service_route_id: input.service_route_id,
              pickup_details: input.pickup_details,
              dropoff_details: input.dropoff_details,
              preferred_time: input.preferred_time.toISOString(),
              passenger_count: input.passenger_count,
              ...(input.selected_driver_route_id ? { selected_driver_route_id: input.selected_driver_route_id } : {}),
            }
          : {
              pickup_label: input.pickup_label,
              pickup_lat: input.pickup_lat,
              pickup_lng: input.pickup_lng,
              destination_label: input.destination_label,
              destination_lat: input.destination_lat,
              destination_lng: input.destination_lng,
              preferred_time: input.preferred_time.toISOString(),
              passenger_count: input.passenger_count,
              // Only present when a route was picked, so keys issued for unpinned
              // requests keep their original request digest.
              ...(input.selected_driver_route_id ? { selected_driver_route_id: input.selected_driver_route_id } : {}),
            };
        const claim = actor.idempotencyKey === undefined ? undefined : await claimIdempotency(tx, {
          operation: OPERATION,
          scopeDigest: digest(`${OPERATION}:${actor.id}`),
          keyDigest: digest(actor.idempotencyKey),
          keyVersion: 1,
          requestDigest: digest(JSON.stringify({ actor_id: actor.id, payload })),
          expiresAt: new Date(Date.now() + 86_400_000),
          retainCompleted: true,
        });
        if (claim?.kind === "conflict") throw new HttpError(409, "idempotency_conflict");
        if (claim?.kind === "in_progress") throw new HttpError(409, "idempotency_in_progress");
        if (claim?.kind === "failed") throw new HttpError(409, "idempotency_failed");
        if (claim?.kind === "replay") {
          if (claim.record.resource_type !== "PassengerRequest" || !claim.record.resource_id) {
            throw new HttpError(409, "idempotency_replay_unavailable");
          }
          const resource = await tx.passengerRequest.findFirst({
            where: { id: claim.record.resource_id, passenger_id: actor.id, canonical_entry_version: null, operational_mode: "legacy" },
            include: passengerRequestInclude,
          });
          if (!resource) throw new HttpError(409, "idempotency_replay_unavailable");
          return { resource, replayed: true };
        }
        if (input.preferred_time <= new Date()) throw new HttpError(400, "preferred_time_in_past");
        // Older builds send coordinates and ride the Hebron → Bethlehem route.
        const route = isRoutePassengerInput(input)
          ? await resolveOperatingRoute(tx, input.service_route_id)
          : await resolveOperatingRouteByKey(tx, LEGACY_DEFAULT_ROUTE_KEY);
        if (input.selected_driver_route_id) {
          // Nothing is saved for an unavailable pick: the claim rolls back with it.
          const selected = await tx.driverRoute.findFirst({
            where: selectableRouteWhere(input.selected_driver_route_id, input.passenger_count, new Date(), route.serviceRouteId),
            select: { id: true },
          });
          if (!selected) throw new HttpError(409, "selected_driver_route_unavailable");
        }
        const place = isRoutePassengerInput(input)
          ? {
              // Stored labels stay English city names like every other label;
              // the exact places are the passenger's own text.
              pickup_label: route.origin.nameEn,
              pickup_lat: route.origin.latitude,
              pickup_lng: route.origin.longitude,
              destination_label: route.destination.nameEn,
              destination_lat: route.destination.latitude,
              destination_lng: route.destination.longitude,
              pickup_details: input.pickup_details,
              dropoff_details: input.dropoff_details,
            }
          : {
              pickup_label: input.pickup_label,
              pickup_lat: input.pickup_lat.toFixed(6),
              pickup_lng: input.pickup_lng.toFixed(6),
              destination_label: input.destination_label,
              destination_lat: input.destination_lat.toFixed(6),
              destination_lng: input.destination_lng.toFixed(6),
            };
        const resource = await tx.passengerRequest.create({
          data: {
            passenger_id: actor.id,
            ...place,
            route_version_id: route.routeVersionId,
            preferred_time: input.preferred_time,
            passenger_count: input.passenger_count,
            ...(input.selected_driver_route_id ? { selected_driver_route_id: input.selected_driver_route_id } : {}),
            status: "pending",
            source: "manual",
          },
          include: passengerRequestInclude,
        });
        await auditEvent(tx, { userId: actor.id, action: AuditAction.passenger_request_created,
          entityType: "PassengerRequest", entityId: resource.id });
        if (claim) await completeIdempotency(tx, {
          recordId: claim.record.id, claimVersion: claim.record.claim_version,
          resourceType: "PassengerRequest", resourceId: resource.id, responseStatus: 201,
        });
        return { resource, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    },
  };
}

export const legacyPassengerCreationService = createLegacyPassengerCreationService();
