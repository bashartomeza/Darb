import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";
import { CheckpointService } from "../services/checkpoints.js";

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
  DATABASE_URL: "mysql://test:test@localhost:3306/masari_test",
  JWT_SECRET: "test-only-jwt-secret-with-at-least-thirty-two-characters",
  CORS_ORIGINS: "http://localhost:5173",
  LOG_LEVEL: "silent",
  ROUTE_MANAGEMENT_ENABLED: "true",
  MAPS_ENABLED: "true"
};
const checkpointEnvironment = {
  ...baseEnvironment,
  CHECKPOINTS_ENABLED: "true",
  CHECKPOINTS_URL: "https://example.test/rest/v1/checkpoints",
  CHECKPOINTS_API_KEY: "an-upstream-key-long-enough-to-pass"
};
const enabledConfig = createConfig(checkpointEnvironment);
const disabledConfig = createConfig(baseEnvironment);

function auth() {
  const token = jwt.sign(
    { role: "passenger", sid: "session_passenger_1", ver: 1 },
    baseEnvironment.JWT_SECRET,
    { subject: "passenger_1", expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}` };
}

function serviceConfig() {
  return { url: checkpointEnvironment.CHECKPOINTS_URL, apiKey: "key", timeoutMs: 1_000, cacheTtlSeconds: 60 };
}

function upstream(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe("checkpoint catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => ({
      id: where.id,
      user_id: "passenger_1",
      user: { email_verified_at: new Date(), id: "passenger_1", role: "passenger", account_status: "active", security_version: 1 },
      security_version_at_issue: 1,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null
    }));
    prismaMock.authSession.update.mockResolvedValue({});
  });

  it("does not exist when checkpoints are disabled", async () => {
    const server = createApp(disabledConfig);
    await request(server).get("/api/v1/checkpoints").set(auth()).expect(404);
  });

  it("requires authentication", async () => {
    const server = createApp(enabledConfig, { checkpointService: new CheckpointService(serviceConfig()) });
    await request(server).get("/api/v1/checkpoints").expect(401);
  });

  it("normalizes upstream rows and drops any row without a usable position", async () => {
    vi.stubGlobal(
      "fetch",
      upstream(200, [
        { id: 7, name_ar: "حاجز الكونتينر", name_en: "Container Checkpoint", lat: "31.7054", lng: "35.2024", status: "CLOSED" },
        { id: 8, title_en: "Gush Etzion", latitude: 31.65, longitude: 35.168, state: "busy", last_updated: "2026-08-01T10:00:00Z" },
        { id: 9, name_en: "No position", status: "open" }
      ])
    );
    const server = createApp(enabledConfig, { checkpointService: new CheckpointService(serviceConfig()) });
    const response = await request(server).get("/api/v1/checkpoints").set(auth()).expect(200);

    expect(response.body.stale).toBe(false);
    expect(response.body.checkpoints).toHaveLength(2);
    expect(response.body.checkpoints[0]).toEqual({
      id: "7",
      name_ar: "حاجز الكونتينر",
      name_en: "Container Checkpoint",
      latitude: 31.7054,
      longitude: 35.2024,
      status: "closed",
      updated_at: null
    });
    expect(response.body.checkpoints[1]).toEqual(
      expect.objectContaining({ id: "8", status: "congested", name_en: "Gush Etzion", name_ar: null })
    );
  });

  it("answers 503 without inventing barriers when the upstream rejects the key", async () => {
    vi.stubGlobal("fetch", upstream(401, { message: "permission denied for table checkpoints" }));
    const server = createApp(enabledConfig, { checkpointService: new CheckpointService(serviceConfig()) });
    const response = await request(server).get("/api/v1/checkpoints").set(auth()).expect(503);
    expect(response.body.error).toBe("checkpoints_upstream_rejected");
    // The upstream host, key, and message must never reach the client.
    expect(JSON.stringify(response.body)).not.toContain("permission denied");
  });

  it("does not coerce booleans arrays or whitespace into geographic positions", async () => {
    vi.stubGlobal("fetch", upstream(200, [
      { id: "valid", latitude: "31.7", longitude: "35.2", status: "أزمة" },
      ...[true, false, [], [31], " "].map((latitude) => ({ id: "invalid", latitude, longitude: 35.2 }))
    ]));
    const result = await new CheckpointService(serviceConfig()).list();
    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]).toEqual(expect.objectContaining({ id: "valid", status: "congested" }));
  });

  it("rejects an entirely unusable feed through the authenticated API without exposing upstream data", async () => {
    vi.stubGlobal("fetch", upstream(200, [{ name_en: "synthetic-invalid-upstream-row", latitude: true, longitude: [] }]));
    const server = createApp(enabledConfig, { checkpointService: new CheckpointService(serviceConfig()) });
    const response = await request(server).get("/api/v1/checkpoints").set(auth()).expect(502);
    expect(response.body).toEqual({ error: "checkpoints_upstream_invalid", request_id: expect.any(String) });
  });

  it("serves the last good read as stale rather than a blank map", async () => {
    const service = new CheckpointService({ ...serviceConfig(), cacheTtlSeconds: 0 });
    const server = createApp(enabledConfig, { checkpointService: service });

    vi.stubGlobal("fetch", upstream(200, [{ id: 1, name_en: "Open gate", lat: 31.6, lng: 35.1, status: "open" }]));
    await request(server).get("/api/v1/checkpoints").set(auth()).expect(200);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")));
    const response = await request(server).get("/api/v1/checkpoints").set(auth()).expect(200);
    expect(response.body.stale).toBe(true);
    expect(response.body.checkpoints[0].id).toBe("1");
  });

  it("keeps qualified closure statuses without treating negated open as safe", async () => {
    vi.stubGlobal("fetch", upstream(200, [
      { id: 1, lat: 31.7, lng: 35.2, status: "closed temporarily" },
      { id: 2, lat: 31.7, lng: 35.2, status: "مغلق مؤقتا" },
      { id: 3, lat: 31.7, lng: 35.2, status: "not open" }
    ]));
    const result = await new CheckpointService(serviceConfig()).list();
    expect(result.checkpoints.map((row) => row.status)).toEqual(["closed", "closed", "unknown"]);
  });
});
