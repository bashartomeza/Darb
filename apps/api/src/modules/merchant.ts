import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { pagedWhere, listPageOrderBy, listPageResult, parseListPage } from "../lib/pagination.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { cancelMerchantOrder, endedCancellationInclude, serializeCancellation } from "../services/cancellations.js";
import { cancelBodySchema } from "../services/cancellationReasons.js";
import { describeHandover } from "../services/deliveryHandover.js";
import {
  createdOrderInclude,
  createLegacyMerchantOrder,
  MERCHANT_CREATE_OPERATION,
  merchantCreateDigest,
  type RouteOrderInput
} from "../services/legacyMerchantOrders.js";
import { latitudeSchema, legacyLabelSchema, longitudeSchema } from "../lib/validation.js";
import { BATCHING_LIMITS } from "../lib/batchingConfig.js";
import { maskPhone, normalizePhoneToE164, PhoneNormalizationError } from "../lib/phone.js";
import {
  detailsSchema,
  routeFields,
  routeSummarySelect,
  serviceRouteIdSchema,
  type RouteSummary
} from "../services/operatingRoutes.js";
import { orderFareResponse, parcelFareResponse } from "../services/routeFares.js";

/** Older app builds: a place name and coordinates per parcel; mapped to the Hebron → Bethlehem route. */
export const parcelSchema = z.object({
  destination_label: legacyLabelSchema,
  destination_lat: latitudeSchema,
  destination_lng: longitudeSchema,
  size: z.enum(["S", "M", "L"]),
  priority: z.enum(["low", "normal", "high"]).default("normal")
});

export const createOrderSchema = z.object({
  pickup_label: legacyLabelSchema,
  pickup_lat: latitudeSchema,
  pickup_lng: longitudeSchema,
  parcels: z.array(parcelSchema).min(1).max(BATCHING_LIMITS.maxParcelsPerOrder)
});

const SIZE_WORDS: Record<string, "S" | "M" | "L"> = { s: "S", small: "S", m: "M", medium: "M", l: "L", large: "L" };
/** Sizes as today (S, M, L); the words small / medium / large are accepted too. */
export const parcelSizeSchema = z
  .string()
  .trim()
  .transform((value) => SIZE_WORDS[value.toLowerCase()])
  .pipe(z.enum(["S", "M", "L"]));
const noControlCharacters = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);

/** Route-based parcel: the drop-off as text, and an optional receiver. */
export const routeParcelSchema = z.object({
  dropoff_details: detailsSchema,
  size: parcelSizeSchema,
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  receiver_name: z.string().trim().min(2).max(80).refine(noControlCharacters).optional(),
  receiver_phone: z.string().trim().min(5).max(32).optional()
});

/** Route-based order: a predefined route and the pickup as text. */
export const createRouteOrderSchema = z.object({
  service_route_id: serviceRouteIdSchema,
  pickup_details: detailsSchema,
  parcels: z.array(routeParcelSchema).min(1).max(BATCHING_LIMITS.maxParcelsPerOrder)
});

export type LegacyMerchantOrderInput = z.infer<typeof createOrderSchema>;
export type RouteMerchantOrderInput = z.infer<typeof createRouteOrderSchema>;

export function parseMerchantOrderBody(body: unknown): LegacyMerchantOrderInput | RouteMerchantOrderInput {
  return body && typeof body === "object" && "service_route_id" in body
    ? createRouteOrderSchema.parse(body)
    : createOrderSchema.parse(body);
}

/** A parsed body as the creation service takes it; receiver phones are normalised here. */
export function toOrderInput(input: LegacyMerchantOrderInput | RouteMerchantOrderInput) {
  if (!("service_route_id" in input)) return input;
  return {
    service_route_id: input.service_route_id,
    pickup_details: input.pickup_details,
    parcels: input.parcels.map((parcel) => ({
      dropoff_details: parcel.dropoff_details,
      size: parcel.size,
      priority: parcel.priority,
      receiver_name: parcel.receiver_name ?? null,
      receiver_phone: normalizeReceiverPhone(parcel.receiver_phone)
    }))
  } satisfies RouteOrderInput;
}

