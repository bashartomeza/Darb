import { Router } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { auditEvent } from "../lib/audit.js";
import {
  requireAuth,
  requireRole,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { LOCKED_CORRIDOR_KEY } from "./demoReset.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { Prisma } from "../generated/prisma/client.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import {
  LEGACY_ROUTE_MAX_PARCEL_CAPACITY,
  LEGACY_ROUTE_MAX_SEATS,
  legacyDriverOnlineStateService,
  type LegacyDriverOnlineStateService,
} from "../services/legacyDriverOnlineState.js";
import {
  LEGACY_DEFAULT_ROUTE_KEY,
  driverRoutePlaces,
  resolveOperatingRoute,
  resolveOperatingRouteByKey,
  routeFields,
  routeSummarySelect,
  serviceRouteIdSchema,
  type RouteSummary,
} from "../services/operatingRoutes.js";

/**
 * The single corridor every driver route used before routes existed. New
 * driver routes name a predefined route instead; this stays for the
 * read-only GET /legacy-corridor that older app builds still call.
 */
export const LOCKED_ROUTE = {
  origin_label: "Hebron / PPU / Bab Al-Zawiya",
  origin_lat: 31.5326,
  origin_lng: 35.0998,
  destination_label: "Bethlehem",
  destination_lat: 31.7054,
  destination_lng: 35.2024,
  corridor_key: LOCKED_CORRIDOR_KEY,
};
const CREATE_ROUTE_OPERATION = "legacy_driver_route_create_v1";
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

// Older builds also sent the corridor's labels and key; they are accepted and
// ignored, because the route's own cities now name both ends.
const routeSchema = z.object({
  // Optional for older builds, which name no route: they drive Hebron → Bethlehem.
  service_route_id: serviceRouteIdSchema.optional(),
  origin_label: z.string().optional(),
  destination_label: z.string().optional(),
  corridor_key: z.string().optional(),
  seats_available: z.coerce.number().int().min(0).max(LEGACY_ROUTE_MAX_SEATS).default(1),
  parcel_capacity_available: z.coerce.number().int().min(0).max(LEGACY_ROUTE_MAX_PARCEL_CAPACITY).default(0),
});

const onlineStateSchema = z.strictObject({
  online: z.boolean(),
  expected_route_id: z.string().min(1).max(191).nullable().optional(),
  service_route_id: serviceRouteIdSchema.optional(),
});
const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

function serializeLegacyDriverRoute(value: Record<string, unknown>) {
  return {
    id: value.id,
    driver_id: value.driver_id,
    origin_label: value.origin_label,
    origin_lat: value.origin_lat,
    origin_lng: value.origin_lng,
    destination_label: value.destination_label,
    destination_lat: value.destination_lat,
    destination_lng: value.destination_lng,
    corridor_key: value.corridor_key,
    seats_available: value.seats_available,
    parcel_capacity_available: value.parcel_capacity_available,
    status: value.status,
    route_version_id: value.route_version_id,
    ...routeFields(value.route_version as RouteSummary),
    departure_at: value.departure_at,
    availability_window_end: value.availability_window_end,
    total_seats: value.total_seats,
    remaining_seats: value.remaining_seats,
    total_parcel_capacity: value.total_parcel_capacity,
    remaining_parcel_capacity: value.remaining_parcel_capacity,
    availability_status: value.availability_status,
    availability_revision: value.availability_revision,
    activated_at: value.activated_at,
    paused_at: value.paused_at,
    filled_at: value.filled_at,
    departed_at: value.departed_at,
    completed_at: value.completed_at,
    cancelled_at: value.cancelled_at,
    expired_at: value.expired_at,
  };
}

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_route_param");
  }
  return value;
}

/** Responses needed before an acceptance percentage is shown. */
export const ACCEPTANCE_RATE_MIN_SAMPLE = 5;

