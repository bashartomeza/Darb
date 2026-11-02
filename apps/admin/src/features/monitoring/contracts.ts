export type DriverRouteStatus = "inactive" | "active" | "assigned" | "on_trip" | "completed";
export type RequestStatus = "draft" | "pending" | "matched" | "accepted" | "picked_up" | "in_transit" | "delivered" | "completed" | "cancelled" | "expired";
export type MerchantOrderStatus = "draft" | "submitted" | "batched" | "matched" | "assigned" | "in_transit" | "delivered" | "completed" | "cancelled" | "failed" | "expired";
export type ParcelStatus = "pending" | "batched" | "assigned" | "picked_up" | "in_transit" | "delivered" | "cancelled" | "failed" | "expired";
export type ParcelBatchStatus = "created" | "proposed" | "assigned" | "picked_up" | "in_transit" | "delivered" | "cancelled" | "failed" | "expired";
export type MatchStatus = "proposed" | "sent_to_driver" | "accepted" | "rejected" | "expired" | "invalidated";

export type Range = { from: string; until: string };
export type RangeInput = Range | { from?: never; until?: never };
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
  status?: MatchStatus;
  demand_kind?: DemandKind;
  search?: string;
};
export type BatchQuery = PageQuery & Range & { status?: ParcelBatchStatus; search?: string };
export type MatchQueryInput = Partial<Omit<MatchQuery, keyof Range>> & RangeInput;
export type BatchQueryInput = Partial<Omit<BatchQuery, keyof Range>> & RangeInput;

export type MatchRow = {
  id: string;
  status: MatchStatus;
  created_at: string;
  score: string;
  method: "darb_route_score" | "unrecognized";
  demand_kind: DemandKind;
  driver_route: { id: string; status: DriverRouteStatus };
  passenger_request: null | { id: string; status: RequestStatus; passenger_count: number };
  merchant_order: null | { id: string; status: MerchantOrderStatus; parcel_count: number };
  parcel_batch: null | { id: string; status: ParcelBatchStatus };
};
export type BatchRow = {
  id: string;
  status: ParcelBatchStatus;
  created_at: string;
  merchant_order: { id: string; status: MerchantOrderStatus; parcel_count: number };
  selected_driver_route: null | { id: string; status: DriverRouteStatus };
};
export type ParcelRow = { id: string; status: ParcelStatus };
export type CurrentOrderParcelsPage = Observed<Page<ParcelRow>["data"] & {
  contents_semantics: "current_eligible_order_contents";
  merchant_order_id: string;
}>;
export type Overview = {
  range: Range;
  pending_passenger_requests: number;
  submitted_merchant_orders: number;
  match_results_by_status: Record<MatchStatus, number>;
  batches_by_status: Record<ParcelBatchStatus, number>;
  active_batches: number;
  capabilities: {
    canonical_monitoring: "unavailable";
    failed_attempt_history: "not_recorded";
    completed_batches: "not_supported";
  };
};
