import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { pagedWhere, listPageOrderBy, listPageResult, parseListPage } from "../lib/pagination.js";
import { auditEvent } from "../lib/audit.js";
import { DEMO_ROUTE_POINTS } from "../lib/geo.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { recomputeTrustForTrip } from "../services/driverTrust.js";
import { HttpError } from "../middleware/error.js";
import { AuditAction, MatchStatus, TripStatus } from "../generated/prisma/enums.js";
import { advanceLegacyTrip, isLegacyTripTransitionAllowed } from "../services/tripLifecycle.js";
import { driverCancelTrip, serializeCancellation } from "../services/cancellations.js";
import { cancelBodySchema } from "../services/cancellationReasons.js";
import { maybeNotifyDriverApproaching, maybeNotifyDriverApproachingFromLatest } from "../services/driverApproaching.js";
import { notifyMatchDecision } from "../services/notifications.js";
import {
  UNAVAILABLE_REASON_MAX,
  UNAVAILABLE_REASON_MIN,
  checkHandoverCode,
  confirmHandover,
  tripDeliverySummary,
  tripOrderIds,
  unconfirmedOrderIds
} from "../services/deliveryHandover.js";
import { isLegacyRouteTimely, legacyRouteTimingWhere, legacyParcelUnits, reserveLegacyCapacity, releaseLegacyCapacity, requestExpiryCutoff, requireEligibleLegacyRoute } from "../services/legacyCapacity.js";
import { routeSummarySelect, withRouteFields, type RouteSummary } from "../services/operatingRoutes.js";
import {
  assignedDriverSummary,
  assignedDriverUserSelect,
  withoutRiderContactFields,
  type PublicDriverSource
} from "../services/publicDriver.js";
import { routeFareService } from "../services/routeFares.js";

export const tripsRouter = Router();
export const trackingSimulationRouter = Router();

const ACTIVE_TRIP_STATUSES = ["created", "accepted", "pickup_started", "picked_up", "in_transit", "delivered"] as const;
const TRUST_RELEVANT_STATUSES: ReadonlySet<string> = new Set(["completed", "cancelled", "failed"]);
const statusSchema = z.object({ status: z.enum(["pickup_started", "picked_up", "in_transit", "delivered", "completed", "cancelled", "failed"]) });

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_route_param");
  return value;
}

type WithRoute = { route_version?: RouteSummary } | null;

/** The latest cancellation recorded against a trip (loaded with it; shown only while it is cancelled). */
const tripCancellationInclude = {
  orderBy: { created_at: "desc" as const },
  take: 1,
  select: { reason_code: true, automatic: true, actor_role: true, created_at: true }
};

/**
 * A trip as the API returns it: the embedded request, order and driver route
 * carry `service_route_id`, `route_name_ar` and `route_name_en`; their
 * pickup / drop-off details are plain columns of those rows.
 */
function serializeTrip<T extends { driver_route: WithRoute; passenger_request: WithRoute; merchant_order: WithRoute; status?: string; cancellations?: unknown }>(trip: T) {
  const { cancellations, ...rest } = trip;
  return {
    ...rest,
    // Who cancelled the trip and why, once it is cancelled; otherwise null.
    cancellation: trip.status === "cancelled" ? serializeCancellation(cancellations as never) : null,
    driver_route: trip.driver_route ? withRouteFields(trip.driver_route) : null,
    passenger_request: trip.passenger_request ? withRouteFields(trip.passenger_request) : null,
    merchant_order: trip.merchant_order ? withRouteFields(trip.merchant_order) : null
  };
}

/**
 * Admin and the trip's own driver keep the full driver profile; the passenger or
 * merchant on the trip sees only who drives, which car to look for and, while
 * the trip runs, the driver's phone.
 */
function withViewerDriver<T extends { status: string; driver_route: { driver: PublicDriverSource } }>(
  trip: T,
  req: AuthenticatedRequest
) {
  if (req.user!.role === "admin" || req.user!.role === "driver") {
    return { ...trip, driver_route: { ...trip.driver_route, driver: withoutRiderContactFields(trip.driver_route.driver) } };
  }
  return { ...trip, driver_route: { ...trip.driver_route, driver: assignedDriverSummary(trip.driver_route.driver, trip.status) } };
}

