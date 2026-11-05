import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({ prisma: {} }));

const { createApp } = await import("../app.js");
const { createConfig } = await import("../config.js");

const env = {
  APP_ENV: "local",
  DATABASE_URL: "mysql://synthetic:unused@localhost:59998/admin_site",
  JWT_SECRET: "admin-site-synthetic-jwt-secret-over-thirty-two-characters",
  CORS_ORIGINS: "http://localhost:5173",
  LOG_LEVEL: "silent"
};

let siteDir: string;

beforeAll(() => {
  siteDir = mkdtempSync(join(tmpdir(), "darb-admin-site-"));
  mkdirSync(join(siteDir, "assets"));
  writeFileSync(join(siteDir, "index.html"), "<!doctype html><title>Darb Admin</title>");
  writeFileSync(join(siteDir, "assets", "index-abc123.js"), "console.log('admin');");
  writeFileSync(join(siteDir, "favicon.svg"), "<svg/>");
});

afterAll(() => rmSync(siteDir, { recursive: true, force: true }));

describe("Admin site served by the API (single-app hosting)", () => {
  const app = () => createApp(createConfig({ ...env, ADMIN_STATIC_DIR: siteDir } as NodeJS.ProcessEnv));

  it("serves the console page at the root, uncached", async () => {
    const res = await request(app()).get("/").expect(200);
    expect(res.text).toContain("Darb Admin");
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("serves deep links with the console page", async () => {
    const res = await request(app()).get("/drivers/pending").expect(200);
    expect(res.text).toContain("Darb Admin");
  });

  it("serves hashed assets with a long cache and other files without one", async () => {
    const asset = await request(app()).get("/assets/index-abc123.js").expect(200);
    expect(asset.headers["cache-control"]).toContain("immutable");
    const icon = await request(app()).get("/favicon.svg").expect(200);
    expect(icon.headers["cache-control"]).toBe("no-cache");
  });

  it("keeps unknown API paths as JSON 404s, never the console page", async () => {
    for (const path of ["/api/v1/does-not-exist", "/api", "/api/other"]) {
      const res = await request(app()).get(path).expect(404);
      expect(res.text).not.toContain("Darb Admin");
    }
    await request(app()).get("/api/v1/health/live").expect(200);
  });

  it("serves nothing extra when the setting is off", async () => {
    const plain = createApp(createConfig(env as NodeJS.ProcessEnv));
    const res = await request(plain).get("/").expect(404);
    expect(res.text).not.toContain("Darb Admin");
  });

  it("refuses a relative directory at startup", () => {
    expect(() => createConfig({ ...env, ADMIN_STATIC_DIR: "admin" } as NodeJS.ProcessEnv)).toThrow(/ADMIN_STATIC_DIR must be an absolute path/);
  });
});
