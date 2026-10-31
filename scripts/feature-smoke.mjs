// End-to-end HTTP smoke for the notification, incident, report and dashboard
// features against a running demo API. Like demo-smoke, it resets the database
// first, so it refuses anything that is not an explicitly reset-safe database.
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(import.meta.dirname, "../apps/api/.env"), quiet: true });

const apiOrigin = process.env.DEMO_API_BASE_URL ?? "http://localhost:3000";
const apiBaseUrl = `${apiOrigin.replace(/\/$/, "")}/api/v1`;
const resetKey = process.env.DEMO_RESET_KEY;
const startedAt = Date.now();

function assertResetSafeDatabase() {
  const allowed = (process.env.DEMO_RESET_ALLOWED_DATABASES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  let name = "";
  try { name = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""); } catch {}
  if (name.toLowerCase() === "masari" || !/^[A-Za-z0-9_]+$/.test(name) || !allowed.includes(name)) {
    throw new Error("Feature smoke refuses a database that is not explicitly reset-safe");
  }
}

const accounts = {
  passenger: ["demo.passenger@masari.app", process.env.DEMO_PASSENGER_PASSWORD],
  driver1: ["demo.driver@masari.app", process.env.DEMO_DRIVER_PASSWORD],
  driver2: ["demo.driver2@masari.app", process.env.DEMO_DRIVER_PASSWORD],
  merchant: ["demo.merchant@masari.app", process.env.DEMO_MERCHANT_PASSWORD],
  admin: ["demo.admin@masari.app", process.env.DEMO_ADMIN_PASSWORD]
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { token, method = "GET", body, headers = {}, expected = 200, raw = false } = {}) {
  const requestHeaders = { "content-type": "application/json", ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  const text = await response.text();
  if (response.status !== expected) {
    throw new Error(`${method} ${path}: expected ${expected}, received ${response.status} (${text.slice(0, 120)})`);
  }
  if (raw) return { response, text };
  return text ? JSON.parse(text) : null;
}

async function login(role) {
  const [email, password] = accounts[role];
  return (await request("/auth/login", { method: "POST", body: { email, password } })).token;
}

const typesOf = (inbox) => inbox.notifications.map((item) => item.type);

async function run() {
  assertResetSafeDatabase();
  await request("/demo/reset", { method: "POST", body: {}, headers: { "x-demo-reset-key": resetKey } });
  const t = Object.fromEntries(await Promise.all(Object.keys(accounts).map(async (role) => [role, await login(role)])));

  // --- Notifications -------------------------------------------------------
  await request("/notifications", { expected: 401 });
  const empty = await request("/notifications", { token: t.driver1 });
  assert(empty.unread_count === 0 && empty.notifications.length === 0, "inbox should start empty after reset");

  const [{ requests }, { orders }] = await Promise.all([
    request("/admin/requests", { token: t.admin }),
    request("/admin/orders", { token: t.admin })
  ]);
  await request(`/merchant/orders/${orders[0].id}/batch`, { token: t.merchant, method: "POST", body: {}, expected: 201 });
  const { match } = await request("/matches/run", {
    token: t.admin,
    method: "POST",
    body: { passengerRequestId: requests[0].id, merchantOrderId: orders[0].id },
    expected: 201
  });

  const driverInbox = await request("/notifications", { token: t.driver1 });
  assert(typesOf(driverInbox).includes("match_offered") && driverInbox.unread_count === 1, "driver was not told about the offer");
  assert((await request("/notifications", { token: t.driver2 })).notifications.length === 0, "other driver received the offer");

  const { trip } = await request(`/matches/${match.id}/accept`, { token: t.driver1, method: "POST", body: {}, expected: 201 });
  for (const status of ["pickup_started", "picked_up", "in_transit"]) {
    await request(`/trips/${trip.id}/status`, { token: t.driver1, method: "POST", body: { status } });
  }
  for (const role of ["passenger", "merchant"]) {
    const inbox = await request("/notifications", { token: t[role] });
    const types = typesOf(inbox);
    assert(types.includes("match_accepted"), `${role} was not told the match was accepted`);
    const statuses = inbox.notifications.filter((n) => n.type === "trip_status").map((n) => n.params.status).sort();
    assert(JSON.stringify(statuses) === JSON.stringify(["in_transit", "picked_up", "pickup_started"]), `${role} trip updates: ${statuses}`);
  }

  const passengerInbox = await request("/notifications", { token: t.passenger });
  const first = passengerInbox.notifications[0];
  await request(`/notifications/${first.id}/read`, { token: t.merchant, method: "POST", body: {}, expected: 404 });
  await request(`/notifications/${first.id}/read`, { token: t.passenger, method: "POST", body: {} });
  const after = await request("/notifications", { token: t.passenger });
  assert(after.unread_count === passengerInbox.unread_count - 1, "marking one read did not lower the count");
  await request("/notifications/read-all", { token: t.passenger, method: "POST", body: {} });
  assert((await request("/notifications?unread_only=true", { token: t.passenger })).notifications.length === 0, "read-all left unread entries");

  // --- Incidents -----------------------------------------------------------
  await request("/incidents", { token: t.admin, method: "POST", body: { category: "delay", description: "n/a" }, expected: 403 });
  await request("/incidents", { token: t.driver2, method: "POST", body: { category: "delay", description: "Not my trip", trip_id: trip.id }, expected: 404 });
  await request("/incidents", { token: t.passenger, method: "POST", body: { category: "fire", description: "bad category" }, expected: 400 });
  const filed = (await request("/incidents", {
    token: t.passenger,
    method: "POST",
    body: { category: "delay", description: "The driver arrived late", trip_id: trip.id },
    expected: 201
  })).incident;
  assert(filed.status === "open" && filed.admin_note === null, "new incident has the wrong shape");

  const dashboard = await request("/admin/dashboard", { token: t.admin });
  assert(dashboard.counts.open_incidents === 1, "dashboard did not count the open incident");

  const queue = await request("/admin/incidents?status=open", { token: t.admin });
  const row = queue.incidents.find((item) => item.id === filed.id);
  assert(row && row.reporter.role === "passenger" && queue.open_total === 1, "admin queue is missing the incident");
  await request(`/admin/incidents/${filed.id}`, { token: t.passenger, method: "PATCH", body: { status: "resolved", expected_revision: 1 }, expected: 403 });
  const reviewing = (await request(`/admin/incidents/${filed.id}`, {
    token: t.admin,
    method: "PATCH",
    body: { status: "reviewing", expected_revision: 1, note: "Calling the driver" }
  })).incident;
  await request(`/admin/incidents/${filed.id}`, { token: t.admin, method: "PATCH", body: { status: "resolved", expected_revision: 1 }, expected: 409 });
  await request(`/admin/incidents/${filed.id}`, { token: t.admin, method: "PATCH", body: { status: "resolved", expected_revision: reviewing.revision } });
  await request(`/admin/incidents/${filed.id}`, { token: t.admin, method: "PATCH", body: { status: "reviewing", expected_revision: reviewing.revision + 1 }, expected: 409 });

  const mine = await request("/incidents", { token: t.passenger });
  assert(mine.incidents[0].status === "resolved" && mine.incidents[0].admin_note === null, "reporter sees the wrong view");
  const incidentNotes = (await request("/notifications", { token: t.passenger })).notifications.filter((n) => n.type === "incident_updated");
  assert(incidentNotes.length === 2, `reporter incident notifications: ${incidentNotes.length}`);
  assert((await request("/admin/dashboard", { token: t.admin })).counts.open_incidents === 0, "resolved incident still counted open");

  // --- Reports -------------------------------------------------------------
  const summary = await request("/admin/reports/summary", { token: t.admin });
  assert(summary.trips.by_status.in_transit === 1 && summary.passenger_requests.total === 1, "admin summary is wrong");
  assert(summary.merchant_orders.parcels === 5, "admin summary parcel count is wrong");
  await request("/admin/reports/summary?from=2026-12-01T00:00:00Z&to=2026-11-01T00:00:00Z", { token: t.admin, expected: 400 });
  const csv = await request("/admin/reports/export?dataset=orders", { token: t.admin, raw: true });
  assert(csv.response.headers.get("content-type").includes("text/csv"), "export is not CSV");
  assert(csv.text.split("\r\n")[0].includes("id,status,pickup,parcels,created_at"), "export header is wrong");
  assert(csv.text.trim().split("\r\n").length === 2, "export should hold the one seeded order");
  await request("/admin/reports/export?dataset=users", { token: t.admin, expected: 400 });
  await request("/admin/reports/summary", { token: t.merchant, expected: 403 });

  const merchantSummary = await request("/merchant/reports/summary", { token: t.merchant });
  assert(merchantSummary.orders.total === 1 && merchantSummary.orders.parcels === 5, "merchant summary is wrong");
  assert(merchantSummary.trips.by_status.in_transit === 1, "merchant trips are wrong");
  await request("/merchant/reports/summary", { token: t.passenger, expected: 403 });

  await request("/demo/reset", { method: "POST", body: {}, headers: { "x-demo-reset-key": resetKey } });
  return { ok: true, durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)) };
}

run()
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => {
    console.error(`[feature:smoke] FAILED: ${error.message}`);
    process.exit(1);
  });
