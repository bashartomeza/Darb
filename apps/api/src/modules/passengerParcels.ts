import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { normalizePhoneToE164, PhoneNormalizationError } from "../lib/phone.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError, notFoundHandler } from "../middleware/error.js";
import {
  listPassengerParcelsForAdmin,
  PASSENGER_PARCEL_LIMITS,
  passengerParcelService,
  serializePassengerParcel,
  type PassengerParcelService
} from "../services/passengerParcels.js";

const idempotencyKeySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const dateTime = z.string().datetime({ offset: true }).transform((value) => new Date(value));
const noControlCharacters = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);

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

export function createPassengerParcelRouter(
  appConfig: AppConfig,
  service: PassengerParcelService = passengerParcelService
) {
  const router = Router();
  if (!appConfig.multiRouteEntryEnabled) {
    router.use("/passenger/parcels", notFoundHandler);
    return router;
  }
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
      const input = createSchema.parse(req.body);
      const key = idempotencyKeySchema.safeParse(req.header("idempotency-key"));
      if (!key.success) throw new HttpError(400, "invalid_or_missing_idempotency_key");
      let receiverPhone: string;
      try {
        receiverPhone = normalizePhoneToE164(input.receiver_phone, { region: "PS" });
      } catch (error) {
        if (error instanceof PhoneNormalizationError) throw new HttpError(400, "invalid_receiver_phone");
        throw error;
      }
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
