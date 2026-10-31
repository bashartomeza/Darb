import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { requireEligibleOperationalRoute } from "./operationalRouteEligibility.js";

export const DRIVER_AVAILABILITY_LIMITS = {
  minimumSeats: 1,
  maximumSeats: 8,
  minimumParcelCapacity: 0,
  maximumParcelCapacity: 20,
  minimumLeadMinutes: 10,
  maximumLeadDays: 30,
  maximumWindowHours: 2
} as const;

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export type DriverAvailabilityInput = {
  routeVersionId: string;
  departureAt: Date;
  availabilityWindowEnd?: Date | null;
  totalSeats: number;
  totalParcelCapacity: number;
};

export type DriverAvailabilityUpdate = {
  expectedRevision: number;
  departureAt?: Date;
  availabilityWindowEnd?: Date | null;
  totalSeats?: number;
  totalParcelCapacity?: number;
};

type Actor = { id: string; requestId?: string; idempotencyKey?: string };

function validateTiming(departureAt: Date, windowEnd: Date | null | undefined, now = new Date()) {
  const lead = departureAt.getTime() - now.getTime();
  if (lead < DRIVER_AVAILABILITY_LIMITS.minimumLeadMinutes * 60_000) {
    throw new HttpError(400, "departure_too_soon");
  }
  if (lead > DRIVER_AVAILABILITY_LIMITS.maximumLeadDays * 86_400_000) {
    throw new HttpError(400, "departure_too_far");
  }
  if (windowEnd && (windowEnd < departureAt || windowEnd.getTime() - departureAt.getTime() > DRIVER_AVAILABILITY_LIMITS.maximumWindowHours * 3_600_000)) {
    throw new HttpError(400, "invalid_availability_window");
  }
}

function validateCapacity(totalSeats: number, totalParcelCapacity: number) {
  if (
    !Number.isInteger(totalSeats) || totalSeats < DRIVER_AVAILABILITY_LIMITS.minimumSeats ||
    totalSeats > DRIVER_AVAILABILITY_LIMITS.maximumSeats ||
    !Number.isInteger(totalParcelCapacity) || totalParcelCapacity < DRIVER_AVAILABILITY_LIMITS.minimumParcelCapacity ||
    totalParcelCapacity > DRIVER_AVAILABILITY_LIMITS.maximumParcelCapacity
  ) throw new HttpError(400, "invalid_availability_capacity");
}

async function requireApprovedProfile(db: PrismaClient | Prisma.TransactionClient, userId: string) {
  const profile = await db.driverProfile.findUnique({ where: { user_id: userId } });
  if (profile && !profile.verified) {
    const verification = await db.driverVerification.findUnique({ where: { user_id: userId }, select: { status: true } });
    if (verification?.status === "documents_expired") throw new HttpError(403, "driver_documents_expired");
  }
  if (!profile || !profile.verified) throw new HttpError(403, "driver_not_approved");
  return profile;
}

async function ownerAvailability(db: PrismaClient | Prisma.TransactionClient, id: string, userId: string) {
  const availability = await db.driverRoute.findFirst({
    where: {
      id,
      driver: { user_id: userId },
      route_version_id: { not: null },
      canonical_availability_version: "canonical_route_v1",
      operational_mode: "canonical_route_v1"
    },
    include: { route_version: { include: { service_route: true } } }
  });
  if (!availability) throw new HttpError(404, "availability_not_found");
  return availability;
}

