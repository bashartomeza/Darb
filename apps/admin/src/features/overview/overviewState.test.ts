import { describe, expect, it, vi } from "vitest";
import {
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
    drivers: async () => ({ drivers: [] }),
    routes: async () => ({ routes: [] }),
    requests: async () => ({ requests: [] }),
    orders: async () => ({ orders: [] }),
    trips: async () => ({ trips: [] }),
    ...overrides
  };
}

describe("overview resource loading", () => {
  it("retains successful resources when one independent API fails", async () => {
    const results = await loadOverviewResources(
      loaders({ orders: vi.fn().mockRejectedValue(new Error("internal_server_error")) })
    );

    expect(results.drivers.status).toBe("fulfilled");
    expect(results.trips.status).toBe("fulfilled");
    expect(results.requests.status).toBe("fulfilled");
    expect(results.orders.status).toBe("rejected");
    expect(summarizeOverviewResults(results)).toEqual({ succeeded: 5, failed: 1 });
  });

  it("reports a total API failure without turning it into empty data", async () => {
    const failure = () => Promise.reject(new Error("offline"));
    const results = await loadOverviewResources({
      dashboard: failure,
      drivers: failure,
      routes: failure,
      requests: failure,
      orders: failure,
      trips: failure
    });
    const states = completeOverviewRefresh(beginOverviewRefresh(createInitialOverviewResourceStates()), results);

    expect(summarizeOverviewResults(results)).toEqual({ succeeded: 0, failed: 6 });
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
    expect(completed.drivers).toEqual({ phase: "ready", hasData: true });
  });
});
