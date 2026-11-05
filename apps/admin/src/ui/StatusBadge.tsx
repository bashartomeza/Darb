import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/**
 * Maps a raw API status value onto a badge tone. Keys are the same status
 * strings the i18n layer translates, so a status the backend adds later falls
 * back to `neutral` rather than throwing.
 */
const statusTones: Record<string, Tone> = {
  completed: "success",
  delivered: "success",
  active: "success",
  published: "success",
  accepted: "success",
  matched: "success",
  in_transit: "info",
  on_trip: "info",
  picked_up: "info",
  pickup_started: "info",
  assigned: "info",
  sent_to_driver: "info",
  batched: "info",
  pending: "warning",
  proposed: "warning",
  submitted: "warning",
  draft: "warning",
  paused: "warning",
  created: "warning",
  cancelled: "danger",
  failed: "danger",
  rejected: "danger",
  expired: "danger",
  inactive: "danger",
  retired: "danger"
};

export function toneForStatus(status: string): Tone {
  return statusTones[status] ?? "neutral";
}

export function StatusBadge({
  children,
  tone,
  status,
  icon
}: {
  children: ReactNode;
  /** Explicit tone; when omitted it is derived from `status`. */
  tone?: Tone;
  status?: string;
  icon?: IconName;
}) {
  const resolved = tone ?? (status ? toneForStatus(status) : "neutral");
  return (
    <span className={`badge badge--${resolved}`}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}
