import { Writable } from "node:stream";
import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";
import { createOperationalLogger } from "../lib/logger.js";
import { errorHandler, HttpError } from "../middleware/error.js";
import { operationalLogMiddleware } from "../middleware/operationalLog.js";
import { requestIdMiddleware } from "../middleware/requestId.js";

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
  JWT_SECRET: "http-security-test-secret-with-thirty-two-characters",
  CORS_ORIGINS: "http://localhost:5173",
  LOG_LEVEL: "silent"
};

function testConfig(overrides: Record<string, string | undefined> = {}) {
  return createConfig({ ...baseEnvironment, ...overrides });
}

function productionConfig() {
  return createConfig({
    ...baseEnvironment,
    APP_ENV: "production",
    APP_RELEASE: "http-security-test",
    CORS_ORIGINS: "https://admin.darb.example",
    REFRESH_TOKEN_PEPPER: "http-security-refresh-pepper-with-thirty-two-characters",
    AUTH_ACTION_TOKEN_PEPPER: "http-security-action-pepper-with-thirty-two-characters",
    TRUST_PROXY: "none"
  });
}

function demoConfig() {
  return createConfig({
    ...baseEnvironment,
    APP_ENV: "demo",
    DEMO_RESET_KEY: "test-reset-key",
    DEMO_PASSENGER_PASSWORD: "passenger-test-secret",
    DEMO_DRIVER_PASSWORD: "driver-test-secret",
    DEMO_MERCHANT_PASSWORD: "merchant-test-secret",
    DEMO_ADMIN_PASSWORD: "admin-test-secret"
  });
}

function capturedLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    }
  });
  const logger = createOperationalLogger(testConfig({ LOG_LEVEL: "info" }), destination);
  return { logger, lines };
}

