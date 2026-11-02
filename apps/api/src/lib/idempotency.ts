import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "./audit.js";
import { hexDigestMatches } from "./keyedDigest.js";

export async function claimIdempotency(
  db: PrismaClient | Prisma.TransactionClient,
  input: {
    operation: string;
    scopeDigest: string;
    keyDigest: string;
    keyVersion: number;
    requestDigest: string;
    expiresAt: Date;
    now?: Date;
    preserveCompleted?: boolean;
    retainCompleted?: boolean;
  }
) {
  if (![input.scopeDigest, input.keyDigest, input.requestDigest].every((digest) => /^[a-f0-9]{64}$/.test(digest))) {
    throw new Error("idempotency_digest_invalid");
  }
  const now = input.now ?? new Date();
  try {
    const record = await db.idempotencyRecord.create({
      data: {
        operation: input.operation,
        scope_digest: input.scopeDigest,
        idempotency_key: input.keyDigest,
        key_version: input.keyVersion,
        request_digest: input.requestDigest,
        expires_at: input.expiresAt
      }
    });
    return { kind: "claimed" as const, record };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    let record = await db.idempotencyRecord.findUniqueOrThrow({
      where: {
        operation_scope_digest_idempotency_key_key_version: {
          operation: input.operation,
          scope_digest: input.scopeDigest,
          idempotency_key: input.keyDigest,
          key_version: input.keyVersion
        }
      }
    });
    if (record.expires_at <= now && !((input.preserveCompleted || input.retainCompleted) && record.state === "completed")) {
      const reclaimed = await db.idempotencyRecord.updateMany({
        where: { id: record.id, claim_version: record.claim_version, expires_at: { lte: now } },
        data: {
          request_digest: input.requestDigest,
          claim_version: { increment: 1 },
          state: "processing",
          resource_type: null,
          resource_id: null,
          response_status: null,
          completed_at: null,
          failed_at: null,
          expires_at: input.expiresAt
        }
      });
      if (reclaimed.count === 1) {
        record = await db.idempotencyRecord.findUniqueOrThrow({ where: { id: record.id } });
        return { kind: "claimed" as const, record };
      }
      record = await db.idempotencyRecord.findUniqueOrThrow({ where: { id: record.id } });
    }
    if (!hexDigestMatches(record.request_digest, input.requestDigest)) {
      await auditEvent(db, {
        action: AuditAction.idempotency_conflict,
        entityType: "IdempotencyRecord",
        entityId: record.id,
        metadata: { operation: input.operation }
      });
      return { kind: "conflict" as const, record };
    }
    return {
      kind: record.state === "completed"
        ? ("replay" as const)
        : record.state === "failed"
          ? ("failed" as const)
          : ("in_progress" as const),
      record
    };
  }
}

export async function completeIdempotency(
  db: PrismaClient | Prisma.TransactionClient,
  input: { recordId: string; claimVersion: number; resourceType: string; resourceId: string; responseStatus: number }
) {
  const completed = await db.idempotencyRecord.updateMany({
    where: { id: input.recordId, claim_version: input.claimVersion, state: "processing" },
    data: {
      state: "completed",
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      response_status: input.responseStatus,
      completed_at: new Date()
    }
  });
  if (completed.count !== 1) throw new Error("idempotency_claim_lost");
  return db.idempotencyRecord.findUniqueOrThrow({ where: { id: input.recordId } });
}

export async function failIdempotency(
  db: PrismaClient | Prisma.TransactionClient,
  input: { recordId: string; claimVersion: number; retryAfter?: Date }
) {
  const terminal = !input.retryAfter;
  const failed = await db.idempotencyRecord.updateMany({
    where: { id: input.recordId, claim_version: input.claimVersion, state: "processing" },
    data: terminal
      ? { state: "failed", failed_at: new Date() }
      : { expires_at: input.retryAfter }
  });
  if (failed.count !== 1) throw new Error("idempotency_claim_lost");
}
