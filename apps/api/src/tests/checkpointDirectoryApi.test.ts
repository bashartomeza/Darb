import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { config as runtimeConfig, createConfig } from "../config.js";
import { directoryFixture } from "./checkpointDirectoryFixture.js";
import { CheckpointDirectoryService } from "../services/checkpointDirectory.js";

const db = vi.hoisted(() => ({ authSession: { findUnique: vi.fn(), update: vi.fn() } }));
vi.mock("../lib/prisma.js", () => ({ prisma: db }));
const { createApp } = await import("../app.js");
let actorRole = "passenger";
const fixtures: ReturnType<typeof directoryFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach(f => f.dispose()));
function syntheticServer(approved = true) {
  const f = directoryFixture(approved); fixtures.push(f);
  return createApp(createConfig({ ...env, CHECKPOINT_DIRECTORY_ENABLED: "true", CHECKPOINT_DIRECTORY_FILE: f.file }),
    { checkpointDirectoryService: new CheckpointDirectoryService(f.file, f.manifest) });
}
const env = { APP_ENV: "local", DATABASE_URL: "mysql://synthetic:unused@localhost:59998/directory",
  JWT_SECRET: "directory-synthetic-jwt-secret-over-thirty-two-characters", LOG_LEVEL: "silent" };
function auth(role = "passenger") {
  return { Authorization: `Bearer ${jwt.sign({ role, sid: "session", ver: 1 }, runtimeConfig.jwtSecret,
    { subject: "actor", expiresIn: "1h" })}` };
}
beforeEach(() => {
  vi.clearAllMocks();
  actorRole = "passenger";
  db.authSession.findUnique.mockImplementation(() => ({ id: "session", user_id: "actor",
    user: { id: "actor", role: actorRole, account_status: "active", security_version: 1,
      email_verified_at: new Date() }, security_version_at_issue: 1,
    expires_at: new Date(Date.now() + 60_000), revoked_at: null }));
  db.authSession.update.mockResolvedValue({});
});
describe("separate checkpoint research directory", () => {
  it("preserves the existing capability response for strict older clients", async () => {
    const result = await request(syntheticServer()).get("/api/v1/capabilities").set(auth()).expect(200);
    expect(result.body).not.toHaveProperty("checkpoint_directory_available");
  });
  it.each(["passenger", "driver"])("allows an authenticated %s to read only an approved synthetic catalog", async role => {
    actorRole = role; const app = syntheticServer();
    const result = await request(app).get("/api/v1/checkpoint-directory").set(auth(role)).expect(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body.count).toBe(3); expect(result.body.checkpoints).toHaveLength(3);
    expect(result.body.checkpoints.every((row: { traffic_status: string; latitude: unknown }) => row.traffic_status === "unavailable" && row.latitude === null)).toBe(true);
    const capability = await request(app).get("/api/v1/capabilities?include=checkpoint-directory").set(auth(role)).expect(200);
    expect(capability.body.checkpoint_directory_available).toBe(true);
    expect(capability.body.checkpoints_available).toBe(false);
  });
  it.each(["merchant", "admin"])("does not grant %s directory access", async role => {
    actorRole = role;
    await request(syntheticServer()).get("/api/v1/checkpoint-directory").set(auth(role)).expect(403);
  });
  it("rejects unapproved research without exposing names", async () => {
    const app = syntheticServer(false);
    const result = await request(app).get("/api/v1/checkpoint-directory").set(auth()).expect(503);
    expect(result.body.error).toBe("checkpoint_directory_unavailable");
    expect(JSON.stringify(result.body)).not.toContain("اسم تجريبي");
    expect((await request(app).get("/api/v1/capabilities?include=checkpoint-directory").set(auth()).expect(200)).body.checkpoint_directory_available).toBe(false);
  });
  it("rejects a revoked session before accessing directory records", async () => {
    const app = syntheticServer();
    db.authSession.findUnique.mockResolvedValue({ id: "session", user_id: "actor", user: { id: "actor", role: "passenger", account_status: "active", security_version: 1 }, security_version_at_issue: 1, expires_at: new Date(Date.now() + 60_000), revoked_at: new Date() });
    await request(app).get("/api/v1/checkpoint-directory").set(auth()).expect(401);
  });
  it("defaults its own capability disabled independently of live checkpoints", async () => {
    const config = createConfig(env);
    expect(config).toHaveProperty("checkpointDirectoryEnabled", false);
    const result = await request(createApp(config)).get("/api/v1/capabilities?include=checkpoint-directory").set(auth()).expect(200);
    expect(result.body.checkpoint_directory_available).toBe(false);
    expect(result.body.checkpoints_available).toBe(false);
  });
  it("disabled directory is absent even for authenticated callers", async () => {
    await request(createApp(createConfig(env))).get("/api/v1/checkpoint-directory").set(auth()).expect(404);
  });
  it("requires authentication before reading an enabled local file", async () => {
    const config = createConfig({ ...env, CHECKPOINT_DIRECTORY_ENABLED: "true", CHECKPOINT_DIRECTORY_FILE: "missing-local-file.json" });
    await request(createApp(config)).get("/api/v1/checkpoint-directory").expect(401);
  });
  it("does not expose filesystem details or data when the configured file is unavailable", async () => {
    const config = createConfig({ ...env, CHECKPOINT_DIRECTORY_ENABLED: "true", CHECKPOINT_DIRECTORY_FILE: "private-missing-directory.json" });
    const result = await request(createApp(config)).get("/api/v1/checkpoint-directory").set(auth()).expect(503);
    expect(result.body.error).toBe("checkpoint_directory_unavailable");
    expect(JSON.stringify(result.body)).not.toContain("private-missing");
    const capabilities = await request(createApp(config)).get("/api/v1/capabilities?include=checkpoint-directory").set(auth()).expect(200);
    expect(capabilities.body.checkpoint_directory_available).toBe(false);
  });
  it("requires an explicit local file before enabling the directory", () => {
    expect(() => createConfig({ ...env, CHECKPOINT_DIRECTORY_ENABLED: "true" })).toThrow(/CHECKPOINT_DIRECTORY_FILE/);
  });
  it("keeps the live checkpoint path disabled", async () => {
    await request(createApp(createConfig({ ...env, CHECKPOINT_DIRECTORY_ENABLED: "true", CHECKPOINT_DIRECTORY_FILE: "unused.json" })))
      .get("/api/v1/checkpoints").set(auth()).expect(404);
  });
});
