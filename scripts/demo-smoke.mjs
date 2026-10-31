import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(import.meta.dirname, "../apps/api/.env"), quiet: true });

const apiOrigin =
  argument("--api-base-url") ??
  process.argv.slice(2).find((value) => /^https?:\/\//.test(value)) ??
  process.env.DEMO_API_BASE_URL ??
  "http://localhost:3000";
const apiBaseUrl = `${apiOrigin.replace(/\/$/, "")}/api/v1`;
const resetKey = process.env.DEMO_RESET_KEY;
const startedAt = Date.now();

function assertResetSafeDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  const allowed = (process.env.DEMO_RESET_ALLOWED_DATABASES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  let name = "";
  try { name = new URL(databaseUrl).pathname.replace(/^\//, ""); } catch {}
  if (name.toLowerCase() === "masari" || !/^[A-Za-z0-9_]+$/.test(name) || !allowed.includes(name)) {
    throw new Error("Demo smoke refuses a database that is not explicitly reset-safe");
  }
}

const accounts = {
  passenger: ["demo.passenger@masari.app", process.env.DEMO_PASSENGER_PASSWORD],
  driver1: ["demo.driver@masari.app", process.env.DEMO_DRIVER_PASSWORD],
  driver2: ["demo.driver2@masari.app", process.env.DEMO_DRIVER_PASSWORD],
  merchant: ["demo.merchant@masari.app", process.env.DEMO_MERCHANT_PASSWORD],
  admin: ["demo.admin@masari.app", process.env.DEMO_ADMIN_PASSWORD]
};

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { token, method = "GET", body, headers = {}, expected = 200 } = {}) {
  const requestHeaders = { "content-type": "application/json", ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (response.status !== expected) {
    throw new Error(`${method} ${path}: expected ${expected}, received ${response.status} (${data?.error ?? "no error code"})`);
  }
  return data;
}

async function login(role) {
  const [email, password] = accounts[role];
  return (
    await request("/auth/login", {
      method: "POST",
      body: { email, password }
    })
  ).token;
}

async function reset() {
  return request("/demo/reset", {
    method: "POST",
    body: {},
    headers: { "x-demo-reset-key": resetKey }
  });
}

async function primaryStory() {
  assertResetSafeDatabase();
  const health = await request("/health");
  assert(health.ok === true, "API health response is not ready");
  assert(typeof health.request_id === "string", "API health response has no request ID");

  await request("/demo/reset", { method: "POST", body: {}, expected: 403 });
  await request("/auth/login", {
    method: "POST",
    body: { email: accounts.passenger[0], password: "invalid-demo-password" },
    expected: 401
  });

  const resetResult = await reset();
  assert(resetResult.seed.parcels === 5 && resetResult.seed.scenarios === 3, "reset seed is not deterministic");

  const tokens = Object.fromEntries(
    await Promise.all(Object.keys(accounts).map(async (role) => [role, await login(role)]))
  );

  const [dashboard, requestList, orderList] = await Promise.all([
    request("/admin/dashboard", { token: tokens.admin }),
    request("/admin/requests", { token: tokens.admin }),
    request("/admin/orders", { token: tokens.admin })
  ]);
  assert(
    JSON.stringify(dashboard.counts) ===
      JSON.stringify({ users: 5, drivers: 2, routes: 2, passenger_requests: 1, merchant_orders: 1, parcels: 5, active_drivers: 1, pending_driver_approvals: 0, open_incidents: 0 }),
    `unexpected reset counts: ${JSON.stringify(dashboard.counts)}`
  );

  const passengerRequest = requestList.requests[0];
  const merchantOrder = orderList.orders[0];
  assert(passengerRequest && merchantOrder, "seeded passenger request or merchant order is missing");

  const batch = (
    await request(`/merchant/orders/${merchantOrder.id}/batch`, {
      token: tokens.merchant,
      method: "POST",
      body: {},
      expected: 201
    })
  ).batch;
  await request(`/merchant/orders/${merchantOrder.id}/batch`, {
    token: tokens.merchant,
    method: "POST",
    body: {},
    expected: 409
  });

  const matchRun = await request("/matches/run", {
    token: tokens.admin,
    method: "POST",
    body: { passengerRequestId: passengerRequest.id, merchantOrderId: merchantOrder.id },
    expected: 201
  });
  const match = matchRun.match;
  assert(match.passenger_request_id === passengerRequest.id, "combined match lost passenger request");
  assert(match.merchant_order_id === merchantOrder.id, "combined match lost merchant order");
  assert(match.parcel_batch_id === batch.id, "combined match lost persisted parcel batch");
  assert(matchRun.scoringBreakdown.finalScore > 0, "match scoring breakdown is missing");

  const [driverInbox, alternateInbox, passengerInbox, merchantInbox, adminInbox] = await Promise.all([
    request("/matches", { token: tokens.driver1 }),
    request("/matches", { token: tokens.driver2 }),
    request("/matches", { token: tokens.passenger }),
    request("/matches", { token: tokens.merchant }),
    request("/matches", { token: tokens.admin })
  ]);
  assert(driverInbox.matches.some((item) => item.id === match.id), "selected driver cannot see combined match");
  assert(alternateInbox.matches.length === 0, "alternate driver can see another route's match");
  assert(passengerInbox.matches.length === 1 && passengerInbox.matches[0].id === match.id, "passenger match scope is wrong");
  assert(merchantInbox.matches.length === 1 && merchantInbox.matches[0].id === match.id, "merchant match scope is wrong");
  assert(adminInbox.matches.length === 1 && adminInbox.matches[0].id === match.id, "admin match scope is wrong");
  await request(`/matches/${match.id}`, { token: tokens.driver2, expected: 403 });

  const trip = (
    await request(`/matches/${match.id}/accept`, {
      token: tokens.driver1,
      method: "POST",
      body: {},
      expected: 201
    })
  ).trip;
  await request(`/matches/${match.id}/accept`, {
    token: tokens.driver1,
    method: "POST",
    body: {},
    expected: 409
  });
  await request(`/trips/${trip.id}/status`, {
    token: tokens.driver1,
    method: "POST",
    body: { status: "delivered" },
    expected: 409
  });
  await request(`/trips/${trip.id}/status`, {
    token: tokens.passenger,
    method: "POST",
    body: { status: "pickup_started" },
    expected: 403
  });
  await request(`/trips/${trip.id}/simulate/step`, {
    token: tokens.merchant,
    method: "POST",
    body: {},
    expected: 403
  });

  for (const status of ["pickup_started", "picked_up", "in_transit"]) {
    await request(`/trips/${trip.id}/status`, {
      token: tokens.driver1,
      method: "POST",
      body: { status }
    });
  }
  const locations = [];
  for (let index = 0; index < 3; index += 1) {
    locations.push(
      (
        await request(`/trips/${trip.id}/simulate/step`, {
          token: tokens.driver1,
          method: "POST",
          body: {},
          expected: 201
        })
      ).location
    );
  }
  assert(locations.map((item) => item.sequence).join(",") === "0,1,2", "tracking sequence is not deterministic");

  const [passengerTrip, merchantTrip, passengerLocation, merchantLocation, orderInTransit] = await Promise.all([
    request(`/trips/${trip.id}`, { token: tokens.passenger }),
    request(`/trips/${trip.id}`, { token: tokens.merchant }),
    request(`/trips/${trip.id}/location`, { token: tokens.passenger }),
    request(`/trips/${trip.id}/location`, { token: tokens.merchant }),
    request(`/merchant/orders/${merchantOrder.id}`, { token: tokens.merchant })
  ]);
  assert(passengerTrip.trip.status === "in_transit" && merchantTrip.trip.status === "in_transit", "observers disagree on trip status");
  assert(passengerLocation.location.sequence === 2 && merchantLocation.location.sequence === 2, "observers disagree on location");
  assert(orderInTransit.order.status === "in_transit", "merchant order did not enter transit");
  assert(orderInTransit.order.parcels.every((parcel) => parcel.status === "in_transit"), "merchant parcels did not enter transit");
  assert(orderInTransit.order.parcel_batches[0].status === "in_transit", "parcel batch did not enter transit");

  // The receiver must confirm: the sender issues the handover code, the driver enters it.
  const handover = (
    await request(`/parcel-orders/${merchantOrder.id}/handover/regenerate`, { token: tokens.merchant, method: "POST", body: {} })
  ).handover;
  assert(/^[0-9]{6}$/.test(handover.code), "sender did not receive a six-digit handover code");
  await request(`/trips/${trip.id}/delivery-confirmation`, {
    token: tokens.driver1,
    method: "POST",
    body: { method: "receiver_code", code: handover.code === "000000" ? "000001" : "000000" },
    expected: 422
  });
  const delivery = await request(`/trips/${trip.id}/delivery-confirmation`, {
    token: tokens.driver1,
    method: "POST",
    body: { method: "receiver_code", code: handover.code }
  });
  assert(delivery.delivered === true, "receiver code did not deliver the trip");
  await request(`/trips/${trip.id}/status`, {
    token: tokens.driver1,
    method: "POST",
    body: { status: "completed" }
  });

  const comparison = (
    await request("/compare/run", {
      token: tokens.admin,
      method: "POST",
      body: {
        scenarioKey: "masari_batch_wins",
        passengerRequestId: passengerRequest.id,
        merchantOrderId: merchantOrder.id
      },
      expected: 201
    })
  ).comparison;
  assert(comparison.winner === "masari", "comparison winner changed");
  assert(comparison.masari_trips === 1 && comparison.nearest_driver_trips === 6, "comparison trip counts changed");

  const finalOrder = (await request(`/merchant/orders/${merchantOrder.id}`, { token: tokens.merchant })).order;
  const finalTrip = (await request(`/trips/${trip.id}`, { token: tokens.admin })).trip;
  assert(finalTrip.status === "completed", "trip did not complete");
  assert(finalOrder.status === "completed", "merchant order did not complete");
  assert(finalOrder.parcels.every((parcel) => parcel.status === "delivered"), "merchant parcels did not deliver");
  assert(finalOrder.parcel_batches[0].status === "delivered", "parcel batch did not deliver");

  const cors = await fetch(`${apiBaseUrl}/auth/login`, {
    method: "OPTIONS",
    headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" }
  });
  assert(cors.headers.get("access-control-allow-origin") === "http://localhost:5173", "admin origin failed CORS preflight");

  return {
    matchId: match.id,
    batchId: batch.id,
    tripId: trip.id,
    finalScore: matchRun.scoringBreakdown.finalScore,
    latestSequence: locations.at(-1).sequence,
    comparison: {
      winner: comparison.winner,
      masariTrips: comparison.masari_trips,
      nearestDriverTrips: comparison.nearest_driver_trips,
      masariDistance: comparison.masari_estimated_distance,
      nearestDriverDistance: comparison.nearest_estimated_distance,
      masariCost: comparison.masari_estimated_cost,
      nearestDriverCost: comparison.nearest_estimated_cost
    }
  };
}

async function noRouteRecovery() {
  await reset();
  const [admin, driver] = await Promise.all([login("admin"), login("driver1")]);
  const routes = (await request("/driver/routes", { token: driver })).routes;
  const activeRoute = routes.find((route) => route.status === "active");
  assert(activeRoute, "reset did not restore an active route");
  await request(`/driver/routes/${activeRoute.id}/deactivate`, { token: driver, method: "PATCH", body: {} });
  const [requests, orders] = await Promise.all([
    request("/admin/requests", { token: admin }),
    request("/admin/orders", { token: admin })
  ]);
  await request("/matches/run", {
    token: admin,
    method: "POST",
    body: { passengerRequestId: requests.requests[0].id, merchantOrderId: orders.orders[0].id },
    expected: 404
  });
  await reset();
}

try {
  if (process.env.APP_ENV !== "demo") throw new Error("APP_ENV=demo is required");
  if (!resetKey || Object.values(accounts).some(([, password]) => !password)) {
    throw new Error("demo reset key and role passwords are required");
  }
  const result = await primaryStory();
  await noRouteRecovery();
  console.log(
    JSON.stringify({
      ok: true,
      apiOrigin,
      durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      ...result,
      recovery: "no-route empty state returned 404; reset restored clean seed"
    })
  );
} catch (error) {
  console.error(`[demo:smoke] FAILED: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}
