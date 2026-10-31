import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import mysql from "mysql2/promise";
import { expireLegacyDispatches } from "../services/legacyDispatch.js";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { signAuthToken } from "../middleware/auth.js";
import { LOCKED_CORRIDOR_KEY } from "../modules/demoReset.js";

// Never accept a remote or unconfirmed database for destructive synthetic fixtures.
const db = new URL(process.env.DATABASE_URL!);
assert(["127.0.0.1", "localhost"].includes(db.hostname) && db.pathname.endsWith("_ci") &&
  process.env.MERCHANT_ORDER_INTEGRATION_CONFIRM_DISPOSABLE === "true", "explicit_disposable_database_required");
const prefix = `task10_${randomUUID()}`;
const actors = { merchant: `${prefix}_m`, other: `${prefix}_o`, driver: `${prefix}_d`, stranger: `${prefix}_s` };
const tokens: Record<string, string> = {};
let dropMatchResponse = false;
const wrapper = express();
wrapper.use((req, res, next) => {
  const send = res.json.bind(res);
  res.json = body => {
    if (dropMatchResponse && req.method === "POST" && req.originalUrl === "/api/v1/matches/run" && res.statusCode === 201) {
      dropMatchResponse = false; res.destroy(); return res;
    }
    return send(body);
  };
  next();
});
wrapper.use(createApp());
const server = wrapper.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
const failures: string[] = []; let assertions = 0;
function check(condition: unknown, message: string) { assertions++; if (!condition) failures.push(message); }
async function call(actor: keyof typeof actors, method: string, path: string, body?: unknown) {
  const response = await fetch(origin + path, { method, headers: { authorization: `Bearer ${tokens[actor]}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as any };
}
const payload = { pickup_label: "SYNTHETIC Task10", pickup_lat: 31.5326, pickup_lng: 35.0998,
  parcels: [{ destination_label: "Bethlehem", destination_lat: 31.7054, destination_lng: 35.2024, size: "S", priority: "normal" }] };
let routeId: string;
const originalRoutes = await prisma.driverRoute.findMany({ where: { operational_mode: "legacy" }, select: { id: true, status: true } });
async function available() {
  await prisma.driverRoute.updateMany({ where: { operational_mode: "legacy" }, data: { status: "inactive" } });
  await prisma.user.update({ where: { id: actors.driver }, data: { account_status: "active" } });
  await prisma.driverProfile.update({ where: { user_id: actors.driver }, data: { verified: true } });
  await prisma.driverRoute.update({ where: { id: routeId }, data: { status: "active", parcel_capacity_available: 20,
    departure_at: new Date(Date.now() + 3_600_000), availability_window_end: new Date(Date.now() + 5_400_000) } });
}
async function demand(two = false) {
  const first = await call("merchant", "POST", "/merchant/orders", payload); assert.equal(first.status, 201);
  let second: any;
  if (two) { second = await call("merchant", "POST", "/merchant/orders", { ...payload, parcels: [payload.parcels[0], payload.parcels[0]] }); assert.equal(second.status, 201); }
  const batch = await call("merchant", "POST", `/merchant/orders/${first.body.order.id}/batch`, {}); assert.equal(batch.status, 201);
  return { id: first.body.order.id, secondId: second?.body.order.id, batchId: batch.body.batch.id };
}
async function match(id: string) { return call("merchant", "POST", "/matches/run", { merchantOrderId: id }); }
async function cancel(id: string) { await call("merchant", "PATCH", `/merchant/orders/${id}/cancel`, {}); }
async function interleaveOrderRead(
  orderId: string,
  method: "findFirst" | "findUnique",
  start: () => ReturnType<typeof call>,
  concurrent: () => Promise<void>,
) {
  let observed!: () => void; let resume!: () => void;
  const observedRead = new Promise<void>(resolve => { observed = resolve; });
  const resumeRead = new Promise<void>(resolve => { resume = resolve; });
  const transaction = prisma.$transaction.bind(prisma);
  let paused = false;
  // A scheduling barrier around a real query, never a mocked result/write.
  (prisma as any).$transaction = (callback: any, options: any) => transaction(async (tx: any) => callback(new Proxy(tx, {
    get(target, property) {
      if (property !== "merchantOrder") return Reflect.get(target, property);
      return new Proxy(target.merchantOrder, { get(model, query) {
        if (query !== method) return Reflect.get(model, query);
        return async (args: any) => {
          const value = await model[method](args);
          if (!paused && args.where?.id === orderId) { paused = true; observed(); await resumeRead; }
          return value;
        };
      } });
    }
  })), options);
  let pending: ReturnType<typeof call> | undefined;
  try {
    pending = start(); await observedRead; await concurrent(); resume(); return await pending;
  } finally { resume(); if (pending) await pending.catch(() => undefined); (prisma as any).$transaction = transaction; }
}

try {
  for (const [key, id] of Object.entries(actors)) {
    const role = key === "driver" || key === "stranger" ? "driver" : "merchant";
    await prisma.user.create({ data: { id, name: "SYNTHETIC Task10", phone: `+1202${String(parseInt(randomUUID().replaceAll("-", "").slice(0, 8), 16) % 10_000_000).padStart(7, "0")}`, role, profile_state: "complete", email_verified_at: new Date() } });
    const session = await prisma.authSession.create({ data: { user_id: id, client_type: "mobile", expires_at: new Date(Date.now() + 3_600_000), security_version_at_issue: 1 } });
    tokens[key] = signAuthToken({ id, role, sessionId: session.id, securityVersion: 1 });
  }
  const profile = await prisma.driverProfile.create({ data: { user_id: actors.driver, vehicle_type: "van", seats_total: 4, parcel_capacity: 20, verified: true } });
  const route = await prisma.driverRoute.create({ data: { driver_id: profile.id, origin_label: "Hebron / PPU / Bab Al-Zawiya", origin_lat: "31.532600", origin_lng: "35.099800", destination_label: "Bethlehem", destination_lat: "31.705400", destination_lng: "35.202400", corridor_key: LOCKED_CORRIDOR_KEY, seats_available: 4, parcel_capacity_available: 20 } }); routeId = route.id;
  await available();
  const main = await demand(true);
  const initialRace = await Promise.all(Array.from({ length: 8 }, () => match(main.id)));
  check(initialRace.filter(r => r.status === 201).length === 1, "one creation under concurrent initial matching");
  check(initialRace.every(r => r.status === 201 || r.status === 409), "initial concurrency has no unhandled server error");
  const made = initialRace.find(r => r.status === 201)!; assert(made);
  check(made.body.match.driver_route_id === routeId, "correct driver route persisted");
  const offerId = made.body.match.id;
  const inbox = await call("driver", "GET", "/matches");
  const offer = inbox.body.matches.find((m: any) => m.id === offerId);
  check(Boolean(offer), "assigned driver inbox receives persisted offer");
  check(offer?.parcel_batch?.parcel_count === 3, "driver offer reports entire three-parcel batch load");
  check((await call("stranger", "GET", `/matches/${offerId}`)).status === 403, "another driver cannot read offer");
  check((await call("stranger", "POST", `/matches/${offerId}/accept`, {})).status === 403, "another driver cannot accept offer");
  check((await call("other", "GET", `/matches/${offerId}`)).status === 403, "another merchant cannot read offer");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: routeId } })).parcel_capacity_available === 17, "batch capacity reserved exactly once");
  const duplicates = await Promise.all(Array.from({ length: 8 }, () => match(main.id)));
  check(duplicates.every(r => r.status === 409), "duplicate concurrent matching rejected");
  check(await prisma.match.count({ where: { parcel_batch_id: main.batchId } }) === 1, "only one offer after concurrent retries");
  const accepted = await call("driver", "POST", `/matches/${offerId}/accept`, {}); assert.equal(accepted.status, 201);
  for (const id of [main.id, main.secondId]) {
    const detail = await call("merchant", "GET", `/merchant/orders/${id}`);
    check(detail.body.order.status === "assigned" && detail.body.order.trip_id === accepted.body.trip.id, "every batch member has authoritative assigned trip");
  }
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: routeId } })).parcel_capacity_available === 17, "acceptance does not double reserve");
  check((await call("driver", "POST", `/matches/${offerId}/accept`, {})).status === 409, "accept retry cannot create duplicate trip");
  check((await call("driver", "GET", `/matches/${offerId}`)).body.match.status === "accepted", "lost acceptance response reconciles through existing read API");

  for (const variant of ["suspended", "unverified", "departed", "expired_order"] as const) {
    await available(); const d = await demand();
    if (variant === "suspended") await prisma.user.update({ where: { id: actors.driver }, data: { account_status: "suspended" } });
    if (variant === "unverified") await prisma.driverProfile.update({ where: { id: profile.id }, data: { verified: false } });
    if (variant === "departed") await prisma.driverRoute.update({ where: { id: routeId }, data: { departure_at: new Date(Date.now() - 60_000) } });
    if (variant === "expired_order") await prisma.merchantOrder.update({ where: { id: d.id }, data: { status: "expired" } });
    const r = await match(d.id);
    check(r.status >= 400 && r.status < 500, `${variant}: cannot create new match`);
    check(await prisma.match.count({ where: { parcel_batch_id: d.batchId } }) === 0, `${variant}: no offer committed`);
    check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: routeId } })).parcel_capacity_available === 20, `${variant}: no capacity hold`);
    await cancel(d.id);
  }
  await available();
  const expired = await demand(); const expiredOffer = await match(expired.id); assert.equal(expiredOffer.status, 201);
  await prisma.match.update({ where: { id: expiredOffer.body.match.id }, data: { expires_at: new Date(Date.now() - 1) } });
  const expiredAcceptance = await call("driver", "POST", `/matches/${expiredOffer.body.match.id}/accept`, {});
  check(expiredAcceptance.status === 409, "expired offer cannot be accepted before expiry worker pass");
  check(await prisma.trip.count({ where: { merchant_order_id: expired.id } }) === 0, "expired acceptance creates no trip");
  await expireLegacyDispatches(prisma, { now: new Date() });
  check((await prisma.match.findUniqueOrThrow({ where: { id: expiredOffer.body.match.id } })).status === "expired", "existing expiry worker persists terminal offer");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: routeId } })).parcel_capacity_available === 20, "expiry worker releases original hold exactly once");
  await cancel(expired.id);

  // A real lock wait crosses departure. UTC is read only after acquiring the route lock.
  await available(); const waiting = await demand();
  await prisma.driverRoute.update({ where: { id: routeId }, data: { departure_at: new Date(Date.now() + 1500) } });
  const blocker = await mysql.createConnection(db.toString());
  let release: ReturnType<typeof setTimeout> | undefined;
  try {
    await blocker.beginTransaction(); await blocker.query("SELECT id FROM driver_routes WHERE id = ? FOR UPDATE", [routeId]);
    const started = Date.now();
    const pending = match(waiting.id);
    await new Promise(resolve => setTimeout(resolve, 250));
    const [processes] = await blocker.query("SHOW FULL PROCESSLIST");
    const waitingPhase = (processes as Array<{ Info?: string }>).map(p => {
      const sql = String(p.Info ?? "");
      if (/parcel_batches/i.test(sql) && /UPDATE/i.test(sql)) return "batch_route_foreign_key_update";
      if (/driver_routes/i.test(sql) && /FOR UPDATE/i.test(sql)) return "route_eligibility_lock";
      return null;
    }).find(Boolean);
    const lockQueryObserved = Boolean(waitingPhase);
    release = setTimeout(() => { void blocker.commit(); }, 1950);
    const delayed = await pending;
    const elapsed = Date.now() - started;
    check(lockQueryObserved && elapsed >= 1800, "real capacity query waits on owned route row lock");
    check(delayed.status === 409, "route departing during lock wait rejects match");
    check(await prisma.match.count({ where: { parcel_batch_id: waiting.batchId } }) === 0, "post-lock expiry creates no offer");
    check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: routeId } })).parcel_capacity_available === 20, "post-lock expiry retains no hold");
    check((await prisma.merchantOrder.findUniqueOrThrow({ where: { id: waiting.id } })).status === "batched", "post-lock rejection rolls back order claim");
    console.log(JSON.stringify({ phase: "merchant_route_lock_wait", elapsed_ms: elapsed, lock_query_observed: lockQueryObserved, waiting_phase: waitingPhase, status: delayed.status }));
  } finally { if (release) clearTimeout(release); await blocker.rollback(); await blocker.end(); }
  await cancel(waiting.id);

  await available(); const lost = await demand(); dropMatchResponse = true;
  await assert.rejects(match(lost.id)); assertions++;
  const recoveredMatches = (await call("merchant", "GET", "/matches")).body.matches.filter((m: any) => m.merchant_order?.id === lost.id);
  check(recoveredMatches.length === 1 && recoveredMatches[0].status === "proposed", "lost response recovers existing offer through read API");
  check((await match(lost.id)).status === 409, "retry after lost response cannot create duplicate offer");
  check(await prisma.match.count({ where: { parcel_batch_id: lost.batchId } }) === 1, "lost response retry has exactly one persisted offer");
  await cancel(lost.id);

  await available(); const racing = await demand(true); const racingOffer = await match(racing.id); assert.equal(racingOffer.status, 201);
  const cancelledRace = await interleaveOrderRead(racing.secondId, "findFirst",
    () => call("merchant", "PATCH", `/merchant/orders/${racing.secondId}/cancel`, {}),
    async () => { assert.equal((await call("driver", "POST", `/matches/${racingOffer.body.match.id}/accept`, {})).status, 201); });
  check(cancelledRace.status === 409, "stale secondary-order cancellation rejects after acceptance commits");
  check((await prisma.parcelBatch.findUniqueOrThrow({ where: { id: racing.batchId } })).status === "assigned", "acceptance winner retains assigned batch");
  check(await prisma.parcel.count({ where: { batch_id: racing.batchId, status: "assigned" } }) === 3, "acceptance winner retains all assigned parcels");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: routeId } })).parcel_capacity_available === 17, "acceptance winner retains capacity allocation");

  await available(); const newMatchRace = await demand();
  const staleCancel = await interleaveOrderRead(newMatchRace.id, "findFirst",
    () => call("merchant", "PATCH", `/merchant/orders/${newMatchRace.id}/cancel`, {}),
    async () => { assert.equal((await match(newMatchRace.id)).status, 201); });
  check(staleCancel.status === 409, "changed order state requires fresh cancellation read");
  check((await prisma.parcelBatch.findUniqueOrThrow({ where: { id: newMatchRace.batchId } })).status === "proposed", "concurrent matching winner remains proposed");
  await cancel(newMatchRace.id);

  await available(); const aba = await demand(); const oldOffer = await match(aba.id); assert.equal(oldOffer.status, 201);
  let newOfferId = "";
  const abaCancel = await interleaveOrderRead(aba.id, "findFirst",
    () => call("merchant", "PATCH", `/merchant/orders/${aba.id}/cancel`, {}),
    async () => {
      assert.equal((await call("driver", "POST", `/matches/${oldOffer.body.match.id}/reject`, {})).status, 200);
      const rematched = await match(aba.id); assert.equal(rematched.status, 201); newOfferId = rematched.body.match.id;
    });
  check(abaCancel.status === 200, "matched-to-matched cancellation uses current offer");
  check((await prisma.match.findUniqueOrThrow({ where: { id: oldOffer.body.match.id } })).status === "rejected", "historical rejection is not overwritten by stale cancellation");
  const currentOffer = await prisma.match.findUniqueOrThrow({ where: { id: newOfferId } });
  check(currentOffer.status === "invalidated" && !currentOffer.legacy_capacity_held, "current rematched offer is cancelled with its hold");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: routeId } })).parcel_capacity_available === 20, "ABA cancellation releases current allocation exactly once");

  await available();
  const batchRaceOrder = await call("merchant", "POST", "/merchant/orders", payload); assert.equal(batchRaceOrder.status, 201);
  const batchRace = await interleaveOrderRead(batchRaceOrder.body.order.id, "findUnique",
    () => call("merchant", "POST", `/merchant/orders/${batchRaceOrder.body.order.id}/batch`, {}),
    async () => { assert.equal((await call("merchant", "PATCH", `/merchant/orders/${batchRaceOrder.body.order.id}/cancel`, {})).status, 200); });
  check(batchRace.status === 409, "batching rejects order cancelled after initial read");
  check(await prisma.parcelBatch.count({ where: { merchant_order_id: batchRaceOrder.body.order.id } }) === 0, "cancelled order creates no batch or membership");

  await available(); const offline = await demand(); const offlineOffer = await match(offline.id); assert.equal(offlineOffer.status, 201);
  await prisma.driverRoute.update({ where: { id: routeId }, data: { status: "inactive" } });
  const rejected = await call("driver", "POST", `/matches/${offlineOffer.body.match.id}/reject`, {});
  check(rejected.status === 200, "driver rejects existing proposal");
  const afterReject = await prisma.driverRoute.findUniqueOrThrow({ where: { id: routeId } });
  check(afterReject.status === "inactive", "rejection preserves authoritative offline choice");
  check(afterReject.parcel_capacity_available === 20, "rejection releases capacity exactly once");
  check((await call("merchant", "GET", `/merchant/orders/${offline.id}`)).body.order.status === "batched", "rejected batch returns to manual matching eligibility");
  check((await call("driver", "POST", `/matches/${offlineOffer.body.match.id}/reject`, {})).status === 409, "rejection retry cannot double release");
  await cancel(offline.id);
  await available(); const cancelled = await demand(); await cancel(cancelled.id);
  check((await match(cancelled.id)).status === 409, "cancelled order cannot match");
  await available(); const noDriver = await demand(); await prisma.driverRoute.update({where:{id:routeId},data:{status:"inactive"}});
  check((await match(noDriver.id)).status === 404, "no compatible driver is explicit"); await cancel(noDriver.id);
  // A supported older client can match an order before creating its batch.
  // Accepting a competing batched delivery must not strand that eligible cargo.
  const recoveryRoute = await prisma.driverRoute.create({ data: {
    driver_id: profile.id, origin_label: "Hebron / PPU / Bab Al-Zawiya", origin_lat: "31.532600", origin_lng: "35.099800",
    destination_label: "Bethlehem", destination_lat: "31.705400", destination_lng: "35.202400",
    corridor_key: LOCKED_CORRIDOR_KEY, seats_available: 4, parcel_capacity_available: 20
  } });
  routeId = recoveryRoute.id; await available();
  const standalone = await call("other", "POST", "/merchant/orders", { ...payload, parcels: [payload.parcels[0], payload.parcels[0]] });
  assert.equal(standalone.status, 201);
  const standaloneId = standalone.body.order.id;
  const standaloneOffer = await call("other", "POST", "/matches/run", { merchantOrderId: standaloneId });
  assert.equal(standaloneOffer.status, 201);
  const winner = await demand(true); const winnerOffer = await match(winner.id); assert.equal(winnerOffer.status, 201);
  const winningAcceptance = await call("driver", "POST", `/matches/${winnerOffer.body.match.id}/accept`, {});
  assert.equal(winningAcceptance.status, 201);
  const recoveredOrder = await call("other", "GET", `/merchant/orders/${standaloneId}`);
  check(recoveredOrder.body.order.status === "submitted", "invalidated standalone cargo returns to manual batching eligibility");
  check(recoveredOrder.body.order.parcels.every((parcel: any) => parcel.status === "pending" && parcel.batch_id === null), "invalidated standalone cargo retains pending unbatched parcels");
  const obsolete = await prisma.match.findUniqueOrThrow({ where: { id: standaloneOffer.body.match.id } });
  check(obsolete.status === "invalidated" && !obsolete.legacy_capacity_held, "standalone obsolete proposal holds no capacity");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: routeId } })).parcel_capacity_available === 17, "standalone cleanup releases only two units and retains accepted batch allocation");
  check((await call("driver", "POST", `/matches/${obsolete.id}/reject`, {})).status === 409, "obsolete rejection cannot duplicate capacity release");
  const manualBatch = await call("other", "POST", `/merchant/orders/${standaloneId}/batch`, {});
  check(manualBatch.status === 201, "previously invalidated standalone cargo can explicitly create a batch");
  check(await prisma.parcelBatchOrder.count({ where: { merchant_order_id: standaloneId, active: true } }) === 1, "recovered standalone order has exactly one active membership");
  check((await prisma.merchantOrder.findUniqueOrThrow({ where: { id: winner.id } })).status === "assigned", "accepted winner never returns to pending");
  check((await prisma.merchantOrder.findUniqueOrThrow({ where: { id: cancelled.id } })).status === "cancelled", "unrelated terminal cancellation remains terminal");
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: routeId } })).parcel_capacity_available === 17, "manual batching and obsolete rejection do not change accepted capacity");
  console.log(JSON.stringify({ suite: "merchant_matching_real_mysql", assertions, failures }));
  assert.equal(failures.length, 0, "all merchant matching invariants must pass");
} finally {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  const orderIds = (await prisma.merchantOrder.findMany({ where: { merchant_id: { in: [actors.merchant, actors.other] } }, select: { id: true } })).map(o => o.id);
  const batches = (await prisma.parcelBatch.findMany({ where: { merchant_order_id: { in: orderIds } }, select: { id: true } })).map(b => b.id);
  await prisma.trip.deleteMany({ where: { merchant_order_id: { in: orderIds } } });
  await prisma.match.deleteMany({ where: { merchant_order_id: { in: orderIds } } });
  await prisma.parcelBatchOrder.deleteMany({ where: { parcel_batch_id: { in: batches } } });
  await prisma.parcelBatch.deleteMany({ where: { id: { in: batches } } });
  await prisma.parcel.deleteMany({ where: { order_id: { in: orderIds } } });
  await prisma.merchantOrder.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.driverRoute.deleteMany({ where: { driver: { user_id: actors.driver } } });
  await prisma.driverProfile.deleteMany({ where: { user_id: actors.driver } });
  await prisma.auditEvent.deleteMany({ where: { user_id: { in: Object.values(actors) } } });
  await prisma.authSession.deleteMany({ where: { user_id: { in: Object.values(actors) } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(actors) } } });
  for (const original of originalRoutes) await prisma.driverRoute.update({ where: { id: original.id }, data: { status: original.status } });
  await prisma.$disconnect();
}
