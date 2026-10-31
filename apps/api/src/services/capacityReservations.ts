import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { requireEligibleOperationalRoute } from "./operationalRouteEligibility.js";

export const CAPACITY_HOLD_LIMITS = { maximumMinutes: 30, expiryBatchSize: 100 } as const;
const RELEASE_REASONS = ["offer_rejected", "offer_cancelled", "operator_cancelled", "test_cleanup"] as const;
export type CapacityReleaseReason = (typeof RELEASE_REASONS)[number];

type Actor = { id: string; requestId?: string; idempotencyKey: string };
type HoldInput = {
  driverRouteId: string;
  routeVersionId: string;
  matchId?: string | null;
  reservationType: "passenger" | "parcel" | "combined";
  seatsReserved: number;
  parcelUnitsReserved: number;
  expiresAt: Date;
};

type LockedAvailability = {
  id: string;
  status: string;
  route_version_id: string | null;
  availability_status: string | null;
  canonical_availability_version: string | null;
  operational_mode: string;
  departure_at: Date | null;
  total_seats: number | null;
  remaining_seats: number | null;
  total_parcel_capacity: number | null;
  remaining_parcel_capacity: number | null;
  driver_verified: boolean | number;
  driver_account_status: string;
  driver_role: string;
};

type LockedReservation = {
  id: string;
  driver_route_id: string;
  route_version_id: string;
  status: "held" | "confirmed" | "released" | "expired";
  seats_reserved: number;
  parcel_units_reserved: number;
  expires_at: Date;
  revision: number;
};

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function validateHold(input: HoldInput, now = new Date()) {
  if (!Number.isInteger(input.seatsReserved) || !Number.isInteger(input.parcelUnitsReserved)) {
    throw new HttpError(400, "invalid_reservation_capacity");
  }
  const validType =
    (input.reservationType === "passenger" && input.seatsReserved > 0 && input.parcelUnitsReserved === 0) ||
    (input.reservationType === "parcel" && input.seatsReserved === 0 && input.parcelUnitsReserved > 0) ||
    (input.reservationType === "combined" && input.seatsReserved > 0 && input.parcelUnitsReserved > 0);
  if (!validType) throw new HttpError(400, "invalid_reservation_capacity");
  if (input.expiresAt <= now || input.expiresAt.getTime() - now.getTime() > CAPACITY_HOLD_LIMITS.maximumMinutes * 60_000) {
    throw new HttpError(400, "invalid_reservation_expiry");
  }
}

async function claimMutation(
  tx: Prisma.TransactionClient,
  operation: string,
  actor: Actor,
  scope: string,
  payload: unknown
) {
  const scopeDigest = digest(`${operation}:${actor.id}:${scope}`);
  const keyDigest = digest(actor.idempotencyKey);
  const requestDigest = digest(JSON.stringify({ actor_id: actor.id, scope, payload }));
  const claim = await claimIdempotency(tx, {
    operation,
    scopeDigest,
    keyDigest,
    keyVersion: 1,
    requestDigest,
    expiresAt: new Date(Date.now() + 86_400_000)
  });
  if (claim.kind === "conflict") throw new HttpError(409, "idempotency_conflict");
  if (claim.kind === "in_progress") throw new HttpError(409, "idempotency_in_progress");
  if (claim.kind === "failed") throw new HttpError(409, "idempotency_failed");
  return { claim, fingerprint: digest(`${scopeDigest}:${keyDigest}:${requestDigest}`) };
}

async function replayReservation(tx: Prisma.TransactionClient, resourceType: string | null, resourceId: string | null) {
  if (resourceType !== "CapacityReservation" || !resourceId) throw new HttpError(409, "idempotency_replay_unavailable");
  const resource = await tx.capacityReservation.findUnique({ where: { id: resourceId } });
  if (!resource) throw new HttpError(409, "idempotency_replay_unavailable");
  return resource;
}

