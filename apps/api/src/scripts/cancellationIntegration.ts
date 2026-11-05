import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { signAuthToken } from "../middleware/auth.js";
import { expireLegacyDispatches } from "../services/legacyDispatch.js";
import { ensureIntegrationRoutes } from "./integrationRoutes.js";

/**
 * Real-database checks of the cancellation flow: a passenger or merchant cancelling after a
 * driver accepted, a driver cancelling (back to waiting inside the order's window, cancelled
 * past it, limited per day), the automatic no-driver cancellation with capacity released
 * exactly once, administrator cancellations and the cancellation history. No query result
 * or write is mocked.
 */
const db = new URL(process.env.DATABASE_URL!);
assert(
  ["localhost", "127.0.0.1"].includes(db.hostname) &&
    db.pathname.endsWith("_ci") &&
    process.env.MERCHANT_ORDER_INTEGRATION_CONFIRM_DISPOSABLE === "true",
  "explicit_owned_disposable_database_required"
);
const prefix = `cancel_${randomUUID()}`;
const actors = {
  p1: `${prefix}_p1`,
  p2: `${prefix}_p2`,
  merchant: `${prefix}_m`,
  driver: `${prefix}_d`,
  admin: `${prefix}_a`
};
type Actor = keyof typeof actors;
const tokens: Record<string, string> = {};
let assertions = 0;
const failures: string[] = [];
function check(value: unknown, label: string) {
  assertions++;
  if (!value) failures.push(label);
}

