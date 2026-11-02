import { z } from "zod";
import {
  DriverRouteStatus,
  MatchStatus,
  MerchantOrderStatus,
  ParcelBatchStatus,
  ParcelStatus,
  RequestStatus,
  type DriverRouteStatus as DriverRouteStatusValue,
  type MatchStatus as MatchStatusValue,
  type MerchantOrderStatus as MerchantOrderStatusValue,
  type ParcelBatchStatus as ParcelBatchStatusValue,
  type ParcelStatus as ParcelStatusValue,
  type RequestStatus as RequestStatusValue
} from "../../generated/prisma/enums.js";

const DEFAULT_RANGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1_000;
const UTC_ISO_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/;
function normalizeUtcIso(value: string): string {
  const match = UTC_ISO_PATTERN.exec(value);
  if (!match) return value;
  return `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
}
const utcIso = z.string().regex(UTC_ISO_PATTERN).refine(
  (value) => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === normalizeUtcIso(value),
  "Expected a valid UTC ISO datetime"
).transform(normalizeUtcIso);
const scalarInteger = (minimum: number, maximum: number) => z.string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(minimum).max(maximum));
const search = z.string()
  .transform((value) => value.trim())
  .pipe(z.string().max(191))
  .transform((value) => value || undefined)
  .optional();

const rangeShape = { from: utcIso.optional(), until: utcIso.optional() };
const pageShape = {
  page: scalarInteger(1, 1_000).default(1),
  limit: scalarInteger(1, 50).default(25)
};
const rangeSchema = z.strictObject(rangeShape);
const pageSchema = z.strictObject(pageShape);
const matchQuerySchema = z.strictObject({
  ...pageShape,
  ...rangeShape,
  status: z.enum(MatchStatus).optional(),
  demand_kind: z.enum(["passenger_only", "merchant_only", "combined"]).optional(),
  search
});
const batchQuerySchema = z.strictObject({
  ...pageShape,
  ...rangeShape,
  status: z.enum(ParcelBatchStatus).optional(),
  search
});
const monitoringIdSchema = z.string().trim().min(1).max(191);

export type Range = { from: string; until: string };
export type Observed<T> = { observed_at: string; scope: "production_supported_legacy"; data: T };
export type Page<T> = Observed<{
  items: T[];
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
  range: Range | null;
}>;
export type DemandKind = "passenger_only" | "merchant_only" | "combined";
export type PageQuery = { page: number; limit: number };
export type MatchQuery = PageQuery & Range & {
  status?: MatchStatusValue;
  demand_kind?: DemandKind;
  search?: string;
};
export type BatchQuery = PageQuery & Range & { status?: ParcelBatchStatusValue; search?: string };

export type MatchRow = {
  id: string;
  status: MatchStatusValue;
  created_at: string;
  score: string;
  method: "darb_route_score" | "unrecognized";
  demand_kind: DemandKind;
  driver_route: { id: string; status: DriverRouteStatusValue };
  passenger_request: null | { id: string; status: RequestStatusValue; passenger_count: number };
  merchant_order: null | { id: string; status: MerchantOrderStatusValue; parcel_count: number };
  parcel_batch: null | { id: string; status: ParcelBatchStatusValue };
};
export type BatchRow = {
  id: string;
  status: ParcelBatchStatusValue;
  created_at: string;
  merchant_order: { id: string; status: MerchantOrderStatusValue; parcel_count: number };
  selected_driver_route: null | { id: string; status: DriverRouteStatusValue };
};
export type ParcelRow = { id: string; status: ParcelStatusValue };
export type CurrentOrderParcelsPage = Observed<Page<ParcelRow>["data"] & {
  contents_semantics: "current_eligible_order_contents";
  merchant_order_id: string;
}>;
export type Overview = {
  range: Range;
  pending_passenger_requests: number;
  submitted_merchant_orders: number;
  match_results_by_status: Record<MatchStatusValue, number>;
  batches_by_status: Record<ParcelBatchStatusValue, number>;
  active_batches: number;
  capabilities: {
    canonical_monitoring: "unavailable";
    failed_attempt_history: "not_recorded";
    completed_batches: "not_supported";
  };
};

export interface MonitoringService {
  overview(query: Range): Promise<Observed<Overview>>;
  matches(query: MatchQuery): Promise<Page<MatchRow>>;
  match(id: string): Promise<Observed<MatchRow>>;
  batches(query: BatchQuery): Promise<Page<BatchRow>>;
  batch(id: string): Promise<Observed<BatchRow>>;
  parcels(id: string, query: PageQuery): Promise<CurrentOrderParcelsPage>;
}

export function parseRange(input: unknown, now: Date): Range {
  const parsed = rangeSchema.parse(input);
  if ((parsed.from === undefined) !== (parsed.until === undefined)) {
    throw new z.ZodError([{ code: "custom", path: ["from", "until"], message: "from and until must be supplied together", input }]);
  }
  const until = parsed.until ?? now.toISOString();
  const from = parsed.from ?? new Date(now.getTime() - DEFAULT_RANGE_MS).toISOString();
  const fromMs = Date.parse(from);
  const untilMs = Date.parse(until);
  if (fromMs >= untilMs || untilMs - fromMs > MAX_RANGE_MS || untilMs > now.getTime()) {
    throw new z.ZodError([{ code: "custom", path: ["from", "until"], message: "Invalid monitoring range", input }]);
  }
  return { from, until };
}

export function parsePageQuery(input: unknown): PageQuery {
  return pageSchema.parse(input);
}

export function parseMatchQuery(input: unknown, now: Date): MatchQuery {
  const parsed = matchQuerySchema.parse(input);
  const range = parseRange({ from: parsed.from, until: parsed.until }, now);
  const { from: _from, until: _until, search: parsedSearch, ...rest } = parsed;
  return { ...rest, ...range, ...(parsedSearch === undefined ? {} : { search: parsedSearch }) };
}

export function parseBatchQuery(input: unknown, now: Date): BatchQuery {
  const parsed = batchQuerySchema.parse(input);
  const range = parseRange({ from: parsed.from, until: parsed.until }, now);
  const { from: _from, until: _until, search: parsedSearch, ...rest } = parsed;
  return { ...rest, ...range, ...(parsedSearch === undefined ? {} : { search: parsedSearch }) };
}

export function parseMonitoringId(input: unknown): string {
  return monitoringIdSchema.parse(input);
}
