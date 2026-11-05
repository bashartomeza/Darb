import type { PrismaClient } from "../generated/prisma/client.js";
import { IdempotencyState } from "../generated/prisma/enums.js";
import { purgeInBatches, limits, daysAgo, type PurgeOptions } from "./dataRetention.js";

export type RetentionWindows = {
  sessionDays: number;
  authTokenDays: number;
  idempotencyDays: number;
  abuseCounterDays: number;
  pushDeviceDays: number;
  notificationDays: number;
};

type Table = {
  findMany(args: { where: never; select: { id: true }; take: number }): Promise<{ id: string }[]>;
  deleteMany(args: { where: { id: { in: string[] } } }): Promise<{ count: number }>;
};

/**
 * Deletes rows that are plainly finished: expired or revoked sessions and refresh
 * tokens, used or expired email codes and reset links, expired idempotency claims
 * that never completed, expired abuse counters, long-revoked push devices, and old
 * notifications. Completed idempotency claims are kept (booking replays rely on
 * them) and audit events are never touched. A failing step is reported in
 * `errors` and does not stop the others.
 */
export async function purgeExpiredData(db: PrismaClient, windows: RetentionWindows, options: PurgeOptions = {}) {
  const { now, ...batching } = limits(options);
  const sessionCutoff = daysAgo(now, windows.sessionDays);
  const tokenCutoff = daysAgo(now, windows.authTokenDays);
  const idempotencyCutoff = daysAgo(now, windows.idempotencyDays);
  const abuseCutoff = daysAgo(now, windows.abuseCounterDays);
  const deviceCutoff = daysAgo(now, windows.pushDeviceDays);
  const notificationCutoff = daysAgo(now, windows.notificationDays);

  const steps: [string, Table, object][] = [
    ["refreshTokens", db.refreshToken as unknown as Table, { OR: [{ expires_at: { lt: sessionCutoff } }, { revoked_at: { lt: sessionCutoff } }] }],
    // Deleting a session cascades to any refresh tokens left and detaches push devices.
    ["authSessions", db.authSession as unknown as Table, { OR: [{ expires_at: { lt: sessionCutoff } }, { revoked_at: { lt: sessionCutoff } }] }],
    ["authActionTokens", db.authActionToken as unknown as Table, { OR: [{ expires_at: { lt: tokenCutoff } }, { consumed_at: { lt: tokenCutoff } }] }],
    ["idempotencyRecords", db.idempotencyRecord as unknown as Table, { expires_at: { lt: idempotencyCutoff }, state: { not: IdempotencyState.completed } }],
    ["abuseCounters", db.abuseCounter as unknown as Table, { expires_at: { lt: abuseCutoff } }],
    ["pushDevices", db.pushDevice as unknown as Table, { revoked_at: { lt: deviceCutoff } }],
    ["notifications", db.notification as unknown as Table, { created_at: { lt: notificationCutoff } }]
  ];
  const deleted: Record<string, number> = {};
  const errors: string[] = [];
  for (const [name, table, where] of steps) {
    try {
      deleted[name] = await purgeInBatches(
        async (take) => (await table.findMany({ where: where as never, select: { id: true }, take })).map((row) => row.id),
        async (ids) => (await table.deleteMany({ where: { id: { in: ids } } })).count,
        batching
      );
    } catch (error) {
      deleted[name] = 0;
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { deleted, errors };
}