/** Every order of a trip's batch, in the order they joined it, with its parcels. */
const tripBatchInclude = {
  include: {
    members: {
      orderBy: { created_at: "asc" as const },
      select: {
        merchant_order: {
          select: {
            id: true,
            merchant_id: true,
            status: true,
            pickup_label: true,
            pickup_lat: true,
            pickup_lng: true,
            pickup_details: true,
            route_version: routeSummarySelect,
            parcels: {
              orderBy: { id: "asc" as const },
              select: {
                id: true,
                destination_label: true,
                destination_lat: true,
                destination_lng: true,
                dropoff_details: true,
                size: true,
                priority: true,
                status: true,
                receiver_name: true,
                receiver_phone: true
              }
            }
          }
        }
      }
    }
  }
};

type TripBatchMember = {
  merchant_order: {
    id: string;
    merchant_id: string;
    route_version?: RouteSummary;
    parcels: Array<Record<string, unknown> & { receiver_phone?: string | null }>;
  } & Record<string, unknown>;
};

/** The driver and admins see every party; anyone else only what is theirs. */
function seesAllParcelDetails(req: AuthenticatedRequest) {
  return req.user!.role === "admin" || req.user!.role === "driver";
}

/**
 * The trip's batch with the orders on it (`orders`): each order's typed pickup,
 * its parcels' typed drop-offs and receivers. The driver and admins get every
 * order; a merchant or passenger sender only their own orders of the batch.
 */
function serializeTripBatch(batch: (Record<string, unknown> & { members?: TripBatchMember[] }) | null, req: AuthenticatedRequest) {
  if (!batch) return null;
  const { members, ...columns } = batch;
  const all = members ?? [];
  const visible = seesAllParcelDetails(req) ? all : all.filter((member) => member.merchant_order.merchant_id === req.user!.id);
  return {
    ...columns,
    order_count: all.length,
    parcel_count: all.reduce((count, member) => count + member.merchant_order.parcels.length, 0),
    orders: visible.map((member) => withRouteFields(member.merchant_order))
  };
}

/** Receiver phones of someone else's parcels stay with the driver and admins. */
function withViewerOrder<T extends { merchant_order: ({ merchant_id: string; parcels?: Array<Record<string, unknown>> } & Record<string, unknown>) | null }>(
  trip: T,
  req: AuthenticatedRequest
) {
  const order = trip.merchant_order;
  if (!order || seesAllParcelDetails(req) || order.merchant_id === req.user!.id || !Array.isArray(order.parcels)) return trip;
  return {
    ...trip,
    merchant_order: { ...order, parcels: order.parcels.map(({ receiver_phone: _phone, ...parcel }) => parcel) }
  };
}

export async function getVisibleTrip(id: string, req: AuthenticatedRequest) {
  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      driver_route: { include: { driver: { include: { user: { select: assignedDriverUserSelect } } }, route_version: routeSummarySelect } },
      passenger_request: { include: { route_version: routeSummarySelect } },
      merchant_order: { include: { parcels: true, route_version: routeSummarySelect } },
      parcel_batch: tripBatchInclude,
      cancellations: tripCancellationInclude
    }
  });
  if (!trip) throw new HttpError(404, "trip_not_found");
  if (
    ((trip as typeof trip & { operational_mode?: string }).operational_mode ?? "legacy") !== "legacy" ||
    trip.canonical_trip_version
  ) throw new HttpError(404, "trip_not_found");

  if (req.user!.role === "admin") return trip;
  if (req.user!.role === "driver" && trip.driver_route.driver.user_id === req.user!.id) return trip;
  if (req.user!.role === "passenger" && trip.passenger_request?.passenger_id === req.user!.id) return trip;
  if (req.user!.role === "merchant" && trip.merchant_order?.merchant_id === req.user!.id) return trip;
  // A passenger parcel's order belongs to the passenger who sent it.
  if (req.user!.role === "passenger" && trip.merchant_order && trip.merchant_order.merchant_id === req.user!.id) return trip;

  throw new HttpError(403, "forbidden");
}

function tripWhereForUser(req: AuthenticatedRequest) {
  const legacy = { operational_mode: "legacy", canonical_trip_version: null };
  if (req.user!.role === "admin") return legacy;
  if (req.user!.role === "driver") return { ...legacy, driver_route: { driver: { user_id: req.user!.id } } };
  if (req.user!.role === "passenger") return { ...legacy, passenger_request: { passenger_id: req.user!.id } };
  return { ...legacy, merchant_order: { merchant_id: req.user!.id } };
}

