import { randomInt } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { config } from "../config.js";
import { HttpError } from "../middleware/error.js";
import { hexDigestMatches, keyedDigest, type VersionedKey } from "../lib/keyedDigest.js";

/**
 * Receiver confirmation for parcel deliveries. It only needs a parcel order id, so it
 * serves any parcel order regardless of who created it (merchant or passenger sender).
 */
type Db = PrismaClient | Prisma.TransactionClient;

export const HANDOVER_CODE_MAX_ATTEMPTS = 5;
export const HANDOVER_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const UNAVAILABLE_REASON_MIN = 10;
export const UNAVAILABLE_REASON_MAX = 300;

export type ConfirmationMethod = "receiver_code" | "receiver_unavailable" | "admin_override";

export function handoverKey(): VersionedKey {
  return config.authActions?.key ?? { secret: config.refreshTokenPepper, version: 1 };
}

export function handoverCodeDigest(orderId: string, code: string, key: VersionedKey) {
  return keyedDigest(`masari:delivery-handover:${orderId}`, code, key);
}

export function generateHandoverCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * Creates the handover for an order, or rotates its code while it is still unconfirmed
 * (a rotation also clears the wrong-guess counter and restarts the expiry). The plain
 * code is returned once; only its digest is stored.
 */
export async function issueHandover(db: Db, orderId: string, now = new Date()) {
  const key = handoverKey();
  const code = generateHandoverCode();
  const data = {
    code_digest: handoverCodeDigest(orderId, code, key),
    key_version: key.version,
    failed_attempts: 0,
    expires_at: new Date(now.getTime() + HANDOVER_TTL_MS)
  };
  const existing = await db.deliveryHandover.findUnique({ where: { merchant_order_id: orderId } });
  if (!existing) {
    await db.deliveryHandover.create({ data: { merchant_order_id: orderId, ...data } });
  } else {
    const rotated = await db.deliveryHandover.updateMany({
      where: { merchant_order_id: orderId, confirmed_at: null },
      data
    });
    if (rotated.count !== 1) throw new HttpError(409, "delivery_already_confirmed");
  }
  return { code, expires_at: data.expires_at };
}

type HandoverRow = {
  code_digest: string | null;
  failed_attempts: number;
  expires_at: Date | null;
  confirmed_at: Date | null;
  confirmation_method: string | null;
  unavailable_reason: string | null;
} | null;

/** What the sender, driver and admin may see. Never includes the code or its digest. */
export function describeHandover(row: HandoverRow, now = new Date()) {
  if (!row) {
    return {
      issued: false,
      confirmed: false,
      locked: false,
      expired: false,
      attempts_remaining: 0,
      expires_at: null,
      confirmed_at: null,
      confirmation_method: null,
      unavailable_reason: null
    };
  }
  return {
    issued: Boolean(row.code_digest),
    confirmed: Boolean(row.confirmed_at),
    locked: row.failed_attempts >= HANDOVER_CODE_MAX_ATTEMPTS,
    expired: Boolean(row.expires_at && row.expires_at <= now),
    attempts_remaining: Math.max(0, HANDOVER_CODE_MAX_ATTEMPTS - row.failed_attempts),
    expires_at: row.expires_at,
    confirmed_at: row.confirmed_at,
    confirmation_method: row.confirmation_method,
    unavailable_reason: row.unavailable_reason
  };
}

/**
 * Checks the code a receiver read out. Every check spends one of five attempts atomically
 * and is saved even if the caller's transaction later rolls back, so call it with the plain
 * client, before opening the confirming transaction. Resolves when the code is right.
 */
export async function checkHandoverCode(db: Db, orderId: string, code: unknown, now = new Date()) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw new HttpError(422, "invalid_handover_code");
  const row = await db.deliveryHandover.findUnique({ where: { merchant_order_id: orderId } });
  if (!row) throw new HttpError(409, "handover_not_issued");
  if (row.confirmed_at) return;
  if (!row.code_digest) throw new HttpError(409, "handover_not_issued");
  if (row.expires_at && row.expires_at <= now) throw new HttpError(409, "handover_expired");
  const spent = await db.deliveryHandover.updateMany({
    where: { id: row.id, confirmed_at: null, failed_attempts: { lt: HANDOVER_CODE_MAX_ATTEMPTS } },
    data: { failed_attempts: { increment: 1 } }
  });
  if (spent.count !== 1) throw new HttpError(429, "handover_locked");
  const key: VersionedKey = { ...handoverKey(), version: row.key_version };
  if (!hexDigestMatches(row.code_digest, handoverCodeDigest(orderId, code, key))) {
    throw new HttpError(422, "invalid_handover_code");
  }
}

