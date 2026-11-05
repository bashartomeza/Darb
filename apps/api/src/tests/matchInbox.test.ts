import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  match: { findMany: vi.fn(), findUnique: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");

type Role = "passenger" | "driver" | "merchant" | "admin";

const users: Record<string, { id: string; role: Role; name: string; phone: string; demo_account: boolean }> = {
  driver_1: { id: "driver_1", role: "driver", name: "Driver 1", phone: "+1", demo_account: true },
  driver_2: { id: "driver_2", role: "driver", name: "Driver 2", phone: "+2", demo_account: true },
  passenger_1: { id: "passenger_1", role: "passenger", name: "Passenger 1", phone: "+3", demo_account: true },
  passenger_2: { id: "passenger_2", role: "passenger", name: "Passenger 2", phone: "+4", demo_account: true },
  merchant_1: { id: "merchant_1", role: "merchant", name: "Merchant 1", phone: "+5", demo_account: true },
  merchant_2: { id: "merchant_2", role: "merchant", name: "Merchant 2", phone: "+6", demo_account: true },
  admin_1: { id: "admin_1", role: "admin", name: "Admin 1", phone: "+7", demo_account: true }
};

function auth(id: keyof typeof users) {
  const token = jwt.sign(
    { role: users[id].role, sid: `session_${id}`, ver: 1 },
    "test-only-jwt-secret-with-at-least-thirty-two-characters",
    { subject: id, expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}` };
}

function matchRecord(id: string, createdAt: string) {
  return {
    id,
    status: "proposed",
    score: "0.9317",
    method: "darb_route_score",
    explanation: "Safe explanation",
    scoring_breakdown: { corridorOverlap: 0.95, finalScore: 0.9317 },
    created_at: new Date(createdAt),
    password_hash: "must-never-leak",
    jwt: "must-never-leak",
    reset_key: "must-never-leak",
    driver_route: {
      id: "route_1",
      origin_label: "Hebron / PPU / Bab Al-Zawiya",
      destination_label: "Bethlehem",
      corridor_key: "hebron-ppu-bab-al-zawiya-to-bethlehem",
      seats_available: 2,
      parcel_capacity_available: 5,
      status: "active",
      driver: {
        user_id: "driver_1",
        user: { name: "Driver 1" },
        vehicle_type: "sedan",
        verified: true,
        trust_score: 86,
        phone: "+970-secret",
        password_hash: "must-never-leak"
      }
    },
    passenger_request: {
      id: "request_1",
      passenger_id: "passenger_1",
      pickup_label: "PPU Main Gate",
      destination_label: "Bethlehem Center",
      preferred_time: new Date("2026-07-02T09:00:00.000Z"),
      passenger_count: 1,
      status: "pending",
      created_at: new Date("2026-07-02T08:00:00.000Z"),
      phone: "+970-secret"
    },
    merchant_order: {
      id: "order_1",
      merchant_id: "merchant_1",
      pickup_label: "Hebron Merchant Pickup",
      status: "submitted",
      created_at: new Date("2026-07-02T08:00:00.000Z"),
      _count: { parcels: 5 },
      phone: "+970-secret"
    },
    parcel_batch: {
      id: "batch_1",
      status: "created",
      estimated_distance_saved: "86.12",
      explanation: "Five parcels share one corridor trip.",
      created_at: new Date("2026-07-02T08:30:00.000Z"),
      merchant_order_id: "order_1"
    }
  };
}

describe("role-filtered match inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (!where.id) return null;
      const user = users[where.id];
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
    prismaMock.match.findMany.mockResolvedValue([]);
  });

  it("rejects unauthenticated list requests", async () => {
    await request(createApp()).get("/api/v1/matches").expect(401);
    expect(prismaMock.match.findMany).not.toHaveBeenCalled();
  });

  it("filters a driver inbox to matches on the driver's routes", async () => {
    await request(createApp()).get("/api/v1/matches").set(auth("driver_1")).expect(200);

    expect(prismaMock.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { driver_route: { driver: { user_id: "driver_1" } } } })
    );
  });

  it("filters a passenger inbox to matches on the passenger's requests", async () => {
    await request(createApp()).get("/api/v1/matches").set(auth("passenger_1")).expect(200);

    expect(prismaMock.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { passenger_request: { passenger_id: "passenger_1" } } })
    );
  });

  it("filters a merchant inbox to matches on the merchant's orders", async () => {
    await request(createApp()).get("/api/v1/matches").set(auth("merchant_1")).expect(200);

    expect(prismaMock.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { merchant_order: { merchant_id: "merchant_1" } } })
    );
  });

  it("lets admins see all matches and requests newest-first ordering", async () => {
    prismaMock.match.findMany.mockResolvedValue([
      matchRecord("match_new", "2026-07-02T10:00:00.000Z"),
      matchRecord("match_old", "2026-07-02T09:00:00.000Z")
    ]);

    const response = await request(createApp()).get("/api/v1/matches").set(auth("admin_1")).expect(200);

    expect(prismaMock.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, orderBy: { created_at: "desc" } })
    );
    expect(response.body.matches.map((match: { id: string }) => match.id)).toEqual(["match_new", "match_old"]);
  });

  it("returns scoring and safe related summaries without sensitive fields", async () => {
    prismaMock.match.findMany.mockResolvedValue([matchRecord("match_1", "2026-07-02T10:00:00.000Z")]);

    const response = await request(createApp()).get("/api/v1/matches").set(auth("admin_1")).expect(200);
    const summary = response.body.matches[0];
    const serialized = JSON.stringify(summary);

    expect(summary.scoring_breakdown.finalScore).toBe(0.9317);
    expect(summary.driver_route.driver).toEqual({ name: "Driver 1", vehicle_type: "sedan", verified: true, trust_score: 86 });
    expect(summary.passenger_request).toEqual(
      expect.objectContaining({ id: "request_1", pickup_label: "PPU Main Gate", passenger_count: 1 })
    );
    expect(summary.merchant_order).toEqual(expect.objectContaining({ id: "order_1", parcel_count: 5, is_passenger_parcel: false }));
    expect(summary.parcel_batch).toEqual(expect.objectContaining({ id: "batch_1", status: "created" }));
    expect(serialized).not.toContain("password_hash");
    expect(serialized).not.toContain("jwt");
    expect(serialized).not.toContain("reset_key");
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("passenger_id");
    expect(serialized).not.toContain("merchant_id");
    expect(serialized).not.toContain("user_id");
  });

  it("marks a passenger's parcel so the driver does not see it as a shop order", async () => {
    const record = matchRecord("match_1", "2026-07-02T10:00:00.000Z");
    prismaMock.match.findMany.mockResolvedValue([{ ...record, merchant_order: { ...record.merchant_order, passenger_parcel: { id: "ppd_1" } } }]);

    const response = await request(createApp()).get("/api/v1/matches").set(auth("admin_1")).expect(200);

    expect(response.body.matches[0].merchant_order.is_passenger_parcel).toBe(true);
    expect(JSON.stringify(response.body.matches[0])).not.toContain("ppd_1");
  });

  it("applies a valid status filter", async () => {
    await request(createApp()).get("/api/v1/matches?status=proposed").set(auth("driver_1")).expect(200);

    expect(prismaMock.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { driver_route: { driver: { user_id: "driver_1" } }, status: "proposed" }
      })
    );
  });

  it("rejects an invalid status filter", async () => {
    await request(createApp()).get("/api/v1/matches?status=unknown").set(auth("admin_1")).expect(400);
    expect(prismaMock.match.findMany).not.toHaveBeenCalled();
  });

  it("keeps detail ownership consistent for every connected role", async () => {
    prismaMock.match.findUnique.mockResolvedValue(matchRecord("match_1", "2026-07-02T10:00:00.000Z"));

    await request(createApp()).get("/api/v1/matches/match_1").set(auth("driver_1")).expect(200);
    await request(createApp()).get("/api/v1/matches/match_1").set(auth("passenger_1")).expect(200);
    await request(createApp()).get("/api/v1/matches/match_1").set(auth("merchant_1")).expect(200);
    await request(createApp()).get("/api/v1/matches/match_1").set(auth("admin_1")).expect(200);

    await request(createApp()).get("/api/v1/matches/match_1").set(auth("driver_2")).expect(403);
    await request(createApp()).get("/api/v1/matches/match_1").set(auth("passenger_2")).expect(403);
    await request(createApp()).get("/api/v1/matches/match_1").set(auth("merchant_2")).expect(403);
  });
});