tripsRouter.post("/matches/:id/accept", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const matchId = routeParam(req.params.id);
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const match = await tx.match.findUnique({
          where: { id: matchId },
          include: {
            driver_route: { include: { driver: true } },
            passenger_request: true,
            merchant_order: { include: { parcels: true } },
            parcel_batch: true
          }
        });
        if (!match) throw new HttpError(404, "match_not_found");
        if (req.user!.role !== "admin" && (req.user!.role !== "driver" || match.driver_route.driver.user_id !== req.user!.id)) {
          throw new HttpError(403, "forbidden");
        }
        if (match.operational_mode !== "legacy" || match.canonical_match_version || match.route_version_id) {
          throw new HttpError(409, "canonical_matching_not_enabled");
        }
        if (match.status !== MatchStatus.proposed && match.status !== MatchStatus.sent_to_driver) {
          throw new HttpError(409, "match_cannot_be_accepted");
        }
        const now = new Date();
        if (match.expires_at && match.expires_at <= now) throw new HttpError(409, "match_expired");
        if (!isLegacyRouteTimely(match.driver_route, now)) throw new HttpError(409, "driver_route_not_available");
        if (match.passenger_request && match.passenger_request.preferred_time <= requestExpiryCutoff(now)) {
          throw new HttpError(409, "passenger_request_expired");
        }

        if (match.merchant_order_id) {
          // Re-read demand after taking its write lock, before assigning any parcel.
          const orders = await tx.$queryRaw<Array<{ status: string }>>`
            SELECT status FROM merchant_orders WHERE id = ${match.merchant_order_id} FOR UPDATE
          `;
          if (orders[0]?.status !== "matched") throw new HttpError(409, "merchant_order_not_matchable");
          const offers = await tx.$queryRaw<Array<{ status: string; expires_at: Date | null }>>`
            SELECT status, expires_at FROM matches WHERE id = ${match.id} FOR UPDATE
          `;
          const now = await requireEligibleLegacyRoute(tx, match.driver_route_id);
          if (!offers[0] || !["proposed", "sent_to_driver"].includes(offers[0].status)) throw new HttpError(409, "match_cannot_be_accepted");
          if (offers[0].expires_at && offers[0].expires_at <= now) throw new HttpError(409, "match_expired");
        }


        const duplicate = await tx.trip.findFirst({
          where: match.passenger_request_id
            ? {
                passenger_request_id: match.passenger_request_id,
                operational_mode: "legacy",
                // A trip its driver cancelled (the request went back to waiting) is not a duplicate.
                status: { notIn: [TripStatus.cancelled, TripStatus.failed] }
              }
            : {
                driver_route_id: match.driver_route_id,
                passenger_request_id: null,
                merchant_order_id: match.merchant_order_id,
                parcel_batch_id: match.parcel_batch_id,
                status: { in: [...ACTIVE_TRIP_STATUSES] }
              }
        });
        if (duplicate) throw new HttpError(409, "duplicate_active_trip");

        if (match.passenger_request_id) {
          const claimedRequest = await tx.passengerRequest.updateMany({
            where: {
              id: match.passenger_request_id,
              status: { in: ["pending", "matched"] },
              preferred_time: { gt: requestExpiryCutoff(new Date()) },
            },
            data: { status: "accepted" }
          });
          if (claimedRequest.count !== 1) throw new HttpError(409, "passenger_request_not_accepting_matches");
        }

        if (!match.legacy_capacity_held) {
          const passengerSeats = match.passenger_request?.passenger_count ?? 0;
          const parcelUnits = await legacyParcelUnits(tx, {
            parcelBatchId: match.parcel_batch_id,
            merchantOrderId: match.parcel_batch_id ? null : match.merchant_order_id
          });
          if (passengerSeats || parcelUnits) {
            await reserveLegacyCapacity(tx, {
              driverRouteId: match.driver_route_id,
              seats: passengerSeats,
              parcelUnits
            });
          }
        }

        const claimedMatch = await tx.match.updateMany({
          where: {
            id: match.id,
            status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver] },
            OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
          },
          data: { status: MatchStatus.accepted, accepted_at: new Date(), legacy_capacity_held: true }
        });
        if (claimedMatch.count !== 1) throw new HttpError(409, "match_cannot_be_accepted");

        const claimedRoute = await tx.driverRoute.updateMany({
          where: { id: match.driver_route_id, status: "active", ...legacyRouteTimingWhere() },
          data: { status: "assigned" }
        });
        if (claimedRoute.count !== 1) throw new HttpError(409, "driver_route_not_available");

        // The route claim blocks new holds. Read committed proposals here,
        // including those created after this transaction first read its offer.
        const staleMatches = await tx.match.findMany({
          where: {
            id: { not: match.id },
            driver_route_id: match.driver_route_id,
            operational_mode: "legacy",
            status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver] }
          },
          select: { id: true, passenger_request_id: true, merchant_order_id: true, parcel_batch_id: true, legacy_capacity_held: true, driver_route_id: true }
        });
        if (staleMatches.length > 0) {
          for (const stale of staleMatches) {
            if (stale.legacy_capacity_held) {
              const seats = stale.passenger_request_id
                ? await tx.passengerRequest.findUnique({ where: { id: stale.passenger_request_id }, select: { passenger_count: true } })
                    .then((request) => request?.passenger_count ?? 0)
                : 0;
              const parcelUnits = await legacyParcelUnits(tx, {
                parcelBatchId: stale.parcel_batch_id,
                merchantOrderId: stale.parcel_batch_id ? null : stale.merchant_order_id
              });
              await releaseLegacyCapacity(tx, { driverRouteId: stale.driver_route_id, seats, parcelUnits });
            }
          }
          await tx.match.updateMany({
            where: { id: { in: staleMatches.map((item) => item.id) } },
            data: { status: MatchStatus.invalidated, legacy_demand_key: null, legacy_capacity_held: false }
          });
          const merchantBatchIds = staleMatches
            .map((item) => item.parcel_batch_id)
            .filter((id): id is string => id !== null);
          for (const batchId of merchantBatchIds) {
            const batch = await tx.parcelBatch.findUnique({ where: { id: batchId }, select: { id: true, status: true } });
            if (batch && batch.status === "proposed") {
              await tx.parcelBatch.update({ where: { id: batchId }, data: { driver_route_id: null, status: "created" } });
              const members = await tx.parcelBatchOrder.findMany({ where: { parcel_batch_id: batchId, active: true }, select: { merchant_order_id: true } });
              const ids = members.map((member) => member.merchant_order_id);
              if (ids.length) await tx.merchantOrder.updateMany({ where: { id: { in: ids }, status: "matched" }, data: { status: "batched" } });
            }
          }
          // Standalone legacy cargo must remain eligible for manual batching or
          // matching after this route accepts a different delivery.
          const unbatchedMerchantIds = [...new Set(staleMatches
            .filter((item) => item.parcel_batch_id === null)
            .map((item) => item.merchant_order_id)
            .filter((id): id is string => id !== null))];
          if (unbatchedMerchantIds.length > 0) {
            await tx.merchantOrder.updateMany({
              where: { id: { in: unbatchedMerchantIds }, operational_mode: "legacy", canonical_entry_version: null, status: "matched" },
              data: { status: "submitted" }
            });
          }
          const passengerIds = staleMatches
            .map((item) => item.passenger_request_id)
            .filter((id): id is string => id !== null);
          if (passengerIds.length > 0) {
            await tx.passengerRequest.updateMany({
              where: { id: { in: passengerIds }, status: "matched" },
              data: { status: "pending" }
            });
          }
        }

        // Competitor cleanup may itself wait on locks. Revalidate the held
        // demand, offer and approved supply with a fresh DB clock after that wait.
        await requireEligibleLegacyRoute(tx, match.driver_route_id, {
          passengerRequestId: match.passenger_request_id,
          matchId: match.id,
          assigned: true,
        });

        const trip = await tx.trip.create({
          data: {
            driver_id: match.driver_route.driver_id,
            driver_route_id: match.driver_route_id,
            passenger_request_id: match.passenger_request_id,
            merchant_order_id: match.merchant_order_id,
            parcel_batch_id: match.parcel_batch_id,
            status: TripStatus.accepted,
            legacy_assignment_key: match.passenger_request_id
              ? `passenger:${match.passenger_request_id}`
              : `match:${match.id}`
          }
        });

        const pricedOrderIds: string[] = [];
        if (match.parcel_batch_id) {
          await tx.parcelBatch.update({ where: { id: match.parcel_batch_id }, data: { status: "assigned" } });
          const members = await tx.parcelBatchOrder.findMany({
            where: { parcel_batch_id: match.parcel_batch_id },
            select: { merchant_order_id: true }
          });
          const orderIds = members.map((member) => member.merchant_order_id);
          pricedOrderIds.push(...orderIds);
          if (orderIds.length) {
            await tx.merchantOrder.updateMany({ where: { id: { in: orderIds } }, data: { status: "assigned" } });
            await tx.parcel.updateMany({ where: { order_id: { in: orderIds }, batch_id: match.parcel_batch_id }, data: { status: "assigned" } });
          }
        } else if (match.merchant_order_id) {
          await tx.merchantOrder.update({ where: { id: match.merchant_order_id }, data: { status: "assigned" } });
          await tx.parcel.updateMany({ where: { order_id: match.merchant_order_id }, data: { status: "assigned" } });
          pricedOrderIds.push(match.merchant_order_id);
        }

        // Authoritative fare: the order is saved at the price of the driver who
        // takes it (their own price, else the route default in force now),
        // committed with the trip. The offer set the same price; this also
        // covers offers made before driver prices existed.
        await routeFareService.applyDriverFare(tx, {
          driverRouteId: match.driver_route_id,
          passengerRequestId: match.passenger_request_id,
          merchantOrderIds: pricedOrderIds,
          matchId: match.id,
          stage: "accepted",
          actorId: req.user!.id
        });

        await tx.auditEvent.create({
          data: {
            user_id: req.user!.id,
            action: AuditAction.match_accepted,
            entity_type: "Match",
            entity_id: match.id,
            metadata: staleMatches.length > 0 ? { invalidated_competing_matches: staleMatches.length } : undefined
          }
        });

        await notifyMatchDecision(tx, match, "accepted");

        return { trip, matchId: match.id };
      }, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw new HttpError(409, "duplicate_active_trip");
      }
      throw error;
    }

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

