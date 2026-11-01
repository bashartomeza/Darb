import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { MatchStatus, ParcelBatchStatus } from "../generated/prisma/enums.js";
import { HttpError } from "../middleware/error.js";
import { parseMatchQuery } from "../services/adminMatchingMonitoring/contracts.js";
import { batchSelect, eligibleBatch, eligibleMatch, eligibleOrder, eligibleParcel, eligiblePassenger, matchSelect, parcelSelect } from "../services/adminMatchingMonitoring/policy.js";
import { createMonitoringService } from "../services/adminMatchingMonitoring/service.js";

const now = new Date("2026-09-10T12:00:00.000Z");
const range = { from: "2026-09-03T12:00:00.000Z", until: now.toISOString() };

const combinedMatch: Prisma.MatchGetPayload<{ select: typeof matchSelect }> = {
  id: "match_1",
  status: "accepted",
  created_at: new Date("2026-09-09T10:00:00.000Z"),
  score: new Prisma.Decimal("0.8750"),
  method: "darb_route_score",
  driver_route: { id: "route_1", status: "completed" },
  passenger_request: { id: "request_1", status: "delivered", passenger_count: 2 },
  merchant_order: { id: "order_1", status: "completed", _count: { parcels: 3 } },
  parcel_batch: { id: "batch_1", status: "delivered" }
};

const nullRouteBatch: Prisma.ParcelBatchGetPayload<{ select: typeof batchSelect }> = {
  id: "batch_2",
  status: "created",
  created_at: new Date("2026-09-08T09:00:00.000Z"),
  merchant_order: { id: "order_2", status: "submitted", _count: { parcels: 1 } },
  driver_route: null
};

function database() {
  const mutation = vi.fn(() => { throw new Error("domain mutation attempted"); });
  const tx = {
    passengerRequest: { count: vi.fn() },
    merchantOrder: { count: vi.fn() },
    match: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn(), create: mutation, update: mutation, delete: mutation },
    parcelBatch: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn(), create: mutation, update: mutation, delete: mutation },
    parcel: { findMany: vi.fn(), count: vi.fn(), create: mutation, update: mutation, delete: mutation },
    trip: { findMany: vi.fn(() => { throw new Error("Trip queried"); }) },
    canonicalDemandDispatch: { findMany: vi.fn(() => { throw new Error("canonical queried"); }) },
    $executeRaw: mutation
  };
  const db = {
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx))
  };
  return { tx, db: db as unknown as PrismaClient, transaction: db.$transaction, mutation };
}

