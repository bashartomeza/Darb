import { createHash } from "node:crypto";
import { config, type AppConfig } from "../config.js";
import {
  AuditAction,
  CanonicalRejectReason,
  Prisma,
  type PrismaClient
} from "../generated/prisma/client.js";
import { auditEvent } from "../lib/audit.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { createCanonicalRouteSnapshotService } from "./canonicalRouteSnapshots.js";
import { requireEligibleOperationalRoute } from "./operationalRouteEligibility.js";

export const CANONICAL_MODE = "canonical_route_v1";
export const CANONICAL_MATCH_VERSION = "canonical_route_match_v1";
export const CANONICAL_TRIP_VERSION = "canonical_route_trip_v1";
export const CANONICAL_MATCH_LIMITS = {
  offerLifetimeMinutes: 5,
  defaultBatchSize: 25,
  maximumBatchSize: 100,
  maximumAttempts: 5,
  expiryFailureLimit: 3
} as const;

type DriverOfferCursor = { createdAt: Date; id: string };

function encodeDriverOfferCursor(value: DriverOfferCursor) {
  return Buffer.from(
    JSON.stringify({ v: 1, created_at: value.createdAt.toISOString(), id: value.id }),
    "utf8"
  ).toString("base64url");
}

function decodeDriverOfferCursor(value: string): DriverOfferCursor {
  try {
    if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid");
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (
      Object.keys(parsed).length !== 3 ||
      parsed.v !== 1 ||
      typeof parsed.created_at !== "string" ||
      typeof parsed.id !== "string" ||
      parsed.id.length < 1 ||
      parsed.id.length > 191
    ) throw new Error("invalid");
    const createdAt = new Date(parsed.created_at);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== parsed.created_at) {
      throw new Error("invalid");
    }
    return { createdAt, id: parsed.id };
  } catch {
    throw new HttpError(400, "invalid_cursor");
  }
}

type Actor = { id: string; requestId?: string; idempotencyKey: string };
type InternalRunInput = {
  routeVersionId?: string;
  demandType?: "passenger" | "merchant_order";
  limit?: number;
  now?: Date;
  requestId?: string;
};

type Demand = {
  type: "passenger" | "merchant_order";
  id: string;
  routeVersionId: string;
  departureFrom: Date;
  departureUntil: Date;
  seats: number;
  parcelUnits: number;
  pickupStopId: string;
  destinationStopIds: string[];
  parcelItems: Array<{ id: string; destinationStopId: string }>;
  eligible: boolean;
};

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function lengthPrefixed(parts: string[]) {
  return parts.map((part) => `${part.length}:${part}`).join("|");
}

function demandChecksum(demand: Demand) {
  return digest(JSON.stringify({
    type: demand.type,
    id: demand.id,
    route_version_id: demand.routeVersionId,
    departure_from: demand.departureFrom.toISOString(),
    departure_until: demand.departureUntil.toISOString(),
    seats: demand.seats,
    parcel_units: demand.parcelUnits,
    pickup_stop_id: demand.pickupStopId,
    destinations: demand.parcelItems.length > 0
      ? demand.parcelItems
          .map((parcel) => ({ id: parcel.id, destination_stop_id: parcel.destinationStopId }))
          .sort((left, right) => left.id.localeCompare(right.id))
      : [...demand.destinationStopIds]
  }));
}

function canonicalAssignmentKey(input: {
  dispatchId: string;
  driverRouteId: string;
  routeVersionId: string;
  demandType: Demand["type"];
  demandId: string;
}) {
  return digest(lengthPrefixed([
    input.dispatchId,
    input.driverRouteId,
    input.routeVersionId,
    CANONICAL_MODE,
    input.demandType,
    input.demandId
  ]));
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function scoreCandidate(input: {
  departureAt: Date;
  departureFrom: Date;
  departureUntil: Date;
  requestedCapacity: number;
  availableCapacity: number;
  trustScore: number;
  recentAssignments: number;
}) {
  const windowSeconds = Math.max(1, (input.departureUntil.getTime() - input.departureFrom.getTime()) / 1000);
  const departureDeltaSeconds = Math.abs(input.departureAt.getTime() - input.departureFrom.getTime()) / 1000;
  const timeFit = clamp(1 - departureDeltaSeconds / windowSeconds);
  const capacityFit = clamp(input.requestedCapacity / Math.max(1, input.availableCapacity));
  const trust = clamp(input.trustScore / 100);
  const fairness = 1 / (1 + input.recentAssignments);
  const score = Number((timeFit * 0.45 + capacityFit * 0.25 + trust * 0.2 + fairness * 0.1).toFixed(4));
  return { score, departureDeltaSeconds: Math.round(departureDeltaSeconds), trust, fairness };
}

function safeTransactionError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    throw new HttpError(409, "transaction_retry_required");
  }
  throw error;
}

async function lockRow(tx: Prisma.TransactionClient, table: string, id: string) {
  const allowed = new Set([
    "canonical_demand_dispatches",
    "matches",
    "driver_routes",
    "capacity_reservations",
    "passenger_requests",
    "merchant_orders",
    "driver_profiles",
    "users"
  ]);
  if (!allowed.has(table)) throw new Error("invalid_lock_table");
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM \`${table}\` WHERE id = ? FOR UPDATE`,
    id
  );
  if (rows.length !== 1) throw new HttpError(409, "canonical_state_changed");
}

