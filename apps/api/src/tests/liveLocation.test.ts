import request from "supertest";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  trip: { findUnique: vi.fn() },
  locationEvent: { findFirst: vi.fn(), create: vi.fn() },
  notification: { findFirst: vi.fn(), create: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { config, createConfig } = await import("../config.js");
const { isInsideTrackingArea } = await import("../services/liveLocation.js");

type Role = "passenger" | "driver" | "merchant" | "admin";

const users: Record<string, { id: string; role: Role; name: string; phone: string }> = {
  driver_1: { id: "driver_1", role: "driver", name: "Driver 1", phone: "+1" },
  driver_2: { id: "driver_2", role: "driver", name: "Driver 2", phone: "+2" },
  passenger_1: { id: "passenger_1", role: "passenger", name: "Passenger 1", phone: "+3" },
  passenger_2: { id: "passenger_2", role: "passenger", name: "Passenger 2", phone: "+4" },
  merchant_1: { id: "merchant_1", role: "merchant", name: "Merchant 1", phone: "+5" },
  admin_1: { id: "admin_1", role: "admin", name: "Admin 1", phone: "+7" }
};

function auth(id: keyof typeof users) {
  const token = jwt.sign(
    { role: users[id].role, sid: `session_${id}`, ver: 1 },
    "test-only-jwt-secret-with-at-least-thirty-two-characters",
    { subject: id, expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}` };
}

const NOW = new Date("2026-11-05T10:00:00.000Z");
// Between Hebron and Bethlehem, on the demo route.
const ON_ROUTE = { lat: 31.62, lng: 35.145 };

function baseTrip(status = "accepted", pickupDetails: string | null = null) {
  return {
    id: "trip_1",
    driver_id: "profile_1",
    status,
    operational_mode: "legacy",
    canonical_trip_version: null,
    driver_route: { id: "route_1", driver_id: "profile_1", driver: { id: "profile_1", user_id: "driver_1" }, route_version: null },
    passenger_request: {
      id: "request_1",
      passenger_id: "passenger_1",
      pickup_lat: "31.532600",
      pickup_lng: "35.099800",
      pickup_details: pickupDetails,
      route_version: null
    },
    merchant_order: { id: "order_1", merchant_id: "merchant_1", parcels: [], route_version: null },
    parcel_batch: null
  };
}

function fix(overrides: Record<string, unknown> = {}) {
  return { lat: ON_ROUTE.lat, lng: ON_ROUTE.lng, accuracy_m: 12, recorded_at: new Date(NOW.getTime() - 3_000).toISOString(), ...overrides };
}

function post(body: unknown, user: keyof typeof users = "driver_1", app = createApp()) {
  return request(app).post("/api/v1/trips/trip_1/location").set(auth(user)).send(body as object);
}

let lockedStatus: string;

describe("live driver location", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    lockedStatus = "accepted";
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
    prismaMock.trip.findUnique.mockImplementation(() => baseTrip(lockedStatus));
    prismaMock.$queryRaw.mockImplementation((parts: TemplateStringsArray) => {
      if (parts.join("?").includes("FROM trips")) return [{ status: lockedStatus }];
      throw new Error("unexpected_test_raw_query");
    });
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.locationEvent.findFirst.mockResolvedValue(null);
    prismaMock.locationEvent.create.mockImplementation(({ data }) => ({ id: `loc_${data.sequence}`, ...data }));
    prismaMock.notification.findFirst.mockResolvedValue(null);
    prismaMock.notification.create.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("POST /trips/:id/location", () => {
    it("stores the assigned driver's fix as driver_gps", async () => {
      const response = await post(fix()).expect(201);

      expect(response.body).toMatchObject({ stored: true, location: { id: "loc_0", sequence: 0 } });
      expect(prismaMock.locationEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            trip_id: "trip_1",
            driver_id: "profile_1",
            lat: "31.620000",
            lng: "35.145000",
            source: "driver_gps",
            sequence: 0,
            recorded_at: new Date(NOW.getTime() - 3_000)
          })
        })
      );
      // The trip row is locked before the interval check and the sequence read.
      expect(prismaMock.$queryRaw).toHaveBeenCalledOnce();
    });

    it.each(["accepted", "pickup_started", "picked_up", "in_transit"])("accepts a %s trip", async (status) => {
      lockedStatus = status;
      await post(fix()).expect(201);
    });

    it.each(["created", "delivered", "completed", "cancelled", "failed"])("refuses a %s trip", async (status) => {
      lockedStatus = status;
      const response = await post(fix()).expect(409);
      expect(response.body.error).toBe("trip_not_tracking");
      expect(prismaMock.locationEvent.create).not.toHaveBeenCalled();
    });

    it("refuses when the trip ends while the post waits for the lock", async () => {
      prismaMock.trip.findUnique.mockImplementation(() => baseTrip("in_transit"));
      lockedStatus = "completed";
      await post(fix()).expect(409);
      expect(prismaMock.locationEvent.create).not.toHaveBeenCalled();
    });

    it("refuses another driver, riders and admins", async () => {
      await post(fix(), "driver_2").expect(403);
      await post(fix(), "passenger_1").expect(403);
      await post(fix(), "merchant_1").expect(403);
      await post(fix(), "admin_1").expect(403);
      await request(createApp()).post("/api/v1/trips/trip_1/location").send(fix()).expect(401);
      expect(prismaMock.locationEvent.create).not.toHaveBeenCalled();
    });

    it("answers 404 for a missing trip and a canonical trip", async () => {
      prismaMock.trip.findUnique.mockResolvedValueOnce(null);
      await post(fix()).expect(404);
      prismaMock.trip.findUnique.mockResolvedValueOnce({ ...baseTrip(), canonical_trip_version: "v1" });
      await post(fix()).expect(404);
    });

    it("is 404 when LIVE_TRACKING_ENABLED is false", async () => {
      const app = createApp(createConfig({ ...process.env, LIVE_TRACKING_ENABLED: "false" }));
      const response = await post(fix(), "driver_1", app).expect(404);
      expect(response.body.error).toBe("live_tracking_disabled");
      expect(prismaMock.locationEvent.create).not.toHaveBeenCalled();
    });

    it("rejects malformed bodies", async () => {
      for (const body of [
        {},
        fix({ lat: "31.6" }),
        fix({ lat: 91 }),
        fix({ accuracy_m: -1 }),
        fix({ recorded_at: "yesterday" }),
        fix({ extra: true }),
        { lat: ON_ROUTE.lat, lng: ON_ROUTE.lng, recorded_at: NOW.toISOString() }
      ]) {
        await post(body).expect(400);
      }
      expect(prismaMock.locationEvent.create).not.toHaveBeenCalled();
    });

    it.each([
      ["Gaza City", { lat: 31.5017, lng: 34.4668 }],
      ["Tel Aviv", { lat: 32.0853, lng: 34.7818 }],
      ["Amman", { lat: 31.9539, lng: 35.9106 }],
      ["Beersheba", { lat: 31.2518, lng: 34.7913 }],
      ["Null Island", { lat: 0, lng: 0 }]
    ])("refuses a position outside the West Bank (%s)", async (_name, point) => {
      const response = await post(fix(point)).expect(422);
      expect(response.body.error).toBe("location_outside_service_area");
    });

    it("accepts positions in every operating city", () => {
      for (const city of [
        { lat: 31.5326, lng: 35.0998 }, // Hebron
        { lat: 31.7054, lng: 35.2024 }, // Bethlehem
        { lat: 31.9038, lng: 35.2034 }, // Ramallah
        { lat: 32.2211, lng: 35.2544 }, // Nablus
        { lat: 32.4637, lng: 35.2938 }, // Jenin
        { lat: 32.3104, lng: 35.0286 }, // Tulkarm
        { lat: 32.1896, lng: 34.9706 }, // Qalqilya
        { lat: 31.8611, lng: 35.46 } // Jericho
      ]) {
        expect(isInsideTrackingArea(city)).toBe(true);
      }
    });

    it("refuses a coarse fix", async () => {
      await post(fix({ accuracy_m: 150 })).expect(201);
      const response = await post(fix({ accuracy_m: 151, recorded_at: new Date(NOW.getTime() + 20_000).toISOString() })).expect(422);
      expect(response.body.error).toBe("location_accuracy_too_low");
    });

    it("refuses a fix from far in the future or the past", async () => {
      for (const offset of [61_000, -121_000, -86_400_000]) {
        const response = await post(fix({ recorded_at: new Date(NOW.getTime() + offset).toISOString() })).expect(422);
        expect(response.body.error).toBe("location_timestamp_out_of_range");
      }
      expect(prismaMock.locationEvent.create).not.toHaveBeenCalled();
    });

    it("clamps a fix slightly ahead of the server clock to now", async () => {
      await post(fix({ recorded_at: new Date(NOW.getTime() + 30_000).toISOString() })).expect(201);
      expect(prismaMock.locationEvent.create.mock.calls[0][0].data.recorded_at).toEqual(NOW);
    });

    it("keeps at most one point per 10 seconds, answering the extra posts", async () => {
      prismaMock.locationEvent.findFirst.mockImplementation(({ where }: { where: { source?: string } }) =>
        where.source === "driver_gps" ? { recorded_at: new Date(NOW.getTime() - 4_000) } : { sequence: 4 });

      const extra = await post(fix({ recorded_at: NOW.toISOString() })).expect(200);
      expect(extra.body).toEqual({ stored: false, reason: "rate_limited", retry_after_seconds: 6 });
      expect(prismaMock.locationEvent.create).not.toHaveBeenCalled();

      // A fix that is not newer than the stored one is never stored either.
      await post(fix({ recorded_at: new Date(NOW.getTime() - 30_000).toISOString() })).expect(200);
      expect(prismaMock.locationEvent.create).not.toHaveBeenCalled();

      vi.setSystemTime(new Date(NOW.getTime() + 6_000));
      const stored = await post(fix({ recorded_at: new Date(NOW.getTime() + 6_000).toISOString() })).expect(201);
      expect(stored.body.location.sequence).toBe(5);
    });

    it("tells a passenger with a real pickup coordinate once when the driver gets close", async () => {
      await post(fix()).expect(201);
      expect(prismaMock.notification.create).not.toHaveBeenCalled();

      await post(fix({ lat: 31.535, lng: 35.1 })).expect(201);
      expect(prismaMock.notification.create).toHaveBeenCalledOnce();
      expect(prismaMock.notification.create.mock.calls[0][0].data).toMatchObject({
        user_id: "passenger_1",
        type: "driver_approaching",
        params: { reason: "radius" }
      });

      prismaMock.notification.findFirst.mockResolvedValue({ id: "n1" });
      await post(fix({ lat: 31.533, lng: 35.1 })).expect(201);
      expect(prismaMock.notification.create).toHaveBeenCalledOnce();
    });

    it("never measures a route request against its city centre", async () => {
      prismaMock.trip.findUnique.mockImplementation(() => baseTrip(lockedStatus, "PPU main gate"));
      await post(fix({ lat: 31.5326, lng: 35.0998 })).expect(201);
      expect(prismaMock.notification.create).not.toHaveBeenCalled();
    });
  });

  describe("GET /trips/:id/location", () => {
    const stored = (ageMs: number, source = "driver_gps") => ({
      id: "loc_3",
      trip_id: "trip_1",
      driver_id: "profile_1",
      lat: "31.620000",
      lng: "35.145000",
      source,
      sequence: 3,
      recorded_at: new Date(NOW.getTime() - ageMs)
    });

    it("gives every party of the trip the latest point with its age", async () => {
      prismaMock.locationEvent.findFirst.mockResolvedValue(stored(30_000));
      for (const user of ["passenger_1", "merchant_1", "driver_1", "admin_1"] as const) {
        const response = await request(createApp()).get("/api/v1/trips/trip_1/location").set(auth(user)).expect(200);
        expect(response.body).toEqual({
          location: {
            id: "loc_3",
            trip_id: "trip_1",
            lat: "31.620000",
            lng: "35.145000",
            source: "driver_gps",
            sequence: 3,
            recorded_at: new Date(NOW.getTime() - 30_000).toISOString(),
            age_seconds: 30,
            stale: false
          },
          stale_after_seconds: 120
        });
      }
    });

    it("refuses people outside the trip", async () => {
      await request(createApp()).get("/api/v1/trips/trip_1/location").set(auth("passenger_2")).expect(403);
      await request(createApp()).get("/api/v1/trips/trip_1/location").set(auth("driver_2")).expect(403);
      await request(createApp()).get("/api/v1/trips/trip_1/location").expect(401);
    });

    it("marks a point older than two minutes as stale", async () => {
      prismaMock.locationEvent.findFirst.mockResolvedValue(stored(120_000));
      let response = await request(createApp()).get("/api/v1/trips/trip_1/location").set(auth("passenger_1")).expect(200);
      expect(response.body.location).toMatchObject({ age_seconds: 120, stale: false });
      prismaMock.locationEvent.findFirst.mockResolvedValue(stored(121_000));
      response = await request(createApp()).get("/api/v1/trips/trip_1/location").set(auth("passenger_1")).expect(200);
      expect(response.body.location).toMatchObject({ age_seconds: 121, stale: true });
    });

    it("answers null when nothing was recorded", async () => {
      const response = await request(createApp()).get("/api/v1/trips/trip_1/location").set(auth("passenger_1")).expect(200);
      expect(response.body.location).toBeNull();
    });

    it("hides the driver from riders once the trip is over", async () => {
      lockedStatus = "completed";
      prismaMock.locationEvent.findFirst.mockResolvedValue(stored(10_000));
      for (const user of ["passenger_1", "merchant_1"] as const) {
        const response = await request(createApp()).get("/api/v1/trips/trip_1/location").set(auth(user)).expect(200);
        expect(response.body.location).toBeNull();
      }
      const admin = await request(createApp()).get("/api/v1/trips/trip_1/location").set(auth("admin_1")).expect(200);
      expect(admin.body.location.id).toBe("loc_3");
    });

    it("reads only real positions outside demo builds", async () => {
      expect(config.demoFeaturesEnabled).toBe(true);
      await request(createApp()).get("/api/v1/trips/trip_1/location").set(auth("passenger_1")).expect(200);
      expect(prismaMock.locationEvent.findFirst.mock.calls.at(-1)![0].where).toEqual({ trip_id: "trip_1" });

      const production = createConfig({ ...process.env, APP_ENV: "local", ENABLE_DEMO_FEATURES: "false" });
      expect(production.demoFeaturesEnabled).toBe(false);
      await request(createApp(production)).get("/api/v1/trips/trip_1/location").set(auth("passenger_1")).expect(200);
      expect(prismaMock.locationEvent.findFirst.mock.calls.at(-1)![0].where).toEqual({ trip_id: "trip_1", source: "driver_gps" });
    });
  });
});
