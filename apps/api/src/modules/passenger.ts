import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { latitudeSchema, longitudeSchema } from "../lib/validation.js";
import { MatchStatus, TripStatus } from "../generated/prisma/enums.js";
import { advanceLegacyTrip } from "../services/tripLifecycle.js";
import { releaseLegacyCapacity } from "../services/legacyCapacity.js";
import { legacyPassengerCreationService } from "../services/legacyPassengerCreation.js";

const createPassengerRequestSchema = z.object({
  pickup_label: z.string().min(1),
  pickup_lat: latitudeSchema,
  pickup_lng: longitudeSchema,
  destination_label: z.string().min(1),
  destination_lat: latitudeSchema,
  destination_lng: longitudeSchema,
  preferred_time: z.coerce.date(),
  passenger_count: z.coerce.number().int().min(1).max(4)
});
const idempotencyKeySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional();

export const passengerRouter = Router();

function serializeLegacyPassengerRequest(value: Record<string, unknown>) {
  return {
    id: value.id,
    passenger_id: value.passenger_id,
    pickup_label: value.pickup_label,
    pickup_lat: value.pickup_lat,
    pickup_lng: value.pickup_lng,
    destination_label: value.destination_label,
    destination_lat: value.destination_lat,
    destination_lng: value.destination_lng,
    preferred_time: value.preferred_time,
    passenger_count: value.passenger_count,
    status: value.status,
    source: value.source,
    created_at: value.created_at
  };
}

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_route_param");
  }
  return value;
}

passengerRouter.use("/passenger", requireAuth, requireRole("passenger"));

passengerRouter.post("/passenger/requests", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = createPassengerRequestSchema.parse(req.body);
    const idempotencyKey = idempotencyKeySchema.parse(req.header("idempotency-key"));
    const result = await legacyPassengerCreationService.create(input, { id: req.user!.id, idempotencyKey });
    res.status(201).json({ request: serializeLegacyPassengerRequest(result.resource as unknown as Record<string, unknown>) });
  } catch (error) {
    next(error);
  }
});

passengerRouter.get("/passenger/requests", async (req: AuthenticatedRequest, res, next) => {
  try {
    const requests = await prisma.passengerRequest.findMany({
      where: { passenger_id: req.user!.id, canonical_entry_version: null },
      orderBy: { created_at: "desc" }
    });
    res.json({ requests: requests.map((request) => serializeLegacyPassengerRequest(request as unknown as Record<string, unknown>)) });
  } catch (error) {
    next(error);
  }
});

passengerRouter.get("/passenger/requests/active", async (req: AuthenticatedRequest, res, next) => {
  try {
    const requests = await prisma.passengerRequest.findMany({
      where: {
        passenger_id: req.user!.id,
        canonical_entry_version: null,
        status: { in: ["pending", "matched", "accepted", "picked_up", "in_transit", "delivered"] }
      },
      orderBy: { created_at: "desc" }
    });
    res.json({ requests: requests.map((request) => serializeLegacyPassengerRequest(request as unknown as Record<string, unknown>)) });
  } catch (error) {
    next(error);
  }
});

passengerRouter.get("/passenger/requests/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const requestId = routeParam(req.params.id);
    const request = await prisma.passengerRequest.findFirst({
      where: { id: requestId, passenger_id: req.user!.id, canonical_entry_version: null }
    });
    if (!request) {
      throw new HttpError(404, "request_not_found");
    }
    res.json({ request: serializeLegacyPassengerRequest(request as unknown as Record<string, unknown>) });
  } catch (error) {
    next(error);
  }
});