async function lockReservation(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<LockedReservation[]>`
    SELECT id, driver_route_id, route_version_id, status, seats_reserved,
           parcel_units_reserved, expires_at, revision
    FROM capacity_reservations WHERE id = ${id} FOR UPDATE
  `;
  if (rows.length !== 1) throw new HttpError(404, "capacity_reservation_not_found");
  return rows[0];
}

async function lockAvailability(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<LockedAvailability[]>`
    SELECT dr.id, dr.status, dr.route_version_id, dr.availability_status,
           dr.canonical_availability_version, dr.operational_mode, dr.departure_at, dr.total_seats,
           dr.remaining_seats, dr.total_parcel_capacity, dr.remaining_parcel_capacity,
           dp.verified AS driver_verified, u.account_status AS driver_account_status,
           u.role AS driver_role
    FROM driver_routes dr
    INNER JOIN driver_profiles dp ON dp.id = dr.driver_id
    INNER JOIN users u ON u.id = dp.user_id
    WHERE dr.id = ${id}
    FOR UPDATE
  `;
  if (rows.length !== 1) throw new HttpError(404, "availability_not_found");
  return rows[0];
}

async function restoreCapacity(
  tx: Prisma.TransactionClient,
  reservation: LockedReservation,
  status: "released" | "expired",
  reason: CapacityReleaseReason | "hold_expired",
  requestId?: string,
  actorId?: string
) {
  const availability = await lockAvailability(tx, reservation.driver_route_id);
  if (availability.route_version_id !== reservation.route_version_id) throw new HttpError(409, "reservation_route_mismatch");
  const restored = await tx.driverRoute.updateMany({
    where: {
      id: availability.id,
      route_version_id: reservation.route_version_id,
      remaining_seats: { lte: availability.total_seats! - reservation.seats_reserved },
      remaining_parcel_capacity: { lte: availability.total_parcel_capacity! - reservation.parcel_units_reserved }
    },
    data: {
      remaining_seats: { increment: reservation.seats_reserved },
      remaining_parcel_capacity: { increment: reservation.parcel_units_reserved }
    }
  });
  if (restored.count !== 1) throw new HttpError(409, "capacity_restore_invariant_failed");
  const now = new Date();
  const terminal = await tx.capacityReservation.updateMany({
    where: { id: reservation.id, status: "held", revision: reservation.revision },
    data: { status, released_at: now, release_reason: reason, revision: { increment: 1 } }
  });
  if (terminal.count !== 1) throw new HttpError(409, "reservation_state_conflict");
  const resource = await tx.capacityReservation.findUniqueOrThrow({ where: { id: reservation.id } });
  await auditEvent(tx, {
    userId: actorId,
    action: status === "expired" ? AuditAction.capacity_expired : AuditAction.capacity_released,
    entityType: "CapacityReservation",
    entityId: resource.id,
    metadata: {
      route_version_id: resource.route_version_id,
      seats: resource.seats_reserved,
      parcel_units: resource.parcel_units_reserved,
      transition: `held_to_${status}`,
      reason_code: reason,
      request_id: requestId
    }
  });
  return resource;
}

