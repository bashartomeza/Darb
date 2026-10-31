import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { createQaLifecycle } from "./lib/qa-lifecycle.mjs";

// This harness accepts a server executable, never a database URL or datadir.
// All destructive integration fixtures target databases created by this process.
assert(process.argv.includes("--confirm-disposable"), "confirm_disposable_required");
assert(process.env.FUNCTIONAL_QA_MYSQLD, "FUNCTIONAL_QA_MYSQLD_required");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keepRunning = process.argv.includes("--keep-running");
const flutterRoot = process.env.FUNCTIONAL_QA_FLUTTER_ROOT;
if (keepRunning) {
  assert(flutterRoot, "FUNCTIONAL_QA_FLUTTER_ROOT_required_for_keep_running");
  await access(join(flutterRoot, "bin/cache/dart-sdk/bin", process.platform === "win32" ? "dart.exe" : "dart"));
  await access(join(flutterRoot, "bin/cache/flutter_tools.snapshot"));
}
for (const path of [join(root, ".env"), join(root, "apps/api/.env"), ...[".env", ".env.local", ".env.development", ".env.development.local"].map((name) => join(root, "apps/admin", name))]) {
  await assert.rejects(access(path), { code: "ENOENT" }, "Run in a clean checkout without dotenv files");
}
const systemEnv = {};
for (const key of ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "PROGRAMFILES"]) {
  if (process.env[key] !== undefined) systemEnv[key] = process.env[key];
}
const pathKey = Object.keys(systemEnv).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
systemEnv[pathKey] = `${dirname(process.execPath)}${delimiter}${systemEnv[pathKey] ?? ""}`;
const lifecycle = createQaLifecycle({ env: systemEnv, onChild: child => console.log(`OWNED child_pid=${child.pid ?? "not-started"}`) });
const runtime = lifecycle.runtime;
let connection;
let api;
let server;
let redact;
let evidenceRuntime;
try {
console.log(`Private runtime: ${runtime}`);
evidenceRuntime = await mkdtemp(join(tmpdir(), "masari-functional-evidence-"));
console.log(`Evidence directory: ${evidenceRuntime}`);
if (process.platform === "win32") {
  const acl = lifecycle.spawn(join(process.env.SYSTEMROOT ?? "C:\\Windows", "System32/icacls.exe"), [runtime, "/inheritance:r", "/grant:r", `${userInfo().username}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F"], { env: systemEnv, stdio: "ignore" });
  assert.equal(await lifecycle.wait(acl, { timeoutMs: 15_000 }), 0, "private_runtime_acl_failed");
}
const password = randomBytes(32).toString("hex");
const secrets = [password];
const secret = () => { const value = randomBytes(32).toString("hex"); secrets.push(value); return value; };
async function freePort() {
  const server = createServer();
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const port = server.address().port;
  await new Promise((ok) => server.close(ok));
  return port;
}
const port = await freePort();
const apiPort = await freePort();
const adminPort = await freePort();
const mobilePort = await freePort();
assert.equal(new Set([port, apiPort, adminPort, mobilePort]).size, 4, "qa_ports_must_be_unique");
const data = join(runtime, "data");
const bootstrap = join(runtime, "bootstrap.sql");
const emptyEnv = join(runtime, "empty.env");
await writeFile(emptyEnv, "# intentionally empty\n");
const env = { ...systemEnv, APP_ENV: "demo", ENABLE_DEMO_FEATURES: "true", APP_RELEASE: "local-functional-qa", LOG_LEVEL: "silent", TRUST_PROXY: "none", PORT: String(apiPort), API_BASE_URL: `http://127.0.0.1:${apiPort}`, DEMO_API_BASE_URL: `http://127.0.0.1:${apiPort}`, DOTENV_CONFIG_PATH: emptyEnv, ACCESS_TOKEN_TTL_SECONDS: "3600", REFRESH_TOKEN_TTL_DAYS: "30", CORS_ORIGINS: `http://127.0.0.1:${adminPort},http://127.0.0.1:${mobilePort}`, INVITATIONS_ENABLED: "true", PUBLIC_ONBOARDING_ENABLED: "false", OTP_PROVIDER: "fake", SUPPORTED_PHONE_REGIONS: "PS", MULTI_ROUTE_ENTRY_ENABLED: "false", MULTI_ROUTE_MATCHING_ENABLED: "false", CANONICAL_TRIP_CREATION_ENABLED: "false", CANONICAL_SHARED_TRIPS_ENABLED: "false", CI_MYSQL_LOOPBACK_QA: "true" };
for (const key of ["JWT_SECRET", "REFRESH_TOKEN_PEPPER", "AUTH_ACTION_TOKEN_PEPPER", "DEMO_RESET_KEY", "DEMO_PASSENGER_PASSWORD", "DEMO_DRIVER_PASSWORD", "DEMO_MERCHANT_PASSWORD", "DEMO_ADMIN_PASSWORD", "INVITATION_CODE_PEPPER", "PHONE_DIGEST_PEPPER", "OTP_CODE_PEPPER", "ONBOARDING_SESSION_PEPPER", "IDEMPOTENCY_KEY_PEPPER", "ABUSE_KEY_PEPPER"]) env[key] = secret();
env.npm_execpath = join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
if (process.argv.includes("--monitoring-expiry-regression")) {
  assert(process.argv.includes("--monitoring-only"), "expiry_regression_requires_monitoring_only");
  env.LEGACY_DISPATCH_INTERVAL_MS = "100";
}
redact = (text) => secrets.reduce((result, value) => result.replaceAll(value, "[REDACTED]"), text).replace(/mysql:\/\/[^\s"']+/g, "mysql://[REDACTED]");
const checks = [];
async function command(args, environment, label, executable = process.execPath, recordCheck = true) {
  console.log(`START ${label}`);
  const child = lifecycle.spawn(executable, args, { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  let status;
  try { status = await lifecycle.wait(child); }
  finally { await writeFile(join(evidenceRuntime, `${label}.log`), redact(output)); }
  console.log(`${status === 0 ? "PASS" : "FAIL"} ${label}`);
  assert.equal(status, 0, `${label} failed; inspect redacted runtime log`);
  if (recordCheck) checks.push(label);
}
await command(["--no-defaults", "--initialize-insecure", "--console", `--datadir=${data}`], systemEnv, "mysql_initialize", process.env.FUNCTIONAL_QA_MYSQLD, false);
await writeFile(bootstrap, `ALTER USER 'root'@'localhost' IDENTIFIED BY '${password}';\n`, { mode: 0o600 });
console.log("START mysql_server");
server = lifecycle.spawn(process.env.FUNCTIONAL_QA_MYSQLD, ["--no-defaults", `--datadir=${data}`, `--port=${port}`, "--bind-address=127.0.0.1", "--mysqlx=OFF", `--init-file=${bootstrap}`, `--log-error=${join(runtime, "mysql.err")}`], { env: systemEnv, stdio: "ignore" });
const clients = [];
const clientDiagnostics = new Map();
function startClient(label, executable, args, options) {
  console.log(`START ${label}`);
  const child = lifecycle.spawn(executable, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  const diagnostic = { label, output: "", stopped: false, saved: Promise.resolve() };
  const save = () => { diagnostic.stopped = true; diagnostic.saved = writeFile(join(evidenceRuntime, `${label}.log`), redact(diagnostic.output)); };
  child.stdout.on("data", chunk => { diagnostic.output += chunk; });
  child.stderr.on("data", chunk => { diagnostic.output += chunk; });
  child.once("error", error => { diagnostic.output += `\nstartup_error:${error.code ?? "unknown"}`; save(); });
  child.once("exit", save);
  clients.push(child);
  clientDiagnostics.set(child, diagnostic);
  return child;
}
async function waitFor(url, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    lifecycle.check();
    if (api && (api.exitCode !== null || api.signalCode !== null)) throw new Error("local_qa_api_exited");
    if (server && (server.exitCode !== null || server.signalCode !== null)) throw new Error("local_qa_mysql_exited");
    for (const diagnostic of clientDiagnostics.values()) if (diagnostic.stopped) {
      await diagnostic.saved;
      throw new Error(`local_qa_${diagnostic.label}_exited`);
    }
    try { if ((await fetch(url, { signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(2_000)]) })).ok) return; } catch {}
    await lifecycle.sleep(500);
  }
  throw new Error("local_qa_surface_not_ready");
}
const prisma = "node_modules/prisma/build/index.js";
async function database(label) {
  const name = `masari_functional_${label}_${randomBytes(5).toString("hex")}_ci`;
  assert(/^masari_functional_[a-z_]+_[0-9a-f]{10}_ci$/.test(name));
  await connection.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const url = new URL(`mysql://127.0.0.1:${port}/${name}`);
  url.username = "root"; url.password = password;
  return { ...env, DATABASE_URL: url.toString(), DEMO_RESET_ALLOWED_DATABASES: name };
}
  for (let attempt = 0; attempt < 150; attempt++) {
    lifecycle.check();
    try { connection = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password, connectTimeout: 1_000 }); break; } catch { await lifecycle.sleep(200); }
  }
  lifecycle.check();
  assert(connection, "isolated_mysql_start_failed");
  await writeFile(bootstrap, "-- consumed bootstrap credential\n");
  const [[version]] = await connection.query("SELECT VERSION() AS version");
  const currentEnv = await database("legacy");
  await command([prisma, "migrate", "deploy", "--config", "apps/api/prisma.config.ts"], currentEnv, "fresh_deploy");
  await command([prisma, "migrate", "deploy", "--config", "apps/api/prisma.config.ts"], currentEnv, "repeat_deploy");
  await command([prisma, "migrate", "status", "--config", "apps/api/prisma.config.ts"], currentEnv, "migration_status");
  const databaseName = new URL(currentEnv.DATABASE_URL).pathname.slice(1);
  // Reproduce the original setup defect at the real MySQL boundary, without weakening SQL mode.
  await assert.rejects(connection.query(`INSERT INTO \`${databaseName}\`.users (id,name,phone,password_hash,role) VALUES (?,?,?,?,?)`, ["functional_phone_probe", "TEST ONLY", `c7${"a".repeat(32)}-admin`, "unused", "admin"]), { code: "ER_DATA_TOO_LONG" });
  const [[probe]] = await connection.query(`SELECT COUNT(*) AS count FROM \`${databaseName}\`.users WHERE id = 'functional_phone_probe'`);
  assert.equal(probe.count, 0);
  checks.push("original_monitoring_phone_rejected_without_partial_row");
  await command(["node_modules/typescript/bin/tsc", "-p", "apps/api/tsconfig.json"], currentEnv, "api_build");
  if (process.argv.includes("--booking-probe")) {
    // Exercise its controlled HTTP app/clock before a monitoring API or any
    // background expiry worker can race its deadline/rollback cases.
    await command(["apps/api/dist/scripts/legacyBookingIntegration.js"], currentEnv, "legacy_booking_probe");
  }
  if (process.argv.includes("--monitoring-only")) {
    console.log("START api");
    api = lifecycle.spawn(process.execPath, ["scripts/local-functional-qa-api.mjs"], { cwd: root, env: currentEnv, stdio: "ignore" });
    await waitFor(`${env.API_BASE_URL}/api/v1/health/ready`);
    await command(["apps/api/dist/scripts/adminMatchingMonitoringIntegration.js"], currentEnv, "monitoring_regression");
  } else {
    const migrationRoot = join(root, "apps/api/prisma/migrations");
    const migrations = (await readdir(migrationRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const prior = join(runtime, "prior");
    await mkdir(join(prior, "migrations"), { recursive: true });
    await cp(join(root, "apps/api/prisma/schema.prisma"), join(prior, "schema.prisma"));
    await cp(join(migrationRoot, "migration_lock.toml"), join(prior, "migrations/migration_lock.toml"));
    for (const migration of migrations.slice(0, -1)) await cp(join(migrationRoot, migration), join(prior, "migrations", migration), { recursive: true });
    const config = join(runtime, "prior.config.ts");
    await writeFile(config, `export default { schema: ${JSON.stringify(join(prior, "schema.prisma"))}, migrations: { path: ${JSON.stringify(join(prior, "migrations"))} }, datasource: { url: process.env.DATABASE_URL } };\n`);
    const upgradeEnv = await database("upgrade");
    await command([prisma, "migrate", "deploy", "--config", config], upgradeEnv, "prior_deploy");
    await command([prisma, "migrate", "deploy", "--config", "apps/api/prisma.config.ts"], upgradeEnv, "upgrade_deploy");
    await command([prisma, "migrate", "deploy", "--config", "apps/api/prisma.config.ts"], upgradeEnv, "upgrade_repeat_deploy");
    await command([prisma, "migrate", "status", "--config", "apps/api/prisma.config.ts"], upgradeEnv, "upgrade_status");
    await command(["scripts/ci-mysql-integration.mjs"], currentEnv, "mysql_workflow");
    for (const script of ["demoResetGateIntegration", "legacyOnlineStateIntegration", "passengerTripAssociationIntegration"]) await command([`apps/api/dist/scripts/${script}.js`], currentEnv, script);
    for (const [label, script, shared] of [["canonical", "canonicalMatchingIntegration", false], ["shared", "canonicalSharedMatchingIntegration", true]]) {
      const canonicalEnv = { ...await database(label), APP_ENV: shared ? "demo" : "test", MULTI_ROUTE_ENTRY_ENABLED: "true", MULTI_ROUTE_MATCHING_ENABLED: "true", CANONICAL_TRIP_CREATION_ENABLED: "true", CANONICAL_SHARED_TRIPS_ENABLED: String(shared) };
      await command([prisma, "migrate", "deploy", "--config", "apps/api/prisma.config.ts"], canonicalEnv, `${label}_deploy`);
      await command([`apps/api/dist/scripts/${script}.js`], canonicalEnv, script);
    }
  }
  const evidence = { runtime: version.version, realDatabase: true, checks, completedAt: new Date().toISOString() };
  await writeFile(join(evidenceRuntime, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
  if (keepRunning) {
    // Start from a deterministic seed only after every requested validation passes.
    if (api) await lifecycle.stop(api);
    console.log("START api");
    api = lifecycle.spawn(process.execPath, ["scripts/local-functional-qa-api.mjs"], { cwd: root, env: currentEnv, stdio: "ignore" });
    await waitFor(`${env.API_BASE_URL}/api/v1/health/ready`);
    const reset = await fetch(`${env.API_BASE_URL}/api/v1/demo/reset`, { method: "POST", headers: { "content-type": "application/json", "x-demo-reset-key": env.DEMO_RESET_KEY }, body: "{}", signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(10_000)]) });
    assert.equal(reset.status, 200, "local_qa_seed_failed");
    const urls = { api: env.API_BASE_URL, admin: `http://127.0.0.1:${adminPort}`, mobile: `http://127.0.0.1:${mobilePort}` };
    const logins = Object.fromEntries(["admin", "passenger", "driver", "merchant"].map((role) => [role, { email: `demo.${role}@masari.app`, password: env[`DEMO_${role.toUpperCase()}_PASSWORD`] }]));
    const defines = join(runtime, "mobile-defines.json");
    await writeFile(defines, JSON.stringify({ APP_ENV: "demo", API_BASE_URL: urls.api, ENABLE_DEMO_FEATURES: true, ...Object.fromEntries(["passenger", "driver", "merchant"].flatMap((role) => [[`DEMO_${role.toUpperCase()}_EMAIL`, logins[role].email], [`DEMO_${role.toUpperCase()}_PASSWORD`, logins[role].password]])) }, null, 2), { mode: 0o600 });
    await writeFile(join(runtime, "qa-private.json"), JSON.stringify({ root, urls, logins, environment: currentEnv, stopFile: join(runtime, "STOP") }, null, 2), { mode: 0o600 });
    startClient("admin", process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(adminPort), "--strictPort"], { cwd: join(root, "apps/admin"), env: { ...systemEnv, VITE_APP_ENV: "demo", VITE_API_BASE_URL: urls.api, VITE_ENABLE_DEMO_FEATURES: "true", VITE_ROUTE_MANAGEMENT_ENABLED: "true", VITE_DEMO_ADMIN_PHONE: "+970590000005", VITE_DEMO_ADMIN_PASSWORD: env.DEMO_ADMIN_PASSWORD, VITE_DEMO_RESET_KEY: env.DEMO_RESET_KEY } });
    startClient("mobile", join(flutterRoot, "bin/cache/dart-sdk/bin", process.platform === "win32" ? "dart.exe" : "dart"), [`--packages=${join(flutterRoot, "packages/flutter_tools/.dart_tool/package_config.json")}`, join(flutterRoot, "bin/cache/flutter_tools.snapshot"), "run", "-d", "web-server", "--web-hostname", "127.0.0.1", "--web-port", String(mobilePort), "--no-pub", `--dart-define-from-file=${defines}`], { cwd: join(root, "apps/mobile"), env: { ...systemEnv, FLUTTER_ROOT: flutterRoot, FLUTTER_SUPPRESS_ANALYTICS: "true", CI: "true" } });
    await Promise.all([waitFor(urls.admin), waitFor(urls.mobile)]);
    console.log(JSON.stringify({ localQaReady: true, urls, privateRuntimeFile: join(runtime, "qa-private.json"), stopFile: join(runtime, "STOP") }));
    while (true) {
      lifecycle.check();
      if ([api, server, ...clients].some((child) => child.exitCode !== null || child.signalCode !== null)) throw new Error("local_qa_child_stopped");
      try { await access(join(runtime, "STOP")); break; } catch {}
      await lifecycle.sleep(1_000);
    }
  }
} catch (error) {
  if (!lifecycle.signal.aborted) throw error;
  console.log("Cancelled local QA; cleaning owned resources");
} finally {
  // A connection can be in use when cancellation arrives. Destroy it rather
  // than awaiting an unbounded query, then close only this invocation's jobs.
  connection?.destroy();
  try {
    if (server) await lifecycle.stop(server);
    if (redact && evidenceRuntime) {
      const diagnostic = await readFile(join(runtime, "mysql.err"), "utf8").catch(() => undefined);
      if (diagnostic) await writeFile(join(evidenceRuntime, "mysql.log"), redact(diagnostic));
    }
  } finally { await lifecycle.cleanup(); }
}
