import { beforeEach, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { config, createConfig } from "../config.js";
import { LimitedCheckpointDirectoryService } from "../services/limitedCheckpointDirectory.js";
const db = vi.hoisted(() => ({ authSession: { findUnique: vi.fn(), update: vi.fn() } }));
vi.mock("../lib/prisma.js", () => ({ prisma: db }));
const { createApp } = await import("../app.js");
const env = { APP_ENV: "local", DATABASE_URL: "mysql://synthetic:unused@localhost:59998/limited",
  JWT_SECRET: "limited-synthetic-jwt-secret-over-thirty-two-characters", LOG_LEVEL: "silent" };
beforeEach(() => {
  vi.clearAllMocks();
  db.authSession.findUnique.mockResolvedValue({ id: "session", user_id: "actor",
    user: { id: "actor", role: "passenger", account_status: "active", security_version: 1, email_verified_at: new Date() },
    security_version_at_issue: 1, expires_at: new Date(Date.now() + 60000), revoked_at: null });
  db.authSession.update.mockResolvedValue({});
});
const auth = (role = "passenger") => ({ Authorization: `Bearer ${jwt.sign({ role, sid: "session", ver: 1 }, config.jwtSecret, { subject: "actor", expiresIn: "1h" })}` });
it("explicit limited capability defaults false and leaves legacy capabilities unchanged", async () => {
  const app = createApp(createConfig(env));
  const response = await request(app).get("/api/v1/capabilities?include=limited-checkpoint-directory").set(auth()).expect(200);
  expect(response.body.limited_checkpoint_directory_available).toBe(false);
  expect((await request(app).get("/api/v1/capabilities").set(auth()).expect(200)).body).not.toHaveProperty("limited_checkpoint_directory_available");
});
it("requires its own key rather than accepting a legacy credential", () => {
  expect(() => createConfig({ ...env, AWEENRAYEH_LIMITED_DIRECTORY_ENABLED: "true" })).toThrow(/AWEENRAYEH_PARTNER_API_KEY/);
});
it("disabled endpoint remains inaccessible", async () => {
  await request(createApp(createConfig(env))).get("/api/v1/limited-checkpoint-directory").set(auth()).expect(404);
});
function enabled() {
  const transport = vi.fn(async () => new Response(JSON.stringify({ generatedAt: "2026-10-24T10:00:00Z", checkpoints: [] })));
  const appConfig = createConfig({ ...env, AWEENRAYEH_LIMITED_DIRECTORY_ENABLED: "true", AWEENRAYEH_PARTNER_API_KEY: "SYNTHETIC-LIMITED-KEY-ONLY" });
  const app = createApp(appConfig, { limitedCheckpointDirectoryService: new LimitedCheckpointDirectoryService(appConfig.limitedCheckpointDirectory!, { reserve: async () => ({ retryAfterSeconds: 0, lease: { id: "synthetic-attempt", notBefore: new Date(0) } }), settle: async () => {} }, transport) });
  return { app, transport };
}
it.each(["passenger", "driver"])("authorizes %s without enabling legacy feed, maps or research publication", async role => {
  const session = await db.authSession.findUnique(); session.user.role = role;
  const { app } = enabled();
  const result = await request(app).get("/api/v1/limited-checkpoint-directory").set(auth(role)).expect(200);
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(result.body).toMatchObject({ dataset_role: "LIMITED_PROVIDER_DIRECTORY", limited_dataset: true, count: 0 });
  const caps = await request(app).get("/api/v1/capabilities?include=limited-checkpoint-directory").set(auth(role)).expect(200);
  expect(caps.body.limited_checkpoint_directory_available).toBe(true);
  expect(caps.body.maps_available).toBe(false); expect(caps.body.checkpoints_available).toBe(false);
  await request(app).get("/api/v1/checkpoint-directory").set(auth(role)).expect(404);
  await request(app).get("/api/v1/checkpoints").set(auth(role)).expect(404);
  expect((await request(app).get("/api/v1/capabilities").set(auth(role)).expect(200)).body).not.toHaveProperty("limited_checkpoint_directory_available");
});
it.each(["merchant", "admin"])("blocks %s before transport", async role => {
  const session = await db.authSession.findUnique(); session.user.role = role;
  const { app, transport } = enabled();
  await request(app).get("/api/v1/limited-checkpoint-directory").set(auth(role)).expect(403);
  const caps = await request(app).get("/api/v1/capabilities?include=limited-checkpoint-directory").set(auth(role)).expect(200);
  expect(caps.body.limited_checkpoint_directory_available).toBe(false);
  expect(transport).not.toHaveBeenCalled();
});
it("requires an active complete-profile session even when data is cached", async () => {
  const { app, transport } = enabled();
  await request(app).get("/api/v1/limited-checkpoint-directory").expect(401);
  expect(transport).not.toHaveBeenCalled();
  await request(app).get("/api/v1/limited-checkpoint-directory").set(auth()).expect(200);
  const session = await db.authSession.findUnique(); session.revoked_at = new Date();
  await request(app).get("/api/v1/limited-checkpoint-directory").set(auth()).expect(401);
  expect(transport).toHaveBeenCalledTimes(1);
});
it("rejects simultaneous demo-reset and real-key budget coordination", () => {
  expect(() => createConfig({ ...env, APP_ENV: "test", AWEENRAYEH_LIMITED_DIRECTORY_ENABLED: "true", AWEENRAYEH_PARTNER_API_KEY: "SYNTHETIC-LIMITED-KEY-ONLY" })).toThrow(/demo reset/);
});
