import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { issueHandover } from "./deliveryHandover.js";
import {
  LEGACY_DEFAULT_ROUTE_KEY,
  resolveOperatingRoute,
  resolveOperatingRouteByKey,
  routeSummarySelect
} from "./operatingRoutes.js";

export const MERCHANT_CREATE_OPERATION = "legacy_merchant_order_create_v1";
const MERCHANT_CREATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const merchantCreateDigest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Older app builds: a place name and coordinates for the pickup and for every parcel. */
export type CoordinateOrderInput = {
  pickup_label: string;
  pickup_lat: number;
  pickup_lng: number;
  parcels: Array<{
    destination_label: string;
    destination_lat: number;
    destination_lng: number;
    size: "S" | "M" | "L";
    priority: "low" | "normal" | "high";
  }>;
};

/** Route-based order: a predefined route, the pickup as text, each drop-off as text. */
export type RouteOrderInput = {
  service_route_id: string;
  pickup_details: string;
  parcels: Array<{
    dropoff_details: string;
    size: "S" | "M" | "L";
    priority: "low" | "normal" | "high";
    receiver_name?: string | null;
    /** Already normalised to E.164 by the caller. */
    receiver_phone?: string | null;
  }>;
};

export type LegacyOrderInput = CoordinateOrderInput | RouteOrderInput;

export function isRouteOrderInput(input: LegacyOrderInput): input is RouteOrderInput {
  return "service_route_id" in input && typeof input.service_route_id === "string";
}

/** What a freshly created or replayed order returns with. */
export const createdOrderInclude = {
  parcels: true,
  delivery_handover: true,
  route_version: routeSummarySelect
} as const;

export type LegacyOrderCreateOptions = {
  /** Idempotency operation; passenger parcels keep their keys apart from merchant orders. */
  operation?: string;
  /** Extra values that are part of the request fingerprint. */
  digestExtension?: Record<string, unknown>;
  /** The departure window of a passenger parcel; the legacy expiry worker reads it. */
  requestedDeparture?: { from: Date; until: Date };
  /** Replays only return an order this filter accepts. */
  replayWhere?: Prisma.MerchantOrderWhereInput;
  /** Runs in the creation transaction before anything is written (limits). */
  beforeCreate?: (tx: Prisma.TransactionClient) => Promise<void>;
  /** Runs in the creation transaction after the order and parcels exist. */
  afterCreate?: (tx: Prisma.TransactionClient, created: { orderId: string; parcelIds: string[]; routeVersionId: string }) => Promise<void>;
  auditMetadata?: Record<string, string>;
};

/**
 * The one legacy parcel-order creation path. The merchant single-order
 * endpoint, the bulk upload and passenger parcels all call it, so validation
 * shape, idempotency, the handover code, audit and the transaction isolation
 * level cannot diverge.
 */
