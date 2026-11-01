// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, ApiError } from "../../api";
import { LocaleProvider } from "../../i18n/LocaleContext";
import type { Locale } from "../../i18n/translations";
import type { MatchRow, Observed, Page } from "./contracts";
import { MatchingResults, utcInput } from "./MatchingResults";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const range = { from: "2026-09-01T00:00:00.000Z", until: "2026-09-08T00:00:00.000Z" };
const combined: MatchRow = {
  id: "match_1", status: "accepted", created_at: "2026-09-07T10:00:00.000Z", score: "87.125",
  method: "darb_route_score", demand_kind: "combined", driver_route: { id: "route_1", status: "assigned" },
  passenger_request: { id: "request_1", status: "accepted", passenger_count: 2 },
  merchant_order: { id: "order_1", status: "assigned", parcel_count: 3 },
  parcel_batch: { id: "batch_1", status: "assigned" }
};
const page = (items: MatchRow[] = [combined], observed_at = "2026-09-08T00:00:01.000Z", currentPage = 1, hasMore = false): Page<MatchRow> => ({
  observed_at, scope: "production_supported_legacy",
  data: { items, page: currentPage, limit: 25, total: items.length + (hasMore ? 25 : 0), has_more: hasMore, range }
});
const detail = (row = combined, observed_at = "2026-09-08T00:00:02.000Z"): Observed<MatchRow> => ({ observed_at, scope: "production_supported_legacy", data: row });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function api(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    monitoringMatches: vi.fn().mockResolvedValue(page()),
    monitoringMatch: vi.fn().mockResolvedValue(detail()),
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
  await act(async () => root!.render(<LocaleProvider storage={storage}><MatchingResults api={client} token={token} /></LocaleProvider>));
  return host;
}

function change(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!;
  setter.call(control, value);
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
});

