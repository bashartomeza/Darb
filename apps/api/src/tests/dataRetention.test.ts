import { describe, expect, it } from "vitest";
import { purgeLocationEvents } from "../services/dataRetention.js";
import { purgeExpiredData } from "../services/expiredDataRetention.js";

const DAY = 86_400_000;
const NOW = new Date("2026-11-20T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

type Row = Record<string, any>;

/** Evaluates the small subset of Prisma `where` the purge queries use. */
function matches(row: Row, where: Row | undefined, db: Fake): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Row[]).some((c) => matches(row, c, db));
    if (key === "AND") return (cond as Row[]).every((c) => matches(row, c, db));
    if (key === "NOT") return !matches(row, cond, db);
    if (key === "trip") return matches(db.trips.find((t) => t.id === row.trip_id) ?? {}, cond, db);
    if (key === "location_events") return db.events.some((e) => e.trip_id === row.id && matches(e, cond.some, db));
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date || typeof cond !== "object") return value === cond;
    return Object.entries(cond as Row).every(([op, arg]) => {
      if (op === "lt") return value instanceof Date && value < (arg as Date);
      if (op === "not") return arg === null ? value != null : value !== arg;
      if (op === "in") return (arg as unknown[]).includes(value);
      throw new Error(`unsupported operator ${op}`);
    });
  });
}

class Fake {
  trips: Row[] = [];
  events: Row[] = [];
  tables: Record<string, Row[]> = {};
  findCalls: number[] = [];
  deleteCalls: number[] = [];

  private table(name: string, rows: () => Row[], set: (r: Row[]) => void, sortKey?: string) {
    return {
      findMany: async ({ where, take, orderBy }: Row) => {
        this.findCalls.push(take);
        let found = rows().filter((r) => matches(r, where, this));
        const key = orderBy ? Object.keys(orderBy)[0] : sortKey;
        const dir = orderBy ? Object.values(orderBy)[0] : "asc";
        if (key) found = [...found].sort((a, b) => (a[key] > b[key] ? 1 : -1) * (dir === "desc" ? -1 : 1));
        return found.slice(0, take);
      },
      findFirst: async ({ where, orderBy }: Row) => {
        const key = Object.keys(orderBy)[0];
        const found = rows().filter((r) => matches(r, where, this)).sort((a, b) => b[key] - a[key]);
        return found[0] ?? null;
      },
      deleteMany: async ({ where }: Row) => {
        const before = rows().length;
        set(rows().filter((r) => !matches(r, where, this)));
        const count = before - rows().length;
        this.deleteCalls.push(count);
        return { count };
      }
    };
  }

  get db() {
    const generic = (name: string) => this.table(name, () => (this.tables[name] ??= []), (r) => (this.tables[name] = r));
    return {
      locationEvent: this.table("events", () => this.events, (r) => (this.events = r)),
      trip: { findMany: async ({ where, take }: Row) => this.trips.filter((t) => matches(t, where, this)).slice(0, take) },
      refreshToken: generic("refreshToken"),
      authSession: generic("authSession"),
      authActionToken: generic("authActionToken"),
      idempotencyRecord: generic("idempotencyRecord"),
      abuseCounter: generic("abuseCounter"),
      pushDevice: generic("pushDevice"),
      notification: generic("notification")
    } as never;
  }
}

function fixture() {
  const fake = new Fake();
  fake.trips = [
    { id: "done_old", status: "completed", completed_at: ago(10), created_at: ago(11) },
    { id: "done_today", status: "completed", completed_at: ago(0.2), created_at: ago(1) },
    { id: "running", status: "in_transit", completed_at: null, created_at: ago(60) },
    { id: "accepted", status: "accepted", completed_at: null, created_at: ago(60) },
    { id: "cancelled_old", status: "cancelled", completed_at: null, created_at: ago(50) }
  ];
  let id = 0;
  const point = (trip_id: string, sequence: number, days: number) => fake.events.push({ id: `e${(id += 1)}`, trip_id, sequence, recorded_at: ago(days) });
  for (let i = 1; i <= 5; i += 1) point("done_old", i, 40 - i); // all older than 30 d
  point("done_old", 6, 29.9); // inside the window: kept
  for (let i = 1; i <= 3; i += 1) point("done_today", i, 35 - i); // old points, trip ended 5 h ago
  point("running", 1, 45);
  point("accepted", 1, 45);
  point("cancelled_old", 1, 45);
  return fake;
}