async function lockOwnerAvailability(tx: Prisma.TransactionClient, id: string, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT dr.id
    FROM driver_routes dr
    INNER JOIN driver_profiles dp ON dp.id = dr.driver_id
    WHERE dr.id = ${id} AND dp.user_id = ${userId}
      AND dr.route_version_id IS NOT NULL
      AND dr.canonical_availability_version = 'canonical_route_v1'
      AND dr.operational_mode = 'canonical_route_v1'
    FOR UPDATE
  `;
  if (rows.length !== 1) throw new HttpError(404, "availability_not_found");
  return ownerAvailability(tx, id, userId);
}

export function createDriverAvailabilityService(db: PrismaClient = prisma) {
  async function transition(
    id: string,
    expectedRevision: number,
    actor: Actor,
    transitionName: "activate" | "pause" | "resume" | "cancel"
  ) {
    return db.$transaction(async (tx) => {
      await requireApprovedProfile(tx, actor.id);
      const current = await lockOwnerAvailability(tx, id, actor.id);
      const now = new Date();
      const allowedFrom: Record<typeof transitionName, string[]> = {
        activate: ["draft"],
        pause: ["active"],
        resume: ["paused"],
        cancel: ["draft", "active", "paused"]
      };
      if (!current.availability_status || !allowedFrom[transitionName].includes(current.availability_status)) {
        throw new HttpError(409, `availability_cannot_${transitionName}`);
      }
      if (current.availability_revision !== expectedRevision) throw new HttpError(409, "availability_revision_conflict");
      if ((transitionName === "activate" || transitionName === "resume") && (!current.departure_at || current.departure_at <= now)) {
        throw new HttpError(409, "availability_departed");
      }
      if (transitionName === "activate" || transitionName === "resume") {
        await requireEligibleOperationalRoute(tx, current.route_version_id!, { now, lockForUpdate: true });
      }
      if (transitionName === "cancel") {
        const activeReservations = await tx.capacityReservation.count({
          where: { driver_route_id: current.id, status: { in: ["held", "confirmed"] } }
        });
        if (activeReservations > 0) throw new HttpError(409, "availability_has_reservations");
      }

      const nextStatus = transitionName === "activate" || transitionName === "resume"
        ? "active"
        : transitionName === "pause"
          ? "paused"
          : "cancelled";
      const updated = await tx.driverRoute.updateMany({
        where: {
          id: current.id,
          availability_revision: expectedRevision,
          availability_status: current.availability_status
        },
        data: {
          availability_status: nextStatus,
          status: nextStatus === "active" ? "active" : "inactive",
          availability_revision: { increment: 1 },
          activated_at: transitionName === "activate" ? now : undefined,
          paused_at: transitionName === "pause" ? now : transitionName === "resume" ? null : undefined,
          cancelled_at: transitionName === "cancel" ? now : undefined
        }
      });
      if (updated.count !== 1) throw new HttpError(409, "availability_revision_conflict");
      const resource = await ownerAvailability(tx, current.id, actor.id);
      const action = {
        activate: AuditAction.driver_availability_activated,
        pause: AuditAction.driver_availability_paused,
        resume: AuditAction.driver_availability_resumed,
        cancel: AuditAction.driver_availability_cancelled
      }[transitionName];
      await auditEvent(tx, {
        userId: actor.id,
        action,
        entityType: "DriverRoute",
        entityId: resource.id,
        metadata: {
          route_version_id: resource.route_version_id,
          transition: `${current.availability_status}_to_${nextStatus}`,
          request_id: actor.requestId
        }
      });
      return resource;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  return {
    async listOwner(actorId: string) {
      await requireApprovedProfile(db, actorId);
      return db.driverRoute.findMany({
        where: {
          driver: { user_id: actorId },
          route_version_id: { not: null },
          canonical_availability_version: "canonical_route_v1"
        },
        include: { route_version: { include: { service_route: true } } },
        orderBy: [{ departure_at: "asc" }, { id: "asc" }]
      });
    },

    async getOwner(id: string, actorId: string) {
      await requireApprovedProfile(db, actorId);
      return ownerAvailability(db, id, actorId);
    },

    async createOneOff(input: DriverAvailabilityInput, actor: Actor & { idempotencyKey: string }) {
      validateCapacity(input.totalSeats, input.totalParcelCapacity);
      try {
        return await db.$transaction(async (tx) => {
          const payload = {
            actor_id: actor.id,
            route_version_id: input.routeVersionId,
            departure_at: input.departureAt.toISOString(),
            availability_window_end: input.availabilityWindowEnd?.toISOString() ?? null,
            total_seats: input.totalSeats,
            total_parcel_capacity: input.totalParcelCapacity
          };
          const claim = await claimIdempotency(tx, {
            operation: "driver_availability_create",
            scopeDigest: digest(`driver-availability:${actor.id}:${input.routeVersionId}`),
            keyDigest: digest(actor.idempotencyKey),
            keyVersion: 1,
            requestDigest: digest(JSON.stringify(payload)),
            expiresAt: new Date(Date.now() + 86_400_000),
            retainCompleted: true,
          });
          if (claim.kind === "conflict") throw new HttpError(409, "idempotency_conflict");
          if (claim.kind === "in_progress") throw new HttpError(409, "idempotency_in_progress");
          if (claim.kind === "failed") throw new HttpError(409, "idempotency_failed");
          if (claim.kind === "replay") {
            if (claim.record.resource_type !== "DriverRoute" || !claim.record.resource_id) {
              throw new HttpError(409, "idempotency_replay_unavailable");
            }
            const resource = await ownerAvailability(tx, claim.record.resource_id, actor.id);
            return { resource, replayed: true };
          }
          validateTiming(input.departureAt, input.availabilityWindowEnd);
          const profile = await requireApprovedProfile(tx, actor.id);
          if (input.totalSeats > profile.seats_total || input.totalParcelCapacity > profile.parcel_capacity) {
            throw new HttpError(400, "availability_exceeds_vehicle_capacity");
          }
          const route = await requireEligibleOperationalRoute(tx, input.routeVersionId, { lockForUpdate: true });
          const origin = route.stops[0];
          const destination = route.stops.at(-1)!;
          const resource = await tx.driverRoute.create({
            data: {
              driver_id: profile.id,
              route_version_id: route.id,
              canonical_availability_version: "canonical_route_v1",
              operational_mode: "canonical_route_v1",
              origin_label: origin.stop.nameEn,
              origin_lat: origin.stop.latitude,
              origin_lng: origin.stop.longitude,
              destination_label: destination.stop.nameEn,
              destination_lat: destination.stop.latitude,
              destination_lng: destination.stop.longitude,
              corridor_key: route.route.routeKey,
              seats_available: input.totalSeats,
              parcel_capacity_available: input.totalParcelCapacity,
              total_seats: input.totalSeats,
              remaining_seats: input.totalSeats,
              total_parcel_capacity: input.totalParcelCapacity,
              remaining_parcel_capacity: input.totalParcelCapacity,
              departure_at: input.departureAt,
              availability_window_end: input.availabilityWindowEnd ?? null,
              availability_status: "draft",
              status: "inactive"
            },
            include: { route_version: { include: { service_route: true } } }
          });
          await auditEvent(tx, {
            userId: actor.id,
            action: AuditAction.driver_availability_created,
            entityType: "DriverRoute",
            entityId: resource.id,
            metadata: {
              route_version_id: route.id,
              seats: input.totalSeats,
              parcel_units: input.totalParcelCapacity,
              transition: "created_draft",
              request_id: actor.requestId
            }
          });
          await completeIdempotency(tx, {
            recordId: claim.record.id,
            claimVersion: claim.record.claim_version,
            resourceType: "DriverRoute",
            resourceId: resource.id,
            responseStatus: 201
          });
          return { resource, replayed: false };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new HttpError(409, "duplicate_driver_availability");
        }
        throw error;
      }
    },

    async updateOneOff(id: string, input: DriverAvailabilityUpdate, actor: Actor) {
      return db.$transaction(async (tx) => {
        await requireApprovedProfile(tx, actor.id);
        const current = await lockOwnerAvailability(tx, id, actor.id);
        if (current.availability_status !== "draft" && current.availability_status !== "paused") {
          throw new HttpError(409, "availability_not_editable");
        }
        if (current.availability_revision !== input.expectedRevision) throw new HttpError(409, "availability_revision_conflict");
        const departureAt = input.departureAt ?? current.departure_at;
        if (!departureAt) throw new HttpError(409, "availability_missing_departure");
        const windowEnd = input.availabilityWindowEnd === undefined ? current.availability_window_end : input.availabilityWindowEnd;
        const timingChanged =
          departureAt.getTime() !== current.departure_at?.getTime() ||
          (windowEnd?.getTime() ?? null) !== (current.availability_window_end?.getTime() ?? null);
        if (timingChanged) {
          const activeReservations = await tx.capacityReservation.count({
            where: { driver_route_id: current.id, status: { in: ["held", "confirmed"] } }
          });
          if (activeReservations > 0) throw new HttpError(409, "availability_has_reservations");
        }
        validateTiming(departureAt, windowEnd);
        await requireEligibleOperationalRoute(tx, current.route_version_id!, { lockForUpdate: true });
        const totalSeats = input.totalSeats ?? current.total_seats!;
        const totalParcels = input.totalParcelCapacity ?? current.total_parcel_capacity!;
        validateCapacity(totalSeats, totalParcels);
        const usedSeats = current.total_seats! - current.remaining_seats!;
        const usedParcels = current.total_parcel_capacity! - current.remaining_parcel_capacity!;
        if (totalSeats < usedSeats || totalParcels < usedParcels) throw new HttpError(409, "capacity_below_reserved_usage");
        const profile = await requireApprovedProfile(tx, actor.id);
        if (totalSeats > profile.seats_total || totalParcels > profile.parcel_capacity) {
          throw new HttpError(400, "availability_exceeds_vehicle_capacity");
        }
        const changed = await tx.driverRoute.updateMany({
          where: { id: current.id, availability_revision: input.expectedRevision },
          data: {
            departure_at: departureAt,
            availability_window_end: windowEnd,
            total_seats: totalSeats,
            remaining_seats: totalSeats - usedSeats,
            seats_available: totalSeats,
            total_parcel_capacity: totalParcels,
            remaining_parcel_capacity: totalParcels - usedParcels,
            parcel_capacity_available: totalParcels,
            availability_revision: { increment: 1 }
          }
        });
        if (changed.count !== 1) throw new HttpError(409, "availability_revision_conflict");
        const resource = await ownerAvailability(tx, current.id, actor.id);
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.driver_availability_updated,
          entityType: "DriverRoute",
          entityId: resource.id,
          metadata: {
            route_version_id: resource.route_version_id,
            transition: "availability_updated",
            request_id: actor.requestId
          }
        });
        return resource;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    },

    activate: (id: string, expectedRevision: number, actor: Actor) => transition(id, expectedRevision, actor, "activate"),
    pause: (id: string, expectedRevision: number, actor: Actor) => transition(id, expectedRevision, actor, "pause"),
    resume: (id: string, expectedRevision: number, actor: Actor) => transition(id, expectedRevision, actor, "resume"),
    cancel: (id: string, expectedRevision: number, actor: Actor) => transition(id, expectedRevision, actor, "cancel")
  };
}

export type DriverAvailabilityService = ReturnType<typeof createDriverAvailabilityService>;
export const driverAvailabilityService = createDriverAvailabilityService();
