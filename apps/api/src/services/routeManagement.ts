import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";

type Database = PrismaClient | Prisma.TransactionClient;
type Actor = { id: string; requestId?: string; idempotencyKey?: string };

export const ADMIN_ROUTE_VERSION_HISTORY_LIMIT = 50;
const ADMIN_ROUTE_VERSION_STOP_LIMIT = 100;
/**
 * Active service routes the catalogue accepts. It was 5 during the closed
 * beta; the 20 predefined city routes and admin-created operating routes now
 * count too, so the cap only guards against runaway creation.
 */
export const ACTIVE_SERVICE_ROUTE_LIMIT = 200;

export type RouteIdentityInput = {
  routeKey: string;
  routeGroupKey: string;
  serviceRegionKey: string;
  direction: "outbound" | "inbound" | "loop";
};

export type VersionInput = {
  nameAr: string;
  nameEn: string;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  activeFrom?: Date | null;
  activeUntil?: Date | null;
  cloneFromVersionId?: string;
};

export type DraftUpdateInput = Omit<VersionInput, "cloneFromVersionId"> & { expectedRevision: number };

export type VersionStopInput = {
  stopId: string;
  sequence: number;
  passengerPickupAllowed: boolean;
  passengerDropoffAllowed: boolean;
  parcelPickupAllowed: boolean;
  parcelDropoffAllowed: boolean;
  estimatedOffsetSeconds?: number | null;
  dwellSeconds?: number | null;
};

export type StopInput = {
  stopKey: string;
  serviceRegionKey: string;
  nameAr: string;
  nameEn: string;
  latitude: string;
  longitude: string;
};

export type RouteListInput = {
  page: number;
  limit: number;
  search?: string;
  status?: "active" | "retired";
  direction?: "outbound" | "inbound" | "loop";
  serviceRegionKey?: string;
};

export type StopListInput = {
  page: number;
  limit: number;
  search?: string;
  status?: "active" | "retired";
  serviceRegionKey?: string;
};

const versionRelations = {
  origin_stop: true,
  destination_stop: true,
  stops: { include: { stop: true }, orderBy: { sequence: "asc" as const }, take: ADMIN_ROUTE_VERSION_STOP_LIMIT },
  _count: { select: { driver_routes: true, stops: true } }
};

const routeRelations = {
  current_version: { include: versionRelations },
  versions: {
    include: versionRelations,
    orderBy: [{ version_number: "desc" as const }, { id: "desc" as const }],
    take: ADMIN_ROUTE_VERSION_HISTORY_LIMIT
  },
  _count: { select: { versions: true } }
};

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requestDigest(value: unknown) {
  return digest(JSON.stringify(value));
}

export function assertExpectedCurrentVersion(actual: string | null, expected: string | null) {
  if (actual !== expected) throw new HttpError(409, "current_version_conflict");
}

async function claimWrite(tx: Database, operation: string, actor: Actor, payload: unknown) {
  if (!actor.idempotencyKey) throw new HttpError(400, "idempotency_key_required");
  const claim = await claimIdempotency(tx, {
    operation,
    scopeDigest: digest(`route-admin:${actor.id}`),
    keyDigest: digest(actor.idempotencyKey),
    keyVersion: 1,
    requestDigest: requestDigest(payload),
    expiresAt: new Date(Date.now() + 86_400_000)
  });
  if (claim.kind === "conflict") throw new HttpError(409, "idempotency_conflict");
  if (claim.kind === "in_progress") throw new HttpError(409, "idempotency_in_progress");
  if (claim.kind === "failed") throw new HttpError(409, "idempotency_failed");
  return claim;
}

async function completeWrite(
  tx: Database,
  claim: Awaited<ReturnType<typeof claimWrite>>,
  resourceType: string,
  resourceId: string,
  responseStatus: number
) {
  if (claim.kind !== "claimed") return;
  await completeIdempotency(tx, {
    recordId: claim.record.id,
    claimVersion: claim.record.claim_version,
    resourceType,
    resourceId,
    responseStatus
  });
}

function auditMetadata(actor: Actor, metadata: Record<string, string | number | null | undefined> = {}) {
  return {
    request_id: actor.requestId,
    ...Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined))
  };
}

async function lockRoute(tx: Prisma.TransactionClient, routeId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: "active" | "retired"; current_version_id: string | null }>>`
    SELECT id, status, current_version_id FROM service_routes WHERE id = ${routeId} FOR UPDATE
  `;
  if (rows.length !== 1) throw new HttpError(404, "service_route_not_found");
  return rows[0];
}

