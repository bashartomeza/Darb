import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({ prisma: {} }));
const {
  createPassengerParcelService,
  issueHandoverOnCreated,
  passengerParcelTrackingState,
  PASSENGER_PARCEL_LIMITS,
  purgeExpiredPassengerParcelReceivers,
  serializePassengerParcel
} = await import("../services/passengerParcels.js");

const actor = { id: "passenger_1", idempotencyKey: "parcel-key-0001" };
const until = new Date("2026-11-01T12:00:00Z");
const input = {
  routeVersionId: "route_1",
  pickupStopId: "stop_a",
  dropoffStopId: "stop_b",
  requestedDepartureFrom: new Date("2026-11-01T10:00:00Z"),
  requestedDepartureUntil: until,
  size: "S" as const,
  note: "fragile",
  receiverName: "Sami",
  receiverPhone: "+970591234567",
  forbiddenItemsAcknowledged: true as const
};

function detailRow(overrides: Record<string, unknown> = {}, order: Record<string, unknown> = {}, parcel: Record<string, unknown> = {}) {
  return {
    id: "detail_1", order_id: "order_1", sender_id: "passenger_1", size: "S", note: "fragile",
    receiver_name: "Sami", receiver_phone: "+970591234567", receiver_purged_at: null, created_at: new Date(),
    order: {
      status: "submitted", pickup_label: "A", route_version_id: "route_1", pickup_stop_id: "stop_a",
      requested_departure_from: input.requestedDepartureFrom, requested_departure_until: until,
      parcels: [{ status: "pending", destination_label: "B", destination_stop_id: "stop_b", ...parcel }],
      canonical_dispatch: { status: "pending" }, ...order
    },
    ...overrides
  };
}

function makeDb(counts: { open?: number; recent?: number } = {}) {
  const db: any = {
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ id: "x" }]),
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
    passengerParcelDetail: {
      count: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(where.order ? counts.open ?? 0 : counts.recent ?? 0)),
      create: vi.fn().mockResolvedValue({ id: "detail_1" }),
      findFirst: vi.fn().mockResolvedValue(detailRow()),
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn(),
      updateMany: vi.fn()
    },
    canonicalDemandDispatch: { findUnique: vi.fn().mockResolvedValue({ id: "dispatch_1" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    merchantOrder: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    parcel: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditEvent: { create: vi.fn() }
  };
  return db;
}

function makeDemand(db: unknown, replayed = false) {
  return {
    createMerchantOrder: vi.fn(async (_input: unknown, _actor: unknown, options: any) => {
      if (!replayed) {
        await options.beforeCreate(db);
        await options.afterCreate(db, { orderId: "order_1", parcelIds: ["parcel_1"], routeVersionId: "route_1" });
      }
      return { resource: { id: "order_1" }, replayed };
    })
  };
}

describe("passenger parcel creation", () => {
  it("goes through the shared merchant order path as a single normal-priority parcel", async () => {
    const db = makeDb();
    const demand = makeDemand(db);
    const service = createPassengerParcelService(db, demand as never);
    const result = await service.create(input, actor);
    expect(result.replayed).toBe(false);
    expect(demand.createMerchantOrder).toHaveBeenCalledWith(
      expect.objectContaining({ parcels: [{ destinationStopId: "stop_b", size: "S", priority: "normal" }] }),
      actor,
      expect.objectContaining({ operation: "passenger_parcel_create" })
    );
  });

  it("stores the receiver minimally with a retention date after the departure window", async () => {
    const db = makeDb();
    await createPassengerParcelService(db, makeDemand(db) as never).create(input, actor);
    const data = db.passengerParcelDetail.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ order_id: "order_1", sender_id: "passenger_1", receiver_name: "Sami", receiver_phone: "+970591234567" });
    expect(data.forbidden_items_ack_at).toBeInstanceOf(Date);
    expect(data.retention_expires_at.getTime()).toBe(until.getTime() + PASSENGER_PARCEL_LIMITS.receiverRetentionDays * 86_400_000);
  });

  it("offers a creation hook inside the transaction with the new ids", async () => {
    const db = makeDb();
    const onCreated = vi.fn();
    await createPassengerParcelService(db, makeDemand(db) as never, { onCreated }).create(input, actor);
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({
      tx: db, senderId: "passenger_1", orderId: "order_1", parcelId: "parcel_1", detailId: "detail_1", receiverPhone: "+970591234567"
    }));
  });

  it("issues a receiver handover for the new parcel order inside the transaction", async () => {
    const tx = {
      deliveryHandover: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn()
      }
    };
    await issueHandoverOnCreated({ tx: tx as never, orderId: "order_1" });
    expect(tx.deliveryHandover.create).toHaveBeenCalledTimes(1);
    const data = tx.deliveryHandover.create.mock.calls[0][0].data;
    expect(data.merchant_order_id).toBe("order_1");
    expect(data.code_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not run the hook or write a detail row on an idempotent replay", async () => {
    const db = makeDb();
    const onCreated = vi.fn();
    const result = await createPassengerParcelService(db, makeDemand(db, true) as never, { onCreated }).create(input, actor);
    expect(result.replayed).toBe(true);
    expect(onCreated).not.toHaveBeenCalled();
    expect(db.passengerParcelDetail.create).not.toHaveBeenCalled();
  });

  it("refuses a fourth open parcel", async () => {
    const db = makeDb({ open: PASSENGER_PARCEL_LIMITS.maximumOpen });
    await expect(createPassengerParcelService(db, makeDemand(db) as never).create(input, actor))
      .rejects.toMatchObject({ statusCode: 409, message: "passenger_parcel_limit_reached" });
    expect(db.passengerParcelDetail.create).not.toHaveBeenCalled();
  });

  it("refuses more than the daily number of parcels", async () => {
    const db = makeDb({ recent: PASSENGER_PARCEL_LIMITS.maximumPerDay });
    await expect(createPassengerParcelService(db, makeDemand(db) as never).create(input, actor))
      .rejects.toMatchObject({ statusCode: 429, message: "passenger_parcel_daily_limit_reached" });
  });

  it("serialises creations per passenger by locking the user row", async () => {
    const db = makeDb();
    await createPassengerParcelService(db, makeDemand(db) as never).create(input, actor);
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("`users`"), "passenger_1");
  });

  it("rejects large parcels and a missing acknowledgement before touching the database", async () => {
    const db = makeDb();
    const demand = makeDemand(db);
    const service = createPassengerParcelService(db, demand as never);
    await expect(service.create({ ...input, size: "L" as never }, actor)).rejects.toMatchObject({ message: "parcel_size_not_allowed" });
    await expect(service.create({ ...input, forbiddenItemsAcknowledged: false as never }, actor))
      .rejects.toMatchObject({ message: "forbidden_items_acknowledgement_required" });
    expect(demand.createMerchantOrder).not.toHaveBeenCalled();
  });
});

