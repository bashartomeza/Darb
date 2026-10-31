import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../generated/prisma/client.js";

type Store = Map<string, { id: string; state: string; request_digest: string; claim_version: number; resource_type: string | null; resource_id: string | null; expires_at: Date }>;
const state = vi.hoisted(() => ({ records: new Map() as unknown as Store, orders: new Map<string, unknown>(), counter: 0, allowed: true }));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  idempotencyRecord: { create: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  merchantOrder: { create: vi.fn(), findFirst: vi.fn() },
  deliveryHandover: { findUnique: vi.fn(), create: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../lib/abuseCounters.js", () => ({
  consumeAbuseCounter: vi.fn(async () => ({ allowed: state.allowed, count: 1, remaining: 0, retryAfterSeconds: 120 }))
}));

const { createApp } = await import("../app.js");
const { consumeAbuseCounter } = await import("../lib/abuseCounters.js");

const merchant = { id: "merchant_1", role: "merchant", name: "M", phone: "+5", demo_account: true };
const driver = { id: "driver_1", role: "driver", name: "D", phone: "+3", demo_account: true };
const users: Record<string, typeof merchant> = { merchant_1: merchant, driver_1: driver };

function auth(id: string) {
  const token = jwt.sign({ role: users[id]!.role, sid: `session_${id}`, ver: 1 }, "test-only-jwt-secret-with-at-least-thirty-two-characters", {
    subject: id,
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

const HEADER = "pickup_label,pickup_lat,pickup_lng,destination_label,destination_lat,destination_lng,size,priority";
const good = (name: string, lat = 31.7054) => `Hebron Depot,31.5326,35.0998,${name},${lat},35.2024,S,normal`;

function p2002() {
  return new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" });
}

describe("merchant bulk orders API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.records.clear();
    state.orders.clear();
    state.counter = 0;
    state.allowed = true;
    prismaMock.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const user = users[where.id];
      return user ? { ...user, account_status: "active", security_version: 1 } : null;
    });
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const user = users[where.id.replace(/^session_/, "")];
      return user
        ? { id: where.id, user_id: user.id, user: { email_verified_at: new Date(), ...user, account_status: "active", security_version: 1 }, security_version_at_issue: 1, expires_at: new Date(Date.now() + 60_000), revoked_at: null }
        : null;
    });
    prismaMock.authSession.update.mockResolvedValue({});
    prismaMock.auditEvent.create.mockResolvedValue({ id: "audit" });
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.idempotencyRecord.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      const key = `${data.operation}|${data.scope_digest}|${data.idempotency_key}`;
      if (state.records.has(key)) throw p2002();
      const record = { id: key, state: "processing", request_digest: String(data.request_digest), claim_version: 1, resource_type: null, resource_id: null, expires_at: data.expires_at as Date };
      state.records.set(key, record);
      return record;
    });
    prismaMock.idempotencyRecord.findUniqueOrThrow.mockImplementation(({ where }: { where: Record<string, Record<string, string>> & { id?: string } }) => {
      if (where.id) return [...state.records.values()].find((record) => record.id === where.id);
      const k = where.operation_scope_digest_idempotency_key_key_version!;
      return state.records.get(`${k.operation}|${k.scope_digest}|${k.idempotency_key}`);
    });
    prismaMock.idempotencyRecord.updateMany.mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const record = state.records.get(where.id)!;
      Object.assign(record, data);
      return { count: 1 };
    });
    prismaMock.merchantOrder.create.mockImplementation(({ data }: { data: { merchant_id: string; parcels: { create: unknown[] } } }) => {
      state.counter += 1;
      const order = { id: `order_${state.counter}`, merchant_id: data.merchant_id, status: "submitted", parcels: data.parcels.create };
      state.orders.set(order.id, order);
      return order;
    });
    prismaMock.deliveryHandover.findUnique.mockResolvedValue(null);
    prismaMock.deliveryHandover.create.mockResolvedValue({});
    prismaMock.merchantOrder.findFirst.mockImplementation(({ where }: { where: { id: string } }) => state.orders.get(where.id) ?? null);
  });

  const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");
  const post = (body: unknown, key: string | null = "upload-key-0001", who = "merchant_1") => {
    const req = request(createApp()).post("/api/v1/merchant/orders/bulk").set(auth(who));
    return (key ? req.set("Idempotency-Key", key) : req).send(body as object);
  };

  it("creates every valid order through the existing creation path", async () => {
    const res = await post({ csv: csv(good("A"), good("B", 31.71)) }).expect(201);
    expect(res.body.summary).toEqual({ total_rows: 2, created: 2, replayed: 0, failed: 0 });
    expect(prismaMock.merchantOrder.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.auditEvent.create).toHaveBeenCalled();
  });

  it("a retry with the same key replays and never double-creates", async () => {
    const body = { csv: csv(good("A"), good("B", 31.71)) };
    const first = await post(body).expect(201);
    const retry = await post(body).expect(200);
    expect(retry.body.summary).toEqual({ total_rows: 2, created: 0, replayed: 2, failed: 0 });
    expect(prismaMock.merchantOrder.create).toHaveBeenCalledTimes(2);
    expect(retry.body.results.map((r: { order_id: string }) => r.order_id)).toEqual(first.body.results.map((r: { order_id: string }) => r.order_id));
  });

  it("an edited row creates fresh while unedited rows replay", async () => {
    await post({ csv: csv(good("A"), good("B", 31.71)) }).expect(201);
    const retry = await post({ csv: csv(good("A"), good("B-fixed", 31.72)) }).expect(201);
    expect(retry.body.summary).toMatchObject({ created: 1, replayed: 1 });
  });

  it("requires an idempotency key", async () => {
    const res = await post({ csv: csv(good("A")) }, null).expect(400);
    expect(res.body.error).toBe("idempotency_key_required");
    expect(prismaMock.merchantOrder.create).not.toHaveBeenCalled();
  });

  it("rejects the whole upload on row errors unless skip_invalid is set, with EN and AR messages", async () => {
    const body = { csv: csv(good("A"), "Hebron Depot,31.5,35.1,,31.7,35.2,Q,normal") };
    const rejected = await post(body).expect(400);
    expect(rejected.body.error).toBe("bulk_validation_failed");
    expect(rejected.body.errors[0].message_en).toBeTruthy();
    expect(rejected.body.errors[0].message_ar).toMatch(/[؀-ۿ]/);
    expect(prismaMock.merchantOrder.create).not.toHaveBeenCalled();

    const partial = await post({ ...body, skip_invalid: true }, "upload-key-0002").expect(201);
    expect(partial.body.summary).toEqual({ total_rows: 2, created: 1, replayed: 0, failed: 2 });
    expect(partial.body.results.filter((r: { status: string }) => r.status === "invalid").map((r: { rows: number[] }) => r.rows[0])).toEqual([3, 3]);
  });

  it("reports a failing order without losing the others", async () => {
    let calls = 0;
    const original = prismaMock.merchantOrder.create.getMockImplementation()!;
    prismaMock.merchantOrder.create.mockImplementation((args: never) => {
      calls += 1;
      if (calls === 2) throw new Error("db down");
      return original(args);
    });
    const res = await post({ csv: csv(good("A"), good("B", 31.71), good("C", 31.72)) }).expect(201);
    expect(res.body.summary).toMatchObject({ created: 2, failed: 1 });
    const failed = res.body.results.find((r: { status: string }) => r.status === "failed");
    expect(failed.rows).toEqual([3]);
    expect(failed.message_ar).toMatch(/[؀-ۿ]/);
    expect(JSON.stringify(res.body)).not.toContain("db down");
  });

  it("rejects more than 50 rows", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => good(`P${index}`));
    const res = await post({ csv: csv(...rows) }).expect(400);
    expect(res.body.errors[0].code).toBe("csv_too_many_rows");
    expect(prismaMock.merchantOrder.create).not.toHaveBeenCalled();
  });

  it("accepts 50 rows", async () => {
    const rows = Array.from({ length: 50 }, (_, index) => good(`P${index}`, 31.7 + index / 10000));
    const res = await post({ csv: csv(...rows) }).expect(201);
    expect(res.body.summary.created).toBe(50);
  });

  it("applies the per-merchant abuse limit", async () => {
    state.allowed = false;
    const res = await post({ csv: csv(good("A")) }).expect(429);
    expect(res.body.error).toBe("bulk_rate_limit_exceeded");
    expect(res.headers["retry-after"]).toBe("120");
    expect(consumeAbuseCounter).toHaveBeenCalled();
    expect(prismaMock.merchantOrder.create).not.toHaveBeenCalled();
  });

  it("single-order creation accepts up to 50 parcels and rejects 51", async () => {
    const parcel = { destination_label: "Bethlehem", destination_lat: 31.7, destination_lng: 35.2, size: "S", priority: "normal" };
    const send = (count: number) =>
      request(createApp()).post("/api/v1/merchant/orders").set(auth("merchant_1")).send({
        pickup_label: "Hebron",
        pickup_lat: 31.5,
        pickup_lng: 35.1,
        parcels: Array.from({ length: count }, () => parcel)
      });
    await send(50).expect(201);
    await send(51).expect(400);
  });

  it("only merchants may upload", async () => {
    await post({ csv: csv(good("A")) }, "upload-key-0001", "driver_1").expect(403);
  });

  it("preview validates and plans groups without writing", async () => {
    const rows = [good("A"), good("B", 31.7155), "Hebron Depot,31.5326,35.0998,Ramallah,31.9038,35.2034,M,high", "Hebron Depot,31.5,35.1,,31.7,35.2,S,normal"];
    const res = await request(createApp()).post("/api/v1/merchant/orders/bulk/preview").set(auth("merchant_1")).send({ csv: csv(...rows) }).expect(200);
    expect(res.body).toMatchObject({ total_rows: 4, valid_order_count: 3, error_count: 1 });
    expect(res.body.batch_plan.batches).toHaveLength(2);
    expect(res.body.errors[0]).toMatchObject({ row: 5, field: "destination_label" });
    expect(prismaMock.merchantOrder.create).not.toHaveBeenCalled();
    expect(prismaMock.idempotencyRecord.create).not.toHaveBeenCalled();
  });
});
