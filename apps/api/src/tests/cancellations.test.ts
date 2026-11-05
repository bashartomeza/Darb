import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({ prisma: {} }));

const {
  adminCancelTrip,
  autoCancelDeadline,
  cancelMerchantOrder,
  cancelPassengerRequest,
  driverCancelTrip,
  isInsideWaitingWindow,
  serializeCancellation,
  waitingReferenceTime
} = await import("../services/cancellations.js");
const { CANCEL_REASONS, ALL_CANCEL_REASON_CODES, cancelBodySchema } = await import("../services/cancellationReasons.js");

const NOW = new Date("2026-11-12T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

/** A transaction client whose every method answers with a harmless default; tests override what they care about. */
function makeTx() {
  let sequence = 0;
  const tx: any = {
    $queryRaw: vi.fn(async () => []),
    trip: {
      findFirst: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => ({ id: "trip_1" })),
      update: vi.fn()
    },
    driverRoute: { findUnique: vi.fn(async () => ({ id: "route_1", status: "assigned" })), update: vi.fn() },
    passengerRequest: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    merchantOrder: { findFirst: vi.fn(), findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
    match: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
    parcel: { count: vi.fn(async () => 0), updateMany: vi.fn(async () => ({ count: 1 })) },
    parcelBatch: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null), update: vi.fn() },
    parcelBatchOrder: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      deleteMany: vi.fn(),
      updateMany: vi.fn()
    },
    passengerParcelDetail: { count: vi.fn(async () => 0), updateMany: vi.fn() },
    cancellation: {
      create: vi.fn(async ({ data }: any) => ({ id: `cancellation_${++sequence}`, ...data })),
      findMany: vi.fn(async () => [])
    },
    auditEvent: { create: vi.fn() },
    notification: { create: vi.fn() }
  };
  return tx;
}

const tripRow = (overrides: Record<string, unknown> = {}) => ({
  id: "trip_1",
  status: "accepted",
  driver_route_id: "route_1",
  passenger_request_id: "request_1",
  merchant_order_id: null,
  parcel_batch_id: null,
  driver_route: { driver: { user_id: "driver_user" } },
  ...overrides
});

const cancellationRows = (tx: any) => tx.cancellation.create.mock.calls.map(([args]: any) => args.data);
const notifications = (tx: any) => tx.notification.create.mock.calls.map(([args]: any) => args.data);

describe("cancellation reasons", () => {
  it("has a fixed list per kind of person and the system reason", () => {
    expect(CANCEL_REASONS.rider).toContain("changed_plans");
    expect(CANCEL_REASONS.driver).toContain("vehicle_problem");
    expect(CANCEL_REASONS.admin).toContain("safety_concern");
    expect(CANCEL_REASONS.sender).toContain("wrong_details");
    expect(ALL_CANCEL_REASON_CODES).toContain("no_driver_in_time");
    // The automatic reason is never one a person can choose.
    for (const kind of Object.values(CANCEL_REASONS)) expect(kind as readonly string[]).not.toContain("no_driver_in_time");
  });

  it("accepts a reason from the person's list with an optional trimmed note", () => {
    expect(cancelBodySchema("rider").parse({ reason: "changed_plans", note: "  later  " })).toEqual({ reason: "changed_plans", note: "later" });
    expect(cancelBodySchema("driver").parse({ reason: "emergency", note: "   " })).toEqual({ reason: "emergency", note: undefined });
  });

  it("rejects a missing reason, another kind's reason, the automatic reason and an over-long note", () => {
    expect(() => cancelBodySchema("rider").parse({})).toThrow();
    expect(() => cancelBodySchema("rider").parse({ reason: "vehicle_problem" })).toThrow();
    expect(() => cancelBodySchema("admin").parse({ reason: "no_driver_in_time" })).toThrow();
    expect(() => cancelBodySchema("sender").parse({ reason: "other", note: "x".repeat(301) })).toThrow();
  });
});