describe("MatchingResults", () => {
  it("rejects invalid datetime input without throwing", () => {
    expect(utcInput("not-a-date")).toBeNull();
    expect(utcInput("2026-09-02T00:00")).toBe(new Date("2026-09-02T00:00").toISOString());
  });

  it("loads without client dates and renders safe combined-demand table fields", async () => {
    const client = api();
    const view = await mount(client);
    expect(client.monitoringMatches).toHaveBeenCalledWith("token", { page: 1, limit: 25 });
    expect(view.textContent).toContain("Matching results");
    expect(view.textContent).toContain("Exact operational ID");
    expect(view.textContent).toContain("Current status");
    expect(view.textContent).toContain("Demand kind");
    expect(view.textContent).toContain("Score");
    expect(view.textContent).toContain("87.125");
    expect(view.textContent).toContain("request_1");
    expect(view.textContent).toContain("order_1");
    expect(view.textContent).toContain("route_1");
    expect(view.textContent).not.toMatch(/confidence|all attempts|run match|accept match|reject match|retry match|tune algorithm/i);
  });

  it("resets filters to page one, echoes the server range only while paging, and caps page 1000", async () => {
    const client = api({ monitoringMatches: vi.fn().mockResolvedValueOnce(page([combined], undefined, 1, true)).mockResolvedValueOnce(page([combined], undefined, 2, false)).mockResolvedValueOnce(page([combined], undefined, 1000, true)) });
    const view = await mount(client);
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="matches-next"]')!.click());
    await act(async () => undefined);
    expect(client.monitoringMatches).toHaveBeenNthCalledWith(2, "token", { page: 2, limit: 25, ...range });
    change(view.querySelector<HTMLSelectElement>('[name="status"]')!, "accepted");
    await act(async () => undefined);
    expect(client.monitoringMatches).toHaveBeenNthCalledWith(3, "token", { page: 1, limit: 25, status: "accepted" });
    expect(view.textContent).toContain("Narrow the filters to continue beyond page 1000.");
    expect(view.querySelector<HTMLButtonElement>('[data-testid="matches-next"]')?.disabled).toBe(true);
  });

  it("submits exact ID and explicit UTC dates while preserving invalid explicit input", async () => {
    const client = api();
    const view = await mount(client);
    change(view.querySelector<HTMLInputElement>('[name="search"]')!, "match_1");
    act(() => view.querySelector<HTMLFormElement>('[data-testid="match-filters"]')!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })));
    await act(async () => undefined);
    expect(client.monitoringMatches).toHaveBeenLastCalledWith("token", expect.objectContaining({ page: 1, search: "match_1" }));
    change(view.querySelector<HTMLInputElement>('[name="from"]')!, "2026-09-02T00:00");
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="apply-range"]')!.click());
    expect(view.textContent).toContain("Select both range dates");
    expect(view.querySelector<HTMLInputElement>('[name="from"]')?.value).toBe("2026-09-02T00:00");
    change(view.querySelector<HTMLInputElement>('[name="until"]')!, "2026-09-03T00:00");
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="apply-range"]')!.click());
    await act(async () => undefined);
    expect(client.monitoringMatches).toHaveBeenLastCalledWith("token", expect.objectContaining({
      page: 1, from: new Date("2026-09-02T00:00").toISOString(), until: new Date("2026-09-03T00:00").toISOString()
    }));
  });

  it("reloads the visible query when the API identity changes and resets everything for a new token", async () => {
    const firstApi = api();
    const view = await mount(firstApi);
    change(view.querySelector<HTMLSelectElement>('[name="status"]')!, "accepted");
    change(view.querySelector<HTMLSelectElement>('[name="demand_kind"]')!, "combined");
    change(view.querySelector<HTMLInputElement>('[name="search"]')!, "match_1");
    act(() => view.querySelector<HTMLFormElement>('[data-testid="match-filters"]')!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })));
    change(view.querySelector<HTMLInputElement>('[name="from"]')!, "2026-09-02T00:00");
    change(view.querySelector<HTMLInputElement>('[name="until"]')!, "2026-09-03T00:00");
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="apply-range"]')!.click());
    await act(async () => undefined);

    const localeRebuiltApi = api();
    await act(async () => root!.render(<LocaleProvider storage={{ getItem: () => "ar", setItem: () => undefined }}><MatchingResults api={localeRebuiltApi} token="token" /></LocaleProvider>));
    expect(localeRebuiltApi.monitoringMatches).toHaveBeenCalledWith("token", {
      page: 1, limit: 25, status: "accepted", demand_kind: "combined", search: "match_1",
      from: new Date("2026-09-02T00:00").toISOString(), until: new Date("2026-09-03T00:00").toISOString()
    });
    expect(view.querySelector<HTMLSelectElement>('[name="status"]')!.value).toBe("accepted");

    const nextSessionApi = api();
    await act(async () => root!.render(<LocaleProvider storage={{ getItem: () => "ar", setItem: () => undefined }}><MatchingResults api={nextSessionApi} token="next-token" /></LocaleProvider>));
    expect(nextSessionApi.monitoringMatches).toHaveBeenCalledWith("next-token", { page: 1, limit: 25 });
    expect(view.querySelector<HTMLSelectElement>('[name="status"]')!.value).toBe("");
    expect(view.querySelector<HTMLInputElement>('[name="search"]')!.value).toBe("");
    expect(view.querySelector<HTMLInputElement>('[name="from"]')!.value).toBe("");
  });

  it("clears old page rows for a new query and never derives page three after its page-one failure", async () => {
    const changed = deferred<Page<MatchRow>>();
    const client = api({ monitoringMatches: vi.fn()
      .mockResolvedValueOnce(page([combined], undefined, 1, true))
      .mockResolvedValueOnce(page([{ ...combined, id: "old_page_2" }], undefined, 2, true))
      .mockReturnValueOnce(changed.promise) });
    const view = await mount(client);
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="matches-next"]')!.click());
    await act(async () => undefined);
    expect(view.textContent).toContain("old_page_2");
    change(view.querySelector<HTMLSelectElement>('[name="status"]')!, "rejected");
    expect(view.textContent).not.toContain("old_page_2");
    expect(view.querySelector<HTMLButtonElement>('[data-testid="matches-next"]')).toBeNull();
    await act(async () => changed.reject(new Error("unavailable")));
    expect(view.textContent).toContain("Matching results unavailable");
    expect(client.monitoringMatches).toHaveBeenCalledTimes(3);
  });

  it.each([
    { locale: "en" as const, guidance: "Select both dates", maximum: "31 days" },
    { locale: "ar" as const, guidance: "يجب تحديد التاريخين", maximum: "31 يوماً" }
  ])("maps backend range validation to actionable $locale guidance without clearing inputs", async ({ locale, guidance, maximum }) => {
    const validationError = Object.assign(new Error("validation_error"), { status: 400, details: { error: "validation_error" } }) as ApiError;
    const client = api({ monitoringMatches: vi.fn().mockResolvedValueOnce(page()).mockRejectedValue(validationError) });
    const view = await mount(client, locale);
    change(view.querySelector<HTMLInputElement>('[name="from"]')!, "2026-09-04T00:00");
    change(view.querySelector<HTMLInputElement>('[name="until"]')!, "2026-09-03T00:00");
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="apply-range"]')!.click());
    await act(async () => undefined);
    expect(view.textContent).toContain(guidance);
    expect(view.textContent).toContain(maximum);
    expect(view.textContent).not.toContain("validation_error");
    expect(view.querySelector<HTMLInputElement>('[name="from"]')!.value).toBe("2026-09-04T00:00");
    expect(view.querySelector<HTMLInputElement>('[name="until"]')!.value).toBe("2026-09-03T00:00");
  });

  it("suppresses stale list responses and retains the successful observation after a failed refresh", async () => {
    const first = deferred<Page<MatchRow>>();
    const second = deferred<Page<MatchRow>>();
    const third = deferred<Page<MatchRow>>();
    const fourth = deferred<Page<MatchRow>>();
    const client = api({ monitoringMatches: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise).mockReturnValueOnce(fourth.promise) });
    const view = await mount(client);
    await act(async () => first.resolve(page([{ ...combined, id: "initial" }])));
    const refresh = view.querySelector<HTMLButtonElement>('[data-testid="matches-refresh"]')!;
    act(() => refresh.click());
    act(() => refresh.click());
    await act(async () => third.resolve(page([{ ...combined, id: "newest" }], "2026-09-08T00:00:03.000Z")));
    await act(async () => second.resolve(page([{ ...combined, id: "older" }], "2026-09-08T00:00:02.000Z")));
    expect(view.textContent).toContain("newest");
    expect(view.textContent).not.toContain("older");
    act(() => refresh.click());
    await act(async () => fourth.reject(new Error("database unavailable")));
    expect(view.textContent).toContain("Showing stale data");
    expect(view.textContent).toContain("newest");
    expect(view.querySelector("time")?.getAttribute("datetime")).toBe("2026-09-08T00:00:03.000Z");
  });

  it("clears list data on 401 and detail data on 404", async () => {
    const unauthorized = Object.assign(new Error("unauthorized"), { status: 401 }) as ApiError;
    const missing = Object.assign(new Error("not found"), { status: 404 }) as ApiError;
    const client = api({
      monitoringMatches: vi.fn().mockResolvedValueOnce(page()).mockRejectedValueOnce(unauthorized),
      monitoringMatch: vi.fn().mockResolvedValueOnce(detail()).mockRejectedValueOnce(missing)
    });
    const view = await mount(client);
    const select = view.querySelector<HTMLButtonElement>('[data-testid="open-match-match_1"]')!;
    act(() => select.click());
    await act(async () => undefined);
    expect(view.querySelector('[role="dialog"]')).toBeTruthy();
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="detail-refresh"]')!.click());
    await act(async () => undefined);
    expect(view.querySelector('[role="dialog"]')).toBeNull();
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="matches-refresh"]')!.click());
    await act(async () => undefined);
    expect(view.textContent).toContain("Matching results unavailable");
    expect(view.textContent).not.toContain("match_1");
  });

  it("clears both observations on forbidden and blocks a pending sibling response from restoring either", async () => {
    const pendingList = deferred<Page<MatchRow>>();
    const forbidden = Object.assign(new Error("forbidden"), { status: 403, details: { error: "forbidden" } }) as ApiError;
    const client = api({
      monitoringMatches: vi.fn().mockResolvedValueOnce(page()).mockReturnValueOnce(pendingList.promise),
      monitoringMatch: vi.fn().mockResolvedValueOnce(detail()).mockRejectedValueOnce(forbidden)
    });
    const view = await mount(client);
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="open-match-match_1"]')!.click());
    await act(async () => undefined);
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="matches-refresh"]')!.click());
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="detail-refresh"]')!.click());
    await act(async () => undefined);
    expect(view.querySelector('[role="dialog"]')).toBeNull();
    expect(view.textContent).toContain("Matching results unavailable");
    await act(async () => pendingList.resolve(page([{ ...combined, id: "must_not_return" }])));
    expect(view.textContent).not.toContain("must_not_return");
  });

  it("opens fresh detail with both demand summaries and traps then restores keyboard focus", async () => {
    const client = api();
    const view = await mount(client);
    const trigger = view.querySelector<HTMLButtonElement>('[data-testid="open-match-match_1"]')!;
    trigger.focus();
    act(() => trigger.click());
    await act(async () => undefined);
    const dialog = view.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(client.monitoringMatch).toHaveBeenCalledWith("token", "match_1");
    expect(dialog.textContent).toContain("Passenger request");
    expect(dialog.textContent).toContain("request_1");
    expect(dialog.textContent).toContain("Merchant order");
    expect(dialog.textContent).toContain("order_1");
    expect(dialog.textContent).toContain("Requested passengers");
    expect(dialog.textContent).toContain("Current order parcels");
    expect(dialog.textContent).toContain("Score");
    expect(dialog.textContent).not.toMatch(/confidence|success rate/i);
    const controls = [...dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    controls.at(-1)!.focus();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(controls[0]);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(view.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("invalidates old detail on selection and session changes, and localizes RTL output", async () => {
    const oldDetail = deferred<Observed<MatchRow>>();
    const second = { ...combined, id: "match_2" };
    const client = api({
      monitoringMatches: vi.fn().mockResolvedValue(page([combined, second])),
      monitoringMatch: vi.fn().mockReturnValueOnce(oldDetail.promise).mockResolvedValueOnce(detail(second))
    });
    const view = await mount(client, "ar");
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="open-match-match_1"]')!.click());
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="open-match-match_2"]')!.click());
    await act(async () => undefined);
    await act(async () => oldDetail.resolve(detail(combined)));
    expect(view.querySelector('[role="dialog"]')?.textContent).toContain("match_2");
    expect(view.querySelector('[role="dialog"]')?.textContent).not.toContain("match_1");
    expect(view.querySelector(".matching-results")?.getAttribute("dir")).toBe("rtl");
    expect(view.textContent).toContain("نتائج المطابقة");
    await act(async () => root!.render(<LocaleProvider storage={{ getItem: () => "ar", setItem: () => undefined }}><MatchingResults api={client} token="new-token" /></LocaleProvider>));
    expect(view.querySelector('[role="dialog"]')).toBeNull();
  });

  it("renders unknown future statuses neutrally", async () => {
    const future = { ...combined, status: "future_state" as MatchRow["status"] };
    const view = await mount(api({ monitoringMatches: vi.fn().mockResolvedValue(page([future])) }));
    expect(view.textContent).toContain("Unknown");
    expect(view.querySelector(".badge--neutral")).toBeTruthy();
  });

  it("treats cross-entity status values as Unknown in every nested detail status", async () => {
    const mismatched = {
      ...combined,
      status: "completed" as MatchRow["status"],
      driver_route: { ...combined.driver_route, status: "delivered" as MatchRow["driver_route"]["status"] },
      passenger_request: { ...combined.passenger_request!, status: "assigned" as NonNullable<MatchRow["passenger_request"]>["status"] },
      merchant_order: { ...combined.merchant_order!, status: "accepted" as NonNullable<MatchRow["merchant_order"]>["status"] },
      parcel_batch: { ...combined.parcel_batch!, status: "completed" as NonNullable<MatchRow["parcel_batch"]>["status"] }
    };
    const view = await mount(api({ monitoringMatches: vi.fn().mockResolvedValue(page([mismatched])), monitoringMatch: vi.fn().mockResolvedValue(detail(mismatched)) }));
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="open-match-match_1"]')!.click());
    await act(async () => undefined);
    const dialog = view.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelectorAll(".badge--neutral").length).toBeGreaterThanOrEqual(5);
    expect(dialog.textContent?.match(/Unknown/g)?.length).toBeGreaterThanOrEqual(5);
    expect(dialog.textContent).not.toContain("Completed");
  });

  it("displays the normalized range and explains offset observations", async () => {
    const view = await mount(api());
    expect(view.querySelector('[data-testid="matches-range"]')?.textContent).toContain("Sep 1, 2026");
    expect(view.textContent).toContain("Pages are separate current observations and may shift when records change.");
  });
});
