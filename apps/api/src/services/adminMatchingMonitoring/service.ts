import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { MatchStatus, ParcelBatchStatus } from "../../generated/prisma/enums.js";
import { HttpError } from "../../middleware/error.js";
import type {
  BatchQuery,
  BatchRow,
  CurrentOrderParcelsPage,
  MatchQuery,
  MatchRow,
  MonitoringService,
  Observed,
  Overview,
  Page,
  PageQuery,
  Range
} from "./contracts.js";
import {
  batchSelect,
  eligibleBatch,
  eligibleMatch,
  eligibleOrder,
  eligibleParcel,
  eligiblePassenger,
  matchSelect,
  parcelSelect
} from "./policy.js";

const transactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  maxWait: 5_000,
  // Large but bounded legacy datasets can require several seconds for the
  // eligibility joins and total-count query on the hosted MySQL runner.
  // Keep the read transaction bounded while avoiding a false 503 at 5s.
  timeout: 10_000
} as const;
const scope = "production_supported_legacy" as const;
const unavailableCodes = new Set(["P1001", "P1002", "P1017", "P2024", "P2028", "P2034"]);

type SelectedMatch = Prisma.MatchGetPayload<{ select: typeof matchSelect }>;
type SelectedBatch = Prisma.ParcelBatchGetPayload<{ select: typeof batchSelect }>;

function databaseCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function serializeMatch(row: SelectedMatch): MatchRow {
  const demandKind = row.passenger_request && row.merchant_order
    ? "combined"
    : row.passenger_request
      ? "passenger_only"
      : "merchant_only";
  return {
    id: row.id,
    status: row.status,
    created_at: row.created_at.toISOString(),
    score: row.score.toString(),
    method: row.method === "darb_route_score" ? "darb_route_score" : "unrecognized",
    demand_kind: demandKind,
    driver_route: row.driver_route,
    passenger_request: row.passenger_request,
    merchant_order: row.merchant_order
      ? { id: row.merchant_order.id, status: row.merchant_order.status, parcel_count: row.merchant_order._count.parcels }
      : null,
    parcel_batch: row.parcel_batch
  };
}

function serializeBatch(row: SelectedBatch): BatchRow {
  return {
    id: row.id,
    status: row.status,
    created_at: row.created_at.toISOString(),
    merchant_order: {
      id: row.merchant_order.id,
      status: row.merchant_order.status,
      parcel_count: row.merchant_order._count.parcels
    },
    selected_driver_route: row.driver_route
  };
}

function matchFilters(query: MatchQuery): Prisma.MatchWhereInput {
  const filters: Prisma.MatchWhereInput = {
    created_at: { gte: new Date(query.from), lt: new Date(query.until) }
  };
  if (query.status) filters.status = query.status;
  if (query.demand_kind === "passenger_only") {
    filters.passenger_request_id = { not: null };
    filters.merchant_order_id = null;
  } else if (query.demand_kind === "merchant_only") {
    filters.passenger_request_id = null;
    filters.merchant_order_id = { not: null };
  } else if (query.demand_kind === "combined") {
    filters.passenger_request_id = { not: null };
    filters.merchant_order_id = { not: null };
  }
  if (query.search) {
    filters.OR = [
      { id: query.search },
      { driver_route_id: query.search },
      { passenger_request_id: query.search },
      { merchant_order_id: query.search },
      { parcel_batch_id: query.search }
    ];
  }
  return filters;
}

function batchFilters(query: BatchQuery): Prisma.ParcelBatchWhereInput {
  const filters: Prisma.ParcelBatchWhereInput = {
    created_at: { gte: new Date(query.from), lt: new Date(query.until) }
  };
  if (query.status) filters.status = query.status;
  if (query.search) {
    filters.OR = [{ id: query.search }, { merchant_order_id: query.search }, { driver_route_id: query.search }];
  }
  return filters;
}

function pageData<T>(items: T[], query: PageQuery, total: number, range: Range | null) {
  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    has_more: query.page * query.limit < total,
    range
  };
}

