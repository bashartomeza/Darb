import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../generated/prisma/client.js";

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  passengerRequest: { create: vi.fn(), findFirst: vi.fn() },
  driverProfile: { findUnique: vi.fn() },
  driverRoute: { create: vi.fn(), findFirst: vi.fn() },
  idempotencyRecord: { create: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  auditEvent: { create: vi.fn() },
}));
vi.mock("../lib/prisma.js", () => ({ prisma: db }));
const { createApp } = await import("../app.js");

type Row = Record<string, any>;
let rows: Row[];
let records: Row[];
let audits: Row[];
let nextId: number;
let driverRoutes: Row[];
const body = () => ({
  pickup_label: "PPU", pickup_lat: 31.5326, pickup_lng: 35.0998,
  destination_label: "Bethlehem", destination_lat: 31.7054, destination_lng: 35.2024,
  preferred_time: new Date(Date.now() + 3_600_000).toISOString(), passenger_count: 1,
});
function create(actor: string, payload: object, key?: string) {
  const token = jwt.sign({ role: "passenger", sid: `session_${actor}`, ver: 1 },
    "test-only-jwt-secret-with-at-least-thirty-two-characters", { subject: actor, expiresIn: "1h" });
  const operation = request(createApp()).post("/api/v1/passenger/requests").set("Authorization", `Bearer ${token}`);
  if (key !== undefined) operation.set("Idempotency-Key", key);
  return operation.send(payload);
}
function createDriver(actor: string, payload: object, key: string) {
  const token = jwt.sign({ role: "driver", sid: `session_${actor}`, ver: 1 },
    "test-only-jwt-secret-with-at-least-thirty-two-characters", { subject: actor, expiresIn: "1h" });
  return request(createApp()).post("/api/v1/driver/routes").set("Authorization", `Bearer ${token}`)
    .set("Idempotency-Key", key).send(payload);
}

