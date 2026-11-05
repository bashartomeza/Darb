import type { PrismaClient } from "../generated/prisma/client.js";
import { TripStatus } from "../generated/prisma/enums.js";

/**
 * Retention purges for data that only grows (docs/operations/data-retention.md).
 * Every purge deletes in small batches by primary key so it never holds a long
 * lock, stops after `maxBatches`, and is safe to repeat. Audit events and anything
 * legally relevant are deliberately not handled here.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
export const LOCATION_LAST_POINT_GRACE_MS = DAY_MS;
export const DEFAULT_BATCH_SIZE = 1000;
export const DEFAULT_MAX_BATCHES = 500;

const FINISHED_TRIP_STATUSES = [TripStatus.delivered, TripStatus.completed, TripStatus.cancelled, TripStatus.failed];

export type PurgeOptions = { now?: Date; batchSize?: number; maxBatches?: number; pauseMs?: number };

export function limits(options: PurgeOptions) {
  return {
    now: options.now ?? new Date(),
    batchSize: Math.max(1, Math.floor(options.batchSize ?? DEFAULT_BATCH_SIZE)),
    maxBatches: Math.max(1, Math.floor(options.maxBatches ?? DEFAULT_MAX_BATCHES)),
    pauseMs: options.pauseMs ?? 0
  };
}

export function daysAgo(now: Date, days: number) {
  return new Date(now.getTime() - days * DAY_MS);
}

/** Repeats find + delete-by-id until a short batch or the batch cap. Returns rows deleted. */
export async function purgeInBatches(
  find: (take: number) => Promise<string[]>,
  remove: (ids: string[]) => Promise<number>,
  options: { batchSize: number; maxBatches: number; pauseMs: number }
) {
  let deleted = 0;
  for (let batch = 0; batch < options.maxBatches; batch += 1) {
    const ids = await find(options.batchSize);
    if (ids.length === 0) break;
    deleted += await remove(ids);
    if (ids.length < options.batchSize) break;
    if (options.pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, options.pauseMs));
  }
  return deleted;
}

/** A trip's end: completed_at, or its creation time for cancelled/failed trips that never set it. */
function tripEndedBefore(date: Date) {
  return {
    status: { in: FINISHED_TRIP_STATUSES },
    OR: [{ completed_at: { lt: date } }, { completed_at: null, created_at: { lt: date } }]
  };
}

/**
 * Deletes live-location points older than `retentionDays` for finished trips.
 * Trips that are still running are never touched. For 24 hours after a trip
 * ends its latest point is kept (support may need the last known position).
 */
export async function purgeLocationEvents(db: PrismaClient, options: PurgeOptions & { retentionDays: number }) {
  const { now, ...batching } = limits(options);
  const cutoff = daysAgo(now, options.retentionDays);
  const graceEnd = new Date(now.getTime() - LOCATION_LAST_POINT_GRACE_MS);
  let deleted = 0;

  // Trips that ended more than 24 h ago: every old point goes.
  deleted += await purgeInBatches(
    async (take) =>
      (
        await db.locationEvent.findMany({
          where: { recorded_at: { lt: cutoff }, trip: tripEndedBefore(graceEnd) },
          select: { id: true },
          orderBy: { recorded_at: "asc" },
          take
        })
      ).map((row) => row.id),
    async (ids) => (await db.locationEvent.deleteMany({ where: { id: { in: ids } } })).count,
    batching
  );

  // Trips that ended within the last 24 h: old points go except the latest one.
  const recentTrips = await db.trip.findMany({
    where: {
      status: { in: FINISHED_TRIP_STATUSES },
      NOT: tripEndedBefore(graceEnd),
      location_events: { some: { recorded_at: { lt: cutoff } } }
    },
    select: { id: true },
    take: batching.batchSize
  });
  for (const trip of recentTrips) {
    const latest = await db.locationEvent.findFirst({
      where: { trip_id: trip.id },
      orderBy: { sequence: "desc" },
      select: { id: true }
    });
    deleted += await purgeInBatches(
      async (take) =>
        (
          await db.locationEvent.findMany({
            where: { trip_id: trip.id, recorded_at: { lt: cutoff }, ...(latest ? { id: { not: latest.id } } : {}) },
            select: { id: true },
            orderBy: { sequence: "asc" },
            take
          })
        ).map((row) => row.id),
      async (ids) => (await db.locationEvent.deleteMany({ where: { id: { in: ids } } })).count,
      batching
    );
  }
  return { deleted };
}

