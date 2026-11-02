import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import {
  LEGACY_DEFAULT_ROUTE_KEY,
  driverRoutePlaces,
  resolveOperatingRoute,
  resolveOperatingRouteByKey,
} from "./operatingRoutes.js";

const OPERATION = "legacy_driver_online_state_v1";
const IDEMPOTENCY_TTL_MS = 86_400_000;

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function lockEligibleProfile(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const rows = await tx.$queryRaw<
    Array<{ id: string; verified: number | boolean }>
  >`
    SELECT dp.id, dp.verified
    FROM driver_profiles dp
    INNER JOIN users u ON u.id = dp.user_id
    WHERE dp.user_id = ${userId} AND u.role = 'driver' AND u.account_status = 'active'
    FOR UPDATE
  `;
  const profile = rows[0];
  if (!profile) throw new HttpError(403, "driver_unavailable");
  if (!profile.verified) {
    const verification = await tx.driverVerification.findUnique({ where: { user_id: userId }, select: { status: true } });
    if (verification?.status === "documents_expired") throw new HttpError(403, "driver_documents_expired");
    throw new HttpError(403, "driver_not_approved");
  }
  return profile;
}

async function lockLegacyRoutes(
  tx: Prisma.TransactionClient,
  driverId: string,
) {
  return tx.$queryRaw<
    Array<{
      id: string;
      status: "inactive" | "active" | "assigned" | "on_trip" | "completed";
    }>
  >`
    SELECT id, status
    FROM driver_routes
    WHERE driver_id = ${driverId}
      AND operational_mode = 'legacy'
      AND canonical_availability_version IS NULL
    ORDER BY activated_at DESC, id ASC
    FOR UPDATE
  `;
}

export type LegacyOnlineStateInput = {
  online: boolean;
  expectedRouteId?: string | null;
  /** The predefined route to drive; required to go online without an active route. */
  serviceRouteId?: string;
};

export type LegacyOnlineActor = {
  id: string;
  requestId?: string;
  idempotencyKey: string;
};

export function createLegacyDriverOnlineStateService(
  db: PrismaClient = prisma,
) {
  return {
    async setState(input: LegacyOnlineStateInput, actor: LegacyOnlineActor) {
      return db.$transaction(
        async (tx) => {
          const profile = await lockEligibleProfile(tx, actor.id);
          const requestDigest = digest(
            JSON.stringify({
              actor_id: actor.id,
              online: input.online,
              expected_route_id: input.expectedRouteId ?? null,
              // Only present when sent, so earlier keys keep their digest.
              ...(input.serviceRouteId ? { service_route_id: input.serviceRouteId } : {}),
            }),
          );
          const claim = await claimIdempotency(tx, {
            operation: OPERATION,
            scopeDigest: digest(`${OPERATION}:${actor.id}`),
            keyDigest: digest(actor.idempotencyKey),
            keyVersion: 1,
            requestDigest,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          });
          if (claim.kind === "conflict")
            throw new HttpError(409, "idempotency_conflict");
          if (claim.kind === "in_progress")
            throw new HttpError(409, "idempotency_in_progress");
          if (claim.kind === "failed")
            throw new HttpError(409, "idempotency_failed");
          if (claim.kind === "replay") {
            if (
              claim.record.resource_type !== "DriverRoute" ||
              !claim.record.resource_id
            ) {
              throw new HttpError(409, "idempotency_replay_unavailable");
            }
            return {
              online: input.online,
              routeId: claim.record.resource_id,
              replayed: true,
              changed: false,
            };
          }

          const routes = await lockLegacyRoutes(tx, profile.id);
          const operational = routes.filter(
            (route) =>
              route.status === "active" ||
              route.status === "assigned" ||
              route.status === "on_trip",
          );
          if (operational.length > 1)
            throw new HttpError(409, "legacy_online_state_conflict");
          const current = operational[0];
          let routeId: string;
          let changed = false;

          if (input.online) {
            if (current) {
              // Already online: a different route needs the current one ended first.
              if (input.serviceRouteId) {
                const onRoute = await tx.driverRoute.findFirst({
                  where: { id: current.id, route_version: { is: { service_route_id: input.serviceRouteId } } },
                  select: { id: true },
                });
                if (!onRoute) throw new HttpError(409, "route_already_active");
              }
              routeId = current.id;
            } else {
              // Older app builds name no route: they drive the Hebron → Bethlehem
              // route, like their passenger and merchant bodies.
              const operatingRoute = input.serviceRouteId
                ? await resolveOperatingRoute(tx, input.serviceRouteId)
                : await resolveOperatingRouteByKey(tx, LEGACY_DEFAULT_ROUTE_KEY);
              const route = await tx.driverRoute.create({
                data: {
                  driver_id: profile.id,
                  ...driverRoutePlaces(operatingRoute),
                  seats_available: 1,
                  parcel_capacity_available: 0,
                  status: "active",
                  operational_mode: "legacy",
                  activated_at: new Date(),
                },
              });
              routeId = route.id;
              changed = true;
              await auditEvent(tx, {
                userId: actor.id,
                action: AuditAction.driver_route_created,
                entityType: "DriverRoute",
                entityId: route.id,
                metadata: {
                  transition: "offline_to_online",
                  request_id: actor.requestId,
                },
              });
            }
          } else {
            if (!current) throw new HttpError(409, "driver_already_offline");
            if (input.expectedRouteId !== current.id)
              throw new HttpError(409, "legacy_route_revision_conflict");
            if (current.status !== "active")
              throw new HttpError(409, "route_cannot_deactivate");
            await tx.driverRoute.update({
              where: { id: current.id },
              data: { status: "inactive", completed_at: new Date() },
            });
            routeId = current.id;
            changed = true;
            await auditEvent(tx, {
              userId: actor.id,
              action: AuditAction.driver_route_deactivated,
              entityType: "DriverRoute",
              entityId: current.id,
              metadata: {
                transition: "online_to_offline",
                request_id: actor.requestId,
              },
            });
          }

          await completeIdempotency(tx, {
            recordId: claim.record.id,
            claimVersion: claim.record.claim_version,
            resourceType: "DriverRoute",
            resourceId: routeId,
            responseStatus: 200,
          });
          return { online: input.online, routeId, replayed: false, changed };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    },
  };
}

export type LegacyDriverOnlineStateService = ReturnType<
  typeof createLegacyDriverOnlineStateService
>;
export const legacyDriverOnlineStateService =
  createLegacyDriverOnlineStateService();