describe("the waiting window", () => {
  it("starts at the booked time when it is later than creation, otherwise at creation", () => {
    const created = new Date("2026-11-12T10:00:00Z");
    expect(waitingReferenceTime(created, new Date("2026-11-12T12:00:00Z"))).toEqual(new Date("2026-11-12T12:00:00Z"));
    expect(waitingReferenceTime(created, new Date("2026-11-12T09:00:00Z"))).toEqual(created);
    expect(waitingReferenceTime(created, null)).toEqual(created);
  });

  it("ends 45 minutes later by default and follows the configured minutes", () => {
    const reference = new Date("2026-11-12T10:00:00Z");
    expect(autoCancelDeadline(reference)).toEqual(new Date("2026-11-12T10:45:00Z"));
    expect(autoCancelDeadline(reference, 90)).toEqual(new Date("2026-11-12T11:30:00Z"));
    expect(isInsideWaitingWindow(reference, new Date("2026-11-12T10:44:59Z"))).toBe(true);
    expect(isInsideWaitingWindow(reference, new Date("2026-11-12T10:45:00Z"))).toBe(false);
  });
});

describe("what a cancelled item shows", () => {
  it("gives the reason, who and whether it was automatic, but never the note", () => {
    const at = new Date();
    expect(serializeCancellation([{ reason_code: "other", note: "private", automatic: false, actor_role: "driver", created_at: at }]))
      .toEqual({ reason: "other", by: "driver", automatic: false, at });
    expect(serializeCancellation([])).toBeNull();
    expect(serializeCancellation(undefined)).toBeNull();
  });
});

describe("a passenger cancels a ride request", () => {
  let tx: any;
  beforeEach(() => {
    tx = makeTx();
  });
  const rider = { userId: "passenger_1", role: "passenger" as const };
  const reason = { code: "changed_plans", note: "meeting moved" };

  it("cancels an accepted ride before pickup: trip cancelled, route reopened, driver told, passenger not", async () => {
    tx.passengerRequest.findFirst.mockResolvedValue({ id: "request_1", status: "accepted", passenger_id: "passenger_1", passenger_count: 2 });
    tx.passengerRequest.findUnique.mockResolvedValue({ id: "request_1", passenger_id: "passenger_1", passenger_count: 2 });
    tx.trip.findFirst.mockResolvedValue(tripRow());

    await cancelPassengerRequest(tx, { requestId: "request_1", ownerId: "passenger_1", actor: rider, reason });

    expect(tx.trip.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["accepted", "pickup_started"] } })
    }));
    expect(tx.trip.updateMany).toHaveBeenCalledWith({
      where: { id: "trip_1", status: "accepted" },
      data: expect.objectContaining({ status: "cancelled", cancelled_by_user_id: "passenger_1" })
    });
    // Seats given back once; the route goes back to waiting for work.
    expect(tx.driverRoute.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ seats_available: { increment: 2 }, status: "active" })
    }));
    expect(tx.driverRoute.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cancelled_at: expect.any(Date), completed_at: expect.any(Date) })
    }));
    expect(tx.passengerRequest.updateMany).toHaveBeenCalledWith({ where: { id: "request_1" }, data: { status: "cancelled" } });
    expect(tx.match.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "accepted" }),
      data: { status: "invalidated", legacy_demand_key: null, legacy_capacity_held: false }
    }));
    expect(cancellationRows(tx)).toEqual([expect.objectContaining({
      actor_user_id: "passenger_1", actor_role: "passenger", passenger_request_id: "request_1", trip_id: "trip_1",
      reason_code: "changed_plans", note: "meeting moved", automatic: false, ends_order: true
    })]);
    expect(notifications(tx)).toEqual([expect.objectContaining({
      user_id: "driver_user", type: "cancelled", entity_type: "Trip", entity_id: "trip_1",
      params: expect.objectContaining({ audience: "driver", by: "passenger", reason: "changed_plans", kind: "ride" })
    })]);
  });

  it("is refused once the ride is picked up", async () => {
    tx.passengerRequest.findFirst.mockResolvedValue({ id: "request_1", status: "picked_up", passenger_id: "passenger_1", passenger_count: 1 });
    await expect(cancelPassengerRequest(tx, { requestId: "request_1", ownerId: "passenger_1", actor: rider, reason }))
      .rejects.toMatchObject({ statusCode: 409, message: "request_cannot_be_cancelled" });
    expect(tx.cancellation.create).not.toHaveBeenCalled();
  });

  it("is refused for another passenger's request", async () => {
    tx.passengerRequest.findFirst.mockResolvedValue(null);
    await expect(cancelPassengerRequest(tx, { requestId: "request_1", ownerId: "someone_else", actor: rider, reason }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("an administrator can also cancel a ride that is under way, which cancels its trip", async () => {
    const admin = { userId: "admin_1", role: "admin" as const };
    tx.passengerRequest.findFirst.mockResolvedValue({ id: "request_1", status: "in_transit", passenger_id: "passenger_1", passenger_count: 1 });
    tx.passengerRequest.findUnique.mockResolvedValue({ id: "request_1", passenger_id: "passenger_1", passenger_count: 1 });
    tx.trip.findFirst.mockResolvedValue(tripRow({ status: "in_transit" }));

    await cancelPassengerRequest(tx, { requestId: "request_1", actor: admin, reason: { code: "safety_concern" } });

    expect(tx.trip.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["accepted", "pickup_started", "picked_up", "in_transit"] } })
    }));
    // Under way: the route is closed, not reopened.
    expect(tx.driverRoute.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "completed", cancelled_at: expect.any(Date) })
    }));
    const told = notifications(tx).map((n: any) => `${n.user_id}:${n.params.audience}`);
    expect(told.sort()).toEqual(["driver_user:driver", "passenger_1:owner"]);
    expect(cancellationRows(tx)[0]).toMatchObject({ actor_role: "admin", reason_code: "safety_concern", ends_order: true });
  });
});