/** Receiver phones are stored in E.164, like every other phone. */
export function normalizeReceiverPhone(value: string | undefined) {
  if (value === undefined) return null;
  try {
    return normalizePhoneToE164(value, { region: "PS" });
  } catch (error) {
    if (error instanceof PhoneNormalizationError) throw new HttpError(400, "invalid_receiver_phone");
    throw error;
  }
}

export const merchantCreateIdempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);
export { createLegacyMerchantOrder, MERCHANT_CREATE_OPERATION, merchantCreateDigest };

export const merchantRouter = Router();

function maskedPhone(value: unknown) {
  if (typeof value !== "string" || value === "") return null;
  try {
    return maskPhone(value);
  } catch {
    return null;
  }
}

function serializeLegacyParcel(value: Record<string, unknown>) {
  return {
    id: value.id,
    order_id: value.order_id,
    destination_label: value.destination_label,
    destination_lat: value.destination_lat,
    destination_lng: value.destination_lng,
    size: value.size,
    priority: value.priority,
    status: value.status,
    batch_id: value.batch_id,
    dropoff_details: value.dropoff_details ?? null,
    receiver_name: value.receiver_name ?? null,
    // The full number is only ever read by the delivering driver's trip.
    receiver_phone_masked: maskedPhone(value.receiver_phone),
    // The size fare frozen at creation; null when the route had no fare.
    fare: parcelFareResponse(value)
  };
}

function serializeLegacyBatch(value: Record<string, unknown>) {
  const members = Array.isArray(value.members)
    ? value.members.map((member) => {
        const order = (member as Record<string, unknown>).merchant_order as Record<string, unknown> | undefined;
        return order
          ? {
              id: order.id,
              merchant_id: order.merchant_id,
              pickup_label: order.pickup_label,
              status: order.status,
              parcel_count: (order._count as Record<string, unknown> | undefined)?.parcels ?? 0,
              created_at: order.created_at
            }
          : { merchant_order_id: (member as Record<string, unknown>).merchant_order_id };
      })
    : [];
  const trips = Array.isArray(value.trips) ? value.trips : [];
  const trip = trips.length > 0 ? trips[0] : null;
  return {
    id: value.id,
    merchant_order_id: value.merchant_order_id,
    status: value.status,
    estimated_distance_saved: value.estimated_distance_saved,
    explanation: value.explanation,
    created_at: value.created_at,
    driver_route: value.driver_route,
    member_orders: members,
    order_count: members.length || 1,
    trip_id: trip && typeof trip === "object" ? (trip as Record<string, unknown>).id : null,
    trip_status: trip && typeof trip === "object" ? (trip as Record<string, unknown>).status : null
  };
}

function serializeLegacyMerchantOrder(value: Record<string, unknown>) {
  const directBatches = Array.isArray(value.parcel_batches) ? value.parcel_batches : [];
  const memberBatches = Array.isArray(value.batch_members)
    ? value.batch_members
        .map((member) => (member as Record<string, unknown>).parcel_batch)
        .filter((batch): batch is Record<string, unknown> => Boolean(batch) && typeof batch === "object")
    : [];
  const rawBatches = [...directBatches, ...memberBatches];
  const seen = new Set<string>();
  const batches = rawBatches
    .map((batch) => serializeLegacyBatch(batch as Record<string, unknown>))
    .filter((batch) => {
      if (typeof batch.id !== "string" || seen.has(batch.id)) return false;
      seen.add(batch.id);
      return true;
    });
  const latestBatch = batches[0];
  const tripId = latestBatch?.trip_id ?? null;
  const tripStatus = latestBatch?.trip_status ?? null;
  return {
    id: value.id,
    merchant_id: value.merchant_id,
    pickup_label: value.pickup_label,
    pickup_lat: value.pickup_lat,
    pickup_lng: value.pickup_lng,
    ...routeFields(value.route_version as RouteSummary),
    pickup_details: value.pickup_details ?? null,
    status: value.status,
    created_at: value.created_at,
    trip_id: tripId,
    trip_status: tripStatus,
    parcels: Array.isArray(value.parcels)
      ? value.parcels.map((parcel) => serializeLegacyParcel(parcel as Record<string, unknown>))
      : undefined,
    // Order total, only when every parcel has a frozen fare.
    fare: Array.isArray(value.parcels) ? orderFareResponse(value.parcels as Array<Record<string, unknown>>) : null,
    // Confirmation state only; the code itself is shown once, when it is issued.
    handover: describeHandover((value.delivery_handover ?? null) as Parameters<typeof describeHandover>[0]),
    // Who ended the order and why, once it is cancelled; otherwise null.
    cancellation: value.status === "cancelled" ? serializeCancellation(value.cancellations as never) : null,
    parcel_batches: batches
  };
}

