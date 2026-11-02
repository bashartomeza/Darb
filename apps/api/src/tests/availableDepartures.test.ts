import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";
import { canonicalDispatchEnabled } from "../lib/canonicalDispatchWorker.js";

const prismaMock = vi.hoisted(() => ({
  authSession: { findUnique: vi.fn(), update: vi.fn() }
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
const { createApp } = await import("../app.js");

const environment = {
  APP_ENV: "local",
  DATABASE_URL: "mysql://test:test@localhost:3306/darb_test",
  JWT_SECRET: "test-only-jwt-secret-with-at-least-thirty-two-characters",
  CORS_ORIGINS: "http://localhost:5173",
  LOG_LEVEL: "silent",
  MULTI_ROUTE_ENTRY_ENABLED: "true",
  MULTI_ROUTE_MATCHING_ENABLED: "true",
  CANONICAL_TRIP_CREATION_ENABLED: "true"
};
const enabled = createConfig(environment);
const entryDisabled = createConfig({
  ...environment,
  MULTI_ROUTE_ENTRY_ENABLED: "false",
  MULTI_ROUTE_MATCHING_ENABLED: "false",
  CANONICAL_TRIP_CREATION_ENABLED: "false"
});

function auth(id: string, role: "passenger" | "driver") {
  const token = jwt.sign({ role, sid: `session_${id}`, ver: 1 }, environment.JWT_SECRET, {
    subject: id,
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

const availability = {
  id: "availability_1",
  route_version_id: "version_1",
  origin_label: "Bab Al-Zawiya",
  destination_label: "Bethlehem Center",
  departure_at: new Date("2026-08-01T17:00:00.000Z"),
  availability_window_end: new Date("2026-08-01T17:30:00.000Z"),
  remaining_seats: 3,
  remaining_parcel_capacity: 5,
  driver: {
    vehicle_type: "sedan",
    trust_score: 86,
    verified: true,
    // Present on the record but must never reach the response.
    user: { name: "Demo Driver Hebron Route", phone: "+970590000002" }
  },
  route_version: {
    id: "version_1",
    name_ar: "الخليل ← بيت لحم",
    name_en: "Hebron -> Bethlehem",
    service_route: { direction: "outbound" },
    stops: [
      { sequence: 1, passenger_pickup: true, passenger_dropoff: false, stop: { id: "stop_1", name_ar: "باب الزاوية", name_en: "Bab Al-Zawiya" } },
      { sequence: 2, passenger_pickup: false, passenger_dropoff: true, stop: { id: "stop_2", name_ar: "بيت لحم", name_en: "Bethlehem Center" } }
    ]
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
    const id = where.id.replace("session_", "");
    const role = id.startsWith("driver") ? "driver" : "passenger";
    return {
      id: where.id,
      user_id: id,
      user: { email_verified_at: new Date(), id, role, account_status: "active", security_version: 1 },
      security_version_at_issue: 1,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null
    };
  });
  prismaMock.authSession.update.mockResolvedValue({});
});

describe("passenger available departures", () => {
  it("returns active driver supply without leaking driver contact details", async () => {
    const service = { listAvailableDepartures: vi.fn().mockResolvedValue([availability]) };
    const app = createApp(enabled, { canonicalDemandService: service as never });

    const response = await request(app)
      .get("/api/v1/passenger/available-departures?seats=1&limit=10")
      .set(auth("passenger_1", "passenger"));

    expect(response.status).toBe(200);
    const departure = response.body.departures[0];
    expect(departure.id).toBe("availability_1");
    expect(departure.remaining_seats).toBe(3);
    expect(departure.driver).toEqual({
      name: "Demo Driver Hebron Route",
      vehicle_type: "sedan",
      trust_score: 86,
      verified: true
    });
    expect(departure.route.stops).toHaveLength(2);
    expect(JSON.stringify(response.body)).not.toContain("+970590000002");
  });

  it("passes the caller's filters through to the service", async () => {
    const service = { listAvailableDepartures: vi.fn().mockResolvedValue([]) };
    const app = createApp(enabled, { canonicalDemandService: service as never });

    await request(app)
      .get("/api/v1/passenger/available-departures?route_version_id=version_1&departure_from=2026-08-01T16:30:00.000Z&departure_until=2026-08-01T18:00:00.000Z&seats=2")
      .set(auth("passenger_1", "passenger"))
      .expect(200);

    expect(service.listAvailableDepartures).toHaveBeenCalledWith({
      routeVersionId: "version_1",
      departureFrom: new Date("2026-08-01T16:30:00.000Z"),
      departureUntil: new Date("2026-08-01T18:00:00.000Z"),
      seats: 2,
      limit: undefined
    });
  });

  it("is passenger-only", async () => {
    const service = { listAvailableDepartures: vi.fn().mockResolvedValue([]) };
    const app = createApp(enabled, { canonicalDemandService: service as never });

    await request(app)
      .get("/api/v1/passenger/available-departures")
      .set(auth("driver_1", "driver"))
      .expect(403);
    expect(service.listAvailableDepartures).not.toHaveBeenCalled();
  });

  it("is absent when canonical entry is disabled", async () => {
    const service = { listAvailableDepartures: vi.fn() };
    const app = createApp(entryDisabled, { canonicalDemandService: service as never });

    await request(app)
      .get("/api/v1/passenger/available-departures")
      .set(auth("passenger_1", "passenger"))
      .expect(404);
  });
});

describe("canonical dispatch worker gating", () => {
  it("runs only where the canonical services themselves are permitted", () => {
    expect(canonicalDispatchEnabled(enabled)).toBe(true);
    expect(canonicalDispatchEnabled(entryDisabled)).toBe(false);
    expect(
      canonicalDispatchEnabled(
        createConfig({
          ...environment,
          APP_ENV: "staging",
          APP_RELEASE: "1.0.0",
          TRUST_PROXY: "none",
          REFRESH_TOKEN_PEPPER: "staging-only-refresh-pepper-with-enough-length",
          MULTI_ROUTE_ENTRY_ENABLED: "false",
          MULTI_ROUTE_MATCHING_ENABLED: "false",
          CANONICAL_TRIP_CREATION_ENABLED: "false"
        })
      )
    ).toBe(false);
  });
});
