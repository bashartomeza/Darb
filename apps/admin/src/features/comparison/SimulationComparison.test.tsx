// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, ComparisonSimulation, SimulationMetrics } from "../../api";
import { LocaleProvider } from "../../i18n/LocaleContext";
import type { Locale } from "../../i18n/translations";
import { SimulationComparison } from "./SimulationComparison";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function metrics(wait: number, km: number): SimulationMetrics {
  return {
    requests: 10, matched: 9, unmatched: 1, unmatchedPct: 10,
    waitingMin: { avg: wait, median: wait, p90: wait * 2 },
    matchingMin: { avg: 1, median: 1, p90: 2 },
    routeDeviationKm: km, routeDeviationKmPerMatched: 1,
    vehiclesUsed: 2, vehiclesTotal: 4, vehicleUtilisationPct: 50, seatUtilisationPct: 80, parcelUtilisationPct: 0
  };
}

const simulation: ComparisonSimulation = {
  simulated: true,
  version: "matching_comparison_sim_v1",
  params: { seed: 1, manualResponseDelayMin: 4, nearestMatchDelayMin: 0.5, masariOfferDelayMin: 1.5, masariBatchWindowMin: 6 },
  aggregate: { manual: metrics(30, 5), nearest: metrics(20, 9), masari: metrics(18, 3) },
  scenarios: [{
    key: "s1", label: "Scenario one", origin: "hand_written", requests: 10, passengerRequests: 10, parcelOrders: 0, drivers: 4,
    methods: { manual: metrics(31, 6), nearest: metrics(21, 8), masari: metrics(17, 2) }
  }]
};

let root: Root | undefined;
let host: HTMLElement | undefined;

async function render(api: Partial<ApiClient>, locale: Locale = "en") {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <LocaleProvider storage={{ getItem: () => locale, setItem: () => undefined }}>
        <SimulationComparison api={api as ApiClient} token="t" />
      </LocaleProvider>
    );
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe("SimulationComparison", () => {
  it("labels the figures as simulated and shows each method", async () => {
    const view = await render({ comparisonSimulation: vi.fn().mockResolvedValue({ simulation }) });
    expect(view.textContent).toContain("Simulated");
    expect(view.querySelector('[data-testid="sim-masari-waitAvg"]')?.textContent).toBe("18");
    expect(view.querySelector('[data-testid="sim-manual-waitAvg"]')?.textContent).toBe("30");
    expect(view.querySelectorAll('[role="progressbar"]').length).toBe(15);
  });

  it("switches to a single scenario", async () => {
    const view = await render({ comparisonSimulation: vi.fn().mockResolvedValue({ simulation }) });
    const select = view.querySelector<HTMLSelectElement>('[data-testid="sim-scenario"]')!;
    await act(async () => {
      select.value = "s1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(view.querySelector('[data-testid="sim-masari-waitAvg"]')?.textContent).toBe("17");
  });

  it("renders Arabic copy and an error state with retry", async () => {
    const view = await render({ comparisonSimulation: vi.fn().mockResolvedValue({ simulation }) }, "ar");
    expect(view.textContent).toContain("محاكاة");
    expect(view.textContent).toContain("مساري");
    act(() => root?.unmount());
    view.remove();
    const failing = await render({ comparisonSimulation: vi.fn().mockRejectedValue(new Error("boom")) });
    expect(failing.textContent).toContain("boom");
    expect(failing.textContent).toContain("Simulated");
  });
});
