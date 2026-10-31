import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  passengerRequest: { groupBy: vi.fn(), findMany: vi.fn() },
  merchantOrder: { groupBy: vi.fn(), findMany: vi.fn() },
  trip: { groupBy: vi.fn(), findMany: vi.fn() },
  match: { groupBy: vi.fn() },
  parcel: { count: vi.fn() },
  driverProfile: { count: vi.fn() },
  driverVerification: { count: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { toCsv } = await import("../lib/csv.js");

const users: Record<string, { id: string; role: string; name: string; phone: string; demo_account: boolean }> = {
  admin_1: { id: "admin_1", role: "admin", name: "A", phone: "+7", demo_account: true },
  merchant_1: { id: "merchant_1", role: "merchant", name: "M", phone: "+5", demo_account: true },
  driver_1: { id: "driver_1", role: "driver", name: "D", phone: "+3", demo_account: true }
};

function auth(id: keyof typeof users) {
  const token = jwt.sign({ role: users[id].role, sid: `session_${id}`, ver: 1 }, "test-only-jwt-secret-with-at-least-thirty-two-characters", {
    subject: id,
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

describe("csv writer", () => {
  it("quotes separators and neutralizes spreadsheet formulas", () => {
    const csv = toCsv(["a", "b"], [['x,"y"', "=HYPERLINK(1)"], ["+1", "-2"], [null, new Date("2026-10-25T10:00:00Z")]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"x,""y""",\'=HYPERLINK(1)');
    expect(csv).toContain("'+1,'-2");
    expect(csv).toContain(",2026-10-25T10:00:00.000Z");
  });

  it("does not alter numbers, even negative ones", () => {
    expect(toCsv(["n"], [[-5]])).toContain("\r\n-5\r\n");
  });
});

describe("reports API", () => {
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

  it("restricts admin reports to admins and merchant reports to merchants", async () => {
    await request(createApp()).get("/api/v1/admin/reports/summary").set(auth("merchant_1")).expect(403);
    await request(createApp()).get("/api/v1/merchant/reports/summary").set(auth("admin_1")).expect(403);
    await request(createApp()).get("/api/v1/admin/reports/summary").expect(401);
  });

  it("summarizes the corridor operation by status", async () => {
    prismaMock.passengerRequest.groupBy.mockResolvedValue([
      { status: "pending", _count: { _all: 2 } },
      { status: "completed", _count: { _all: 3 } }
    ]);
    prismaMock.merchantOrder.groupBy.mockResolvedValue([{ status: "submitted", _count: { _all: 4 } }]);
    prismaMock.trip.groupBy.mockResolvedValue([{ status: "in_transit", _count: { _all: 1 } }]);
    prismaMock.match.groupBy.mockResolvedValue([]);
    prismaMock.parcel.count.mockResolvedValue(9);
    prismaMock.driverProfile.count.mockResolvedValueOnce(5).mockResolvedValueOnce(4);
    prismaMock.driverVerification.count.mockResolvedValue(1);

    const response = await request(createApp()).get("/api/v1/admin/reports/summary").set(auth("admin_1")).expect(200);

    expect(response.body.passenger_requests).toEqual({ total: 5, by_status: { pending: 2, completed: 3 } });
    expect(response.body.merchant_orders).toMatchObject({ total: 4, parcels: 9 });
    expect(response.body.trips.by_status).toEqual({ in_transit: 1 });
    expect(response.body.drivers).toEqual({ total: 5, verified: 4, pending_verification: 1 });
    expect(prismaMock.trip.groupBy.mock.calls[0][0].where.operational_mode).toBe("legacy");
  });

  it("applies the date range and rejects an inverted one", async () => {
    prismaMock.passengerRequest.groupBy.mockResolvedValue([]);
    prismaMock.merchantOrder.groupBy.mockResolvedValue([]);
    prismaMock.trip.groupBy.mockResolvedValue([]);
    prismaMock.match.groupBy.mockResolvedValue([]);
    prismaMock.parcel.count.mockResolvedValue(0);
    prismaMock.driverProfile.count.mockResolvedValue(0);
    prismaMock.driverVerification.count.mockResolvedValue(0);

    await request(createApp())
      .get("/api/v1/admin/reports/summary?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z")
      .set(auth("admin_1"))
      .expect(200);
    const where = prismaMock.passengerRequest.groupBy.mock.calls[0][0].where;
    expect(where.created_at.gte).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(where.created_at.lte).toEqual(new Date("2026-10-31T00:00:00Z"));

    await request(createApp())
      .get("/api/v1/admin/reports/summary?from=2026-11-01T00:00:00Z&to=2026-10-01T00:00:00Z")
      .set(auth("admin_1"))
      .expect(400);
  });

  it("exports a CSV with safe cells and a download header", async () => {
    prismaMock.merchantOrder.findMany.mockResolvedValue([
      { id: "o1", status: "submitted", pickup_label: "=cmd|' /C calc'!A0", created_at: new Date("2026-10-25T10:00:00Z"), _count: { parcels: 2 } }
    ]);

    const response = await request(createApp()).get("/api/v1/admin/reports/export?dataset=orders").set(auth("admin_1")).expect(200);

    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("masari-orders.csv");
    expect(response.text).toContain("id,status,pickup,parcels,created_at");
    expect(response.text).toContain("'=cmd|");
    expect(prismaMock.merchantOrder.findMany.mock.calls[0][0].take).toBe(5000);
  });

  it("rejects an unknown export dataset", async () => {
    await request(createApp()).get("/api/v1/admin/reports/export?dataset=users").set(auth("admin_1")).expect(400);
  });

  it("scopes the merchant summary to the caller", async () => {
    prismaMock.merchantOrder.groupBy.mockResolvedValue([{ status: "assigned", _count: { _all: 2 } }]);
    prismaMock.parcel.count.mockResolvedValue(3);
    prismaMock.trip.groupBy.mockResolvedValue([{ status: "delivered", _count: { _all: 1 } }]);

    const response = await request(createApp()).get("/api/v1/merchant/reports/summary").set(auth("merchant_1")).expect(200);

    expect(response.body.orders).toEqual({ total: 2, by_status: { assigned: 2 }, parcels: 3 });
    expect(response.body.trips.by_status).toEqual({ delivered: 1 });
    expect(prismaMock.merchantOrder.groupBy.mock.calls[0][0].where.merchant_id).toBe("merchant_1");
    expect(prismaMock.trip.groupBy.mock.calls[0][0].where.merchant_order.merchant_id).toBe("merchant_1");
  });
});
