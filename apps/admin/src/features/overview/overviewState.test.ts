import { describe, expect, it, vi } from "vitest";
import {
  OVERVIEW_RESOURCE_KEYS,
  beginOverviewRefresh,
  completeOverviewRefresh,
  createInitialOverviewResourceStates,
  loadOverviewResources,
  summarizeOverviewResults,
  type OverviewLoaders
} from "./overviewState";

function loaders(overrides: Partial<OverviewLoaders> = {}): OverviewLoaders {
  return {
    dashboard: async () => ({ counts: { users: 0, drivers: 0, routes: 0, passenger_requests: 0, merchant_orders: 0, parcels: 0, active_drivers: 0, pending_driver_approvals: 0, open_incidents: 0 } }),
    routes: async () => ({ routes: [] }),
    trips: async () => ({ trips: [] }),
    ...overrides
  };
}

describe("overview resource loading", () => {
  it("loads only what the overview shows; full lists belong to their own pages", () => {
    expect(OVERVIEW_RESOURCE_KEYS).toEqual(["dashboard", "routes", "trips"]);
  });

  it("retains successful resources when one independent API fails", async () => {
    const results = await loadOverviewResources(
      loaders({ routes: vi.fn().mockRejectedValue(new Error("internal_server_error")) })
    );

    expect(results.dashboard.status).toBe("fulfilled");
    expect(results.trips.status).toBe("fulfilled");
    expect(results.routes.status).toBe("rejected");
    expect(summarizeOverviewResults(results)).toEqual({ succeeded: 2, failed: 1 });
  });

  it("reports a total API failure without turning it into empty data", async () => {
    const failure = () => Promise.reject(new Error("offline"));
    const results = await loadOverviewResources({ dashboard: failure, routes: failure, trips: failure });
    const states = completeOverviewRefresh(beginOverviewRefresh(createInitialOverviewResourceStates()), results);

    expect(summarizeOverviewResults(results)).toEqual({ succeeded: 0, failed: 3 });
    expect(Object.values(states).every((state) => state.phase === "error" && !state.hasData)).toBe(true);
  });

  it("keeps last valid data while refreshing and after a failed retry", async () => {
    const first = await loadOverviewResources(loaders());
    const ready = completeOverviewRefresh(createInitialOverviewResourceStates(), first);
    const refreshing = beginOverviewRefresh(ready);
    const retry = await loadOverviewResources(loaders({ trips: vi.fn().mockRejectedValue(new Error("offline")) }));
    const completed = completeOverviewRefresh(refreshing, retry);

    expect(refreshing.trips).toEqual({ phase: "loading", hasData: true });
    expect(completed.trips).toEqual({ phase: "error", hasData: true });
    expect(completed.dashboard).toEqual({ phase: "ready", hasData: true });
  });
});