async function lockDemandAggregate(
  tx: Prisma.TransactionClient,
  dispatch: {
    demand_type: Demand["type"];
    passenger_request_id: string | null;
    merchant_order_id: string | null;
  }
) {
  if (dispatch.demand_type === "passenger" && dispatch.passenger_request_id) {
    await lockRow(tx, "passenger_requests", dispatch.passenger_request_id);
    return;
  }
  if (dispatch.demand_type === "merchant_order" && dispatch.merchant_order_id) {
    await lockRow(tx, "merchant_orders", dispatch.merchant_order_id);
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM parcels
      WHERE order_id = ${dispatch.merchant_order_id}
      ORDER BY id
      FOR UPDATE
    `;
    return;
  }
  throw new HttpError(409, "canonical_demand_invalid");
}

async function lockDriverIdentity(
  tx: Prisma.TransactionClient,
  profileId: string,
  userId: string
) {
  await lockRow(tx, "users", userId);
  await lockRow(tx, "driver_profiles", profileId);
}

async function lockDriverIdentityByUser(
  tx: Prisma.TransactionClient,
  userId: string
) {
  await lockRow(tx, "users", userId);
  const profile = await tx.driverProfile.findUnique({
    where: { user_id: userId },
    select: { id: true }
  });
  if (!profile) throw new HttpError(409, "driver_state_changed");
  await lockRow(tx, "driver_profiles", profile.id);
}

async function claimMutation(
  tx: Prisma.TransactionClient,
  operation: string,
  actor: Actor,
  scope: string,
  payload: unknown
) {
  const claim = await claimIdempotency(tx, {
    operation,
    scopeDigest: digest(`${operation}:${actor.id}`),
    keyDigest: digest(actor.idempotencyKey),
    keyVersion: 1,
    requestDigest: digest(JSON.stringify({ actor_id: actor.id, scope, payload })),
    expiresAt: new Date(Date.now() + 86_400_000)
  });
  if (claim.kind === "conflict") throw new HttpError(409, "idempotency_conflict");
  if (claim.kind === "in_progress") throw new HttpError(409, "idempotency_in_progress");
  if (claim.kind === "failed") throw new HttpError(409, "idempotency_failed");
  return claim;
}

async function loadDemand(tx: Prisma.TransactionClient, dispatchId: string): Promise<Demand> {
  const dispatch = await tx.canonicalDemandDispatch.findUnique({
    where: { id: dispatchId },
    include: {
      passenger_request: true,
      merchant_order: { include: { parcels: true } }
    }
  });
  if (!dispatch || dispatch.operational_mode !== CANONICAL_MODE) {
    throw new HttpError(409, "canonical_dispatch_unavailable");
  }
  if (dispatch.demand_type === "passenger" && dispatch.passenger_request) {
    const request = dispatch.passenger_request;
    return {
      type: "passenger",
      id: request.id,
      routeVersionId: request.route_version_id!,
      departureFrom: request.requested_departure_from!,
      departureUntil: request.requested_departure_until!,
      seats: request.passenger_count,
      parcelUnits: 0,
      pickupStopId: request.pickup_stop_id!,
      destinationStopIds: [request.dropoff_stop_id!],
      parcelItems: [],
      eligible:
        request.operational_mode === CANONICAL_MODE &&
        request.canonical_entry_version === CANONICAL_MODE &&
        request.status === "pending"
    };
  }
  if (dispatch.demand_type === "merchant_order" && dispatch.merchant_order) {
    const order = dispatch.merchant_order;
    return {
      type: "merchant_order",
      id: order.id,
      routeVersionId: order.route_version_id!,
      departureFrom: order.requested_departure_from!,
      departureUntil: order.requested_departure_until!,
      seats: 0,
      parcelUnits: order.parcels.length,
      pickupStopId: order.pickup_stop_id!,
      destinationStopIds: order.parcels
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((parcel) => parcel.destination_stop_id!),
      parcelItems: order.parcels.map((parcel) => ({
        id: parcel.id,
        destinationStopId: parcel.destination_stop_id!
      })),
      eligible:
        order.operational_mode === CANONICAL_MODE &&
        order.canonical_entry_version === CANONICAL_MODE &&
        order.status === "submitted" &&
        order.parcels.length > 0 &&
        order.parcels.every(
          (parcel) =>
            parcel.operational_mode === CANONICAL_MODE &&
            parcel.canonical_entry_version === CANONICAL_MODE &&
            parcel.route_version_id === order.route_version_id &&
            parcel.status === "pending"
        )
    };
  }
  throw new HttpError(409, "canonical_demand_invalid");
}

async function ensureDispatches(db: PrismaClient, input: InternalRunInput) {
  const passengerWhere = {
    operational_mode: CANONICAL_MODE,
    canonical_entry_version: CANONICAL_MODE,
    status: "pending" as const,
    route_version_id: input.routeVersionId
  };
  const merchantWhere = {
    operational_mode: CANONICAL_MODE,
    canonical_entry_version: CANONICAL_MODE,
    status: "submitted" as const,
    route_version_id: input.routeVersionId
  };
  if (!input.demandType || input.demandType === "passenger") {
    const requests = await db.passengerRequest.findMany({
      where: passengerWhere,
      select: { id: true, route_version_id: true },
      take: CANONICAL_MATCH_LIMITS.maximumBatchSize
    });
    for (const request of requests) {
      await db.canonicalDemandDispatch.upsert({
        where: { passenger_request_id: request.id },
        create: {
          demand_type: "passenger",
          passenger_request_id: request.id,
          route_version_id: request.route_version_id!,
          operational_mode: CANONICAL_MODE
        },
        update: {}
      });
    }
  }
  if (!input.demandType || input.demandType === "merchant_order") {
    const orders = await db.merchantOrder.findMany({
      where: merchantWhere,
      select: { id: true, route_version_id: true },
      take: CANONICAL_MATCH_LIMITS.maximumBatchSize
    });
    for (const order of orders) {
      await db.canonicalDemandDispatch.upsert({
        where: { merchant_order_id: order.id },
        create: {
          demand_type: "merchant_order",
          merchant_order_id: order.id,
          route_version_id: order.route_version_id!,
          operational_mode: CANONICAL_MODE
        },
        update: {}
      });
    }
  }
}

async function createOfferForDispatch(
  db: PrismaClient,
  dispatchId: string,
  now: Date,
  requestId?: string
) {
  try {
    return await db.$transaction(async (tx) => {
      const lookup = await tx.canonicalDemandDispatch.findUnique({
        where: { id: dispatchId },
        select: { route_version_id: true }
      });
      if (!lookup) return { outcome: "skipped" as const };
      await requireEligibleOperationalRoute(tx, lookup.route_version_id, { now, lockForUpdate: true });
      await lockRow(tx, "canonical_demand_dispatches", dispatchId);
      const dispatch = await tx.canonicalDemandDispatch.findUniqueOrThrow({ where: { id: dispatchId } });
      if (dispatch.status !== "pending" || dispatch.active_match_offer_id || dispatch.assigned_trip_id) {
        return { outcome: "skipped" as const };
      }
      if (dispatch.attempt_count >= CANONICAL_MATCH_LIMITS.maximumAttempts) {
        await tx.canonicalDemandDispatch.update({
          where: { id: dispatch.id },
          data: { status: "unavailable", revision: { increment: 1 } }
        });
        await auditEvent(tx, {
          action: AuditAction.canonical_dispatch_unavailable,
          entityType: "CanonicalDemandDispatch",
          entityId: dispatch.id,
          metadata: { route_version_id: dispatch.route_version_id, attempt_number: dispatch.attempt_count, request_id: requestId }
        });
        return { outcome: "unavailable" as const, dispatchId: dispatch.id };
      }
      await lockDemandAggregate(tx, dispatch);
      const demand = await loadDemand(tx, dispatch.id);
      if (!demand.eligible || demand.routeVersionId !== dispatch.route_version_id || demand.departureUntil <= now) {
        return { outcome: "skipped" as const };
      }

      const excluded = await tx.match.findMany({
        where: { dispatch_id: dispatch.id, status: { in: ["rejected", "expired"] } },
        select: { driver_route_id: true }
      });
      const sharedExcluded = await tx.canonicalDemandAttempt.findMany({
        where: { dispatch_id: dispatch.id },
        select: { driver_route_id: true }
      });
      const excludedDriverRouteIds = [
        ...new Set([
          ...excluded.map((item) => item.driver_route_id),
          ...sharedExcluded.map((item) => item.driver_route_id)
        ])
      ];
      const candidates = await tx.driverRoute.findMany({
        where: {
          operational_mode: CANONICAL_MODE,
          canonical_availability_version: CANONICAL_MODE,
          route_version_id: demand.routeVersionId,
          status: "active",
          availability_status: "active",
          departure_at: { gt: now, gte: demand.departureFrom, lte: demand.departureUntil },
          remaining_seats: { gte: demand.seats },
          remaining_parcel_capacity: { gte: demand.parcelUnits },
          id: { notIn: excludedDriverRouteIds },
          canonical_matches: {
            none: {
              operational_mode: CANONICAL_MODE,
              status: { in: ["sent_to_driver", "accepted"] }
            }
          },
          trips: {
            none: { operational_mode: CANONICAL_MODE }
          },
          driver: { verified: true, user: { role: "driver", account_status: "active" } }
        },
        include: { driver: { include: { user: true } } }
      });
      const scored = await Promise.all(
        candidates.map(async (candidate) => {
          const recentAssignments = await tx.trip.count({
            where: {
              operational_mode: CANONICAL_MODE,
              driver_id: candidate.driver.user_id,
              created_at: { gte: new Date(now.getTime() - 30 * 86_400_000) }
            }
          });
          const availableCapacity =
            demand.type === "passenger" ? candidate.remaining_seats! : candidate.remaining_parcel_capacity!;
          return {
            candidate,
            recentAssignments,
            ...scoreCandidate({
              departureAt: candidate.departure_at!,
              departureFrom: demand.departureFrom,
              departureUntil: demand.departureUntil,
              requestedCapacity: demand.type === "passenger" ? demand.seats : demand.parcelUnits,
              availableCapacity,
              trustScore: candidate.driver.trust_score,
              recentAssignments
            })
          };
        })
      );
      scored.sort(
        (a, b) =>
          b.score - a.score ||
          a.departureDeltaSeconds - b.departureDeltaSeconds ||
          b.candidate.driver.trust_score - a.candidate.driver.trust_score ||
          a.recentAssignments - b.recentAssignments ||
          a.candidate.id.localeCompare(b.candidate.id)
      );
      const selected = scored[0];
      if (!selected) return { outcome: "no_candidate" as const, dispatchId: dispatch.id };

      await lockDriverIdentity(
        tx,
        selected.candidate.driver.id,
        selected.candidate.driver.user_id
      );
      await lockRow(tx, "driver_routes", selected.candidate.id);
      const availability = await tx.driverRoute.findUnique({
        where: { id: selected.candidate.id },
        include: { driver: { include: { user: true } } }
      });
      if (
        !availability ||
        availability.operational_mode !== CANONICAL_MODE ||
        availability.route_version_id !== demand.routeVersionId ||
        availability.status !== "active" ||
        availability.availability_status !== "active" ||
        !availability.driver.verified ||
        availability.driver.user.role !== "driver" ||
        availability.driver.user.account_status !== "active" ||
        !availability.departure_at ||
        availability.departure_at <= now ||
        availability.departure_at < demand.departureFrom ||
        availability.departure_at > demand.departureUntil ||
        availability.remaining_seats! < demand.seats ||
        availability.remaining_parcel_capacity! < demand.parcelUnits ||
        await tx.match.count({
          where: {
            driver_route_id: availability.id,
            operational_mode: CANONICAL_MODE,
            status: { in: ["sent_to_driver", "accepted"] }
          }
        }) > 0 ||
        await tx.trip.count({
          where: { driver_route_id: availability.id, operational_mode: CANONICAL_MODE }
        }) > 0
      ) throw new HttpError(409, "candidate_state_changed");

      const decremented = await tx.driverRoute.updateMany({
        where: {
          id: availability.id,
          availability_status: "active",
          remaining_seats: { gte: demand.seats },
          remaining_parcel_capacity: { gte: demand.parcelUnits }
        },
        data: {
          remaining_seats: { decrement: demand.seats },
          remaining_parcel_capacity: { decrement: demand.parcelUnits }
        }
      });
      if (decremented.count !== 1) throw new HttpError(409, "insufficient_capacity");
      const expiresAt = new Date(now.getTime() + CANONICAL_MATCH_LIMITS.offerLifetimeMinutes * 60_000);
      const reservation = await tx.capacityReservation.create({
        data: {
          driver_route_id: availability.id,
          route_version_id: demand.routeVersionId,
          reservation_type: demand.type === "passenger" ? "passenger" : "parcel",
          seats_reserved: demand.seats,
          parcel_units_reserved: demand.parcelUnits,
          expires_at: expiresAt,
          created_request_id: requestId,
          idempotency_fingerprint: digest(`canonical_offer:${dispatch.id}:${dispatch.attempt_count + 1}`),
          operational_mode: CANONICAL_MODE
        }
      });
      const explanation = {
        route_version_id: demand.routeVersionId,
        departure_delta_seconds: selected.departureDeltaSeconds,
        requested_capacity: { seats: demand.seats, parcel_units: demand.parcelUnits },
        available_capacity_snapshot: {
          seats: availability.remaining_seats,
          parcel_units: availability.remaining_parcel_capacity
        },
        trust_category: availability.driver.trust_score >= 85 ? "high" : availability.driver.trust_score >= 60 ? "standard" : "limited",
        trust_normalized: Number(selected.trust.toFixed(4)),
        fairness_input: selected.recentAssignments,
        scorer_version: CANONICAL_MATCH_VERSION,
        final_score: selected.score
      };
      const offer = await tx.match.create({
        data: {
          driver_route_id: availability.id,
          passenger_request_id: demand.type === "passenger" ? demand.id : null,
          merchant_order_id: demand.type === "merchant_order" ? demand.id : null,
          score: new Prisma.Decimal(selected.score),
          method: CANONICAL_MATCH_VERSION,
          explanation: "canonical route-version candidate",
          scoring_breakdown: explanation,
          status: "sent_to_driver",
          route_version_id: demand.routeVersionId,
          canonical_match_version: CANONICAL_MATCH_VERSION,
          operational_mode: CANONICAL_MODE,
          dispatch_id: dispatch.id,
          reservation_id: reservation.id,
          attempt_number: dispatch.attempt_count + 1,
          offered_at: now,
          expires_at: expiresAt,
          score_version: CANONICAL_MATCH_VERSION,
          active_dispatch_key: dispatch.id,
          demand_checksum: demandChecksum(demand),
          active_driver_route_key: availability.id
        }
      });
      await tx.capacityReservation.update({ where: { id: reservation.id }, data: { match_id: offer.id } });
      await tx.canonicalDemandDispatch.update({
        where: { id: dispatch.id },
        data: {
          status: "offered",
          active_match_offer_id: offer.id,
          attempt_count: { increment: 1 },
          revision: { increment: 1 }
        }
      });
      await auditEvent(tx, {
        action: AuditAction.canonical_offer_created,
        entityType: "Match",
        entityId: offer.id,
        metadata: {
          dispatch_id: dispatch.id,
          route_version_id: demand.routeVersionId,
          operational_mode: CANONICAL_MODE,
          attempt_number: dispatch.attempt_count + 1,
          seats: demand.seats,
          parcel_units: demand.parcelUnits,
          score_version: CANONICAL_MATCH_VERSION,
          request_id: requestId
        }
      });
      return { outcome: "offered" as const, dispatchId: dispatch.id, offerId: offer.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    safeTransactionError(error);
  }
}

async function restoreHeldCapacity(
  tx: Prisma.TransactionClient,
  reservation: {
    id: string;
    driver_route_id: string;
    seats_reserved: number;
    parcel_units_reserved: number;
    revision: number;
  },
  status: "released" | "expired",
  reason: string,
  now: Date
) {
  const restored = await tx.driverRoute.updateMany({
    where: { id: reservation.driver_route_id },
    data: {
      remaining_seats: { increment: reservation.seats_reserved },
      remaining_parcel_capacity: { increment: reservation.parcel_units_reserved }
    }
  });
  if (restored.count !== 1) throw new HttpError(409, "capacity_restore_invariant_failed");
  const changed = await tx.capacityReservation.updateMany({
    where: { id: reservation.id, status: "held", revision: reservation.revision },
    data: { status, released_at: now, release_reason: reason, revision: { increment: 1 } }
  });
  if (changed.count !== 1) throw new HttpError(409, "reservation_state_conflict");
}

export function createCanonicalMatchingService(db: PrismaClient = prisma, appConfig: AppConfig = config) {
  const snapshots = createCanonicalRouteSnapshotService(db);
  const requireEnabled = () => {
    if (
      !(appConfig.isLocal || appConfig.isTest || appConfig.isDemo) ||
      !appConfig.multiRouteEntryEnabled ||
      !appConfig.multiRouteMatchingEnabled ||
      !appConfig.canonicalTripCreationEnabled
    ) throw new HttpError(404, "not_found");
  };
  const requireAssignmentStatusEnabled = () => {
    if (
      !(appConfig.isLocal || appConfig.isTest || appConfig.isDemo) ||
      !appConfig.multiRouteEntryEnabled
    ) throw new HttpError(404, "not_found");
  };
  return {
    async assertDriverEligible(driverUserId: string) {
      requireEnabled();
      const profile = await db.driverProfile.findFirst({
        where: { user_id: driverUserId, verified: true, user: { role: "driver", account_status: "active" } },
        select: { id: true }
      });
      if (!profile) throw new HttpError(403, "verified_driver_required");
    },

    async run(input: InternalRunInput = {}) {
      requireEnabled();
      const now = input.now ?? new Date();
      const limit = Math.min(
        Math.max(input.limit ?? CANONICAL_MATCH_LIMITS.defaultBatchSize, 1),
        CANONICAL_MATCH_LIMITS.maximumBatchSize
      );
      await ensureDispatches(db, input);
      await auditEvent(db, {
        action: AuditAction.canonical_matching_run_started,
        entityType: "CanonicalDemandDispatch",
        metadata: { route_version_id: input.routeVersionId, demand_type: input.demandType, limit, request_id: input.requestId }
      });
      const candidates = await db.canonicalDemandDispatch.findMany({
        where: {
          operational_mode: CANONICAL_MODE,
          status: "pending",
          route_version_id: input.routeVersionId,
          demand_type: input.demandType
        },
        select: { id: true },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
        take: limit
      });
      const result = { examined: candidates.length, offered: 0, unavailable: 0, skipped: 0, failed: 0, offerIds: [] as string[], failedIds: [] as string[] };
      for (const candidate of candidates) {
        try {
          const outcome = await createOfferForDispatch(db, candidate.id, now, input.requestId);
          if (outcome.outcome === "offered") {
            result.offered += 1;
            result.offerIds.push(outcome.offerId);
          } else if (outcome.outcome === "unavailable") result.unavailable += 1;
          else result.skipped += 1;
        } catch (error) {
          result.failed += 1;
          result.failedIds.push(candidate.id);
          await db.canonicalDemandDispatch.updateMany({
            where: { id: candidate.id, failure_count: { lt: CANONICAL_MATCH_LIMITS.expiryFailureLimit } },
            data: { failure_count: { increment: 1 }, last_failed_at: new Date() }
          });
        }
      }
      await auditEvent(db, {
        action: AuditAction.canonical_matching_run_completed,
        entityType: "CanonicalDemandDispatch",
        metadata: {
          examined: result.examined,
          offered: result.offered,
          unavailable: result.unavailable,
          failed: result.failed,
          request_id: input.requestId
        }
      });
      return result;
    },

    async listDriverOffers(driverUserId: string, input: { cursor?: string; limit?: number; now?: Date } = {}) {
      requireEnabled();
      const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
      const cursor = input.cursor ? decodeDriverOfferCursor(input.cursor) : undefined;
      const rows = await db.match.findMany({
        where: {
          operational_mode: CANONICAL_MODE,
          canonical_match_version: CANONICAL_MATCH_VERSION,
          driver_route: { driver: { user_id: driverUserId, verified: true, user: { account_status: "active", role: "driver" } } },
          ...(cursor
            ? {
                OR: [
                  { created_at: { lt: cursor.createdAt } },
                  { created_at: cursor.createdAt, id: { lt: cursor.id } }
                ]
              }
            : {})
        },
        include: {
          driver_route: { select: { departure_at: true, route_version_id: true } },
          passenger_request: { select: { passenger_count: true, pickup_stop_id: true, dropoff_stop_id: true, requested_departure_from: true, requested_departure_until: true, fare_unit_minor: true, fare_total_minor: true, fare_currency: true } },
          merchant_order: { select: { pickup_stop_id: true, requested_departure_from: true, requested_departure_until: true, parcels: { select: { destination_stop_id: true, size: true, fare_minor: true, fare_currency: true } }, _count: { select: { parcels: true } } } },
          route_version: {
            select: {
              id: true,
              name_ar: true,
              name_en: true,
              service_route: { select: { direction: true } },
              stops: {
                select: {
                  sequence: true,
                  stop: { select: { id: true, name_ar: true, name_en: true } }
                },
                orderBy: { sequence: "asc" }
              }
            }
          },
          canonical_trip: {
            select: {
              id: true,
              status: true,
              route_version_id: true,
              created_at: true,
              driver_route: { select: { departure_at: true, driver: { select: { vehicle_type: true } } } }
            }
          }
        },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        take: limit + 1
      });
      const offers = rows.slice(0, limit);
      const last = offers.at(-1);
      return {
        offers,
        nextCursor:
          rows.length > limit && last
            ? encodeDriverOfferCursor({ createdAt: last.created_at, id: last.id })
            : null
      };
    },

    async getDriverOffer(driverUserId: string, offerId: string) {
      requireEnabled();
      const offer = await db.match.findFirst({
        where: {
          id: offerId,
          operational_mode: CANONICAL_MODE,
          canonical_match_version: CANONICAL_MATCH_VERSION,
          driver_route: { driver: { user_id: driverUserId, verified: true, user: { account_status: "active", role: "driver" } } }
        },
        include: {
          driver_route: { select: { departure_at: true, route_version_id: true } },
          passenger_request: { select: { passenger_count: true, pickup_stop_id: true, dropoff_stop_id: true, requested_departure_from: true, requested_departure_until: true, fare_unit_minor: true, fare_total_minor: true, fare_currency: true } },
          merchant_order: { select: { pickup_stop_id: true, requested_departure_from: true, requested_departure_until: true, parcels: { select: { destination_stop_id: true, size: true, fare_minor: true, fare_currency: true } } } },
          route_version: {
            select: {
              id: true,
              name_ar: true,
              name_en: true,
              service_route: { select: { direction: true } },
              stops: {
                select: {
                  sequence: true,
                  stop: { select: { id: true, name_ar: true, name_en: true } }
                },
                orderBy: { sequence: "asc" }
              }
            }
          },
          canonical_trip: {
            select: {
              id: true,
              status: true,
              route_version_id: true,
              created_at: true,
              driver_route: { select: { departure_at: true, driver: { select: { vehicle_type: true } } } }
            }
          }
        }
      });
      if (!offer) throw new HttpError(404, "canonical_offer_not_found");
      return offer;
    },

    async accept(driverUserId: string, offerId: string, actor: Actor) {
      requireEnabled();
      const owned = await this.getDriverOffer(driverUserId, offerId);
      try {
        const result = await db.$transaction(async (tx) => {
          const claim = await claimMutation(tx, "canonical_offer_accept", actor, offerId, {
            offer_id: offerId,
            attempt_number: owned.attempt_number,
            offered_at: owned.offered_at?.toISOString() ?? null
          });
          if (claim.kind === "replay") {
            if (
              claim.record.resource_type === "Match" &&
              claim.record.resource_id === offerId &&
              claim.record.response_status === 409
            ) return { invalid: true as const };
            if (claim.record.resource_type !== "Trip" || !claim.record.resource_id) throw new HttpError(409, "idempotency_replay_unavailable");
            const trip = await tx.trip.findFirst({ where: { id: claim.record.resource_id, canonical_match_id: offerId, operational_mode: CANONICAL_MODE } });
            if (!trip) throw new HttpError(409, "idempotency_replay_unavailable");
            return { trip, replayed: true };
          }
          let routeEligible = true;
          try {
            await requireEligibleOperationalRoute(tx, owned.route_version_id!, { lockForUpdate: true });
          } catch (error) {
            if (!(error instanceof HttpError)) throw error;
            routeEligible = false;
          }
          await lockRow(tx, "canonical_demand_dispatches", owned.dispatch_id!);
          const lockedDispatch = await tx.canonicalDemandDispatch.findUniqueOrThrow({
            where: { id: owned.dispatch_id! }
          });
          await lockDemandAggregate(tx, lockedDispatch);
          await lockDriverIdentityByUser(tx, driverUserId);
          await lockRow(tx, "matches", offerId);
          await lockRow(tx, "driver_routes", owned.driver_route_id);
          await lockRow(tx, "capacity_reservations", owned.reservation_id!);
          const offer = await tx.match.findUniqueOrThrow({
            where: { id: offerId },
            include: {
              dispatch: true,
              offer_reservation: true,
              driver_route: { include: { driver: { include: { user: true } } } },
              passenger_request: true,
              merchant_order: { include: { parcels: true } }
            }
          });
          const now = new Date();
          if (offer.status === "accepted") {
            const trip = await tx.trip.findUnique({ where: { canonical_match_id: offer.id } });
            if (!trip) throw new HttpError(409, "canonical_trip_missing");
            await completeIdempotency(tx, { recordId: claim.record.id, claimVersion: claim.record.claim_version, resourceType: "Trip", resourceId: trip.id, responseStatus: 200 });
            return { trip, replayed: true };
          }
          if (offer.status !== "sent_to_driver") throw new HttpError(409, "canonical_offer_not_acceptable");
          const structurallyReleasable =
            offer.dispatch &&
            offer.dispatch.status === "offered" &&
            offer.dispatch.active_match_offer_id === offer.id &&
            offer.offer_reservation &&
            offer.offer_reservation.status === "held";
          if (!structurallyReleasable) throw new HttpError(409, "canonical_offer_not_acceptable");
          let demand: Demand | undefined;
          try {
            demand = await loadDemand(tx, offer.dispatch!.id);
          } catch (error) {
            if (!(error instanceof HttpError)) throw error;
          }
          const invalid =
            !routeEligible ||
            offer.expires_at! <= now ||
            !offer.dispatch ||
            !offer.offer_reservation ||
            offer.offer_reservation.expires_at <= now ||
            offer.offer_reservation.driver_route_id !== offer.driver_route_id ||
            offer.offer_reservation.route_version_id !== offer.route_version_id ||
            offer.offer_reservation.operational_mode !== CANONICAL_MODE ||
            offer.offer_reservation.reservation_type !==
              (demand?.type === "passenger" ? "passenger" : "parcel") ||
            offer.offer_reservation.seats_reserved !== demand?.seats ||
            offer.offer_reservation.parcel_units_reserved !== demand?.parcelUnits ||
            offer.driver_route.operational_mode !== CANONICAL_MODE ||
            offer.driver_route.availability_status !== "active" ||
            offer.driver_route.status !== "active" ||
            offer.driver_route.driver.user_id !== driverUserId ||
            !offer.driver_route.driver.verified ||
            offer.driver_route.driver.user.role !== "driver" ||
            offer.driver_route.driver.user.account_status !== "active" ||
            !offer.driver_route.departure_at ||
            offer.driver_route.departure_at <= now ||
            !demand?.eligible ||
            demand.routeVersionId !== offer.route_version_id ||
            offer.driver_route.departure_at < demand.departureFrom ||
            offer.driver_route.departure_at > demand.departureUntil ||
            offer.demand_checksum !== demandChecksum(demand) ||
            await tx.trip.count({
              where: {
                driver_route_id: offer.driver_route_id,
                operational_mode: CANONICAL_MODE
              }
            }) > 0 ||
            await tx.match.count({
              where: {
                driver_route_id: offer.driver_route_id,
                operational_mode: CANONICAL_MODE,
                status: "accepted",
                id: { not: offer.id }
              }
            }) > 0;
          if (invalid) {
            await restoreHeldCapacity(tx, offer.offer_reservation!, "expired", "hold_expired", now);
            const unavailable = offer.dispatch!.attempt_count >= CANONICAL_MATCH_LIMITS.maximumAttempts;
            await tx.canonicalDemandDispatch.update({
              where: { id: offer.dispatch!.id },
              data: {
                status: unavailable ? "unavailable" : "pending",
                active_match_offer_id: null,
                revision: { increment: 1 }
              }
            });
            await tx.match.update({
              where: { id: offer.id },
              data: {
                status: "expired",
                expired_at: now,
                active_dispatch_key: null,
                active_driver_route_key: null
              }
            });
            await auditEvent(tx, {
              userId: driverUserId,
              action: AuditAction.canonical_offer_expired,
              entityType: "Match",
              entityId: offer.id,
              metadata: {
                dispatch_id: offer.dispatch!.id,
                route_version_id: offer.route_version_id,
                attempt_number: offer.attempt_number,
                transition: "invalidated_before_accept",
                request_id: actor.requestId
              }
            });
            await completeIdempotency(tx, {
              recordId: claim.record.id,
              claimVersion: claim.record.claim_version,
              resourceType: "Match",
              resourceId: offer.id,
              responseStatus: 409
            });
            return { invalid: true as const };
          }
          const dispatch = offer.dispatch!;
          const reservation = offer.offer_reservation!;
          const assignmentKey = canonicalAssignmentKey({
            dispatchId: dispatch.id,
            driverRouteId: offer.driver_route_id,
            routeVersionId: offer.route_version_id!,
            demandType: demand!.type,
            demandId: demand!.id
          });

          const snapshot = await snapshots.build({
            routeVersionId: demand!.routeVersionId,
            pickupStopId: demand!.pickupStopId,
            destinationStopIds: demand!.destinationStopIds,
            operationalMode: CANONICAL_MODE,
            demand: {
              type: demand!.type,
              passengerCount: demand!.seats,
              parcelCount: demand!.parcelUnits,
              destinationStopIds: demand!.destinationStopIds
            }
          }, tx);
          await tx.capacityReservation.update({
            where: { id: reservation.id },
            data: { status: "confirmed", confirmed_at: now, revision: { increment: 1 } }
          });
          await tx.canonicalDemandDispatch.update({
            where: { id: dispatch.id },
            data: { status: "pending", active_match_offer_id: null }
          });
          await tx.match.update({
            where: { id: offer.id },
            data: {
              status: "accepted",
              accepted_at: now,
              active_dispatch_key: null,
              accepted_dispatch_key: dispatch.id,
              active_driver_route_key: null,
              accepted_driver_route_key: offer.driver_route_id,
              canonical_assignment_key: assignmentKey
            }
          });
          const trip = await tx.trip.create({
            data: {
              driver_id: offer.driver_route.driver.user_id,
              driver_route_id: offer.driver_route_id,
              passenger_request_id: offer.passenger_request_id,
              merchant_order_id: offer.merchant_order_id,
              status: "accepted",
              route_version_id: offer.route_version_id,
              canonical_trip_version: CANONICAL_TRIP_VERSION,
              route_snapshot_json: snapshot.snapshot,
              route_snapshot_checksum: snapshot.checksum,
              route_snapshot_schema_version: snapshot.schemaVersion,
              operational_mode: CANONICAL_MODE,
              canonical_match_id: offer.id,
              canonical_dispatch_id: dispatch.id,
              canonical_assignment_key: assignmentKey,
              canonical_availability_key: offer.driver_route_id
            }
          });
          await tx.driverRoute.update({
            where: { id: offer.driver_route_id },
            data: {
              status: "assigned",
              availability_status: "filled",
              filled_at: now,
              availability_revision: { increment: 1 }
            }
          });
          await tx.canonicalDemandDispatch.update({
            where: { id: dispatch.id },
            data: { status: "assigned", active_match_offer_id: null, assigned_trip_id: trip.id, revision: { increment: 1 } }
          });
          if (offer.passenger_request_id) {
            await tx.passengerRequest.update({ where: { id: offer.passenger_request_id }, data: { status: "matched" } });
          } else {
            await tx.merchantOrder.update({ where: { id: offer.merchant_order_id! }, data: { status: "assigned" } });
            await tx.parcel.updateMany({ where: { order_id: offer.merchant_order_id! }, data: { status: "assigned" } });
          }
          await auditEvent(tx, {
            userId: driverUserId,
            action: AuditAction.canonical_offer_accepted,
            entityType: "Match",
            entityId: offer.id,
            metadata: { dispatch_id: dispatch.id, route_version_id: offer.route_version_id, transition: "offered_to_accepted", request_id: actor.requestId }
          });
          await auditEvent(tx, {
            userId: driverUserId,
            action: AuditAction.canonical_trip_created,
            entityType: "Trip",
            entityId: trip.id,
            metadata: { dispatch_id: dispatch.id, route_version_id: offer.route_version_id, operational_mode: CANONICAL_MODE, request_id: actor.requestId }
          });
          await completeIdempotency(tx, { recordId: claim.record.id, claimVersion: claim.record.claim_version, resourceType: "Trip", resourceId: trip.id, responseStatus: 200 });
          return { trip, replayed: false };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
        if ("invalid" in result) throw new HttpError(409, "canonical_offer_invalidated");
        return result;
      } catch (error) {
        safeTransactionError(error);
      }
    },

    async reject(driverUserId: string, offerId: string, reason: CanonicalRejectReason, actor: Actor) {
      requireEnabled();
      const owned = await this.getDriverOffer(driverUserId, offerId);
      try {
        return await db.$transaction(async (tx) => {
          const claim = await claimMutation(tx, "canonical_offer_reject", actor, offerId, {
            offer_id: offerId,
            attempt_number: owned.attempt_number,
            offered_at: owned.offered_at?.toISOString() ?? null,
            reason
          });
          if (claim.kind === "replay") {
            const offer = await tx.match.findFirst({ where: { id: offerId, driver_route: { driver: { user_id: driverUserId } } } });
            if (!offer || offer.status !== "rejected") throw new HttpError(409, "idempotency_replay_unavailable");
            return { offer, replayed: true };
          }
          await requireEligibleOperationalRoute(tx, owned.route_version_id!, { lockForUpdate: true }).catch((error) => {
            if (!(error instanceof HttpError)) throw error;
          });
          await lockRow(tx, "canonical_demand_dispatches", owned.dispatch_id!);
          await lockDriverIdentityByUser(tx, driverUserId);
          await lockRow(tx, "matches", offerId);
          await lockRow(tx, "driver_routes", owned.driver_route_id);
          await lockRow(tx, "capacity_reservations", owned.reservation_id!);
          const offer = await tx.match.findUniqueOrThrow({
            where: { id: offerId },
            include: {
              dispatch: true,
              offer_reservation: true,
              driver_route: { include: { driver: { include: { user: true } } } }
            }
          });
          if (offer.status === "rejected") {
            await completeIdempotency(tx, { recordId: claim.record.id, claimVersion: claim.record.claim_version, resourceType: "Match", resourceId: offer.id, responseStatus: 200 });
            return { offer, replayed: true };
          }
          if (
            offer.status !== "sent_to_driver" ||
            !offer.dispatch ||
            offer.dispatch.active_match_offer_id !== offer.id ||
            !offer.offer_reservation ||
            offer.offer_reservation.status !== "held" ||
            offer.driver_route.driver.user_id !== driverUserId ||
            !offer.driver_route.driver.verified ||
            offer.driver_route.driver.user.role !== "driver" ||
            offer.driver_route.driver.user.account_status !== "active"
          ) throw new HttpError(409, "canonical_offer_not_rejectable");
          const now = new Date();
          await restoreHeldCapacity(tx, offer.offer_reservation, "released", "offer_rejected", now);
          const unavailable = offer.dispatch.attempt_count >= CANONICAL_MATCH_LIMITS.maximumAttempts;
          await tx.canonicalDemandDispatch.update({
            where: { id: offer.dispatch.id },
            data: {
              status: unavailable ? "unavailable" : "pending",
              active_match_offer_id: null,
              revision: { increment: 1 }
            }
          });
          const terminal = await tx.match.update({
            where: { id: offer.id },
            data: {
              status: "rejected",
              rejected_at: now,
              reject_reason: reason,
              active_dispatch_key: null,
              active_driver_route_key: null
            }
          });
          await auditEvent(tx, {
            userId: driverUserId,
            action: AuditAction.canonical_offer_rejected,
            entityType: "Match",
            entityId: offer.id,
            metadata: { dispatch_id: offer.dispatch.id, route_version_id: offer.route_version_id, attempt_number: offer.attempt_number, reason_code: reason, request_id: actor.requestId }
          });
          if (unavailable) await auditEvent(tx, {
            action: AuditAction.canonical_dispatch_unavailable,
            entityType: "CanonicalDemandDispatch",
            entityId: offer.dispatch.id,
            metadata: { route_version_id: offer.route_version_id, attempt_number: offer.dispatch.attempt_count, request_id: actor.requestId }
          });
          await completeIdempotency(tx, { recordId: claim.record.id, claimVersion: claim.record.claim_version, resourceType: "Match", resourceId: offer.id, responseStatus: 200 });
          return { offer: terminal, replayed: false };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      } catch (error) {
        safeTransactionError(error);
      }
    },

    async expire(input: { now?: Date; limit?: number; requestId?: string } = {}) {
      requireEnabled();
      const now = input.now ?? new Date();
      const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
      const candidates = await db.match.findMany({
        where: {
          operational_mode: CANONICAL_MODE,
          canonical_match_version: CANONICAL_MATCH_VERSION,
          status: "sent_to_driver",
          expires_at: { lte: now },
          expiry_failure_count: { lt: CANONICAL_MATCH_LIMITS.expiryFailureLimit }
        },
        select: { id: true, route_version_id: true, dispatch_id: true, driver_route_id: true, reservation_id: true },
        orderBy: [{ expires_at: "asc" }, { id: "asc" }],
        take: limit
      });
      const result = { examined: candidates.length, expired: 0, failed: 0, failedIds: [] as string[] };
      for (const candidate of candidates) {
        try {
          const changed = await db.$transaction(async (tx) => {
            await requireEligibleOperationalRoute(tx, candidate.route_version_id!, { now, lockForUpdate: true }).catch(() => undefined);
            await lockRow(tx, "canonical_demand_dispatches", candidate.dispatch_id!);
            await lockRow(tx, "matches", candidate.id);
            await lockRow(tx, "driver_routes", candidate.driver_route_id);
            await lockRow(tx, "capacity_reservations", candidate.reservation_id!);
            const offer = await tx.match.findUniqueOrThrow({ where: { id: candidate.id }, include: { dispatch: true, offer_reservation: true } });
            if (offer.status !== "sent_to_driver" || offer.expires_at! > now) return false;
            if (!offer.dispatch || !offer.offer_reservation || offer.offer_reservation.status !== "held") throw new HttpError(409, "canonical_offer_invariant_failed");
            await restoreHeldCapacity(tx, offer.offer_reservation, "expired", "hold_expired", now);
            const unavailable = offer.dispatch.attempt_count >= CANONICAL_MATCH_LIMITS.maximumAttempts;
            await tx.canonicalDemandDispatch.update({
              where: { id: offer.dispatch.id },
              data: { status: unavailable ? "unavailable" : "pending", active_match_offer_id: null, revision: { increment: 1 } }
            });
            await tx.match.update({
              where: { id: offer.id },
              data: {
                status: "expired",
                expired_at: now,
                active_dispatch_key: null,
                active_driver_route_key: null
              }
            });
            await auditEvent(tx, {
              action: AuditAction.canonical_offer_expired,
              entityType: "Match",
              entityId: offer.id,
              metadata: { dispatch_id: offer.dispatch.id, route_version_id: offer.route_version_id, attempt_number: offer.attempt_number, request_id: input.requestId }
            });
            return true;
          }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
          if (changed) result.expired += 1;
        } catch {
          result.failed += 1;
          result.failedIds.push(candidate.id);
          await db.match.updateMany({
            where: { id: candidate.id, status: "sent_to_driver", expiry_failure_count: { lt: CANONICAL_MATCH_LIMITS.expiryFailureLimit } },
            data: { expiry_failure_count: { increment: 1 }, expiry_last_failed_at: new Date() }
          });
        }
      }
      return result;
    },

   async passengerStatus(ownerId: string, id?: string, limit = 25) {
  requireAssignmentStatusEnabled();
  return db.passengerRequest.findMany({
    where: {
      passenger_id: ownerId,
      operational_mode: CANONICAL_MODE,
      ...(id ? { id } : {})
    },
    include: {
      route_version: {
        select: {
          id: true,
          name_ar: true,
          name_en: true,

          // Route geometry used by the mobile map.
          geometry_status: true,
          geometry_encoding: true,
          encoded_geometry: true,
          geometry_precision: true,
          estimated_distance_meters: true,
          estimated_duration_seconds: true,

          service_route: {
            select: {
              direction: true
            }
          },

          stops: {
            select: {
              sequence: true,
              stop: {
                select: {
                  id: true,
                  name_ar: true,
                  name_en: true
                }
              }
            },
            orderBy: {
              sequence: "asc"
            }
          }
        }
      },

      canonical_dispatch: {
        include: {
          assigned_trip: {
            select: {
              id: true,
              status: true,
              canonical_trip_version: true,
              route_version_id: true,
              created_at: true,
              driver_route: {
                select: {
                  departure_at: true,
                  driver: {
                    select: {
                      vehicle_type: true
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    orderBy: [
      { created_at: "desc" },
      { id: "desc" }
    ],
    take: Math.min(Math.max(limit, 1), 50)
  });
},

    async merchantStatus(ownerId: string, id?: string, limit = 25) {
      requireAssignmentStatusEnabled();
      return db.merchantOrder.findMany({
        where: { merchant_id: ownerId, operational_mode: CANONICAL_MODE, ...(id ? { id } : {}) },
        include: {
          parcels: { select: { id: true, status: true, destination_stop_id: true, size: true, fare_minor: true, fare_currency: true } },
          route_version: {
            select: {
              id: true,
              name_ar: true,
              name_en: true,
              service_route: { select: { direction: true } },
              stops: {
                select: {
                  sequence: true,
                  stop: { select: { id: true, name_ar: true, name_en: true } }
                },
                orderBy: { sequence: "asc" }
              }
            }
          },
          canonical_dispatch: { include: { assigned_trip: { select: { id: true, status: true, canonical_trip_version: true, route_version_id: true, created_at: true, driver_route: { select: { departure_at: true, driver: { select: { vehicle_type: true } } } } } } } }
        },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        take: Math.min(Math.max(limit, 1), 50)
      });
    }
  };
}

export type CanonicalMatchingService = ReturnType<typeof createCanonicalMatchingService>;
export const canonicalMatchingService = createCanonicalMatchingService();

export const canonicalScoring = { scoreCandidate };
export const canonicalOfferPagination = {
  encode: encodeDriverOfferCursor,
  decode: decodeDriverOfferCursor
};
