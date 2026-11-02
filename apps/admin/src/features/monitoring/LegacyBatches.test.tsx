// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, ApiError } from "../../api";
import { LocaleProvider } from "../../i18n/LocaleContext";
import type { Locale } from "../../i18n/translations";
import type { BatchRow, CurrentOrderParcelsPage, Observed, Page, ParcelRow } from "./contracts";
import { LegacyBatches, utcInput } from "./LegacyBatches";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const range = { from: "2026-09-01T00:00:00.000Z", until: "2026-09-08T00:00:00.000Z" };
const batch: BatchRow = {
  id: "b1", status: "assigned", created_at: "2026-09-10T10:00:00.000Z",
  merchant_order: { id: "o1", status: "submitted", parcel_count: 26 },
  selected_driver_route: null
};
const otherBatch: BatchRow = {
  id: "b2", status: "delivered", created_at: "2026-09-09T09:00:00.000Z",
  merchant_order: { id: "o2", status: "assigned", parcel_count: 1 },
  selected_driver_route: { id: "r2", status: "on_trip" }
};
const parcelRows: ParcelRow[] = Array.from({ length: 26 }, (_, index) => ({
  id: `p${String(index + 1).padStart(2, "0")}`,
  status: index === 0 ? "pending" : "delivered"
}));

