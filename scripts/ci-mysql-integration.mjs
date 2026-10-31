import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { executable } from "./lib/process.mjs";

if (process.env.APP_ENV !== "demo") throw new Error("CI MySQL integration requires APP_ENV=demo");
const database = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!database.endsWith("_ci")) throw new Error("CI MySQL integration refuses a database not ending in _ci");
const resetAllowedDatabases = (process.env.DEMO_RESET_ALLOWED_DATABASES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
if (database.toLowerCase() === "masari" || !resetAllowedDatabases.includes(database)) {
  throw new Error("CI MySQL integration requires an explicitly reset-safe database");
}
const root = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const apiOrigin = (process.env.API_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const apiEntrypoint = process.env.CI_MYSQL_LOOPBACK_QA === "true"
  ? "scripts/local-functional-qa-api.mjs"
  : "apps/api/dist/server.js";
const child = spawn(process.execPath, [apiEntrypoint], { cwd: root, env: {
  ...process.env,
  MULTI_ROUTE_ENTRY_ENABLED: "false",
  MULTI_ROUTE_MATCHING_ENABLED: "false",
  CANONICAL_TRIP_CREATION_ENABLED: "false",
  CANONICAL_SHARED_TRIPS_ENABLED: "false"
}, stdio: "inherit" });
try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    await delay(500);
    try {
      const response = await fetch(`${apiOrigin}/api/v1/health/ready`);
      if (response.ok) { ready = true; break; }
    } catch {}
  }
  if (!ready) throw new Error("CI API did not become ready");
  const npmFile = process.platform === "win32" && process.env.npm_execpath ? process.execPath : executable("npm");
  for (const [script, label, environment = {}] of [
    ["demo:smoke", "deterministic smoke"],
    ["test:integration:sessions", "trusted-session smoke"],
    ["test:integration:onboarding", "onboarding foundation concurrency smoke"],
    ["test:integration:consents", "consent publication lifecycle and concurrency smoke"],
    ["test:integration:public-onboarding", "public onboarding race and privacy smoke", {
      PUBLIC_ONBOARDING_ENABLED: "true",
      ONBOARDING_TEST_LEGAL_FIXTURES_ENABLED: "true",
      OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED: "true",
      DRIVER_DOCUMENTS_ENABLED: "true",
      DRIVER_DOCUMENTS_DIR: resolve(tmpdir(), "masari-ci-public-onboarding-documents"),
      IDEMPOTENCY_PAYLOAD_PEPPER: "ci-only-payload-pepper-at-least-thirty-two-characters"
    }],
    ["test:integration:routes", "route lifecycle and concurrency smoke"],
    ["test:integration:monitoring", "read-only matching and batching monitoring smoke", {
      MULTI_ROUTE_ENTRY_ENABLED: "false",
      MULTI_ROUTE_MATCHING_ENABLED: "false",
      CANONICAL_TRIP_CREATION_ENABLED: "false",
      CANONICAL_SHARED_TRIPS_ENABLED: "false"
    }],
    ["test:integration:multi-route", "multi-route operational concurrency smoke", {
      MULTI_ROUTE_ENTRY_ENABLED: "true",
      MULTI_ROUTE_MATCHING_ENABLED: "false"
    }]
  ]) {
    const npmArgs = process.platform === "win32" && process.env.npm_execpath
      ? [process.env.npm_execpath, "run", script]
      : ["run", script];
    const smoke = spawn(npmFile, npmArgs, { cwd: root, env: { ...process.env, ...environment }, stdio: "inherit" });
    const status = await new Promise((resolveStatus) => smoke.once("exit", resolveStatus));
    if (status !== 0) throw new Error(`Real-MySQL ${label} failed`);
  }
} finally {
  child.kill("SIGTERM");
  await Promise.race([new Promise((done) => child.once("exit", done)), delay(12_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
