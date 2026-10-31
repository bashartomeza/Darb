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
  parseBulkOrdersCsv,
  type ParsedBulkOrder,
  type RowError
} from "../services/merchantBulkOrders.js";

export const merchantBulkRouter = Router();

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

function describeOrders(orders: ParsedBulkOrder[]) {
  return orders.map((order) => ({
    rows: order.rows,
    pickup_label: order.input.pickup_label,
    parcel_count: order.input.parcels.length
  }));
}

function planPreview(orders: ParsedBulkOrder[]) {
  const plan = planBatches(
    orders.map((order, index) => ({
      id: String(index),
      pickup: { lat: order.input.pickup_lat, lng: order.input.pickup_lng },
      parcels: order.input.parcels.map((parcel) => ({
        lat: parcel.destination_lat,
        lng: parcel.destination_lng,
        size: parcel.size
      }))
    }))
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
    const parsed = parseBulkOrdersCsv(input.csv);
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

    const parsed = parseBulkOrdersCsv(input.csv);
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
        const outcome = await createLegacyMerchantOrder(req.user!.id, order.input, keys[index]!);
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