describe("admin matching monitoring service", () => {
  it("serializes combined match pages through one bounded repeatable-read observation", async () => {
    const { db, tx, transaction, mutation } = database();
    tx.match.findMany.mockResolvedValue([combinedMatch]);
    tx.match.count.mockResolvedValue(1);

    const result = await createMonitoringService(db, () => now).matches(parseMatchQuery({}, now));

    expect(result).toEqual({
      observed_at: now.toISOString(),
      scope: "production_supported_legacy",
      data: {
        items: [{
          id: "match_1", status: "accepted", created_at: "2026-09-09T10:00:00.000Z",
          score: "0.875", method: "darb_route_score", demand_kind: "combined",
          driver_route: { id: "route_1", status: "completed" },
          passenger_request: { id: "request_1", status: "delivered", passenger_count: 2 },
          merchant_order: { id: "order_1", status: "completed", parcel_count: 3 },
          parcel_batch: { id: "batch_1", status: "delivered" }
        }],
        page: 1, limit: 25, total: 1, has_more: false, range
      }
    });
    expect(tx.match.findMany).toHaveBeenCalledWith({
      where: { AND: [eligibleMatch, { created_at: { gte: new Date(range.from), lt: new Date(range.until) } }] },
      select: matchSelect,
      orderBy: [{ created_at: "desc" }, { id: "desc" }], skip: 0, take: 25
    });
    expect(tx.match.count).toHaveBeenCalledWith({ where: { AND: [eligibleMatch, { created_at: { gte: new Date(range.from), lt: new Date(range.until) } }] } });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 10_000 });
    expect(mutation).not.toHaveBeenCalled();
    expect(tx.trip.findMany).not.toHaveBeenCalled();
    expect(tx.canonicalDemandDispatch.findMany).not.toHaveBeenCalled();
  });

  it("builds exact match filters without replacing eligibility", async () => {
    const { db, tx } = database();
    tx.match.findMany.mockResolvedValue([]);
    tx.match.count.mockResolvedValue(0);
    await createMonitoringService(db, () => now).matches({ ...range, page: 2, limit: 10, status: "rejected", demand_kind: "merchant_only", search: "order_1" });
    const filters: Prisma.MatchWhereInput = {
      created_at: { gte: new Date(range.from), lt: new Date(range.until) },
      status: "rejected",
      passenger_request_id: null,
      merchant_order_id: { not: null },
      OR: [
        { id: "order_1" }, { driver_route_id: "order_1" }, { passenger_request_id: "order_1" },
        { merchant_order_id: "order_1" }, { parcel_batch_id: "order_1" }
      ]
    };
    expect(tx.match.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [eligibleMatch, filters] }, skip: 10, take: 10 }));
  });

  it("maps unrecognized methods and hides excluded or missing matches as not found", async () => {
    const { db, tx } = database();
    tx.match.findFirst.mockResolvedValueOnce({ ...combinedMatch, method: "future_method" }).mockResolvedValueOnce(null);
    const service = createMonitoringService(db, () => now);
    await expect(service.match("match_1")).resolves.toMatchObject({ data: { method: "unrecognized" } });
    expect(tx.match.findFirst).toHaveBeenCalledWith({ where: { AND: [eligibleMatch, { id: "match_1" }] }, select: matchSelect });
    await expect(service.match("excluded_match")).rejects.toEqual(new HttpError(404, "not_found"));
  });

  it("zero-fills overview maps, excludes proposed from active, and keeps current-state counts outside the cohort", async () => {
    const { db, tx } = database();
    tx.passengerRequest.count.mockResolvedValue(4);
    tx.merchantOrder.count.mockResolvedValue(5);
    tx.match.groupBy.mockResolvedValue([{ status: "accepted", _count: { _all: 2 } }]);
    tx.parcelBatch.groupBy.mockResolvedValue([
      { status: "created", _count: { _all: 1 } }, { status: "proposed", _count: { _all: 9 } },
      { status: "assigned", _count: { _all: 2 } }, { status: "picked_up", _count: { _all: 3 } },
      { status: "in_transit", _count: { _all: 4 } }
    ]);
    const result = await createMonitoringService(db, () => now).overview(range);
    expect(result.data).toEqual({
      range, pending_passenger_requests: 4, submitted_merchant_orders: 5,
      match_results_by_status: { proposed: 0, sent_to_driver: 0, accepted: 2, rejected: 0, expired: 0, invalidated: 0 },
      batches_by_status: { created: 1, proposed: 9, assigned: 2, picked_up: 3, in_transit: 4, delivered: 0, cancelled: 0, failed: 0, expired: 0 },
      active_batches: 10,
      capabilities: { canonical_monitoring: "unavailable", failed_attempt_history: "not_recorded", completed_batches: "not_supported" }
    });
    expect(tx.passengerRequest.count).toHaveBeenCalledWith({ where: { AND: [eligiblePassenger, { status: "pending" }] } });
    expect(tx.merchantOrder.count).toHaveBeenCalledWith({ where: { AND: [eligibleOrder, { status: "submitted" }] } });
    expect(tx.match.groupBy).toHaveBeenCalledWith({ by: ["status"], where: { AND: [eligibleMatch, { created_at: { gte: new Date(range.from), lt: new Date(range.until) } }] }, _count: { _all: true } });
    expect(tx.parcelBatch.groupBy).toHaveBeenCalledWith({ by: ["status"], where: eligibleBatch, _count: { _all: true } });
    expect(Object.keys(result.data.match_results_by_status)).toEqual(Object.values(MatchStatus));
    expect(Object.keys(result.data.batches_by_status)).toEqual(Object.values(ParcelBatchStatus));
  });

  it("serializes batch pages with null routes and preserves order status mismatches", async () => {
    const { db, tx } = database();
    tx.parcelBatch.findMany.mockResolvedValue([nullRouteBatch]);
    tx.parcelBatch.count.mockResolvedValue(3);
    const result = await createMonitoringService(db, () => now).batches({ ...range, page: 1, limit: 2, status: "created", search: "order_2" });
    expect(result.data).toEqual({
      items: [{ id: "batch_2", status: "created", created_at: "2026-09-08T09:00:00.000Z", merchant_order: { id: "order_2", status: "submitted", parcel_count: 1 }, selected_driver_route: null }],
      page: 1, limit: 2, total: 3, has_more: true, range
    });
    expect(tx.parcelBatch.findMany).toHaveBeenCalledWith({
      where: { AND: [eligibleBatch, { created_at: { gte: new Date(range.from), lt: new Date(range.until) }, status: "created", OR: [{ id: "order_2" }, { merchant_order_id: "order_2" }, { driver_route_id: "order_2" }] }] },
      select: batchSelect, orderBy: [{ created_at: "desc" }, { id: "desc" }], skip: 0, take: 2
    });
  });

  it("authorizes the parent and pages only its current eligible order parcels", async () => {
    const { db, tx } = database();
    tx.parcelBatch.findFirst.mockResolvedValue(nullRouteBatch);
    tx.parcel.findMany.mockResolvedValue([{ id: "parcel_1", status: "pending" }]);
    tx.parcel.count.mockResolvedValue(2);
    const result = await createMonitoringService(db, () => now).parcels("batch_2", { page: 1, limit: 1 });
    expect(result.data).toEqual({
      items: [{ id: "parcel_1", status: "pending" }], page: 1, limit: 1, total: 2, has_more: true, range: null,
      contents_semantics: "current_eligible_order_contents", merchant_order_id: "order_2"
    });
    expect(tx.parcelBatch.findFirst).toHaveBeenCalledWith({ where: { AND: [eligibleBatch, { id: "batch_2" }] }, select: batchSelect });
    const parcelWhere: Prisma.ParcelWhereInput = { AND: [eligibleParcel, { order_id: "order_2" }] };
    expect(tx.parcel.findMany).toHaveBeenCalledWith({ where: parcelWhere, select: parcelSelect, orderBy: { id: "asc" }, skip: 0, take: 1 });
    expect(tx.parcel.count).toHaveBeenCalledWith({ where: parcelWhere });
  });

  it("returns identical not-found behavior for missing batch detail and member parents", async () => {
    const { db, tx } = database();
    tx.parcelBatch.findFirst.mockResolvedValue(null);
    const service = createMonitoringService(db, () => now);
    await expect(service.batch("excluded_batch")).rejects.toEqual(new HttpError(404, "not_found"));
    await expect(service.parcels("excluded_batch", { page: 1, limit: 25 })).rejects.toEqual(new HttpError(404, "not_found"));
    expect(tx.parcel.findMany).not.toHaveBeenCalled();
  });

  it("sanitizes recognized database unavailability without hiding programming failures", async () => {
    const { db, transaction } = database();
    const service = createMonitoringService(db, () => now);
    for (const code of ["P1001", "P1002", "P1017", "P2024", "P2028", "P2034"]) {
      transaction.mockRejectedValueOnce(Object.assign(new Error("secret database address"), { code }));
      await expect(service.overview(range)).rejects.toEqual(new HttpError(503, "monitoring_unavailable"));
    }
    transaction.mockRejectedValueOnce(new Error("serializer bug"));
    await expect(service.overview(range)).rejects.toThrow("serializer bug");
  });
});
