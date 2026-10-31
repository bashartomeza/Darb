import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { haversineKm, LOCKED_DESTINATION } from "../lib/geo.js";
import { compareRankedRoutes, scoreDriverRoute } from "../lib/routeScoring.js";

import { latitudeSchema, longitudeSchema } from "../lib/validation.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { LOCKED_CORRIDOR_KEY, LOCKED_CORRIDOR_LABEL } from "./demoReset.js";
import type { Prisma } from "../generated/prisma/client.js";
import { AuditAction, MatchStatus } from "../generated/prisma/enums.js";
import { notifyMatchOffered } from "../services/notifications.js";
import { isLegacyRouteTimely, legacyRouteTimingWhere, reserveLegacyCapacity, requireEligibleLegacyRoute } from "../services/legacyCapacity.js";

const runMatchSchema = z
  .object({
    passengerRequestId: z.string().optional(),
    merchantOrderId: z.string().optional(),
    driverRouteId: z.string().optional()
  })
  .refine((value) => value.passengerRequestId || value.merchantOrderId, {
    message: "passengerRequestId or merchantOrderId is required"
  })
  .refine((value) => !value.driverRouteId || value.passengerRequestId, {
    message: "driverRouteId requires passengerRequestId"
  });

type MatchInput = z.infer<typeof runMatchSchema>;

const passengerMatchSearchSchema = z.object({
  pickup_label: z.string().trim().min(1).max(191),
  pickup_lat: latitudeSchema,
  pickup_lng: longitudeSchema,
  destination_label: z.string().trim().min(1).max(191),
  destination_lat: latitudeSchema,
  destination_lng: longitudeSchema,
  preferred_time: z.coerce.date(),
  passenger_count: z.coerce.number().int().min(1).max(4)
}).strict();

type PassengerMatchSearchInput = z.infer<typeof passengerMatchSearchSchema>;

const listMatchesQuerySchema = z.object({
  status: z.enum(MatchStatus).optional()
});

const matchSummarySelect = {
  id: true,
  status: true,
  score: true,
  method: true,
  explanation: true,
  scoring_breakdown: true,
  created_at: true,
  operational_mode: true,
  canonical_match_version: true,
  route_version_id: true,
  driver_route: {
    select: {
      id: true,
      origin_label: true,
      destination_label: true,
      corridor_key: true,
      seats_available: true,
      parcel_capacity_available: true,
      status: true,
      driver: {
        select: {
          user_id: true,
          user: { select: { name: true } },
          vehicle_type: true,
          verified: true,
          trust_score: true
        }
      }
    }
  },
  passenger_request: {
    select: {
      id: true,
      passenger_id: true,
      pickup_label: true,
      destination_label: true,
      preferred_time: true,
      passenger_count: true,
      status: true,
      created_at: true
    }
  },
  merchant_order: {
    select: {
      id: true,
      merchant_id: true,
      pickup_label: true,
      status: true,
      created_at: true,
      _count: { select: { parcels: true } }
    }
  },
  parcel_batch: {
    select: {
      id: true,
      status: true,
      estimated_distance_saved: true,
      explanation: true,
      created_at: true,
      members: { select: { merchant_order: { select: { _count: { select: { parcels: true } } } } } }
    }
  }
} satisfies Prisma.MatchSelect;

type MatchSummaryRecord = Prisma.MatchGetPayload<{ select: typeof matchSummarySelect }>;

export { scoreDriverRoute };

export const matchingRouter = Router();

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_route_param");
  return value;
}

function matchWhereForUser(req: AuthenticatedRequest): Prisma.MatchWhereInput {
  if (req.user!.role === "admin") return {};
  if (req.user!.role === "driver") return { driver_route: { driver: { user_id: req.user!.id } } };
  if (req.user!.role === "passenger") return { passenger_request: { passenger_id: req.user!.id } };
  return { merchant_order: { merchant_id: req.user!.id } };
}