async function settleLogs() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("production HTTP security baseline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.driverRoute.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates request IDs, preserves safe IDs, and replaces malformed IDs", async () => {
    const app = createApp(testConfig());
    const generated = await request(app).get("/api/v1/health").expect(200);
    expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(generated.body.request_id).toBe(generated.headers["x-request-id"]);

    const preserved = await request(app).get("/api/v1/health").set("X-Request-Id", "judge-run_2026-07").expect(200);
    expect(preserved.headers["x-request-id"]).toBe("judge-run_2026-07");

    const malformed = await request(app).get("/api/v1/health").set("X-Request-Id", "unsafe value with text").expect(200);
    expect(malformed.headers["x-request-id"]).not.toBe("unsafe value with text");
    expect(malformed.body.request_id).toBe(malformed.headers["x-request-id"]);
  });

  it("adds request IDs to validation and not-found errors", async () => {
    const validation = await request(createApp(testConfig()))
      .post("/api/v1/auth/login")
      .send({ phone: "x", password: "" })
      .expect(400);
    expect(validation.body).toEqual(
      expect.objectContaining({ error: "validation_error", request_id: validation.headers["x-request-id"] })
    );

    const missing = await request(createApp(testConfig())).get("/api/v1/not-a-real-route").expect(404);
    expect(missing.body).toEqual(expect.objectContaining({ error: "not_found", request_id: missing.headers["x-request-id"] }));
  });

  it("logs only approved completion and actor metadata", async () => {
    const { logger, lines } = capturedLogger();
    await request(createApp(testConfig(), { logger }))
      .post("/api/v1/auth/login?token=query-secret")
      .set("Authorization", "Bearer header-secret")
      .send({
        email: "logged-in-secret@example.com",
        password: "body-password-secret",
        latitude: 31.53261234,
        longitude: 35.09981234,
        database_url: "mysql://secret-user:secret-pass@secret-host/darb"
      })
      .expect(401);
    await settleLogs();

    const output = lines.join("");
    const completion = lines.map((line) => JSON.parse(line)).find((entry) => entry.event === "http_request_completed");
    expect(completion).toEqual(
      expect.objectContaining({
        level: 30,
        app_env: "local",
        release: "unreleased",
        request_id: expect.any(String),
        method: "POST",
        path: "/api/v1/auth/login",
        status_code: 401,
        duration_ms: expect.any(Number)
      })
    );
    for (const forbidden of [
      "query-secret",
      "header-secret",
      "logged-in-secret@example.com",
      "body-password-secret",
      "31.53261234",
      "35.09981234",
      "secret-host"
    ]) {
      expect(output).not.toContain(forbidden);
    }
  });

  it("redacts refresh-token material and hashes from operational logs", async () => {
    const { logger, lines } = capturedLogger();
    logger.info(
      {
        refresh_token: "raw-refresh-marker",
        token_hash: "refresh-hash-marker",
        refresh_token_pepper: "refresh-pepper-marker"
      },
      "redaction verification"
    );
    await settleLogs();
    const output = lines.join("");
    expect(output).not.toContain("raw-refresh-marker");
    expect(output).not.toContain("refresh-hash-marker");
    expect(output).not.toContain("refresh-pepper-marker");
  });

  it("redacts onboarding codes, digests, phones, tokens, and peppers", async () => {
    const { logger, lines } = capturedLogger();
    const markers = ["invite-code", "otp-code", "phone-digest", "session-pepper", "idempotency-key", "abuse-pepper"];
    logger.info({
      invitation_code: markers[0],
      otp_code: markers[1],
      phone_digest: markers[2],
      onboarding_session_pepper: markers[3],
      idempotency_key: markers[4],
      abuse_key_pepper: markers[5]
    }, "onboarding redaction verification");
    await settleLogs();
    const output = lines.join("");
    for (const marker of markers) expect(output).not.toContain(marker);
  });

  it("redacts auth-action credentials, tokens, and profile contact fields", async () => {
    const { logger, lines } = capturedLogger();
    const markers = [
      "id-token-marker",
      "credential-marker",
      "credentials-marker",
      "nested-id-token-marker",
      "nested-credential-marker",
      "deep-raw-token-marker",
      "action-token-marker",
      "profile-email-marker"
    ];
    logger.info({
      id_token: markers[0],
      credential: markers[1],
      credentials: markers[2],
      raw_action_token: markers[6],
      rawToken: "returned-raw-action-token-marker",
      auth_action: {
        rawToken: "nested-raw-action-token-marker",
        idToken: markers[0],
        id_token: markers[3],
        credential: markers[4]
      },
      action: { result: { proof: { rawToken: markers[5] } } },
      profile: { email: markers[7], phone: "+970590001234" }
    }, "auth action redaction verification");
    await settleLogs();
    const output = lines.join("");
    for (const marker of markers) expect(output).not.toContain(marker);
    expect(output).not.toContain("returned-raw-action-token-marker");
    expect(output).not.toContain("nested-raw-action-token-marker");
    expect(output).not.toContain("+970590001234");
  });

  it("adds authenticated actor identity without logging authorization material", async () => {
    const { logger, lines } = capturedLogger();
    const appConfig = testConfig();
    const user = {
  email_verified_at: new Date(),
      id: "driver_actor",
      role: "driver",
      account_status: "active",
      security_version: 1
    };
    prismaMock.authSession.findUnique.mockResolvedValue({
      id: "session_driver_actor",
      user_id: user.id,
      user,
      security_version_at_issue: 1,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null
    });
    prismaMock.authSession.update.mockResolvedValue({});
    const token = jwt.sign(
      { role: "driver", sid: "session_driver_actor", ver: 1 },
      process.env.JWT_SECRET!,
      { subject: "driver_actor", expiresIn: "1h" }
    );
    await request(createApp(appConfig, { logger }))
      .get("/api/v1/driver/routes")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    await settleLogs();

    const output = lines.join("");
    const completion = lines.map((line) => JSON.parse(line)).find((entry) => entry.event === "http_request_completed");
    expect(completion).toEqual(expect.objectContaining({ actor_id: "driver_actor", actor_role: "driver" }));
    expect(output).not.toContain(token);
  });

  it("logs unhandled errors by safe type and never returns or logs their secrets", async () => {
    const { logger, lines } = capturedLogger();
    const app = express();
    app.use(requestIdMiddleware);
    app.use(operationalLogMiddleware(logger));
    app.get("/boom", () => {
      throw new Error(
        "stack-password-secret Bearer.jwt-secret mysql://db-user:db-password@db.internal:3306/darb +970590001234"
      );
    });
    app.use(errorHandler);

    const response = await request(app).get("/boom").expect(500);
    await settleLogs();
    const serialized = `${JSON.stringify(response.body)}\n${lines.join("")}`;
    expect(response.body).toEqual(
      expect.objectContaining({ error: "internal_server_error", request_id: response.headers["x-request-id"] })
    );
    expect(lines.some((line) => JSON.parse(line).event === "unhandled_error")).toBe(true);
    for (const forbidden of ["stack-password-secret", "jwt-secret", "db-password", "db.internal", "+970590001234"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("preserves domain errors and safely maps Prisma-style errors", async () => {
    const { logger, lines } = capturedLogger();
    const app = express();
    app.use(requestIdMiddleware);
    app.use(operationalLogMiddleware(logger));
    app.get("/domain", () => {
      throw new HttpError(409, "duplicate_active_trip");
    });
    app.get("/conflict", () => {
      throw Object.assign(new Error("database-password-secret"), { code: "P2002" });
    });
    app.get("/database", () => {
      throw Object.assign(new Error("mysql://user:password@database.internal/darb"), { code: "P1001" });
    });
    app.get("/deadlock", () => {
      throw Object.assign(new Error("private transaction details"), { code: "P2034" });
    });
    app.use(errorHandler);

    const domain = await request(app).get("/domain").expect(409);
    const conflict = await request(app).get("/conflict").expect(409);
    const database = await request(app).get("/database").expect(500);
    const deadlock = await request(app).get("/deadlock").expect(409);
    await settleLogs();

    expect(domain.body.error).toBe("duplicate_active_trip");
    expect(conflict.body.error).toBe("resource_conflict");
    expect(database.body.error).toBe("internal_server_error");
    expect(deadlock.body.error).toBe("transaction_retry_required");
    const serialized = `${JSON.stringify([domain.body, conflict.body, database.body, deadlock.body])}\n${lines.join("")}`;
    expect(serialized).not.toContain("database-password-secret");
    expect(serialized).not.toContain("database.internal");
    expect(serialized).not.toContain("mysql://");
    expect(serialized).not.toContain("private transaction details");
  });

  it("enforces a global limiter while excluding health endpoints", async () => {
    const app = createApp(testConfig({ RATE_LIMIT_GLOBAL_MAX: "2", RATE_LIMIT_LOGIN_MAX: "100" }), {
      readinessCheck: async () => undefined
    });
    await request(app).get("/api/v1/passenger/requests").expect(401);
    await request(app).get("/api/v1/passenger/requests").expect(401);
    const limited = await request(app).get("/api/v1/passenger/requests").expect(429);
    expect(limited.body).toEqual(expect.objectContaining({ error: "rate_limited", request_id: limited.headers["x-request-id"] }));
    expect(limited.headers["retry-after"]).toBeDefined();

    await request(app).get("/api/v1/health").expect(200);
    await request(app).get("/api/v1/health/live").expect(200);
    await request(app).get("/api/v1/health/ready").expect(200);
  });

  it("uses a stricter login limiter without exposing account existence", async () => {
    const app = createApp(testConfig({ RATE_LIMIT_GLOBAL_MAX: "20", RATE_LIMIT_LOGIN_MAX: "2" }));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "nobody-9999@example.com", password: "not-a-password" })
        .expect(401);
      expect(response.body.error).toBe("invalid_credentials");
    }
    const limited = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "nobody-9999@example.com", password: "not-a-password" })
      .expect(429);
    expect(limited.body.error).toBe("rate_limited");
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("does not trust spoofed forwarding headers unless an explicit proxy hop is configured", async () => {
    const direct = createApp(testConfig({ RATE_LIMIT_GLOBAL_MAX: "1" }));
    await request(direct).get("/api/v1/passenger/requests").set("X-Forwarded-For", "198.51.100.10").expect(401);
    await request(direct).get("/api/v1/passenger/requests").set("X-Forwarded-For", "198.51.100.11").expect(429);

    const proxied = createApp(testConfig({ RATE_LIMIT_GLOBAL_MAX: "1", TRUST_PROXY: "1" }));
    await request(proxied).get("/api/v1/passenger/requests").set("X-Forwarded-For", "198.51.100.10").expect(401);
    await request(proxied).get("/api/v1/passenger/requests").set("X-Forwarded-For", "198.51.100.11").expect(401);
  });

  it("applies API security headers and HSTS only in production-like environments", async () => {
    const demo = await request(createApp(demoConfig())).get("/api/v1/health").expect(200);
    expect(demo.headers["x-powered-by"]).toBeUndefined();
    expect(demo.headers["x-content-type-options"]).toBe("nosniff");
    expect(demo.headers["x-frame-options"]).toBe("DENY");
    expect(demo.headers["referrer-policy"]).toBe("no-referrer");
    expect(demo.headers["strict-transport-security"]).toBeUndefined();

    const production = await request(createApp(productionConfig())).get("/api/v1/health").expect(200);
    expect(production.headers["strict-transport-security"]).toContain("max-age=15552000");
  });

  it("keeps CORS preflight functional with request and rate-limit headers", async () => {
    const response = await request(createApp(testConfig()))
      .options("/api/v1/auth/login")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "PUT")
      .set("Access-Control-Request-Headers", "content-type,idempotency-key")
      .expect(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");
    expect(response.headers["access-control-allow-headers"]).toContain("X-Request-Id");
    expect(response.headers["access-control-allow-headers"]).toContain("Idempotency-Key");
    expect(response.headers["access-control-expose-headers"]).toContain("Retry-After");
  });

  it("allows unlisted loopback ports outside staging and production", async () => {
    const response = await request(createApp(testConfig()))
      .options("/api/v1/auth/register")
      .set("Origin", "http://localhost:54681")
      .set("Access-Control-Request-Method", "POST")
      .expect(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:54681");
  });

  it("rejects unlisted loopback and non-loopback origins in production", async () => {
    const app = createApp(productionConfig());
    const loopback = await request(app)
      .options("/api/v1/auth/register")
      .set("Origin", "http://localhost:54681")
      .expect(204);
    expect(loopback.headers["access-control-allow-origin"]).toBeUndefined();

    const foreign = await request(app)
      .options("/api/v1/auth/register")
      .set("Origin", "https://evil.darb.example")
      .expect(204);
    expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not treat lookalike hostnames as loopback", async () => {
    const response = await request(createApp(testConfig()))
      .options("/api/v1/auth/register")
      .set("Origin", "http://localhost.evil.example")
      .expect(204);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns a controlled 413 without echoing oversized content", async () => {
    const marker = "oversized-body-secret-marker";
    const response = await request(createApp(testConfig()))
      .post("/api/v1/auth/login")
      .send({ phone: "+970590001234", password: marker.repeat(4_000) })
      .expect(413);
    expect(response.body).toEqual(
      expect.objectContaining({ error: "payload_too_large", request_id: response.headers["x-request-id"] })
    );
    expect(JSON.stringify(response.body)).not.toContain(marker);
  });

  it("returns a controlled invalid-JSON response without parser diagnostics", async () => {
    const response = await request(createApp(testConfig()))
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send('{"password":"parser-secret"')
      .expect(400);
    expect(response.body).toEqual(
      expect.objectContaining({ error: "invalid_json", request_id: response.headers["x-request-id"] })
    );
    expect(JSON.stringify(response.body)).not.toContain("parser-secret");
  });
});
