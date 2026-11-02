import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  notification: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  passengerRequest: { findUnique: vi.fn() },
  merchantOrder: { findUnique: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const service = await import("../services/notifications.js");

const users: Record<string, { id: string; role: string; name: string; phone: string; demo_account: boolean }> = {
  passenger_1: { id: "passenger_1", role: "passenger", name: "P1", phone: "+1", demo_account: true },
  driver_1: { id: "driver_1", role: "driver", name: "D1", phone: "+3", demo_account: true }
};

function auth(id: keyof typeof users) {
  const token = jwt.sign({ role: users[id].role, sid: `session_${id}`, ver: 1 }, "test-only-jwt-secret-with-at-least-thirty-two-characters", {
    subject: id,
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "n1",
  user_id: "passenger_1",
  type: "trip_status",
  entity_type: "Trip",
  entity_id: "trip_1",
  dedupe_key: "trip_status:trip_1:accepted",
  params: { status: "accepted" },
  read_at: null,
  created_at: new Date("2026-10-25T10:00:00Z"),
  ...overrides
});

describe("notifications API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      const user = where.id ? users[where.id] : undefined;
      return user ? { ...user, account_status: "active", security_version: 1 } : null;
    });
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const user = users[where.id.replace(/^session_/, "")];
      return user
        ? {
            id: where.id,
            user_id: user.id,
            user: { email_verified_at: new Date(), ...user, account_status: "active", security_version: 1 },
            security_version_at_issue: 1,
            expires_at: new Date(Date.now() + 60_000),
            revoked_at: null
          }
        : null;
    });
  });

  it("requires authentication", async () => {
    await request(createApp()).get("/api/v1/notifications").expect(401);
  });

  it("lists only the caller's notifications with an unread count", async () => {
    prismaMock.notification.findMany.mockResolvedValue([row()]);
    prismaMock.notification.count.mockResolvedValue(1);

    const response = await request(createApp()).get("/api/v1/notifications?limit=10").set(auth("passenger_1")).expect(200);

    expect(response.body.unread_count).toBe(1);
    expect(response.body.notifications[0]).toMatchObject({ id: "n1", type: "trip_status", params: { status: "accepted" } });
    expect(response.body.notifications[0]).not.toHaveProperty("user_id");
    expect(prismaMock.notification.findMany.mock.calls[0][0].where).toEqual({ user_id: "passenger_1" });
    expect(prismaMock.notification.count.mock.calls[0][0].where).toEqual({ user_id: "passenger_1", read_at: null });
  });

  it("filters to unread and rejects an out-of-range limit", async () => {
    prismaMock.notification.findMany.mockResolvedValue([]);
    prismaMock.notification.count.mockResolvedValue(0);
    await request(createApp()).get("/api/v1/notifications?unread_only=true").set(auth("driver_1")).expect(200);
    expect(prismaMock.notification.findMany.mock.calls[0][0].where).toEqual({ user_id: "driver_1", read_at: null });
    await request(createApp()).get("/api/v1/notifications?limit=500").set(auth("driver_1")).expect(400);
  });

  it("marks one notification read, scoped to the caller", async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.notification.findFirst.mockResolvedValue(row({ read_at: new Date() }));

    const response = await request(createApp()).post("/api/v1/notifications/n1/read").set(auth("passenger_1")).expect(200);

    expect(response.body.notification.read_at).not.toBeNull();
    expect(prismaMock.notification.updateMany.mock.calls[0][0].where).toEqual({ id: "n1", user_id: "passenger_1", read_at: null });
    expect(prismaMock.notification.findFirst.mock.calls[0][0].where).toEqual({ id: "n1", user_id: "passenger_1" });
  });

  it("treats someone else's notification as not found", async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.notification.findFirst.mockResolvedValue(null);
    await request(createApp()).post("/api/v1/notifications/other/read").set(auth("driver_1")).expect(404);
  });

  it("marks everything read for the caller only", async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 3 });
    const response = await request(createApp()).post("/api/v1/notifications/read-all").set(auth("driver_1")).expect(200);
    expect(response.body.updated).toBe(3);
    expect(prismaMock.notification.updateMany.mock.calls[0][0].where).toEqual({ user_id: "driver_1", read_at: null });
  });
});

describe("notification emission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never throws when the inbox write fails (duplicate or outage)", async () => {
    prismaMock.notification.create.mockRejectedValue(new Error("unique violation"));
    await expect(
      service.notify(prismaMock as never, { userId: "u1", type: "match_offered", dedupeKey: "k" })
    ).resolves.toBeUndefined();
  });

  it("skips events with no recipient", async () => {
    await service.notify(prismaMock as never, { userId: null, type: "match_offered", dedupeKey: "k" });
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it("notifies both the passenger and merchant behind a trip, keyed per status", async () => {
    prismaMock.passengerRequest.findUnique.mockResolvedValue({ passenger_id: "p1" });
    prismaMock.merchantOrder.findUnique.mockResolvedValue({ merchant_id: "m1" });
    prismaMock.notification.create.mockResolvedValue({});

    await service.notifyTripStatus(prismaMock as never, { id: "t1", passenger_request_id: "r1", merchant_order_id: "o1" }, "in_transit");

    const created = prismaMock.notification.create.mock.calls.map((call) => call[0].data);
    expect(created.map((data) => data.user_id)).toEqual(["p1", "m1"]);
    expect(created[0]).toMatchObject({ type: "trip_status", dedupe_key: "trip_status:t1:in_transit", params: { status: "in_transit" } });
  });

  it("tells both the passenger and the merchant when one match serves them together", async () => {
    prismaMock.notification.create.mockResolvedValue({});
    await service.notifyMatchDecision(
      prismaMock as never,
      { id: "m9", passenger_request: { passenger_id: "pax" }, merchant_order: { merchant_id: "mer" } },
      "accepted"
    );
    const created = prismaMock.notification.create.mock.calls.map((call) => call[0].data);
    expect(created.map((data) => data.user_id)).toEqual(["pax", "mer"]);
    expect(created.every((data) => data.type === "match_accepted" && data.dedupe_key === "match_accepted:m9")).toBe(true);
  });

  it("sends a match offer to the driver and the decision to the demand owner", async () => {
    prismaMock.notification.create.mockResolvedValue({});
    const match = {
      id: "m1",
      driver_route: { driver: { user_id: "drv" } },
      passenger_request: { passenger_id: "pax" },
      merchant_order: null
    };
    await service.notifyMatchOffered(prismaMock as never, match);
    await service.notifyMatchDecision(prismaMock as never, match, "rejected");
    const created = prismaMock.notification.create.mock.calls.map((call) => call[0].data);
    expect(created[0]).toMatchObject({ user_id: "drv", type: "match_offered" });
    expect(created[1]).toMatchObject({ user_id: "pax", type: "match_rejected", dedupe_key: "match_rejected:m1" });
  });
});
