import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { normalizePhoneToE164, PhoneNormalizationError } from "../lib/phone.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import {
  listPassengerParcelsForAdmin,
  PASSENGER_PARCEL_LIMITS,
  passengerParcelService,
  serializePassengerParcel,
  type PassengerParcelService
} from "../services/passengerParcels.js";
import { detailsSchema, serviceRouteIdSchema } from "../services/operatingRoutes.js";
import { createBestMatch, type MatchActor, type MatchInput } from "./matching.js";

const idempotencyKeySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const dateTime = z.string().datetime({ offset: true }).transform((value) => new Date(value));
const noControlCharacters = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);

/** The route-based body; available whenever the API is up. */
const routeCreateSchema = z.strictObject({
  service_route_id: serviceRouteIdSchema,
  pickup_details: detailsSchema,
  dropoff_details: detailsSchema,
  preferred_time: dateTime,
  size: z.enum(PASSENGER_PARCEL_LIMITS.allowedSizes),
  note: z.string().trim().max(PASSENGER_PARCEL_LIMITS.noteMaxLength).refine(noControlCharacters).optional(),
  receiver_name: z.string().trim().min(2).max(PASSENGER_PARCEL_LIMITS.receiverNameMaxLength).refine(noControlCharacters),
  receiver_phone: z.string().trim().min(5).max(32),
  forbidden_items_acknowledged: z.literal(true)
});

/** The canonical body (route version + stops); only while MULTI_ROUTE_ENTRY_ENABLED is on. */
const createSchema = z.strictObject({
  route_version_id: z.string().min(1).max(191),
  pickup_stop_id: z.string().min(1).max(191),
  dropoff_stop_id: z.string().min(1).max(191),
  requested_departure_from: dateTime,
  requested_departure_until: dateTime,
  size: z.enum(PASSENGER_PARCEL_LIMITS.allowedSizes),
  note: z.string().trim().max(PASSENGER_PARCEL_LIMITS.noteMaxLength).refine(noControlCharacters).optional(),
  receiver_name: z.string().trim().min(2).max(PASSENGER_PARCEL_LIMITS.receiverNameMaxLength).refine(noControlCharacters),
  receiver_phone: z.string().trim().min(5).max(32),
  forbidden_items_acknowledged: z.literal(true)
});

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string" || value.length > 191) throw new HttpError(400, "invalid_route_param");
  return value;
}

function retryable(error: unknown) {
  return error && typeof error === "object" && "code" in error && error.code === "P2034"
    ? new HttpError(409, "transaction_retry_required")
    : error;
}

function receiverPhoneE164(value: string) {
  try {
    return normalizePhoneToE164(value, { region: "PS" });
  } catch (error) {
    if (error instanceof PhoneNormalizationError) throw new HttpError(400, "invalid_receiver_phone");
    throw error;
  }
}

/** Asks for a driver on the sender's behalf; matching may legitimately find none yet. */
export type PassengerParcelMatcher = (actor: MatchActor, input: MatchInput) => Promise<unknown>;