describe("a driver cancels an accepted trip", () => {
  let tx: any;
  beforeEach(() => {
    tx = makeTx();
    tx.trip.findFirst.mockResolvedValue(tripRow());
    tx.passengerRequest.findUnique.mockResolvedValue({
      id: "request_1", passenger_id: "passenger_1", passenger_count: 1, created_at: minutesAgo(10), preferred_time: minutesAgo(5)
    });
  });
  const reason = { code: "vehicle_problem" };

  it("only the trip's own driver can cancel it", async () => {
    await expect(driverCancelTrip(tx, { tripId: "trip_1", driverUserId: "other_driver", reason, now: NOW }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(tx.trip.updateMany).not.toHaveBeenCalled();
  });

  it("not once the passenger or parcel is picked up", async () => {
    tx.trip.findFirst.mockResolvedValue(tripRow({ status: "picked_up" }));
    await expect(driverCancelTrip(tx, { tripId: "trip_1", driverUserId: "driver_user", reason, now: NOW }))
      .rejects.toMatchObject({ statusCode: 409, message: "trip_cannot_be_cancelled" });
  });

  it("is limited to three trips in 24 hours and refuses the fourth without changing anything", async () => {
    tx.cancellation.findMany.mockResolvedValue([{ trip_id: "a" }, { trip_id: "b" }, { trip_id: "c" }]);
    await expect(driverCancelTrip(tx, { tripId: "trip_1", driverUserId: "driver_user", reason, now: NOW }))
      .rejects.toMatchObject({ statusCode: 429, message: "driver_cancellation_limit_reached" });
    expect(tx.cancellation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ actor_user_id: "driver_user", actor_role: "driver", created_at: { gte: minutesAgo(24 * 60) } }),
      distinct: ["trip_id"]
    }));
    expect(tx.trip.updateMany).not.toHaveBeenCalled();
  });

  it("allows the third", async () => {
    tx.cancellation.findMany.mockResolvedValue([{ trip_id: "a" }, { trip_id: "b" }]);
    await expect(driverCancelTrip(tx, { tripId: "trip_1", driverUserId: "driver_user", reason, now: NOW })).resolves.toBeDefined();
  });

  it("inside the window the ride goes back to waiting; the trip counts as the driver's cancellation", async () => {
    const result = await driverCancelTrip(tx, { tripId: "trip_1", driverUserId: "driver_user", reason, now: NOW });

    expect(result.returnedToWaiting).toBe(1);
    // The trust score reads cancelled_by_user_id; the assignment key is freed so the ride can be accepted again.
    expect(tx.trip.updateMany).toHaveBeenCalledWith({
      where: { id: "trip_1", status: "accepted" },
      data: expect.objectContaining({ status: "cancelled", cancelled_by_user_id: "driver_user", legacy_assignment_key: null })
    });
    expect(tx.passengerRequest.updateMany).toHaveBeenCalledWith({ where: { id: "request_1", status: "accepted" }, data: { status: "pending" } });
    expect(tx.passengerRequest.updateMany).not.toHaveBeenCalledWith({ where: expect.anything(), data: { status: "cancelled" } });
    expect(tx.driverRoute.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ seats_available: { increment: 1 }, status: "active" })
    }));
    expect(cancellationRows(tx)).toEqual([expect.objectContaining({
      actor_role: "driver", reason_code: "vehicle_problem", ends_order: false, trip_id: "trip_1", automatic: false
    })]);
    expect(notifications(tx)).toEqual([expect.objectContaining({
      user_id: "passenger_1", type: "cancelled",
      params: expect.objectContaining({ audience: "owner", by: "driver", waiting: true, ends_order: false })
    })]);
  });

  it("past the window the ride is cancelled automatically instead", async () => {
    tx.passengerRequest.findUnique.mockResolvedValue({
      id: "request_1", passenger_id: "passenger_1", passenger_count: 1, created_at: minutesAgo(120), preferred_time: minutesAgo(60)
    });
    tx.passengerRequest.findFirst.mockResolvedValue({ id: "request_1", status: "pending", passenger_id: "passenger_1", passenger_count: 1 });

    const result = await driverCancelTrip(tx, { tripId: "trip_1", driverUserId: "driver_user", reason, now: NOW });

    expect(result.returnedToWaiting).toBe(0);
    expect(tx.passengerRequest.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { status: "cancelled" } }));
    expect(cancellationRows(tx)).toEqual([
      expect.objectContaining({ actor_role: "driver", ends_order: false }),
      expect.objectContaining({ actor_role: "system", actor_user_id: null, reason_code: "no_driver_in_time", automatic: true, ends_order: true })
    ]);
    // One notice for the passenger: the automatic cancellation, not "waiting".
    expect(notifications(tx)).toHaveLength(1);
    expect(notifications(tx)[0].params).toMatchObject({ automatic: true, by: "system", waiting: false });
  });

  it("a batch trip: orders inside their window wait again in the batch, orders past it are cancelled", async () => {
    tx.trip.findFirst.mockResolvedValue(tripRow({ passenger_request_id: null, merchant_order_id: "order_a", parcel_batch_id: "batch_1" }));
    tx.parcelBatchOrder.findMany.mockResolvedValue([{ merchant_order_id: "order_a" }, { merchant_order_id: "order_b" }]);
    tx.merchantOrder.findMany.mockResolvedValue([
      { id: "order_a", merchant_id: "merchant_1", created_at: minutesAgo(10), requested_departure_from: null },
      { id: "order_b", merchant_id: "merchant_1", created_at: minutesAgo(200), requested_departure_from: null }
    ]);
    tx.merchantOrder.findFirst.mockResolvedValue({ id: "order_b", status: "batched", merchant_id: "merchant_1" });
    tx.parcelBatchOrder.findFirst.mockResolvedValue({ parcel_batch: { id: "batch_1", merchant_order_id: "order_a" } });
    tx.parcelBatch.findUnique.mockResolvedValue({ id: "batch_1", merchant_order_id: "order_a" });

    await driverCancelTrip(tx, { tripId: "trip_1", driverUserId: "driver_user", reason, now: NOW });

    expect(tx.merchantOrder.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["order_a", "order_b"] }, status: "assigned" }, data: { status: "batched" } });
    expect(tx.parcelBatch.update).toHaveBeenCalledWith({ where: { id: "batch_1" }, data: { status: "created", driver_route_id: null } });
    // Only the late order leaves the batch, through the shared order cancellation.
    expect(tx.parcelBatchOrder.deleteMany).toHaveBeenCalledWith({ where: { parcel_batch_id: "batch_1", merchant_order_id: "order_b" } });
    const rows = cancellationRows(tx);
    expect(rows.filter((row: any) => row.ends_order === false).map((row: any) => row.merchant_order_id)).toEqual(["order_a", "order_b"]);
    expect(rows.filter((row: any) => row.automatic).map((row: any) => row.merchant_order_id)).toEqual(["order_b"]);
  });
});

