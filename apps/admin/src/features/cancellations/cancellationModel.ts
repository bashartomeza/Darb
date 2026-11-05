import type { ApiError, CancellationOutcome, CancellationRole, CancellationKind, CancellationOrderType } from "../../api";
import type { TranslationKey } from "../../i18n/translations";

/** Every reason code the API records, across riders, senders, drivers, Admins and the system. */
export const ALL_CANCELLATION_REASONS = [
  "changed_plans",
  "found_other_transport",
  "driver_too_far",
  "wrong_details",
  "found_other_delivery",
  "vehicle_problem",
  "emergency",
  "cannot_reach_pickup",
  "route_changed",
  "customer_request",
  "driver_unavailable",
  "safety_concern",
  "duplicate",
  "policy_violation",
  "no_driver_in_time",
  "other"
] as const;
export type CancellationReasonCode = (typeof ALL_CANCELLATION_REASONS)[number];

export const CANCELLATION_ROLES: CancellationRole[] = ["system", "passenger", "merchant", "driver", "admin"];
export const CANCELLATION_KINDS: CancellationKind[] = ["automatic", "manual"];

/** Longest note the API stores with a cancellation. */
export const CANCELLATION_NOTE_MAX = 300;

/** Trip states an Admin may cancel (accepted up to in transit). */
export const ADMIN_CANCELLABLE_TRIP_STATUSES = ["accepted", "pickup_started", "picked_up", "in_transit"] as const;
/** Ride request states an Admin may cancel. */
export const ADMIN_CANCELLABLE_REQUEST_STATUSES = ["pending", "matched", "accepted", "picked_up", "in_transit"] as const;
/** Merchant order states an Admin may cancel. */
export const ADMIN_CANCELLABLE_ORDER_STATUSES = ["submitted", "batched", "matched", "assigned", "in_transit"] as const;
/** Passenger parcel tracking states an Admin may cancel. */
export const ADMIN_CANCELLABLE_PARCEL_STATES = ["searching", "assigned", "picked_up", "in_transit"] as const;

export function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

/** A known reason's label key; unknown codes fall back to the code itself. */
export function reasonLabelKey(code: string): TranslationKey | null {
  return isOneOf(ALL_CANCELLATION_REASONS, code) ? (`cancelReason_${code}` as TranslationKey) : null;
}

export const outcomeLabelKey = (outcome: CancellationOutcome) => `cancelOutcome_${outcome}` as TranslationKey;
export const roleLabelKey = (role: CancellationRole) => `cancelRole_${role}` as TranslationKey;
export const kindLabelKey = (kind: CancellationKind) => `cancelKind_${kind}` as TranslationKey;
export const orderTypeLabelKey = (type: CancellationOrderType) => `cancelOrderType_${type}` as TranslationKey;

/** What to tell the Admin when a cancellation is refused. */
export function cancellationErrorKey(error: unknown): TranslationKey {
  const status = (error as ApiError | undefined)?.status;
  return status === 409 ? "cancelConflict" : "cancelFailed";
}
