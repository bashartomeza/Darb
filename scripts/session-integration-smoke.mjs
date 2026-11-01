import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";
import { createMysqlDefaults } from "./lib/mysql-tools.mjs";

loadEnv({ path: resolve(import.meta.dirname, "../apps/api/.env"), quiet: true });

const apiOrigin = (process.env.API_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const apiBaseUrl = `${apiOrigin}/api/v1`;
const databaseUrl = process.env.DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : "";
const resetKey = process.env.DEMO_RESET_KEY;
const passengerCredentials = ["demo.passenger@darb.app", process.env.DEMO_PASSENGER_PASSWORD];
const adminCredentials = ["demo.admin@darb.app", process.env.DEMO_ADMIN_PASSWORD];
let mysqlDefaults;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSafeShape(value, context) {
  const serialized = JSON.stringify(value);
  for (const forbidden of ["token_hash", "password_hash", "refresh_token_pepper", "security_version_at_issue", "revoke_reason"]) {
    assert(!serialized.includes(forbidden), `${context} exposed ${forbidden}`);
  }
}

function safeDatabaseId(value, context) {
  assert(typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value), `${context} was not a safe database ID`);
  return value;
}

function mysql(sql) {
  assert(mysqlDefaults, "MySQL inspection credentials were not initialized");
  const result = spawnSync(
    "mysql",
    [`--defaults-extra-file=${mysqlDefaults.path}`, "--batch", "--skip-column-names", "--database", databaseName],
    { encoding: "utf8", input: `${sql.trim()}\n`, maxBuffer: 1024 * 1024 }
  );
  if (result.error || result.status !== 0) throw new Error("Persistent MySQL assertion failed; sensitive output was withheld");
  return result.stdout.trim();
}

function mysqlNumbers(sql, expectedColumns, context) {
  const values = mysql(sql).split("\t").map(Number);
  assert(values.length === expectedColumns && values.every(Number.isFinite), `${context} returned an invalid shape`);
  return values;
}

function assertRevokedRotationState(sessionId, context) {
  const id = safeDatabaseId(sessionId, context);
  const [sessionCount, revokedSessions, tokenCount, usedTokens, revokedTokens, replacementLinks] = mysqlNumbers(
    `SELECT
      (SELECT COUNT(*) FROM auth_sessions WHERE id='${id}'),
      (SELECT COUNT(*) FROM auth_sessions WHERE id='${id}' AND revoked_at IS NOT NULL),
      (SELECT COUNT(*) FROM refresh_tokens WHERE session_id='${id}'),
      (SELECT COUNT(*) FROM refresh_tokens WHERE session_id='${id}' AND used_at IS NOT NULL),
      (SELECT COUNT(*) FROM refresh_tokens WHERE session_id='${id}' AND revoked_at IS NOT NULL),
      (SELECT COUNT(*) FROM refresh_tokens WHERE session_id='${id}' AND replaced_by_id IS NOT NULL)`,
    6,
    context
  );
  assert(sessionCount === 1 && revokedSessions === 1, `${context} did not persist session revocation`);
  assert(tokenCount === 2 && usedTokens === 1, `${context} did not persist one-time rotation state`);
  assert(revokedTokens === tokenCount && replacementLinks === 1, `${context} did not revoke and link the full token chain`);
}

async function call(path, { token, method = "GET", body, headers = {}, expected = [200] } = {}) {
  const requestHeaders = { "content-type": "application/json", ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  assertSafeShape(data, `${method} ${path}`);
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status)) {
    throw new Error(`${method} ${path}: expected ${allowed.join("/")}, received ${response.status} (${data?.error ?? "no error code"})`);
  }
  return { status: response.status, data };
}

async function reset() {
  await call("/demo/reset", {
    method: "POST",
    body: {},
    headers: { "x-demo-reset-key": resetKey }
  });
  const verified = mysql(`SELECT email_verified_at IS NOT NULL AND phone_verified_at IS NOT NULL AND profile_state='complete'
    FROM users WHERE email='demo.passenger@darb.app'`);
  assert(verified === "1", "Demo reset did not create a verified complete passenger");
}

async function login([email, password], deviceName) {
  const { data } = await call("/auth/login", {
    method: "POST",
    body: { email, password, device_name: deviceName }
  });
  return data;
}

async function expectRejected(path, token, statuses = [401]) {
  const { status } = await call(path, { token, expected: statuses });
  assert(statuses.includes(status), `${path} unexpectedly accepted a revoked identity`);
}