/** Marks the handover confirmed (inside the caller's transaction). Idempotent per order. */
export async function confirmHandover(
  tx: Prisma.TransactionClient,
  input: { orderId: string; method: ConfirmationMethod; actorId: string; tripId: string; reason?: string; now?: Date }
) {
  const now = input.now ?? new Date();
  const data = {
    confirmed_at: now,
    confirmation_method: input.method,
    confirmed_by_id: input.actorId,
    confirmed_trip_id: input.tripId,
    unavailable_reason: input.reason ?? null,
    code_digest: null
  };
  const claimed = await tx.deliveryHandover.updateMany({
    where: { merchant_order_id: input.orderId, confirmed_at: null },
    data
  });
  if (claimed.count === 1) return true;
  const row = await tx.deliveryHandover.findUnique({ where: { merchant_order_id: input.orderId } });
  if (row?.confirmed_at) return false;
  // Orders created before handover codes existed have no row; record the fallback anyway.
  try {
    await tx.deliveryHandover.create({
      data: { merchant_order_id: input.orderId, key_version: handoverKey().version, ...data }
    });
  } catch {
    throw new HttpError(409, "delivery_confirmation_conflict");
  }
  return true;
}

/** Order ids that must be confirmed before a trip may be marked delivered. */
export async function tripOrderIds(
  db: Db,
  trip: { merchant_order_id: string | null; parcel_batch_id: string | null }
) {
  if (trip.parcel_batch_id) {
    const members = await db.parcelBatchOrder.findMany({
      where: { parcel_batch_id: trip.parcel_batch_id },
      select: { merchant_order_id: true }
    });
    const ids = members.map((member) => member.merchant_order_id);
    if (trip.merchant_order_id && !ids.includes(trip.merchant_order_id)) ids.push(trip.merchant_order_id);
    return ids;
  }
  return trip.merchant_order_id ? [trip.merchant_order_id] : [];
}

/** Per-order confirmation state for a trip, safe to show to every party on the trip. */
export async function tripDeliverySummary(
  db: Db,
  trip: { merchant_order_id: string | null; parcel_batch_id: string | null },
  now = new Date()
) {
  const orderIds = await tripOrderIds(db, trip);
  if (!orderIds.length) return { required: false, all_confirmed: true, orders: [] };
  const rows = await db.deliveryHandover.findMany({ where: { merchant_order_id: { in: orderIds } } });
  const byOrder = new Map(rows.map((row) => [row.merchant_order_id, row]));
  const orders = orderIds.map((orderId) => ({ order_id: orderId, ...describeHandover(byOrder.get(orderId) ?? null, now) }));
  return { required: true, all_confirmed: orders.every((order) => order.confirmed), orders };
}

/**
 * How each trip's deliveries were confirmed, for the admin view. A trip is flagged when any
 * of its orders was closed without the receiver's code (receiver unavailable, or admin override).
 */
export async function adminDeliveryConfirmations(
  db: Db,
  trips: { id: string; merchant_order_id: string | null; parcel_batch_id: string | null }[]
) {
  const result = new Map<string, {
    required: boolean;
    total_orders: number;
    confirmed_orders: number;
    methods: string[];
    flagged: boolean;
    reasons: string[];
  }>();
  const batchIds = [...new Set(trips.map((trip) => trip.parcel_batch_id).filter((id): id is string => Boolean(id)))];
  const members = batchIds.length
    ? await db.parcelBatchOrder.findMany({
        where: { parcel_batch_id: { in: batchIds } },
        select: { parcel_batch_id: true, merchant_order_id: true }
      })
    : [];
  const ordersByTrip = new Map<string, string[]>();
  for (const trip of trips) {
    const ids = new Set<string>();
    if (trip.merchant_order_id) ids.add(trip.merchant_order_id);
    for (const member of members) if (member.parcel_batch_id === trip.parcel_batch_id) ids.add(member.merchant_order_id);
    ordersByTrip.set(trip.id, [...ids]);
  }
  const allIds = [...new Set([...ordersByTrip.values()].flat())];
  const rows = allIds.length
    ? await db.deliveryHandover.findMany({
        where: { merchant_order_id: { in: allIds }, confirmed_at: { not: null } },
        select: { merchant_order_id: true, confirmation_method: true, unavailable_reason: true }
      })
    : [];
  const byOrder = new Map(rows.map((row) => [row.merchant_order_id, row]));
  for (const trip of trips) {
    const ids = ordersByTrip.get(trip.id) ?? [];
    const confirmed = ids.map((id) => byOrder.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
    const methods = [...new Set(confirmed.map((row) => row.confirmation_method).filter((m): m is NonNullable<typeof m> => Boolean(m)))];
    result.set(trip.id, {
      required: ids.length > 0,
      total_orders: ids.length,
      confirmed_orders: confirmed.length,
      methods,
      flagged: methods.some((method) => method !== "receiver_code"),
      reasons: confirmed.map((row) => row.unavailable_reason).filter((r): r is string => Boolean(r))
    });
  }
  return result;
}

export async function unconfirmedOrderIds(db: Db, orderIds: string[]) {
  if (!orderIds.length) return [];
  const confirmed = await db.deliveryHandover.findMany({
    where: { merchant_order_id: { in: orderIds }, confirmed_at: { not: null } },
    select: { merchant_order_id: true }
  });
  const done = new Set(confirmed.map((row) => row.merchant_order_id));
  return orderIds.filter((id) => !done.has(id));
}