export function createMonitoringService(db: PrismaClient, clock: () => Date = () => new Date()): MonitoringService {
  async function read<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<Observed<T>> {
    const observed_at = clock().toISOString();
    try {
      const data = await db.$transaction(operation, transactionOptions);
      return { observed_at, scope, data };
    } catch (error) {
      if (unavailableCodes.has(databaseCode(error) ?? "")) {
        throw new HttpError(503, "monitoring_unavailable");
      }
      throw error;
    }
  }

  return {
    async overview(query): Promise<Observed<Overview>> {
      return read(async (tx) => {
        const [pendingPassengers, submittedOrders, matchGroups, batchGroups] = await Promise.all([
          tx.passengerRequest.count({ where: { AND: [eligiblePassenger, { status: "pending" }] } }),
          tx.merchantOrder.count({ where: { AND: [eligibleOrder, { status: "submitted" }] } }),
          tx.match.groupBy({
            by: ["status"],
            where: { AND: [eligibleMatch, { created_at: { gte: new Date(query.from), lt: new Date(query.until) } }] },
            _count: { _all: true }
          }),
          tx.parcelBatch.groupBy({ by: ["status"], where: eligibleBatch, _count: { _all: true } })
        ]);
        const matchResults = Object.fromEntries(Object.values(MatchStatus).map((status) => [status, 0])) as Record<(typeof MatchStatus)[keyof typeof MatchStatus], number>;
        for (const group of matchGroups) matchResults[group.status] = group._count._all;
        const batchResults = Object.fromEntries(Object.values(ParcelBatchStatus).map((status) => [status, 0])) as Record<(typeof ParcelBatchStatus)[keyof typeof ParcelBatchStatus], number>;
        for (const group of batchGroups) batchResults[group.status] = group._count._all;
        return {
          range: query,
          pending_passenger_requests: pendingPassengers,
          submitted_merchant_orders: submittedOrders,
          match_results_by_status: matchResults,
          batches_by_status: batchResults,
          active_batches: batchResults.created + batchResults.assigned + batchResults.picked_up + batchResults.in_transit,
          capabilities: {
            canonical_monitoring: "unavailable",
            failed_attempt_history: "not_recorded",
            completed_batches: "not_supported"
          }
        };
      });
    },

    async matches(query): Promise<Page<MatchRow>> {
      const filters = matchFilters(query);
      return read(async (tx) => {
        const where: Prisma.MatchWhereInput = { AND: [eligibleMatch, filters] };
        const [rows, total] = await Promise.all([
          tx.match.findMany({
            where,
            select: matchSelect,
            orderBy: [{ created_at: "desc" }, { id: "desc" }],
            skip: (query.page - 1) * query.limit,
            take: query.limit
          }),
          tx.match.count({ where })
        ]);
        return pageData(rows.map(serializeMatch), query, total, { from: query.from, until: query.until });
      });
    },

    async match(id): Promise<Observed<MatchRow>> {
      return read(async (tx) => {
        const row = await tx.match.findFirst({ where: { AND: [eligibleMatch, { id }] }, select: matchSelect });
        if (!row) throw new HttpError(404, "not_found");
        return serializeMatch(row);
      });
    },

    async batches(query): Promise<Page<BatchRow>> {
      const filters = batchFilters(query);
      return read(async (tx) => {
        const where: Prisma.ParcelBatchWhereInput = { AND: [eligibleBatch, filters] };
        const [rows, total] = await Promise.all([
          tx.parcelBatch.findMany({
            where,
            select: batchSelect,
            orderBy: [{ created_at: "desc" }, { id: "desc" }],
            skip: (query.page - 1) * query.limit,
            take: query.limit
          }),
          tx.parcelBatch.count({ where })
        ]);
        return pageData(rows.map(serializeBatch), query, total, { from: query.from, until: query.until });
      });
    },

    async batch(id): Promise<Observed<BatchRow>> {
      return read(async (tx) => {
        const row = await tx.parcelBatch.findFirst({ where: { AND: [eligibleBatch, { id }] }, select: batchSelect });
        if (!row) throw new HttpError(404, "not_found");
        return serializeBatch(row);
      });
    },

    async parcels(id, query): Promise<CurrentOrderParcelsPage> {
      return read(async (tx) => {
        const batch = await tx.parcelBatch.findFirst({ where: { AND: [eligibleBatch, { id }] }, select: batchSelect });
        if (!batch) throw new HttpError(404, "not_found");
        const where: Prisma.ParcelWhereInput = { AND: [eligibleParcel, { order_id: batch.merchant_order.id }] };
        const [rows, total] = await Promise.all([
          tx.parcel.findMany({ where, select: parcelSelect, orderBy: { id: "asc" }, skip: (query.page - 1) * query.limit, take: query.limit }),
          tx.parcel.count({ where })
        ]);
        return {
          ...pageData(rows, query, total, null),
          contents_semantics: "current_eligible_order_contents",
          merchant_order_id: batch.merchant_order.id
        };
      });
    }
  };
}
