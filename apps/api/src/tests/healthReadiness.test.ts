import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";

vi.mock("../lib/prisma.js", () => ({ prisma: {} }));

const { createApp } = await import("../app.js");

function config(timeout = 100) {
  return createConfig({
    APP_ENV: "local",
    DATABASE_URL: "mysql://test:test@localhost:3306/darb_test",
    JWT_SECRET: "health-readiness-test-secret-with-thirty-two-characters",
    CORS_ORIGINS: "http://localhost:5173",
    LOG_LEVEL: "silent",
    READINESS_TIMEOUT_MS: String(timeout)
  });
}

describe("liveness and readiness", () => {
  it("keeps liveness independent from database connectivity", async () => {
    const readinessCheck = vi.fn().mockRejectedValue(new Error("database-host-secret"));
    const response = await request(createApp(config(), { readinessCheck })).get("/api/v1/health/live").expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({ ok: true, status: "live", service: "darb-api", request_id: response.headers["x-request-id"] })
    );
    expect(readinessCheck).not.toHaveBeenCalled();
  });

  it("returns ready only after a successful database check", async () => {
    const readinessCheck = vi.fn().mockResolvedValue(undefined);
    const response = await request(createApp(config(), { readinessCheck })).get("/api/v1/health/ready").expect(200);
    expect(readinessCheck).toHaveBeenCalledOnce();
    expect(response.body).toEqual(
      expect.objectContaining({ ok: true, status: "ready", request_id: response.headers["x-request-id"] })
    );
  });

  it("returns a redacted 503 on database failure", async () => {
    const readinessCheck = vi.fn().mockRejectedValue(
      new Error("mysql://database-user:database-password@database.internal:3306/darb")
    );
    const response = await request(createApp(config(), { readinessCheck })).get("/api/v1/health/ready").expect(503);
    const serialized = JSON.stringify(response.body);
    expect(response.body).toEqual(
      expect.objectContaining({ ok: false, status: "not_ready", request_id: response.headers["x-request-id"] })
    );
    expect(serialized).not.toContain("database-password");
    expect(serialized).not.toContain("database.internal");
  });

  it("returns 503 when the database check exceeds its bound", async () => {
    const readinessCheck = vi.fn(() => new Promise<void>(() => undefined));
    const response = await request(createApp(config(10), { readinessCheck })).get("/api/v1/health/ready").expect(503);
    expect(response.body.error).toBeUndefined();
    expect(response.body.status).toBe("not_ready");
  });
});
