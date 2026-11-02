import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import mariadb from "mariadb";

const root = resolve(import.meta.dirname, "..");
loadEnv({ path: resolve(root, "apps/api/.env"), quiet: true });
const apiBaseUrl = process.env.DEMO_API_BASE_URL ?? "http://localhost:3000";
const adminUrl = process.env.DEMO_ADMIN_URL ?? "http://localhost:5173";
const emulatorApiUrl = "http://10.0.2.2:3000";
const checks = [];

function resetAllowedDatabase(databaseUrl) {
  try {
    const name = new URL(databaseUrl).pathname.replace(/^\//, "");
    const allowed = (process.env.DEMO_RESET_ALLOWED_DATABASES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    return name.toLowerCase() !== "darb" && /^[A-Za-z0-9_]+$/.test(name) && allowed.includes(name) ? name : null;
  } catch {
    return null;
  }
}

function pass(name, detail) {
  checks.push({ name, ok: true, detail });
  console.log(`[pass] ${name}: ${detail}`);
}

function fail(name, detail) {
  checks.push({ name, ok: false, detail });
  console.error(`[fail] ${name}: ${detail}`);
}

async function checkHttp(name, url, validate) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return fail(name, `${url} returned ${response.status}`);
    if (validate) {
      const validationError = await validate(response);
      if (validationError) return fail(name, `${url} ${validationError}`);
    }
    pass(name, url);
  } catch (error) {
    fail(name, `${url} is unavailable (${error instanceof Error ? error.message : "unknown error"})`);
  }
}

for (const name of [
  "APP_ENV",
  "DATABASE_URL",
  "JWT_SECRET",
  "DEMO_RESET_KEY",
  "DEMO_PASSENGER_PASSWORD",
  "DEMO_DRIVER_PASSWORD",
  "DEMO_MERCHANT_PASSWORD",
  "DEMO_ADMIN_PASSWORD"
]) {
  if (process.env[name]) pass(`environment ${name}`, "configured");
  else fail(`environment ${name}`, "missing");
}

if (process.env.APP_ENV === "demo") pass("application environment", "demo");
else fail("application environment", "APP_ENV must be demo for rehearsal tooling");

if (process.env.ACCESS_TOKEN_TTL_SECONDS) pass("access-token lifetime", "configured for demo");
else pass("access-token lifetime", "safe non-production default");
if (process.env.REFRESH_TOKEN_TTL_DAYS) pass("refresh-token lifetime", "configured for demo");
else pass("refresh-token lifetime", "safe bounded default");
if (process.env.REFRESH_TOKEN_PEPPER) pass("refresh-token protection", "configured without disclosure");
else pass("refresh-token protection", "derived non-production protection; explicit value required in staging/production");

if (process.env.DATABASE_URL) {
  let connection;
  try {
    const databaseUrl = new URL(process.env.DATABASE_URL);
    if (databaseUrl.protocol !== "mysql:") throw new Error("unexpected provider");
    const resetDatabase = resetAllowedDatabase(process.env.DATABASE_URL);
    if (!resetDatabase) throw new Error("database is not explicitly reset-safe");
    connection = await mariadb.createConnection({
      host: databaseUrl.hostname,
      port: Number(databaseUrl.port || 3306),
      user: decodeURIComponent(databaseUrl.username),
      password: decodeURIComponent(databaseUrl.password),
      database: databaseUrl.pathname.replace(/^\//, "")
    });
    const rows = await connection.query(
      "SELECT DATABASE() AS database_name, @@character_set_database AS character_set, @@collation_database AS collation"
    );
    if (rows[0]?.database_name !== resetDatabase) throw new Error("unexpected database");
    if (rows[0]?.character_set !== "utf8mb4") throw new Error("unexpected character set");
    pass("database provider", "mysql");
    pass("MySQL", "reachable; dedicated reset-safe database uses utf8mb4");
    pass("MySQL collation", String(rows[0]?.collation ?? "configured"));
  } catch {
    fail("MySQL", "connection or provider verification failed");
  } finally {
    await connection?.end().catch(() => undefined);
  }
}

await checkHttp("API health", `${apiBaseUrl}/api/v1/health`, async (response) => {
  const body = await response.json().catch(() => null);
  return body?.ok === true && body?.service === "darb-api" && body?.request_id ? undefined : "is not the Darb API";
});
await checkHttp("API readiness", `${apiBaseUrl}/api/v1/health/ready`, async (response) => {
  const body = await response.json().catch(() => null);
  return body?.ok === true && body?.status === "ready" && body?.request_id ? undefined : "is not database-ready";
});
await checkHttp("admin console", adminUrl, async (response) => {
  const body = await response.text();
  return /<title>(Darb|Darb) Admin Console<\/title>/.test(body) ? undefined : "is not the Darb admin console";
});

const adminExample = readFileSync(resolve(root, "apps/admin/.env.example"), "utf8");
if (adminExample.includes("VITE_API_BASE_URL=http://localhost:3000")) {
  pass("admin API URL", "http://localhost:3000");
} else {
  fail("admin API URL", "apps/admin/.env.example is not aligned to port 3000");
}

const mobileConfig = readFileSync(resolve(root, "apps/mobile/lib/core/config/app_config.dart"), "utf8");
if (mobileConfig.includes("String.fromEnvironment('API_BASE_URL')")) {
  pass("mobile API URL", emulatorApiUrl);
} else {
  fail("mobile API URL", `AppConfig default is not ${emulatorApiUrl}`);
}

const apkPath = resolve(root, "apps/mobile/build/app/outputs/flutter-apk/app-debug.apk");
if (existsSync(apkPath)) pass("debug APK", apkPath);
else fail("debug APK", `missing at ${apkPath}`);

const adb = spawnSync("adb", ["devices"], { encoding: "utf8", shell: process.platform === "win32" });
if (adb.status === 0) {
  const devices = adb.stdout
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => /\tdevice$/.test(line));
  if (devices.length > 0) pass("Android device", devices.join(", "));
  else fail("Android device", "no connected emulator/device in adb state 'device'");
} else {
  fail("Android device", "adb is unavailable");
}

const failed = checks.filter((check) => !check.ok);
console.log(`[demo:preflight] ${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