describe("a merchant or parcel sender cancels an order", () => {
  let tx: any;
  beforeEach(() => {
    tx = makeTx();
  });
  const sender = { userId: "merchant_1", role: "merchant" as const };
  const reason = { code: "wrong_details" };

  it("an order a driver accepted, alone on its trip, cancels the trip and frees its parcels", async () => {
    tx.merchantOrder.findFirst.mockResolvedValue({ id: "order_a", status: "assigned", merchant_id: "merchant_1" });
    tx.trip.findFirst.mockResolvedValue(tripRow({ passenger_request_id: null, merchant_order_id: "order_a" }));
    tx.merchantOrder.findMany.mockResolvedValue([{ id: "order_a", merchant_id: "merchant_1" }]);
    tx.parcel.count.mockResolvedValue(2);

    const outcome = await cancelMerchantOrder(tx, { orderId: "order_a", ownerId: "merchant_1", actor: sender, reason });

    expect(outcome.tripId).toBe("trip_1");
    expect(tx.driverRoute.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ parcel_capacity_available: { increment: 2 }, status: "active" })
    }));
    expect(tx.merchantOrder.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["order_a"] } }, data: { status: "cancelled" } });
    expect(cancellationRows(tx)).toEqual([expect.objectContaining({
      actor_role: "merchant", merchant_order_id: "order_a", trip_id: "trip_1", reason_code: "wrong_details", ends_order: true
    })]);
    expect(notifications(tx)).toEqual([expect.objectContaining({
      user_id: "driver_user", params: expect.objectContaining({ audience: "driver", by: "merchant", kind: "order" })
    })]);
  });

  it("a passenger's parcel is told apart, and its receiver's details are erased", async () => {
    tx.merchantOrder.findFirst.mockResolvedValue({ id: "order_a", status: "submitted", merchant_id: "passenger_1" });
    tx.passengerParcelDetail.count.mockResolvedValue(1);

    await cancelMerchantOrder(tx, { orderId: "order_a", ownerId: "passenger_1", actor: { userId: "passenger_1", role: "passenger" }, reason: { code: "changed_plans" } });

    expect(tx.passengerParcelDetail.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { order_id: "order_a", receiver_purged_at: null },
      data: expect.objectContaining({ receiver_name: null, receiver_phone: null })
    }));
    expect(tx.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      metadata: expect.objectContaining({ action: "passenger_parcel_cancelled" })
    }) });
  });

  it("one order of an accepted batch leaves; the trip carries on and only its capacity is freed", async () => {
    tx.merchantOrder.findFirst.mockResolvedValue({ id: "order_a", status: "assigned", merchant_id: "merchant_1" });
    tx.trip.findFirst.mockResolvedValue(tripRow({ passenger_request_id: null, merchant_order_id: "order_a", parcel_batch_id: "batch_1" }));
    tx.parcelBatchOrder.findMany
      .mockResolvedValueOnce([{ merchant_order_id: "order_a" }, { merchant_order_id: "order_b" }])
      .mockResolvedValueOnce([{ merchant_order_id: "order_b" }]);
    tx.parcelBatch.findUnique.mockResolvedValue({ merchant_order_id: "order_a" });
    tx.parcel.count.mockResolvedValue(1);

    await cancelMerchantOrder(tx, { orderId: "order_a", ownerId: "merchant_1", actor: sender, reason });

    // Not a trip cancellation: the trip row is never claimed as cancelled.
    expect(tx.trip.updateMany).not.toHaveBeenCalled();
    expect(tx.merchantOrder.updateMany).toHaveBeenCalledWith({ where: { id: "order_a", status: "assigned", canonical_entry_version: null }, data: { status: "cancelled" } });
    expect(tx.driverRoute.update).toHaveBeenCalledTimes(1);
    expect(tx.driverRoute.update).toHaveBeenCalledWith({ where: { id: "route_1" }, data: { seats_available: undefined, parcel_capacity_available: { increment: 1 } } });
    expect(tx.parcel.updateMany).toHaveBeenCalledWith({ where: { order_id: "order_a" }, data: { status: "cancelled", batch_id: null } });
    expect(tx.parcelBatchOrder.deleteMany).toHaveBeenCalledWith({ where: { parcel_batch_id: "batch_1", merchant_order_id: "order_a" } });
    // The cancelled order led the batch and trip: the remaining order takes over.
    expect(tx.parcelBatch.update).toHaveBeenCalledWith({ where: { id: "batch_1" }, data: { merchant_order_id: "order_b" } });
    expect(tx.trip.update).toHaveBeenCalledWith({ where: { id: "trip_1" }, data: { merchant_order_id: "order_b" } });
    expect(notifications(tx)).toEqual([expect.objectContaining({
      user_id: "driver_user", params: expect.objectContaining({ audience: "driver", partial: true })
    })]);
  });

  it("not once the parcel is picked up (in transit), and not someone else's order", async () => {
    tx.merchantOrder.findFirst.mockResolvedValue({ id: "order_a", status: "in_transit", merchant_id: "merchant_1" });
    await expect(cancelMerchantOrder(tx, { orderId: "order_a", ownerId: "merchant_1", actor: sender, reason }))
      .rejects.toMatchObject({ statusCode: 409, message: "order_cannot_be_cancelled" });
    tx.merchantOrder.findFirst.mockResolvedValue(null);
    await expect(cancelMerchantOrder(tx, { orderId: "order_a", ownerId: "merchant_2", actor: sender, reason }))
      .rejects.toMatchObject({ statusCode: 404, message: "order_not_found" });
  });

  it("an accepted order whose trip is already picked up is refused for its sender, not for an administrator", async () => {
    tx.merchantOrder.findFirst.mockResolvedValue({ id: "order_a", status: "assigned", merchant_id: "merchant_1" });
    tx.trip.findFirst.mockResolvedValue(null);
    await expect(cancelMerchantOrder(tx, { orderId: "order_a", ownerId: "merchant_1", actor: sender, reason }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(tx.trip.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["accepted", "pickup_started"] } })
    }));
    await expect(cancelMerchantOrder(tx, { orderId: "order_a", actor: { userId: "admin_1", role: "admin" }, reason: { code: "duplicate" } }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(tx.trip.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["accepted", "pickup_started", "picked_up", "in_transit"] } })
    }));
  });
});

