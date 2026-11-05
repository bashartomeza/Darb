import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "./audit.js";
import { isTransactionConflict } from "./transactionConflict.js";

export async function consumeAbuseCounter(
  db: PrismaClient,
  input: {
    bucketType: string;
    subjectDigest: string;
    digestVersion: number;
    windowSeconds: number;
    limit: number;
    now?: Date;
  }
) {
  if (!Number.isSafeInteger(input.windowSeconds) || input.windowSeconds <= 0) {
    throw new Error("abuse_window_invalid");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0) throw new Error("abuse_limit_invalid");
  const nowMs = (input.now ?? new Date()).getTime();
  const windowMs = input.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(nowMs / windowMs) * windowMs);
  const expiresAt = new Date(windowStart.getTime() + windowMs);
  // Concurrent first hits on the same counter (for example right after the row was deleted) can make
  // MySQL pick a deadlock victim for the upsert. The transaction is rolled back whole, so retrying it
  // counts the request exactly once.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await countOnce(db, input, windowStart, expiresAt, nowMs);
    } catch (error) {
      if (!isTransactionConflict(error) || attempt === MAX_CONFLICT_RETRIES) throw error;
    }
  }
}

const MAX_CONFLICT_RETRIES = 3;

async function countOnce(
  db: PrismaClient,
  input: { bucketType: string; subjectDigest: string; digestVersion: number; windowSeconds: number; limit: number },
  windowStart: Date,
  expiresAt: Date,
  nowMs: number
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO abuse_counters
        (id, bucket_type, subject_digest, digest_version, window_start, window_seconds, count, expires_at, created_at, updated_at)
      VALUES
        (${randomUUID()}, ${input.bucketType}, ${input.subjectDigest}, ${input.digestVersion}, ${windowStart}, ${input.windowSeconds}, 1, ${expiresAt}, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE count = count + 1, updated_at = CURRENT_TIMESTAMP(3)
    `;
    const counter = await tx.abuseCounter.findUniqueOrThrow({
      where: {
        bucket_type_subject_digest_digest_version_window_start_window_seconds: {
          bucket_type: input.bucketType,
          subject_digest: input.subjectDigest,
          digest_version: input.digestVersion,
          window_start: windowStart,
          window_seconds: input.windowSeconds
        }
      }
    });
    if (counter.count === input.limit + 1) {
      await auditEvent(tx, {
        action: AuditAction.abuse_limit_reached,
        entityType: "AbuseCounter",
        entityId: counter.id,
        metadata: { bucket_type: input.bucketType, window_seconds: input.windowSeconds }
      });
    }
    return {
      allowed: counter.count <= input.limit,
      count: counter.count,
      remaining: Math.max(0, input.limit - counter.count),
      retryAfterSeconds: Math.max(0, Math.ceil((expiresAt.getTime() - nowMs) / 1000)),
      windowStart,
      expiresAt
    };
  });
}