tripsRouter.post("/matches/:id/reject", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const matchId = routeParam(req.params.id);
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { driver_route: { include: { driver: true } }, passenger_request: true, merchant_order: true }
    });
    if (!match) throw new HttpError(404, "match_not_found");
    if (req.user!.role !== "admin" && (req.user!.role !== "driver" || match.driver_route.driver.user_id !== req.user!.id)) {
      throw new HttpError(403, "forbidden");
    }
    if (match.operational_mode !== "legacy" || match.canonical_match_version || match.route_version_id) throw new HttpError(409, "canonical_matching_not_enabled");
    if (match.status !== MatchStatus.proposed && match.status !== MatchStatus.sent_to_driver) throw new HttpError(409, "match_cannot_be_rejected");

    const updated = await prisma.$transaction(async (tx) => {
      if (match.legacy_capacity_held) {
        const seats = match.passenger_request_id
          ? await tx.passengerRequest.findUnique({ where: { id: match.passenger_request_id }, select: { passenger_count: true } })
              .then((request) => request?.passenger_count ?? 0)
          : 0;
        const parcelUnits = await legacyParcelUnits(tx, {
          parcelBatchId: match.parcel_batch_id,
          merchantOrderId: match.parcel_batch_id ? null : match.merchant_order_id
        });
        await releaseLegacyCapacity(tx, {
          driverRouteId: match.driver_route_id,
          seats,
          parcelUnits
        });
      }

      if (match.passenger_request_id) {
        await tx.passengerRequest.updateMany({
          where: { id: match.passenger_request_id, status: "matched" },
          data: { status: "pending" }
        });
      }

      if (match.merchant_order_id) {
        const batch = match.parcel_batch_id
          ? await tx.parcelBatch.findUnique({ where: { id: match.parcel_batch_id }, select: { id: true, driver_route_id: true, status: true } })
          : null;
        if (batch) {
          await tx.parcelBatch.update({ where: { id: batch.id }, data: { driver_route_id: null, status: "created" } });
          const members = await tx.parcelBatchOrder.findMany({ where: { parcel_batch_id: batch.id }, select: { merchant_order_id: true } });
          const orderIds = members.map((member) => member.merchant_order_id);
          if (orderIds.length) await tx.merchantOrder.updateMany({ where: { id: { in: orderIds }, status: "matched" }, data: { status: "batched" } });
        } else {
          await tx.merchantOrder.updateMany({ where: { id: match.merchant_order_id, status: "matched" }, data: { status: "submitted" } });
        }
      }


      const changed = await tx.match.updateMany({
        where: {
          id: match.id,
          status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver] }
        },
        data: { status: MatchStatus.rejected, legacy_demand_key: null, rejected_at: new Date(), legacy_capacity_held: false }
      });
      if (changed.count !== 1) throw new HttpError(409, "match_cannot_be_rejected");
      await tx.auditEvent.create({
        data: { user_id: req.user!.id, action: AuditAction.match_rejected, entity_type: "Match", entity_id: match.id }
      });
      return { ...match, status: MatchStatus.rejected, legacy_demand_key: null };
    });
    await notifyMatchDecision(prisma, match, "rejected");
    res.json({ match: updated });
  } catch (error) {
    next(error);
  }
});

