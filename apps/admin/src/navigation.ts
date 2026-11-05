import type { IconName } from "./ui/Icon";
import type { TranslationKey } from "./i18n/translations";

/** The operational destinations owned by the Admin dashboard, in sidebar order. */
export const MODULE_IDS = [
  "overview",
  "users",
  "drivers",
  "invitations",
  "trips",
  "routes",
  "checkpointPositions",
  "cityPlaces",
  "deliveries",
  "matchingBatching",
  "cancellations",
  "incidentsSafety",
  "communityReports",
  "reports",
  "appRatings",
  "settings"
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];
/**
 * `routeWorkspace` is the older versioned route editor (stops, fares,
 * versions). It is not in the sidebar: it opens only from a link on the Routes
 * page, and only when the build enables route management.
 */
export type AdminRouteId = ModuleId | "profile" | "routeWorkspace";

export const NAV_GROUP_IDS = ["main", "people", "operations", "safety", "insights", "system"] as const;
export type NavGroupId = (typeof NAV_GROUP_IDS)[number];

export type NavItem = {
  id: ModuleId;
  icon: IconName;
  labelKey: TranslationKey;
  group: NavGroupId;
};

export const NAV_GROUPS: Array<{ id: NavGroupId; labelKey: TranslationKey }> = [
  { id: "main", labelKey: "navGroupMain" },
  { id: "people", labelKey: "navGroupPeople" },
  { id: "operations", labelKey: "navGroupOperations" },
  { id: "safety", labelKey: "navGroupSafety" },
  { id: "insights", labelKey: "navGroupInsights" },
  { id: "system", labelKey: "navGroupSystem" }
];

export const NAV_ITEMS: NavItem[] = [
  { id: "overview", icon: "dashboard", labelKey: "navOverview", group: "main" },
  { id: "users", icon: "account_circle", labelKey: "navUsers", group: "people" },
  { id: "drivers", icon: "verified_user", labelKey: "navDrivers", group: "people" },
  { id: "invitations", icon: "person_pin_circle", labelKey: "navInvitations", group: "people" },
  { id: "trips", icon: "local_shipping", labelKey: "navTrips", group: "operations" },
  { id: "routes", icon: "edit_road", labelKey: "navRoutes", group: "operations" },
  { id: "checkpointPositions", icon: "location_on", labelKey: "navCheckpointPositions", group: "operations" },
  { id: "cityPlaces", icon: "person_pin_circle", labelKey: "navCityPlaces", group: "operations" },
  { id: "deliveries", icon: "inventory_2", labelKey: "navDeliveries", group: "operations" },
  { id: "matchingBatching", icon: "alt_route", labelKey: "navMatchingBatching", group: "operations" },
  { id: "cancellations", icon: "block", labelKey: "navCancellations", group: "operations" },
  { id: "incidentsSafety", icon: "emergency", labelKey: "navIncidentsSafety", group: "safety" },
  { id: "communityReports", icon: "flag", labelKey: "navCommunityReports", group: "safety" },
  { id: "reports", icon: "assessment", labelKey: "navReports", group: "insights" },
  { id: "appRatings", icon: "star", labelKey: "navAppRatings", group: "insights" },
  { id: "settings", icon: "settings", labelKey: "navSettings", group: "system" }
];

export type ModuleFlags = { demoEnabled: boolean; routeManagementEnabled: boolean };

/** Keep the information architecture stable across environments. */
export function visibleNavItems(_flags: ModuleFlags): NavItem[] {
  return NAV_ITEMS;
}

export function resolveActiveModule(active: AdminRouteId, flags: ModuleFlags): AdminRouteId {
  if (active === "routeWorkspace") return flags.routeManagementEnabled ? "routeWorkspace" : "routes";
  return active === "profile" || (MODULE_IDS as readonly string[]).includes(active) ? active : "overview";
}

/** The sidebar entry to highlight; the hidden route workspace belongs under Routes. */
export function navItemForModule(active: AdminRouteId): ModuleId | null {
  if (active === "profile") return null;
  if (active === "routeWorkspace") return "routes";
  return active;
}

const HASH_BY_MODULE: Record<AdminRouteId, string> = {
  overview: "#/overview",
  users: "#/users",
  drivers: "#/drivers",
  invitations: "#/invitations",
  trips: "#/trips",
  routes: "#/routes",
  routeWorkspace: "#/routes/advanced",
  checkpointPositions: "#/checkpoint-positions",
  cityPlaces: "#/city-places",
  deliveries: "#/deliveries-orders",
  matchingBatching: "#/matching-batching",
  cancellations: "#/cancellations",
  incidentsSafety: "#/incidents-safety",
  communityReports: "#/community-reports",
  reports: "#/reports",
  appRatings: "#/app-ratings",
  settings: "#/settings",
  profile: "#/profile"
};

const MODULE_BY_HASH = new Map<string, AdminRouteId>([
  ...Object.entries(HASH_BY_MODULE).map(([id, hash]) => [hash, id as AdminRouteId] as const),
  // Compatibility aliases for the previous flat console modules.
  ["#/verification", "drivers"],
  ["#/requests", "deliveries"],
  ["#/matching", "matchingBatching"],
  ["#/batching", "matchingBatching"],
  ["#/comparison", "matchingBatching"],
  ["#/incidents", "incidentsSafety"],
  ["#/safety", "incidentsSafety"],
  ["#/ai-review", "incidentsSafety"]
]);

export function hashForModule(id: AdminRouteId) {
  return HASH_BY_MODULE[id];
}

export function moduleFromHash(hash: string): AdminRouteId {
  const normalized = hash.replace(/\/+$/, "") || "#/overview";
  return MODULE_BY_HASH.get(normalized) ?? "overview";
}