describe("purgeLocationEvents", () => {
  it("deletes old points of finished trips only, keeping the window and running trips", async () => {
    const fake = fixture();
    const { deleted } = await purgeLocationEvents(fake.db, { retentionDays: 30, now: NOW });
    expect(deleted).toBe(5 + 2 + 1); // done_old 1-5, done_today 1-2 (latest kept), cancelled_old
    const left = fake.events.map((e) => `${e.trip_id}:${e.sequence}`).sort();
    expect(left).toEqual(["accepted:1", "done_old:6", "done_today:3", "running:1"]);
  });

  it("keeps the latest point of a trip for 24 hours after it ends, then drops it", async () => {
    const fake = fixture();
    await purgeLocationEvents(fake.db, { retentionDays: 30, now: NOW });
    expect(fake.events.some((e) => e.trip_id === "done_today")).toBe(true);
    // Two days later the trip ended more than 24 h ago and the point is past retention.
    await purgeLocationEvents(fake.db, { retentionDays: 30, now: new Date(NOW.getTime() + 2 * DAY) });
    expect(fake.events.some((e) => e.trip_id === "done_today")).toBe(false);
  });

  it("treats the retention boundary as exclusive and is repeatable", async () => {
    const fake = new Fake();
    fake.trips = [{ id: "t", status: "completed", completed_at: ago(40), created_at: ago(41) }];
    fake.events = [
      { id: "old", trip_id: "t", sequence: 1, recorded_at: new Date(ago(30).getTime() - 1) },
      { id: "edge", trip_id: "t", sequence: 2, recorded_at: ago(30) }
    ];
    expect((await purgeLocationEvents(fake.db, { retentionDays: 30, now: NOW })).deleted).toBe(1);
    expect(fake.events.map((e) => e.id)).toEqual(["edge"]);
    expect((await purgeLocationEvents(fake.db, { retentionDays: 30, now: NOW })).deleted).toBe(0);
  });

  it("deletes in bounded batches and stops at the batch cap", async () => {
    const fake = new Fake();
    fake.trips = [{ id: "t", status: "completed", completed_at: ago(40), created_at: ago(41) }];
    for (let i = 1; i <= 25; i += 1) fake.events.push({ id: `p${i}`, trip_id: "t", sequence: i, recorded_at: ago(35) });
    const capped = await purgeLocationEvents(fake.db, { retentionDays: 30, now: NOW, batchSize: 10, maxBatches: 2 });
    expect(capped.deleted).toBe(20);
    expect(Math.max(...fake.deleteCalls)).toBeLessThanOrEqual(10);
    expect((await purgeLocationEvents(fake.db, { retentionDays: 30, now: NOW, batchSize: 10 })).deleted).toBe(5);
    expect(fake.events).toHaveLength(0);
  });
});

describe("purgeExpiredData", () => {
  const windows = { sessionDays: 30, authTokenDays: 7, idempotencyDays: 7, abuseCounterDays: 1, pushDeviceDays: 30, notificationDays: 180 };

  it("removes only rows past their window and keeps completed idempotency claims", async () => {
    const fake = new Fake();
    fake.tables = {
      authSession: [
        { id: "s_expired_old", expires_at: ago(31), revoked_at: null },
        { id: "s_revoked_old", expires_at: ago(-5), revoked_at: ago(31) },
        { id: "s_expired_recent", expires_at: ago(2), revoked_at: null },
        { id: "s_active", expires_at: ago(-5), revoked_at: null }
      ],
      refreshToken: [{ id: "r_old", expires_at: ago(40), revoked_at: null }, { id: "r_live", expires_at: ago(-1), revoked_at: null }],
      authActionToken: [
        { id: "t_expired", expires_at: ago(8), consumed_at: null },
        { id: "t_consumed", expires_at: ago(-1), consumed_at: ago(8) },
        { id: "t_fresh", expires_at: ago(-1), consumed_at: null }
      ],
      idempotencyRecord: [
        { id: "i_failed", expires_at: ago(8), state: "failed" },
        { id: "i_done", expires_at: ago(80), state: "completed" },
        { id: "i_recent", expires_at: ago(2), state: "processing" }
      ],
      abuseCounter: [{ id: "a_old", expires_at: ago(2) }, { id: "a_live", expires_at: ago(-1) }],
      pushDevice: [{ id: "d_old", revoked_at: ago(31) }, { id: "d_recent", revoked_at: ago(3) }, { id: "d_active", revoked_at: null }],
      notification: [{ id: "n_old", created_at: ago(181) }, { id: "n_new", created_at: ago(10) }]
    };
    const { deleted, errors } = await purgeExpiredData(fake.db, windows, { now: NOW });
    expect(errors).toEqual([]);
    expect(deleted).toMatchObject({ refreshTokens: 1, authSessions: 2, authActionTokens: 2, idempotencyRecords: 1, abuseCounters: 1, pushDevices: 1, notifications: 1 });
    const ids = (name: string) => fake.tables[name].map((r) => r.id).sort();
    expect(ids("authSession")).toEqual(["s_active", "s_expired_recent"]);
    expect(ids("idempotencyRecord")).toEqual(["i_done", "i_recent"]);
    expect(ids("pushDevice")).toEqual(["d_active", "d_recent"]);
  });

  it("keeps going when one purge fails", async () => {
    const fake = new Fake();
    fake.tables = { notification: [{ id: "n_old", created_at: ago(181) }] };
    const db = fake.db as unknown as Record<string, unknown>;
    db.authSession = { findMany: async () => { throw new Error("boom"); }, deleteMany: async () => ({ count: 0 }) };
    const { deleted, errors } = await purgeExpiredData(db as never, windows, { now: NOW });
    expect(errors).toEqual(["authSessions: boom"]);
    expect(deleted.notifications).toBe(1);
  });
});
