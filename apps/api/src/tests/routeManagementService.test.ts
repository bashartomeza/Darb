import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../middleware/error.js";
import { assertRouteQaDatabase, requireRouteQaAdminPassword } from "../scripts/routeManagementQa.js";
import { assertExpectedCurrentVersion, createRouteManagementService } from "../services/routeManagement.js";

const actor = { id: "admin_1", requestId: "request_1", idempotencyKey: "route-lifecycle-001" };

describe("route management QA database guard", () => {
  it("accepts only the exact disposable database on the two explicitly local hosts", () => {
    expect(() => assertRouteQaDatabase("mysql://localhost:3306/darb_routes_qa")).not.toThrow();
    expect(() => assertRouteQaDatabase("mysql://127.0.0.1:3306/darb_routes_qa")).not.toThrow();

    for (const unsafeUrl of [
      "mysql://localhost:3306/darb",
      "mysql://database.internal:3306/darb_routes_qa",
      "mysql://localhost:3306",
      "mysql://localhost:3306/darb_routes_qa?database=darb",
      "mysql://localhost:3306/darb?database=darb_routes_qa",
      "mysql://localhost:3306/darb_routes_qa#darb"
    ]) {
      expect(() => assertRouteQaDatabase(unsafeUrl)).toThrow("route_qa_database_guard_rejected");
    }
  });

  it("requires a process-local QA admin password without applying a default", () => {
    expect(() => requireRouteQaAdminPassword(undefined)).toThrow("route_qa_admin_password_required");
    expect(() => requireRouteQaAdminPassword("short")).toThrow("route_qa_admin_password_required");
    expect(requireRouteQaAdminPassword("x".repeat(16))).toBe("x".repeat(16));
  });
});

function lifecycleHarness(options: {
  targetVersionId: string;
  currentVersionId: string | null;
  lockedStatus: "published" | "paused" | "retired";
}) {
  const tx = {
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([{ id: "route_1", status: "active", current_version_id: options.currentVersionId }])
      .mockResolvedValueOnce([{
        id: options.targetVersionId,
        service_route_id: "route_1",
        status: options.lockedStatus,
        draft_revision: 1
      }]),
    idempotencyRecord: {
      create: vi.fn().mockResolvedValue({ id: "claim_1", claim_version: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "claim_1" })
    },
    serviceRouteVersion: {
      findUnique: vi.fn().mockResolvedValue({
        id: options.targetVersionId,
        service_route_id: "route_1",
        active_from: null,
        active_until: null
      }),
      update: vi.fn().mockResolvedValue({ id: options.targetVersionId, status: "retired" })
    },
    serviceRoute: {
      update: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({ id: "route_1" })
    },
    driverRoute: { count: vi.fn().mockResolvedValue(0) },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: "audit_1" }) }
  };
  const db = {
    $transaction: async (operation: (transaction: typeof tx) => Promise<unknown>) => operation(tx),
    serviceRoute: tx.serviceRoute
  };
  return { service: createRouteManagementService(db as never), tx };
}

async function expectCurrentVersionConflict(action: (service: ReturnType<typeof createRouteManagementService>) => Promise<unknown>) {
  const { service, tx } = lifecycleHarness({
    targetVersionId: "version_current",
    currentVersionId: "version_current",
    lockedStatus: "published"
  });

  await expect(action(service)).rejects.toEqual(new HttpError(409, "current_version_conflict"));
  expect(tx.serviceRouteVersion.update).not.toHaveBeenCalled();
  expect(tx.auditEvent.create).not.toHaveBeenCalled();
  expect(tx.idempotencyRecord.updateMany).not.toHaveBeenCalled();
}

describe("RouteManagementService lifecycle fences", () => {
  it("rejects a stale observed current pointer and accepts an unchanged null pointer", () => {
    expect(() => assertExpectedCurrentVersion("version_2", "version_1"))
      .toThrowError(expect.objectContaining({ statusCode: 409, message: "current_version_conflict" }));
    expect(() => assertExpectedCurrentVersion(null, null)).not.toThrow();
  });

  it("rejects a stale current pointer before pausing a version", async () => {
    await expectCurrentVersionConflict((service) => service.pauseVersion(
      "version_current",
      { reason: "stale operator view", expectedCurrentVersionId: "version_previous" },
      actor
    ));
  });

  it("rejects a stale current pointer before resuming a version", async () => {
    await expectCurrentVersionConflict((service) => service.resumeVersion(
      "version_current",
      { expectedCurrentVersionId: "version_previous" },
      actor
    ));
  });

  it("rejects a stale current pointer before retiring a version", async () => {
    const { service, tx } = lifecycleHarness({
      targetVersionId: "version_historical",
      currentVersionId: "version_current",
      lockedStatus: "paused"
    });

    await expect(service.retireVersion(
      "version_historical",
      { reason: "stale operator view", expectedCurrentVersionId: "version_previous" },
      actor
    )).rejects.toEqual(new HttpError(409, "current_version_conflict"));
    expect(tx.serviceRouteVersion.update).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
    expect(tx.idempotencyRecord.updateMany).not.toHaveBeenCalled();
  });

  it("retires a historical version when its observed current pointer remains current", async () => {
    const { service, tx } = lifecycleHarness({
      targetVersionId: "version_historical",
      currentVersionId: "version_current",
      lockedStatus: "paused"
    });

    const result = await service.retireVersion(
      "version_historical",
      { reason: "superseded", expectedCurrentVersionId: "version_current" },
      actor
    );

    expect(result).toEqual({ resource: { id: "version_historical", status: "retired" }, replayed: false });
    expect(tx.serviceRoute.update).not.toHaveBeenCalled();
    expect(tx.serviceRouteVersion.update).toHaveBeenCalledOnce();
    expect(tx.auditEvent.create).toHaveBeenCalledOnce();
    expect(tx.idempotencyRecord.updateMany).toHaveBeenCalledOnce();
  });

  it("rejects route retirement unless the caller and locked route both have a null current pointer", async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValueOnce([{
        id: "route_1",
        status: "active",
        current_version_id: "version_current"
      }]),
      idempotencyRecord: {
        create: vi.fn().mockResolvedValue({ id: "claim_1", claim_version: 1 }),
        updateMany: vi.fn(),
        findUniqueOrThrow: vi.fn()
      },
      serviceRoute: {
        findUnique: vi.fn().mockResolvedValue({
          id: "route_1",
          status: "active",
          current_version_id: "version_current",
          versions: [{ status: "published" }]
        }),
        update: vi.fn()
      },
      driverRoute: { count: vi.fn() },
      auditEvent: { create: vi.fn() }
    };
    const db = {
      $transaction: async (operation: (transaction: typeof tx) => Promise<unknown>) => operation(tx),
      serviceRoute: tx.serviceRoute
    };
    const service = createRouteManagementService(db as never);

    await expect(service.retireRoute(
      "route_1",
      { reason: "stale route retirement", expectedCurrentVersionId: "version_current" } as never,
      actor
    )).rejects.toEqual(new HttpError(409, "current_version_conflict"));
    expect(tx.serviceRoute.update).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
    expect(tx.idempotencyRecord.updateMany).not.toHaveBeenCalled();
  });
});

