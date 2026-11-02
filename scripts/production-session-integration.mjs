import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { withoutLocalOnlyEnvironment } from "./lib/production-environment.mjs";

const database = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!database.endsWith("_ci")) throw new Error("Production-session integration refuses a database not ending in _ci");

const apiOrigin = "http://127.0.0.1:3102";
const apiBaseUrl = `${apiOrigin}/api/v1`;
const productionEnvironment = {
  ...withoutLocalOnlyEnvironment(process.env),
  APP_ENV: "production",
  ENABLE_DEMO_FEATURES: "false",
  APP_RELEASE: "m6c1a-production-integration",
  ACCESS_TOKEN_TTL_SECONDS: "900",
  REFRESH_TOKEN_TTL_DAYS: "30",
  REFRESH_TOKEN_PEPPER: randomBytes(32).toString("base64url"),
  CORS_ORIGINS: "https://admin.darb.invalid",
  TRUST_PROXY: "none",
  LOG_LEVEL: "silent",
  PORT: "3102"
};
const child = spawn(process.execPath, ["apps/api/dist/server.js"], {
  cwd: process.cwd(),
  env: productionEnvironment,
  stdio: "inherit"
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function call(path, { token, method = "GET", body, expected = [200] } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status)) {
    throw new Error(`${method} ${path}: expected ${allowed.join("/")}, received ${response.status} (${data?.error ?? "no error code"})`);
  }
  return { status: response.status, data };
}

async function login(email, password) {
  return (
    await call("/auth/login", { method: "POST", body: { email, password } })
  ).data;
}

function jwtLifetime(token) {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  return payload.exp - payload.iat;
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await delay(500);
    try {
      if ((await fetch(`${apiBaseUrl}/health/ready`)).ok) {
        ready = true;
        break;
      }
    } catch {}
  }
  if (!ready) throw new Error("Production-like API did not become ready");
  await call("/demo/reset", { method: "POST", body: {}, expected: [404] });
  await call("/compare/run", { method: "POST", body: {}, expected: [404] });

  const passenger = await login("demo.passenger@darb.app", process.env.DEMO_PASSENGER_PASSWORD);
  const admin = await login("demo.admin@darb.app", process.env.DEMO_ADMIN_PASSWORD);
  assert(jwtLifetime(passenger.token) === 900, "Production access token did not use the approved 900-second lifetime");
  assert(passenger.refresh_token, "Production mobile login did not issue a refresh token");
  assert(!("refresh_token" in admin), "Production admin login received a refresh token");
  await call("/me", { token: passenger.token });

  await call(`/admin/users/${passenger.user.id}/status`, {
    token: admin.token,
    method: "PATCH",
    body: { status: "suspended", reason: "Production integration suspension", expected_status: "active" }
  });
  await call("/me", { token: passenger.token, expected: [403] });
  await call("/auth/login", {
    method: "POST",
    body: { email: "demo.passenger@darb.app", password: process.env.DEMO_PASSENGER_PASSWORD },
    expected: [403]
  });
  await call(`/admin/users/${passenger.user.id}/status`, {
    token: admin.token,
    method: "PATCH",
    body: { status: "active", expected_status: "suspended" }
  });
  await call("/me", { token: passenger.token, expected: [401] });
  const reauthenticated = await login("demo.passenger@darb.app", process.env.DEMO_PASSENGER_PASSWORD);
  await call("/me", { token: reauthenticated.token });
  console.log(
    JSON.stringify({
      ok: true,
      accessTokenLifetimeSeconds: 900,
      demoRoutes: "absent",
      adminRefresh: "excluded",
      suspension: "immediate",
      reauthentication: "required"
    })
  );
} catch (error) {
  console.error(`[production-session-integration] FAILED: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  await Promise.race([new Promise((done) => child.once("exit", done)), delay(12_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
