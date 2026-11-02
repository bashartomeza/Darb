// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, ApiError } from "../../api";
import { LocaleProvider } from "../../i18n/LocaleContext";
import type { Locale } from "../../i18n/translations";
import type { Observed, Overview, Page, MatchRow, BatchRow, CurrentOrderParcelsPage } from "./contracts";
import { MatchingBatchingMonitoring } from "./MatchingBatchingMonitoring";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const range = { from: "2026-09-01T00:00:00.000Z", until: "2026-09-08T00:00:00.000Z" };
const overview = (observed_at = "2026-09-08T00:00:01.000Z", accepted = 0): Observed<Overview> => ({
  observed_at,
  scope: "production_supported_legacy",
  data: {
    range,
    pending_passenger_requests: 0,
    submitted_merchant_orders: 0,
    match_results_by_status: { proposed: 0, sent_to_driver: 0, accepted, rejected: 0, expired: 0, invalidated: 0 },
    batches_by_status: { created: 0, proposed: 0, assigned: 0, picked_up: 0, in_transit: 0, delivered: 0, cancelled: 0, failed: 0, expired: 0 },
    active_batches: 0,
    capabilities: { canonical_monitoring: "unavailable", failed_attempt_history: "not_recorded", completed_batches: "not_supported" }
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function api(overrides: Partial<ApiClient> = {}): ApiClient {
  const emptyMatches: Page<MatchRow> = { observed_at: "2026-09-08T00:00:01.000Z", scope: "production_supported_legacy", data: { items: [], page: 1, limit: 25, total: 0, has_more: false, range } };
  const emptyBatches: Page<BatchRow> = { observed_at: "2026-09-08T00:00:01.000Z", scope: "production_supported_legacy", data: { items: [], page: 1, limit: 25, total: 0, has_more: false, range } };
  const emptyParcels: CurrentOrderParcelsPage = { observed_at: "2026-09-08T00:00:01.000Z", scope: "production_supported_legacy", data: { items: [], page: 1, limit: 25, total: 0, has_more: false, range: null, contents_semantics: "current_eligible_order_contents", merchant_order_id: "order_1" } };
  return {
    monitoringOverview: vi.fn().mockResolvedValue(overview()),
    monitoringMatches: vi.fn().mockResolvedValue(emptyMatches),
    monitoringMatch: vi.fn(),
    monitoringBatches: vi.fn().mockResolvedValue(emptyBatches),
    monitoringBatch: vi.fn(),
    monitoringParcels: vi.fn().mockResolvedValue(emptyParcels),
    runMatch: vi.fn(() => { throw new Error("legacy match action called"); }),
    batchOrder: vi.fn(() => { throw new Error("legacy batch action called"); }),
    runComparison: vi.fn(() => { throw new Error("legacy comparison action called"); }),
    ...overrides
  } as unknown as ApiClient;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount(client: ApiClient, locale: Locale = "en", token = "token") {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const storage = { getItem: () => locale, setItem: () => undefined };
  await act(async () => {
    root!.render(<LocaleProvider storage={storage}><MatchingBatchingMonitoring api={client} token={token} /></LocaleProvider>);
  });
  return host;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
});

describe("MatchingBatchingMonitoring", () => {
  it("loads the server-default overview and distinguishes current demand from creation-cohort results", async () => {
    const client = api();
    const view = await mount(client);
    expect(client.monitoringOverview).toHaveBeenCalledWith("token");
    expect(view.textContent).toContain("Pending passenger requests");
    expect(view.textContent).toContain("Submitted merchant orders");
    expect(view.textContent).toContain("Current state across all creation times");
    expect(view.textContent).toContain("Match results created in the observed range, grouped by current status");
    expect(view.textContent).toContain("Production-supported legacy records; demo accounts and seeded passenger requests excluded.");
    expect(view.textContent).toContain("Canonical monitoring is unavailable");
    expect(view.textContent).toContain("Failed attempt history is not recorded");
    expect(view.textContent).toContain("Completed batches are not supported");
    expect(view.textContent).toContain("Observed Sep 8, 2026");
    expect(view.textContent).not.toMatch(/success rate|confidence/i);
    expect(view.textContent).not.toMatch(/run match|create batch|run comparison|accept match|reject match/i);
  });

  it("ignores an older refresh and retains the last timestamp as stale after failure", async () => {
    const first = deferred<Observed<Overview>>();
    const second = deferred<Observed<Overview>>();
    const third = deferred<Observed<Overview>>();
    const fourth = deferred<Observed<Overview>>();
    const client = api({ monitoringOverview: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise).mockReturnValueOnce(fourth.promise) });
    const view = await mount(client);
    await act(async () => first.resolve(overview("2026-09-08T00:00:01.000Z", 1)));
    const refresh = view.querySelector<HTMLButtonElement>('[data-testid="overview-refresh"]')!;
    act(() => refresh.click());
    act(() => refresh.click());
    await act(async () => third.resolve(overview("2026-09-08T00:00:03.000Z", 3)));
    await act(async () => second.resolve(overview("2026-09-08T00:00:02.000Z", 2)));
    expect(view.textContent).toContain("3");
    expect(view.querySelector("time")?.getAttribute("datetime")).toBe("2026-09-08T00:00:03.000Z");
    act(() => refresh.click());
    await act(async () => fourth.reject(new Error("database unavailable")));
    expect(view.textContent).toContain("Showing stale data");
    expect(view.querySelector("time")?.getAttribute("datetime")).toBe("2026-09-08T00:00:03.000Z");
  });

  it("clears overview data on a terminal authorization response", async () => {
    const terminal = Object.assign(new Error("forbidden"), { status: 403 }) as ApiError;
    const client = api({ monitoringOverview: vi.fn().mockResolvedValueOnce(overview()).mockRejectedValueOnce(terminal) });
    const view = await mount(client);
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="overview-refresh"]')!.click());
    await act(async () => undefined);
    expect(view.textContent).toContain("Overview unavailable");
    expect(view.textContent).not.toContain("Sep 8, 2026");
  });

  it("provides keyboard tabs, starts on Overview, and renders Arabic RTL copy", async () => {
    const client = api();
    const view = await mount(client, "ar");
    const tabs = [...view.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(view.querySelector('[role="tablist"]')).toBeTruthy();
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    tabs[0]!.focus();
    act(() => tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
    expect(view.querySelector(".matching-monitoring")?.getAttribute("dir")).toBe("rtl");
    expect(view.textContent).toContain("نتائج المطابقة");
    expect(view.textContent).toContain("سجلات التشغيل القديمة المدعومة في الإنتاج");
  });

  it("wires each tab to its active tabpanel", async () => {
    const view = await mount(api());
    const overviewTab = view.querySelector<HTMLButtonElement>('[role="tab"][id="monitoring-tab-overview"]')!;
    expect(overviewTab.getAttribute("aria-controls")).toBe("monitoring-tabpanel-overview");
    expect(view.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe("monitoring-tab-overview");
    act(() => view.querySelector<HTMLButtonElement>('[role="tab"][id="monitoring-tab-matching"]')!.click());
    expect(view.querySelector('[role="tabpanel"]')?.id).toBe("monitoring-tabpanel-matching");
    expect(view.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe("monitoring-tab-matching");
  });

  it("connects the Batches tab to the legacy batch directory", async () => {
    const client = api();
    const view = await mount(client);
    const batchesTab = [...view.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent === "Legacy batches")!;
    act(() => batchesTab.click());
    await act(async () => undefined);
    expect(client.monitoringBatches).toHaveBeenCalledWith("token", { page: 1, limit: 25 });
    expect(view.textContent).toContain("Exact operational ID");
    expect(view.textContent).not.toContain("will be connected in the next task");
  });

  it("renders cross-entity aggregate keys as neutral Unknown statuses", async () => {
    const response = overview();
    Object.assign(response.data.match_results_by_status, { completed: 4 });
    Object.assign(response.data.batches_by_status, { completed: 5 });
    const view = await mount(api({ monitoringOverview: vi.fn().mockResolvedValue(response) }));
    expect(view.textContent?.match(/Unknown/g)?.length).toBe(2);
    expect(view.querySelectorAll(".badge--neutral").length).toBeGreaterThanOrEqual(2);
    expect(view.textContent).not.toContain("Completed4");
    expect(view.textContent).not.toContain("Completed5");
  });
});
