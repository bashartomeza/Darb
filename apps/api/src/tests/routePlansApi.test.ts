import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";
import { CheckpointService } from "../services/checkpoints.js";
import { A, B, fakeEngine, northRoad } from "./checkpointRoutingFixtures.js";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  driverRoute: { findMany: vi.fn() }
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");

const baseEnvironment = {
  APP_ENV: "local",
  DATABASE_URL: "mysql://test:test@localhost:3306/darb_test",
  JWT_SECRET: "test-only-jwt-secret-with-at-least-thirty-two-characters",
  CORS_ORIGINS: "http://localhost:5173",
  LOG_LEVEL: "silent",
  ROUTE_MANAGEMENT_ENABLED: "true",
  MAPS_ENABLED: "true"
};
const enabledConfig = createConfig({
  ...baseEnvironment,
  CHECKPOINTS_ENABLED: "true",
  CHECKPOINTS_URL: "https://example.test/rest/v1/checkpoints",
  CHECKPOINTS_API_KEY: "an-upstream-key-long-enough-to-pass"
});
const disabledConfig = createConfig(baseEnvironment);

function auth(role: "passenger" | "driver" | "merchant" = "passenger") {
  const token = jwt.sign({ role, sid: `session_${role}_1`, ver: 1 }, baseEnvironment.JWT_SECRET, { subject: `${role}_1`, expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

const body = { waypoints: [{ latitude: A.lat, longitude: A.lng }, { latitude: B.lat, longitude: B.lng }] };

const serviceConfig = { url: "https://example.test/rest/v1/checkpoints", apiKey: "key", timeoutMs: 1_000, cacheTtlSeconds: 60 };

function checkpointService(rows: unknown[]) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify(rows), { status: 200 })));
  return new CheckpointService(serviceConfig);
}

describe("POST /route-plans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const role = where.id.replace("session_", "").replace("_1", "");
      return {
        id: where.id,
        user_id: `${role}_1`,
        user: { email_verified_at: new Date(), id: `${role}_1`, role, account_status: "active", security_version: 1 },
        security_version_at_issue: 1,
        expires_at: new Date(Date.now() + 60_000),
        revoked_at: null
      };
    });
    prismaMock.authSession.update.mockResolvedValue({});
  });

  it("does not exist when no checkpoint source is configured", async () => {
    await request(createApp(disabledConfig)).post("/api/v1/route-plans").set(auth()).send(body).expect(404);
  });

  it("requires authentication", async () => {
    const server = createApp(enabledConfig, { checkpointService: checkpointService([]), routingEngine: fakeEngine() });
    await request(server).post("/api/v1/route-plans").send(body).expect(401);
  });

  it("reroutes around a closed checkpoint from the same feed the map shows", async () => {
    const rows = [{ id: "c1", name_ar: "حاجز اختبار", name_en: "Test", latitude: 31.5, longitude: 35.2, status: "closed", updated_at: new Date().toISOString() }];
    const server = createApp(enabledConfig, { checkpointService: checkpointService(rows), routingEngine: fakeEngine([northRoad]) });
    const response = await request(server).post("/api/v1/route-plans").set(auth("driver")).send(body).expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.plan).toMatchObject({
      status: "rerouted_closed",
      distance_meters: 24_000,
      extra_distance_meters: 5_000,
      avoided_checkpoints: [{ id: "c1", status: "closed" }],
      checkpoint_data: { available: true, status_trusted: true, threshold_meters: 150 }
    });
    expect(response.body.plan.coordinates[0]).toEqual([A.lng, A.lat]);
  });

  it("answers 502 when the routing engine is unavailable so the app can keep its own line", async () => {
    const engine = {
      route: async () => {
        throw new Error("engine_status_503");
      }
    };
    const server = createApp(enabledConfig, { checkpointService: checkpointService([]), routingEngine: engine });
    const response = await request(server).post("/api/v1/route-plans").set(auth()).send(body).expect(502);
    expect(response.body.error).toBe("route_provider_unavailable");
  });

  it("returns an unchecked road route when the checkpoint feed is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("no", { status: 500 })));
    const failing = new CheckpointService({ ...serviceConfig, cacheTtlSeconds: 0 });
    const server = createApp(enabledConfig, { checkpointService: failing, routingEngine: fakeEngine() });
    const response = await request(server).post("/api/v1/route-plans").set(auth()).send(body).expect(200);
    expect(response.body.plan.status).toBe("unchecked");
    expect(response.body.plan.warnings).toContain("checkpoint_data_unavailable");
  });

  it.each([
    ["one waypoint", { waypoints: [body.waypoints[0]] }],
    ["seven waypoints", { waypoints: Array.from({ length: 7 }, () => body.waypoints[0]) }],
    ["outside the service area", { waypoints: [{ latitude: 37.4, longitude: -122.1 }, body.waypoints[1]] }],
    ["extra fields", { waypoints: body.waypoints, avoid: "all" }],
    ["string coordinates", { waypoints: [{ latitude: "31.5", longitude: "35.1" }, body.waypoints[1]] }]
  ])("rejects %s", async (_name, payload) => {
    const server = createApp(enabledConfig, { checkpointService: checkpointService([]), routingEngine: fakeEngine() });
    await request(server).post("/api/v1/route-plans").set(auth()).send(payload).expect(400);
  });
});
