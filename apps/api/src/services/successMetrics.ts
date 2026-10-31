import { toCsv } from "../lib/csv.js";

/**
 * Success-target metrics from the Team 6 proposal (section 9.6).
 * Pure computation over pre-fetched, non-identifying rows; no I/O, no personal data.
 */

export type MetricKey =
  | "matching_time"
  | "ai_understanding"
  | "status_continuity"
  | "batch_efficiency"
  | "driver_utilization"
  | "user_satisfaction"
  | "driver_verification"
  | "pickup_clarity"
  | "route_deviation";

export type MetricStatus = "pass" | "fail" | "no_data";
export type MetricTrend = "improving" | "worsening" | "flat" | "none";
export type MetricUnit = "seconds" | "percent" | "ratio" | "score";

export const MATCHING_TIME_TARGET_SECONDS = 120;
export const STATUS_CONTINUITY_TARGET_PERCENT = 95;
export const SATISFACTION_TARGET = 4;
export const VERIFICATION_TARGET_PERCENT = 100;

export const COMPLETED_CHAIN = ["accepted", "pickup_started", "picked_up", "in_transit", "delivered", "completed"] as const;

export type TripRow = {
  status: string;
  created_at: Date;
  driver_route_id: string;
  /** Creation time of the linked passenger request, when the trip serves one. */
  request_created_at: Date | null;
  /** Orders served by the trip (a passenger request counts as one). */
  served_units: number;
  /** Parcels carried when the trip delivers a parcel batch, else null. */
  batch_parcels: number | null;
  /** Recorded status changes for the trip, oldest first. */
  transitions: { from: string; to: string }[];
};

export type MetricsInput = {
  trips: TripRow[];
  verification: { active_drivers: number; verified_active_drivers: number };
  /** Optional 1-5 ratings; absent until a rating model exists. */
  ratings?: number[];
};

export type MetricResult = {
  key: MetricKey;
  unit: MetricUnit;
  target: string;
  value: number | null;
  status: MetricStatus;
  sample_size: number;
};

export type Window = { from: Date; to: Date };

const round = (value: number, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function result(
  key: MetricKey,
  unit: MetricUnit,
  target: string,
  value: number | null,
  sample: number,
  passes: (value: number) => boolean
): MetricResult {
  return {
    key,
    unit,
    target,
    value,
    sample_size: sample,
    status: value === null ? "no_data" : passes(value) ? "pass" : "fail"
  };
}

/** True when the recorded history walks the full forward chain without a gap. */
export function hasContinuousHistory(transitions: { from: string; to: string }[]) {
  if (transitions.length !== COMPLETED_CHAIN.length - 1) return false;
  return transitions.every((step, index) => step.from === COMPLETED_CHAIN[index] && step.to === COMPLETED_CHAIN[index + 1]);
}

export function computeSuccessMetrics(input: MetricsInput): MetricResult[] {
  const { trips, verification } = input;

  const matchTimes = trips
    .filter((trip) => trip.request_created_at)
    .map((trip) => (trip.created_at.getTime() - trip.request_created_at!.getTime()) / 1000)
    .filter((seconds) => seconds >= 0);

  const completed = trips.filter((trip) => trip.status === "completed");
  const continuous = completed.filter((trip) => hasContinuousHistory(trip.transitions));

  const batchTrips = trips.filter((trip) => trip.batch_parcels !== null && trip.batch_parcels > 0);
  const batchParcels = batchTrips.reduce((sum, trip) => sum + (trip.batch_parcels ?? 0), 0);

  const routesUsed = new Set(trips.map((trip) => trip.driver_route_id));
  const served = completed.reduce((sum, trip) => sum + trip.served_units, 0);

  const ratings = (input.ratings ?? []).filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5);

  return [
    result("matching_time", "seconds", "< 120 s", matchTimes.length ? round(median(matchTimes), 1) : null, matchTimes.length, (v) => v < MATCHING_TIME_TARGET_SECONDS),
    result("ai_understanding", "percent", ">= 85%", null, 0, () => false),
    result(
      "status_continuity",
      "percent",
      ">= 95%",
      completed.length ? round((continuous.length / completed.length) * 100, 1) : null,
      completed.length,
      (v) => v >= STATUS_CONTINUITY_TARGET_PERCENT
    ),
    result("batch_efficiency", "ratio", "< 1.0 trips per parcel", batchTrips.length ? round(batchTrips.length / batchParcels) : null, batchTrips.length, (v) => v < 1),
    result("driver_utilization", "ratio", "> 1.0 requests per route", routesUsed.size && completed.length ? round(served / routesUsed.size) : null, completed.length, (v) => v > 1),
    result(
      "user_satisfaction",
      "score",
      ">= 4 / 5",
      ratings.length ? round(ratings.reduce((a, b) => a + b, 0) / ratings.length) : null,
      ratings.length,
      (v) => v >= SATISFACTION_TARGET
    ),
    result(
      "driver_verification",
      "percent",
      "100%",
      verification.active_drivers ? round((verification.verified_active_drivers / verification.active_drivers) * 100, 1) : null,
      verification.active_drivers,
      (v) => v >= VERIFICATION_TARGET_PERCENT
    ),
    result("pickup_clarity", "percent", "clear reduction in confusion", null, 0, () => false),
    result("route_deviation", "ratio", "within route limits", null, 0, () => false)
  ];
}

const LOWER_IS_BETTER = new Set<MetricKey>(["matching_time", "batch_efficiency"]);

export function trendFor(key: MetricKey, current: number | null, previous: number | null): MetricTrend {
  if (current === null || previous === null) return "none";
  if (current === previous) return "flat";
  const increased = current > previous;
  return increased !== LOWER_IS_BETTER.has(key) ? "improving" : "worsening";
}

export type MetricReport = MetricResult & { previous_value: number | null; trend: MetricTrend };

export function buildReport(current: MetricResult[], previous: MetricResult[]): MetricReport[] {
  return current.map((metric) => {
    const before = previous.find((candidate) => candidate.key === metric.key);
    const previousValue = before?.value ?? null;
    return { ...metric, previous_value: previousValue, trend: trendFor(metric.key, metric.value, previousValue) };
  });
}

/** The window of equal length that ends just before `window` starts. */
export function previousWindow(window: Window): Window {
  const span = window.to.getTime() - window.from.getTime();
  return { from: new Date(window.from.getTime() - span - 1), to: new Date(window.from.getTime() - 1) };
}

export function successMetricsCsv(report: MetricReport[], window: Window) {
  return toCsv(
    ["metric", "target", "value", "unit", "status", "previous_value", "trend", "sample_size", "from", "to"],
    report.map((m) => [m.key, m.target, m.value, m.unit, m.status, m.previous_value, m.trend, m.sample_size, window.from, window.to])
  );
}