const batches = (items: BatchRow[] = [batch, otherBatch], observed_at = "2026-09-10T10:01:00.000Z", page = 1, hasMore = false): Page<BatchRow> => ({
  observed_at, scope: "production_supported_legacy",
  data: { items, page, limit: 25, total: items.length + (hasMore ? 25 : 0), has_more: hasMore, range }
});
const detail = (row: BatchRow = batch, observed_at = "2026-09-10T10:02:00.000Z"): Observed<BatchRow> => ({
  observed_at, scope: "production_supported_legacy", data: row
});
const parcels = (page = 1, observed_at = "2026-09-10T10:03:00.000Z", merchantOrderId = "o1"): CurrentOrderParcelsPage => ({
  observed_at, scope: "production_supported_legacy",
  data: {
    items: page === 1 ? parcelRows.slice(0, 25) : parcelRows.slice(25),
    page, limit: 25, total: 26, has_more: page === 1, range: null,
    contents_semantics: "current_eligible_order_contents", merchant_order_id: merchantOrderId
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function api(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    monitoringBatches: vi.fn().mockResolvedValue(batches()),
    monitoringBatch: vi.fn().mockImplementation((_token: string, id: string) => Promise.resolve(detail(id === "b2" ? otherBatch : batch))),
    monitoringParcels: vi.fn().mockImplementation((_token: string, id: string, query: { page: number }) => Promise.resolve(parcels(query.page, undefined, id === "b2" ? "o2" : "o1"))),
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
  await act(async () => root!.render(<LocaleProvider storage={storage}><LegacyBatches api={client} token={token} /></LocaleProvider>));
  return host;
}

function change(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value);
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
});

describe("LegacyBatches", () => {
  it("rejects invalid datetime input without throwing", () => {
    expect(utcInput("not-a-date")).toBeNull();
    expect(utcInput("2026-09-02T00:00")).toBe(new Date("2026-09-02T00:00").toISOString());
  });

  it("renders only safe directory fields and keeps batch and order statuses distinct", async () => {
    const client = api();
    const view = await mount(client);
    expect(client.monitoringBatches).toHaveBeenCalledWith("token", { page: 1, limit: 25 });
    expect(view.textContent).toContain("Legacy batches");
    expect(view.textContent).toContain("Assigned");
    expect(view.textContent).toContain("Delivered");
    expect(view.textContent).toContain("o1");
    expect(view.textContent).toContain("26");
    expect(view.textContent).toContain("No selected route");
    expect(view.textContent).not.toMatch(/completed|savings|timeline|create batch|assign batch/i);
  });

  it("shows independently observed detail and 25 current-order rows before paging to one row", async () => {
    const client = api();
    const view = await mount(client);
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="open-batch-b1"]')!.click());
    await act(async () => undefined);
    const dialog = view.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(client.monitoringBatch).toHaveBeenCalledWith("token", "b1");
    expect(client.monitoringParcels).toHaveBeenCalledWith("token", "b1", { page: 1, limit: 25 });
    expect(dialog.textContent).toContain("Current eligible order contents");
    expect(dialog.textContent).toContain("These are the order’s current eligible parcels and are not guaranteed historical batch members.");
    expect(dialog.textContent).toContain("Assigned");
    expect(dialog.textContent).toContain("Submitted");
    expect(dialog.querySelectorAll("tbody tr")).toHaveLength(25);
    expect(dialog.querySelector('[data-testid="batch-detail-observed"] time')?.getAttribute("datetime")).toBe("2026-09-10T10:02:00.000Z");
    expect(dialog.querySelector('[data-testid="batch-members-observed"] time')?.getAttribute("datetime")).toBe("2026-09-10T10:03:00.000Z");
    act(() => dialog.querySelector<HTMLButtonElement>('[data-testid="members-next"]')!.click());
    await act(async () => undefined);
    expect(client.monitoringParcels).toHaveBeenLastCalledWith("token", "b1", { page: 2, limit: 25 });
    expect(dialog.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(dialog.textContent).toContain("p26");
    expect(dialog.textContent).not.toMatch(/completed|savings|timeline/i);
  });

  it("resets list pages for exact-ID, status, and explicit date filters and localizes validation", async () => {
    const client = api({ monitoringBatches: vi.fn().mockResolvedValue(batches([batch], undefined, 1, true)) });
    const view = await mount(client, "ar");
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="batches-next"]')!.click());
    await act(async () => undefined);
    expect(client.monitoringBatches).toHaveBeenLastCalledWith("token", { page: 2, limit: 25, ...range });
    change(view.querySelector<HTMLSelectElement>('[name="status"]')!, "assigned");
    await act(async () => undefined);
    expect(client.monitoringBatches).toHaveBeenLastCalledWith("token", { page: 1, limit: 25, status: "assigned" });
    change(view.querySelector<HTMLInputElement>('[name="search"]')!, "b1");
    act(() => view.querySelector<HTMLFormElement>('[data-testid="batch-filters"]')!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })));
    await act(async () => undefined);
    expect(client.monitoringBatches).toHaveBeenLastCalledWith("token", { page: 1, limit: 25, status: "assigned", search: "b1" });
    change(view.querySelector<HTMLInputElement>('[name="from"]')!, "2026-09-02T00:00");
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="batches-apply-range"]')!.click());
    expect(view.textContent).toContain("حدد تاريخي النطاق معاً");
    expect(view.querySelector<HTMLInputElement>('[name="from"]')!.value).toBe("2026-09-02T00:00");
    change(view.querySelector<HTMLInputElement>('[name="until"]')!, "2026-09-03T00:00");
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="batches-apply-range"]')!.click());
    await act(async () => undefined);
    expect(client.monitoringBatches).toHaveBeenLastCalledWith("token", expect.objectContaining({
      page: 1, from: new Date("2026-09-02T00:00").toISOString(), until: new Date("2026-09-03T00:00").toISOString()
    }));
    expect(view.querySelector(".legacy-batches")?.getAttribute("dir")).toBe("rtl");
  });

  it("rejects parcel metadata that does not describe the selected order", async () => {
    const mismatched = parcels(1, undefined, "other-order");
    const client = api({ monitoringParcels: vi.fn().mockResolvedValue(mismatched) });
    const view = await mount(client);
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="open-batch-b1"]')!.click());
    await act(async () => undefined);
    const dialog = view.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Current order contents could not be verified.");
    expect(dialog.textContent).not.toContain("p01");
  });

  it("invalidates detail and members together so an old parent cannot repopulate the drawer", async () => {
    const oldDetail = deferred<Observed<BatchRow>>();
    const oldMembers = deferred<CurrentOrderParcelsPage>();
    const client = api({
      monitoringBatch: vi.fn().mockReturnValueOnce(oldDetail.promise).mockResolvedValueOnce(detail(otherBatch)),
      monitoringParcels: vi.fn().mockReturnValueOnce(oldMembers.promise).mockResolvedValueOnce({ ...parcels(1, undefined, "o2"), data: { ...parcels(1, undefined, "o2").data, items: [{ id: "new-parent-parcel", status: "assigned" }], total: 1, has_more: false } })
    });
    const view = await mount(client);
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="open-batch-b1"]')!.click());
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="open-batch-b2"]')!.click());
    await act(async () => undefined);
    await act(async () => oldDetail.resolve(detail(batch)));
    await act(async () => oldMembers.resolve(parcels()));
    const dialog = view.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("b2");
    expect(dialog.textContent).toContain("new-parent-parcel");
    expect(dialog.textContent).not.toContain("p01");
  });

  it("retains members only for a failed same-parent refresh and clears them on member 404", async () => {
    const unavailable = new Error("database unavailable");
    const missing = Object.assign(new Error("not found"), { status: 404 }) as ApiError;
    const client = api({ monitoringParcels: vi.fn().mockResolvedValueOnce(parcels()).mockRejectedValueOnce(unavailable).mockRejectedValueOnce(missing) });
    const view = await mount(client);
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="open-batch-b1"]')!.click());
    await act(async () => undefined);
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="members-refresh"]')!.click());
    await act(async () => undefined);
    expect(view.querySelector('[role="dialog"]')?.textContent).toContain("Showing stale data");
    expect(view.querySelector('[role="dialog"]')?.textContent).toContain("p01");
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="members-refresh"]')!.click());
    await act(async () => undefined);
    expect(view.querySelector('[role="dialog"]')).toBeTruthy();
    expect(view.querySelector('[role="dialog"]')?.textContent).not.toContain("p01");
  });

  it("retains a failed same-query list refresh but clears rows when a changed filter fails", async () => {
    const sameQueryFailure = deferred<Page<BatchRow>>();
    const changedQueryFailure = deferred<Page<BatchRow>>();
    const client = api({ monitoringBatches: vi.fn().mockResolvedValueOnce(batches()).mockReturnValueOnce(sameQueryFailure.promise).mockReturnValueOnce(changedQueryFailure.promise) });
    const view = await mount(client);
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="batches-refresh"]')!.click());
    await act(async () => sameQueryFailure.reject(new Error("refresh unavailable")));
    expect(view.textContent).toContain("Showing stale data");
    expect(view.textContent).toContain("b1");
    change(view.querySelector<HTMLSelectElement>('[name="status"]')!, "assigned");
    expect(view.textContent).not.toContain("b1");
    await act(async () => changedQueryFailure.reject(new Error("filter unavailable")));
    expect(view.textContent).toContain("Legacy batches unavailable");
    expect(view.textContent).not.toContain("b1");
  });

  it("closes only the affected detail on 404 and keeps the directory observation", async () => {
    const missing = Object.assign(new Error("not found"), { status: 404 }) as ApiError;
    const client = api({ monitoringBatch: vi.fn().mockResolvedValueOnce(detail()).mockRejectedValueOnce(missing) });
    const view = await mount(client);
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="open-batch-b1"]')!.click());
    await act(async () => undefined);
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="batch-detail-refresh"]')!.click());
    await act(async () => undefined);
    expect(view.querySelector('[role="dialog"]')).toBeNull();
    expect(view.textContent).toContain("b1");
    expect(view.textContent).toContain("Legacy batches");
  });

  it("clears all domains on forbidden and prevents pending siblings from restoring data", async () => {
    const pendingList = deferred<Page<BatchRow>>();
    const pendingMembers = deferred<CurrentOrderParcelsPage>();
    const forbidden = Object.assign(new Error("forbidden"), { status: 403 }) as ApiError;
    const client = api({
      monitoringBatches: vi.fn().mockResolvedValueOnce(batches()).mockReturnValueOnce(pendingList.promise),
      monitoringBatch: vi.fn().mockResolvedValueOnce(detail()).mockRejectedValueOnce(forbidden),
      monitoringParcels: vi.fn().mockResolvedValueOnce(parcels()).mockReturnValueOnce(pendingMembers.promise)
    });
    const view = await mount(client);
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="open-batch-b1"]')!.click());
    await act(async () => undefined);
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="batches-refresh"]')!.click());
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="members-refresh"]')!.click());
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="batch-detail-refresh"]')!.click());
    await act(async () => undefined);
    expect(view.querySelector('[role="dialog"]')).toBeNull();
    expect(view.textContent).toContain("Legacy batches unavailable");
    await act(async () => pendingList.resolve(batches([{ ...batch, id: "must-not-return" }])));
    await act(async () => pendingMembers.resolve(parcels()));
    expect(view.textContent).not.toContain("must-not-return");
    expect(view.textContent).not.toContain("p01");
  });

  it("reloads the same query for a replacement API and resets filters for a new token", async () => {
    const firstApi = api();
    const view = await mount(firstApi);
    change(view.querySelector<HTMLSelectElement>('[name="status"]')!, "assigned");
    change(view.querySelector<HTMLInputElement>('[name="search"]')!, "b1");
    act(() => view.querySelector<HTMLFormElement>('[data-testid="batch-filters"]')!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })));
    await act(async () => undefined);
    const replacement = api();
    await act(async () => root!.render(<LocaleProvider storage={{ getItem: () => "ar", setItem: () => undefined }}><LegacyBatches api={replacement} token="token" /></LocaleProvider>));
    expect(replacement.monitoringBatches).toHaveBeenCalledWith("token", { page: 1, limit: 25, status: "assigned", search: "b1" });
    const nextSession = api();
    await act(async () => root!.render(<LocaleProvider storage={{ getItem: () => "ar", setItem: () => undefined }}><LegacyBatches api={nextSession} token="next-token" /></LocaleProvider>));
    expect(nextSession.monitoringBatches).toHaveBeenCalledWith("next-token", { page: 1, limit: 25 });
    expect(view.querySelector<HTMLSelectElement>('[name="status"]')!.value).toBe("");
    expect(view.querySelector<HTMLInputElement>('[name="search"]')!.value).toBe("");
  });

  it("traps focus, restores the trigger, and renders future entity statuses as neutral Unknown", async () => {
    const future = {
      ...batch,
      status: "future_batch" as BatchRow["status"],
      merchant_order: { ...batch.merchant_order, status: "accepted" as BatchRow["merchant_order"]["status"] }
    };
    const futureParcels = parcels();
    futureParcels.data.items = [{ id: "future-parcel", status: "future_parcel" as ParcelRow["status"] }];
    futureParcels.data.total = 1;
    futureParcels.data.has_more = false;
    const client = api({ monitoringBatches: vi.fn().mockResolvedValue(batches([future])), monitoringBatch: vi.fn().mockResolvedValue(detail(future)), monitoringParcels: vi.fn().mockResolvedValue(futureParcels) });
    const view = await mount(client);
    const trigger = view.querySelector<HTMLButtonElement>('[data-testid="open-batch-b1"]')!;
    trigger.focus();
    act(() => trigger.click());
    await act(async () => undefined);
    const dialog = view.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelectorAll(".badge--neutral").length).toBeGreaterThanOrEqual(2);
    expect(dialog.textContent?.match(/Unknown/g)?.length).toBeGreaterThanOrEqual(3);
    const controls = [...dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    controls.at(-1)!.focus();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(controls[0]);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(view.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