export function createCapacityReservationService(db: PrismaClient = prisma) {
  return {
    async hold(input: HoldInput, actor: Actor) {
      return db.$transaction(async (tx) => {
        const payload = {
          driver_route_id: input.driverRouteId,
          route_version_id: input.routeVersionId,
          match_id: input.matchId ?? null,
          reservation_type: input.reservationType,
          seats_reserved: input.seatsReserved,
          parcel_units_reserved: input.parcelUnitsReserved,
          expires_at: input.expiresAt.toISOString()
        };
        const { claim, fingerprint } = await claimMutation(
          tx,
          "capacity_hold",
          actor,
          `${input.driverRouteId}:${input.routeVersionId}`,
          payload
        );
        if (claim.kind === "replay") {
          return { resource: await replayReservation(tx, claim.record.resource_type, claim.record.resource_id), replayed: true };
        }
        validateHold(input);
        const availability = await lockAvailability(tx, input.driverRouteId);
        await requireEligibleOperationalRoute(tx, input.routeVersionId, { lockForUpdate: true });
        const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT UTC_TIMESTAMP(3) AS now`;
        const now = clock!.now;
        validateHold(input, now);
        await requireEligibleOperationalRoute(tx, input.routeVersionId, { now });
        if (
          availability.route_version_id !== input.routeVersionId ||
          availability.canonical_availability_version !== "canonical_route_v1" ||
          availability.operational_mode !== "canonical_route_v1" ||
          availability.status !== "active" ||
          availability.availability_status !== "active" ||
          !availability.driver_verified ||
          availability.driver_role !== "driver" ||
          availability.driver_account_status !== "active" ||
          !availability.departure_at || availability.departure_at <= now
        ) throw new HttpError(409, "availability_not_reservable");
        if (input.matchId) {
          const match = await tx.match.findUnique({
            where: { id: input.matchId },
            select: { route_version_id: true, canonical_match_version: true, operational_mode: true, driver_route_id: true }
          });
          if (
            !match || match.canonical_match_version !== "canonical_route_v1" ||
            match.operational_mode !== "canonical_route_v1" ||
            match.route_version_id !== input.routeVersionId || match.driver_route_id !== input.driverRouteId
          ) throw new HttpError(409, "canonical_route_mismatch");
        }
        const decremented = await tx.driverRoute.updateMany({
          where: {
            id: availability.id,
            route_version_id: input.routeVersionId,
            availability_status: "active",
            departure_at: { gt: now },
            remaining_seats: { gte: input.seatsReserved },
            remaining_parcel_capacity: { gte: input.parcelUnitsReserved }
          },
          data: {
            remaining_seats: { decrement: input.seatsReserved },
            remaining_parcel_capacity: { decrement: input.parcelUnitsReserved }
          }
        });
        if (decremented.count !== 1) throw new HttpError(409, "insufficient_capacity");
        const resource = await tx.capacityReservation.create({
          data: {
            driver_route_id: input.driverRouteId,
            route_version_id: input.routeVersionId,
            match_id: input.matchId ?? null,
            reservation_type: input.reservationType,
            seats_reserved: input.seatsReserved,
            parcel_units_reserved: input.parcelUnitsReserved,
            expires_at: input.expiresAt,
            created_request_id: actor.requestId,
            idempotency_fingerprint: fingerprint,
            operational_mode: "canonical_route_v1"
          }
        });
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.capacity_reserved,
          entityType: "CapacityReservation",
          entityId: resource.id,
          metadata: {
            route_version_id: resource.route_version_id,
            seats: resource.seats_reserved,
            parcel_units: resource.parcel_units_reserved,
            transition: "created_held",
            request_id: actor.requestId
          }
        });
        await completeIdempotency(tx, {
          recordId: claim.record.id,
          claimVersion: claim.record.claim_version,
          resourceType: "CapacityReservation",
          resourceId: resource.id,
          responseStatus: 201
        });
        return { resource, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    },

    async confirm(id: string, actor: Actor) {
      return db.$transaction(async (tx) => {
        const { claim } = await claimMutation(tx, "capacity_confirm", actor, id, { reservation_id: id });
        if (claim.kind === "replay") {
          return { resource: await replayReservation(tx, claim.record.resource_type, claim.record.resource_id), replayed: true };
        }
        const reservation = await lockReservation(tx, id);
        if (reservation.status === "confirmed") {
          const resource = await tx.capacityReservation.findUniqueOrThrow({ where: { id } });
          await completeIdempotency(tx, {
            recordId: claim.record.id, claimVersion: claim.record.claim_version,
            resourceType: "CapacityReservation", resourceId: id, responseStatus: 200
          });
          return { resource, replayed: true };
        }
        if (reservation.status !== "held") throw new HttpError(409, "reservation_not_confirmable");
        if (reservation.expires_at <= new Date()) throw new HttpError(409, "reservation_expired");
        const changed = await tx.capacityReservation.updateMany({
          where: { id, status: "held", revision: reservation.revision },
          data: { status: "confirmed", confirmed_at: new Date(), revision: { increment: 1 } }
        });
        if (changed.count !== 1) throw new HttpError(409, "reservation_state_conflict");
        const resource = await tx.capacityReservation.findUniqueOrThrow({ where: { id } });
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.capacity_confirmed,
          entityType: "CapacityReservation",
          entityId: id,
          metadata: { route_version_id: resource.route_version_id, transition: "held_to_confirmed", request_id: actor.requestId }
        });
        await completeIdempotency(tx, {
          recordId: claim.record.id, claimVersion: claim.record.claim_version,
          resourceType: "CapacityReservation", resourceId: id, responseStatus: 200
        });
        return { resource, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    },

    async release(id: string, reason: CapacityReleaseReason, actor: Actor) {
      if (!RELEASE_REASONS.includes(reason)) throw new HttpError(400, "invalid_release_reason");
      return db.$transaction(async (tx) => {
        const { claim } = await claimMutation(tx, "capacity_release", actor, id, { reservation_id: id, reason });
        if (claim.kind === "replay") {
          return { resource: await replayReservation(tx, claim.record.resource_type, claim.record.resource_id), replayed: true };
        }
        const reservation = await lockReservation(tx, id);
        if (reservation.status === "released") {
          const resource = await tx.capacityReservation.findUniqueOrThrow({ where: { id } });
          await completeIdempotency(tx, {
            recordId: claim.record.id, claimVersion: claim.record.claim_version,
            resourceType: "CapacityReservation", resourceId: id, responseStatus: 200
          });
          return { resource, replayed: true };
        }
        if (reservation.status !== "held") throw new HttpError(409, "reservation_not_releasable");
        const resource = await restoreCapacity(tx, reservation, "released", reason, actor.requestId, actor.id);
        await completeIdempotency(tx, {
          recordId: claim.record.id, claimVersion: claim.record.claim_version,
          resourceType: "CapacityReservation", resourceId: id, responseStatus: 200
        });
        return { resource, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    },

    async expireBatch(options: { now?: Date; limit?: number } = {}) {
      const now = options.now ?? new Date();
      const limit = Math.min(Math.max(options.limit ?? CAPACITY_HOLD_LIMITS.expiryBatchSize, 1), CAPACITY_HOLD_LIMITS.expiryBatchSize);
      const candidates = await db.capacityReservation.findMany({
        where: {
          status: "held",
          manifest_id: null,
          expiry_failure_count: { lt: 3 },
          expires_at: { lte: now },
          OR: [
            { match_id: null },
            { match: { canonical_match_version: { not: "canonical_route_match_v1" } } }
          ]
        },
        select: { id: true },
        orderBy: [{ expires_at: "asc" }, { id: "asc" }],
        take: limit
      });
      let expired = 0;
      let failed = 0;
      const failedIds: string[] = [];
      for (const candidate of candidates) {
        try {
          const changed = await db.$transaction(async (tx) => {
            const reservation = await lockReservation(tx, candidate.id);
            if (reservation.status !== "held" || reservation.expires_at > now) return false;
            await restoreCapacity(tx, reservation, "expired", "hold_expired");
            return true;
          }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
          if (changed) expired += 1;
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
          failed += 1;
          failedIds.push(candidate.id);
          await db.capacityReservation.updateMany({
            where: { id: candidate.id, status: "held", expiry_failure_count: { lt: 3 } },
            data: { expiry_failure_count: { increment: 1 }, expiry_last_failed_at: new Date() }
          });
        }
      }
      return { examined: candidates.length, expired, failed, failedIds };
    }
  };
}

export type CapacityReservationService = ReturnType<typeof createCapacityReservationService>;
export const capacityReservationService = createCapacityReservationService();