async function lockVersion(tx: Prisma.TransactionClient, versionId: string) {
  const rows = await tx.$queryRaw<Array<{
    id: string;
    service_route_id: string;
    status: "draft" | "published" | "paused" | "retired";
    draft_revision: number;
  }>>`
    SELECT id, service_route_id, status, draft_revision
    FROM service_route_versions WHERE id = ${versionId} FOR UPDATE
  `;
  if (rows.length !== 1) throw new HttpError(404, "route_version_not_found");
  return rows[0];
}

async function lockStops(tx: Prisma.TransactionClient, stopIds: string[]) {
  const ids = [...new Set(stopIds)].sort();
  if (ids.length === 0) return [];
  return tx.$queryRaw<Array<{ id: string; status: "active" | "retired"; service_region_key: string }>>(
    Prisma.sql`
      SELECT id, status, service_region_key
      FROM stops
      WHERE id IN (${Prisma.join(ids)})
      ORDER BY id
      FOR UPDATE
    `
  );
}

function isTransactionWriteConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2034");
}

async function serializableRouteEnvelope<T>(
  database: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await database.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
    } catch (error) {
      if (!isTransactionWriteConflict(error) || attempt === 4) throw error;
    }
  }
  throw new HttpError(409, "route_envelope_conflict");
}

function validateDateRange(activeFrom?: Date | null, activeUntil?: Date | null) {
  if (activeFrom && activeUntil && activeUntil <= activeFrom) throw new HttpError(400, "invalid_active_date_range");
}

function assertStopLimit(count: number) {
  if (count > ADMIN_ROUTE_VERSION_STOP_LIMIT) throw new HttpError(409, "route_version_stop_limit_exceeded");
}
function validateStopSequence(stops: VersionStopInput[]) {
  assertStopLimit(stops.length);
  if (stops.length < 2) throw new HttpError(400, "route_requires_two_stops");
  const stopIds = new Set<string>();
  for (const [index, stop] of stops.entries()) {
    if (stop.sequence !== index + 1) throw new HttpError(400, "invalid_stop_sequence");
    if (stopIds.has(stop.stopId)) throw new HttpError(400, "duplicate_route_stop");
    stopIds.add(stop.stopId);
  }
}

function validatePublication(version: {
  name_ar: string;
  name_en: string;
  origin_stop_id: string | null;
  destination_stop_id: string | null;
  active_from: Date | null;
  active_until: Date | null;
  stops: Array<{
    sequence: number;
    stop_id: string;
    stop: { status: string };
    passenger_pickup: boolean;
    passenger_dropoff: boolean;
    parcel_pickup: boolean;
    parcel_dropoff: boolean;
  }>;
}) {
  if (!version.name_ar.trim() || !version.name_en.trim()) throw new HttpError(400, "bilingual_names_required");
  validateDateRange(version.active_from, version.active_until);
  if (version.stops.length < 2) throw new HttpError(400, "route_requires_two_stops");
  for (const [index, membership] of version.stops.entries()) {
    if (membership.sequence !== index + 1) throw new HttpError(400, "invalid_stop_sequence");
    if (membership.stop.status !== "active") throw new HttpError(409, "route_contains_inactive_stop");
  }
  const first = version.stops[0];
  const last = version.stops[version.stops.length - 1];
  if (!version.origin_stop_id || first.stop_id !== version.origin_stop_id) throw new HttpError(400, "origin_stop_mismatch");
  if (!version.destination_stop_id || last.stop_id !== version.destination_stop_id) {
    throw new HttpError(400, "destination_stop_mismatch");
  }
  if (version.origin_stop_id === version.destination_stop_id) throw new HttpError(400, "identical_route_endpoints");
  const passengerValid = version.stops.some(
    (pickup, pickupIndex) =>
      pickup.passenger_pickup &&
      version.stops.some((dropoff, dropoffIndex) => dropoffIndex > pickupIndex && dropoff.passenger_dropoff)
  );
  if (!passengerValid) throw new HttpError(400, "invalid_passenger_permissions");
  const parcelPickup = version.stops.some((stop) => stop.parcel_pickup);
  const parcelDropoff = version.stops.some((stop) => stop.parcel_dropoff);
  const parcelValid = version.stops.some(
    (pickup, pickupIndex) =>
      pickup.parcel_pickup &&
      version.stops.some((dropoff, dropoffIndex) => dropoffIndex > pickupIndex && dropoff.parcel_dropoff)
  );
  if ((parcelPickup || parcelDropoff) && !parcelValid) throw new HttpError(400, "invalid_parcel_permissions");
}