export async function createLegacyMerchantOrder(
  userId: string,
  input: LegacyOrderInput,
  key: string | undefined,
  options: LegacyOrderCreateOptions = {},
  db: PrismaClient = prisma
) {
  const operation = options.operation ?? MERCHANT_CREATE_OPERATION;
  // The coordinate body keeps its original fingerprint, so keys issued before
  // routes existed still replay; route fields only join it when sent.
  const normalized = isRouteOrderInput(input)
    ? {
        service_route_id: input.service_route_id,
        pickup_details: input.pickup_details,
        parcels: input.parcels.map((parcel) => ({
          dropoff_details: parcel.dropoff_details,
          size: parcel.size,
          priority: parcel.priority,
          receiver_name: parcel.receiver_name ?? null,
          receiver_phone: parcel.receiver_phone ?? null
        })),
        ...(options.requestedDeparture
          ? { from: options.requestedDeparture.from.toISOString(), until: options.requestedDeparture.until.toISOString() }
          : {}),
        ...(options.digestExtension ?? {})
      }
    : {
        pickup_label: input.pickup_label,
        pickup_lat: input.pickup_lat.toFixed(6),
        pickup_lng: input.pickup_lng.toFixed(6),
        parcels: input.parcels.map((parcel) => ({
          destination_label: parcel.destination_label,
          destination_lat: parcel.destination_lat.toFixed(6),
          destination_lng: parcel.destination_lng.toFixed(6),
          size: parcel.size,
          priority: parcel.priority
        }))
      };
  const result = await db.$transaction(async (tx) => {
    const claim = key === undefined ? undefined : await claimIdempotency(tx, {
      operation,
      scopeDigest: merchantCreateDigest(`${operation}:${userId}`),
      keyDigest: merchantCreateDigest(key),
      keyVersion: 1,
      requestDigest: merchantCreateDigest(JSON.stringify(normalized)),
      preserveCompleted: true,
      // Completed keys are never reclaimed into a different order. Mobile
      // creation retries stop at seven days; older recovery uses read-only lookup.
      expiresAt: new Date(Date.now() + MERCHANT_CREATE_RETENTION_MS)
    });
    if (claim?.kind === "conflict") throw new HttpError(409, "idempotency_conflict");
    if (claim?.kind === "failed") throw new HttpError(409, "idempotency_failed");
    if (claim?.kind === "in_progress") throw new HttpError(409, "idempotency_in_progress");
    if (claim?.kind === "replay") {
      if (claim.record.resource_type !== "MerchantOrder" || !claim.record.resource_id) {
        throw new HttpError(409, "idempotency_replay_unavailable");
      }
      const original = await tx.merchantOrder.findFirst({
        where: { id: claim.record.resource_id, merchant_id: userId, canonical_entry_version: null, ...(options.replayWhere ?? {}) },
        include: createdOrderInclude
      });
      if (!original) throw new HttpError(409, "idempotency_replay_unavailable");
      return { order: original, replayed: true, handoverCode: null as string | null };
    }

    await options.beforeCreate?.(tx);
    // Older builds send coordinates and ride the Hebron → Bethlehem route.
    const route = isRouteOrderInput(input)
      ? await resolveOperatingRoute(tx, input.service_route_id)
      : await resolveOperatingRouteByKey(tx, LEGACY_DEFAULT_ROUTE_KEY);
    const pickup = isRouteOrderInput(input)
      ? {
          // Stored labels stay English city names; the exact place is the sender's text.
          pickup_label: route.origin.nameEn,
          pickup_lat: route.origin.latitude,
          pickup_lng: route.origin.longitude,
          pickup_details: input.pickup_details
        }
      : { pickup_label: input.pickup_label, pickup_lat: input.pickup_lat.toFixed(6), pickup_lng: input.pickup_lng.toFixed(6) };
    const parcels = isRouteOrderInput(input)
      ? input.parcels.map((parcel) => ({
          destination_label: route.destination.nameEn,
          destination_lat: route.destination.latitude,
          destination_lng: route.destination.longitude,
          dropoff_details: parcel.dropoff_details,
          size: parcel.size,
          priority: parcel.priority,
          receiver_name: parcel.receiver_name ?? null,
          receiver_phone: parcel.receiver_phone ?? null
        }))
      : input.parcels.map((parcel) => ({
          destination_label: parcel.destination_label,
          destination_lat: parcel.destination_lat.toFixed(6),
          destination_lng: parcel.destination_lng.toFixed(6),
          size: parcel.size,
          priority: parcel.priority
        }));

    const created = await tx.merchantOrder.create({
      data: {
        merchant_id: userId,
        ...pickup,
        route_version_id: route.routeVersionId,
        ...(options.requestedDeparture
          ? { requested_departure_from: options.requestedDeparture.from, requested_departure_until: options.requestedDeparture.until }
          : {}),
        status: "submitted",
        parcels: {
          // Parcels carry their order's route version; the database ties the two together.
          create: parcels.map((parcel) => ({ ...parcel, route_version_id: route.routeVersionId, status: "pending" as const }))
        }
      },
      include: createdOrderInclude
    });
    await options.afterCreate?.(tx, {
      orderId: created.id,
      parcelIds: created.parcels.map((parcel) => parcel.id),
      routeVersionId: route.routeVersionId
    });
    // The receiver's handover code; the sender passes it on, the driver enters it at delivery.
    const handover = await issueHandover(tx, created.id);
    const order = { ...created, delivery_handover: await tx.deliveryHandover.findUnique({ where: { merchant_order_id: created.id } }) };
    await auditEvent(tx, {
      userId,
      action: AuditAction.merchant_order_created,
      entityType: "MerchantOrder",
      entityId: order.id,
      metadata: { parcel_count: order.parcels.length, service_route_id: route.serviceRouteId, ...(options.auditMetadata ?? {}) }
    });
    if (claim?.kind === "claimed") {
      await completeIdempotency(tx, {
        recordId: claim.record.id,
        claimVersion: claim.record.claim_version,
        resourceType: "MerchantOrder",
        resourceId: order.id,
        responseStatus: 201
      });
    }
    return { order, replayed: false, handoverCode: handover.code };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return result;
}
