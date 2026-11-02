import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  serviceRoute: { findUnique: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { LOCKED_CORRIDOR_KEY } = await import("../modules/demoReset.js");
const { LOCKED_ROUTE } = await import("../modules/driver.js");

type Role = "passenger" | "driver" | "merchant" | "admin";
const users: Record<string, { id: string; role: Role; name: string; phone: string; demo_account: boolean }> = {
  passenger_1: { id: "passenger_1", role: "passenger", name: "Passenger", phone: "+1", demo_account: true },
  driver_1: { id: "driver_1", role: "driver", name: "Driver", phone: "+2", demo_account: true },
  merchant_1: { id: "merchant_1", role: "merchant", name: "Merchant", phone: "+3", demo_account: true },
  admin_1: { id: "admin_1", role: "admin", name: "Admin", phone: "+4", demo_account: true }
};

function auth(id: keyof typeof users) {
  const token = jwt.sign(
    { role: users[id].role, sid: `session_${id}`, ver: 1 },
    "test-only-jwt-secret-with-at-least-thirty-two-characters",
    { subject: id, expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}` };
}

function membership(sequence: number, key: string, flags: Partial<Record<string, boolean>>, status = "active") {
  return {
    sequence,
    passenger_pickup: flags.passenger_pickup ?? false,
    passenger_dropoff: flags.passenger_dropoff ?? false,
    parcel_pickup: flags.parcel_pickup ?? false,
    parcel_dropoff: flags.parcel_dropoff ?? false,
    stop: {
      id: `stop_${key}`,
      stop_key: key,
      name_ar: `ar ${key}`,
      name_en: `en ${key}`,
      latitude: { toString: () => "31.532600" },
      longitude: { toString: () => "35.099800" },
      status
    }
  };
}

const publishedRoute = {
  status: "active",
  current_version: {
    id: "version_1",
    status: "published",
    name_ar: "الممر",
    name_en: "Corridor",
    stops: [
      membership(1, "origin", { passenger_pickup: true, parcel_pickup: true }),
      membership(2, "retired", { passenger_pickup: true }, "retired"),
      membership(3, "destination", { passenger_dropoff: true, parcel_dropoff: true })
    ]
  }
};

describe("GET /legacy-corridor", () => {
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
    prismaMock.serviceRoute.findUnique.mockResolvedValue(publishedRoute);
  });

  it("requires authentication", async () => {
    const response = await request(createApp()).get("/api/v1/legacy-corridor");
    expect(response.status).toBe(401);
    expect(prismaMock.serviceRoute.findUnique).not.toHaveBeenCalled();
  });

  it.each(["passenger_1", "driver_1", "merchant_1", "admin_1"] as const)(
    "serves the locked corridor's active stops and driver route to %s",
    async (user) => {
      const response = await request(createApp()).get("/api/v1/legacy-corridor").set(auth(user));
      expect(response.status).toBe(200);
      expect(prismaMock.serviceRoute.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { route_key: LOCKED_CORRIDOR_KEY } })
      );
      expect(response.body.corridor).toMatchObject({
        key: LOCKED_CORRIDOR_KEY,
        route_version_id: "version_1",
        name_ar: "الممر",
        name_en: "Corridor",
        driver_route: {
          origin_label: LOCKED_ROUTE.origin_label,
          origin_lat: LOCKED_ROUTE.origin_lat,
          origin_lng: LOCKED_ROUTE.origin_lng,
          destination_label: LOCKED_ROUTE.destination_label,
          destination_lat: LOCKED_ROUTE.destination_lat,
          destination_lng: LOCKED_ROUTE.destination_lng
        }
      });
      expect(response.body.corridor.stops).toEqual([
        {
          id: "stop_origin",
          stop_key: "origin",
          name_ar: "ar origin",
          name_en: "en origin",
          latitude: 31.5326,
          longitude: 35.0998,
          sequence: 1,
          passenger_pickup: true,
          passenger_dropoff: false,
          parcel_pickup: true,
          parcel_dropoff: false
        },
        expect.objectContaining({ stop_key: "destination", sequence: 3, passenger_dropoff: true, parcel_dropoff: true })
      ]);
    }
  );

  it.each([
    ["missing", null],
    ["retired", { ...publishedRoute, status: "retired" }],
    ["paused", { ...publishedRoute, current_version: { ...publishedRoute.current_version, status: "paused" } }]
  ])("offers no places when the corridor route is %s", async (_label, route) => {
    prismaMock.serviceRoute.findUnique.mockResolvedValue(route);
    const response = await request(createApp()).get("/api/v1/legacy-corridor").set(auth("merchant_1"));
    expect(response.status).toBe(200);
    expect(response.body.corridor.route_version_id).toBeNull();
    expect(response.body.corridor.stops).toEqual([]);
    expect(response.body.corridor.driver_route.origin_label).toBe(LOCKED_ROUTE.origin_label);
  });
});