describe("passenger parcel cancellation", () => {
  it("cancels an unmatched parcel and erases the receiver", async () => {
    const db = makeDb();
    await createPassengerParcelService(db).cancel("passenger_1", "order_1");
    expect(db.merchantOrder.updateMany).toHaveBeenCalledWith({ where: { id: "order_1", status: "submitted" }, data: { status: "cancelled" } });
    expect(db.parcel.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "cancelled" } }));
    expect(db.canonicalDemandDispatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
    expect(db.passengerParcelDetail.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ receiver_name: null, receiver_phone: null, note: null })
    }));
  });

  it.each([
    ["offered to a driver", detailRow({}, { canonical_dispatch: { status: "offered" } })],
    ["assigned", detailRow({}, { status: "assigned" }, { status: "assigned" })],
    ["already cancelled", detailRow({}, { status: "cancelled" }, { status: "cancelled" })]
  ])("refuses to cancel a parcel that is %s", async (_label, row) => {
    const db = makeDb();
    db.passengerParcelDetail.findFirst.mockResolvedValue(row);
    await expect(createPassengerParcelService(db).cancel("passenger_1", "order_1"))
      .rejects.toMatchObject({ statusCode: 409, message: "parcel_cannot_be_cancelled" });
    expect(db.merchantOrder.updateMany).not.toHaveBeenCalled();
  });

  it("does not reveal another passenger's parcel", async () => {
    const db = makeDb();
    db.passengerParcelDetail.findFirst.mockResolvedValue(null);
    await expect(createPassengerParcelService(db).cancel("someone_else", "order_1"))
      .rejects.toMatchObject({ statusCode: 404, message: "parcel_not_found" });
  });
});

describe("passenger parcel tracking and privacy", () => {
  it.each([
    ["submitted", "pending", "searching"],
    ["matched", "batched", "searching"],
    ["assigned", "assigned", "assigned"],
    ["in_transit", "picked_up", "picked_up"],
    ["in_transit", "in_transit", "in_transit"],
    ["delivered", "delivered", "delivered"],
    ["completed", "delivered", "delivered"],
    ["cancelled", "cancelled", "cancelled"],
    ["failed", "failed", "failed"],
    ["expired", "expired", "expired"]
  ])("maps order %s / parcel %s to %s", (orderStatus, parcelStatus, expected) => {
    expect(passengerParcelTrackingState({ status: orderStatus }, parcelStatus)).toBe(expected);
  });

  it("shows the sender a masked receiver phone, never the full number", () => {
    const view = serializePassengerParcel(detailRow() as never);
    expect(view).toMatchObject({ tracking_state: "searching", can_cancel: true, receiver_name: "Sami" });
    expect(JSON.stringify(view)).not.toContain("+970591234567");
  });

  it("drops receiver data from the view once it has been erased", () => {
    const view = serializePassengerParcel(detailRow({ receiver_name: null, receiver_phone: null, note: null, receiver_purged_at: new Date() }) as never);
    expect(view).toMatchObject({ receiver_name: null, receiver_phone_masked: null, note: null, receiver_details_removed: true });
  });

  it("offers cancel only while no driver has been offered the parcel", () => {
    expect(serializePassengerParcel(detailRow({}, { canonical_dispatch: { status: "offered" } }) as never).can_cancel).toBe(false);
  });
});

describe("receiver retention purge", () => {
  it("erases receiver data on expired rows only", async () => {
    const db: any = {
      passengerParcelDetail: {
        findMany: vi.fn().mockResolvedValue([{ id: "a" }, { id: "b" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 2 })
      }
    };
    const now = new Date("2027-01-01T00:00:00Z");
    await expect(purgeExpiredPassengerParcelReceivers(db, { now })).resolves.toEqual({ purged: 2 });
    expect(db.passengerParcelDetail.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { retention_expires_at: { lt: now }, receiver_purged_at: null }
    }));
    expect(db.passengerParcelDetail.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { receiver_name: null, receiver_phone: null, note: null, receiver_purged_at: now }
    }));
  });

  it("does nothing when nothing has expired", async () => {
    const db: any = { passengerParcelDetail: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() } };
    await expect(purgeExpiredPassengerParcelReceivers(db)).resolves.toEqual({ purged: 0 });
    expect(db.passengerParcelDetail.updateMany).not.toHaveBeenCalled();
  });
});
