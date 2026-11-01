import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { DEMO_SERVICE_ROUTE_KEY, resetDemoData } from "../modules/demoReset.js";
import { createRouteManagementService, type VersionStopInput } from "../services/routeManagement.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectFailure(action: () => Promise<unknown>, expected?: string) {
  try {
    await action();
  } catch (error) {
    if (expected) assert(error instanceof Error && error.message === expected, `Expected ${expected}`);
    return;
  }
  throw new Error(`Expected operation to fail${expected ? ` with ${expected}` : ""}`);
}

function actor(id: string, idempotencyKey: string) {
  return { id, requestId: `route-integration-${idempotencyKey}`, idempotencyKey };
}

function membership(stopId: string, sequence: number): VersionStopInput {
  return {
    stopId,
    sequence,
    passengerPickupAllowed: sequence === 1,
    passengerDropoffAllowed: sequence > 1,
    parcelPickupAllowed: sequence === 1,
    parcelDropoffAllowed: sequence > 1
  };
}

async function demoCounts() {
  const [routes, versions, stops, driverRoutes, linkedDriverRoutes] = await Promise.all([
    prisma.serviceRoute.count(),
    prisma.serviceRouteVersion.count(),
    prisma.stop.count(),
    prisma.driverRoute.count(),
    prisma.driverRoute.count({ where: { route_version_id: { not: null } } })
  ]);
  return { routes, versions, stops, driverRoutes, linkedDriverRoutes };
}

async function lifecycleState(routeId: string, versionIds: string[]) {
  const [route, versions, auditCount] = await Promise.all([
    prisma.serviceRoute.findUniqueOrThrow({ where: { id: routeId }, select: { current_version_id: true } }),
    prisma.serviceRouteVersion.findMany({
      where: { id: { in: versionIds } },
      orderBy: { version_number: "asc" },
      select: { id: true, status: true }
    }),
    prisma.auditEvent.count({
      where: { entity_type: "ServiceRouteVersion", entity_id: { in: versionIds } }
    })
  ]);
  return { currentVersionId: route.current_version_id, versions, auditCount };
}