function versionData(input: Omit<VersionInput, "cloneFromVersionId">) {
  validateDateRange(input.activeFrom, input.activeUntil);
  return {
    name_ar: input.nameAr,
    name_en: input.nameEn,
    description_ar: input.descriptionAr ?? null,
    description_en: input.descriptionEn ?? null,
    active_from: input.activeFrom ?? null,
    active_until: input.activeUntil ?? null
  };
}

async function replayResource<T>(
  claim: Awaited<ReturnType<typeof claimWrite>>,
  resourceType: string,
  loader: (id: string) => Promise<T | null>
) {
  if (claim.kind !== "replay") return null;
  if (claim.record.resource_type !== resourceType || !claim.record.resource_id) {
    throw new HttpError(409, "idempotency_replay_unavailable");
  }
  const resource = await loader(claim.record.resource_id);
  if (!resource) throw new HttpError(409, "idempotency_replay_unavailable");
  return resource;
}

export function createRouteManagementService(
  db: PrismaClient = prisma,
  options: { activeRouteLimit?: number } = {}
) {
  const activeRouteLimit = options.activeRouteLimit ?? ACTIVE_SERVICE_ROUTE_LIMIT;
  return {
    async listAdminRoutes(input: RouteListInput) {
      const where: Prisma.ServiceRouteWhereInput = {
        ...(input.status ? { status: input.status } : {}),
        ...(input.direction ? { direction: input.direction } : {}),
        ...(input.serviceRegionKey ? { service_region_key: input.serviceRegionKey } : {}),
        ...(input.search
          ? {
              OR: [
                { route_key: { contains: input.search } },
                { route_group_key: { contains: input.search } },
                { current_version: { is: { OR: [{ name_ar: { contains: input.search } }, { name_en: { contains: input.search } }] } } }
              ]
            }
          : {})
      };
      const [routes, total] = await Promise.all([
        db.serviceRoute.findMany({
          where,
          include: { current_version: { include: versionRelations }, _count: { select: { versions: true } } },
          orderBy: [{ updated_at: "desc" }, { id: "desc" }],
          skip: (input.page - 1) * input.limit,
          take: input.limit
        }),
        db.serviceRoute.count({ where })
      ]);
      return { routes, total, page: input.page, limit: input.limit };
    },

    async getAdminRoute(id: string) {
      const route = await db.serviceRoute.findUnique({ where: { id }, include: routeRelations });
      if (!route) throw new HttpError(404, "service_route_not_found");
      for (const version of [route.current_version, ...route.versions]) {
        if (version) assertStopLimit(version._count.stops);
      }
      return route;
    },

    async createRoute(input: RouteIdentityInput, actor: Actor) {
      return serializableRouteEnvelope(db, async (tx) => {
        const claim = await claimWrite(tx, "route_create", actor, input);
        const replay = await replayResource(claim, "ServiceRoute", (id) =>
          tx.serviceRoute.findUnique({ where: { id }, include: routeRelations })
        );
        if (replay) return { resource: replay, replayed: true };
        const activeCount = await tx.serviceRoute.count({ where: { status: "active" } });
        if (activeCount >= activeRouteLimit) throw new HttpError(409, "beta_route_limit_reached");
        const route = await tx.serviceRoute.create({
          data: {
            route_key: input.routeKey,
            route_group_key: input.routeGroupKey,
            service_region_key: input.serviceRegionKey,
            direction: input.direction,
            created_by_user_id: actor.id
          },
          include: routeRelations
        });
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.route_created,
          entityType: "ServiceRoute",
          entityId: route.id,
          metadata: auditMetadata(actor, { direction: route.direction })
        });
        await completeWrite(tx, claim, "ServiceRoute", route.id, 201);
        return { resource: route, replayed: false };
      });
    },

    async createVersion(routeId: string, input: VersionInput, actor: Actor) {
      return db.$transaction(async (tx) => {
        const claim = await claimWrite(tx, "route_version_create", actor, { routeId, ...input });
        const replay = await replayResource(claim, "ServiceRouteVersion", (id) =>
          tx.serviceRouteVersion.findUnique({ where: { id }, include: versionRelations })
        );
        if (replay) return { resource: replay, replayed: true };
        await lockRoute(tx, routeId);
        const route = await tx.serviceRoute.findUnique({ where: { id: routeId } });
        if (!route) throw new HttpError(404, "service_route_not_found");
        if (route.status !== "active") throw new HttpError(409, "service_route_retired");
        const latest = await tx.serviceRouteVersion.findFirst({
          where: { service_route_id: routeId },
          orderBy: { version_number: "desc" }
        });
        const clone = input.cloneFromVersionId
          ? await tx.serviceRouteVersion.findFirst({
              where: { id: input.cloneFromVersionId, service_route_id: routeId, status: { not: "draft" } },
              include: { stops: { orderBy: { sequence: "asc" } } }
            })
          : null;
        if (input.cloneFromVersionId && !clone) throw new HttpError(404, "clone_source_not_found");
        if (clone) {
          assertStopLimit(clone.stops.length);
          const cloneStops = await lockStops(tx, clone.stops.map((membership) => membership.stop_id));
          if (cloneStops.length !== clone.stops.length || cloneStops.some((stop) => stop.status !== "active")) {
            throw new HttpError(409, "clone_contains_inactive_stop");
          }
          if (cloneStops.some((stop) => stop.service_region_key !== route.service_region_key)) {
            throw new HttpError(409, "clone_contains_foreign_region_stop");
          }
        }
        const data = clone
          ? {
              name_ar: clone.name_ar,
              name_en: clone.name_en,
              description_ar: clone.description_ar,
              description_en: clone.description_en,
              origin_stop_id: clone.origin_stop_id,
              destination_stop_id: clone.destination_stop_id,
              active_from: clone.active_from,
              active_until: clone.active_until
            }
          : versionData(input);
        const created = await tx.serviceRouteVersion.create({
          data: {
            service_route_id: routeId,
            version_number: (latest?.version_number ?? 0) + 1,
            ...data,
            created_by_user_id: actor.id
          }
        });
        if (clone) {
          await tx.routeVersionStop.createMany({
            data: clone.stops.map((membership) => ({
              service_route_version_id: created.id,
              stop_id: membership.stop_id,
              sequence: membership.sequence,
              passenger_pickup: membership.passenger_pickup,
              passenger_dropoff: membership.passenger_dropoff,
              parcel_pickup: membership.parcel_pickup,
              parcel_dropoff: membership.parcel_dropoff,
              distance_from_origin_meters: membership.distance_from_origin_meters,
              scheduled_offset_seconds: membership.scheduled_offset_seconds,
              dwell_seconds: membership.dwell_seconds
            }))
          });
        }
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.route_version_created,
          entityType: "ServiceRouteVersion",
          entityId: created.id,
          metadata: auditMetadata(actor, {
            route_id: routeId,
            version_number: created.version_number,
            transition: clone ? "cloned_to_draft" : "created_draft"
          })
        });
        await completeWrite(tx, claim, "ServiceRouteVersion", created.id, 201);
        const resource = await tx.serviceRouteVersion.findUniqueOrThrow({ where: { id: created.id }, include: versionRelations });
        return { resource, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    },

    async getAdminVersion(id: string) {
      const version = await db.serviceRouteVersion.findUnique({ where: { id }, include: versionRelations });
      if (!version) throw new HttpError(404, "route_version_not_found");
      assertStopLimit(version._count.stops);
      return version;
    },

    async updateDraft(id: string, input: DraftUpdateInput, actor: Actor) {
      validateDateRange(input.activeFrom, input.activeUntil);
      return db.$transaction(async (tx) => {
        assertStopLimit(await tx.routeVersionStop.count({ where: { service_route_version_id: id } }));
        const updated = await tx.serviceRouteVersion.updateMany({
          where: { id, status: "draft", draft_revision: input.expectedRevision },
          data: { ...versionData(input), draft_revision: { increment: 1 } }
        });
        if (updated.count !== 1) {
          const current = await tx.serviceRouteVersion.findUnique({ where: { id }, select: { status: true } });
          if (!current) throw new HttpError(404, "route_version_not_found");
          if (current.status !== "draft") throw new HttpError(409, "published_version_immutable");
          throw new HttpError(409, "draft_revision_conflict");
        }
        const version = await tx.serviceRouteVersion.findUniqueOrThrow({ where: { id }, include: versionRelations });
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.route_draft_updated,
          entityType: "ServiceRouteVersion",
          entityId: id,
          metadata: auditMetadata(actor, { revision: version.draft_revision })
        });
        return version;
      });
    },

    async replaceStops(id: string, expectedRevision: number, stops: VersionStopInput[], actor: Actor) {
      validateStopSequence(stops);
      return db.$transaction(async (tx) => {
        await lockVersion(tx, id);
        const version = await tx.serviceRouteVersion.findUnique({ where: { id } });
        if (!version) throw new HttpError(404, "route_version_not_found");
        if (version.status !== "draft") throw new HttpError(409, "published_version_immutable");
        if (version.draft_revision !== expectedRevision) throw new HttpError(409, "draft_revision_conflict");
        assertStopLimit(await tx.routeVersionStop.count({ where: { service_route_version_id: id } }));
        const lockedStops = await lockStops(tx, stops.map((stop) => stop.stopId));
        if (lockedStops.length !== stops.length || lockedStops.some((stop) => stop.status !== "active")) {
          throw new HttpError(400, "invalid_or_inactive_stop");
        }
        const route = await tx.serviceRoute.findUnique({
          where: { id: version.service_route_id },
          select: { service_region_key: true }
        });
        if (!route) throw new HttpError(404, "service_route_not_found");
        if (lockedStops.some((stop) => stop.service_region_key !== route.service_region_key)) {
          throw new HttpError(400, "stop_region_mismatch");
        }
        await tx.routeVersionStop.deleteMany({ where: { service_route_version_id: id } });
        await tx.routeVersionStop.createMany({
          data: stops.map((stop) => ({
            service_route_version_id: id,
            stop_id: stop.stopId,
            sequence: stop.sequence,
            passenger_pickup: stop.passengerPickupAllowed,
            passenger_dropoff: stop.passengerDropoffAllowed,
            parcel_pickup: stop.parcelPickupAllowed,
            parcel_dropoff: stop.parcelDropoffAllowed,
            scheduled_offset_seconds: stop.estimatedOffsetSeconds ?? null,
            dwell_seconds: stop.dwellSeconds ?? null
          }))
        });
        const revision = await tx.serviceRouteVersion.updateMany({
          where: { id, status: "draft", draft_revision: expectedRevision },
          data: {
            origin_stop_id: stops[0].stopId,
            destination_stop_id: stops[stops.length - 1].stopId,
            encoded_geometry: null,
            geometry_encoding: null,
            geometry_provider: null,
            geometry_checksum: null,
            geometry_precision: null,
            estimated_distance_meters: null,
            estimated_duration_seconds: null,
            geometry_status: "pending",
            draft_revision: { increment: 1 }
          }
        });
        if (revision.count !== 1) throw new HttpError(409, "draft_revision_conflict");
        const resource = await tx.serviceRouteVersion.findUniqueOrThrow({ where: { id }, include: versionRelations });
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.route_stops_updated,
          entityType: "ServiceRouteVersion",
          entityId: id,
          metadata: auditMetadata(actor, { revision: resource.draft_revision, stop_count: stops.length })
        });
        return resource;
      });
    },

    async publishVersion(
      id: string,
      input: { expectedRevision: number; expectedCurrentVersionId: string | null },
      actor: Actor
    ) {
      return db.$transaction(async (tx) => {
        const claim = await claimWrite(tx, "route_version_publish", actor, { id, ...input });
        const replay = await replayResource(claim, "ServiceRouteVersion", (resourceId) =>
          tx.serviceRouteVersion.findUnique({ where: { id: resourceId }, include: versionRelations })
        );
        if (replay) return { resource: replay, replayed: true };
        const draftLookup = await tx.serviceRouteVersion.findUnique({ where: { id }, select: { service_route_id: true } });
        if (!draftLookup) throw new HttpError(404, "route_version_not_found");
        const route = await lockRoute(tx, draftLookup.service_route_id);
        await lockVersion(tx, id);
        const memberships = await tx.routeVersionStop.findMany({
          where: { service_route_version_id: id },
          select: { stop_id: true }
        });
        assertStopLimit(memberships.length);
        await lockStops(tx, memberships.map((membership) => membership.stop_id));
        if (route.status !== "active") throw new HttpError(409, "service_route_retired");
        assertExpectedCurrentVersion(route.current_version_id, input.expectedCurrentVersionId);
        const draft = await tx.serviceRouteVersion.findUnique({ where: { id }, include: versionRelations });
        if (!draft) throw new HttpError(404, "route_version_not_found");
        if (draft.status !== "draft") throw new HttpError(409, "published_version_immutable");
        if (draft.draft_revision !== input.expectedRevision) throw new HttpError(409, "draft_revision_conflict");
        validatePublication(draft);
        const now = new Date();
        if (route.current_version_id) {
          const prior = await tx.serviceRouteVersion.findUnique({ where: { id: route.current_version_id } });
          if (prior?.status === "published") {
            await tx.serviceRouteVersion.update({
              where: { id: prior.id },
              data: { status: "paused", paused_at: now, paused_by_user_id: actor.id, pause_reason: "superseded_by_new_version" }
            });
          }
        }
        await tx.serviceRouteVersion.update({
          where: { id },
          data: { status: "published", published_at: now, published_by_user_id: actor.id }
        });
        await tx.serviceRoute.update({ where: { id: route.id }, data: { current_version_id: id } });
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.route_version_published,
          entityType: "ServiceRouteVersion",
          entityId: id,
          metadata: auditMetadata(actor, {
            route_id: route.id,
            revision: draft.draft_revision,
            transition: "draft_to_published"
          })
        });
        await completeWrite(tx, claim, "ServiceRouteVersion", id, 200);
        const resource = await tx.serviceRouteVersion.findUniqueOrThrow({ where: { id }, include: versionRelations });
        return { resource, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    },

    async pauseVersion(id: string, input: { reason: string; expectedCurrentVersionId: string | null }, actor: Actor) {
      return db.$transaction(async (tx) => {
        const claim = await claimWrite(tx, "route_version_pause", actor, { id, ...input });
        const replay = await replayResource(claim, "ServiceRouteVersion", (resourceId) =>
          tx.serviceRouteVersion.findUnique({ where: { id: resourceId }, include: versionRelations })
        );
        if (replay) return { resource: replay, replayed: true };
        const version = await tx.serviceRouteVersion.findUnique({ where: { id } });
        if (!version) throw new HttpError(404, "route_version_not_found");
        const route = await lockRoute(tx, version.service_route_id);
        const lockedVersion = await lockVersion(tx, id);
        assertExpectedCurrentVersion(route.current_version_id, input.expectedCurrentVersionId);
        assertExpectedCurrentVersion(id, input.expectedCurrentVersionId);
        if (lockedVersion.status !== "published") throw new HttpError(409, "route_version_not_pausable");
        const resource = await tx.serviceRouteVersion.update({
          where: { id },
          data: { status: "paused", paused_at: new Date(), paused_by_user_id: actor.id, pause_reason: input.reason },
          include: versionRelations
        });
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.route_version_paused,
          entityType: "ServiceRouteVersion",
          entityId: id,
          metadata: auditMetadata(actor, { transition: "published_to_paused", reason_code: "admin_pause" })
        });
        await completeWrite(tx, claim, "ServiceRouteVersion", id, 200);
        return { resource, replayed: false };
      });
    },

    async resumeVersion(id: string, input: { expectedCurrentVersionId: string | null }, actor: Actor) {
      return db.$transaction(async (tx) => {
        const claim = await claimWrite(tx, "route_version_resume", actor, { id, ...input });
        const replay = await replayResource(claim, "ServiceRouteVersion", (resourceId) =>
          tx.serviceRouteVersion.findUnique({ where: { id: resourceId }, include: versionRelations })
        );
        if (replay) return { resource: replay, replayed: true };
        const version = await tx.serviceRouteVersion.findUnique({ where: { id } });
        if (!version) throw new HttpError(404, "route_version_not_found");
        const route = await lockRoute(tx, version.service_route_id);
        const lockedVersion = await lockVersion(tx, id);
        assertExpectedCurrentVersion(route.current_version_id, input.expectedCurrentVersionId);
        assertExpectedCurrentVersion(id, input.expectedCurrentVersionId);
        if (route.status !== "active" || lockedVersion.status !== "paused") {
          throw new HttpError(409, "route_version_not_resumable");
        }
        validateDateRange(version.active_from, version.active_until);
        if (version.active_until && version.active_until <= new Date()) throw new HttpError(409, "route_version_expired");
        const resource = await tx.serviceRouteVersion.update({
          where: { id },
          data: { status: "published", paused_at: null, paused_by_user_id: null, pause_reason: null },
          include: versionRelations
        });
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.route_version_resumed,
          entityType: "ServiceRouteVersion",
          entityId: id,
          metadata: auditMetadata(actor, { transition: "paused_to_published" })
        });
        await completeWrite(tx, claim, "ServiceRouteVersion", id, 200);
        return { resource, replayed: false };
      });
    },

    async retireVersion(id: string, input: { reason: string; expectedCurrentVersionId: string | null }, actor: Actor) {
      return db.$transaction(async (tx) => {
        const claim = await claimWrite(tx, "route_version_retire", actor, { id, ...input });
        const replay = await replayResource(claim, "ServiceRouteVersion", (resourceId) =>
          tx.serviceRouteVersion.findUnique({ where: { id: resourceId }, include: versionRelations })
        );
        if (replay) return { resource: replay, replayed: true };
        const version = await tx.serviceRouteVersion.findUnique({ where: { id } });
        if (!version) throw new HttpError(404, "route_version_not_found");
        const lockedRoute = await lockRoute(tx, version.service_route_id);
        const lockedVersion = await lockVersion(tx, id);
        assertExpectedCurrentVersion(lockedRoute.current_version_id, input.expectedCurrentVersionId);
        if (lockedVersion.status === "retired") throw new HttpError(409, "route_version_already_retired");
        const activeUsage = await tx.driverRoute.count({
          where: {
            route_version_id: id,
            OR: [
              { availability_status: { in: ["active", "paused", "filled", "departed"] } },
              { trips: { some: { status: { notIn: ["completed", "cancelled"] } } } }
            ]
          }
        });
        if (activeUsage > 0) throw new HttpError(409, "route_version_has_active_usage");
        const now = new Date();
        if (lockedRoute.current_version_id === id) {
          await tx.serviceRoute.update({ where: { id: lockedRoute.id }, data: { current_version_id: null } });
        }
        const resource = await tx.serviceRouteVersion.update({
          where: { id },
          data: { status: "retired", retired_at: now, retired_by_user_id: actor.id, retirement_reason: input.reason },
          include: versionRelations
        });
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.route_version_retired,
          entityType: "ServiceRouteVersion",
          entityId: id,
          metadata: auditMetadata(actor, { transition: `${lockedVersion.status}_to_retired`, reason_code: "admin_retire" })
        });
        await completeWrite(tx, claim, "ServiceRouteVersion", id, 200);
        return { resource, replayed: false };
      });
    },

    async retireRoute(id: string, input: { reason: string; expectedCurrentVersionId: null }, actor: Actor) {
      return db.$transaction(async (tx) => {
        const claim = await claimWrite(tx, "service_route_retire", actor, { id, ...input });
        const replay = await replayResource(claim, "ServiceRoute", (resourceId) =>
          tx.serviceRoute.findUnique({ where: { id: resourceId }, include: routeRelations })
        );
        if (replay) return { resource: replay, replayed: true };
        const lockedRoute = await lockRoute(tx, id);
        assertExpectedCurrentVersion(input.expectedCurrentVersionId, null);
        assertExpectedCurrentVersion(lockedRoute.current_version_id, null);
        const route = await tx.serviceRoute.findUnique({ where: { id }, include: { versions: true } });
        if (!route) throw new HttpError(404, "service_route_not_found");
        if (route.status === "retired") throw new HttpError(409, "service_route_already_retired");
        if (route.current_version_id || route.versions.some((version) => version.status !== "retired")) {
          throw new HttpError(409, "service_route_versions_not_retired");
        }
        const activeUsage = await tx.driverRoute.count({
          where: {
            route_version: { service_route_id: id },
            OR: [
              { availability_status: { in: ["active", "paused", "filled", "departed"] } },
              { trips: { some: { status: { notIn: ["completed", "cancelled"] } } } }
            ]
          }
        });
        if (activeUsage > 0) throw new HttpError(409, "service_route_has_active_usage");
        const resource = await tx.serviceRoute.update({
          where: { id },
          data: { status: "retired", retired_at: new Date(), retired_by_user_id: actor.id, retirement_reason: input.reason },
          include: routeRelations
        });
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.route_retired,
          entityType: "ServiceRoute",
          entityId: id,
          metadata: auditMetadata(actor, { transition: "active_to_retired", reason_code: "admin_retire" })
        });
        await completeWrite(tx, claim, "ServiceRoute", id, 200);
        return { resource, replayed: false };
      });
    },

    async listStops(input: StopListInput) {
      const where: Prisma.StopWhereInput = {
        ...(input.status ? { status: input.status } : {}),
        ...(input.serviceRegionKey ? { service_region_key: input.serviceRegionKey } : {}),
        ...(input.search
          ? { OR: [{ stop_key: { contains: input.search } }, { name_ar: { contains: input.search } }, { name_en: { contains: input.search } }] }
          : {})
      };
      const [stops, total] = await Promise.all([
        db.stop.findMany({
          where,
          orderBy: [{ updated_at: "desc" }, { id: "desc" }],
          skip: (input.page - 1) * input.limit,
          take: input.limit
        }),
        db.stop.count({ where })
      ]);
      return { stops, total, page: input.page, limit: input.limit };
    },

    async createStop(input: StopInput, actor: Actor) {
      return db.$transaction(async (tx) => {
        const claim = await claimWrite(tx, "stop_create", actor, input);
        const replay = await replayResource(claim, "Stop", (id) => tx.stop.findUnique({ where: { id } }));
        if (replay) return { resource: replay, replayed: true };
        const stop = await tx.stop.create({
          data: {
            stop_key: input.stopKey,
            service_region_key: input.serviceRegionKey,
            name_ar: input.nameAr,
            name_en: input.nameEn,
            latitude: input.latitude,
            longitude: input.longitude,
            created_by_user_id: actor.id
          }
        });
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.stop_created,
          entityType: "Stop",
          entityId: stop.id,
          metadata: auditMetadata(actor)
        });
        await completeWrite(tx, claim, "Stop", stop.id, 201);
        return { resource: stop, replayed: false };
      });
    },

    async updateStop(id: string, input: Omit<StopInput, "stopKey">, actor: Actor) {
      return db.$transaction(async (tx) => {
        const [stop] = await lockStops(tx, [id]);
        if (!stop) throw new HttpError(404, "stop_not_found");
        if (stop.status !== "active") throw new HttpError(409, "stop_retired");
        const membership = await tx.routeVersionStop.findFirst({ where: { stop_id: id }, select: { id: true } });
        if (membership) throw new HttpError(409, "used_stop_immutable");
        const resource = await tx.stop.update({
          where: { id },
          data: {
            service_region_key: input.serviceRegionKey,
            name_ar: input.nameAr,
            name_en: input.nameEn,
            latitude: input.latitude,
            longitude: input.longitude
          }
        });
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.stop_updated,
          entityType: "Stop",
          entityId: id,
          metadata: auditMetadata(actor)
        });
        return resource;
      });
    },

    async retireStop(id: string, reason: string, actor: Actor) {
      return db.$transaction(async (tx) => {
        const claim = await claimWrite(tx, "stop_retire", actor, { id, reason });
        const replay = await replayResource(claim, "Stop", (resourceId) => tx.stop.findUnique({ where: { id: resourceId } }));
        if (replay) return { resource: replay, replayed: true };
        const [current] = await lockStops(tx, [id]);
        if (!current) throw new HttpError(404, "stop_not_found");
        if (current.status === "retired") throw new HttpError(409, "stop_already_retired");
        const resource = await tx.stop.update({
          where: { id },
          data: { status: "retired", retired_at: new Date(), retired_by_user_id: actor.id, retirement_reason: reason }
        });
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.stop_retired,
          entityType: "Stop",
          entityId: id,
          metadata: auditMetadata(actor, { transition: "active_to_retired", reason_code: "admin_retire" })
        });
        await completeWrite(tx, claim, "Stop", id, 200);
        return { resource, replayed: false };
      });
    },

    async listPublishedRoutes(page: number, limit: number) {
      const where: Prisma.ServiceRouteWhereInput = {
        status: "active",
        current_version: { is: { status: { in: ["published", "paused"] } } }
      };
      const [routes, total] = await Promise.all([
        db.serviceRoute.findMany({
          where,
          include: { current_version: { include: versionRelations } },
          orderBy: [{ updated_at: "desc" }, { id: "desc" }],
          skip: (page - 1) * limit,
          take: limit
        }),
        db.serviceRoute.count({ where })
      ]);
      return { routes, total, page, limit };
    },

    async getPublishedRoute(id: string) {
      const route = await db.serviceRoute.findFirst({
        where: { id, status: "active", current_version: { is: { status: { in: ["published", "paused"] } } } },
        include: { current_version: { include: versionRelations } }
      });
      if (!route) throw new HttpError(404, "route_not_found");
      return route;
    },

    async getPublishedVersionStops(id: string) {
      const version = await db.serviceRouteVersion.findFirst({
        where: { id, status: { in: ["published", "paused"] }, service_route: { status: "active", current_version_id: id } },
        include: { stops: { include: { stop: true }, orderBy: { sequence: "asc" } } }
      });
      if (!version) throw new HttpError(404, "route_version_not_found");
      return version;
    }
  };
}

export type RouteManagementService = ReturnType<typeof createRouteManagementService>;
export const routeManagementService = createRouteManagementService();
