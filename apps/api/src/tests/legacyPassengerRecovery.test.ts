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
  serviceRoute: { findUnique: vi.fn() },
  routeFare: { findMany: vi.fn(async () => []) },
}));
vi.mock("../lib/prisma.js", () => ({ prisma: db }));
const { createApp } = await import("../app.js");
const { findOperatingRoute, HEBRON_TO_BETHLEHEM } = await import("./operatingRouteFixture.js");

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
    // Coordinate bodies ride the predefined Hebron → Bethlehem route.
    db.serviceRoute.findUnique.mockImplementation(findOperatingRoute());
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

  it("persists and returns the place names together with their coordinates", async () => {
    const payload = { ...body(), pickup_label: "جامعة بوليتكنك فلسطين", destination_label: "Selected place" };
    const response = await create("passenger_names", payload, "names-key-1");
    expect(response.status).toBe(201);
    expect(response.body.request).toMatchObject({
      pickup_label: "جامعة بوليتكنك فلسطين", pickup_lat: "31.532600", pickup_lng: "35.099800",
      destination_label: "Selected place", destination_lat: "31.705400", destination_lng: "35.202400",
    });
    expect(rows[0]).toMatchObject({ pickup_label: "جامعة بوليتكنك فلسطين", destination_label: "Selected place" });
  });

  describe("selected driver route", () => {
    let selectable: Set<string>;
    beforeEach(() => {
      selectable = new Set(["route_selected"]);
      // Selection lookups carry the matching supply filter; driver-owned lookups do not.
      const ownedLookup = db.driverRoute.findFirst.getMockImplementation()!;
      db.driverRoute.findFirst.mockImplementation(async (args) => args.where.driver?.verified
        ? (selectable.has(args.where.id) ? { id: args.where.id } : null)
        : ownedLookup(args));
    });

    it("saves the pick on the request and returns it", async () => {
      const response = await create("passenger_1", { ...body(), selected_driver_route_id: "route_selected" }, "pin-key-1").expect(201);
      expect(response.body.request.selected_driver_route_id).toBe("route_selected");
      expect(rows[0]).toMatchObject({ selected_driver_route_id: "route_selected" });
      expect(db.driverRoute.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          id: "route_selected", status: "active", operational_mode: "legacy", canonical_availability_version: null,
          seats_available: { gte: 1 }, driver: { verified: true, user: { role: "driver", account_status: "active" } },
        }),
      }));
    });

    it("returns null for a request without a pick", async () => {
      const response = await create("passenger_1", body(), "pin-key-2").expect(201);
      expect(response.body.request.selected_driver_route_id).toBeNull();
    });

    it("saves nothing when the picked route is unavailable", async () => {
      const response = await create("passenger_1", { ...body(), selected_driver_route_id: "route_gone" }, "pin-key-3").expect(409);
      expect(response.body.error).toBe("selected_driver_route_unavailable");
      expect(rows).toHaveLength(0);
      expect(records).toHaveLength(0);
      expect(audits).toHaveLength(0);
    });

    it("replays the committed pick and binds the key to it", async () => {
      const payload = { ...body(), selected_driver_route_id: "route_selected" };
      const first = await create("passenger_1", payload, "pin-key-4").expect(201);
      // A replay returns the saved row even after the route stops being selectable.
      selectable.clear();
      const replay = await create("passenger_1", payload, "pin-key-4").expect(201);
      expect(replay.body.request).toMatchObject({ id: first.body.request.id, selected_driver_route_id: "route_selected" });
      selectable.add("route_other");
      await create("passenger_1", { ...payload, selected_driver_route_id: "route_other" }, "pin-key-4").expect(409);
      const { selected_driver_route_id: _pick, ...unpinned } = payload;
      await create("passenger_1", unpinned, "pin-key-4").expect(409);
      expect(rows).toHaveLength(1);
    });
  });

  it("rejects a request without a place name instead of saving bare coordinates", async () => {
    const response = await create("passenger_noname", { ...body(), pickup_label: "" }, "names-key-2");
    expect(response.status).toBe(400);
    expect(rows).toHaveLength(0);
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

  it("rejects a past departure with a clear code and leaves no reservation, claim or audit behind", async () => {
    const past = { ...body(), preferred_time: new Date(Date.now() - 60_000).toISOString() };
    const response = await create("passenger_1", past, "past-trip-key").expect(400);
    expect(response.body.error).toBe("preferred_time_in_past");
    expect(rows).toHaveLength(0);
    expect(records).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("treats the exact departure instant as expired and the next millisecond as bookable", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const now = new Date("2030-06-01T10:00:00.000Z"); // 13:00 in Asia/Hebron (UTC+3); instants are zone-independent
      vi.setSystemTime(now);
      const exact = await create("passenger_1", { ...body(), preferred_time: now.toISOString() }, "boundary-exact").expect(400);
      expect(exact.body.error).toBe("preferred_time_in_past");
      await create("passenger_1", { ...body(), preferred_time: new Date(now.getTime() + 1).toISOString() }, "boundary-next").expect(201);
      expect(rows).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  it("still replays the committed booking after its departure time has passed, without a second reservation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-06-01T10:00:00.000Z"));
      const payload = { ...body(), preferred_time: "2030-06-01T10:30:00.000Z" };
      const first = await create("passenger_1", payload, "late-replay-key").expect(201);
      vi.setSystemTime(new Date("2030-06-01T11:00:00.000Z"));
      const replay = await create("passenger_1", payload, "late-replay-key").expect(201);
      expect(replay.body.request.id).toBe(first.body.request.id);
      expect(rows).toHaveLength(1);
      // A fresh key for the same expired time is a new booking attempt and must be refused.
      await create("passenger_1", payload, "late-new-key").expect(400);
      expect(rows).toHaveLength(1);
    } finally { vi.useRealTimers(); }
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
    const payload = { service_route_id: HEBRON_TO_BETHLEHEM.id, seats_available: 2, parcel_capacity_available: 5 };
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
    const payload = { service_route_id: HEBRON_TO_BETHLEHEM.id, seats_available: 2, parcel_capacity_available: 5 };
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => createDriver("driver_1", payload, "concurrent-driver-key")));
    expect(concurrent.every(response => response.status === 201)).toBe(true);
    expect(new Set(concurrent.map(response => response.body.route.id)).size).toBe(1);
    const other = await createDriver("driver_2", payload, "concurrent-driver-key").expect(201);
    expect(other.body.route.id).not.toBe(concurrent[0]!.body.route.id);
    expect(driverRoutes).toHaveLength(2);
    expect(records).toHaveLength(2);
  });

  it("rolls keyed driver creation and its claim back on audit failure", async () => {
    const payload = { service_route_id: HEBRON_TO_BETHLEHEM.id, seats_available: 2, parcel_capacity_available: 5 };
    db.auditEvent.create.mockRejectedValueOnce(new Error("audit unavailable"));
    await createDriver("driver_1", payload, "driver-audit-failure-key").expect(500);
    expect(driverRoutes).toHaveLength(0);
    expect(records).toHaveLength(0);
    await createDriver("driver_1", payload, "driver-audit-failure-key").expect(201);
    expect(driverRoutes).toHaveLength(1);
    expect(records).toHaveLength(1);
  });
});
