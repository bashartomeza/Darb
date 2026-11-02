import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { RouteManagementService, VersionStopInput } from "../services/routeManagement.js";

const ROUTE_QA_DATABASE = "darb_routes_qa";
const ROUTE_QA_HOSTS = new Set(["localhost", "127.0.0.1"]);
const FIXTURE_PREFIX = "qa-card6-";
const QA_ACTOR_ID = `${FIXTURE_PREFIX}admin`;
const QA_REGION = `${FIXTURE_PREFIX}region`;

const stopKeys = {
  active: `${FIXTURE_PREFIX}a-active-stop`,
  retired: `${FIXTURE_PREFIX}b-retired-stop`,
  middle: `${FIXTURE_PREFIX}shared-middle-stop`,
  destination: `${FIXTURE_PREFIX}shared-destination-stop`
} as const;

const routeKeys = {
  empty: `${FIXTURE_PREFIX}c-empty-route`,
  draft: `${FIXTURE_PREFIX}d-draft-route`,
  invalid: `${FIXTURE_PREFIX}e-invalid-route`,
  current: `${FIXTURE_PREFIX}f-current-route`,
  paused: `${FIXTURE_PREFIX}g-paused-route`,
  retired: `${FIXTURE_PREFIX}l-retired-route`
} as const;

type RouteQaMembershipSnapshot = {
  stopId: string;
  sequence: number;
  passengerPickup: boolean;
  passengerDropoff: boolean;
  parcelPickup: boolean;
  parcelDropoff: boolean;
  distanceFromOriginMeters: number | null;
  scheduledOffsetSeconds: number | null;
  dwellSeconds: number | null;
  createdAtPresent: boolean;
};

type RouteQaVersionSnapshot = {
  id: string;
  versionNumber: number;
  status: "draft" | "published" | "paused" | "retired";
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  originStopId: string | null;
  destinationStopId: string | null;
  activeFrom: string | null;
  activeUntil: string | null;
  encodedGeometry: string | null;
  geometryEncoding: string | null;
  geometryProvider: string | null;
  geometryChecksum: string | null;
  geometryPrecision: number | null;
  estimatedDistanceMeters: number | null;
  estimatedDurationSeconds: number | null;
  geometryStatus: "pending" | "available" | "unavailable";
  draftRevision: number;
  createdByUserId: string;
  publishedByUserId: string | null;
  pausedByUserId: string | null;
  retiredByUserId: string | null;
  publishedAtPresent: boolean;
  pausedAtPresent: boolean;
  retiredAtPresent: boolean;
  pauseReason: string | null;
  retirementReason: string | null;
  createdAtPresent: boolean;
  updatedAtPresent: boolean;
  stops: RouteQaMembershipSnapshot[];
};

export type RouteQaFixtureSnapshot = {
  actor: {
    id: string;
    role: string;
    accountStatus: string;
    demoAccount: boolean;
    hasPasswordHash: boolean;
  } | null;
  stops: Array<{
    id: string;
    stopKey: string;
    serviceRegionKey: string;
    nameAr: string;
    nameEn: string;
    latitude: string;
    longitude: string;
    status: "active" | "retired";
  }>;
  routes: Array<{
    id: string;
    routeKey: string;
    routeGroupKey: string;
    serviceRegionKey: string;
    direction: "outbound" | "inbound" | "loop";
    status: "active" | "retired";
    currentVersionId: string | null;
    versions: RouteQaVersionSnapshot[];
  }>;
};

export function assertRouteQaDatabase(databaseUrl: string) {
  if (databaseUrl.includes("?") || databaseUrl.includes("#")) {
    throw new Error("route_qa_database_guard_rejected");
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("route_qa_database_guard_rejected");
  }

  if (
    parsed.protocol !== "mysql:" ||
    !ROUTE_QA_HOSTS.has(parsed.hostname) ||
    parsed.pathname !== `/${ROUTE_QA_DATABASE}` ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("route_qa_database_guard_rejected");
  }
}