tripsRouter.get("/trips", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const page = parseListPage(req.query);
    const rows = await prisma.trip.findMany({
      where: pagedWhere(tripWhereForUser(req), page),
      include: {
        driver_route: { include: { route_version: routeSummarySelect } },
        passenger_request: { include: { route_version: routeSummarySelect } },
        merchant_order: { include: { route_version: routeSummarySelect } },
        parcel_batch: { include: { members: { select: { merchant_order_id: true }, orderBy: { created_at: "asc" } } } },
        cancellations: tripCancellationInclude
      },
      orderBy: listPageOrderBy,
      take: page.limit + 1
    });
    const { items: trips, nextCursor } = listPageResult(rows, page);
    res.json({
      trips: trips.map((trip) => {
        const { members, ...batch } = trip.parcel_batch ?? { members: [] };
        // Which orders ride on the trip, so every order of a batch finds it, not only the lead.
        return {
          ...serializeTrip(trip),
          parcel_batch: trip.parcel_batch ? { ...batch, order_ids: (members ?? []).map((member) => member.merchant_order_id) } : null
        };
      }),
      next_cursor: nextCursor
    });
  } catch (error) {
    next(error);
  }
});

tripsRouter.get("/trips/:id", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const trip = await getVisibleTrip(routeParam(req.params.id), req);
    const visible = withViewerOrder(withViewerDriver(trip, req), req);
    res.json({
      trip: { ...serializeTrip(visible), parcel_batch: serializeTripBatch(trip.parcel_batch, req) },
      delivery_confirmation: await tripDeliverySummary(prisma, trip)
    });
  } catch (error) {
    next(error);
  }
});