function toMatchSummary(match: MatchSummaryRecord) {
  return {
    id: match.id,
    status: match.status,
    score: match.score,
    method: match.method,
    explanation: match.explanation,
    scoring_breakdown: match.scoring_breakdown,
    created_at: match.created_at,
    driver_route: {
      id: match.driver_route.id,
      origin_label: match.driver_route.origin_label,
      destination_label: match.driver_route.destination_label,
      corridor_key: match.driver_route.corridor_key,
      seats_available: match.driver_route.seats_available,
      parcel_capacity_available: match.driver_route.parcel_capacity_available,
      status: match.driver_route.status,
      driver: {
        name: match.driver_route.driver.user.name,
        vehicle_type: match.driver_route.driver.vehicle_type,
        verified: match.driver_route.driver.verified,
        trust_score: match.driver_route.driver.trust_score
      }
    },
    passenger_request: match.passenger_request
      ? {
          id: match.passenger_request.id,
          pickup_label: match.passenger_request.pickup_label,
          destination_label: match.passenger_request.destination_label,
          preferred_time: match.passenger_request.preferred_time,
          passenger_count: match.passenger_request.passenger_count,
          status: match.passenger_request.status,
          created_at: match.passenger_request.created_at
        }
      : null,
    merchant_order: match.merchant_order
      ? {
          id: match.merchant_order.id,
          pickup_label: match.merchant_order.pickup_label,
          status: match.merchant_order.status,
          parcel_count: match.merchant_order._count.parcels,
          created_at: match.merchant_order.created_at
        }
      : null,
    parcel_batch: match.parcel_batch
      ? {
          id: match.parcel_batch.id,
          status: match.parcel_batch.status,
          estimated_distance_saved: match.parcel_batch.estimated_distance_saved,
          explanation: match.parcel_batch.explanation,
          created_at: match.parcel_batch.created_at,
          parcel_count: match.parcel_batch.members?.reduce((count, member) => count + member.merchant_order._count.parcels, 0) ?? match.merchant_order?._count.parcels ?? 0
        }
      : null
  };
}

async function loadAuthorizedInput(req: AuthenticatedRequest, input: MatchInput) {
  const passengerRequest = input.passengerRequestId
    ? await prisma.passengerRequest.findUnique({ where: { id: input.passengerRequestId } })
    : null;
  const merchantOrder = input.merchantOrderId
    ? await prisma.merchantOrder.findUnique({
        where: { id: input.merchantOrderId },
        include: {
          parcels: true,
          parcel_batches: {
            where: { status: { notIn: ["cancelled", "failed", "expired"] } },
            select: { id: true },
            orderBy: { created_at: "desc" },
            take: 1
          },
          batch_members: {
            where: { active: true },
            select: { parcel_batch_id: true },
            orderBy: { created_at: "desc" },
            take: 1
          }
        }
      })
    : null;

  if (input.passengerRequestId && !passengerRequest) throw new HttpError(404, "passenger_request_not_found");
  if (input.merchantOrderId && !merchantOrder) throw new HttpError(404, "merchant_order_not_found");
  if (req.user!.role !== "admin") {
    if (passengerRequest && (req.user!.role !== "passenger" || passengerRequest.passenger_id !== req.user!.id)) {
      throw new HttpError(403, "forbidden");
    }
    if (merchantOrder && (req.user!.role !== "merchant" || merchantOrder.merchant_id !== req.user!.id)) {
      throw new HttpError(403, "forbidden");
    }
  }
  if (passengerRequest?.canonical_entry_version || merchantOrder?.canonical_entry_version) {
    throw new HttpError(409, "canonical_matching_not_enabled");
  }

  return { passengerRequest, merchantOrder };
}

type PassengerDemand = {
  pickup_lat: unknown;
  pickup_lng: unknown;
  passenger_count: number;
  preferred_time: Date | string;
};

