import type { DashboardResponse, DriverRoute } from "../../api";

/**
 * What the overview loads. Counts, alerts, trip figures and the newest
 * requests, orders and in-progress trips all come from the dashboard
 * endpoint, which counts in the database; driver routes feed the capacity
 * chart. Full lists are loaded, page by page, by their own pages.
 */
export const OVERVIEW_RESOURCE_KEYS = ["dashboard", "routes"] as const;

export type OverviewResourceKey = (typeof OVERVIEW_RESOURCE_KEYS)[number];
export type OverviewResourcePhase = "idle" | "loading" | "ready" | "error";
export type OverviewResourceState = { phase: OverviewResourcePhase; hasData: boolean };
export type OverviewResourceStates = Record<OverviewResourceKey, OverviewResourceState>;

export type OverviewPayloads = {
  dashboard: DashboardResponse;
  routes: { routes: DriverRoute[] };
};

export type OverviewLoaders = { [Key in OverviewResourceKey]: () => Promise<OverviewPayloads[Key]> };
export type OverviewResults = { [Key in OverviewResourceKey]: PromiseSettledResult<OverviewPayloads[Key]> };

export function createInitialOverviewResourceStates(): OverviewResourceStates {
  return Object.fromEntries(
    OVERVIEW_RESOURCE_KEYS.map((key) => [key, { phase: "idle", hasData: false }])
  ) as OverviewResourceStates;
}

/** Marks every independent resource as refreshing without discarding its last valid payload. */
export function beginOverviewRefresh(states: OverviewResourceStates): OverviewResourceStates {
  return Object.fromEntries(
    OVERVIEW_RESOURCE_KEYS.map((key) => [key, { ...states[key], phase: "loading" }])
  ) as OverviewResourceStates;
}

/**
 * Loads every resource independently. Promise.allSettled is intentional: a
 * routes outage must not erase valid dashboard data.
 */
export async function loadOverviewResources(loaders: OverviewLoaders): Promise<OverviewResults> {
  const [dashboard, routes] = await Promise.allSettled([loaders.dashboard(), loaders.routes()]);
  return { dashboard, routes };
}

export function completeOverviewRefresh(
  states: OverviewResourceStates,
  results: OverviewResults
): OverviewResourceStates {
  return Object.fromEntries(
    OVERVIEW_RESOURCE_KEYS.map((key) => [
      key,
      results[key].status === "fulfilled"
        ? { phase: "ready", hasData: true }
        : { phase: "error", hasData: states[key].hasData }
    ])
  ) as OverviewResourceStates;
}

export function summarizeOverviewResults(results: OverviewResults) {
  const succeeded = OVERVIEW_RESOURCE_KEYS.filter((key) => results[key].status === "fulfilled").length;
  return { succeeded, failed: OVERVIEW_RESOURCE_KEYS.length - succeeded };
}
