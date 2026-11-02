import type {
  DashboardResponse,
  DriverProfile,
  DriverRoute,
  MerchantOrder,
  PassengerRequest,
  Trip
} from "../../api";

export const OVERVIEW_RESOURCE_KEYS = ["dashboard", "drivers", "routes", "requests", "orders", "trips"] as const;

export type OverviewResourceKey = (typeof OVERVIEW_RESOURCE_KEYS)[number];
export type OverviewResourcePhase = "idle" | "loading" | "ready" | "error";
export type OverviewResourceState = { phase: OverviewResourcePhase; hasData: boolean };
export type OverviewResourceStates = Record<OverviewResourceKey, OverviewResourceState>;

export type OverviewPayloads = {
  dashboard: DashboardResponse;
  drivers: { drivers: DriverProfile[] };
  routes: { routes: DriverRoute[] };
  requests: { requests: PassengerRequest[] };
  orders: { orders: MerchantOrder[] };
  trips: { trips: Trip[] };
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
 * Loads every resource independently. Promise.allSettled is intentional: an
 * orders outage must not erase valid driver, trip, or request data.
 */
export async function loadOverviewResources(loaders: OverviewLoaders): Promise<OverviewResults> {
  const [dashboard, drivers, routes, requests, orders, trips] = await Promise.allSettled([
    loaders.dashboard(),
    loaders.drivers(),
    loaders.routes(),
    loaders.requests(),
    loaders.orders(),
    loaders.trips()
  ]);
  return { dashboard, drivers, routes, requests, orders, trips };
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