const merchantOrderInclude = {
  ...endedCancellationInclude,
  parcels: true,
  delivery_handover: true,
  route_version: routeSummarySelect,
  parcel_batches: {
    select: {
      id: true,
      status: true,
      estimated_distance_saved: true,
      explanation: true,
      created_at: true,
      driver_route: {
        select: {
          id: true,
          origin_label: true,
          destination_label: true,
          corridor_key: true,
          status: true,
          parcel_capacity_available: true
        }
      },
      trips: {
        select: { id: true, status: true, created_at: true },
        orderBy: { created_at: "desc" as const },
        take: 1
      },
      members: {
        select: {
          merchant_order: {
            select: {
              id: true,
              merchant_id: true,
              pickup_label: true,
              status: true,
              created_at: true,
              _count: { select: { parcels: true } }
            }
          }
        },
        orderBy: { created_at: "asc" as const }
      }
    },
    orderBy: { created_at: "desc" as const }
  },
  batch_members: {
    select: {
      parcel_batch_id: true,
      created_at: true,
      parcel_batch: {
        select: {
          id: true,
          status: true,
          estimated_distance_saved: true,
          explanation: true,
          created_at: true,
          driver_route: {
            select: {
              id: true,
              origin_label: true,
              destination_label: true,
              corridor_key: true,
              status: true,
              parcel_capacity_available: true
            }
          },
          trips: {
            select: { id: true, status: true, created_at: true },
            orderBy: { created_at: "desc" as const },
            take: 1
          },
          members: {
            select: {
              merchant_order: {
                select: {
                  id: true,
                  merchant_id: true,
                  pickup_label: true,
                  status: true,
                  created_at: true,
                  _count: { select: { parcels: true } }
                }
              }
            },
            orderBy: { created_at: "asc" as const }
          }
        }
      }
    },
    orderBy: { created_at: "desc" as const },
    take: 1
  }
};

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_route_param");
  }
  return value;
}

merchantRouter.use("/merchant", requireAuth, requireRole("merchant"));

// Read-only reconciliation remains safe even after the client's mutation window.
// Keep the operation key in a header, outside URL/access-log paths.
merchantRouter.get("/merchant/order-operation", async (req: AuthenticatedRequest, res, next) => {
  try {
    const key = merchantCreateIdempotencyKey.parse(req.header("idempotency-key"));
    const record = await prisma.idempotencyRecord.findUnique({
      where: { operation_scope_digest_idempotency_key_key_version: {
        operation: MERCHANT_CREATE_OPERATION,
        scope_digest: merchantCreateDigest(`${MERCHANT_CREATE_OPERATION}:${req.user!.id}`),
        idempotency_key: merchantCreateDigest(key), key_version: 1
      } }
    });
    if (!record) throw new HttpError(404, "merchant_order_operation_not_found");
    if (record.state !== "completed" || record.resource_type !== "MerchantOrder" || !record.resource_id) {
      throw new HttpError(409, "idempotency_replay_unavailable");
    }
    const order = await prisma.merchantOrder.findFirst({
      where: { id: record.resource_id, merchant_id: req.user!.id, canonical_entry_version: null },
      include: createdOrderInclude
    });
    if (!order) throw new HttpError(409, "idempotency_replay_unavailable");
    res.json({ order: serializeLegacyMerchantOrder(order as unknown as Record<string, unknown>), replayed: true });
  } catch (error) { next(error); }
});