const server = createApp().listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
async function call(actor: Actor | null, method: string, url: string, body?: unknown) {
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const r = await fetch(origin + url, {
    method,
    headers: { "content-type": "application/json", ...(actor ? { authorization: `Bearer ${tokens[actor]}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: r.status, body: (await r.json()) as any };
}

const HEBRON_TO_BETHLEHEM = await ensureIntegrationRoutes(prisma);
let profileId: string;
const originals = await prisma.driverRoute.findMany({ where: { operational_mode: "legacy" }, select: { id: true, status: true } });
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

async function route(seats = 2, parcels = 5) {
  await prisma.driverRoute.updateMany({ where: { operational_mode: "legacy" }, data: { status: "inactive" } });
  const r = await call("driver", "POST", "/driver/routes", { service_route_id: HEBRON_TO_BETHLEHEM.id, seats_available: seats, parcel_capacity_available: parcels });
  assert.equal(r.status, 201, "route " + JSON.stringify(r.body));
  return r.body.route.id as string;
}
async function passenger(actor: Actor = "p1", seats = 1) {
  const r = await call(actor, "POST", "/passenger/requests", {
    pickup_label: "SYNTHETIC Cancel", pickup_lat: 31.5326, pickup_lng: 35.0998,
    destination_label: "Bethlehem", destination_lat: 31.7054, destination_lng: 35.2024,
    preferred_time: new Date(Date.now() + 3600000).toISOString(), passenger_count: seats
  });
  assert.equal(r.status, 201, "passenger " + JSON.stringify(r.body));
  return r.body.request.id as string;
}
async function order() {
  const r = await call("merchant", "POST", "/merchant/orders", {
    pickup_label: "SYNTHETIC Cancel", pickup_lat: 31.5326, pickup_lng: 35.0998,
    parcels: [{ destination_label: "Bethlehem", destination_lat: 31.7054, destination_lng: 35.2024, size: "S", priority: "normal" }]
  });
  assert.equal(r.status, 201, "order " + JSON.stringify(r.body));
  const id = r.body.order.id as string;
  return { id };
}
async function batchOf(first: string) {
  const b = await call("merchant", "POST", `/merchant/orders/${first}/batch`, {});
  assert.equal(b.status, 201, JSON.stringify(b.body));
  return b.body.batch.id as string;
}
const match = (body: object, routeId: string) => call("merchantOrderId" in body ? "merchant" : "p1", "POST", "/matches/run", { ...body, ...("passengerRequestId" in body ? { driverRouteId: routeId } : {}) });
const accept = (id: string) => call("driver", "POST", `/matches/${id}/accept`, {});
async function accepted(requestId: string, routeId: string) {
  const m = await call("p1", "POST", "/matches/run", { passengerRequestId: requestId, driverRouteId: routeId });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  const a = await accept(m.body.match.id);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  return { matchId: m.body.match.id as string, tripId: a.body.trip.id as string };
}
async function acceptedOrder(orderId: string, routeId: string) {
  const m = await match({ merchantOrderId: orderId }, routeId);
  assert.equal(m.status, 201, JSON.stringify(m.body));
  const a = await accept(m.body.match.id);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  return { matchId: m.body.match.id as string, tripId: a.body.trip.id as string };
}
async function capacity(id: string, seats: number, parcels: number, label: string) {
  const r = await prisma.driverRoute.findUniqueOrThrow({ where: { id } });
  check(r.seats_available === seats && r.parcel_capacity_available === parcels, `${label} (seats ${r.seats_available}/${seats}, parcels ${r.parcel_capacity_available}/${parcels})`);
}
const notifications = (userId: string, entityId: string) =>
  prisma.notification.findMany({ where: { user_id: userId, type: "cancelled", entity_id: entityId } });
const rows = (where: object) => prisma.cancellation.findMany({ where, orderBy: { created_at: "asc" } });
const driverUserId = actors.driver;

try {
  for (const [key, id] of Object.entries(actors)) {
    const role = key === "driver" ? "driver" : key === "merchant" ? "merchant" : key === "admin" ? "admin" : "passenger";
    await prisma.user.create({
      data: { id, role, name: "SYNTHETIC Cancel", phone: `+1202${String(parseInt(randomUUID().replaceAll("-", "").slice(0, 8), 16) % 10000000).padStart(7, "0")}`, profile_state: "complete", email_verified_at: new Date() }
    });
    const session = await prisma.authSession.create({ data: { user_id: id, client_type: "mobile", security_version_at_issue: 1, expires_at: new Date(Date.now() + 3600000) } });
    tokens[key] = signAuthToken({ id, role, sessionId: session.id, securityVersion: 1 });
  }
  profileId = (await prisma.driverProfile.create({ data: { user_id: actors.driver, verified: true, vehicle_type: "van", seats_total: 4, parcel_capacity: 5 } })).id;

  // ---- 1. A passenger cancels after a driver accepted ----
  {
    const r = await route(2, 1);
    const p = await passenger("p1", 1);
    const { tripId } = await accepted(p, r);
    await capacity(r, 1, 1, "accepted ride holds its seat");
    check((await call("p1", "PATCH", `/passenger/requests/${p}/cancel`, {})).status === 400, "cancelling needs a reason");
    check((await call("p1", "PATCH", `/passenger/requests/${p}/cancel`, { reason: "vehicle_problem" })).status === 400, "a driver's reason is not a passenger reason");
    const cancelled = await call("p1", "PATCH", `/passenger/requests/${p}/cancel`, { reason: "changed_plans", note: "meeting moved" });
    check(cancelled.status === 200 && cancelled.body.request.status === "cancelled", "passenger cancels an accepted ride");
    check(cancelled.body.request.cancellation?.reason === "changed_plans" && cancelled.body.request.cancellation.by === "passenger" && cancelled.body.request.cancellation.automatic === false, "the request shows who cancelled and why");
    check(!JSON.stringify(cancelled.body).includes("meeting moved"), "the free-text note is not shown to the other side's screens");
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    check(trip.status === "cancelled" && trip.cancelled_by_user_id === actors.p1, "the trip is cancelled by the passenger");
    await capacity(r, 2, 1, "the passenger's cancellation frees the seat");
    check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: r } })).status === "active", "the driver's route is open for work again");
    const [row] = await rows({ passenger_request_id: p });
    check(row?.actor_role === "passenger" && row.reason_code === "changed_plans" && row.note === "meeting moved" && !row.automatic && row.ends_order && row.trip_id === tripId, "a cancellation row records who, why, order and trip");
    check((await notifications(driverUserId, tripId)).length === 1, "the driver is told the passenger cancelled");
    check((await notifications(actors.p1, p)).length === 0, "the person who cancelled is not notified of their own action");
    check((await call("p1", "PATCH", `/passenger/requests/${p}/cancel`, { reason: "other" })).status === 409, "a second cancel is refused");
    const shown = await call("driver", "GET", `/trips/${tripId}`);
    check(shown.body.trip?.cancellation?.reason === "changed_plans" && shown.body.trip.cancellation.by === "passenger", "the trip shows its cancellation");
  }

  // ---- 2. A driver cancels inside the order's window: back to waiting ----
  {
    const r = await route(1, 1);
    const p = await passenger("p1", 1);
    const { tripId } = await accepted(p, r);
    check((await call("driver", "POST", `/trips/${tripId}/status`, { status: "cancelled" })).status === 409, "a driver cannot cancel before pickup without going through the reason endpoint");
    check((await call("driver", "POST", `/trips/${tripId}/cancel`, { reason: "changed_plans" })).status === 400, "a driver must use a driver reason");
    check((await call("p1", "POST", `/trips/${tripId}/cancel`, { reason: "other" })).status === 403, "only drivers cancel through the driver endpoint");
    const out = await call("driver", "POST", `/trips/${tripId}/cancel`, { reason: "vehicle_problem", note: "flat tyre" });
    check(out.status === 200 && out.body.trip.status === "cancelled" && out.body.returned_to_waiting === 1, "the driver cancels the accepted trip");
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    check(trip.cancelled_by_user_id === actors.driver && trip.legacy_assignment_key === null, "the trip is cancelled by the driver and gives up its assignment key");
    check((await prisma.passengerRequest.findUniqueOrThrow({ where: { id: p } })).status === "pending", "the ride goes back to waiting");
    await capacity(r, 1, 1, "the driver's cancellation frees the seat");
    const [row] = await rows({ passenger_request_id: p });
    check(row?.actor_role === "driver" && row.reason_code === "vehicle_problem" && row.ends_order === false && row.trip_id === tripId, "recorded as a trip cancellation that did not end the order");
    const told = await notifications(actors.p1, p);
    check(told.length === 1 && (told[0].params as any).waiting === true && (told[0].params as any).by === "driver", "the passenger is told the driver cancelled and the ride is waiting");
    check((await prisma.driverProfile.findUniqueOrThrow({ where: { id: profileId } })).trust_computed_at !== null, "the driver's trust score is recomputed");
    const waiting = await call("p1", "GET", `/passenger/requests/${p}`);
    check(waiting.body.request.status === "pending" && waiting.body.request.cancellation === null, "the waiting ride shows no cancellation");
    // Another driver (here the same one on a new route) can take it again.
    const r2 = await route(1, 1);
    const second = await accepted(p, r2);
    check(second.tripId !== tripId, "the same ride can be accepted again after its driver cancelled");
    await call("p1", "PATCH", `/passenger/requests/${p}/cancel`, { reason: "other" });
    await capacity(r2, 1, 1, "cleanup");
  }

  // ---- 3. A driver cancels past the order's window: cancelled automatically ----
  {
    const r = await route(1, 1);
    const p = await passenger("p1", 1);
    const { tripId } = await accepted(p, r);
    await prisma.passengerRequest.update({ where: { id: p }, data: { created_at: minutesAgo(120), preferred_time: minutesAgo(90) } });
    const out = await call("driver", "POST", `/trips/${tripId}/cancel`, { reason: "emergency" });
    check(out.status === 200 && out.body.returned_to_waiting === 0, "the driver cancels past the ride's window");
    check((await prisma.passengerRequest.findUniqueOrThrow({ where: { id: p } })).status === "cancelled", "the ride past its window is cancelled instead of waiting");
    const both = await rows({ passenger_request_id: p });
    check(both.length === 2 && both[0].actor_role === "driver" && both[0].ends_order === false && both[1].actor_role === "system" && both[1].automatic && both[1].reason_code === "no_driver_in_time" && both[1].ends_order, "both the driver's cancellation and the automatic one are recorded");
    const told = await notifications(actors.p1, p);
    check(told.length === 1 && (told[0].params as any).automatic === true, "the passenger gets one notice, the automatic cancellation");
    await capacity(r, 1, 1, "capacity is free");
    const view = await call("p1", "GET", `/passenger/requests/${p}`);
    check(view.body.request.cancellation?.by === "system" && view.body.request.cancellation.reason === "no_driver_in_time" && view.body.request.cancellation.automatic === true, "the cancelled ride shows the automatic reason");
  }

  // ---- 4. Driver cancellations are limited per day ----
  {
    const r = await route(1, 1);
    const p = await passenger("p1", 1);
    const { tripId } = await accepted(p, r);
    // Two accepted trips were already cancelled by this driver today (steps 2 and 3).
    const third = await call("driver", "POST", `/trips/${tripId}/cancel`, { reason: "route_changed" });
    check(third.status === 200, "the third cancellation of the day is allowed");
    const r2 = await route(1, 1);
    const again = await accepted(p, r2);
    const fourth = await call("driver", "POST", `/trips/${again.tripId}/cancel`, { reason: "route_changed" });
    check(fourth.status === 429 && fourth.body.error === "driver_cancellation_limit_reached", "the fourth cancellation of the day is refused");
    check((await prisma.trip.findUniqueOrThrow({ where: { id: again.tripId } })).status === "accepted", "a refused cancellation changes nothing");
    await call("p1", "PATCH", `/passenger/requests/${p}/cancel`, { reason: "other" });
    check((await prisma.cancellation.count({ where: { actor_user_id: actors.driver, actor_role: "driver" } })) >= 3, "driver cancellations are counted from the history");
  }

  // ---- 5. Automatic cancellation: capacity released exactly once ----
  {
    await prisma.cancellation.deleteMany({ where: { actor_user_id: actors.driver } });
    const r = await route(2, 1);
    const p = await passenger("p1", 2);
    const offer = await call("p1", "POST", "/matches/run", { passengerRequestId: p, driverRouteId: r });
    check(offer.status === 201, "an offer holds two seats");
    await capacity(r, 0, 1, "offer holds the seats");
    const fresh = await passenger("p2", 1);
    const laterBooked = await passenger("p2", 1);
    const justUnder = await passenger("p2", 1);
    await prisma.passengerRequest.update({ where: { id: p }, data: { created_at: minutesAgo(50), preferred_time: minutesAgo(50) } });
    // Booked for later (the booked time is in the future): not cancelled however long ago it was created.
    await prisma.passengerRequest.update({ where: { id: laterBooked }, data: { created_at: minutesAgo(240), preferred_time: new Date(Date.now() + 3600000) } });
    await prisma.passengerRequest.update({ where: { id: justUnder }, data: { created_at: minutesAgo(40), preferred_time: minutesAgo(40) } });
    const first = await expireLegacyDispatches(prisma);
    const second = await expireLegacyDispatches(prisma);
    check(first.requestsCancelled === 1 && second.requestsCancelled === 0, "the overdue ride is cancelled once");
    check((await prisma.passengerRequest.findUniqueOrThrow({ where: { id: p } })).status === "cancelled", "ride with no accepted driver 50 minutes after its time is cancelled");
    for (const id of [fresh, laterBooked, justUnder]) {
      check((await prisma.passengerRequest.findUniqueOrThrow({ where: { id } })).status === "pending", "a ride inside its 45 minutes (or booked for later) is untouched");
    }
    check((await prisma.match.findUniqueOrThrow({ where: { id: offer.body.match.id } })).status === "invalidated", "the pending offer is withdrawn");
    await capacity(r, 2, 1, "the held seats come back exactly once");
    const [row] = await rows({ passenger_request_id: p });
    check(row?.actor_role === "system" && row.automatic && row.reason_code === "no_driver_in_time" && row.actor_user_id === null, "recorded as the automatic cancellation");
    check((await notifications(actors.p1, p)).length === 1, "the passenger is told");
    check((await prisma.notification.count({ where: { user_id: driverUserId, type: "match_withdrawn", entity_id: offer.body.match.id } })) === 1, "the driver who was offered it is told the offer is gone");
    for (const id of [fresh, laterBooked, justUnder]) await call("p2", "PATCH", `/passenger/requests/${id}/cancel`, { reason: "other" });

    // A ride a driver already accepted is never auto-cancelled, however old.
    const kept = await passenger("p1", 1);
    const keptTrip = await accepted(kept, r);
    await prisma.passengerRequest.update({ where: { id: kept }, data: { created_at: minutesAgo(300), preferred_time: minutesAgo(300) } });
    await expireLegacyDispatches(prisma);
    check((await prisma.passengerRequest.findUniqueOrThrow({ where: { id: kept } })).status === "accepted", "an accepted ride is not auto-cancelled");
    await prisma.passengerRequest.update({ where: { id: kept }, data: { preferred_time: new Date(Date.now() + 3600000) } });
    await call("p1", "PATCH", `/passenger/requests/${kept}/cancel`, { reason: "other" });
    check(keptTrip.tripId !== "", "cleanup");

    // Orders: only the old order of a batch is cancelled; the other stays batched.
    const o1 = await order();
    const o2 = await order();
    const batchId = await batchOf(o1.id);
    await prisma.merchantOrder.update({ where: { id: o1.id }, data: { created_at: minutesAgo(50) } });
    const sweep = await expireLegacyDispatches(prisma);
    check(sweep.ordersCancelled === 1, "the old order is cancelled");
    check((await prisma.merchantOrder.findUniqueOrThrow({ where: { id: o1.id } })).status === "cancelled", "the old order is cancelled automatically");
    check((await prisma.merchantOrder.findUniqueOrThrow({ where: { id: o2.id } })).status === "batched", "its batch sibling stays batched");
    const batch = await prisma.parcelBatch.findUniqueOrThrow({ where: { id: batchId } });
    check(batch.status === "created" && batch.merchant_order_id === o2.id, "the batch carries on under the remaining order");
    const orderRow = (await rows({ merchant_order_id: o1.id }))[0];
    check(orderRow?.automatic && orderRow.reason_code === "no_driver_in_time", "the order cancellation is recorded as automatic");
    const orderView = await call("merchant", "GET", `/merchant/orders/${o1.id}`);
    check(orderView.body.order.cancellation?.reason === "no_driver_in_time" && orderView.body.order.cancellation.automatic === true, "the order shows the automatic reason");
    check((await notifications(actors.merchant, o1.id)).length === 1, "the merchant is told");
    // The remaining order, booked for later, waits for its time.
    await prisma.merchantOrder.update({ where: { id: o2.id }, data: { created_at: minutesAgo(300), requested_departure_from: new Date(Date.now() + 3600000), requested_departure_until: new Date(Date.now() + 7200000) } });
    check((await expireLegacyDispatches(prisma)).ordersCancelled === 0, "an order booked for later is not cancelled before its time");
    await prisma.merchantOrder.update({ where: { id: o2.id }, data: { requested_departure_from: minutesAgo(46), requested_departure_until: new Date(Date.now() + 3600000) } });
    check((await expireLegacyDispatches(prisma)).ordersCancelled === 1, "it is cancelled 45 minutes after its booked time");
    check((await prisma.parcelBatch.findUniqueOrThrow({ where: { id: batchId } })).status === "cancelled", "the last order of the batch closes it");
  }

  // ---- 6. A merchant cancels after a driver accepted ----
  {
    const r = await route(1, 5);
    const single = await order();
    await batchOf(single.id);
    await acceptedOrder(single.id, r);
    await capacity(r, 1, 4, "accepted order holds a parcel unit");
    const done = await call("merchant", "PATCH", `/merchant/orders/${single.id}/cancel`, { reason: "wrong_details" });
    check(done.status === 200 && done.body.order.status === "cancelled" && done.body.order.cancellation?.reason === "wrong_details", "merchant cancels an accepted order");
    await capacity(r, 1, 5, "its capacity is freed");
    const trip = await prisma.trip.findFirstOrThrow({ where: { merchant_order_id: single.id } });
    check(trip.status === "cancelled" && trip.cancelled_by_user_id === actors.merchant, "the trip is cancelled");
    check((await prisma.parcel.count({ where: { order_id: single.id, status: "cancelled" } })) === 1, "its parcel is cancelled");
    check((await notifications(driverUserId, trip.id)).length === 1, "the driver is told");

    // Two orders on one trip: one leaves, the trip goes on for the other.
    const r2 = await route(1, 5);
    const a = await order();
    const b = await order();
    const batchId = await batchOf(a.id);
    const t = await acceptedOrder(a.id, r2);
    await capacity(r2, 1, 3, "the trip holds both parcels");
    const leave = await call("merchant", "PATCH", `/merchant/orders/${a.id}/cancel`, { reason: "changed_plans" });
    check(leave.status === 200, "the lead order of an accepted batch is cancelled");
    check((await prisma.trip.findUniqueOrThrow({ where: { id: t.tripId } })).status === "accepted", "the trip continues for the other order");
    check((await prisma.merchantOrder.findUniqueOrThrow({ where: { id: b.id } })).status === "assigned", "the other order stays assigned");
    await capacity(r2, 1, 4, "only the cancelled order's parcel is freed");
    const stillBatch = await prisma.parcelBatch.findUniqueOrThrow({ where: { id: batchId } });
    const stillTrip = await prisma.trip.findUniqueOrThrow({ where: { id: t.tripId } });
    check(stillBatch.status === "assigned" && stillBatch.merchant_order_id === b.id && stillTrip.merchant_order_id === b.id, "the batch and trip are led by the remaining order");
    check((await prisma.parcel.count({ where: { order_id: a.id, status: "cancelled", batch_id: null } })) === 1, "the cancelled order's parcel leaves the batch");
    const partial = (await notifications(driverUserId, t.tripId)).find((n) => (n.params as any).partial === true);
    check(partial !== undefined, "the driver is told an order left the trip");
    const end = await call("merchant", "PATCH", `/merchant/orders/${b.id}/cancel`, { reason: "other" });
    check(end.status === 200, "the last order is cancelled");
    check((await prisma.trip.findUniqueOrThrow({ where: { id: t.tripId } })).status === "cancelled", "the trip is cancelled with its last order");
    await capacity(r2, 1, 5, "all capacity is back");
    check((await prisma.parcelBatch.findUniqueOrThrow({ where: { id: batchId } })).status === "cancelled", "the batch closes");
    check((await call("merchant", "PATCH", `/merchant/orders/${b.id}/cancel`, { reason: "other" })).status === 409, "a cancelled order cannot be cancelled again");
  }

  // ---- 7. A driver cancels a trip carrying a batch: the orders wait again, or are cancelled ----
  {
    await prisma.cancellation.deleteMany({ where: { actor_user_id: actors.driver } });
    const r = await route(1, 5);
    const a = await order();
    const b = await order();
    const batchId = await batchOf(a.id);
    const t = await acceptedOrder(a.id, r);
    await prisma.merchantOrder.update({ where: { id: b.id }, data: { created_at: minutesAgo(200) } });
    const out = await call("driver", "POST", `/trips/${t.tripId}/cancel`, { reason: "vehicle_problem" });
    check(out.status === 200, "the driver cancels a batch trip");
    check((await prisma.merchantOrder.findUniqueOrThrow({ where: { id: a.id } })).status === "batched", "an order inside its window goes back to waiting in its batch");
    check((await prisma.merchantOrder.findUniqueOrThrow({ where: { id: b.id } })).status === "cancelled", "an order past its window is cancelled");
    const reopened = await prisma.parcelBatch.findUniqueOrThrow({ where: { id: batchId } });
    check(reopened.status === "created" && reopened.driver_route_id === null && reopened.merchant_order_id === a.id, "the batch is offered again with the remaining order");
    await capacity(r, 1, 5, "the route is free again");
    check((await prisma.parcel.count({ where: { order_id: a.id, status: "batched" } })) === 1, "the waiting order's parcel is batched again");
    check((await rows({ merchant_order_id: b.id })).some((row) => row.automatic && row.reason_code === "no_driver_in_time"), "the late order's cancellation is automatic");
    await call("merchant", "PATCH", `/merchant/orders/${a.id}/cancel`, { reason: "other" });
  }

  // ---- 8. Administrators ----
  await prisma.cancellation.deleteMany({ where: { actor_user_id: actors.driver } });
  {
    const r = await route(2, 5);
    const p = await passenger("p1", 1);
    const t = await accepted(p, r);
    check((await call("p1", "POST", `/admin/trips/${t.tripId}/cancel`, { reason: "safety_concern" })).status === 403, "only administrators use the admin cancel");
    check((await call("admin", "POST", `/admin/trips/${t.tripId}/cancel`, { reason: "changed_plans" })).status === 400, "an administrator picks from the administrator reasons");
    const cancelled = await call("admin", "POST", `/admin/trips/${t.tripId}/cancel`, { reason: "safety_concern", note: "reported" });
    check(cancelled.status === 200, "an administrator cancels a trip");
    check((await prisma.passengerRequest.findUniqueOrThrow({ where: { id: p } })).status === "cancelled", "the ride on it is cancelled");
    await capacity(r, 2, 5, "capacity is freed");
    const told = await notifications(actors.p1, p);
    check(told.length === 1 && (told[0].params as any).by === "admin", "the passenger is told the team cancelled");
    check((await notifications(driverUserId, t.tripId)).length === 1, "the driver is told");
    check((await call("admin", "POST", `/admin/trips/${t.tripId}/cancel`, { reason: "duplicate" })).status === 409, "a finished trip cannot be cancelled again");
    // Not counted against the driver's daily limit: it was an administrator.
    check((await prisma.cancellation.count({ where: { actor_user_id: actors.driver } })) === 0, "an administrator's cancellation is not the driver's");

    const waiting = await passenger("p2", 1);
    check((await call("admin", "POST", `/admin/requests/${waiting}/cancel`, { reason: "duplicate" })).status === 200, "an administrator cancels a waiting ride");
    const o = await order();
    check((await call("admin", "POST", `/admin/orders/${o.id}/cancel`, { reason: "customer_request" })).status === 200, "an administrator cancels a waiting order");
    const o2 = await order();
    await batchOf(o2.id);
    await acceptedOrder(o2.id, r);
    check((await call("admin", "POST", `/admin/orders/${o2.id}/cancel`, { reason: "driver_unavailable" })).status === 200, "an administrator cancels an accepted order");
    check((await prisma.merchantOrder.findUniqueOrThrow({ where: { id: o2.id } })).status === "cancelled", "the accepted order is cancelled");
    await capacity(r, 2, 5, "capacity is freed again");

    const history = await call("admin", "GET", "/admin/cancellations?limit=100");
    check(history.status === 200 && history.body.total >= 6, "the history lists cancellations");
    const manual = await call("admin", "GET", "/admin/cancellations?kind=manual&role=admin&limit=100");
    check(manual.body.cancellations.length >= 4 && manual.body.cancellations.every((c: any) => c.actor_role === "admin" && c.automatic === false), "filter by manual and role");
    const auto = await call("admin", "GET", "/admin/cancellations?kind=auto&reason=no_driver_in_time&limit=100");
    check(auto.body.cancellations.length >= 3 && auto.body.cancellations.every((c: any) => c.automatic && c.reason_code === "no_driver_in_time"), "filter by automatic and reason");
    const none = await call("admin", "GET", `/admin/cancellations?from=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`);
    check(none.status === 200 && none.body.total === 0, "filter by date");
    check((await call("p1", "GET", "/admin/cancellations")).status === 403, "the history is for administrators");
  }

  console.log(JSON.stringify({ suite: "cancellation_flow_real_db", assertions, failures }));
  assert.equal(failures.length, 0, `cancellation invariants failed: ${failures.join("; ")}`);
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const ids = Object.values(actors);
  const ps = (await prisma.passengerRequest.findMany({ where: { passenger_id: { in: ids } }, select: { id: true } })).map((x) => x.id);
  const os = (await prisma.merchantOrder.findMany({ where: { merchant_id: { in: ids } }, select: { id: true } })).map((x) => x.id);
  const batches = (await prisma.parcelBatch.findMany({ where: { merchant_order_id: { in: os } }, select: { id: true } })).map((x) => x.id);
  await prisma.cancellation.deleteMany({ where: { OR: [{ passenger_request_id: { in: ps } }, { merchant_order_id: { in: os } }, { actor_user_id: { in: ids } }] } });
  await prisma.trip.deleteMany({ where: { OR: [{ passenger_request_id: { in: ps } }, { merchant_order_id: { in: os } }] } });
  await prisma.match.deleteMany({ where: { OR: [{ passenger_request_id: { in: ps } }, { merchant_order_id: { in: os } }] } });
  await prisma.parcelBatchOrder.deleteMany({ where: { parcel_batch_id: { in: batches } } });
  await prisma.parcelBatch.deleteMany({ where: { id: { in: batches } } });
  await prisma.parcel.deleteMany({ where: { order_id: { in: os } } });
  await prisma.deliveryHandover.deleteMany({ where: { merchant_order_id: { in: os } } });
  await prisma.merchantOrder.deleteMany({ where: { id: { in: os } } });
  await prisma.passengerRequest.deleteMany({ where: { id: { in: ps } } });
  await prisma.driverRoute.deleteMany({ where: { driver: { user_id: { in: ids } } } });
  await prisma.driverProfile.deleteMany({ where: { user_id: { in: ids } } });
  await prisma.auditEvent.deleteMany({ where: { user_id: { in: ids } } });
  await prisma.authSession.deleteMany({ where: { user_id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  for (const original of originals) await prisma.driverRoute.update({ where: { id: original.id }, data: { status: original.status } });
  await prisma.$disconnect();
}
