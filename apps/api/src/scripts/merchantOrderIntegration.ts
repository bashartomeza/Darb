import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import express from "express";
import mysql from "mysql2/promise";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { signAuthToken } from "../middleware/auth.js";

const database = new URL(process.env.DATABASE_URL!);
if (!["127.0.0.1", "localhost"].includes(database.hostname) ||
    !database.pathname.endsWith("_ci") || process.env.MERCHANT_ORDER_INTEGRATION_CONFIRM_DISPOSABLE !== "true") {
  throw new Error("merchant_order_integration_requires_explicit_disposable_local_database");
}
const ddl = await mysql.createConnection(database.toString());
const operation = "legacy_merchant_order_create_v1";
const prefix = `task9_${randomUUID()}`;
const merchant = `${prefix}_merchant`;
const other = `${prefix}_other`;
const passenger = `${prefix}_passenger`;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const payload = { pickup_label: "SYNTHETIC pickup", pickup_lat: 31.5326, pickup_lng: 35.0998,
  parcels: ["S", "M"].map(size => ({ destination_label: "SYNTHETIC destination", destination_lat: 31.7054, destination_lng: 35.2024, size, priority: "normal" })) };
let assertions = 0;
function check(value: unknown, message: string): asserts value { assert(value, message); assertions++; }
const tokens: Record<string, string> = {};
// This test-only transport drops one response after the actual production handler commits.
let dropResponse = false;
let dropped!: () => void;
const wrapper = express();
wrapper.use((req, res, next) => {
  const send = res.json.bind(res);
  res.json = (body) => {
    if (dropResponse && req.method === "POST" && req.originalUrl === "/api/v1/merchant/orders" && res.statusCode === 201) {
      dropResponse = false; dropped(); res.destroy(); return res;
    }
    return send(body);
  };
  next();
});
wrapper.use(createApp());
const server = wrapper.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
async function call(method: string, path: string, actor = merchant, key?: string, body?: unknown) {
  const response = await fetch(origin + path, { method,
    headers: { "content-type": "application/json", ...(tokens[actor] ? { authorization: `Bearer ${tokens[actor]}` } : {}), ...(key ? { "idempotency-key": key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as any };
}
async function counts() {
  const orders = await prisma.merchantOrder.findMany({ where: { merchant_id: merchant }, select: { id: true } });
  return { orders: orders.length,
    parcels: await prisma.parcel.count({ where: { order_id: { in: orders.map(o => o.id) } } }),
    audits: await prisma.auditEvent.count({ where: { user_id: merchant, action: "merchant_order_created" } }),
    claims: await prisma.idempotencyRecord.count({ where: { operation, scope_digest: digest(`${operation}:${merchant}`) } }) };
}
try {
  for (const [id, role] of [[merchant, "merchant"], [other, "merchant"], [passenger, "passenger"]] as const) {
    await prisma.user.create({ data: { id, name: "SYNTHETIC Task9", phone: `+12025550${id === merchant ? "101" : id === other ? "102" : "103"}`, profile_state: "complete", email: `${id}@example.invalid`, role, email_verified_at: new Date() } });
    const session = await prisma.authSession.create({ data: { user_id: id, client_type: "mobile", security_version_at_issue: 1, expires_at: new Date(Date.now() + 3600000) } });
    tokens[id] = signAuthToken({ id, role, sessionId: session.id, securityVersion: 1 });
  }
  check((await call("POST", "/merchant/orders", "anonymous", "test-key-anonymous", payload)).status === 401, "unauthenticated denied");
  check((await call("POST", "/merchant/orders", passenger, "test-key-passenger", payload)).status === 403, "nonmerchant denied");
  check((await call("GET", "/merchant/order-operation", "anonymous", "task9-anonymous-lookup")).status === 401, "lookup requires authentication");
  check((await call("GET", "/merchant/order-operation", passenger, "task9-passenger-lookup")).status === 403, "lookup requires merchant role");
  check((await call("GET", "/merchant/order-operation", merchant)).status === 400, "lookup requires valid operation key");
  check((await call("POST", "/merchant/orders", merchant, "bad", payload)).status === 400, "malformed key rejected before writes");
  for (const invalid of [{ ...payload, parcels: [] }, { ...payload, parcels: Array(51).fill(payload.parcels[0]) }, { ...payload, pickup_lat: 91 }]) {
    check((await call("POST", "/merchant/orders", merchant, "task9-invalid-payload", invalid)).status === 400, "invalid payload creates no operation");
  }
  check((await counts()).orders === 0 && (await counts()).claims === 0, "rejected inputs leave no orders or claims");
  const first = await call("POST", "/merchant/orders", merchant, "task9-normal-key", payload);
  check(first.status === 201 && first.body.order.parcels.length === 2, "normal creation has two parcels");
  const replay = await call("POST", "/merchant/orders", merchant, "task9-normal-key", payload);
  check(replay.status === 200 && replay.body.order.id === first.body.order.id, "same payload replay returns original");
  check((await call("POST", "/merchant/orders", merchant, "task9-normal-key", { ...payload, pickup_label: "changed" })).status === 409, "different payload conflicts");
  // Reproduce initial implementation's expired-completed-claim duplicate.
  await prisma.idempotencyRecord.updateMany({ where: { resource_id: first.body.order.id }, data: { expires_at: new Date(0) } });
  const expired = await call("POST", "/merchant/orders", merchant, "task9-normal-key", payload);
  check(expired.status === 200 && expired.body.order.id === first.body.order.id, "expired completed operation must replay original, never create another order");
  check((await call("POST", "/merchant/orders", merchant, "task9-normal-key", { ...payload, pickup_label: "changed after expiry" })).status === 409, "expired key payload remains protected");
  const lookup = await call("GET", "/merchant/order-operation", merchant, "task9-normal-key");
  check(lookup.status === 200 && lookup.body.order.id === first.body.order.id, "read-only recovery resolves expired completed operation");
  check((await call("GET", "/merchant/order-operation", other, "task9-normal-key")).status === 404, "lookup isolated to merchant");
  const actorB = await call("POST", "/merchant/orders", other, "task9-normal-key", payload);
  check(actorB.status === 201 && actorB.body.order.id !== first.body.order.id, "same key different merchant creates only their own order");
  const race = await Promise.all(Array.from({ length: 10 }, () => call("POST", "/merchant/orders", merchant, "task9-concurrent-key", payload)));
  for (const result of race) check([200,201].includes(result.status) || (result.status === 409 && result.body.error === "transaction_retry_required"), "concurrent request is saved/replayed or safely retryable");
  const winner = race.find(result => result.status === 201);
  check(winner, "one race winner exists");
  check(race.filter(result => result.status === 201).length === 1, "exactly one race creation");
  for (const result of race) {
    const settled = result.status === 409 ? await call("POST", "/merchant/orders", merchant, "task9-concurrent-key", payload) : result;
    check(settled.body.order.id === winner.body.order.id, "all concurrent requests reconcile to same saved order");
  }
  const responseLost = new Promise<void>(resolve => { dropped = resolve; });
  dropResponse = true;
  await assert.rejects(call("POST", "/merchant/orders", merchant, "task9-lost-response", payload));
  await responseLost;
  const recovered = await call("GET", "/merchant/order-operation", merchant, "task9-lost-response");
  check(recovered.status === 200, "lost response recovered without another mutation");
  const lostReplay = await call("POST", "/merchant/orders", merchant, "task9-lost-response", payload);
  check(lostReplay.status === 200 && lostReplay.body.order.id === recovered.body.order.id, "lost response retry preserves order identity");
  const cancelled = await call("PATCH", `/merchant/orders/${recovered.body.order.id}/cancel`, merchant);
  check(cancelled.status === 200 && cancelled.body.order.status === "cancelled", "recovered order uses existing cancellation path");
  const cancelledReplay = await call("POST", "/merchant/orders", merchant, "task9-lost-response", payload);
  check(cancelledReplay.status === 200 && cancelledReplay.body.order.id === recovered.body.order.id && cancelledReplay.body.order.status === "cancelled", "cancelled original is replayed, not recreated");
  const beforeFailure = await counts();
  for (const [name, table, event, condition] of [
    ["task9_parcel_failure", "parcels", "INSERT", `NEW.size = 'M' AND EXISTS (SELECT 1 FROM merchant_orders WHERE id = NEW.order_id AND merchant_id = '${merchant}')`],
    ["task9_audit_failure", "audit_events", "INSERT", `NEW.user_id = '${merchant}'`],
    ["task9_completion_failure", "idempotency_records", "UPDATE", `NEW.scope_digest = '${digest(`${operation}:${merchant}`)}' AND NEW.state = 'completed'`]
  ]) {
    await ddl.query(`CREATE TRIGGER ${name} BEFORE ${event} ON ${table} FOR EACH ROW BEGIN IF ${condition} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='task9_intentional_failure'; END IF; END`);
    try {
      check((await call("POST", "/merchant/orders", merchant, name, payload)).status === 500, "injected transactional failure rejected");
      assert.deepEqual(await counts(), beforeFailure); assertions++;
      check((await call("GET", "/merchant/order-operation", merchant, name)).status === 404, "failed transaction retains no claim");
    } finally { await ddl.query(`DROP TRIGGER ${name}`); }
  }
  const legacy = await call("POST", "/merchant/orders", merchant, undefined, payload);
  check(legacy.status === 201 && !("replayed" in legacy.body), "legacy no-key response compatible");
  const final = await counts();
  check(final.orders === 4 && final.parcels === 8 && final.audits === 4 && final.claims === 3, "exact final order/parcel/audit/claim counts");
  await prisma.authSession.updateMany({ where: { user_id: merchant }, data: { revoked_at: new Date() } });
  check((await call("POST", "/merchant/orders", merchant, "task9-revoked-session", payload)).status === 401, "revoked session cannot create");
  check((await call("GET", "/merchant/order-operation", merchant, "task9-normal-key")).status === 401, "revoked session cannot recover");
  console.log(JSON.stringify({ test: "merchant_order_real_mysql", result: "PASS", assertions, counts: final, concurrent_requests: 10, response_loss: "real_socket_destroy_after_commit" }));
} finally {
  await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
  const ids = [merchant, other, passenger];
  const orders = await prisma.merchantOrder.findMany({ where: { merchant_id: { in: ids } }, select: { id: true } });
  await prisma.parcel.deleteMany({ where: { order_id: { in: orders.map(o => o.id) } } });
  await prisma.merchantOrder.deleteMany({ where: { merchant_id: { in: ids } } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ user_id: { in: ids } }, { entity_type: "IdempotencyRecord", entity_id: { in: (await prisma.idempotencyRecord.findMany({ where: { operation, scope_digest: { in: ids.map(id => digest(`${operation}:${id}`)) } }, select: { id: true } })).map(r => r.id) } }] } });
  await prisma.idempotencyRecord.deleteMany({ where: { operation, scope_digest: { in: ids.map(id => digest(`${operation}:${id}`)) } } });
  await prisma.authSession.deleteMany({ where: { user_id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await ddl.end();
  await prisma.$disconnect();
}