tripsRouter.post("/trips/:id/status", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const tripId = routeParam(req.params.id);
    const input = statusSchema.parse(req.body);
    const existing = await getVisibleTrip(tripId, req);
    if (req.user!.role !== "admin" && (req.user!.role !== "driver" || existing.driver_route.driver.user_id !== req.user!.id)) {
      throw new HttpError(403, "forbidden");
    }
    if (!isLegacyTripTransitionAllowed(existing.status, input.status)) throw new HttpError(409, "invalid_trip_status_transition");
    // Before pickup a driver cancels through POST /trips/:id/cancel: it needs a reason, is limited
    // per day and puts the order back to waiting. Admins cancel through the admin cancel endpoints.
    if (req.user!.role === "driver" && input.status === "cancelled" && ["accepted", "pickup_started"].includes(existing.status)) {
      throw new HttpError(409, "cancellation_reason_required");
    }

    const trip = await prisma.$transaction(async (tx) => {
      return advanceLegacyTrip(tx, existing, input.status, {
        actorId: req.user!.id,
        expectedStatus: existing.status,
        adminOverride: req.user!.role === "admin",
      });
    });

    await maybeNotifyDriverApproachingFromLatest(prisma, existing.id);
    if (TRUST_RELEVANT_STATUSES.has(input.status)) await recomputeTrustForTrip(prisma, trip.id);
    res.json({ trip });
  } catch (error) {
    next(error);
  }
});