export function requireRouteQaAdminPassword(value: string | undefined) {
  if (!value || value.length < 12) throw new Error("route_qa_admin_password_required");
  return value;
}

export async function assertRouteQaAdminPassword(password: string, passwordHash: string) {
  const { compare } = await import("bcryptjs");
  if (!(await compare(password, passwordHash))) throw new Error("route_qa_admin_password_mismatch");
}

function actor(operation: string) {
  return {
    id: QA_ACTOR_ID,
    requestId: `${FIXTURE_PREFIX}${operation}`,
    idempotencyKey: `${FIXTURE_PREFIX}${operation}`
  };
}

function memberships(stopIds: string[], parcelEnabled: boolean): VersionStopInput[] {
  return stopIds.map((stopId, index) => ({
    stopId,
    sequence: index + 1,
    passengerPickupAllowed: index < stopIds.length - 1,
    passengerDropoffAllowed: index > 0,
    parcelPickupAllowed: parcelEnabled && index < stopIds.length - 1,
    parcelDropoffAllowed: parcelEnabled && index > 0,
    estimatedOffsetSeconds: index * 600,
    dwellSeconds: index === 0 || index === stopIds.length - 1 ? 60 : 120
  }));
}

function assertReady(condition: unknown, scenario: string): asserts condition {
  if (!condition) throw new Error(`route_qa_scenario_${scenario}_not_ready`);
}

export function routeQaAuditDeleteWhere(resourceIds: string[]) {
  return { entity_id: { in: resourceIds } };
}

function assertMemberships(
  actual: RouteQaMembershipSnapshot[],
  expected: Array<Omit<RouteQaMembershipSnapshot, "stopId"> & { stopKey: string }>,
  stopIds: Map<string, string>,
  scenario: string
) {
  assertReady(actual.length === expected.length, scenario);
  for (const [index, wanted] of expected.entries()) {
    const membership = actual[index];
    assertReady(
      membership.stopId === stopIds.get(wanted.stopKey) &&
      membership.sequence === wanted.sequence &&
      membership.passengerPickup === wanted.passengerPickup &&
      membership.passengerDropoff === wanted.passengerDropoff &&
      membership.parcelPickup === wanted.parcelPickup &&
      membership.parcelDropoff === wanted.parcelDropoff &&
      membership.distanceFromOriginMeters === wanted.distanceFromOriginMeters &&
      membership.scheduledOffsetSeconds === wanted.scheduledOffsetSeconds &&
      membership.dwellSeconds === wanted.dwellSeconds &&
      membership.createdAtPresent === wanted.createdAtPresent,
      scenario
    );
  }
}

function expectedMemberships(keys: string[], parcelEnabled: boolean) {
  return keys.map((stopKey, index) => ({
    stopKey,
    sequence: index + 1,
    passengerPickup: index < keys.length - 1,
    passengerDropoff: index > 0,
    parcelPickup: parcelEnabled && index < keys.length - 1,
    parcelDropoff: parcelEnabled && index > 0,
    distanceFromOriginMeters: null,
    scheduledOffsetSeconds: index * 600,
    dwellSeconds: index === 0 || index === keys.length - 1 ? 60 : 120,
    createdAtPresent: true
  }));
}