export function createDriverRouter(
  onlineStateService: LegacyDriverOnlineStateService = legacyDriverOnlineStateService,
) {
  const driverRouter = Router();
  driverRouter.use("/driver", requireAuth, requireRole("driver"));

  driverRouter.put(
    "/driver/online-state",
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const key = idempotencyKeySchema.safeParse(
          req.header("idempotency-key"),
        );
        if (!key.success)
          throw new HttpError(400, "invalid_or_missing_idempotency_key");
        const input = onlineStateSchema.parse(req.body);
        const result = await onlineStateService.setState(
          {
            online: input.online,
            expectedRouteId: input.expected_route_id,
            ...(input.service_route_id ? { serviceRouteId: input.service_route_id } : {}),
          },
          {
            id: req.user!.id,
            requestId: req.requestId,
            idempotencyKey: key.data,
          },
        );
        res.json({
          online: result.online,
          route_id: result.routeId,
          replayed: result.replayed,
          request_id: req.requestId,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  driverRouter.post(
    "/driver/routes",
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const input = routeSchema.parse(req.body);
        // An older body only ever named the old corridor; any other place is
        // refused as before rather than moved onto Hebron → Bethlehem.
        if (!input.service_route_id && (
          (input.origin_label !== undefined && input.origin_label !== LOCKED_ROUTE.origin_label) ||
          (input.destination_label !== undefined && input.destination_label !== LOCKED_ROUTE.destination_label) ||
          (input.corridor_key !== undefined && input.corridor_key !== LOCKED_ROUTE.corridor_key)
        )) {
          throw new HttpError(400, "route_outside_locked_corridor");
        }
        const idempotencyKey = idempotencyKeySchema.optional().parse(req.header("idempotency-key"));

        const route = await prisma.$transaction(async (tx) => {
          const claim = idempotencyKey === undefined ? undefined : await claimIdempotency(tx, {
            operation: CREATE_ROUTE_OPERATION,
            scopeDigest: digest(`${CREATE_ROUTE_OPERATION}:${req.user!.id}`),
            keyDigest: digest(idempotencyKey),
            keyVersion: 1,
            requestDigest: digest(JSON.stringify({ actor_id: req.user!.id, service_route_id: input.service_route_id,
              seats_available: input.seats_available, parcel_capacity_available: input.parcel_capacity_available })),
            expiresAt: new Date(Date.now() + 86_400_000),
            retainCompleted: true,
          });
          if (claim?.kind === "conflict") throw new HttpError(409, "idempotency_conflict");
          if (claim?.kind === "in_progress") throw new HttpError(409, "idempotency_in_progress");
          if (claim?.kind === "failed") throw new HttpError(409, "idempotency_failed");
          if (claim?.kind === "replay") {
            if (claim.record.resource_type !== "DriverRoute" || !claim.record.resource_id) {
              throw new HttpError(409, "idempotency_replay_unavailable");
            }
            const original = await tx.driverRoute.findFirst({ where: { id: claim.record.resource_id,
              driver: { user_id: req.user!.id }, operational_mode: "legacy", canonical_availability_version: null },
              include: { route_version: routeSummarySelect } });
            if (!original) throw new HttpError(409, "idempotency_replay_unavailable");
            return original;
          }
          async function rememberRoute(resourceId: string) {
            if (!claim) return;
            await completeIdempotency(tx, { recordId: claim.record.id, claimVersion: claim.record.claim_version,
              resourceType: "DriverRoute", resourceId, responseStatus: 201 });
          }
          const profile = await tx.driverProfile.findUnique({
            where: { user_id: req.user!.id },
          });
          if (!profile) {
            throw new HttpError(404, "driver_profile_not_found");
          }

          await tx.$queryRaw`SELECT id FROM driver_profiles WHERE id = ${profile.id} FOR UPDATE`;
          const operatingRoute = input.service_route_id
            ? await resolveOperatingRoute(tx, input.service_route_id)
            : await resolveOperatingRouteByKey(tx, LEGACY_DEFAULT_ROUTE_KEY);
          const current = await tx.driverRoute.findFirst({
            where: { driver_id: profile.id, operational_mode: "legacy", canonical_availability_version: null,
              status: { in: ["active", "assigned", "on_trip"] } },
            include: { route_version: routeSummarySelect },
            orderBy: [{ activated_at: "desc" }, { id: "asc" }],
          });
          if (current) {
            if (current.status === "active" && current.seats_available === input.seats_available &&
              current.parcel_capacity_available === input.parcel_capacity_available &&
              current.route_version?.service_route_id === operatingRoute.serviceRouteId) {
              await rememberRoute(current.id);
              return current;
            }
            throw new HttpError(409, "route_already_active");
          }
          const created = await tx.driverRoute.create({
            data: {
              driver_id: profile.id,
              ...driverRoutePlaces(operatingRoute),
              seats_available: input.seats_available,
              parcel_capacity_available: input.parcel_capacity_available,
              status: "active",
              activated_at: new Date(),
            },
            include: { route_version: routeSummarySelect },
          });

          await auditEvent(tx, {
            userId: req.user!.id,
            action: AuditAction.driver_route_created,
            entityType: "DriverRoute",
            entityId: created.id,
            metadata: { corridor_key: operatingRoute.routeKey, service_route_id: operatingRoute.serviceRouteId },
          });
          await rememberRoute(created.id);
          return created;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

        res.status(201).json({
          route: serializeLegacyDriverRoute(
            route as unknown as Record<string, unknown>,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * How this driver answered the offers they responded to. Counted from the
   * audit trail of accept/reject decisions, so offers that expired unanswered
   * are not part of it. No rate is given until there is a meaningful sample.
   */
  driverRouter.get(
    "/driver/performance",
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const [accepted, rejected] = await Promise.all([
          prisma.auditEvent.count({ where: { user_id: req.user!.id, action: AuditAction.match_accepted } }),
          prisma.auditEvent.count({ where: { user_id: req.user!.id, action: AuditAction.match_rejected } }),
        ]);
        const responded = accepted + rejected;
        res.json({
          offers_responded: responded,
          offers_accepted: accepted,
          acceptance_rate:
            responded >= ACCEPTANCE_RATE_MIN_SAMPLE ? Math.round((accepted / responded) * 100) : null,
          min_sample: ACCEPTANCE_RATE_MIN_SAMPLE,
          request_id: req.requestId,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  driverRouter.get(
    "/driver/routes",
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const routes = await prisma.driverRoute.findMany({
          where: {
            driver: { user_id: req.user!.id },
            canonical_availability_version: null,
            operational_mode: "legacy",
          },
          include: { route_version: routeSummarySelect },
          orderBy: { activated_at: "desc" },
        });
        res.json({
          routes: routes.map((route) =>
            serializeLegacyDriverRoute(
              route as unknown as Record<string, unknown>,
            ),
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  driverRouter.get(
    "/driver/routes/active",
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const routes = await prisma.driverRoute.findMany({
          where: {
            driver: { user_id: req.user!.id },
            status: "active",
            canonical_availability_version: null,
            operational_mode: "legacy",
          },
          include: { route_version: routeSummarySelect },
          orderBy: { activated_at: "desc" },
        });
        res.json({
          routes: routes.map((route) =>
            serializeLegacyDriverRoute(
              route as unknown as Record<string, unknown>,
            ),
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  driverRouter.patch(
    "/driver/routes/:id/deactivate",
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const routeId = routeParam(req.params.id);
        const existing = await prisma.driverRoute.findFirst({
          where: {
            id: routeId,
            driver: { user_id: req.user!.id },
            canonical_availability_version: null,
            operational_mode: "legacy",
          },
        });
        if (!existing) {
          throw new HttpError(404, "route_not_found");
        }
        if (existing.status !== "active") {
          throw new HttpError(409, "route_not_active");
        }

        const route = await prisma.driverRoute.update({
          where: { id: existing.id },
          data: { status: "inactive", completed_at: new Date() },
          include: { route_version: routeSummarySelect },
        });

        await auditEvent(prisma, {
          userId: req.user!.id,
          action: AuditAction.driver_route_deactivated,
          entityType: "DriverRoute",
          entityId: route.id,
        });

        res.json({
          route: serializeLegacyDriverRoute(
            route as unknown as Record<string, unknown>,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return driverRouter;
}

export const driverRouter = createDriverRouter();
