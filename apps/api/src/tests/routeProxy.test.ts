import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config as runtimeConfig, createConfig } from "../config.js";
import { createRouteProxyService, parseWaypoints, RouteProxyError } from "../maps/routeProxy.js";
import { parseRouteProxyConfig, type RawRouteProxyEnvironment } from "../maps/routeProxyConfig.js";

const prismaMock = vi.hoisted(() => ({ authSession: { findUnique: vi.fn(), update: vi.fn() }, auditEvent: { create: vi.fn() } }));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
const { createApp } = await import("../app.js");

function parse(raw: RawRouteProxyEnvironment, productionLike = false) {
  const problems: string[] = [];
  const config = parseRouteProxyConfig(raw, productionLike, problems);
  return { config, problems };
}

const KEY = "a-long-enough-provider-key-123";
const A = { lat: 31.5326, lng: 35.0998 };
const B = { lat: 31.7054, lng: 35.2024 };
const line = [[35.0998, 31.5326], [35.15, 31.6], [35.2024, 31.7054]];

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}
const osrmBody = { code: "Ok", routes: [{ distance: 25_000.4, duration: 1_900.2, geometry: { type: "LineString", coordinates: line } }] };

function service(raw: RawRouteProxyEnvironment, fetchImpl: typeof fetch, now?: () => number) {
  const { config, problems } = parse(raw);
  expect(problems).toEqual([]);
  return createRouteProxyService(config, { fetchImpl, now });
}

describe("route proxy configuration", () => {
  it("is disabled by default, including in production", () => {
    expect(parse({}, true)).toMatchObject({ problems: [], config: { provider: "disabled" } });
  });

  it("refuses the public OSRM demo server in production but allows it elsewhere", () => {
    const raw = { MAPS_ROUTING_PROVIDER: "osrm", MAPS_ROUTING_BASE_URL: "https://router.project-osrm.org" };
    expect(parse(raw, true).problems.join()).toContain("public demo server");
    expect(parse(raw, false).problems).toEqual([]);
  });

  it("requires HTTPS in production and a base URL for osrm", () => {
    expect(parse({ MAPS_ROUTING_PROVIDER: "osrm", MAPS_ROUTING_BASE_URL: "http://10.0.0.5:5000" }, true).problems.join()).toContain("HTTPS");
    expect(parse({ MAPS_ROUTING_PROVIDER: "osrm" }).problems.join()).toContain("MAPS_ROUTING_BASE_URL is required");
  });

  it("requires a real key for keyed providers and never prints it", () => {
    expect(parse({ MAPS_ROUTING_PROVIDER: "mapbox" }).problems.join()).toContain("MAPS_ROUTING_API_KEY is required");
    expect(parse({ MAPS_ROUTING_PROVIDER: "mapbox", MAPS_ROUTING_API_KEY: "your-key-here" }).problems.join()).toContain("placeholder");
    const { config, problems } = parse({ MAPS_ROUTING_PROVIDER: "openrouteservice", MAPS_ROUTING_API_KEY: KEY });
    expect(problems).toEqual([]);
    expect(config.apiKey).toBe(KEY);
    expect(JSON.stringify(config)).not.toContain(KEY);
    expect(config.baseUrl).toBe("https://api.openrouteservice.org");
    expect(config.attribution).toContain("openrouteservice");
  });

  it("rejects unknown providers and out-of-range numbers", () => {
    expect(parse({ MAPS_ROUTING_PROVIDER: "bing" }).problems.join()).toContain("MAPS_ROUTING_PROVIDER");
    expect(parse({ MAPS_ROUTING_TIMEOUT_MS: "5" }).problems.join()).toContain("MAPS_ROUTING_TIMEOUT_MS");
  });

  it("is wired into createConfig for production", () => {
    const base = { APP_ENV: "production", DATABASE_URL: "mysql://x" } as Record<string, string>;
    expect(() => createConfig({ ...base, MAPS_ROUTING_PROVIDER: "osrm", MAPS_ROUTING_BASE_URL: "https://router.project-osrm.org" })).toThrow();
  });
});

describe("waypoint validation", () => {
  it("accepts in-area lists and rejects malformed, short, long and out-of-bounds input", () => {
    expect(parseWaypoints("31.5,35.1;31.7,35.2", 25)).toHaveLength(2);
    for (const bad of [undefined, "", "31.5,35.1", "a,b;c,d", "31.5,35.1;31.7", "40.7,-74;40.8,-73", "31.5,35.1;51.5,-0.1", "31.5,35.1;31.6,35.2;31.7,35.3"]) {
      expect(() => parseWaypoints(bad, bad?.toString().split(";").length === 3 ? 2 : 25)).toThrow(RouteProxyError);
    }
  });
});