function assertVersion(
  version: RouteQaVersionSnapshot | undefined,
  expected: {
    number: number;
    status: RouteQaVersionSnapshot["status"];
    nameAr: string;
    nameEn: string;
    descriptionEn: string;
    stopKeys: string[];
    parcelEnabled: boolean;
    draftRevision: number;
    published: boolean;
    paused: boolean;
    retired: boolean;
    pauseReason: string | null;
    retirementReason: string | null;
  },
  stopIds: Map<string, string>,
  scenario: string
) {
  assertReady(
    version?.versionNumber === expected.number &&
    version.status === expected.status &&
    version.nameAr === expected.nameAr &&
    version.nameEn === expected.nameEn &&
    version.descriptionAr === null &&
    version.descriptionEn === expected.descriptionEn &&
    version.originStopId === (expected.stopKeys.length > 0 ? stopIds.get(expected.stopKeys[0]) : null) &&
    version.destinationStopId === (expected.stopKeys.length > 0 ? stopIds.get(expected.stopKeys.at(-1)!) : null) &&
    version.activeFrom === null &&
    version.activeUntil === null &&
    version.encodedGeometry === null &&
    version.geometryEncoding === null &&
    version.geometryProvider === null &&
    version.geometryChecksum === null &&
    version.geometryPrecision === null &&
    version.estimatedDistanceMeters === null &&
    version.estimatedDurationSeconds === null &&
    version.geometryStatus === "pending" &&
    version.draftRevision === expected.draftRevision &&
    version.createdByUserId === QA_ACTOR_ID &&
    version.publishedByUserId === (expected.published ? QA_ACTOR_ID : null) &&
    version.pausedByUserId === (expected.paused ? QA_ACTOR_ID : null) &&
    version.retiredByUserId === (expected.retired ? QA_ACTOR_ID : null) &&
    version.publishedAtPresent === expected.published &&
    version.pausedAtPresent === expected.paused &&
    version.retiredAtPresent === expected.retired &&
    version.pauseReason === expected.pauseReason &&
    version.retirementReason === expected.retirementReason &&
    version.createdAtPresent &&
    version.updatedAtPresent,
    scenario
  );
  assertMemberships(version.stops, expectedMemberships(expected.stopKeys, expected.parcelEnabled), stopIds, scenario);
}

