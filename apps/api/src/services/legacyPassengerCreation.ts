import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";

const OPERATION = "legacy_passenger_request_create_v1";
export type LegacyPassengerCreationInput = {
  pickup_label: string;
  pickup_lat: number;
  pickup_lng: number;
  destination_label: string;
  destination_lat: number;
  destination_lng: number;
  preferred_time: Date;
  passenger_count: number;
};
type Actor = { id: string; idempotencyKey?: string };
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createLegacyPassengerCreationService(db: PrismaClient = prisma) {
  return {
    async create(input: LegacyPassengerCreationInput, actor: Actor) {
      return db.$transaction(async (tx) => {
        const payload = {
          pickup_label: input.pickup_label,
          pickup_lat: input.pickup_lat,
          pickup_lng: input.pickup_lng,
          destination_label: input.destination_label,
          destination_lat: input.destination_lat,
          destination_lng: input.destination_lng,
          preferred_time: input.preferred_time.toISOString(),
          passenger_count: input.passenger_count,
        };
        const claim = actor.idempotencyKey === undefined ? undefined : await claimIdempotency(tx, {
          operation: OPERATION,
          scopeDigest: digest(`${OPERATION}:${actor.id}`),
          keyDigest: digest(actor.idempotencyKey),
          keyVersion: 1,
          requestDigest: digest(JSON.stringify({ actor_id: actor.id, payload })),
          expiresAt: new Date(Date.now() + 86_400_000),
          retainCompleted: true,
        });
        if (claim?.kind === "conflict") throw new HttpError(409, "idempotency_conflict");
        if (claim?.kind === "in_progress") throw new HttpError(409, "idempotency_in_progress");
        if (claim?.kind === "failed") throw new HttpError(409, "idempotency_failed");
        if (claim?.kind === "replay") {
          if (claim.record.resource_type !== "PassengerRequest" || !claim.record.resource_id) {
            throw new HttpError(409, "idempotency_replay_unavailable");
          }
          const resource = await tx.passengerRequest.findFirst({
            where: { id: claim.record.resource_id, passenger_id: actor.id, canonical_entry_version: null, operational_mode: "legacy" },
          });
          if (!resource) throw new HttpError(409, "idempotency_replay_unavailable");
          return { resource, replayed: true };
        }
        if (input.preferred_time <= new Date()) throw new HttpError(400, "preferred_time_in_past");
        const resource = await tx.passengerRequest.create({ data: {
          passenger_id: actor.id,
          ...payload,
          pickup_lat: input.pickup_lat.toFixed(6),
          pickup_lng: input.pickup_lng.toFixed(6),
          destination_lat: input.destination_lat.toFixed(6),
          destination_lng: input.destination_lng.toFixed(6),
          preferred_time: input.preferred_time,
          status: "pending",
          source: "manual",
        } });
        await auditEvent(tx, { userId: actor.id, action: AuditAction.passenger_request_created,
          entityType: "PassengerRequest", entityId: resource.id });
        if (claim) await completeIdempotency(tx, {
          recordId: claim.record.id, claimVersion: claim.record.claim_version,
          resourceType: "PassengerRequest", resourceId: resource.id, responseStatus: 201,
        });
        return { resource, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    },
  };
}

export const legacyPassengerCreationService = createLegacyPassengerCreationService();
