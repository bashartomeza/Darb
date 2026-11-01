import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";

vi.mock("../lib/prisma.js", () => ({ prisma: {} }));

const { createApp } = await import("../app.js");

const base = {
  DATABASE_URL: "mysql://test:test@localhost:3306/darb_test",
  JWT_SECRET: "route-isolation-test-secret-with-thirty-two-characters",
  REFRESH_TOKEN_PEPPER: "route-isolation-refresh-pepper-with-thirty-two-characters",
  CORS_ORIGINS: "https://admin.darb.example",
  APP_RELEASE: "route-test",
  TRUST_PROXY: "none",
  LOG_LEVEL: "silent"
};

function productionLike(appEnv: "staging" | "production") {
  return createConfig({ ...base, APP_ENV: appEnv });
}

const demo = createConfig({
  ...base,
  APP_ENV: "demo",
  CORS_ORIGINS: "http://localhost:5173",
  APP_RELEASE: undefined,
  DEMO_RESET_KEY: "test-reset-key",
  DEMO_PASSENGER_PASSWORD: "passenger-test-secret",
  DEMO_DRIVER_PASSWORD: "driver-test-secret",
  DEMO_MERCHANT_PASSWORD: "merchant-test-secret",
  DEMO_ADMIN_PASSWORD: "admin-test-secret"
});

describe("environment route registration", () => {
  it("does not register admin invitation or public onboarding routes when disabled", async () => {
    const app = createApp(productionLike("production"));
    await request(app).post("/api/v1/admin/invitations").send({}).expect(404);
    await request(app).post("/api/v1/onboarding/start").send({}).expect(404);
    await request(app).post("/api/v1/onboarding/otp/send").send({}).expect(404);
    await request(app).post("/api/v1/onboarding/complete").send({}).expect(404);
  });

  it("registers reset, simulation, and comparison only in demo mode", async () => {
    const app = createApp(demo);
    await request(app).post("/api/v1/demo/reset").expect(403);
    await request(app).post("/api/v1/trips/trip_1/simulate/step").expect(401);
    await request(app).post("/api/v1/trips/trip_1/simulate/reset").expect(401);
    await request(app).post("/api/v1/compare/run").expect(401);
  });

  for (const appEnv of ["staging", "production"] as const) {
    it(`does not register demo mutation or comparison routes in ${appEnv}`, async () => {
      const app = createApp(productionLike(appEnv));
      await request(app).post("/api/v1/demo/reset").expect(404);
      await request(app).post("/api/v1/trips/trip_1/simulate/step").expect(404);
      await request(app).post("/api/v1/trips/trip_1/simulate/reset").expect(404);
      await request(app).post("/api/v1/compare/run").expect(404);
    });
  }

  it("keeps normal role and trip routes registered in production", async () => {
    const app = createApp(productionLike("production"));
    await request(app).get("/api/v1/health").expect(200);
    await request(app).get("/api/v1/passenger/requests").expect(401);
    await request(app).get("/api/v1/driver/routes").expect(401);
    await request(app).get("/api/v1/merchant/orders").expect(401);
    await request(app).get("/api/v1/trips").expect(401);
    await request(app).get("/api/v1/trips/trip_1/location").expect(401);
  });
});
