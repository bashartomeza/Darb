import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { consumeAbuseCounter } from "../lib/abuseCounters.js";
import { BATCHING_LIMITS } from "../lib/batchingConfig.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { createLegacyMerchantOrder, merchantCreateIdempotencyKey } from "./merchant.js";
import { createParcelBatch } from "./batching.js";
import { planBatches } from "../services/batchPlanner.js";
import {
  bulkRowKeys,
  isRouteBulkOrder,
  parseBulkOrdersCsv,
  type ParsedBulkOrder,
  type RowError
} from "../services/merchantBulkOrders.js";
import { resolveOperatingRouteByKey, type ResolvedOperatingRoute } from "../services/operatingRoutes.js";
import type { LegacyOrderInput } from "../services/legacyMerchantOrders.js";

export const merchantBulkRouter = Router();

type ResolvedBulkOrder = ParsedBulkOrder & { route: ResolvedOperatingRoute | null };

/**
 * Checks every route key of a route-based file once. Rows on an unknown,
 * retired or turned-off route become row errors and are left out, like any
 * other invalid row. Coordinate files need no lookup.
 */
async function resolveBulkRoutes(parsed: ReturnType<typeof parseBulkOrdersCsv>) {
  const keys = [...new Set(parsed.orders.flatMap((order) => (isRouteBulkOrder(order.input) ? [order.input.route_key] : [])))];
  const routes = new Map<string, ResolvedOperatingRoute | null>();
  for (const key of keys) {
    try {
      routes.set(key, await resolveOperatingRouteByKey(prisma, key));
    } catch (error) {
      if (!(error instanceof HttpError) || error.message !== "route_unavailable") throw error;
      routes.set(key, null);
    }
  }
  const orders: ResolvedBulkOrder[] = [];
  const errors: RowError[] = [...parsed.errors];
  for (const order of parsed.orders) {
    if (!isRouteBulkOrder(order.input)) {
      orders.push({ ...order, route: null });
      continue;
    }
    const route = routes.get(order.input.route_key) ?? null;
    if (route) {
      orders.push({ ...order, route });
      continue;
    }
    for (const row of order.rows) {
      errors.push({
        row,
        field: "route_key",
        code: "route_unavailable",
        message_en: `Route "${order.input.route_key}" is not available.`,
        message_ar: `المسار "${order.input.route_key}" غير متاح.`
      });
    }
  }
  errors.sort((a, b) => a.row - b.row);
  return { orders, errors, totalRows: parsed.totalRows };
}

/** The creation input for one order of the file. */
function orderInput(order: ResolvedBulkOrder): LegacyOrderInput {
  if (!isRouteBulkOrder(order.input)) return order.input;
  return {
    service_route_id: order.route!.serviceRouteId,
    pickup_details: order.input.pickup_details,
    parcels: order.input.parcels
  };
}

/** Planner coordinates: a route-based order runs from its origin city to its destination city. */
function plannerPoints(order: ResolvedBulkOrder) {
  if (!isRouteBulkOrder(order.input)) {
    return {
      pickup: { lat: order.input.pickup_lat, lng: order.input.pickup_lng },
      parcels: order.input.parcels.map((parcel) => ({ lat: parcel.destination_lat, lng: parcel.destination_lng, size: parcel.size }))
    };
  }
  const route = order.route!;
  return {
    pickup: { lat: Number(route.origin.latitude), lng: Number(route.origin.longitude) },
    parcels: order.input.parcels.map((parcel) => ({
      lat: Number(route.destination.latitude),
      lng: Number(route.destination.longitude),
      size: parcel.size
    }))
  };
}

const bodySchema = z.object({
  csv: z.string().min(1).max(BATCHING_LIMITS.maxBulkCsvChars),
  skip_invalid: z.boolean().default(false),
  auto_batch: z.boolean().default(false)
});

const RETRY_MESSAGES: Record<string, { en: string; ar: string }> = {
  idempotency_conflict: {
    en: "This upload key was already used for a different order. Start a new upload.",
    ar: "تم استخدام مفتاح الرفع هذا لطلب مختلف. ابدأ رفعاً جديداً."
  },
  idempotency_in_progress: {
    en: "This order is still being created. Retry in a moment.",
    ar: "ما زال هذا الطلب قيد الإنشاء. أعد المحاولة بعد قليل."
  },
  transaction_retry_required: {
    en: "The order could not be saved right now. Retry the upload.",
    ar: "تعذر حفظ الطلب الآن. أعد محاولة الرفع."
  }
};

function describeOrders(orders: ResolvedBulkOrder[]) {
  return orders.map((order) =>
    isRouteBulkOrder(order.input)
      ? {
          rows: order.rows,
          pickup_label: order.route?.origin.nameEn ?? null,
          route_key: order.input.route_key,
          service_route_id: order.route?.serviceRouteId ?? null,
          route_name_ar: order.route?.nameAr ?? null,
          route_name_en: order.route?.nameEn ?? null,
          pickup_details: order.input.pickup_details,
          parcel_count: order.input.parcels.length
        }
      : {
          rows: order.rows,
          pickup_label: order.input.pickup_label,
          parcel_count: order.input.parcels.length
        }
  );
}

