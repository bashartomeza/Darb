import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  merchantOrder: { findUnique: vi.fn() },
  trip: { findMany: vi.fn(), count: vi.fn() },
  parcelBatchOrder: { findMany: vi.fn() },
  deliveryHandover: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const service = await import("../services/deliveryHandover.js");

const users: Record<string, { id: string; role: string }> = {
  merchant_1: { id: "merchant_1", role: "merchant" },
  passenger_1: { id: "passenger_1", role: "passenger" },
  driver_1: { id: "driver_1", role: "driver" },
  admin_1: { id: "admin_1", role: "admin" }
};

function auth(id: string) {
  const token = jwt.sign({ role: users[id].role, sid: `session_${id}`, ver: 1 }, "test-only-jwt-secret-with-at-least-thirty-two-characters", { subject: id, expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

const futureRow = () => ({
  id: "h1",
  merchant_order_id: "order_1",
  code_digest: "b".repeat(64),
  key_version: 1,
  failed_attempts: 2,
  expires_at: new Date(Date.now() + 60_000),
  confirmed_at: null,
  confirmation_method: null,
  unavailable_reason: null
});

describe("delivery handover service", () => {
  it("digests are keyed per order, deterministic, and never contain the code", () => {
    const key = { secret: "k".repeat(32), version: 1 };
    const a = service.handoverCodeDigest("order_1", "123456", key);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(service.handoverCodeDigest("order_1", "123456", key));
    expect(a).not.toBe(service.handoverCodeDigest("order_2", "123456", key));
    expect(a).not.toBe(service.handoverCodeDigest("order_1", "123456", { ...key, secret: "z".repeat(32) }));
  });

  it("generates six-digit numeric codes", () => {
    for (let i = 0; i < 50; i += 1) expect(service.generateHandoverCode()).toMatch(/^\d{6}$/);
  });

  it("describes state without exposing the digest", () => {
    const view = service.describeHandover(futureRow());
    expect(view).toMatchObject({ issued: true, confirmed: false, locked: false, expired: false, attempts_remaining: 3 });
    expect(JSON.stringify(view)).not.toContain("bbbb");
    expect(service.describeHandover({ ...futureRow(), failed_attempts: 5 }).locked).toBe(true);
    expect(service.describeHandover(null).issued).toBe(false);
  });

  it("malformed codes never reach the database", async () => {
    await expect(service.checkHandoverCode(prismaMock as never, "order_1", "12ab56")).rejects.toMatchObject({ statusCode: 422 });
    await expect(service.checkHandoverCode(prismaMock as never, "order_1", 123456)).rejects.toMatchObject({ statusCode: 422 });
    expect(prismaMock.deliveryHandover.findUnique).not.toHaveBeenCalled();
  });

  it("rotating a code resets attempts and refuses after confirmation", async () => {
    prismaMock.deliveryHandover.findUnique.mockResolvedValue(futureRow());
    prismaMock.deliveryHandover.updateMany.mockResolvedValue({ count: 1 });
    const issued = await service.issueHandover(prismaMock as never, "order_1");
    expect(issued.code).toMatch(/^\d{6}$/);
    expect(prismaMock.deliveryHandover.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { merchant_order_id: "order_1", confirmed_at: null },
      data: expect.objectContaining({ failed_attempts: 0 })
    }));
    prismaMock.deliveryHandover.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.issueHandover(prismaMock as never, "order_1")).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("sender handover endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      const user = where.id ? users[where.id] : undefined;
      return user ? { ...user, name: user.id, phone: "+1", demo_account: true, account_status: "active", email_verified_at: new Date(), security_version: 1 } : null;
    });
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const user = users[where.id.replace(/^session_/, "")];
      return user ? { id: where.id, user_id: user.id, user: { email_verified_at: new Date(), ...user, account_status: "active", security_version: 1 }, security_version_at_issue: 1, expires_at: new Date(Date.now() + 60_000), revoked_at: null } : null;
    });
    prismaMock.authSession.update.mockResolvedValue({});
    prismaMock.auditEvent.create.mockResolvedValue({});
    prismaMock.$transaction.mockImplementation((cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock));
  });

  it("the owner (merchant or passenger sender) sees state but never the code", async () => {
    prismaMock.merchantOrder.findUnique.mockResolvedValue({ id: "order_1", merchant_id: "passenger_1", status: "matched", delivery_handover: futureRow() });
    const response = await request(createApp()).get("/api/v1/parcel-orders/order_1/handover").set(auth("passenger_1")).expect(200);
    expect(response.body.handover).toMatchObject({ issued: true, attempts_remaining: 3 });
    expect(response.body.handover.code).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("bbbb");
  });

  it("other users cannot see or re-issue someone else's code", async () => {
    prismaMock.merchantOrder.findUnique.mockResolvedValue({ id: "order_1", merchant_id: "merchant_1", status: "matched", delivery_handover: futureRow() });
    await request(createApp()).get("/api/v1/parcel-orders/order_1/handover").set(auth("driver_1")).expect(404);
    await request(createApp()).post("/api/v1/parcel-orders/order_1/handover/regenerate").set(auth("passenger_1")).expect(404);
    await request(createApp()).post("/api/v1/parcel-orders/order_1/handover/regenerate").set(auth("admin_1")).expect(403);
  });

  it("regenerate returns a fresh code once and unlocks the order", async () => {
    prismaMock.merchantOrder.findUnique.mockResolvedValue({ id: "order_1", merchant_id: "merchant_1", status: "matched", delivery_handover: { ...futureRow(), failed_attempts: 5 } });
    prismaMock.deliveryHandover.findUnique.mockResolvedValue({ ...futureRow(), failed_attempts: 0 });
    prismaMock.deliveryHandover.updateMany.mockResolvedValue({ count: 1 });
    const response = await request(createApp()).post("/api/v1/parcel-orders/order_1/handover/regenerate").set(auth("merchant_1")).expect(200);
    expect(response.body.handover.code).toMatch(/^\d{6}$/);
    expect(response.body.handover.attempts_remaining).toBe(5);
  });

  it("closed orders cannot get a new code", async () => {
    prismaMock.merchantOrder.findUnique.mockResolvedValue({ id: "order_1", merchant_id: "merchant_1", status: "cancelled", delivery_handover: null });
    await request(createApp()).post("/api/v1/parcel-orders/order_1/handover/regenerate").set(auth("merchant_1")).expect(409);
  });
});

describe("admin delivery confirmation summary", () => {
  it("flags trips closed without the receiver's code and lists reasons", async () => {
    prismaMock.parcelBatchOrder.findMany.mockResolvedValue([{ parcel_batch_id: "batch_1", merchant_order_id: "order_2" }]);
    prismaMock.deliveryHandover.findMany.mockResolvedValue([
      { merchant_order_id: "order_1", confirmation_method: "receiver_code", unavailable_reason: null },
      { merchant_order_id: "order_2", confirmation_method: "receiver_unavailable", unavailable_reason: "Nobody home" }
    ]);
    const summary = await service.adminDeliveryConfirmations(prismaMock as never, [
      { id: "trip_a", merchant_order_id: "order_1", parcel_batch_id: "batch_1" },
      { id: "trip_b", merchant_order_id: null, parcel_batch_id: null }
    ]);
    expect(summary.get("trip_a")).toEqual({
      required: true,
      total_orders: 2,
      confirmed_orders: 2,
      methods: ["receiver_code", "receiver_unavailable"],
      flagged: true,
      reasons: ["Nobody home"]
    });
    expect(summary.get("trip_b")).toMatchObject({ required: false, flagged: false });
  });
});