async function rankDriverRoutes(input: {
  passengerRequest?: PassengerDemand | null;
  parcelCount: number;
  excludeRouteIds?: ReadonlySet<string>;
}) {
  const now = new Date();
  const routes = await prisma.driverRoute.findMany({
    where: {
      status: "active",
      corridor_key: LOCKED_CORRIDOR_KEY,
      canonical_availability_version: null,
      operational_mode: "legacy",
      driver: { verified: true, user: { role: "driver", account_status: "active" } },
      ...legacyRouteTimingWhere(now)
    },
    include: {
      driver: {
        include: {
          user: { select: { name: true } }
        }
      }
    },
    orderBy: { id: "asc" }
  });

  return routes
    .filter((route) => isLegacyRouteTimely(route, now))
    .filter((route) => !input.excludeRouteIds?.has(route.id))
    .filter((route) => !input.passengerRequest || route.seats_available >= input.passengerRequest.passenger_count)
    .filter((route) => input.parcelCount === 0 || route.parcel_capacity_available >= input.parcelCount)
    .map((route) => ({
      route,
      breakdown: scoreDriverRoute({
        route,
        passengerRequest: input.passengerRequest,
        parcelCount: input.parcelCount
      })
    }))
    .sort(compareRankedRoutes);
}

type RankedDriverRoute = Awaited<ReturnType<typeof rankDriverRoutes>>[number];

function passengerSearchResult(candidate: RankedDriverRoute) {
  return {
    id: candidate.route.id,
    origin_label: candidate.route.origin_label,
    destination_label: candidate.route.destination_label,
    departure_at: candidate.route.departure_at,
    availability_window_end: candidate.route.availability_window_end,
    seats_available: candidate.route.seats_available,
    score: candidate.breakdown.finalScore,
    scoring_breakdown: candidate.breakdown,
    driver: {
      name: candidate.route.driver.user.name,
      vehicle_type: candidate.route.driver.vehicle_type,
      trust_score: candidate.route.driver.trust_score,
      verified: candidate.route.driver.verified
    }
  };
}

function passengerDemandFromSearch(input: PassengerMatchSearchInput): PassengerDemand {
  return {
    pickup_lat: input.pickup_lat,
    pickup_lng: input.pickup_lng,
    passenger_count: input.passenger_count,
    preferred_time: input.preferred_time
  };
}