export function assertRouteQaFixtureSnapshot(snapshot: RouteQaFixtureSnapshot) {
  assertReady(
    snapshot.actor?.id === QA_ACTOR_ID &&
    snapshot.actor.role === "admin" &&
    snapshot.actor.accountStatus === "active" &&
    snapshot.actor.demoAccount === false &&
    snapshot.actor.hasPasswordHash,
    "actor"
  );

  const expectedStops = [
    [stopKeys.active, "active", "محطة اختبار نشطة", "Active QA stop", "31.9038", "35.2034"],
    [stopKeys.retired, "retired", "محطة اختبار متقاعدة", "Retired QA stop", "31.907", "35.206"],
    [stopKeys.destination, "active", "محطة اختبار نهائية", "Destination QA stop", "31.915", "35.215"],
    [stopKeys.middle, "active", "محطة اختبار وسطى", "Middle QA stop", "31.91", "35.21"]
  ] as const;
  assertReady(snapshot.stops.length === expectedStops.length, "stops");
  const stopByKey = new Map(snapshot.stops.map((stop) => [stop.stopKey, stop]));
  const stopIds = new Map<string, string>();
  for (const [key, status, nameAr, nameEn, latitude, longitude] of expectedStops) {
    const stop = stopByKey.get(key);
    assertReady(
      stop?.serviceRegionKey === QA_REGION && stop.status === status &&
      stop.nameAr === nameAr && stop.nameEn === nameEn &&
      stop.latitude === latitude && stop.longitude === longitude && Boolean(stop.id),
      "stops"
    );
    stopIds.set(key, stop.id);
  }
  assertReady(new Set(stopIds.values()).size === expectedStops.length, "stops");
  const noLifecycle = {
    published: false,
    paused: false,
    retired: false,
    pauseReason: null,
    retirementReason: null
  } as const;

  assertReady(snapshot.routes.length === Object.keys(routeKeys).length, "routes");
  const routeByKey = new Map(snapshot.routes.map((route) => [route.routeKey, route]));
  const identity = (
    key: string,
    groupKey: string,
    direction: "outbound" | "inbound" | "loop",
    status: "active" | "retired",
    versionCount: number,
    scenario: string
  ) => {
    const route = routeByKey.get(key);
    assertReady(
      route?.routeGroupKey === groupKey && route.serviceRegionKey === QA_REGION &&
      route.direction === direction && route.status === status && route.versions.length === versionCount && Boolean(route.id),
      scenario
    );
    return route;
  };

  const empty = identity(routeKeys.empty, `${FIXTURE_PREFIX}empty-group`, "loop", "retired", 0, "c");
  assertReady(empty.currentVersionId === null, "c");
  assertReady(snapshot.routes.filter((route) => route.status === "active").length === 4, "route_create_slot");

  const draft = identity(routeKeys.draft, `${FIXTURE_PREFIX}draft-group`, "outbound", "active", 1, "d");
  assertReady(draft.currentVersionId === null, "d");
  assertVersion(draft.versions[0], {
    number: 1, status: "draft", nameAr: "مسودة صالحة للاختبار", nameEn: "Valid QA draft",
    descriptionEn: `${FIXTURE_PREFIX}d-valid-draft`, stopKeys: [stopKeys.active, stopKeys.destination], parcelEnabled: false,
    draftRevision: 2, ...noLifecycle
  }, stopIds, "d");

  const invalid = identity(routeKeys.invalid, `${FIXTURE_PREFIX}invalid-group`, "inbound", "active", 1, "e");
  assertReady(invalid.currentVersionId === null, "e");
  assertVersion(invalid.versions[0], {
    number: 1, status: "draft", nameAr: " ", nameEn: "Invalid publication QA draft",
    descriptionEn: `${FIXTURE_PREFIX}e-invalid-publication`, stopKeys: [], parcelEnabled: false,
    draftRevision: 1, ...noLifecycle
  }, stopIds, "e");

  const current = identity(routeKeys.current, `${FIXTURE_PREFIX}history-group`, "outbound", "active", 3, "f");
  const currentMetadata = {
    nameAr: "المسار التجريبي الأول",
    nameEn: "QA route version one",
    descriptionEn: `${FIXTURE_PREFIX}h-retired-history`,
    stopKeys: [stopKeys.active, stopKeys.middle, stopKeys.destination],
    parcelEnabled: true
  };
  assertVersion(current.versions[0], {
    number: 1, status: "retired", ...currentMetadata, draftRevision: 2,
    published: true, paused: true, retired: true,
    pauseReason: "superseded_by_new_version", retirementReason: "qa_fixture_historical_version"
  }, stopIds, "h");
  assertVersion(current.versions[1], {
    number: 2, status: "published", ...currentMetadata, draftRevision: 1,
    published: true, paused: false, retired: false, pauseReason: null, retirementReason: null
  }, stopIds, "f");
  assertVersion(current.versions[2], {
    number: 3, status: "draft", ...currentMetadata, draftRevision: 1, ...noLifecycle
  }, stopIds, "k");
  assertReady(current.currentVersionId === current.versions[1].id, "f");

  const paused = identity(routeKeys.paused, `${FIXTURE_PREFIX}paused-group`, "inbound", "active", 1, "g");
  assertVersion(paused.versions[0], {
    number: 1, status: "paused", nameAr: "مسار متوقف مؤقتا", nameEn: "Paused QA route",
    descriptionEn: `${FIXTURE_PREFIX}g-paused-current`, stopKeys: [stopKeys.active, stopKeys.destination], parcelEnabled: false,
    draftRevision: 2, published: true, paused: true, retired: false,
    pauseReason: "qa_fixture_paused_version", retirementReason: null
  }, stopIds, "g");
  assertReady(paused.currentVersionId === paused.versions[0].id, "g");

  const retired = identity(routeKeys.retired, `${FIXTURE_PREFIX}retired-group`, "outbound", "retired", 0, "l");
  assertReady(retired.currentVersionId === null, "l");
}

async function assertFixturesAbsent(prisma: PrismaClient) {
  const [routes, stops, actorCount] = await Promise.all([
    prisma.serviceRoute.count({ where: { route_key: { startsWith: FIXTURE_PREFIX } } }),
    prisma.stop.count({ where: { stop_key: { startsWith: FIXTURE_PREFIX } } }),
    prisma.user.count({ where: { id: QA_ACTOR_ID } })
  ]);
  if (routes + stops + actorCount !== 0) throw new Error("route_qa_fixtures_already_exist");
}

