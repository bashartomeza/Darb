import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { signAuthToken } from '../middleware/auth.js';
import { LOCKED_CORRIDOR_KEY } from '../modules/demoReset.js';
const db = new URL(process.env.DATABASE_URL!);
assert(['127.0.0.1', 'localhost'].includes(db.hostname) && db.pathname.endsWith('_ci') && process.env.MERCHANT_ORDER_INTEGRATION_CONFIRM_DISPOSABLE === 'true', 'explicit_owned_disposable_database_required');
const prefix = `task11_${randomUUID()}`;
const actors = { passenger: `${prefix}_p`, driver: `${prefix}_d`, otherPassenger: `${prefix}_op`, otherDriver: `${prefix}_od` };
const tokens: Record<string, string> = {};
let assertions = 0;
const failures: string[] = [];
let dropStatusResponse = false;
let dropCancellationResponse = false;
function check(value: unknown, message: string) { assertions++; if (!value)
  failures.push(message); }
const app = express();
app.use((req, res, next) => { const send = res.json.bind(res); res.json = body => { if (dropStatusResponse && req.method === 'POST' && req.originalUrl.endsWith('/status') && res.statusCode === 200) {
  dropStatusResponse = false;
  res.destroy();
  return res;
} if (dropCancellationResponse && req.method === 'PATCH' && req.originalUrl.endsWith('/cancel') && res.statusCode === 200) {
  dropCancellationResponse = false;
  res.destroy();
  return res;
} return send(body); }; next(); });
app.use(createApp());
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(r => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
async function call(actor: keyof typeof actors, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${tokens[actor]}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() as any };
}
const originals = await prisma.driverRoute.findMany({ where: { operational_mode: 'legacy' }, select: { id: true, status: true } });
let profileId: string;
async function trip() {
  await prisma.driverRoute.updateMany({ where: { operational_mode: 'legacy' }, data: { status: 'inactive' } });
  const route = await prisma.driverRoute.create({ data: { driver_id: profileId, origin_label: 'Hebron / PPU / Bab Al-Zawiya', origin_lat: '31.532600', origin_lng: '35.099800', destination_label: 'Bethlehem', destination_lat: '31.705400', destination_lng: '35.202400', corridor_key: LOCKED_CORRIDOR_KEY, seats_available: 4, parcel_capacity_available: 5, status: 'active' } });
  const created = await call('passenger', 'POST', '/passenger/requests', { pickup_label: 'SYNTHETIC Task11 pickup', pickup_lat: 31.5326, pickup_lng: 35.0998, destination_label: 'Bethlehem', destination_lat: 31.7054, destination_lng: 35.2024, preferred_time: new Date(Date.now() + 3600000).toISOString(), passenger_count: 1 });
  assert.equal(created.status, 201);
  const requestId = created.body.request.id;
  const matches = await Promise.all(Array.from({ length: 4 }, () => call('passenger', 'POST', '/matches/run', { passengerRequestId: requestId })));
  check(matches.filter(r => r.status === 201).length === 1, 'one offer from concurrent explicit matching');
  check(matches.every(r => r.status === 201 || r.status === 409), 'concurrent matching has no server failure');
  const successful = matches.find(r => r.status === 201);
  assert(successful, JSON.stringify(matches.map(r => ({ status: r.status, error: r.body.error }))));
  const offer = successful.body.match;
  check(offer.driver_route_id === route.id, 'correct eligible driver route');
  const inbox = await call('driver', 'GET', '/matches');
  check(inbox.body.matches.some((m: any) => m.id === offer.id), 'driver inbox contains exact offer');
  const accepted = await call('driver', 'POST', `/matches/${offer.id}/accept`, {});
  assert.equal(accepted.status, 201);
  const id = accepted.body.trip.id;
  check((await call('passenger', 'GET', `/trips/${id}`)).body.trip.status === 'accepted', 'passenger reads accepted trip');
  check(await prisma.trip.count({ where: { passenger_request_id: requestId } }) === 1, 'one trip for request');
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: route.id } })).seats_available === 3, 'one seat reserved');
  return { id, routeId: route.id, requestId };
}
async function both(id: string, status: string) { for (const actor of ['passenger', 'driver'] as const) {
  const r = await call(actor, 'GET', `/trips/${id}`);
  check(r.status === 200 && r.body.trip.status === status, `${actor} authoritative ${status}`);
} check((await prisma.trip.findUniqueOrThrow({ where: { id } })).status === status, `database authoritative ${status}`); }
try {
  for (const [key, id] of Object.entries(actors)) {
    const role = key.toLowerCase().includes('driver') ? 'driver' : 'passenger';
    await prisma.user.create({ data: { id, name: 'SYNTHETIC Task11', phone: `+1202${String(parseInt(randomUUID().replaceAll('-', '').slice(0, 8), 16) % 10000000).padStart(7, '0')}`, role, profile_state: 'complete', email_verified_at: new Date() } });
    const s = await prisma.authSession.create({ data: { user_id: id, client_type: 'mobile', expires_at: new Date(Date.now() + 3600000), security_version_at_issue: 1 } });
    tokens[key] = signAuthToken({ id, role, sessionId: s.id, securityVersion: 1 });
  }
  profileId = (await prisma.driverProfile.create({ data: { user_id: actors.driver, vehicle_type: 'van', seats_total: 4, parcel_capacity: 5, verified: true } })).id;
  const main = await trip();
  for (const actor of ['otherPassenger', 'otherDriver'] as const) {
    check((await call(actor, 'GET', `/trips/${main.id}`)).status === 403, 'other actor cannot read trip');
    check((await call(actor, 'GET', `/trips/${main.id}/location`)).status === 403, 'other actor cannot read location');
    check((await call(actor, 'POST', `/trips/${main.id}/status`, { status: 'pickup_started' })).status === 403, 'other actor cannot change trip');
    check(!(await call(actor, 'GET', '/trips')).body.trips.some((t: any) => t.id === main.id), 'other actor trip list isolated');
  }
  check((await call('passenger', 'POST', `/trips/${main.id}/status`, { status: 'pickup_started' })).status === 403, 'passenger cannot advance driver lifecycle');
  check((await call('driver', 'POST', `/trips/${main.id}/status`, { status: 'completed' })).status === 409, 'invalid transition rejected');
  await both(main.id, 'accepted');
  const parallel = await Promise.all(Array.from({ length: 2 }, () => call('driver', 'POST', `/trips/${main.id}/status`, { status: 'pickup_started' })));
  check(parallel.filter(r => r.status === 200).length === 1 && parallel.filter(r => r.status === 409).length === 1, 'concurrent transition commits once');
  check(await prisma.auditEvent.count({ where: { entity_id: main.id, action: 'trip_status_updated' } }) === 1, 'one audit for concurrent transition');
  await both(main.id, 'pickup_started');
  const newest = await prisma.locationEvent.create({ data: { trip_id: main.id, driver_id: profileId, lat: '31.550000', lng: '35.110000', source: 'gps', sequence: 20, recorded_at: new Date(Date.now() - 1000) } });
  await prisma.locationEvent.create({ data: { trip_id: main.id, driver_id: profileId, lat: '31.540000', lng: '35.100000', source: 'gps', sequence: 10, recorded_at: new Date() } });
  for (const actor of ['passenger', 'driver'] as const) {
    const location = await call(actor, 'GET', `/trips/${main.id}/location`);
    check(location.status === 200 && location.body.location.sequence === 20, `${actor} latest stored sequence not late inserted GPS fixture`);
  }
  await prisma.locationEvent.create({ data: { trip_id: main.id, driver_id: profileId, lat: '31.560000', lng: '35.120000', source: 'gps', sequence: 20, recorded_at: new Date(Date.now() - 3000) } });
  for (const actor of ['passenger', 'driver'] as const)
    check((await call(actor, 'GET', `/trips/${main.id}/location`)).body.location.id === newest.id, `${actor} equal-sequence latest timestamp deterministic`);
  dropStatusResponse = true;
  await assert.rejects(call('driver', 'POST', `/trips/${main.id}/status`, { status: 'picked_up' }));
  check(!dropStatusResponse, 'actual successful status response socket destroyed');
  await both(main.id, 'picked_up');
  check((await call('driver', 'POST', `/trips/${main.id}/status`, { status: 'picked_up' })).status === 409, 'lost-response duplicate action cannot reapply');
  for (const status of ['in_transit', 'delivered', 'completed']) {
    check((await call('driver', 'POST', `/trips/${main.id}/status`, { status })).status === 200, `driver advances ${status}`);
    await both(main.id, status);
  }
  check((await call('driver', 'POST', `/trips/${main.id}/status`, { status: 'cancelled' })).status === 409, 'completed trip terminal');
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: main.routeId } })).seats_available === 3, 'completion preserves existing capacity rule');
  for (const terminal of ['cancelled', 'failed'] as const) {
    const t = await trip();
    if (terminal === 'failed')
      for (const status of ['pickup_started', 'picked_up', 'in_transit'])
        assert.equal((await call('driver', 'POST', `/trips/${t.id}/status`, { status })).status, 200);
    const terminalRace = await Promise.all(Array.from({ length: 2 }, () => call('driver', 'POST', `/trips/${t.id}/status`, { status: terminal })));
    check(terminalRace.filter(r => r.status === 200).length === 1 && terminalRace.filter(r => r.status === 409).length === 1, `${terminal} concurrent transition commits once`);
    await both(t.id, terminal);
    check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: t.routeId } })).seats_available === 4, `${terminal} restores seat once`);
    check((await call('driver', 'POST', `/trips/${t.id}/status`, { status: terminal })).status === 409, `${terminal} repeated action rejected`);
    check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: t.routeId } })).seats_available === 4, `${terminal} duplicate cannot restore twice`);
  }
  // Task12 verifies the real cancellation contract consumed by Request Details.
  // A response destroyed here is lost only after the transaction committed.
  for (const loseResponse of [false, true]) {
    const t = await trip();
    if (loseResponse) {
      dropCancellationResponse = true;
      await assert.rejects(call('passenger', 'PATCH', `/passenger/requests/${t.requestId}/cancel`, {}));
      check(!dropCancellationResponse, 'successful committed cancellation response destroyed');
    } else {
      const cancelled = await call('passenger', 'PATCH', `/passenger/requests/${t.requestId}/cancel`, {});
      check(cancelled.status === 200 && cancelled.body.request.status === 'cancelled', 'successful cancellation returns saved request');
    }
    await both(t.id, 'cancelled');
    const detail = await call('passenger', 'GET', `/passenger/requests/${t.requestId}`);
    check(detail.status === 200 && detail.body.request.status === 'cancelled', 'reconciled request agrees with cancelled trip');
    check((await call('passenger', 'GET', '/trips')).body.trips.some((r: any) => r.id === t.id && r.status === 'cancelled'), 'related-trip list returns authoritative cancellation');
    check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: t.routeId } })).seats_available === 4, 'cancellation restores exactly one original seat');
    check(await prisma.auditEvent.count({ where: { entity_id: t.requestId, action: 'passenger_request_cancelled' } }) === 1, 'one passenger cancellation audit');
    check(await prisma.auditEvent.count({ where: { entity_id: t.id, action: 'trip_status_updated' } }) === 1, 'one trip transition audit');
    check(await prisma.match.count({ where: { passenger_request_id: t.requestId, legacy_capacity_held: true } }) === 0, 'no capacity hold remains after cancellation');
    check((await call('passenger', 'PATCH', `/passenger/requests/${t.requestId}/cancel`, {})).status === 409, 'duplicate cancellation cannot reapply');
    check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: t.routeId } })).seats_available === 4, 'duplicate cancellation cannot inflate capacity');
    check(await prisma.auditEvent.count({ where: { entity_id: t.requestId, action: 'passenger_request_cancelled' } }) === 1, 'duplicate cancellation cannot add audit');
    check((await call('otherPassenger', 'GET', `/trips/${t.id}`)).status === 403, 'other Passenger cannot read cancelled trip');
    check((await call('otherPassenger', 'GET', `/passenger/requests/${t.requestId}`)).status === 404, 'other Passenger cannot read cancelled request');
    check((await call('otherPassenger', 'PATCH', `/passenger/requests/${t.requestId}/cancel`, {})).status === 404, 'other Passenger cannot cancel request');
  }
  const race = await trip();
  const competing = await Promise.all([
    call('passenger', 'PATCH', `/passenger/requests/${race.requestId}/cancel`, {}),
    call('driver', 'POST', `/trips/${race.id}/status`, { status: 'pickup_started' }),
  ]);
  check(competing.filter(r => r.status === 200).length === 1 && competing.filter(r => r.status === 409).length === 1, 'Passenger cancellation and Driver progress commit only one transition');
  const persisted = await prisma.trip.findUniqueOrThrow({ where: { id: race.id } });
  const cancelled = persisted.status === 'cancelled';
  check(cancelled || persisted.status === 'pickup_started', 'race ends in one permitted authoritative state');
  await both(race.id, persisted.status);
  check((await call('passenger', 'GET', `/passenger/requests/${race.requestId}`)).body.request.status === (cancelled ? 'cancelled' : 'accepted'), 'request obeys existing status mapping after race');
  check((await prisma.driverRoute.findUniqueOrThrow({ where: { id: race.routeId } })).seats_available === (cancelled ? 4 : 3), 'race restores capacity only when cancellation won');
  check(await prisma.auditEvent.count({ where: { entity_id: race.id, action: 'trip_status_updated' } }) === 1, 'race has one trip transition audit');
  console.log(JSON.stringify({ suite: 'passenger_driver_trip_sync_real_mysql', assertions, failures, location_evidence: 'synthetic stored LocationEvents; no live GPS ingestion/provider claim' }));
  assert.equal(failures.length, 0);
}
finally {
  server.closeAllConnections();
  await new Promise<void>(r => server.close(() => r()));
  const requests = (await prisma.passengerRequest.findMany({ where: { passenger_id: actors.passenger }, select: { id: true } })).map(r => r.id);
  const trips = (await prisma.trip.findMany({ where: { passenger_request_id: { in: requests } }, select: { id: true } })).map(t => t.id);
  await prisma.locationEvent.deleteMany({ where: { trip_id: { in: trips } } });
  await prisma.trip.deleteMany({ where: { id: { in: trips } } });
  await prisma.match.deleteMany({ where: { passenger_request_id: { in: requests } } });
  await prisma.passengerRequest.deleteMany({ where: { id: { in: requests } } });
  await prisma.driverRoute.deleteMany({ where: { driver: { user_id: actors.driver } } });
  await prisma.driverProfile.deleteMany({ where: { user_id: actors.driver } });
  await prisma.auditEvent.deleteMany({ where: { user_id: { in: Object.values(actors) } } });
  await prisma.authSession.deleteMany({ where: { user_id: { in: Object.values(actors) } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(actors) } } });
  for (const r of originals)
    await prisma.driverRoute.update({ where: { id: r.id }, data: { status: r.status } });
  await prisma.$disconnect();
}