async function run() {
  assert(process.env.APP_ENV === "demo", "Trusted-session integration requires APP_ENV=demo");
  assert(databaseName.endsWith("_ci"), "Trusted-session integration refuses a database not ending in _ci");
  assert(/^[A-Za-z0-9_]+$/.test(databaseName), "Trusted-session integration requires a safe database name");
  const resetAllowedDatabases = (process.env.DEMO_RESET_ALLOWED_DATABASES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  assert(databaseName.toLowerCase() !== "darb" && resetAllowedDatabases.includes(databaseName), "Trusted-session integration requires an explicitly reset-safe database");
  assert(resetKey && passengerCredentials[1] && adminCredentials[1], "Required demo credentials are unavailable");
  mysqlDefaults = createMysqlDefaults(new URL(databaseUrl));
  await reset();

  const initial = await login(passengerCredentials, "integration-initial");
  assert(initial.token && initial.refresh_token, "Eligible mobile login did not issue both token classes");
  assert(initial.token === initial.access_token, "Legacy token compatibility changed");
  const initialSessions = (await call("/auth/sessions", { token: initial.token })).data.sessions;
  assert(initialSessions.length === 1 && initialSessions[0].is_current, "Initial server session was not persisted");

  const rotated = (
    await call("/auth/refresh", { method: "POST", body: { refresh_token: initial.refresh_token } })
  ).data;
  assert(rotated.refresh_token && rotated.refresh_token !== initial.refresh_token, "Refresh token did not rotate");
  await call("/auth/refresh", {
    method: "POST",
    body: { refresh_token: initial.refresh_token },
    expected: [401]
  });
  await expectRejected("/me", rotated.token);
  assertRevokedRotationState(initial.session.id, "used-token replay");

  const raceLogin = await login(passengerCredentials, "integration-race");
  const race = await Promise.all([
    call("/auth/refresh", {
      method: "POST",
      body: { refresh_token: raceLogin.refresh_token },
      expected: [200, 401]
    }),
    call("/auth/refresh", {
      method: "POST",
      body: { refresh_token: raceLogin.refresh_token },
      expected: [200, 401]
    })
  ]);
  assert(race.filter((result) => result.status === 200).length === 1, "Concurrent refresh did not produce exactly one success");
  assert(race.filter((result) => result.status === 401).length === 1, "Concurrent refresh did not reject exactly one contender");
  const raceWinner = race.find((result) => result.status === 200).data;
  await expectRejected("/me", raceWinner.token);
  assertRevokedRotationState(raceLogin.session.id, "concurrent refresh");

  const roleBound = await login(passengerCredentials, "integration-role-bound");
  const roleBoundUserId = safeDatabaseId(roleBound.user.id, "role-bound user");
  mysql(`UPDATE users SET role='admin' WHERE id='${roleBoundUserId}'`);
  const roleChanged = await call("/auth/refresh", {
    method: "POST",
    body: { refresh_token: roleBound.refresh_token },
    expected: [401]
  });
  assert(roleChanged.data.error === "invalid_session", "Role-changed refresh did not fail as an invalid session");
  const [roleSessionRevoked, roleTokensRevoked] = mysqlNumbers(
    `SELECT
      (SELECT COUNT(*) FROM auth_sessions WHERE id='${safeDatabaseId(roleBound.session.id, "role-bound session")}' AND revoked_at IS NOT NULL),
      (SELECT COUNT(*) FROM refresh_tokens WHERE session_id='${safeDatabaseId(roleBound.session.id, "role-bound session")}' AND revoked_at IS NOT NULL)`,
    2,
    "role-bound refresh"
  );
  assert(roleSessionRevoked === 1 && roleTokensRevoked === 1, "Role-changed refresh did not persist revocation");

  await reset();

  const primary = await login(passengerCredentials, "integration-primary");
  const secondary = await login(passengerCredentials, "integration-secondary");
  const sessions = (await call("/auth/sessions", { token: primary.token })).data.sessions;
  const secondarySession = sessions.find((item) => item.id === secondary.session.id);
  assert(secondarySession && !secondarySession.is_current, "Own session listing did not include the second session");
  await call(`/auth/sessions/${secondary.session.id}`, { token: primary.token, method: "DELETE" });
  await expectRejected("/me", secondary.token);
  await call("/me", { token: primary.token });

  await call("/auth/logout", { token: primary.token, method: "POST" });
  await call("/auth/logout", { token: primary.token, method: "POST" });
  await expectRejected("/me", primary.token);

  const allOne = await login(passengerCredentials, "integration-all-one");
  const allTwo = await login(passengerCredentials, "integration-all-two");
  await call("/auth/logout-all", { token: allOne.token, method: "POST" });
  await expectRejected("/me", allOne.token);
  await expectRejected("/me", allTwo.token);

  const target = await login(passengerCredentials, "integration-status-target");
  const administrator = await login(adminCredentials, "integration-admin");
  assert(!("refresh_token" in administrator), "Admin browser login received a long-lived refresh token");
  await call(`/admin/users/${target.user.id}/status`, {
    token: administrator.token,
    method: "PATCH",
    body: { status: "suspended", reason: "Automated integration suspension", expected_status: "active" }
  });
  await expectRejected("/me", target.token, [403]);
  await call("/auth/login", {
    method: "POST",
    body: { email: passengerCredentials[0], password: passengerCredentials[1] },
    expected: [403]
  });
  await call(`/admin/users/${target.user.id}/status`, {
    token: administrator.token,
    method: "PATCH",
    body: { status: "active", expected_status: "suspended" }
  });
  await expectRejected("/me", target.token);
  const reactivated = await login(passengerCredentials, "integration-reactivated");
  await call("/me", { token: reactivated.token });

  await reset();
  const concurrencyAdmin = await login(adminCredentials, "integration-admin-one");
  const secondAdminId = "integration_admin_2";
  const secondAdminEmail = "integration.admin.2@darb.app";
  const secondAdminPhone = "+970590000006";
  const secondAdminHash = await bcrypt.hash(adminCredentials[1], 4);
  mysql(`INSERT INTO users
    (id, name, phone, phone_verified_at, email, email_verified_at, password_hash, profile_state, role, account_status, security_version, status_updated_at, demo_account, created_at)
    VALUES ('${secondAdminId}', 'Integration Admin 2', '${secondAdminPhone}', CURRENT_TIMESTAMP(3), '${secondAdminEmail}', CURRENT_TIMESTAMP(3), '${secondAdminHash}', 'complete', 'admin', 'active', 1, CURRENT_TIMESTAMP(3), TRUE, CURRENT_TIMESTAMP(3))`);
  const secondAdmin = await login([secondAdminEmail, adminCredentials[1]], "integration-admin-two");
  const adminStatusRace = await Promise.all([
    call(`/admin/users/${secondAdminId}/status`, {
      token: concurrencyAdmin.token,
      method: "PATCH",
      body: { status: "disabled", reason: "Concurrent admin invariant test", expected_status: "active" },
      expected: [200, 403, 409]
    }),
    call(`/admin/users/${safeDatabaseId(concurrencyAdmin.user.id, "primary admin")}/status`, {
      token: secondAdmin.token,
      method: "PATCH",
      body: { status: "disabled", reason: "Concurrent admin invariant test", expected_status: "active" },
      expected: [200, 403, 409]
    })
  ]);
  assert(adminStatusRace.filter((result) => result.status === 200).length === 1, "Concurrent admin changes did not permit exactly one transition");
  const [activeAdmins, inactiveAdmins] = mysqlNumbers(
    `SELECT
      SUM(account_status='active'),
      SUM(account_status IN ('suspended','disabled'))
      FROM users WHERE id IN ('${safeDatabaseId(concurrencyAdmin.user.id, "primary admin")}', '${secondAdminId}')`,
    2,
    "last-active-admin invariant"
  );
  assert(activeAdmins === 1 && inactiveAdmins === 1, "Concurrent admin changes violated the persistent active-admin invariant");

  await reset();
  const raceAdministrator = await login(adminCredentials, "integration-login-race-admin");
  const existingPassenger = await login(passengerCredentials, "integration-login-race-existing");
  const loginStatusRace = await Promise.all([
    call("/auth/login", {
      method: "POST",
      body: { email: passengerCredentials[0], password: passengerCredentials[1], device_name: "integration-login-race" },
      expected: [200, 403]
    }),
    call(`/admin/users/${safeDatabaseId(existingPassenger.user.id, "login-race passenger")}/status`, {
      token: raceAdministrator.token,
      method: "PATCH",
      body: { status: "suspended", reason: "Concurrent login suspension test", expected_status: "active" }
    })
  ]);
  assert(loginStatusRace[1].status === 200, "Concurrent suspension did not complete");
  const [unrevokedSessions] = mysqlNumbers(
    `SELECT COUNT(*) FROM auth_sessions WHERE user_id='${safeDatabaseId(existingPassenger.user.id, "login-race passenger")}' AND revoked_at IS NULL`,
    1,
    "login/status race"
  );
  assert(unrevokedSessions === 0, "A completed suspension left an unrevoked login session");
  if (loginStatusRace[0].status === 200) await expectRejected("/me", loginStatusRace[0].data.token, [401, 403]);

  await reset();
  return {
    ok: true,
    databasePolicy: "dedicated _ci database",
    rotation: "passed",
    reuseRevocation: "passed",
    concurrency: "exactly one success",
    sessionRevocation: "passed",
    logoutAll: "passed",
    accountStatus: "passed",
    roleBinding: "passed",
    adminConcurrency: "one active admin preserved",
    persistentState: "verified",
    cleanup: "passed"
  };
}

try {
  console.log(JSON.stringify(await run()));
} catch (error) {
  console.error(`[session-integration] FAILED: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  mysqlDefaults?.cleanup();
}
