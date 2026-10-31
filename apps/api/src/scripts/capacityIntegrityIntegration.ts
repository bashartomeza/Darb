import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import mysql from "mysql2/promise";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { signAuthToken } from "../middleware/auth.js";
import { LOCKED_CORRIDOR_KEY } from "../modules/demoReset.js";
import { expireLegacyDispatches } from "../services/legacyDispatch.js";

const db = new URL(process.env.DATABASE_URL!);
assert(["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname.endsWith("_ci") && process.env.MERCHANT_ORDER_INTEGRATION_CONFIRM_DISPOSABLE === "true", "explicit_owned_disposable_database_required");
const prefix = `task13_${randomUUID()}`;
const actors = { p1: `${prefix}_p1`, p2: `${prefix}_p2`, p3: `${prefix}_p3`, p4: `${prefix}_p4`, merchant: `${prefix}_m`, driver: `${prefix}_d`, stranger: `${prefix}_s` };
type Actor = keyof typeof actors;
const tokens: Record<string, string> = {};
let assertions = 0;
const failures: string[] = [];
const evidence: unknown[] = [];
function check(value: unknown, label: string) { assertions++; if (!value) failures.push(label); }
let dropPath: string | undefined;
function serve() {
  const app = express();
  app.use((req, res, next) => {
    const send = res.json.bind(res);
    res.json = body => {
      if (req.originalUrl === `/api/v1${dropPath}` && res.statusCode < 300) { dropPath = undefined; res.destroy(); return res; }
      return send(body);
    };
    next();
  });
  app.use(createApp());
  return app.listen(0, "127.0.0.1");
}
let server = serve();
await new Promise<void>(resolve => server.once("listening", resolve));
async function call(actor: Actor | null, method: string, url: string, body?: unknown, key?: string) {
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const r = await fetch(origin + url, { method, headers: { "content-type": "application/json", ...(actor ? { authorization: `Bearer ${tokens[actor]}` } : {}), ...(key ? { "idempotency-key": key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() as any };
}
let profileId: string;
const originals = await prisma.driverRoute.findMany({ where: { operational_mode: "legacy" }, select: { id: true, status: true } });
async function route(seats = 1, parcels = 1) {
  await prisma.driverRoute.updateMany({ where: { operational_mode: "legacy" }, data: { status: "inactive" } });
  await prisma.driverProfile.update({ where: { id: profileId }, data: { verified: true } });
  await prisma.user.update({ where: { id: actors.driver }, data: { account_status: "active" } });
  const r = await call("driver", "POST", "/driver/routes", { seats_available: seats, parcel_capacity_available: parcels });
  assert.equal(r.status, 201);
  return r.body.route.id as string;
}
async function passenger(actor: Actor = "p1", seats = 1, key?: string) {
  const r = await call(actor, "POST", "/passenger/requests", { pickup_label: "SYNTHETIC Task13", pickup_lat: 31.5326, pickup_lng: 35.0998, destination_label: "Bethlehem", destination_lat: 31.7054, destination_lng: 35.2024, preferred_time: new Date(Date.now() + 3600000).toISOString(), passenger_count: seats }, key);
  assert.equal(r.status, 201);
  return r.body.request.id as string;
}
async function merchant() {
  const r = await call("merchant", "POST", "/merchant/orders", { pickup_label: "SYNTHETIC Task13", pickup_lat: 31.5326, pickup_lng: 35.0998, parcels: [{ destination_label: "Bethlehem", destination_lat: 31.7054, destination_lng: 35.2024, size: "S", priority: "normal" }] });
  assert.equal(r.status, 201);
  const b = await call("merchant", "POST", `/merchant/orders/${r.body.order.id}/batch`, {});
  assert.equal(b.status, 201);
  return { id: r.body.order.id as string, batchId: b.body.batch.id as string };
}
const match = (id: string, actor: Actor = "p1", routeId?: string) => call(actor, "POST", "/matches/run", { ...(actor === "merchant" ? { merchantOrderId: id } : { passengerRequestId: id }), ...(routeId ? { driverRouteId: routeId } : {}) });
const accept = (id: string) => call("driver", "POST", `/matches/${id}/accept`, {});
const cancel = (id: string, actor: Actor = "p1") => call(actor, "PATCH", `/passenger/requests/${id}/cancel`, {});
async function capacity(id: string, seats: number, parcels: number, label: string) {
  const r = await prisma.driverRoute.findUniqueOrThrow({ where: { id } });
  check(r.seats_available === seats && r.parcel_capacity_available === parcels, label);
  check(r.seats_available >= 0 && r.parcel_capacity_available >= 0, `${label}: nonnegative`);
  evidence.push({ label, expected: { seats, parcels }, actual: { seats: r.seats_available, parcels: r.parcel_capacity_available } });
}
// Scheduling barrier around a genuine MySQL read: no query result/write is mocked.
async function afterRead(modelName: string, method: string, predicate: (args: any) => boolean, start: () => Promise<any>, concurrent: () => Promise<void>) {
  const transaction = prisma.$transaction.bind(prisma);
  let observed!: () => void; let resume!: () => void; let paused = false;
  const reached = new Promise<void>(resolve => { observed = resolve; });
  const release = new Promise<void>(resolve => { resume = resolve; });
  (prisma as any).$transaction = (callback: any, options: any) => transaction(async (tx: any) => callback(new Proxy(tx, { get(target, property) {
    if (property !== modelName) return Reflect.get(target, property);
    return new Proxy(target[modelName], { get(model, query) {
      if (query !== method) return Reflect.get(model, query);
      return async (args: any) => { const value = await model[method](args); if (!paused && predicate(args)) { paused = true; observed(); await release; } return value; };
    } });
  } })), options);
  const pending = start();
  try {
    await Promise.race([reached, pending.then(() => { throw new Error("expected_query_barrier_not_reached"); })]);
    await concurrent(); resume(); return await pending;
  } finally { resume(); await pending.catch(() => undefined); (prisma as any).$transaction = transaction; }
}
try {
  for (const [key, id] of Object.entries(actors)) {
    const role = key === "driver" || key === "stranger" ? "driver" : key === "merchant" ? "merchant" : "passenger";
    await prisma.user.create({ data: { id, role, name: "SYNTHETIC Task13", phone: `+1202${String(parseInt(randomUUID().replaceAll("-", "").slice(0, 8), 16) % 10000000).padStart(7, "0")}`, profile_state: "complete", email_verified_at: new Date() } });
    const session = await prisma.authSession.create({ data: { user_id: id, client_type: "mobile", security_version_at_issue: 1, expires_at: new Date(Date.now() + 3600000) } });
    tokens[key] = signAuthToken({ id, role, sessionId: session.id, securityVersion: 1 });
  }
  profileId = (await prisma.driverProfile.create({ data: { user_id: actors.driver, verified: true, vehicle_type: "van", seats_total: 4, parcel_capacity: 5 } })).id;
  for (const [seats, contenders] of [[1, 2], [2, 4]]) {
    const r = await route(seats, 2);
    const ps = await Promise.all((["p1", "p2", "p3", "p4"] as const).slice(0, contenders).map(async actor => ({ actor, id: await passenger(actor) })));
    const results = await Promise.all(ps.map(p => match(p.id, p.actor, r)));
    check(results.filter(x => x.status === 201).length === seats, `${contenders} contenders reserve exactly ${seats} seats`);
    check(results.every(x => [201, 404, 409].includes(x.status)), "capacity contention returns categorical responses");
    await capacity(r, 0, 2, "last seats reserved once");
    for (const p of ps) await cancel(p.id, p.actor);
    await capacity(r, seats, 2, "cancellation restores each original hold once");
  }
  {
    const r = await route(); const p = await passenger();
    const results = await Promise.all(Array.from({ length: 4 }, () => match(p)));
    check(results.filter(x => x.status === 201).length === 1, "duplicate matching makes one hold");
    const offer = results.find(x => x.status === 201)!.body.match.id;
    check((await call("stranger", "POST", `/matches/${offer}/accept`, {})).status === 403, "unrelated driver cannot accept");
    const accepted = await Promise.all([accept(offer), accept(offer)]);
    check(accepted.filter(x => x.status === 201).length === 1, "duplicate acceptance creates one trip");
    await capacity(r, 0, 1, "acceptance does not reserve twice");
    const cancelled = await Promise.all([cancel(p), cancel(p)]);
    check(cancelled.filter(x => x.status === 200).length === 1, "accepted cancellation commits once");
    await capacity(r, 1, 1, "accepted cancellation restores once");
  }
  {
    const r = await route(); const p = await passenger();
    let competing: ReturnType<typeof match> | undefined;
    const result = await afterRead("passengerRequest", "findFirst", args => args.where?.id === p, () => cancel(p), async () => { competing = match(p, "p1", r); await new Promise(resolve => setTimeout(resolve, 150)); });
    const matchResult = await competing!;
    check([201, 409].includes(matchResult.status), "concurrent matching observes the serialized request state");
    check(result.status === 200 || result.status === 409, "cancel/match race resolves categorically");
    const request = await prisma.passengerRequest.findUniqueOrThrow({ where: { id: p } });
    const held = await prisma.match.count({ where: { passenger_request_id: p, legacy_capacity_held: true } });
    check(request.status !== "cancelled" || held === 0, "cancellation cannot miss a concurrent newly-created hold");
    if (request.status === "cancelled") await capacity(r, 1, 1, "cancel/match race retains no leaked capacity");
  }
  {
    const r = await route(); const p = await passenger(); const o = await merchant();
    const both = await Promise.all([match(p), match(o.id, "merchant")]);
    check(both.every(x => x.status === 201), "separate passenger/parcel dimensions reserve together");
    await capacity(r, 0, 0, "independent dimensions fully held");
    const winner = await accept(both[0].body.match.id); check(winner.status === 201, "existing one-trip-per-route acceptance");
    await capacity(r, 0, 1, "competing parcel hold released once");
    check((await call("merchant", "PATCH", `/merchant/orders/${o.id}/cancel`, {})).status === 200, "invalidated parcel order can cancel");
    await capacity(r, 0, 1, "parcel cancellation does not release twice");
    await cancel(p); await capacity(r, 1, 1, "passenger cancellation leaves both original totals");
  }
  {
    const r = await route(2, 1); const p1 = await passenger(); const p2 = await passenger("p2");
    const offers = await Promise.all([match(p1), match(p2, "p2")]);
    assert(offers.every(x => x.status === 201));
    const accepted = await Promise.all(offers.map(x => accept(x.body.match.id)));
    evidence.push({ phase: "distinct_offer_acceptance_race", statuses: accepted.map(x => x.status) });
    check(accepted.filter(x => x.status === 201).length === 1, "distinct competing offers create one route trip");
    check(accepted.every(x => x.status === 201 || x.status === 409), "competing acceptance returns categorical conflict");
    check(await prisma.trip.count({ where: { driver_route_id: r } }) === 1, "one persisted trip under acceptance contention");
    await capacity(r, 1, 1, "losing offer released exactly once");
    const winningTrip = await prisma.trip.findFirstOrThrow({ where: { driver_route_id: r } });
    await cancel(winningTrip.passenger_request_id!, winningTrip.passenger_request_id === p1 ? "p1" : "p2");
    await capacity(r, 2, 1, "acceptance race then cancellation restores original total");
  }
  {
    const r = await route(2, 1); const p1 = await passenger(); const p2 = await passenger("p2");
    const first = await match(p1); assert.equal(first.status, 201);
    let lateOfferId = "";
    const accepted = await afterRead("match", "findUnique", args => args.where?.id === first.body.match.id,
      () => accept(first.body.match.id), async () => { const late = await match(p2, "p2"); assert.equal(late.status, 201); lateOfferId = late.body.match.id; });
    check(accepted.status === 201, "acceptance survives an offer arriving after its initial read");
    const lateOffer = await prisma.match.findUniqueOrThrow({ where: { id: lateOfferId } });
    check(lateOffer.status === "invalidated" && !lateOffer.legacy_capacity_held, "acceptance sees and releases a newly committed competing hold");
    check((await prisma.passengerRequest.findUniqueOrThrow({ where: { id: p2 } })).status === "pending", "late competing passenger returns to matching eligibility");
    await capacity(r, 1, 1, "late competing proposal retains no seat on assigned route");
    await cancel(p1); await capacity(r, 2, 1, "late-offer acceptance then cancellation restores original total");
  }
  {
    const r = await route(); const p = await passenger(); const id = (await match(p)).body.match.id;
    const rejected = await Promise.all([call("driver", "POST", `/matches/${id}/reject`, {}), call("driver", "POST", `/matches/${id}/reject`, {})]);
    check(rejected.filter(x => x.status === 200).length === 1, "concurrent rejection releases one hold");
    await capacity(r, 1, 1, "rejection restores once");
    check([404, 409].includes((await match(p, "p1", r)).status), "rejected selected route is not silently reused");
    const otherRoute = await route();
    const rematched = await match(p, "p1", otherRoute);
    check(rematched.status === 201, "rejected request can match a different eligible route");
    await cancel(p); await capacity(otherRoute, 1, 1, "rematched hold cancels once");
  }
  {
    const r = await route(); const p = await passenger(); const made = await match(p); const id = made.body.match.id;
    await prisma.match.update({ where: { id }, data: { expires_at: new Date(Date.now() - 100) } });
    check((await accept(id)).status === 409, "expired passenger offer cannot consume a trip");
    await expireLegacyDispatches(prisma); await expireLegacyDispatches(prisma);
    await capacity(r, 1, 1, "expiry releases only once");
    check(await prisma.trip.count({ where: { passenger_request_id: p } }) === 0, "expired acceptance creates no trip");
  }
  {
    const r = await route(); const p = await passenger(); const id = (await match(p)).body.match.id;
    await prisma.driverProfile.update({ where: { id: profileId }, data: { verified: false } });
    check((await accept(id)).status === 409, "approval revoked before acceptance rejects held offer");
    check(await prisma.trip.count({ where: { passenger_request_id: p } }) === 0, "unapproved driver creates no trip");
    await cancel(p); await capacity(r, 1, 1, "invalid driver cancellation restores original hold");
  }
  {
    const r = await route(); const p = await passenger();
    await prisma.driverRoute.update({ where: { id: r }, data: { departure_at: new Date(Date.now() + 1200) } });
    const blocker = await mysql.createConnection(db.toString());
    try {
      await blocker.beginTransaction(); await blocker.query("SELECT id FROM driver_routes WHERE id = ? FOR UPDATE", [r]);
      const started = Date.now(); const pending = match(p, "p1", r);
      await new Promise(resolve => setTimeout(resolve, 250));
      const [[waits]] = await blocker.query<import("mysql2").RowDataPacket[]>("SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits");
      check(Number((waits as { count: number }).count) > 0, "MySQL observes actual reservation row-lock contention");
      await new Promise(resolve => setTimeout(resolve, 1350)); await blocker.commit();
      const result = await pending;
      check(result.status === 409, "passenger route departing during lock wait rejects reservation");
      check(await prisma.match.count({ where: { passenger_request_id: p } }) === 0, "post-lock expiry creates no offer");
      await capacity(r, 1, 1, "post-lock expiry rolls back capacity");
      evidence.push({ phase: "passenger_route_lock_wait", elapsed_ms: Date.now() - started, status: result.status });
    } finally { await blocker.rollback(); await blocker.end(); }
  }
  {
    const r = await route(); const p = await passenger(); dropPath = "/matches/run";
    await assert.rejects(match(p)); check(!dropPath, "successful matching response actually lost");
    check([404, 409].includes((await match(p)).status), "response-loss retry cannot reserve unavailable capacity");
    check(await prisma.match.count({ where: { passenger_request_id: p } }) === 1, "lost-response retry makes no new offer");
    await capacity(r, 0, 1, "lost-response retry holds once");
    const id = (await prisma.match.findFirstOrThrow({ where: { passenger_request_id: p, legacy_capacity_held: true } })).id;
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect();
    server = serve(); await new Promise<void>(resolve => server.once("listening", resolve));
    check((await call("driver", "GET", `/matches/${id}`)).status === 200, "server restart recovers durable offer");
    dropPath = `/matches/${id}/accept`; await assert.rejects(accept(id));
    check(!dropPath && (await accept(id)).status === 409, "lost successful acceptance does not duplicate assignment");
    check(await prisma.trip.count({ where: { passenger_request_id: p } }) === 1, "one trip after restart and retry");
    await cancel(p); await capacity(r, 1, 1, "response-loss cancellation restores once");
  }
  {
    const r = await route();
    check((await call("driver", "POST", "/driver/routes", { seats_available: -1 })).status === 400, "negative route capacity rejected");
    check((await call("p1", "POST", "/passenger/requests", { passenger_count: -1 })).status === 400, "malformed passenger capacity rejected");
    check((await call(null, "POST", "/matches/run", {})).status === 401, "unauthenticated capacity mutation rejected");
    await capacity(r, 1, 1, "malformed and unauthorized requests make no changes");
  }
  console.log(JSON.stringify({ suite: "capacity_integrity_real_mysql", assertions, failures, evidence }));
  assert.equal(failures.length, 0, "all capacity invariants must pass");
} finally {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  const ids = Object.values(actors);
  const ps = (await prisma.passengerRequest.findMany({ where: { passenger_id: { in: ids } }, select: { id: true } })).map(x => x.id);
  const os = (await prisma.merchantOrder.findMany({ where: { merchant_id: { in: ids } }, select: { id: true } })).map(x => x.id);
  const batches = (await prisma.parcelBatch.findMany({ where: { merchant_order_id: { in: os } }, select: { id: true } })).map(x => x.id);
  await prisma.trip.deleteMany({ where: { OR: [{ passenger_request_id: { in: ps } }, { merchant_order_id: { in: os } }] } });
  await prisma.match.deleteMany({ where: { OR: [{ passenger_request_id: { in: ps } }, { merchant_order_id: { in: os } }] } });
  await prisma.parcelBatchOrder.deleteMany({ where: { parcel_batch_id: { in: batches } } });
  await prisma.parcelBatch.deleteMany({ where: { id: { in: batches } } });
  await prisma.parcel.deleteMany({ where: { order_id: { in: os } } }); await prisma.merchantOrder.deleteMany({ where: { id: { in: os } } });
  await prisma.passengerRequest.deleteMany({ where: { id: { in: ps } } });
  await prisma.driverRoute.deleteMany({ where: { driver: { user_id: { in: ids } } } }); await prisma.driverProfile.deleteMany({ where: { user_id: { in: ids } } });
  await prisma.auditEvent.deleteMany({ where: { user_id: { in: ids } } }); await prisma.authSession.deleteMany({ where: { user_id: { in: ids } } }); await prisma.user.deleteMany({ where: { id: { in: ids } } });
  for (const original of originals) await prisma.driverRoute.update({ where: { id: original.id }, data: { status: original.status } });
  await prisma.$disconnect();
}