describe("an administrator cancels a trip", () => {
  it("cancels it with everything on it and tells the passenger and the driver", async () => {
    const tx = makeTx();
    tx.trip.findFirst.mockResolvedValue(tripRow({ status: "picked_up" }));
    tx.passengerRequest.findUnique.mockResolvedValue({ id: "request_1", passenger_id: "passenger_1", passenger_count: 1 });

    await adminCancelTrip(tx, { tripId: "trip_1", actorId: "admin_1", reason: { code: "safety_concern", note: "reported" } });

    expect(tx.trip.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "cancelled", cancelled_by_user_id: "admin_1" })
    }));
    expect(cancellationRows(tx)).toEqual([expect.objectContaining({ actor_role: "admin", actor_user_id: "admin_1", note: "reported" })]);
    expect(notifications(tx).map((n: any) => n.user_id).sort()).toEqual(["driver_user", "passenger_1"]);
  });

  it("refuses a trip that is finished", async () => {
    const tx = makeTx();
    tx.trip.findFirst.mockResolvedValue(tripRow({ status: "completed" }));
    await expect(adminCancelTrip(tx, { tripId: "trip_1", actorId: "admin_1", reason: { code: "duplicate" } }))
      .rejects.toMatchObject({ statusCode: 409, message: "trip_cannot_be_cancelled" });
    tx.trip.findFirst.mockResolvedValue(null);
    await expect(adminCancelTrip(tx, { tripId: "nope", actorId: "admin_1", reason: { code: "duplicate" } }))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});
