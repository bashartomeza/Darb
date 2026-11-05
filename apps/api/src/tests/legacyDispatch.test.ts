import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(async () => []),
  match: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  passengerRequest: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  merchantOrder: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  parcelBatch: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(async () => null), update: vi.fn() },
  parcelBatchOrder: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  parcel: { count: vi.fn(), updateMany: vi.fn() },
  passengerParcelDetail: { count: vi.fn(async () => 0), updateMany: vi.fn(async () => ({ count: 0 })) },
  driverRoute: { update: vi.fn() },
  auditEvent: { create: vi.fn() },
  cancellation: { create: vi.fn() },
  notification: { create: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { expireLegacyDispatches } = await import("../services/legacyDispatch.js");

const NOW = new Date("2026-10-08T12:00:00.000Z");

describe("legacy dispatch: offer expiry and automatic cancellation", () => {
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
    prismaMock.parcelBatchOrder.findFirst.mockResolvedValue(null);
    prismaMock.parcelBatchOrder.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.parcelBatch.findFirst.mockResolvedValue(null);
    prismaMock.parcelBatch.update.mockResolvedValue({});
    prismaMock.parcel.count.mockResolvedValue(0);
    prismaMock.parcel.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.driverRoute.update.mockResolvedValue({});
    prismaMock.auditEvent.create.mockResolvedValue({ id: "audit_1" });
    prismaMock.cancellation.create.mockResolvedValue({ id: "cancellation_1" });
    prismaMock.notification.create.mockResolvedValue({});
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
  });

  it("expires an unanswered driver offer and releases the held seats", async () => {
    prismaMock.match.findMany.mockResolvedValueOnce([{ id: "match_expired" }]);
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

    const result = await expireLegacyDispatches(prismaMock as never, { now: NOW, limit: 10 });

    expect(result.matchesExpired).toBe(1);
    expect(prismaMock.driverRoute.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "route_1" },
      data: { seats_available: { increment: 2 }, parcel_capacity_available: undefined }
    }));
    // The request itself is still waiting for another driver.
    expect(prismaMock.passengerRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "pending" } }));
  });

  it("selects ride requests no driver accepted, 45 minutes after the later of creation and booked time", async () => {
    await expireLegacyDispatches(prismaMock as never, { now: NOW, limit: 10 });

    const cutoff = new Date("2026-10-08T11:15:00.000Z");
    expect(prismaMock.passengerRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ["pending", "matched"] },
        created_at: { lte: cutoff },
        preferred_time: { lte: cutoff }
      })
    }));
  });

  it("selects orders and parcels no driver accepted, waiting for their booked time when it is later", async () => {
    await expireLegacyDispatches(prismaMock as never, { now: NOW, limit: 10 });

    const cutoff = new Date("2026-10-08T11:15:00.000Z");
    expect(prismaMock.merchantOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ["submitted", "batched", "matched"] },
        created_at: { lte: cutoff },
        OR: [{ requested_departure_from: null }, { requested_departure_from: { lte: cutoff } }]
      })
    }));
  });

  it("uses the configured number of minutes", async () => {
    await expireLegacyDispatches(prismaMock as never, { now: NOW, autoCancelMinutes: 90 });

    const where = prismaMock.passengerRequest.findMany.mock.calls[0]![0].where;
    expect(where.created_at).toEqual({ lte: new Date("2026-10-08T10:30:00.000Z") });
    expect(where.preferred_time).toEqual({ lte: new Date("2026-10-08T10:30:00.000Z") });
  });

  it("no longer expires by the old 72-hour age or by a parcel's departure window end", async () => {
    await expireLegacyDispatches(prismaMock as never, { now: NOW });

    const where = JSON.stringify(prismaMock.merchantOrder.findMany.mock.calls[0]![0].where);
    expect(where).not.toContain("requested_departure_until");
  });

  it("cancels an overdue ride request: seats back, offer withdrawn, recorded, owner and driver told", async () => {
    prismaMock.passengerRequest.findMany.mockResolvedValue([{ id: "request_1" }]);
    prismaMock.passengerRequest.findFirst.mockResolvedValue({ id: "request_1", status: "matched", passenger_id: "passenger_1", passenger_count: 2 });
    prismaMock.match.findMany.mockResolvedValue([{
      id: "match_1", driver_route_id: "route_1", legacy_capacity_held: true, merchant_order_id: null, parcel_batch_id: null,
      driver_route: { driver: { user_id: "driver_1" } }
    }]);

    const result = await expireLegacyDispatches(prismaMock as never, { now: NOW, limit: 10 });

    expect(result.requestsCancelled).toBe(1);
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "ReadCommitted" });
    expect(prismaMock.driverRoute.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.driverRoute.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "route_1" },
      data: { seats_available: { increment: 2 }, parcel_capacity_available: undefined }
    }));
    expect(prismaMock.passengerRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "cancelled" } }));
    expect(prismaMock.cancellation.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actor_user_id: null, actor_role: "system", passenger_request_id: "request_1",
      reason_code: "no_driver_in_time", automatic: true, ends_order: true
    }) });
    expect(prismaMock.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      user_id: "passenger_1", type: "cancelled", entity_type: "PassengerRequest", entity_id: "request_1",
      dedupe_key: "cancelled:cancellation_1",
      params: expect.objectContaining({ audience: "owner", by: "system", reason: "no_driver_in_time", automatic: true, kind: "ride" })
    }) });
    expect(prismaMock.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      user_id: "driver_1", type: "match_withdrawn", entity_id: "match_1"
    }) });
  });

  it("cancels an old order alone; its batch siblings stay batched and the batch can be offered again", async () => {
    prismaMock.merchantOrder.findMany.mockResolvedValue([{ id: "order_1" }]);
    prismaMock.merchantOrder.findFirst.mockResolvedValue({ id: "order_1", status: "matched", merchant_id: "merchant_1" });
    prismaMock.parcelBatchOrder.findFirst.mockResolvedValue({ parcel_batch: { id: "batch_1", merchant_order_id: "order_1" } });
    prismaMock.parcelBatchOrder.findMany.mockResolvedValue([{ merchant_order_id: "order_1" }, { merchant_order_id: "order_2" }]);
    prismaMock.match.findMany.mockResolvedValue([{ id: "match_1", driver_route_id: "route_1", legacy_capacity_held: true, driver_route: { driver: { user_id: "driver_1" } } }]);
    prismaMock.parcel.count.mockResolvedValue(4);

    const result = await expireLegacyDispatches(prismaMock as never, { now: NOW, limit: 10 });

    expect(result.ordersCancelled).toBe(1);
    expect(prismaMock.merchantOrder.updateMany).toHaveBeenCalledWith({
      where: { id: "order_1", status: "matched", canonical_entry_version: null },
      data: { status: "cancelled" }
    });
    // The pending offer carried the whole batch: it is withdrawn and its hold released once.
    expect(prismaMock.driverRoute.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.driverRoute.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "route_1" },
      data: expect.objectContaining({ parcel_capacity_available: { increment: 4 } })
    }));
    expect(prismaMock.match.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "invalidated", legacy_demand_key: null, legacy_capacity_held: false }
    }));
    // Only the old order leaves; its sibling goes back to waiting in the same batch.
    expect(prismaMock.parcelBatchOrder.deleteMany).toHaveBeenCalledWith({ where: { parcel_batch_id: "batch_1", merchant_order_id: "order_1" } });
    expect(prismaMock.parcel.updateMany).toHaveBeenCalledWith({ where: { order_id: "order_1" }, data: { status: "cancelled", batch_id: null } });
    expect(prismaMock.merchantOrder.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["order_2"] }, status: "matched" },
      data: { status: "batched" }
    });
    expect(prismaMock.parcelBatch.update).toHaveBeenCalledWith({
      where: { id: "batch_1" },
      data: { status: "created", driver_route_id: null, merchant_order_id: "order_2" }
    });
    expect(prismaMock.parcel.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: { batch_id: "batch_1" } }));
    // The driver hears the offer is gone; the merchant hears the order was cancelled and why.
    expect(prismaMock.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      user_id: "driver_1", type: "match_withdrawn", entity_id: "match_1", dedupe_key: "match_withdrawn:match_1", params: { reason: "cancelled" }
    }) });
    expect(prismaMock.cancellation.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actor_role: "system", merchant_order_id: "order_1", reason_code: "no_driver_in_time", automatic: true
    }) });
    expect(prismaMock.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      user_id: "merchant_1", type: "cancelled", entity_type: "MerchantOrder", entity_id: "order_1",
      params: expect.objectContaining({ audience: "owner", automatic: true, reason: "no_driver_in_time", kind: "order" })
    }) });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      entity_id: "order_1",
      metadata: expect.objectContaining({ action: "merchant_order_cancelled", automatic: true, parcel_batch_id: "batch_1", batch_orders_remaining: 1 })
    }) });
  });

  it("cancels the batch with its last order", async () => {
    prismaMock.merchantOrder.findMany.mockResolvedValue([{ id: "order_1" }]);
    prismaMock.merchantOrder.findFirst.mockResolvedValue({ id: "order_1", status: "batched", merchant_id: "merchant_1" });
    prismaMock.parcelBatchOrder.findFirst.mockResolvedValue({ parcel_batch: { id: "batch_1", merchant_order_id: "order_1" } });
    prismaMock.parcelBatchOrder.findMany.mockResolvedValue([{ merchant_order_id: "order_1" }]);

    const result = await expireLegacyDispatches(prismaMock as never, { now: NOW, limit: 10 });

    expect(result.ordersCancelled).toBe(1);
    expect(prismaMock.parcelBatch.update).toHaveBeenCalledWith({ where: { id: "batch_1" }, data: { status: "cancelled", driver_route_id: null } });
    expect(prismaMock.parcelBatchOrder.updateMany).toHaveBeenCalledWith({
      where: { parcel_batch_id: "batch_1" },
      data: { active: false, active_membership_key: null }
    });
    expect(prismaMock.parcel.updateMany).toHaveBeenCalledWith({ where: { batch_id: "batch_1" }, data: { status: "cancelled" } });
    expect(prismaMock.parcelBatchOrder.deleteMany).not.toHaveBeenCalled();
  });

  it("erases a cancelled passenger parcel's receiver details", async () => {
    prismaMock.merchantOrder.findMany.mockResolvedValue([{ id: "order_1" }]);
    prismaMock.merchantOrder.findFirst.mockResolvedValue({ id: "order_1", status: "submitted", merchant_id: "passenger_1" });
    prismaMock.passengerParcelDetail.count.mockResolvedValue(1);

    await expireLegacyDispatches(prismaMock as never, { now: NOW });

    expect(prismaMock.passengerParcelDetail.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { order_id: "order_1", receiver_purged_at: null },
      data: expect.objectContaining({ receiver_name: null, receiver_phone: null })
    }));
    expect(prismaMock.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      user_id: "passenger_1", params: expect.objectContaining({ kind: "parcel" })
    }) });
  });

  it("skips an order that changed state before the worker claimed it", async () => {
    prismaMock.merchantOrder.findMany.mockResolvedValue([{ id: "order_1" }]);
    prismaMock.merchantOrder.findFirst.mockResolvedValue({ id: "order_1", status: "batched", merchant_id: "merchant_1" });
    prismaMock.merchantOrder.updateMany.mockResolvedValue({ count: 0 });

    const result = await expireLegacyDispatches(prismaMock as never, { now: NOW });

    expect(result.ordersCancelled).toBe(0);
    expect(prismaMock.parcel.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.cancellation.create).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it("skips a request a driver accepted in the meantime", async () => {
    prismaMock.passengerRequest.findMany.mockResolvedValue([{ id: "request_1" }]);
    prismaMock.passengerRequest.findFirst.mockResolvedValue({ id: "request_1", status: "completed", passenger_id: "passenger_1", passenger_count: 1 });

    const result = await expireLegacyDispatches(prismaMock as never, { now: NOW });

    expect(result.requestsCancelled).toBe(0);
    expect(prismaMock.cancellation.create).not.toHaveBeenCalled();
  });
});