async function prepareFixtures(prisma: PrismaClient, service: RouteManagementService, qaAdminPassword: string) {
  await assertFixturesAbsent(prisma);
  const { hash } = await import("bcryptjs");

  await prisma.user.create({
    data: {
      id: QA_ACTOR_ID,
      name: "Card 6 QA Administrator",
      phone: ["+970", "599", "900", "060"].join(""),
      password_hash: await hash(qaAdminPassword, 12),
      role: "admin"
    }
  });

  const activeStop = (await service.createStop({
    stopKey: stopKeys.active,
    serviceRegionKey: QA_REGION,
    nameAr: "محطة اختبار نشطة",
    nameEn: "Active QA stop",
    latitude: "31.903800",
    longitude: "35.203400"
  }, actor("stop-a-create"))).resource;
  const retiredStop = (await service.createStop({
    stopKey: stopKeys.retired,
    serviceRegionKey: QA_REGION,
    nameAr: "محطة اختبار متقاعدة",
    nameEn: "Retired QA stop",
    latitude: "31.907000",
    longitude: "35.206000"
  }, actor("stop-b-create"))).resource;
  const middleStop = (await service.createStop({
    stopKey: stopKeys.middle,
    serviceRegionKey: QA_REGION,
    nameAr: "محطة اختبار وسطى",
    nameEn: "Middle QA stop",
    latitude: "31.910000",
    longitude: "35.210000"
  }, actor("stop-middle-create"))).resource;
  const destinationStop = (await service.createStop({
    stopKey: stopKeys.destination,
    serviceRegionKey: QA_REGION,
    nameAr: "محطة اختبار نهائية",
    nameEn: "Destination QA stop",
    latitude: "31.915000",
    longitude: "35.215000"
  }, actor("stop-destination-create"))).resource;
  await service.retireStop(retiredStop.id, "qa_fixture_retired_stop", actor("stop-b-retire"));

  const retiredRoute = (await service.createRoute({
    routeKey: routeKeys.retired,
    routeGroupKey: `${FIXTURE_PREFIX}retired-group`,
    serviceRegionKey: QA_REGION,
    direction: "outbound"
  }, actor("route-l-create"))).resource;
  await service.retireRoute(
    retiredRoute.id,
    { reason: "qa_fixture_retired_route", expectedCurrentVersionId: null },
    actor("route-l-retire")
  );

  const emptyRoute = (await service.createRoute({
    routeKey: routeKeys.empty,
    routeGroupKey: `${FIXTURE_PREFIX}empty-group`,
    serviceRegionKey: QA_REGION,
    direction: "loop"
  }, actor("route-c-create"))).resource;
  await service.retireRoute(
    emptyRoute.id,
    { reason: "qa_fixture_empty_route", expectedCurrentVersionId: null },
    actor("route-c-retire")
  );

  const draftRoute = (await service.createRoute({
    routeKey: routeKeys.draft,
    routeGroupKey: `${FIXTURE_PREFIX}draft-group`,
    serviceRegionKey: QA_REGION,
    direction: "outbound"
  }, actor("route-d-create"))).resource;
  const draftVersion = (await service.createVersion(draftRoute.id, {
    nameAr: "مسودة صالحة للاختبار",
    nameEn: "Valid QA draft",
    descriptionEn: `${FIXTURE_PREFIX}d-valid-draft`
  }, actor("version-d-create"))).resource;
  await service.replaceStops(
    draftVersion.id,
    draftVersion.draft_revision,
    memberships([activeStop.id, destinationStop.id], false),
    actor("version-d-stops")
  );

  const invalidRoute = (await service.createRoute({
    routeKey: routeKeys.invalid,
    routeGroupKey: `${FIXTURE_PREFIX}invalid-group`,
    serviceRegionKey: QA_REGION,
    direction: "inbound"
  }, actor("route-e-create"))).resource;
  await service.createVersion(invalidRoute.id, {
    nameAr: " ",
    nameEn: "Invalid publication QA draft",
    descriptionEn: `${FIXTURE_PREFIX}e-invalid-publication`
  }, actor("version-e-create"));

  const currentRoute = (await service.createRoute({
    routeKey: routeKeys.current,
    routeGroupKey: `${FIXTURE_PREFIX}history-group`,
    serviceRegionKey: QA_REGION,
    direction: "outbound"
  }, actor("route-f-create"))).resource;
  const currentV1 = (await service.createVersion(currentRoute.id, {
    nameAr: "المسار التجريبي الأول",
    nameEn: "QA route version one",
    descriptionEn: `${FIXTURE_PREFIX}h-retired-history`
  }, actor("version-f-v1-create"))).resource;
  const currentV1Ready = await service.replaceStops(
    currentV1.id,
    currentV1.draft_revision,
    memberships([activeStop.id, middleStop.id, destinationStop.id], true),
    actor("version-f-v1-stops")
  );
  await service.publishVersion(
    currentV1.id,
    { expectedRevision: currentV1Ready.draft_revision, expectedCurrentVersionId: null },
    actor("version-f-v1-publish")
  );
  const currentV2 = (await service.createVersion(currentRoute.id, {
    nameAr: "نسخة من المسار التجريبي",
    nameEn: "Cloned QA route version",
    cloneFromVersionId: currentV1.id
  }, actor("version-f-v2-create"))).resource;
  const publishedV2 = (await service.publishVersion(
    currentV2.id,
    { expectedRevision: currentV2.draft_revision, expectedCurrentVersionId: currentV1.id },
    actor("version-f-v2-publish")
  )).resource;
  await service.retireVersion(
    currentV1.id,
    { reason: "qa_fixture_historical_version", expectedCurrentVersionId: publishedV2.id },
    actor("version-f-v1-retire")
  );
  await service.createVersion(currentRoute.id, {
    nameAr: "مسودة مستنسخة للاختبار",
    nameEn: "Cloned QA draft",
    descriptionEn: `${FIXTURE_PREFIX}k-cloned-draft`,
    cloneFromVersionId: publishedV2.id
  }, actor("version-f-v3-create"));

  const pausedRoute = (await service.createRoute({
    routeKey: routeKeys.paused,
    routeGroupKey: `${FIXTURE_PREFIX}paused-group`,
    serviceRegionKey: QA_REGION,
    direction: "inbound"
  }, actor("route-g-create"))).resource;
  const pausedDraft = (await service.createVersion(pausedRoute.id, {
    nameAr: "مسار متوقف مؤقتا",
    nameEn: "Paused QA route",
    descriptionEn: `${FIXTURE_PREFIX}g-paused-current`
  }, actor("version-g-create"))).resource;
  const pausedReady = await service.replaceStops(
    pausedDraft.id,
    pausedDraft.draft_revision,
    memberships([activeStop.id, destinationStop.id], false),
    actor("version-g-stops")
  );
  const publishedPaused = (await service.publishVersion(
    pausedDraft.id,
    { expectedRevision: pausedReady.draft_revision, expectedCurrentVersionId: null },
    actor("version-g-publish")
  )).resource;
  await service.pauseVersion(
    publishedPaused.id,
    { reason: "qa_fixture_paused_version", expectedCurrentVersionId: publishedPaused.id },
    actor("version-g-pause")
  );

  console.log("route QA prepare complete: 12 scenarios ready; fixtures preserved");
}