async function createBestMatch(req: AuthenticatedRequest, input: MatchInput) {
  const { passengerRequest, merchantOrder } = await loadAuthorizedInput(req, input);
  if (merchantOrder && !["submitted", "batched", "matched"].includes(merchantOrder.status)) {
    throw new HttpError(409, "merchant_order_not_matchable");
  }
  if (passengerRequest && passengerRequest.preferred_time <= new Date()) {
    throw new HttpError(409, "passenger_request_expired");
  }
  const merchantBatchId = merchantOrder?.parcel_batches[0]?.id ?? merchantOrder?.batch_members[0]?.parcel_batch_id ?? null;
  const parcelCount = merchantOrder
    ? merchantBatchId
      ? await prisma.parcel.count({ where: { batch_id: merchantBatchId, status: { notIn: ["cancelled", "failed", "expired"] } } })
      : merchantOrder.parcels.length
    : 0;
  const rejectedRoutes = passengerRequest
    ? await prisma.match.findMany({
        where: {
          passenger_request_id: passengerRequest.id,
          operational_mode: "legacy",
          status: { in: [MatchStatus.rejected, MatchStatus.expired, MatchStatus.invalidated] }
        },
        select: { driver_route_id: true }
      })
    : [];
  const candidates = await rankDriverRoutes({
    passengerRequest,
    parcelCount,
    excludeRouteIds: new Set(rejectedRoutes.map((item) => item.driver_route_id))
  });

  const best = input.driverRouteId
    ? candidates.find((candidate) => candidate.route.id === input.driverRouteId)
    : candidates[0];
  if (!best) {
    throw new HttpError(
      input.driverRouteId ? 409 : 404,
      input.driverRouteId ? "selected_driver_route_unavailable" : "no_compatible_driver_route"
    );
  }

  const explanation =
    `Driver selected because the route matches the ${LOCKED_CORRIDOR_LABEL} corridor, ` +
    "pickup is near the route, capacity is available, and trust score is high.";

  if (passengerRequest && !["pending", "matched"].includes(passengerRequest.status)) {
    throw new HttpError(409, "passenger_request_not_matchable");
  }
  if (merchantOrder && !["submitted", "batched", "matched"].includes(merchantOrder.status)) {
    throw new HttpError(409, "merchant_order_not_matchable");
  }

  let match;
  try {
    match = await prisma.$transaction(async (tx) => {
      if (passengerRequest) {
        const claimedRequest = await tx.passengerRequest.updateMany({
          where: {
            id: passengerRequest.id,
            passenger_id: passengerRequest.passenger_id,
            status: { in: ["pending", "matched"] },
            canonical_entry_version: null,
            preferred_time: { gt: new Date() }
          },
          data: { status: "matched" }
        });
        if (claimedRequest.count !== 1) {
          throw new HttpError(409, "passenger_request_not_matchable");
        }

        const active = await tx.match.findFirst({
          where: {
            passenger_request_id: passengerRequest.id,
            operational_mode: "legacy",
            status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver, MatchStatus.accepted] }
          }
        });
        if (active) throw new HttpError(409, "passenger_request_already_matched");
      }

      if (merchantOrder) {
        const active = await tx.match.findFirst({
          where: merchantBatchId
            ? {
                parcel_batch_id: merchantBatchId,
                operational_mode: "legacy",
                status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver, MatchStatus.accepted] }
              }
            : {
                merchant_order_id: merchantOrder.id,
                operational_mode: "legacy",
                status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver, MatchStatus.accepted] }
              }
        });
        if (active) throw new HttpError(409, "merchant_order_already_matched");

        if (merchantBatchId) {
          const members = await tx.parcelBatchOrder.findMany({
            where: { parcel_batch_id: merchantBatchId },
            select: { merchant_order_id: true }
          });
          if (!members.length) throw new HttpError(409, "batch_not_matchable");
          const orderIds = members.map((item) => item.merchant_order_id);
          const claimed = await tx.merchantOrder.updateMany({
            where: { id: { in: orderIds }, status: { in: ["batched", "submitted"] } },
            data: { status: "matched" }
          });
          if (claimed.count !== orderIds.length) throw new HttpError(409, "batch_not_matchable");
        } else {
          const claimed = await tx.merchantOrder.updateMany({
            where: { id: merchantOrder.id, status: "submitted" },
            data: { status: "matched" }
          });
          if (claimed.count !== 1) throw new HttpError(409, "merchant_order_not_matchable");
        }

        if (merchantBatchId) {
          await tx.parcelBatch.update({ where: { id: merchantBatchId }, data: { driver_route_id: best.route.id, status: "proposed" } });
        }
      }

      const seatsToReserve = passengerRequest?.passenger_count ?? 0;
      if (seatsToReserve || parcelCount) {
        await reserveLegacyCapacity(tx, {
          driverRouteId: best.route.id,
          seats: seatsToReserve,
          parcelUnits: parcelCount,
          passengerRequestId: passengerRequest?.id
        });
      }

      // Batch/order writes may themselves wait on locks. Recheck approved
      // supply and demand with a separate DB clock after all those waits.
      await requireEligibleLegacyRoute(tx, best.route.id, { passengerRequestId: passengerRequest?.id });

      const created = await tx.match.create({
        data: {
          driver_route_id: best.route.id,
          passenger_request_id: passengerRequest?.id,
          merchant_order_id: merchantOrder?.id,
          parcel_batch_id: merchantBatchId,
          score: best.breakdown.finalScore.toFixed(4),
          method: "masari_route_score",
          explanation,
          scoring_breakdown: best.breakdown,
          status: MatchStatus.proposed,
          expires_at: new Date(Date.now() + 10 * 60 * 1000),
          legacy_capacity_held: true,
          legacy_demand_key: passengerRequest
            ? `passenger:${passengerRequest.id}`
            : null
        },
        include: {
          driver_route: { include: { driver: true } },
          passenger_request: true,
          merchant_order: true,
          parcel_batch: true
        }
      });

      await tx.auditEvent.create({
        data: {
          user_id: req.user!.id,
          action: AuditAction.match_decision,
          entity_type: "Match",
          entity_id: created.id,
          metadata: { method: created.method, score: best.breakdown.finalScore }
        }
      });
      return created;
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new HttpError(409, passengerRequest ? "passenger_request_already_matched" : "match_conflict");
    }
    throw error;
  }

  await notifyMatchOffered(prisma, match);

  return { match, scoringBreakdown: best.breakdown, candidatesConsidered: candidates.length };
}