describe("route proxy service", () => {
  it("routes through an OSRM-compatible server and normalises the answer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(osrmBody));
    const svc = service({ MAPS_ROUTING_PROVIDER: "osrm", MAPS_ROUTING_BASE_URL: "https://routing.example.org/" }, fetchImpl);
    const { route, cacheStatus } = await svc.route([A, B]);
    expect(cacheStatus).toBe("miss");
    expect(route.distanceMeters).toBe(25_000);
    expect(route.coordinates).toHaveLength(3);
    const url = fetchImpl.mock.calls[0]![0] as URL;
    expect(url.href).toContain("https://routing.example.org/route/v1/driving/35.0998,31.5326;35.2024,31.7054");
  });

  it("calls OpenRouteService, GraphHopper and Mapbox with their own request shapes", async () => {
    const ors = vi.fn().mockResolvedValue(json({ features: [{ properties: { summary: { distance: 100, duration: 10 } }, geometry: { coordinates: line } }] }));
    await service({ MAPS_ROUTING_PROVIDER: "openrouteservice", MAPS_ROUTING_API_KEY: KEY }, ors).route([A, B]);
    expect((ors.mock.calls[0]![1] as RequestInit).method).toBe("POST");
    expect(((ors.mock.calls[0]![1] as RequestInit).headers as Record<string, string>).authorization).toBe(KEY);
    expect((ors.mock.calls[0]![0] as URL).href).not.toContain(KEY);

    const gh = vi.fn().mockResolvedValue(json({ paths: [{ distance: 100, time: 10_000, points: { coordinates: line } }] }));
    const ghRoute = await service({ MAPS_ROUTING_PROVIDER: "graphhopper", MAPS_ROUTING_API_KEY: KEY }, gh).route([A, B]);
    expect(ghRoute.route.durationSeconds).toBe(10);

    const mb = vi.fn().mockResolvedValue(json(osrmBody));
    await service({ MAPS_ROUTING_PROVIDER: "mapbox", MAPS_ROUTING_API_KEY: KEY }, mb).route([A, B]);
    expect((mb.mock.calls[0]![0] as URL).pathname).toContain("/directions/v5/mapbox/driving/");
  });

  it("caches identical requests for the configured time", async () => {
    let t = 1_000_000;
    const fetchImpl = vi.fn().mockImplementation(async () => json(osrmBody));
    const svc = service({ MAPS_ROUTING_PROVIDER: "osrm", MAPS_ROUTING_BASE_URL: "https://r.example.org", MAPS_ROUTING_CACHE_TTL_SECONDS: "60" }, fetchImpl, () => t);
    await svc.route([A, B]);
    expect((await svc.route([A, B])).cacheStatus).toBe("hit");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t += 61_000;
    expect((await svc.route([A, B])).cacheStatus).toBe("miss");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("limits provider calls globally and recovers next minute", async () => {
    let t = 5_000_000;
    const fetchImpl = vi.fn().mockImplementation(async () => json(osrmBody));
    const svc = service({ MAPS_ROUTING_PROVIDER: "osrm", MAPS_ROUTING_BASE_URL: "https://r.example.org", MAPS_ROUTING_CACHE_TTL_SECONDS: "0", MAPS_ROUTING_GLOBAL_RATE_PER_MINUTE: "2" }, fetchImpl, () => t);
    await svc.route([A, B]);
    await svc.route([B, A]);
    await expect(svc.route([A, B])).rejects.toMatchObject({ code: "route_provider_busy", status: 429 });
    t += 61_000;
    await expect(svc.route([A, B])).resolves.toBeDefined();
  });

  it("maps provider failures to safe errors", async () => {
    const raw = { MAPS_ROUTING_PROVIDER: "osrm", MAPS_ROUTING_BASE_URL: "https://r.example.org" };
    await expect(service(raw, vi.fn().mockResolvedValue(new Response("no", { status: 500 }))).route([A, B])).rejects.toMatchObject({ code: "route_provider_failed", status: 502 });
    await expect(service(raw, vi.fn().mockResolvedValue(new Response("slow", { status: 429 }))).route([A, B])).rejects.toMatchObject({ status: 429 });
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    await expect(service(raw, vi.fn().mockRejectedValue(timeout)).route([A, B])).rejects.toMatchObject({ code: "route_provider_timeout", status: 504 });
    await expect(service(raw, vi.fn().mockResolvedValue(json({ code: "NoRoute", routes: [] }))).route([A, B])).rejects.toMatchObject({ code: "route_provider_failed" });
  });

  it("rejects oversized responses and geometry outside the service area", async () => {
    const raw = { MAPS_ROUTING_PROVIDER: "osrm", MAPS_ROUTING_BASE_URL: "https://r.example.org", MAPS_ROUTING_MAX_RESPONSE_BYTES: "10000" };
    const big = json(osrmBody, { headers: { "content-length": "999999" } });
    await expect(service(raw, vi.fn().mockResolvedValue(big)).route([A, B])).rejects.toMatchObject({ code: "route_provider_failed" });
    const streamed = new Response("x".repeat(20_000), { status: 200 });
    await expect(service(raw, vi.fn().mockResolvedValue(streamed)).route([A, B])).rejects.toMatchObject({ code: "route_provider_failed" });
    const far = { code: "Ok", routes: [{ distance: 1, duration: 1, geometry: { coordinates: [[-74, 40.7], [-73.9, 40.8]] } }] };
    await expect(service(raw, vi.fn().mockResolvedValue(json(far))).route([A, B])).rejects.toMatchObject({ code: "route_provider_failed" });
  });

  it("answers 503 and never calls out when disabled", async () => {
    const fetchImpl = vi.fn();
    await expect(service({}, fetchImpl).route([A, B])).rejects.toMatchObject({ code: "route_provider_unavailable", status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/maps/route", () => {
  const secret = runtimeConfig.jwtSecret;
  function appWith(env: Record<string, string>, fetchImpl: typeof fetch) {
    const config = createConfig({ APP_ENV: "local", DATABASE_URL: "mysql://test:test@localhost:3306/test", JWT_SECRET: secret, CORS_ORIGINS: "http://localhost:5173", LOG_LEVEL: "silent", ...env });
    return createApp(config, { routeProxyService: createRouteProxyService(config.routeProxy, { fetchImpl }) });
  }
  const token = (id: string) => jwt.sign({ role: "passenger", sid: `session_${id}`, ver: 1 }, secret, { subject: id, expiresIn: 3_600 });
  const auth = (id = "passenger_1") => ({ authorization: `Bearer ${token(id)}` });
  const live = { MAPS_ROUTING_PROVIDER: "osrm", MAPS_ROUTING_BASE_URL: "https://r.example.org" };
  const query = "31.5326,35.0998;31.7054,35.2024";

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const id = where.id.replace("session_", "");
      return { id: where.id, user_id: id, user: { email_verified_at: new Date(), id, role: "passenger", account_status: "active", security_version: 1 }, security_version_at_issue: 1, expires_at: new Date(Date.now() + 60_000), revoked_at: null };
    });
    prismaMock.authSession.update.mockResolvedValue({});
  });

  it("requires authentication", async () => {
    await request(appWith(live, vi.fn())).get("/api/v1/maps/route").query({ waypoints: query }).expect(401);
  });

  it("returns an OSRM-shaped route with attribution", async () => {
    const res = await request(appWith(live, vi.fn().mockResolvedValue(json(osrmBody)))).get("/api/v1/maps/route").set(auth()).query({ waypoints: query }).expect(200);
    expect(res.body.code).toBe("Ok");
    expect(res.body.routes[0].geometry.coordinates).toHaveLength(3);
    expect(res.body.attribution).toContain("OpenStreetMap");
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("rejects out-of-bounds and malformed waypoints before calling the provider", async () => {
    const fetchImpl = vi.fn();
    const app = appWith(live, fetchImpl);
    await request(app).get("/api/v1/maps/route").set(auth()).query({ waypoints: "40.7,-74;40.8,-73" }).expect(400);
    await request(app).get("/api/v1/maps/route").set(auth()).query({ waypoints: "nonsense" }).expect(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers 503 when no provider is configured", async () => {
    const res = await request(appWith({}, vi.fn())).get("/api/v1/maps/route").set(auth()).query({ waypoints: query }).expect(503);
    expect(res.body.error).toBe("route_provider_unavailable");
  });

  it("rate limits each user separately", async () => {
    const app = appWith({ ...live, MAPS_ROUTING_USER_RATE_PER_MINUTE: "2" }, vi.fn().mockImplementation(async () => json(osrmBody)));
    await request(app).get("/api/v1/maps/route").set(auth("passenger_1")).query({ waypoints: query }).expect(200);
    await request(app).get("/api/v1/maps/route").set(auth("passenger_1")).query({ waypoints: query }).expect(200);
    await request(app).get("/api/v1/maps/route").set(auth("passenger_1")).query({ waypoints: query }).expect(429);
    await request(app).get("/api/v1/maps/route").set(auth("passenger_2")).query({ waypoints: query }).expect(200);
  });
});