// A driver cancels an accepted trip before pickup, with a reason. The request or orders go back to
// waiting for another driver while still inside their window (ORDER_AUTO_CANCEL_MINUTES), else they
// are cancelled automatically. Counts against the driver's trust score and is limited per day.
tripsRouter.post("/trips/:id/cancel", requireAuth, requireRole("driver"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const tripId = routeParam(req.params.id);
    const input = cancelBodySchema("driver").parse(req.body ?? {});
    const result = await prisma.$transaction(
      (tx) => driverCancelTrip(tx, { tripId, driverUserId: req.user!.id, reason: { code: input.reason, note: input.note } }),
      { isolationLevel: "ReadCommitted" }
    );
    await recomputeTrustForTrip(prisma, tripId);
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    res.json({ trip, returned_to_waiting: result.returnedToWaiting });
  } catch (error) {
    next(error && typeof error === "object" && "code" in error && error.code === "P2034"
      ? new HttpError(409, "transaction_retry_required") : error);
  }
});

const deliveryConfirmationSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("receiver_code"),
    codes: z.array(z.object({ order_id: z.string().min(1), code: z.string() })).min(1).max(20).optional(),
    code: z.string().optional()
  }),
  z.object({
    method: z.literal("receiver_unavailable"),
    reason: z.string().trim().min(UNAVAILABLE_REASON_MIN).max(UNAVAILABLE_REASON_MAX),
    order_ids: z.array(z.string().min(1)).min(1).max(20).optional()
  })
]);

// The driver closes the delivery here: either with the code the receiver read out, or by
// recording why the receiver could not be reached. The trip becomes "delivered" only once
// every parcel order on it is confirmed.
tripsRouter.post("/trips/:id/delivery-confirmation", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const tripId = routeParam(req.params.id);
    const input = deliveryConfirmationSchema.parse(req.body);
    const existing = await getVisibleTrip(tripId, req);
    if (req.user!.role !== "driver" || existing.driver_route.driver.user_id !== req.user!.id) {
      throw new HttpError(403, "forbidden");
    }
    if (existing.status !== TripStatus.in_transit) throw new HttpError(409, "invalid_trip_status_transition");
    const orderIds = await tripOrderIds(prisma, existing);
    if (!orderIds.length) throw new HttpError(409, "delivery_confirmation_not_applicable");
    const pending = await unconfirmedOrderIds(prisma, orderIds);

    let targets: { orderId: string; method: "receiver_code" | "receiver_unavailable"; reason?: string }[];
    if (input.method === "receiver_code") {
      const entries = input.codes ?? (input.code !== undefined && orderIds.length === 1 ? [{ order_id: orderIds[0], code: input.code }] : []);
      if (!entries.length) throw new HttpError(400, "handover_code_required");
      if (new Set(entries.map((entry) => entry.order_id)).size !== entries.length) throw new HttpError(400, "duplicate_order_id");
      for (const entry of entries) {
        if (!orderIds.includes(entry.order_id)) throw new HttpError(404, "order_not_on_trip");
      }
      // Each check spends one of the five attempts for that order, outside the transaction below.
      for (const entry of entries) await checkHandoverCode(prisma, entry.order_id, entry.code);
      targets = entries.map((entry) => ({ orderId: entry.order_id, method: "receiver_code" as const }));
    } else {
      const wanted = input.order_ids ?? pending;
      for (const id of wanted) {
        if (!orderIds.includes(id)) throw new HttpError(404, "order_not_on_trip");
      }
      targets = wanted.map((orderId) => ({ orderId, method: "receiver_unavailable" as const, reason: input.reason }));
    }

    const result = await prisma.$transaction(async (tx) => {
      for (const target of targets) {
        const changed = await confirmHandover(tx, {
          orderId: target.orderId,
          method: target.method,
          actorId: req.user!.id,
          tripId,
          reason: target.reason
        });
        if (changed) {
          await tx.auditEvent.create({
            data: {
              user_id: req.user!.id,
              action: AuditAction.trip_status_updated,
              entity_type: "Trip",
              entity_id: tripId,
              metadata: {
                event: "delivery_confirmed",
                method: target.method,
                order_id: target.orderId,
                ...(target.reason ? { reason: target.reason, flagged: true } : {})
              }
            }
          });
        }
      }
      const stillPending = await unconfirmedOrderIds(tx, orderIds);
      if (stillPending.length) return { trip: existing, delivered: false };
      const trip = await advanceLegacyTrip(tx, existing, TripStatus.delivered, {
        actorId: req.user!.id,
        expectedStatus: existing.status
      });
      return { trip, delivered: true };
    });

    res.json({
      trip: result.trip,
      delivered: result.delivered,
      delivery_confirmation: await tripDeliverySummary(prisma, existing)
    });
  } catch (error) {
    next(error);
  }
});

