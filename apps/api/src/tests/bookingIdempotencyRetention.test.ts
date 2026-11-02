import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../generated/prisma/client.js";
import { claimIdempotency } from "../lib/idempotency.js";

describe("completed booking idempotency retention", () => {
  it.each(["retainCompleted", "preserveCompleted"] as const)(
    "preserves either line's %s completed-key contract", async retentionOption => {
    for (const operation of ["canonical_passenger_request_create", "canonical_merchant_order_create", "driver_availability_create", "legacy_merchant_order_create"]) {

      const record = { id: "completed_claim", claim_version: 1, state: "completed", request_digest: "a".repeat(64),
        expires_at: new Date(0), resource_type: "booked_resource", resource_id: "original_resource" };
      const db = { idempotencyRecord: {
        create: vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" })),
        findUniqueOrThrow: vi.fn().mockResolvedValue(record), updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      }, auditEvent: { create: vi.fn().mockResolvedValue({}) } };
      const input = { operation, scopeDigest: "b".repeat(64), keyDigest: "c".repeat(64), keyVersion: 1,
        requestDigest: record.request_digest, expiresAt: new Date(Date.now() + 86_400_000), [retentionOption]: true };
      const replay = await claimIdempotency(db as never, input);
      expect(replay.kind).toBe("replay");
      expect(replay.record.resource_id).toBe(record.resource_id);
      expect((await claimIdempotency(db as never, { ...input, requestDigest: "d".repeat(64) })).kind).toBe("conflict");
      expect(db.idempotencyRecord.updateMany).not.toHaveBeenCalled();
    }
    },
  );
});