async function verifyFixtures(prisma: PrismaClient, qaAdminPassword: string) {
  const [actorRow, stops, routes] = await Promise.all([
    prisma.user.findUnique({
      where: { id: QA_ACTOR_ID },
      select: { id: true, role: true, account_status: true, demo_account: true, password_hash: true }
    }),
    prisma.stop.findMany({
      where: { stop_key: { startsWith: FIXTURE_PREFIX } },
      orderBy: { stop_key: "asc" },
      take: 5,
      select: {
        id: true, stop_key: true, service_region_key: true, name_ar: true, name_en: true,
        latitude: true, longitude: true, status: true
      }
    }),
    prisma.serviceRoute.findMany({
      where: { route_key: { startsWith: FIXTURE_PREFIX } },
      orderBy: { route_key: "asc" },
      take: 7,
      select: {
        id: true, route_key: true, route_group_key: true, service_region_key: true,
        direction: true, status: true, current_version_id: true,
        versions: {
          orderBy: { version_number: "asc" },
          take: 4,
          select: {
            id: true, version_number: true, status: true, name_ar: true, name_en: true,
            description_ar: true, description_en: true, origin_stop_id: true, destination_stop_id: true,
            active_from: true, active_until: true, encoded_geometry: true, geometry_encoding: true,
            geometry_provider: true, geometry_checksum: true, geometry_precision: true,
            estimated_distance_meters: true, estimated_duration_seconds: true, geometry_status: true,
            draft_revision: true, created_by_user_id: true, published_by_user_id: true,
            paused_by_user_id: true, retired_by_user_id: true, published_at: true, paused_at: true,
            pause_reason: true, retired_at: true, retirement_reason: true, created_at: true, updated_at: true,
            stops: {
              orderBy: { sequence: "asc" },
              take: 4,
              select: {
                stop_id: true, sequence: true, passenger_pickup: true, passenger_dropoff: true,
                parcel_pickup: true, parcel_dropoff: true, distance_from_origin_meters: true,
                scheduled_offset_seconds: true, dwell_seconds: true, created_at: true
              }
            }
          }
        }
      }
    })
  ]);

  if (actorRow) {
    if (!actorRow.password_hash) throw new Error("route_qa_admin_password_missing");
    await assertRouteQaAdminPassword(qaAdminPassword, actorRow.password_hash);
  }

  assertRouteQaFixtureSnapshot({
    actor: actorRow ? {
      id: actorRow.id,
      role: actorRow.role,
      accountStatus: actorRow.account_status,
      demoAccount: actorRow.demo_account,
      hasPasswordHash: (actorRow.password_hash?.startsWith("$2") ?? false) && actorRow.password_hash!.length >= 59
    } : null,
    stops: stops.map((stop) => ({
      id: stop.id,
      stopKey: stop.stop_key,
      serviceRegionKey: stop.service_region_key,
      nameAr: stop.name_ar,
      nameEn: stop.name_en,
      latitude: String(stop.latitude),
      longitude: String(stop.longitude),
      status: stop.status
    })),
    routes: routes.map((route) => ({
      id: route.id,
      routeKey: route.route_key,
      routeGroupKey: route.route_group_key,
      serviceRegionKey: route.service_region_key,
      direction: route.direction,
      status: route.status,
      currentVersionId: route.current_version_id,
      versions: route.versions.map((version) => ({
        id: version.id,
        versionNumber: version.version_number,
        status: version.status,
        nameAr: version.name_ar,
        nameEn: version.name_en,
        descriptionAr: version.description_ar,
        descriptionEn: version.description_en,
        originStopId: version.origin_stop_id,
        destinationStopId: version.destination_stop_id,
        activeFrom: version.active_from?.toISOString() ?? null,
        activeUntil: version.active_until?.toISOString() ?? null,
        encodedGeometry: version.encoded_geometry,
        geometryEncoding: version.geometry_encoding,
        geometryProvider: version.geometry_provider,
        geometryChecksum: version.geometry_checksum,
        geometryPrecision: version.geometry_precision,
        estimatedDistanceMeters: version.estimated_distance_meters,
        estimatedDurationSeconds: version.estimated_duration_seconds,
        geometryStatus: version.geometry_status,
        draftRevision: version.draft_revision,
        createdByUserId: version.created_by_user_id,
        publishedByUserId: version.published_by_user_id,
        pausedByUserId: version.paused_by_user_id,
        retiredByUserId: version.retired_by_user_id,
        publishedAtPresent: version.published_at !== null,
        pausedAtPresent: version.paused_at !== null,
        retiredAtPresent: version.retired_at !== null,
        pauseReason: version.pause_reason,
        retirementReason: version.retirement_reason,
        createdAtPresent: version.created_at instanceof Date,
        updatedAtPresent: version.updated_at instanceof Date,
        stops: version.stops.map((stop) => ({
          stopId: stop.stop_id,
          sequence: stop.sequence,
          passengerPickup: stop.passenger_pickup,
          passengerDropoff: stop.passenger_dropoff,
          parcelPickup: stop.parcel_pickup,
          parcelDropoff: stop.parcel_dropoff,
          distanceFromOriginMeters: stop.distance_from_origin_meters,
          scheduledOffsetSeconds: stop.scheduled_offset_seconds,
          dwellSeconds: stop.dwell_seconds,
          createdAtPresent: stop.created_at instanceof Date
        }))
      }))
    }))
  });

  console.log("route QA verify complete: 12/12 scenarios ready; no mutations performed");
}