export function createPassengerParcelRouter(
  appConfig: AppConfig,
  service: PassengerParcelService = passengerParcelService,
  matcher: PassengerParcelMatcher = createBestMatch
) {
  const router = Router();
  router.use("/passenger/parcels", requireAuth, requireRole("passenger"));

  router.get("/passenger/parcels/limits", (_req, res) => {
    res.json({
      limits: {
        maximum_open: PASSENGER_PARCEL_LIMITS.maximumOpen,
        allowed_sizes: PASSENGER_PARCEL_LIMITS.allowedSizes,
        note_max_length: PASSENGER_PARCEL_LIMITS.noteMaxLength
      }
    });
  });

  router.post("/passenger/parcels", async (req: AuthenticatedRequest, res, next) => {
    try {
      const canonicalBody = Boolean(req.body && typeof req.body === "object" && "route_version_id" in req.body);
      if (!canonicalBody || !appConfig.multiRouteEntryEnabled) {
        const input = routeCreateSchema.parse(req.body);
        const key = idempotencyKeySchema.safeParse(req.header("idempotency-key"));
        if (!key.success) throw new HttpError(400, "invalid_or_missing_idempotency_key");
        const actor = { id: req.user!.id, requestId: req.requestId, idempotencyKey: key.data };
        const result = await service.createForRoute(
          {
            serviceRouteId: input.service_route_id,
            pickupDetails: input.pickup_details,
            dropoffDetails: input.dropoff_details,
            preferredTime: input.preferred_time,
            size: input.size,
            note: input.note || undefined,
            receiverName: input.receiver_name,
            receiverPhone: receiverPhoneE164(input.receiver_phone),
            forbiddenItemsAcknowledged: input.forbidden_items_acknowledged
          },
          actor
        );
        let parcel = result.parcel;
        if (!result.replayed) {
          // Offer the parcel to the best driver on its route straight away.
          // No driver yet is normal: it stays searching and the sender (or a
          // later POST /matches/run) can ask again.
          try {
            await matcher({ id: actor.id, role: "passenger" }, { merchantOrderId: parcel.order_id });
            parcel = await service.get(actor.id, parcel.order_id);
          } catch (error) {
            req.operationalLog?.info(
              { event: "passenger_parcel_not_matched", reason: error instanceof HttpError ? error.message : "match_failed" },
              "Passenger parcel waits for a driver"
            );
          }
        }
        res.status(result.replayed ? 200 : 201).json({
          parcel: serializePassengerParcel(parcel),
          replayed: result.replayed,
          // Shown once; the sender can issue a new one from the parcel later.
          handover_code: result.handoverCode,
          request_id: req.requestId
        });
        return;
      }
      const input = createSchema.parse(req.body);
      const key = idempotencyKeySchema.safeParse(req.header("idempotency-key"));
      if (!key.success) throw new HttpError(400, "invalid_or_missing_idempotency_key");
      const receiverPhone = receiverPhoneE164(input.receiver_phone);
      const result = await service.create(
        {
          routeVersionId: input.route_version_id,
          pickupStopId: input.pickup_stop_id,
          dropoffStopId: input.dropoff_stop_id,
          requestedDepartureFrom: input.requested_departure_from,
          requestedDepartureUntil: input.requested_departure_until,
          size: input.size,
          note: input.note || undefined,
          receiverName: input.receiver_name,
          receiverPhone,
          forbiddenItemsAcknowledged: input.forbidden_items_acknowledged
        },
        { id: req.user!.id, requestId: req.requestId, idempotencyKey: key.data }
      );
      res.status(result.replayed ? 200 : 201).json({
        parcel: serializePassengerParcel(result.parcel),
        replayed: result.replayed,
        request_id: req.requestId
      });
    } catch (error) {
      next(retryable(error));
    }
  });

  router.get("/passenger/parcels", async (req: AuthenticatedRequest, res, next) => {
    try {
      const parcels = await service.list(req.user!.id);
      res.json({ parcels: parcels.map(serializePassengerParcel) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/passenger/parcels/:id", async (req: AuthenticatedRequest, res, next) => {
    try {
      res.json({ parcel: serializePassengerParcel(await service.get(req.user!.id, routeParam(req.params.id))) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/passenger/parcels/:id/cancel", async (req: AuthenticatedRequest, res, next) => {
    try {
      res.json({ parcel: serializePassengerParcel(await service.cancel(req.user!.id, routeParam(req.params.id))) });
    } catch (error) {
      next(retryable(error));
    }
  });

  return router;
}

/** Admin overview of passenger parcels. Never includes receiver details. */
export const adminPassengerParcelsRouter = Router();
adminPassengerParcelsRouter.use("/admin/passenger-parcels", requireAuth, requireRole("admin"));
adminPassengerParcelsRouter.get("/admin/passenger-parcels", async (_req, res, next) => {
  try {
    res.json({ parcels: await listPassengerParcelsForAdmin(prisma) });
  } catch (error) {
    next(error);
  }
});