describe("RouteManagementService admin detail query", () => {
  it("requests newest bounded versions and bounded ordered stops", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "route_1", versions: [], current_version: null });
    const service = createRouteManagementService({ serviceRoute: { findUnique } } as never);

    await expect(service.getAdminRoute("route_1")).resolves.toEqual({ id: "route_1", versions: [], current_version: null });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "route_1" },
      include: expect.objectContaining({
        versions: expect.objectContaining({
          take: 50,
          orderBy: [{ version_number: "desc" }, { id: "desc" }],
          include: expect.objectContaining({
            stops: expect.objectContaining({ take: 100, orderBy: { sequence: "asc" } })
          })
        })
      })
    });
  });
});

describe("route membership bounds", () => {
  it("rejects oversized service input before opening a transaction", async () => {
    const db = { $transaction: vi.fn() };
    const service = createRouteManagementService(db as never);
    const stops = Array.from({ length: 101 }, (_, index) => ({ stopId: `stop_${index}`, sequence: index + 1, passengerPickupAllowed: true, passengerDropoffAllowed: true, parcelPickupAllowed: true, parcelDropoffAllowed: true }));
    await expect(service.replaceStops("draft_1", 1, stops, actor)).rejects.toThrow("route_version_stop_limit_exceeded");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("does not expose a truncated oversized version as editable detail", async () => {
    const version = { id: "draft_1", status: "draft", stops: [], _count: { stops: 101 } };
    const db = { serviceRouteVersion: { findUnique: vi.fn().mockResolvedValue(version) }, serviceRoute: { findUnique: vi.fn().mockResolvedValue({ versions: [version], current_version: null }) } };
    const service = createRouteManagementService(db as never);
    await expect(service.getAdminVersion("draft_1")).rejects.toThrow("route_version_stop_limit_exceeded");
    await expect(service.getAdminRoute("route_1")).rejects.toThrow("route_version_stop_limit_exceeded");
  });
  it("preserves a valid ordered 100-stop detail", async () => {
    const stops = Array.from({ length: 100 }, (_, index) => ({ stop_id: `stop_${index}`, sequence: index + 1 }));
    const version = { id: "draft_1", stops, _count: { stops: 100 } };
    const service = createRouteManagementService({ serviceRouteVersion: { findUnique: vi.fn().mockResolvedValue(version) } } as never);
    expect(await service.getAdminVersion("draft_1")).toEqual(version);
  });
});

it("blocks replacement and metadata edits of an existing oversized draft before writes", async () => {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "draft_1", status: "draft", draft_revision: 1 }]),
    serviceRouteVersion: { findUnique: vi.fn().mockResolvedValue({ id: "draft_1", status: "draft", draft_revision: 1 }), updateMany: vi.fn() },
    routeVersionStop: { count: vi.fn().mockResolvedValue(101), deleteMany: vi.fn(), createMany: vi.fn() }
  };
  const service = createRouteManagementService({ $transaction: async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx) } as never);
  const stops = [0, 1].map(index => ({ stopId: `stop_${index}`, sequence: index + 1, passengerPickupAllowed: true, passengerDropoffAllowed: true, parcelPickupAllowed: true, parcelDropoffAllowed: true }));
  await expect(service.replaceStops("draft_1", 1, stops, actor)).rejects.toThrow("route_version_stop_limit_exceeded");
  await expect(service.updateDraft("draft_1", { nameAr: "name", nameEn: "name", expectedRevision: 1 }, actor)).rejects.toThrow("route_version_stop_limit_exceeded");
  expect(tx.routeVersionStop.deleteMany).not.toHaveBeenCalled();
  expect(tx.routeVersionStop.createMany).not.toHaveBeenCalled();
  expect(tx.serviceRouteVersion.updateMany).not.toHaveBeenCalled();
});