function planPreview(orders: ResolvedBulkOrder[]) {
  const plan = planBatches(
    orders.map((order, index) => ({ id: String(index), ...plannerPoints(order) }))
  );
  return {
    batches: plan.batches.map((batch) => ({
      order_rows: batch.order_ids.flatMap((id) => orders[Number(id)]!.rows),
      order_count: batch.order_ids.length,
      parcel_count: batch.parcel_count,
      load_units: batch.load_units
    })),
    unbatchable: plan.unbatchable.map((entry) => ({ rows: orders[Number(entry.id)]!.rows, reason: entry.reason }))
  };
}

async function consumeLimit(userId: string, bucket: "merchant_bulk_submit" | "merchant_bulk_preview", limit: number) {
  const rate = await consumeAbuseCounter(prisma, {
    bucketType: bucket,
    subjectDigest: createHash("sha256").update(`${bucket}:${userId}`).digest("hex"),
    digestVersion: 1,
    windowSeconds: 3_600,
    limit
  });
  if (!rate.allowed) {
    throw Object.assign(new HttpError(429, "bulk_rate_limit_exceeded"), { retryAfterSeconds: rate.retryAfterSeconds });
  }
}

function rejectInvalid(res: import("express").Response, req: AuthenticatedRequest, errors: RowError[], totalRows: number) {
  res.status(400).json({
    error: "bulk_validation_failed",
    total_rows: totalRows,
    errors,
    request_id: req.requestId ?? "unavailable"
  });
}

merchantBulkRouter.use("/merchant/orders/bulk", requireAuth, requireRole("merchant"));

// Preview: validate every row and show how the orders would be grouped. Writes nothing.
merchantBulkRouter.post("/merchant/orders/bulk/preview", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = bodySchema.parse(req.body);
    await consumeLimit(req.user!.id, "merchant_bulk_preview", BATCHING_LIMITS.bulkPreviewsPerHour);
    const parsed = await resolveBulkRoutes(parseBulkOrdersCsv(input.csv));
    res.json({
      total_rows: parsed.totalRows,
      valid_order_count: parsed.orders.length,
      error_count: parsed.errors.length,
      errors: parsed.errors,
      orders: describeOrders(parsed.orders),
      batch_plan: planPreview(parsed.orders),
      limits: {
        max_rows: BATCHING_LIMITS.maxBulkUploadOrders,
        max_parcels_per_order: BATCHING_LIMITS.maxParcelsPerOrder
      }
    });
  } catch (error) {
    if (error && typeof error === "object" && "retryAfterSeconds" in error) {
      res.setHeader("Retry-After", String(error.retryAfterSeconds));
    }
    next(error);
  }
});

// Submit: each order goes through the existing creation function with a derived
// idempotency key, so retrying the same upload never creates a second order.
merchantBulkRouter.post("/merchant/orders/bulk", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = bodySchema.parse(req.body);
    const rawKey = req.header("idempotency-key");
    if (rawKey === undefined) throw new HttpError(400, "idempotency_key_required");
    const uploadKey = merchantCreateIdempotencyKey.parse(rawKey);
    await consumeLimit(req.user!.id, "merchant_bulk_submit", BATCHING_LIMITS.bulkSubmitsPerHour);

    const parsed = await resolveBulkRoutes(parseBulkOrdersCsv(input.csv));
    const wholeFileError = parsed.errors.some((error) => error.row <= 1);
    if (parsed.orders.length === 0 || wholeFileError || (parsed.errors.length > 0 && !input.skip_invalid)) {
      rejectInvalid(res.status(400), req, parsed.errors, parsed.totalRows);
      return;
    }

    const keys = bulkRowKeys(uploadKey, parsed.orders);
    const results: Array<Record<string, unknown>> = [];
    const orderIds: string[] = [];
    let created = 0;
    let replayed = 0;
    for (const [index, order] of parsed.orders.entries()) {
      try {
        const outcome = await createLegacyMerchantOrder(req.user!.id, orderInput(order), keys[index]!);
        if (outcome.replayed) replayed += 1;
        else created += 1;
        orderIds.push(outcome.order.id);
        results.push({
          rows: order.rows,
          status: outcome.replayed ? "replayed" : "created",
          order_id: outcome.order.id,
          parcel_count: order.input.parcels.length
        });
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error && error.code === "P2034"
            ? "transaction_retry_required"
            : error instanceof HttpError
              ? error.message
              : "order_create_failed";
        const message = RETRY_MESSAGES[code] ?? {
          en: "The order could not be created.",
          ar: "تعذر إنشاء الطلب."
        };
        results.push({ rows: order.rows, status: "failed", code, message_en: message.en, message_ar: message.ar });
      }
    }
    for (const error of parsed.errors) {
      results.push({ rows: [error.row], status: "invalid", code: error.code, field: error.field, message_en: error.message_en, message_ar: error.message_ar });
    }

    const batches: string[] = [];
    if (input.auto_batch) {
      for (const id of orderIds) {
        try {
          const batch = await createParcelBatch(req, id);
          batches.push(batch.id);
        } catch {
          // Already grouped by an earlier batch, or not batchable: leave it for manual batching.
        }
      }
    }

    const failed = results.filter((entry) => entry.status === "failed" || entry.status === "invalid").length;
    res.status(created > 0 ? 201 : 200).json({
      summary: { total_rows: parsed.totalRows, created, replayed, failed },
      results,
      batch_ids: batches
    });
  } catch (error) {
    if (error && typeof error === "object" && "retryAfterSeconds" in error) {
      res.setHeader("Retry-After", String(error.retryAfterSeconds));
    }
    next(error);
  }
});