async function main() {
  const database = new URL(config.databaseUrl).pathname.replace(/^\//, "");
  assert(database.endsWith("_ci") || database.startsWith("darb_route_"), "Route integration requires a disposable database");
  assert(config.demoFeaturesEnabled, "Route integration requires demo/test isolation");

  await resetDemoData();
  const firstReset = await demoCounts();
  await resetDemoData();
  const secondReset = await demoCounts();
  assert(JSON.stringify(firstReset) === JSON.stringify(secondReset), "Demo route seed is not idempotent");
  assert(
    firstReset.routes === 1 && firstReset.versions === 1 && firstReset.stops === 3 &&
      firstReset.driverRoutes === 2 && firstReset.linkedDriverRoutes === 1,
    "Demo canonical route counts are not deterministic"
  );
  const demoRoute = await prisma.serviceRoute.findUniqueOrThrow({
    where: { route_key: DEMO_SERVICE_ROUTE_KEY },
    include: { current_version: true }
  });
  assert(demoRoute.current_version?.name_ar.includes("درب") === false, "Route display name unexpectedly contains a brand suffix");
  assert(demoRoute.current_version?.description_ar?.includes("درب"), "Arabic demo route data did not round-trip");
  assert(demoRoute.current_version?.geometry_status === "available", "Exact demo geometry readiness was not preserved");

  const admin = await prisma.user.findFirstOrThrow({ where: { role: "admin", demo_account: true } });
  const adminB = await prisma.user.create({
    data: {
      name: "Route Integration Admin B",
      phone: "+970599999998",
      password_hash: admin.password_hash,
      role: "admin",
      demo_account: true
    }
  });
  const service = createRouteManagementService(prisma);
  const identity = {
    routeKey: "integration-hebron-bethlehem",
    routeGroupKey: "integration-hebron-bethlehem-group",
    serviceRegionKey: "integration-south-west-bank",
    direction: "outbound" as const
  };

  const capSeedRoutes = [];
  for (let index = 0; index < 3; index += 1) {
    capSeedRoutes.push(await service.createRoute(
      {
        routeKey: `integration-cap-seed-${index}`,
        routeGroupKey: "integration-cap-seed",
        serviceRegionKey: identity.serviceRegionKey,
        direction: "outbound"
      },
      actor(admin.id, `route-cap-seed-${index}`)
    ));
  }
  assert(await prisma.serviceRoute.count({ where: { status: "active" } }) === 4, "Route cap setup was not deterministic");
  const capSlot = await service.createRoute(
    {
      routeKey: "integration-cap-slot",
      routeGroupKey: "integration-cap-slot",
      serviceRegionKey: identity.serviceRegionKey,
      direction: "outbound"
    },
    actor(admin.id, "route-cap-slot")
  );
  assert(await prisma.serviceRoute.count({ where: { status: "active" } }) === 5, "Route cap did not admit the fifth active route");
  await expectFailure(
    () => service.createRoute(
      {
        routeKey: "integration-cap-overflow",
        routeGroupKey: "integration-cap-overflow",
        serviceRegionKey: identity.serviceRegionKey,
        direction: "outbound"
      },
      actor(admin.id, "route-cap-overflow")
    ),
    "beta_route_limit_reached"
  );
  assert(await prisma.serviceRoute.count({ where: { status: "active" } }) === 5, "Route cap overflow wrote a sixth active route");
  await service.retireRoute(capSlot.resource.id, { reason: "integration_cleanup", expectedCurrentVersionId: null }, actor(admin.id, "retire-route-cap-slot"));
  const capRace = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
    service.createRoute(
      {
        routeKey: `integration-cap-race-${index}`,
        routeGroupKey: "integration-cap-race",
        serviceRegionKey: identity.serviceRegionKey,
        direction: "outbound"
      },
      actor(admin.id, `route-cap-race-${index}`)
    )
  ));
  assert(capRace.filter((result) => result.status === "fulfilled").length === 1, "Concurrent route cap admitted more than one final slot");
  assert(await prisma.serviceRoute.count({ where: { status: "active" } }) === 5, "Concurrent route cap exceeded five active routes");
  const capRoutes = await prisma.serviceRoute.findMany({ where: { route_key: { startsWith: "integration-cap-" } } });
  for (const route of capRoutes) {
    if (route.status !== "retired") {
      await service.retireRoute(route.id, { reason: "integration_cleanup", expectedCurrentVersionId: null }, actor(admin.id, `retire-${route.route_key}`));
    }
  }

  const routeKeyRace = await Promise.allSettled([0, 1].map((index) => service.createRoute(
    {
      routeKey: "integration-route-key-race",
      routeGroupKey: "integration-route-key-race",
      serviceRegionKey: identity.serviceRegionKey,
      direction: "outbound"
    },
    actor(admin.id, `route-key-race-${index}`)
  )));
  assert(routeKeyRace.filter((result) => result.status === "fulfilled").length === 1, "Route-key race did not have exactly one winner");
  const routeKeyWinner = await prisma.serviceRoute.findUniqueOrThrow({ where: { route_key: "integration-route-key-race" } });
  await service.retireRoute(routeKeyWinner.id, { reason: "integration_cleanup", expectedCurrentVersionId: null }, actor(admin.id, "retire-route-key-race"));

  const stopKeyRace = await Promise.allSettled([0, 1].map((index) => service.createStop(
    {
      stopKey: "integration-stop-key-race",
      serviceRegionKey: identity.serviceRegionKey,
      nameAr: "محطة سباق المفتاح",
      nameEn: "Stop key race",
      latitude: "31.500001",
      longitude: "35.000001"
    },
    actor(admin.id, `stop-key-race-${index}`)
  )));
  assert(stopKeyRace.filter((result) => result.status === "fulfilled").length === 1, "Stop-key race did not have exactly one winner");
  const stopKeyWinner = await prisma.stop.findUniqueOrThrow({ where: { stop_key: "integration-stop-key-race" } });
  await service.retireStop(stopKeyWinner.id, "integration_cleanup", actor(admin.id, "retire-stop-key-race"));

  const createdRoute = await service.createRoute(identity, actor(admin.id, "route-create-001"));
  const replayedRoute = await service.createRoute(identity, actor(admin.id, "route-create-001"));
  assert(createdRoute.resource.id === replayedRoute.resource.id && replayedRoute.replayed, "Route create did not replay idempotently");
  await expectFailure(
    () => service.createRoute({ ...identity, routeGroupKey: "changed-group" }, actor(admin.id, "route-create-001")),
    "idempotency_conflict"
  );
  await expectFailure(
    () => service.createRoute(identity, actor(admin.id, "route-create-duplicate"))
  );

  const stopInputs = [
    { stopKey: "integration-origin", nameAr: "محطة البداية", nameEn: "Integration Origin", latitude: "31.510000", longitude: "35.080000" },
    { stopKey: "integration-middle", nameAr: "المحطة الوسطى", nameEn: "Integration Middle", latitude: "31.610000", longitude: "35.140000" },
    { stopKey: "integration-destination", nameAr: "محطة النهاية", nameEn: "Integration Destination", latitude: "31.700000", longitude: "35.200000" }
  ];
  const createdStops: Array<{ id: string }> = [];
  for (const [index, stop] of stopInputs.entries()) {
    const result = await service.createStop(
      { ...stop, serviceRegionKey: identity.serviceRegionKey },
      actor(admin.id, `stop-create-00${index + 1}`)
    );
    createdStops.push(result.resource);
  }
  await expectFailure(() =>
    service.createStop(
      { ...stopInputs[0], serviceRegionKey: identity.serviceRegionKey },
      actor(admin.id, "stop-create-duplicate")
    )
  );
  const otherRegionStop = await service.createStop(
    {
      ...stopInputs[1],
      stopKey: "integration-other-region",
      serviceRegionKey: "integration-other-region"
    },
    actor(admin.id, "stop-create-other-region")
  );

  const versionDraft = {
    nameAr: "مسار اختبار التكامل",
    nameEn: "Integration Route",
    descriptionAr: "مسودة اختبار آمنة.",
    descriptionEn: "Safe integration draft.",
    activeFrom: null,
    activeUntil: null
  };

  const staleFenceRoute = await service.createRoute(
    {
      routeKey: "integration-stale-current-fence",
      routeGroupKey: "integration-stale-current-fence",
      serviceRegionKey: identity.serviceRegionKey,
      direction: "outbound"
    },
    actor(admin.id, "stale-fence-route")
  );
  const staleFenceV1Draft = await service.createVersion(
    staleFenceRoute.resource.id,
    versionDraft,
    actor(admin.id, "stale-fence-v1-create")
  );
  const staleFenceV1WithStops = await service.replaceStops(
    staleFenceV1Draft.resource.id,
    staleFenceV1Draft.resource.draft_revision,
    [membership(createdStops[0].id, 1), membership(createdStops[2].id, 2)],
    { id: admin.id, requestId: "stale-fence-v1-stops" }
  );
  const staleFenceV1 = (await service.publishVersion(
    staleFenceV1Draft.resource.id,
    { expectedRevision: staleFenceV1WithStops.draft_revision, expectedCurrentVersionId: null },
    actor(admin.id, "stale-fence-v1-publish")
  )).resource;
  const adminAObservedPointer = (await prisma.serviceRoute.findUniqueOrThrow({
    where: { id: staleFenceRoute.resource.id },
    select: { current_version_id: true }
  })).current_version_id;
  assert(adminAObservedPointer === staleFenceV1.id, "Admin A did not observe V1 as current");

  const staleFenceV2Draft = await service.createVersion(
    staleFenceRoute.resource.id,
    { ...versionDraft, cloneFromVersionId: staleFenceV1.id },
    actor(admin.id, "stale-fence-v2-create")
  );
  const staleFenceV2 = (await service.publishVersion(
    staleFenceV2Draft.resource.id,
    { expectedRevision: staleFenceV2Draft.resource.draft_revision, expectedCurrentVersionId: staleFenceV1.id },
    actor(adminB.id, "stale-fence-v2-publish")
  )).resource;
  const staleFenceVersionIds = [staleFenceV1.id, staleFenceV2.id];
  const rejectStaleLifecycleWithoutWrites = async (label: string, action: () => Promise<unknown>) => {
    const before = await lifecycleState(staleFenceRoute.resource.id, staleFenceVersionIds);
    await expectFailure(action, "current_version_conflict");
    const after = await lifecycleState(staleFenceRoute.resource.id, staleFenceVersionIds);
    assert(JSON.stringify(after) === JSON.stringify(before), `${label} stale rejection changed lifecycle state or audit count`);
  };

  await rejectStaleLifecycleWithoutWrites("pause", () => service.pauseVersion(
    staleFenceV1.id,
    { reason: "stale_admin_a_pause", expectedCurrentVersionId: adminAObservedPointer },
    actor(admin.id, "stale-fence-pause-rejected")
  ));
  await service.pauseVersion(
    staleFenceV2.id,
    { reason: "fresh_admin_a_pause", expectedCurrentVersionId: staleFenceV2.id },
    actor(admin.id, "stale-fence-pause-fresh")
  );

  await rejectStaleLifecycleWithoutWrites("resume", () => service.resumeVersion(
    staleFenceV1.id,
    { expectedCurrentVersionId: adminAObservedPointer },
    actor(admin.id, "stale-fence-resume-rejected")
  ));
  await service.resumeVersion(
    staleFenceV2.id,
    { expectedCurrentVersionId: staleFenceV2.id },
    actor(admin.id, "stale-fence-resume-fresh")
  );

  await rejectStaleLifecycleWithoutWrites("retire", () => service.retireVersion(
    staleFenceV1.id,
    { reason: "stale_admin_a_retire", expectedCurrentVersionId: adminAObservedPointer },
    actor(admin.id, "stale-fence-retire-rejected")
  ));
  await service.retireVersion(
    staleFenceV1.id,
    { reason: "fresh_admin_a_retire", expectedCurrentVersionId: staleFenceV2.id },
    actor(admin.id, "stale-fence-retire-fresh")
  );
  await service.pauseVersion(
    staleFenceV2.id,
    { reason: "integration_cleanup", expectedCurrentVersionId: staleFenceV2.id },
    actor(admin.id, "stale-fence-v2-pause-cleanup")
  );
  await service.retireVersion(
    staleFenceV2.id,
    { reason: "integration_cleanup", expectedCurrentVersionId: staleFenceV2.id },
    actor(admin.id, "stale-fence-v2-retire-cleanup")
  );
  await service.retireRoute(
    staleFenceRoute.resource.id,
    { reason: "integration_cleanup", expectedCurrentVersionId: null },
    actor(admin.id, "stale-fence-route-retire-cleanup")
  );

  const versionResults = await Promise.all([
    service.createVersion(createdRoute.resource.id, versionDraft, actor(admin.id, "version-create-001")),
    service.createVersion(createdRoute.resource.id, versionDraft, actor(admin.id, "version-create-002"))
  ]);
  assert(
    new Set(versionResults.map((result) => result.resource.version_number)).size === 2,
    "Concurrent version creation reused a version number"
  );
  const [firstVersion, secondVersion] = versionResults.map((result) => result.resource);

  const edits = await Promise.allSettled([
    service.updateDraft(firstVersion.id, { ...versionDraft, nameEn: "Integration Route A", expectedRevision: 1 }, { id: admin.id, requestId: "edit-a" }),
    service.updateDraft(firstVersion.id, { ...versionDraft, nameEn: "Integration Route B", expectedRevision: 1 }, { id: admin.id, requestId: "edit-b" })
  ]);
  assert(edits.filter((result) => result.status === "fulfilled").length === 1, "Concurrent draft edits did not produce one winner");
  assert(edits.filter((result) => result.status === "rejected").length === 1, "Concurrent draft edit conflict was not detected");
  await expectFailure(
    () => service.updateDraft(firstVersion.id, { ...versionDraft, expectedRevision: 1 }, { id: admin.id, requestId: "stale-edit" }),
    "draft_revision_conflict"
  );
  const firstAfterEdit = await service.getAdminVersion(firstVersion.id);

  await expectFailure(
    () => service.replaceStops(
      firstVersion.id,
      firstAfterEdit.draft_revision,
      [membership(createdStops[0].id, 1), membership(otherRegionStop.resource.id, 2)],
      { id: admin.id, requestId: "cross-region-stops" }
    ),
    "stop_region_mismatch"
  );
  await service.retireStop(otherRegionStop.resource.id, "integration_cleanup", actor(admin.id, "retire-other-region-stop"));

  await expectFailure(
    () => service.replaceStops(
      firstVersion.id,
      firstAfterEdit.draft_revision,
      [membership(createdStops[0].id, 1), membership(createdStops[1].id, 3)],
      { id: admin.id, requestId: "invalid-order" }
    ),
    "invalid_stop_sequence"
  );
  const firstWithStops = await service.replaceStops(
    firstVersion.id,
    firstAfterEdit.draft_revision,
    [membership(createdStops[0].id, 1), membership(createdStops[2].id, 2)],
    { id: admin.id, requestId: "valid-order-a" }
  );
  const secondWithStops = await service.replaceStops(
    secondVersion.id,
    secondVersion.draft_revision,
    [membership(createdStops[0].id, 1), membership(createdStops[2].id, 2)],
    { id: admin.id, requestId: "valid-order-b" }
  );

  await expectFailure(() => prisma.routeVersionStop.create({
    data: {
      service_route_version_id: firstVersion.id,
      stop_id: createdStops[1].id,
      sequence: 1
    }
  }));
  await expectFailure(() => prisma.routeVersionStop.create({
    data: {
      service_route_version_id: firstVersion.id,
      stop_id: createdStops[0].id,
      sequence: 3
    }
  }));

  const invalidNames = await service.createVersion(
    createdRoute.resource.id,
    { ...versionDraft, nameAr: "", nameEn: "" },
    actor(admin.id, "version-invalid-names")
  );
  const invalidNamesWithStops = await service.replaceStops(
    invalidNames.resource.id,
    invalidNames.resource.draft_revision,
    [membership(createdStops[0].id, 1), membership(createdStops[2].id, 2)],
    { id: admin.id, requestId: "invalid-names-stops" }
  );
  await expectFailure(
    () => service.publishVersion(
      invalidNames.resource.id,
      { expectedRevision: invalidNamesWithStops.draft_revision, expectedCurrentVersionId: null },
      actor(admin.id, "publish-invalid-names")
    ),
    "bilingual_names_required"
  );

  const publications = await Promise.allSettled([
    service.publishVersion(
      firstVersion.id,
      { expectedRevision: firstWithStops.draft_revision, expectedCurrentVersionId: null },
      actor(admin.id, "publish-concurrent-a")
    ),
    service.publishVersion(
      secondVersion.id,
      { expectedRevision: secondWithStops.draft_revision, expectedCurrentVersionId: null },
      actor(admin.id, "publish-concurrent-b")
    )
  ]);
  assert(publications.filter((result) => result.status === "fulfilled").length === 1, "Concurrent publication did not produce one winner");
  assert(publications.filter((result) => result.status === "rejected").length === 1, "Concurrent publication did not reject the loser");
  const routeAfterPublish = await prisma.serviceRoute.findUniqueOrThrow({ where: { id: createdRoute.resource.id } });
  assert(routeAfterPublish.current_version_id, "Published route has no current version");
  const currentVersionId = routeAfterPublish.current_version_id;
  const currentVersion = await service.getAdminVersion(currentVersionId);

  const clones = await Promise.all([
    service.createVersion(createdRoute.resource.id, { ...versionDraft, cloneFromVersionId: currentVersionId }, actor(admin.id, "clone-concurrent-a")),
    service.createVersion(createdRoute.resource.id, { ...versionDraft, cloneFromVersionId: currentVersionId }, actor(admin.id, "clone-concurrent-b"))
  ]);
  assert(new Set(clones.map((result) => result.resource.version_number)).size === 2, "Concurrent clones reused a version number");
  for (const clone of clones) {
    assert(
      clone.resource.geometry_status === "pending" && clone.resource.encoded_geometry === null &&
        clone.resource.geometry_provider === null && clone.resource.geometry_checksum === null &&
        clone.resource.geometry_precision === null && clone.resource.estimated_distance_meters === null &&
        clone.resource.estimated_duration_seconds === null,
      "Clone retained geometry approval metadata"
    );
  }

  const stopReplacementRace = await Promise.allSettled([
    service.replaceStops(
      clones[0].resource.id,
      clones[0].resource.draft_revision,
      [membership(createdStops[1].id, 1), membership(createdStops[2].id, 2)],
      { id: admin.id, requestId: "stop-replacement-race-a" }
    ),
    service.replaceStops(
      clones[0].resource.id,
      clones[0].resource.draft_revision,
      [membership(createdStops[0].id, 1), membership(createdStops[1].id, 2)],
      { id: admin.id, requestId: "stop-replacement-race-b" }
    )
  ]);
  assert(stopReplacementRace.filter((result) => result.status === "fulfilled").length === 1, "Concurrent stop replacement did not have one winner");
  const cloneAfterReplacement = await service.getAdminVersion(clones[0].resource.id);
  assert(cloneAfterReplacement.draft_revision === clones[0].resource.draft_revision + 1, "Stop replacement did not increment revision exactly once");
  assert(cloneAfterReplacement.geometry_status === "pending" && cloneAfterReplacement.geometry_checksum === null, "Stop replacement retained stale geometry readiness");
  await expectFailure(
    () => service.updateStop(
      createdStops[1].id,
      {
        serviceRegionKey: identity.serviceRegionKey,
        nameAr: "محطة معدلة",
        nameEn: "Mutated stop",
        latitude: "31.610001",
        longitude: "35.140001"
      },
      { id: admin.id, requestId: "used-stop-edit" }
    ),
    "used_stop_immutable"
  );

  const pointerProbeRoute = await service.createRoute(
    {
      routeKey: "integration-pointer-probe",
      routeGroupKey: "integration-pointer-probe",
      serviceRegionKey: identity.serviceRegionKey,
      direction: "outbound"
    },
    actor(admin.id, "pointer-probe-route")
  );
  await expectFailure(() => prisma.serviceRoute.update({
    where: { id: pointerProbeRoute.resource.id },
    data: { current_version_id: clones[0].resource.id }
  }));
  await service.retireRoute(pointerProbeRoute.resource.id, { reason: "integration_cleanup", expectedCurrentVersionId: null }, actor(admin.id, "retire-pointer-probe"));

  await expectFailure(
    () => service.updateDraft(currentVersionId, { ...versionDraft, expectedRevision: currentVersion.draft_revision }, { id: admin.id, requestId: "published-edit" }),
    "published_version_immutable"
  );
  await expectFailure(() => prisma.serviceRouteVersion.delete({ where: { id: currentVersionId } }));
  await expectFailure(() => prisma.stop.delete({ where: { id: createdStops[0].id } }));

  const concurrentLifecycle = await Promise.allSettled([
    service.pauseVersion(currentVersionId, { reason: "integration_concurrent_pause", expectedCurrentVersionId: currentVersionId }, actor(admin.id, "pause-concurrent")),
    service.resumeVersion(currentVersionId, { expectedCurrentVersionId: currentVersionId }, actor(admin.id, "resume-concurrent"))
  ]);
  assert(concurrentLifecycle.some((result) => result.status === "fulfilled"), "Concurrent pause/resume produced no committed transition");
  const afterConcurrentLifecycle = await service.getAdminVersion(currentVersionId);
  assert(
    (afterConcurrentLifecycle.status === "published" && afterConcurrentLifecycle.paused_at === null && afterConcurrentLifecycle.pause_reason === null) ||
      (afterConcurrentLifecycle.status === "paused" && afterConcurrentLifecycle.paused_at !== null && afterConcurrentLifecycle.pause_reason !== null),
    "Concurrent pause/resume left contradictory lifecycle metadata"
  );
  if (afterConcurrentLifecycle.status === "paused") {
    await service.resumeVersion(currentVersionId, { expectedCurrentVersionId: currentVersionId }, actor(admin.id, "resume-after-concurrent"));
  }

  await service.pauseVersion(currentVersionId, { reason: "integration_pause", expectedCurrentVersionId: currentVersionId }, actor(admin.id, "pause-current"));
  const pausedCatalog = await service.listPublishedRoutes(1, 50);
  assert(pausedCatalog.routes.some((route) => route.id === createdRoute.resource.id), "Paused current route disappeared from safe catalog");
  await service.resumeVersion(currentVersionId, { expectedCurrentVersionId: currentVersionId }, actor(admin.id, "resume-current"));
  await service.pauseVersion(currentVersionId, { reason: "integration_retire", expectedCurrentVersionId: currentVersionId }, actor(admin.id, "pause-before-retire"));
  await service.retireVersion(currentVersionId, { reason: "integration_retire", expectedCurrentVersionId: currentVersionId }, actor(admin.id, "retire-current"));
  await expectFailure(() => service.resumeVersion(currentVersionId, { expectedCurrentVersionId: currentVersionId }, actor(admin.id, "resume-retired")), "current_version_conflict");
  await expectFailure(
    () => service.retireRoute(createdRoute.resource.id, { reason: "too_early", expectedCurrentVersionId: null }, actor(admin.id, "retire-route-early")),
    "service_route_versions_not_retired"
  );
  await service.retireStop(createdStops[0].id, "integration_retired_source", actor(admin.id, "retire-clone-source-stop"));
  await expectFailure(
    () => service.createVersion(
      createdRoute.resource.id,
      { ...versionDraft, cloneFromVersionId: currentVersionId },
      actor(admin.id, "clone-retired-stop")
    ),
    "clone_contains_inactive_stop"
  );

  const driverProfile = await prisma.driverProfile.findFirstOrThrow({ where: { user: { demo_account: true } } });
  await expectFailure(() => prisma.driverRoute.create({
    data: {
      driver_id: driverProfile.id,
      origin_label: "Constraint origin",
      origin_lat: "31.500000",
      origin_lng: "35.000000",
      destination_label: "Constraint destination",
      destination_lat: "31.600000",
      destination_lng: "35.100000",
      corridor_key: "constraint-check",
      seats_available: 2,
      parcel_capacity_available: 0,
      total_seats: 1,
      remaining_seats: 2,
      total_parcel_capacity: 0,
      remaining_parcel_capacity: 0,
      availability_status: "draft"
    }
  }));

  const allVersions = await prisma.serviceRouteVersion.findMany({ where: { service_route_id: createdRoute.resource.id } });
  for (const version of allVersions) {
    if (version.status !== "retired") {
      await service.retireVersion(version.id, { reason: "integration_cleanup", expectedCurrentVersionId: null }, actor(admin.id, `retire-${version.version_number}`));
    }
  }
  await service.retireRoute(createdRoute.resource.id, { reason: "integration_cleanup", expectedCurrentVersionId: null }, actor(admin.id, "retire-route-final"));

  const routeAudits = await prisma.auditEvent.findMany({
    where: { action: { in: [
      "route_created", "route_version_created", "route_draft_updated", "route_stops_updated",
      "route_version_published", "route_version_paused", "route_version_resumed", "route_version_retired",
      "route_retired", "stop_created"
    ] } },
    select: { metadata: true }
  });
  const allowedAuditKeys = new Set([
    "request_id", "direction", "route_id", "version_number", "transition", "revision", "stop_count", "reason_code"
  ]);
  for (const event of routeAudits) {
    const metadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
      ? event.metadata as Record<string, unknown>
      : {};
    assert(Object.keys(metadata).every((field) => allowedAuditKeys.has(field)), "Route audit metadata exceeded its allowlist");
    const serialized = JSON.stringify(metadata);
    assert(!/latitude|longitude|description|password|token|credential/i.test(serialized), "Route audit metadata contains sensitive detail");
  }

  await resetDemoData();
  const cleanupCounts = await demoCounts();
  assert(JSON.stringify(cleanupCounts) === JSON.stringify(firstReset), "Final route integration cleanup was not deterministic");
  assert(await prisma.serviceRoute.count({ where: { route_key: identity.routeKey } }) === 0, "Integration route survived cleanup");

  process.stdout.write("M7B real-MySQL route lifecycle and concurrency checks passed\n");
}

main()
  .catch((error) => {
    process.stderr.write(`M7B route integration failed: ${error instanceof Error ? error.message : "unknown_error"}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
