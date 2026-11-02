import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  match: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  passengerRequest: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  merchantOrder: { findMany: vi.fn(), updateMany: vi.fn() },
  parcelBatch: { findMany: vi.fn(), update: vi.fn() },
  parcelBatchOrder: { findMany: vi.fn(), updateMany: vi.fn() },
  parcel: { count: vi.fn(), updateMany: vi.fn() },
  driverRoute: { update: vi.fn() },
  auditEvent: { create: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { expireLegacyDispatches } = await import("../services/legacyDispatch.js");

describe("legacy dispatch expiry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.match.findMany.mockResolvedValue([]);
    prismaMock.passengerRequest.findMany.mockResolvedValue([]);
    prismaMock.merchantOrder.findMany.mockResolvedValue([]);
    prismaMock.match.findUnique.mockResolvedValue(null);
    prismaMock.match.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.passengerRequest.findUnique.mockResolvedValue({ passenger_count: 1 });
    prismaMock.passengerRequest.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.merchantOrder.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.parcelBatch.findMany.mockResolvedValue([]);
    prismaMock.parcelBatchOrder.findMany.mockResolvedValue([]);
    prismaMock.parcelBatchOrder.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.parcelBatch.update.mockResolvedValue({});
    prismaMock.parcel.count.mockResolvedValue(0);
    prismaMock.parcel.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.driverRoute.update.mockResolvedValue({});
    prismaMock.auditEvent.create.mockResolvedValue({ id: "audit_1" });
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
  });

  it("expires an overdue passenger request and releases a held seat", async () => {
    const now = new Date("2026-10-08T12:00:00.000Z");
    prismaMock.match.findMany
      .mockResolvedValueOnce([{ id: "match_expired" }])
      .mockResolvedValueOnce([]);
    prismaMock.match.findUnique.mockResolvedValue({
      id: "match_expired",
      driver_route_id: "route_1",
      passenger_request_id: "request_1",
      merchant_order_id: null,
      parcel_batch_id: null,
      legacy_capacity_held: true,
      status: "proposed",
      expires_at: new Date("2026-10-08T11:00:00.000Z"),
      operational_mode: "legacy",
      canonical_match_version: null
    });
    prismaMock.passengerRequest.findUnique.mockResolvedValue({ passenger_count: 2 });
    prismaMock.passengerRequest.findMany.mockResolvedValue([{ id: "request_1" }]);

    const result = await expireLegacyDispatches(prismaMock as never, { now, limit: 10 });

    expect(result.matchesExpired).toBe(1);
    expect(result.requestsExpired).toBe(1);
    expect(prismaMock.driverRoute.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "route_1" },
      data: { seats_available: { increment: 2 }, parcel_capacity_available: undefined }
    }));
    expect(prismaMock.passengerRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "expired" }
    }));
  });

  it("expires overdue merchant orders, batches, and parcels together", async () => {
    const now = new Date("2026-10-08T12:00:00.000Z");
    prismaMock.merchantOrder.findMany.mockResolvedValue([{ id: "order_1" }]);
    prismaMock.parcelBatch.findMany.mockResolvedValue([{ id: "batch_1", driver_route_id: "route_1" }]);
    prismaMock.parcelBatchOrder.findMany.mockResolvedValue([{ parcel_batch_id: "batch_1" }]);
    prismaMock.match.findMany.mockResolvedValue([{ id: "match_1", driver_route_id: "route_1", passenger_request_id: null, merchant_order_id: "order_1", parcel_batch_id: "batch_1", legacy_capacity_held: true }]);
    prismaMock.parcel.count.mockResolvedValue(4);

    const result = await expireLegacyDispatches(prismaMock as never, { now, limit: 10 });

    expect(result.ordersExpired).toBe(1);
    expect(prismaMock.parcelBatch.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "batch_1" },
      data: { status: "expired", driver_route_id: null }
    }));
    expect(prismaMock.parcel.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { batch_id: "batch_1" },
      data: { status: "expired" }
    }));
    expect(prismaMock.merchantOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "order_1", status: { in: ["submitted", "batched", "matched"] } },
      data: { status: "expired" }
    }));
  });
});