merchantRouter.post("/merchant/orders", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = toOrderInput(parseMerchantOrderBody(req.body));
    // Old clients without an Idempotency-Key remain supported; new clients send
    // one durable key per user-confirmed order to obtain replay-safe creation.
    const rawKey = req.header("idempotency-key");
    const key = rawKey === undefined ? undefined : merchantCreateIdempotencyKey.parse(rawKey);
    const result = await createLegacyMerchantOrder(req.user!.id, input, key);
    const serialized = serializeLegacyMerchantOrder(result.order as unknown as Record<string, unknown>);
    res.status(result.replayed ? 200 : 201).json({
      order: result.handoverCode ? { ...serialized, handover: { ...serialized.handover, code: result.handoverCode } } : serialized,
      ...(key === undefined ? {} : { replayed: result.replayed })
    });
  } catch (error) {
    next(error && typeof error === "object" && "code" in error && error.code === "P2034"
      ? new HttpError(409, "transaction_retry_required") : error);
  }
});

// Cancels this one order, before pickup (also after a driver accepted it). An order that shares
// a batch leaves it; the other orders of the batch are not cancelled (see services/cancellations.ts).
merchantRouter.patch("/merchant/orders/:id/cancel", async (req: AuthenticatedRequest, res, next) => {
  try {
    const orderId = routeParam(req.params.id);
    const input = cancelBodySchema("sender").parse(req.body ?? {});
    const result = await prisma.$transaction(async (tx) => {
      const outcome = await cancelMerchantOrder(tx, {
        orderId,
        ownerId: req.user!.id,
        actor: { userId: req.user!.id, role: "merchant" },
        reason: { code: input.reason, note: input.note }
      });
      const updated = await tx.merchantOrder.findUniqueOrThrow({ where: { id: orderId }, include: merchantOrderInclude });
      return { updated, closed: outcome.closed };
    }, { isolationLevel: "ReadCommitted" });
    res.json({
      order: serializeLegacyMerchantOrder(result.updated as unknown as Record<string, unknown>),
      // The other orders of its batch: they stay batched and were not cancelled.
      batch_orders_remaining: result.closed?.remainingOrderIds ?? []
    });
  } catch (error) {
    // A deadlock with a concurrent match or acceptance rolled everything back: retry is safe.
    next(error && typeof error === "object" && "code" in error && error.code === "P2034"
      ? new HttpError(409, "transaction_retry_required") : error);
  }
});

merchantRouter.get("/merchant/orders", async (req: AuthenticatedRequest, res, next) => {
  try {
    const page = parseListPage(req.query);
    const rows = await prisma.merchantOrder.findMany({
      where: pagedWhere({ merchant_id: req.user!.id, canonical_entry_version: null }, page),
      include: merchantOrderInclude,
      orderBy: listPageOrderBy,
      take: page.limit + 1
    });
    const { items: orders, nextCursor } = listPageResult(rows, page);
    res.json({
      orders: orders.map((order) => serializeLegacyMerchantOrder(order as unknown as Record<string, unknown>)),
      next_cursor: nextCursor
    });
  } catch (error) {
    next(error);
  }
});

merchantRouter.get("/merchant/orders/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const orderId = routeParam(req.params.id);
    const order = await prisma.merchantOrder.findFirst({
      where: { id: orderId, merchant_id: req.user!.id, canonical_entry_version: null },
      include: merchantOrderInclude
    });
    if (!order) {
      throw new HttpError(404, "order_not_found");
    }
    res.json({ order: serializeLegacyMerchantOrder(order as unknown as Record<string, unknown>) });
  } catch (error) {
    next(error);
  }
});