describe("legacy passenger creation recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows = []; records = []; audits = []; driverRoutes = []; nextId = 0;
    db.authSession.findUnique.mockImplementation(({ where }) => {
      const id = where.id.replace("session_", "");
      return { id: where.id, user_id: id, security_version_at_issue: 1, revoked_at: null,
        expires_at: new Date(Date.now() + 60_000),
        user: { id, role: id.startsWith("driver") ? "driver" : "passenger", account_status: "active", security_version: 1, email_verified_at: new Date() } };
    });
    db.authSession.update.mockResolvedValue({});
    db.passengerRequest.create.mockImplementation(async ({ data }) => {
      const row = { id: `request_${++nextId}`, created_at: new Date(), ...data };
      rows.push(row); return row;
    });
    db.passengerRequest.findFirst.mockImplementation(async ({ where }) => rows.find(row =>
      row.id === where.id && row.passenger_id === where.passenger_id) ?? null);
    db.$queryRaw.mockResolvedValue([]);
    db.driverProfile.findUnique.mockImplementation(async ({ where }) => ({ id: `profile_${where.user_id}` }));
    db.driverRoute.create.mockImplementation(async ({ data }) => {
      const row = { id: `route_${++nextId}`, ...data }; driverRoutes.push(row); return row;
    });
    db.driverRoute.findFirst.mockImplementation(async ({ where }) => driverRoutes.find(row =>
      where.id ? row.id === where.id && row.driver_id === `profile_${where.driver.user_id}`
        : row.driver_id === where.driver_id && where.status.in.includes(row.status)) ?? null);
    db.auditEvent.create.mockImplementation(async ({ data }) => { audits.push(data); return data; });
    db.idempotencyRecord.create.mockImplementation(async ({ data }) => {
      if (records.some(row => ["operation", "scope_digest", "idempotency_key", "key_version"].every(field => row[field] === data[field]))) {
        throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
      }
      const row = { id: `idempotency_${++nextId}`, state: "processing", claim_version: 1, ...data };
      records.push(row); return { ...row };
    });
    db.idempotencyRecord.findUniqueOrThrow.mockImplementation(async ({ where }) => {
      const scope = where.operation_scope_digest_idempotency_key_key_version;
      const row = records.find(row => scope ? Object.keys(scope).every(field => row[field] === scope[field]) : row.id === where.id);
      if (!row) throw new Error("missing idempotency fixture");
      return { ...row };
    });
    db.idempotencyRecord.updateMany.mockImplementation(async ({ where, data }) => {
      const row = records.find(row => row.id === where.id && row.claim_version === where.claim_version &&
        (!where.state || row.state === where.state) && (!where.expires_at || row.expires_at <= where.expires_at.lte));
      if (!row) return { count: 0 };
      Object.assign(row, data, data.claim_version ? { claim_version: row.claim_version + data.claim_version.increment } : {});
      return { count: 1 };
    });
    // Serial transaction fixture verifies commit/rollback semantics. Real MySQL races are tested separately.
    let tail = Promise.resolve();
    db.$transaction.mockImplementation((callback) => {
      const result = tail.then(async () => {
        const snapshot = structuredClone({ rows, records, audits, driverRoutes });
        try { return await callback(db); }
        catch (error) { ({ rows, records, audits, driverRoutes } = snapshot); throw error; }
      });
      tail = result.then(() => undefined, () => undefined);
      return result;
    });
  });

  it("rolls resource creation back if mandatory audit insertion fails, then safely retries", async () => {
    const payload = body();
    db.auditEvent.create.mockRejectedValueOnce(new Error("audit unavailable"));
    await create("passenger_1", payload, "audit-failure-key").expect(500);
    expect(rows).toHaveLength(0);
    expect(records).toHaveLength(0);
    await create("passenger_1", payload, "audit-failure-key").expect(201);
    expect(rows).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  it("replays the committed resource after the response is lost", async () => {
    const payload = body();
    const first = await create("passenger_1", payload, "lost-response-key").expect(201);
    const replay = await create("passenger_1", payload, "lost-response-key").expect(201);
    expect(replay.body.request.id).toBe(first.body.request.id);
    expect(rows).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  it("binds a key to exact payload while keeping different actors independent", async () => {
    const payload = body();
    const first = await create("passenger_1", payload, "actor-bound-key").expect(201);
    await create("passenger_1", { ...payload, passenger_count: 2 }, "actor-bound-key").expect(409);
    const other = await create("passenger_2", payload, "actor-bound-key").expect(201);
    expect(other.body.request.id).not.toBe(first.body.request.id);
    expect(rows).toHaveLength(2);
  });

  it("creates once for simultaneous same-key retries", async () => {
    const payload = body();
    const responses = await Promise.all(Array.from({ length: 4 }, () => create("passenger_1", payload, "concurrent-key")));
    expect(responses.every(response => response.status === 201)).toBe(true);
    expect(new Set(responses.map(response => response.body.request.id)).size).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it("retains completed booking identity after the claim retention timestamp", async () => {
    const payload = body();
    const first = await create("passenger_1", payload, "retained-booking-key").expect(201);
    expect(records).toHaveLength(1);
    records[0]!.expires_at = new Date(0);
    const replay = await create("passenger_1", payload, "retained-booking-key").expect(201);
    expect(replay.body.request.id).toBe(first.body.request.id);
    await create("passenger_1", { ...payload, passenger_count: 2 }, "retained-booking-key").expect(409);
    expect(rows).toHaveLength(1);
  });

  it("keeps legacy no-header clients compatible while auditing atomically", async () => {
    await create("passenger_1", body()).expect(201);
    expect(rows).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("recovers keyed driver creation after capacity reservation, completion and retention expiry", async () => {
    const payload = { seats_available: 2, parcel_capacity_available: 5 };
    const first = await createDriver("driver_1", payload, "durable-driver-route-key").expect(201);
    driverRoutes[0]!.seats_available = 1;
    const reserved = await createDriver("driver_1", payload, "durable-driver-route-key").expect(201);
    expect(reserved.body.route.id).toBe(first.body.route.id);
    driverRoutes[0]!.status = "completed";
    records[0]!.expires_at = new Date(0);
    const completed = await createDriver("driver_1", payload, "durable-driver-route-key").expect(201);
    expect(completed.body.route.id).toBe(first.body.route.id);
    expect(driverRoutes).toHaveLength(1);
    expect(audits).toHaveLength(1);
    await createDriver("driver_1", { ...payload, seats_available: 3 }, "durable-driver-route-key").expect(409);
  });

  it("isolates durable driver keys by actor and collapses concurrent retries", async () => {
    const payload = { seats_available: 2, parcel_capacity_available: 5 };
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => createDriver("driver_1", payload, "concurrent-driver-key")));
    expect(concurrent.every(response => response.status === 201)).toBe(true);
    expect(new Set(concurrent.map(response => response.body.route.id)).size).toBe(1);
    const other = await createDriver("driver_2", payload, "concurrent-driver-key").expect(201);
    expect(other.body.route.id).not.toBe(concurrent[0]!.body.route.id);
    expect(driverRoutes).toHaveLength(2);
    expect(records).toHaveLength(2);
  });

  it("rolls keyed driver creation and its claim back on audit failure", async () => {
    const payload = { seats_available: 2, parcel_capacity_available: 5 };
    db.auditEvent.create.mockRejectedValueOnce(new Error("audit unavailable"));
    await createDriver("driver_1", payload, "driver-audit-failure-key").expect(500);
    expect(driverRoutes).toHaveLength(0);
    expect(records).toHaveLength(0);
    await createDriver("driver_1", payload, "driver-audit-failure-key").expect(201);
    expect(driverRoutes).toHaveLength(1);
    expect(records).toHaveLength(1);
  });
});