const ratingSchema = z.object({ stars: z.number().int().min(1).max(5) }).strict();

/** The passenger on this trip, if any: the legacy request owner or a shared-trip manifest member. */
async function isTripPassenger(tripId: string, userId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      status: true,
      driver_route: { select: { driver_id: true } },
      passenger_request: { select: { passenger_id: true } },
      canonical_manifest: {
        select: { members: { select: { passenger_request: { select: { passenger_id: true } } } } }
      }
    }
  });
  if (!trip) return null;
  const passengerIds = [
    trip.passenger_request?.passenger_id,
    ...(trip.canonical_manifest?.members ?? []).map((member) => member.passenger_request?.passenger_id)
  ];
  if (!passengerIds.includes(userId)) return null;
  return { status: trip.status, driverId: trip.driver_route.driver_id };
}

// Passengers see only whether they have rated; the rating never reaches drivers.
tripsRouter.get("/trips/:id/rating", requireAuth, requireRole("passenger"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const tripId = routeParam(req.params.id);
    if (!(await isTripPassenger(tripId, req.user!.id))) throw new HttpError(404, "trip_not_found");
    const rating = await prisma.tripRating.findUnique({
      where: { trip_id_passenger_id: { trip_id: tripId, passenger_id: req.user!.id } },
      select: { stars: true }
    });
    res.json({ rating: rating ? { stars: rating.stars } : null });
  } catch (error) {
    next(error);
  }
});

tripsRouter.post("/trips/:id/rating", requireAuth, requireRole("passenger"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const tripId = routeParam(req.params.id);
    const input = ratingSchema.parse(req.body);
    const trip = await isTripPassenger(tripId, req.user!.id);
    // Someone else's trip looks the same as a missing one.
    if (!trip) throw new HttpError(404, "trip_not_found");
    if (trip.status !== TripStatus.completed) throw new HttpError(409, "trip_not_completed");
    try {
      await prisma.tripRating.create({
        data: { trip_id: tripId, passenger_id: req.user!.id, driver_id: trip.driverId, stars: input.stars }
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new HttpError(409, "trip_already_rated");
      throw error;
    }
    await recomputeTrustForTrip(prisma, tripId);
    res.status(201).json({ rating: { stars: input.stars } });
  } catch (error) {
    next(error);
  }
});

trackingSimulationRouter.post("/trips/:id/simulate/step", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const trip = await getVisibleTrip(routeParam(req.params.id), req);
    if (req.user!.role !== "admin" && (req.user!.role !== "driver" || trip.driver_route.driver.user_id !== req.user!.id)) {
      throw new HttpError(403, "forbidden");
    }
    const latest = await prisma.locationEvent.findFirst({ where: { trip_id: trip.id }, orderBy: { sequence: "desc" } });
    const sequence = latest ? latest.sequence + 1 : 0;
    const point = DEMO_ROUTE_POINTS[sequence % DEMO_ROUTE_POINTS.length];
    const location = await prisma.locationEvent.create({
      data: {
        trip_id: trip.id,
        driver_id: trip.driver_id,
        lat: point.lat.toFixed(6),
        lng: point.lng.toFixed(6),
        source: "simulated",
        sequence
      }
    });
    await auditEvent(prisma, { userId: req.user!.id, action: AuditAction.location_recorded, entityType: "LocationEvent", entityId: location.id });
    await auditEvent(prisma, { userId: req.user!.id, action: AuditAction.tracking_simulation_step, entityType: "Trip", entityId: trip.id, metadata: { sequence } });
    await maybeNotifyDriverApproaching(prisma, trip.id, point);
    res.status(201).json({ location });
  } catch (error) {
    next(error);
  }
});

trackingSimulationRouter.post("/trips/:id/simulate/reset", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const trip = await getVisibleTrip(routeParam(req.params.id), req);
    if (req.user!.role !== "admin" && (req.user!.role !== "driver" || trip.driver_route.driver.user_id !== req.user!.id)) {
      throw new HttpError(403, "forbidden");
    }
    await prisma.locationEvent.deleteMany({ where: { trip_id: trip.id, source: "simulated" } });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// GET and POST /trips/:id/location (latest point, driver GPS) live in liveLocation.ts.