matchingRouter.post(
  "/matches/search",
  requireAuth,
  requireRole("passenger"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = passengerMatchSearchSchema.parse(req.body);
      if (input.preferred_time <= new Date()) throw new HttpError(400, "preferred_time_in_past");
      const destinationDistanceKm = haversineKm(
        { lat: input.destination_lat, lng: input.destination_lng },
        LOCKED_DESTINATION
      );
      if (destinationDistanceKm > 1) {
        throw new HttpError(422, "unsupported_destination");
      }

      const candidates = await rankDriverRoutes({
        passengerRequest: passengerDemandFromSearch(input),
        parcelCount: 0
      });

      res.json({
        results: candidates.map(passengerSearchResult),
        request_id: req.requestId
      });
    } catch (error) {
      next(error);
    }
  }
);

matchingRouter.post("/matches/run", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = runMatchSchema.parse(req.body);
    const result = await createBestMatch(req, input);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

matchingRouter.get("/matches", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { status } = listMatchesQuerySchema.parse(req.query);
    const matches = await prisma.match.findMany({
      where: { ...matchWhereForUser(req), ...(status ? { status } : {}) },
      select: matchSummarySelect,
      orderBy: { created_at: "desc" }
    });

    res.json({
      matches: matches
        .filter((match) => {
          const mode = match as MatchSummaryRecord & {
            operational_mode?: string;
            canonical_match_version?: string | null;
            route_version_id?: string | null;
          };
          return (mode.operational_mode ?? "legacy") === "legacy" &&
            !mode.canonical_match_version &&
            !mode.route_version_id;
        })
        .map(toMatchSummary)
    });
  } catch (error) {
    next(error);
  }
});

matchingRouter.get("/matches/:id", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const matchId = routeParam(req.params.id);
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: matchSummarySelect
    });
    if (!match) throw new HttpError(404, "match_not_found");
    const mode = match as MatchSummaryRecord & {
      operational_mode?: string;
      canonical_match_version?: string | null;
      route_version_id?: string | null;
    };
    if ((mode.operational_mode ?? "legacy") !== "legacy" || mode.canonical_match_version || mode.route_version_id) {
      throw new HttpError(404, "match_not_found");
    }

    if (req.user!.role !== "admin") {
      const ownsDriver = req.user!.role === "driver" && match.driver_route.driver.user_id === req.user!.id;
      const ownsPassenger = req.user!.role === "passenger" && match.passenger_request?.passenger_id === req.user!.id;
      const ownsMerchant = req.user!.role === "merchant" && match.merchant_order?.merchant_id === req.user!.id;
      if (!ownsDriver && !ownsPassenger && !ownsMerchant) throw new HttpError(403, "forbidden");
    }

    const summary = toMatchSummary(match);
    res.json({ match: summary, scoringBreakdown: summary.scoring_breakdown });
  } catch (error) {
    next(error);
  }
});