passengerRouter.patch("/passenger/requests/:id/cancel", async (req: AuthenticatedRequest, res, next) => {
  try {
    const requestId = routeParam(req.params.id);
    const request = await prisma.$transaction(async (tx) => {
      // Lock before the first snapshot read: matching claims this same request.
      // A cancellation must see every hold committed before it obtains the lock.
      await tx.$queryRaw`
        SELECT id FROM passenger_requests
        WHERE id = ${requestId} AND passenger_id = ${req.user!.id} AND canonical_entry_version IS NULL
        FOR UPDATE
      `;
      const existing = await tx.passengerRequest.findFirst({
        where: { id: requestId, passenger_id: req.user!.id, canonical_entry_version: null },
      });
      if (!existing) throw new HttpError(404, "request_not_found");

      if (existing.status === "accepted") {
        const trip = await tx.trip.findFirst({
          where: {
            passenger_request_id: existing.id,
            operational_mode: "legacy",
            status: TripStatus.accepted,
          },
          select: {
            id: true,
            status: true,
            driver_route_id: true,
            passenger_request_id: true,
            merchant_order_id: true,
            parcel_batch_id: true,
          },
        });
        if (!trip) throw new HttpError(409, "request_cannot_be_cancelled");

        const updatedTrip = await advanceLegacyTrip(tx, trip, TripStatus.cancelled, {
          actorId: req.user!.id,
          expectedStatus: TripStatus.accepted,
        });
        await tx.match.updateMany({
          where: {
            passenger_request_id: existing.id,
            operational_mode: "legacy",
            status: MatchStatus.accepted,
          },
          data: { status: MatchStatus.invalidated, legacy_demand_key: null, legacy_capacity_held: false },
        });

        await tx.auditEvent.create({
          data: {
            user_id: req.user!.id,
            action: AuditAction.passenger_request_cancelled,
            entity_type: "PassengerRequest",
            entity_id: existing.id,
            metadata: { previous_status: existing.status, trip_id: updatedTrip.id },
          },
        });

        const updatedRequest = await tx.passengerRequest.findUniqueOrThrow({ where: { id: existing.id } });
        return updatedRequest;
      }

      if (existing.status !== "pending" && existing.status !== "matched") {
        throw new HttpError(409, "request_cannot_be_cancelled");
      }

      const activeMatches = await tx.match.findMany({
        where: {
          passenger_request_id: existing.id,
          operational_mode: "legacy",
          status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver] },
        },
        select: {
          id: true,
          driver_route_id: true,
          legacy_capacity_held: true,
          merchant_order_id: true,
          parcel_batch_id: true,
        },
      });
      for (const match of activeMatches) {
        const changed = await tx.match.updateMany({
          where: { id: match.id, status: { in: [MatchStatus.proposed, MatchStatus.sent_to_driver] } },
          data: { status: MatchStatus.invalidated, legacy_demand_key: null, legacy_capacity_held: false },
        });
        if (changed.count !== 1) continue;

        const parcelUnits = match.parcel_batch_id
          ? await tx.parcel.count({
              where: {
                batch_id: match.parcel_batch_id,
                status: { notIn: ["cancelled", "failed", "expired"] },
              },
            })
          : match.merchant_order_id
            ? await tx.parcel.count({
                where: {
                  order_id: match.merchant_order_id,
                  status: { notIn: ["cancelled", "failed", "expired"] },
                },
              })
            : 0;

        if (match.legacy_capacity_held) {
          await releaseLegacyCapacity(tx, {
            driverRouteId: match.driver_route_id,
            seats: existing.passenger_count,
            parcelUnits,
          });
        }

        if (match.parcel_batch_id) {
          const batch = await tx.parcelBatch.findUnique({
            where: { id: match.parcel_batch_id },
            select: { id: true, status: true },
          });
          if (batch && ["proposed", "created"].includes(batch.status)) {
            await tx.parcelBatch.update({
              where: { id: batch.id },
              data: { driver_route_id: null, status: "created" },
            });
            const members = await tx.parcelBatchOrder.findMany({
              where: { parcel_batch_id: batch.id, active: true },
              select: { merchant_order_id: true },
            });
            const orderIds = members.map((member) => member.merchant_order_id);
            if (orderIds.length) {
              await tx.merchantOrder.updateMany({
                where: { id: { in: orderIds }, status: "matched" },
                data: { status: "batched" },
              });
            }
          }
        } else if (match.merchant_order_id) {
          await tx.merchantOrder.updateMany({
            where: { id: match.merchant_order_id, status: "matched" },
            data: { status: "submitted" },
          });
        }
      }

      const changed = await tx.passengerRequest.updateMany({
        where: { id: existing.id, passenger_id: req.user!.id, status: { in: ["pending", "matched"] } },
        data: { status: "cancelled" },
      });
      if (changed.count !== 1) throw new HttpError(409, "request_cannot_be_cancelled");

      await tx.auditEvent.create({
        data: {
          user_id: req.user!.id,
          action: AuditAction.passenger_request_cancelled,
          entity_type: "PassengerRequest",
          entity_id: existing.id,
          metadata: { previous_status: existing.status, invalidated_matches: activeMatches.length },
        },
      });

      return tx.passengerRequest.findUniqueOrThrow({ where: { id: existing.id } });
    });

    res.json({ request: serializeLegacyPassengerRequest(request as unknown as Record<string, unknown>) });
  } catch (error) {
    next(error);
  }
});