async function cleanupFixtures(prisma: PrismaClient) {
  const [routes, stops] = await Promise.all([
    prisma.serviceRoute.findMany({
      where: { route_key: { startsWith: FIXTURE_PREFIX } },
      select: { id: true, versions: { select: { id: true } } }
    }),
    prisma.stop.findMany({ where: { stop_key: { startsWith: FIXTURE_PREFIX } }, select: { id: true } })
  ]);
  const routeIds = routes.map((route) => route.id);
  const versionIds = routes.flatMap((route) => route.versions.map((version) => version.id));
  const stopIds = stops.map((stop) => stop.id);
  const resourceIds = [...routeIds, ...versionIds, ...stopIds];

  await prisma.$transaction(async (tx) => {
    if (routeIds.length > 0) {
      await tx.serviceRoute.updateMany({ where: { id: { in: routeIds } }, data: { current_version_id: null } });
    }
    if (versionIds.length > 0) {
      await tx.routeVersionStop.deleteMany({ where: { service_route_version_id: { in: versionIds } } });
    }
    if (resourceIds.length > 0) {
      await tx.auditEvent.deleteMany({ where: routeQaAuditDeleteWhere(resourceIds) });
      await tx.idempotencyRecord.deleteMany({ where: { resource_id: { in: resourceIds } } });
    }
    if (versionIds.length > 0) {
      await tx.serviceRouteVersion.deleteMany({ where: { id: { in: versionIds } } });
    }
    if (routeIds.length > 0) await tx.serviceRoute.deleteMany({ where: { id: { in: routeIds } } });
    if (stopIds.length > 0) await tx.stop.deleteMany({ where: { id: { in: stopIds } } });
    await tx.user.deleteMany({ where: { id: QA_ACTOR_ID } });
  });

  console.log(`route QA cleanup complete: ${routeIds.length} routes, ${versionIds.length} versions, ${stopIds.length} stops`);
}

async function main() {
  const mode = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  if (!process.argv.includes("--confirm-disposable")) throw new Error("route_qa_confirmation_required");
  if (mode !== "prepare" && mode !== "verify" && mode !== "cleanup") throw new Error("route_qa_mode_required");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("route_qa_database_guard_rejected");

  assertRouteQaDatabase(databaseUrl);
  const qaAdminPassword = mode === "prepare" || mode === "verify"
    ? requireRouteQaAdminPassword(process.env.ROUTE_QA_ADMIN_PASSWORD)
    : undefined;

  const [{ prisma }, { createRouteManagementService }] = await Promise.all([
    import("../lib/prisma.js"),
    import("../services/routeManagement.js")
  ]);
  const service = createRouteManagementService(prisma);
  try {
    if (mode === "prepare") await prepareFixtures(prisma, service, qaAdminPassword!);
    if (mode === "verify") await verifyFixtures(prisma, qaAdminPassword!);
    if (mode === "cleanup") await cleanupFixtures(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error("route QA command failed; details withheld");
    process.exitCode = 1;
  });
}
