import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config as runtimeConfig, createConfig } from "../config.js";
import { RouteProviderError } from "../maps/contracts.js";

const prismaMock = vi.hoisted(() => ({ authSession: { findUnique: vi.fn(), update: vi.fn() }, auditEvent: { create: vi.fn() }, driverRoute: { findMany: vi.fn() } }));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
const { createApp } = await import("../app.js");

const secret = runtimeConfig.jwtSecret;
const config = createConfig({ APP_ENV: "local", DATABASE_URL: "mysql://test:test@localhost:3306/test", JWT_SECRET: secret, CORS_ORIGINS: "http://localhost:5173", LOG_LEVEL: "silent", ROUTE_MANAGEMENT_ENABLED: "true", ROUTE_MAPS_ENABLED: "true", ROUTE_PROVIDER: "fake", ROUTE_PROVIDER_RATE_LIMIT_MAX: "100" });
type Role = "admin" | "driver" | "passenger" | "merchant";
const users: Record<string, Role> = { admin_1: "admin", driver_1: "driver", passenger_1: "passenger", merchant_1: "merchant", disabled_1: "admin", revoked_1: "admin" };

function token(id: string, expiresIn = 3_600) { return jwt.sign({ role: users[id], sid: `session_${id}`, ver: 1 }, secret, { subject: id, expiresIn }); }
function auth(id: string) { return { authorization: `Bearer ${token(id)}` }; }
const preview = { encodedGeometry: "safe-line", geometryEncoding: "polyline6", geometryPrecision: 6, distanceMeters: 1000, durationSeconds: 120, calculatedAt: "2026-08-07T00:00:00.000Z", provenance: { provider: "fake", apiVersion: "fake-v1", profile: "driving", providerReferenceStoragePermitted: true }, attribution: [{ text: "fixture", displayRequired: false }], inputChecksum: "a".repeat(64), geometryChecksum: "b".repeat(64) };
function service() { return { calculate: vi.fn().mockResolvedValue({ result: preview, cacheStatus: "miss" }), geocode: vi.fn().mockResolvedValue({ displayLabel: "الخليل", coordinates: { latitude: 31.5, longitude: 35.1 }, provenance: { provider: "fake", apiVersion: "fake-v1", providerReferenceStoragePermitted: true }, attribution: [] }) }; }
function app(mock = service()) { return { server: createApp(config, { routePreviewService: mock as never }), mock }; }

describe("M7D1 protected canonical route preview API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const id = where.id.replace("session_", ""); const role = users[id]; if (!role) return null;
      return { id: where.id, user_id: id, user: { email_verified_at: new Date(), id, role, account_status: id === "disabled_1" ? "disabled" : "active", security_version: 1 }, security_version_at_issue: 1, expires_at: new Date(Date.now() + 60_000), revoked_at: id === "revoked_1" ? new Date() : null };
    });
    prismaMock.authSession.update.mockResolvedValue({});
  });

  it("rejects anonymous, passenger, merchant, and driver requests before calculation", async () => {
    for (const [headers, status] of [[{}, 401], [auth("passenger_1"), 403], [auth("merchant_1"), 403], [auth("driver_1"), 403]] as const) await request(app().server).post("/api/v1/admin/route-versions/v1/preview").set(headers).send({ expected_revision: 1, locale: "ar" }).expect(status);
  });

  it("rejects expired, revoked, and disabled sessions", async () => {
    await request(app().server).post("/api/v1/admin/route-versions/v1/preview").set({ authorization: `Bearer ${token("admin_1", -1)}` }).send({ expected_revision: 1, locale: "ar" }).expect(401);
    await request(app().server).post("/api/v1/admin/route-versions/v1/preview").set(auth("revoked_1")).send({ expected_revision: 1, locale: "ar" }).expect(401);
    await request(app().server).post("/api/v1/admin/route-versions/v1/preview").set(auth("disabled_1")).send({ expected_revision: 1, locale: "ar" }).expect(403);
  });

  it("accepts only a draft entity reference and allowlisted routing options", async () => {
    const target = app();
    await request(target.server).post("/api/v1/admin/route-versions/v1/preview").set(auth("admin_1")).send({ expected_revision: 2, locale: "ar", profile: "driving", options: { avoid_tolls: false, avoid_ferries: false } }).expect(200);
    expect(target.mock.calculate).toHaveBeenCalledWith("v1", expect.objectContaining({ expectedRevision: 2, locale: "ar", profile: "driving" }));
    for (const body of [
      { expected_revision: 1, locale: "ar", profile: "walking" },
      { expected_revision: 1, locale: "ar", coordinates: [[31, 35], [32, 35]] },
      { expected_revision: 1, locale: "ar", provider: "http://attacker.invalid" },
      { expected_revision: 1, locale: "ar", options: { avoid_tolls: false, avoid_ferries: false, callback_url: "http://attacker.invalid" } }
    ]) await request(target.server).post("/api/v1/admin/route-versions/v1/preview").set(auth("admin_1")).send(body).expect(400);
  });

  it("returns only the authorized renderer-neutral preview fields", async () => {
    const response = await request(app().server).post("/api/v1/admin/route-versions/v1/preview").set(auth("admin_1")).send({ expected_revision: 1, locale: "en" }).expect(200);
    expect(response.body.preview).toEqual({ encoded_geometry: "safe-line", geometry_encoding: "polyline6", geometry_precision: 6, distance_meters: 1000, calculated_duration_seconds: 120, calculated_at: "2026-08-07T00:00:00.000Z", provider: "fake", attribution: [{ text: "fixture", displayRequired: false }], geometry_checksum: "b".repeat(64) });
    for (const forbidden of ["secret", "headers", "billing", "trace", "inputChecksum", "cacheKey", "raw"] ) expect(JSON.stringify(response.body)).not.toContain(forbidden);
  });

  it.each([new RouteProviderError("provider_disabled"), new RouteProviderError("provider_timeout"), new RouteProviderError("provider_rate_limited"), new RouteProviderError("provider_quota_exhausted"), new RouteProviderError("provider_unauthorized"), new RouteProviderError("provider_unavailable"), new RouteProviderError("malformed_provider_response")])("normalizes provider error %s", async (error) => {
    const mock = service(); mock.calculate.mockRejectedValueOnce(error);
    const response = await request(app(mock).server).post("/api/v1/admin/route-versions/v1/preview").set(auth("admin_1")).send({ expected_revision: 1, locale: "ar" });
    expect(response.status).toBe(error.category === "provider_timeout" ? 504 : error.category === "provider_rate_limited" || error.category === "provider_quota_exhausted" ? 429 : error.category === "provider_unauthorized" || error.category === "malformed_provider_response" ? 502 : 503);
    expect(response.body).toEqual(expect.objectContaining({ error: error.category, request_id: expect.any(String) }));
  });

  it("geocodes only a stop belonging to the referenced draft route version", async () => {
    const target = app();
    const response = await request(target.server).post("/api/v1/admin/route-versions/v1/stops/stop_1/geocode").set(auth("admin_1")).send({ expected_revision: 1, locale: "ar" }).expect(200);
    expect(target.mock.geocode).toHaveBeenCalledWith("v1", "stop_1", { expectedRevision: 1, locale: "ar" });
    expect(response.body.geocode.display_label).toBe("الخليل");
    await request(target.server).post("/api/v1/admin/route-versions/v1/stops/stop_1/geocode").set(auth("admin_1")).send({ expected_revision: 1, locale: "ar", query: "arbitrary address" }).expect(400);
  });
});
