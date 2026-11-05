import { z } from "zod";

/**
 * The fixed lists of cancellation reasons, one per kind of person cancelling.
 * Each code has an English and Arabic label in the mobile app and the admin
 * site (cancelReason_<code>), and in the notification texts.
 */
export const CANCEL_REASONS = {
  /** A passenger cancelling a ride request. */
  rider: ["changed_plans", "found_other_transport", "driver_too_far", "wrong_details", "other"],
  /** A merchant or parcel sender cancelling an order. */
  sender: ["changed_plans", "wrong_details", "found_other_delivery", "driver_too_far", "other"],
  /** A driver cancelling an accepted trip. */
  driver: ["vehicle_problem", "emergency", "cannot_reach_pickup", "route_changed", "other"],
  /** An administrator cancelling an order or trip. */
  admin: ["customer_request", "driver_unavailable", "safety_concern", "duplicate", "policy_violation", "other"],
} as const;

/** Set only by the system when nobody accepted an order in time. */
export const NO_DRIVER_IN_TIME = "no_driver_in_time";

export type CancelReasonKind = keyof typeof CANCEL_REASONS;

export const ALL_CANCEL_REASON_CODES: readonly string[] = [
  ...new Set([...Object.values(CANCEL_REASONS).flat(), NO_DRIVER_IN_TIME]),
];

export const CANCEL_ACTOR_ROLES = ["passenger", "merchant", "driver", "admin", "system"] as const;
export type CancelActorRole = (typeof CANCEL_ACTOR_ROLES)[number];

export const CANCEL_NOTE_MAX = 300;

/** Request body of every manual cancellation: a reason from the person's list and an optional note. */
export function cancelBodySchema(kind: CancelReasonKind) {
  return z.object({
    reason: z.enum(CANCEL_REASONS[kind]),
    note: z
      .string()
      .trim()
      .max(CANCEL_NOTE_MAX)
      .optional()
      .transform((value) => (value ? value : undefined)),
  });
}
