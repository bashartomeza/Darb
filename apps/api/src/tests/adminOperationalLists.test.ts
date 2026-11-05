import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), count: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  passengerRequest: { findMany: vi.fn(), count: vi.fn() },
  merchantOrder: { findMany: vi.fn(), count: vi.fn() },
  parcel: { count: vi.fn() },
  driverProfile: { findMany: vi.fn(), count: vi.fn() },
  driverRoute: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  driverVerification: { count: vi.fn() },
  incident: { count: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");

const users: Record<string, { id: string; role: string; name: string; phone: string; demo_account: boolean }> = {
  admin_1: { id: "admin_1", role: "admin", name: "Admin", phone: "+7", demo_account: false },
  driver_1: { id: "driver_1", role: "driver", name: "Driver", phone: "+3", demo_account: false }
};

function auth(id: keyof typeof users) {
  const token = jwt.sign({ role: users[id].role, sid: `session_${id}`, ver: 1 }, "test-only-jwt-secret-with-at-least-thirty-two-characters", {
    subject: id,
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

const unsafeUser = {
  id: "user_9",
  name: "Sender Nine",
  phone: "+9",
  email: null,
  role: "passenger",
  account_status: "active",
  status_reason: null,
  status_updated_at: new Date("2026-11-01T08:00:00Z"),
  last_login_at: null,
  demo_account: false,
  review_submitted_at: null,
  created_at: new Date("2026-11-01T08:00:00Z"),
  password_hash: "must-never-leak"
};

describe("admin operational lists", () => {
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
    prismaMock.authSession.update.mockResolvedValue({});
    prismaMock.auditEvent.create.mockResolvedValue({ id: "audit_1" });
    for (const model of [prismaMock.passengerRequest, prismaMock.merchantOrder, prismaMock.driverProfile, prismaMock.driverRoute]) {
      model.findMany.mockResolvedValue([]);
      model.count.mockResolvedValue(0);
    }
  });

  describe("dashboard", () => {
    beforeEach(() => {
      prismaMock.user.count.mockResolvedValue(10);
      prismaMock.driverProfile.count.mockResolvedValue(3);
      prismaMock.parcel.count.mockResolvedValue(8);
      prismaMock.driverRoute.groupBy.mockResolvedValue([]);
      prismaMock.driverVerification.count.mockResolvedValue(0);
      prismaMock.incident.count.mockResolvedValue(0);
      prismaMock.merchantOrder.count.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        if (JSON.stringify(where) === JSON.stringify({ passenger_parcel: null })) return 4;
        if (JSON.stringify(where) === JSON.stringify({ passenger_parcel: { isNot: null } })) return 6;
        return 2;
      });
      prismaMock.passengerRequest.count.mockImplementation((args?: { where?: unknown }) => (args?.where ? 1 : 5));
      prismaMock.driverRoute.count.mockImplementation((args?: { where?: unknown }) => (args?.where ? 1 : 7));
    });

    it("counts merchant orders without passenger parcels, and reports parcels separately", async () => {
      const response = await request(createApp()).get("/api/v1/admin/dashboard").set(auth("admin_1")).expect(200);
      expect(response.body.counts.merchant_orders).toBe(4);
      expect(response.body.counts.passenger_parcels).toBe(6);
      expect(response.body.alerts).toEqual({ unmatched_requests: 1, unbatched_orders: 2, unverified_driver_routes: 1 });
      expect(prismaMock.merchantOrder.count).toHaveBeenCalledWith({
        where: { passenger_parcel: null, status: { in: ["draft", "submitted"] } }
      });
      expect(prismaMock.passengerRequest.count).toHaveBeenCalledWith({ where: { status: { in: ["draft", "pending"] } } });
      expect(prismaMock.driverRoute.count).toHaveBeenCalledWith({ where: { status: "active", driver: { verified: false } } });
    });

    it("returns the newest records first with safe people details", async () => {
      prismaMock.passengerRequest.findMany.mockResolvedValue([{ id: "req_new", passenger: unsafeUser }]);
      prismaMock.merchantOrder.findMany.mockResolvedValue([{ id: "order_new", parcels: [], merchant: unsafeUser }]);
      const response = await request(createApp()).get("/api/v1/admin/dashboard").set(auth("admin_1")).expect(200);

      expect(prismaMock.passengerRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ created_at: "desc" }, { id: "asc" }], take: 5 })
      );
      expect(prismaMock.merchantOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { passenger_parcel: null }, orderBy: [{ created_at: "desc" }, { id: "asc" }], take: 5 })
      );
      expect(response.body.recent.passenger_requests[0].passenger.name).toBe("Sender Nine");
      expect(response.body.recent.merchant_orders[0].merchant.name).toBe("Sender Nine");
      expect(JSON.stringify(response.body)).not.toContain("must-never-leak");
    });
  });

  it.each([
    ["drivers", "driverProfile"],
    ["requests", "passengerRequest"],
    ["orders", "merchantOrder"],
    ["routes", "driverRoute"]
  ] as const)("/admin/%s returns every row without paging parameters", async (path, model) => {
    const response = await request(createApp()).get(`/api/v1/admin/${path}`).set(auth("admin_1")).expect(200);
    const query = prismaMock[model].findMany.mock.calls[0][0];
    expect(query.skip).toBeUndefined();
    expect(query.take).toBeUndefined();
    expect(response.body).not.toHaveProperty("total");
    expect(response.body[path]).toEqual([]);
  });

  it.each([
    ["drivers", "driverProfile"],
    ["requests", "passengerRequest"],
    ["orders", "merchantOrder"],
    ["routes", "driverRoute"]
  ] as const)("/admin/%s pages and counts when asked", async (path, model) => {
    prismaMock[model].count.mockResolvedValue(130);
    const response = await request(createApp()).get(`/api/v1/admin/${path}?page=3&limit=20`).set(auth("admin_1")).expect(200);
    const query = prismaMock[model].findMany.mock.calls[0][0];
    expect(query.skip).toBe(40);
    expect(query.take).toBe(20);
    expect(response.body).toMatchObject({ page: 3, limit: 20, total: 130 });
  });

  it("uses a default page size when only the page is given, and searches people by name", async () => {
    await request(createApp()).get("/api/v1/admin/requests?page=2&search=Nine").set(auth("admin_1")).expect(200);
    const query = prismaMock.passengerRequest.findMany.mock.calls[0][0];
    expect(query.skip).toBe(50);
    expect(query.take).toBe(50);
    expect(JSON.stringify(query.where)).toContain("Nine");
  });

  it("keeps passenger parcels out of the orders list, also when searching", async () => {
    await request(createApp()).get("/api/v1/admin/orders?limit=10&search=abc").set(auth("admin_1")).expect(200);
    expect(prismaMock.merchantOrder.findMany.mock.calls[0][0].where).toMatchObject({ passenger_parcel: null });
    expect(prismaMock.merchantOrder.count.mock.calls[0][0].where).toMatchObject({ passenger_parcel: null });
  });

  it("refuses bad paging values and non-admins", async () => {
    await request(createApp()).get("/api/v1/admin/drivers?limit=500").set(auth("admin_1")).expect(400);
    await request(createApp()).get("/api/v1/admin/drivers?page=0").set(auth("admin_1")).expect(400);
    await request(createApp()).get("/api/v1/admin/drivers?page=1").set(auth("driver_1")).expect(403);
  });
});
