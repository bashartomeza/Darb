// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiError, CancellationPage, CancellationRecord, MerchantOrder, PassengerRequest } from "../../api";
import { LocaleProvider } from "../../i18n/LocaleContext";
import type { Locale } from "../../i18n/translations";
import { RequestsBoard } from "../requests/RequestsBoard";
import { CancelDialog } from "./CancelDialog";
import { CancellationsPage, cancellationQuery } from "./CancellationsPage";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function settle() {
  await act(async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  });
}

async function mount(node: ReactNode, locale: Locale = "en") {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const storage = { getItem: () => locale, setItem: () => undefined };
  const documentRef = { documentElement: { lang: "", dir: "" } };
  await act(async () => {
    root?.render(<LocaleProvider storage={storage} documentRef={documentRef}>{node}</LocaleProvider>);
  });
  await settle();
  return host;
}

async function unmountAll() {
  if (root) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
});

function buttonNamed(scope: ParentNode, name: string) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === name);
  if (!button) throw new Error(`No button named ${name}`);
  return button;
}

function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  act(() => {
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
  });
  await settle();
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

function dialog() {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

describe("cancel dialog", () => {
  it("sends nothing until a reason is chosen and the cancellation is confirmed", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    await mount(<CancelDialog open subject="Trip trip_1 and every order on it will be cancelled." onClose={() => undefined} onConfirm={onConfirm} />);

    const box = dialog()!;
    expect(box.textContent).toContain("Trip trip_1 and every order on it will be cancelled.");
    const confirm = buttonNamed(box, "Confirm cancellation");
    expect(confirm.disabled).toBe(true);
    await submit(box.querySelector("form")!);
    expect(onConfirm).not.toHaveBeenCalled();

    choose(box.querySelector<HTMLSelectElement>('select[name="reason"]')!, "safety_concern");
    type(box.querySelector<HTMLTextAreaElement>('textarea[name="note"]')!, "  Reported by the rider  ");
    expect(buttonNamed(box, "Confirm cancellation").disabled).toBe(false);
    await submit(box.querySelector("form")!);

    expect(onConfirm).toHaveBeenCalledWith({ reason: "safety_concern", note: "Reported by the rider" });
  });

  it("offers only the Admin reasons and explains a conflict without closing", async () => {
    const conflict = Object.assign(new Error("request_cannot_be_cancelled"), { status: 409 }) as ApiError;
    const onConfirm = vi.fn().mockRejectedValue(conflict);
    await mount(<CancelDialog open subject="x" onClose={() => undefined} onConfirm={onConfirm} />);

    const box = dialog()!;
    const options = [...box.querySelectorAll<HTMLOptionElement>('select[name="reason"] option')].map((option) => option.value);
    expect(options).toEqual(["", "customer_request", "driver_unavailable", "safety_concern", "duplicate", "policy_violation", "other"]);
    choose(box.querySelector<HTMLSelectElement>('select[name="reason"]')!, "duplicate");
    await submit(box.querySelector("form")!);

    expect(onConfirm).toHaveBeenCalledWith({ reason: "duplicate" });
    expect(dialog()!.textContent).toContain("It changed in the meantime and cannot be cancelled now.");
  });

  it("is written in Arabic for an Arabic console", async () => {
    await mount(<CancelDialog open subject="x" onClose={() => undefined} onConfirm={vi.fn()} />, "ar");
    expect(dialog()!.textContent).toContain("إلغاء مع ذكر السبب");
    expect(dialog()!.textContent).toContain("مخاوف تتعلق بالسلامة");
  });
});

describe("requests board cancellation", () => {
  const request: PassengerRequest = {
    id: "request_1",
    status: "accepted",
    pickup_label: "Hebron",
    destination_label: "Bethlehem",
    passenger_count: 1,
    passenger: { id: "passenger_1", name: "Rana", phone: "+970599000111" } as PassengerRequest["passenger"]
  } as PassengerRequest;
  const finished = { ...request, id: "request_2", status: "completed" } as PassengerRequest;
  const order = { id: "order_1", status: "batched", pickup_label: "Hebron", merchant: { id: "merchant_1", name: "Shop" }, parcels: [] } as unknown as MerchantOrder;

  function boardApi() {
    return {
      requests: vi.fn().mockResolvedValue({ requests: [request, finished], page: 1, limit: 25, total: 2 }),
      orders: vi.fn().mockResolvedValue({ orders: [order], page: 1, limit: 25, total: 1 }),
      cancelPassengerRequest: vi.fn().mockResolvedValue({ cancelled: true }),
      cancelMerchantOrder: vi.fn().mockResolvedValue({ cancelled: true })
    };
  }

  it("cancels an unfinished ride request with a reason and reads the lists again", async () => {
    const cancelApi = boardApi();
    const page = await mount(<RequestsBoard api={cancelApi as never} token="admin-token" search="" />);

    // Only the unfinished request and the open order can be cancelled.
    expect([...page.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "Cancel request")).toHaveLength(1);
    await click(buttonNamed(page, "Cancel request"));
    expect(dialog()!.textContent).toContain("Ride request request_1 from Rana will be cancelled.");
    expect(cancelApi.cancelPassengerRequest).not.toHaveBeenCalled();

    choose(dialog()!.querySelector<HTMLSelectElement>('select[name="reason"]')!, "customer_request");
    await submit(dialog()!.querySelector("form")!);

    expect(cancelApi.cancelPassengerRequest).toHaveBeenCalledWith("admin-token", "request_1", { reason: "customer_request" });
    // The lists are read again after the cancellation.
    expect(cancelApi.requests).toHaveBeenCalledTimes(2);
    expect(cancelApi.orders).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();

    await click(buttonNamed(page, "Cancel order"));
    expect(dialog()!.textContent).toContain("Only merchant order order_1 from Shop will be cancelled.");
  });

  it("shows no cancel action without the cancel API or while actions are blocked", async () => {
    const { cancelPassengerRequest: _a, cancelMerchantOrder: _b, ...readOnly } = boardApi();
    const withoutCancel = await mount(<RequestsBoard api={readOnly as never} token="admin-token" search="" />);
    expect(withoutCancel.textContent).not.toContain("Cancel request");
    await unmountAll();
    const blocked = await mount(<RequestsBoard api={boardApi() as never} token="admin-token" search="" canAct={false} />);
    expect(blocked.textContent).not.toContain("Cancel request");
  });
});

describe("cancellation history", () => {
  function record(id: string, overrides: Partial<CancellationRecord> = {}): CancellationRecord {
    return {
      id,
      created_at: "2026-11-12T10:00:00.000Z",
      kind: "automatic",
      by_role: "system",
      by: null,
      reason: "no_driver_in_time",
      note: null,
      outcome: "cancelled",
      trip_id: null,
      order: { type: "ride", id: `request_${id}`, status: "cancelled", owner: { id: "passenger_1", name: "Rana" } },
      ...overrides
    };
  }

  function pageOf(rows: CancellationRecord[], next: string | null): CancellationPage {
    return { cancellations: rows, next_cursor: next, reasons: {} };
  }

  it("lists cancellations, sends the filters and loads more with the cursor", async () => {
    const api = {
      cancellations: vi.fn()
        .mockResolvedValueOnce(pageOf([record("c3"), record("c2", { kind: "manual", by_role: "driver", by: { id: "driver_1", name: "Sami" }, reason: "vehicle_problem", note: "Flat tyre", outcome: "requeued", trip_id: "trip_9" })], "c2"))
        .mockResolvedValueOnce(pageOf([record("c1", { kind: "manual", by_role: "admin", by: { id: "admin_1", name: "Ops" }, reason: "safety_concern" })], null))
        .mockResolvedValueOnce(pageOf([record("c0", { order: { type: "parcel", id: "order_7", status: "cancelled", owner: { id: "p2", name: "Lina" } } })], null))
    };
    const page = await mount(<CancellationsPage api={api} token="admin-token" />);

    expect(api.cancellations).toHaveBeenNthCalledWith(1, "admin-token", { limit: 50 });
    expect(page.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(page.textContent).toContain("No driver accepted in time");
    expect(page.textContent).toContain("Vehicle problem");
    expect(page.textContent).toContain("Flat tyre");
    expect(page.textContent).toContain("Back to waiting for a driver");
    expect(page.textContent).toContain("Sami");

    await click(buttonNamed(page, "Load more"));
    expect(api.cancellations).toHaveBeenNthCalledWith(2, "admin-token", { cursor: "c2", limit: 50 });
    expect(page.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(page.textContent).toContain("Safety concern");
    expect(page.textContent).not.toContain("Load more");

    const filters = page.querySelector<HTMLFormElement>("form")!;
    type(filters.querySelector<HTMLInputElement>('input[name="from"]')!, "2026-11-01");
    type(filters.querySelector<HTMLInputElement>('input[name="to"]')!, "2026-11-12");
    choose(filters.querySelector<HTMLSelectElement>('select[name="kind"]')!, "automatic");
    choose(filters.querySelector<HTMLSelectElement>('select[name="role"]')!, "system");
    choose(filters.querySelector<HTMLSelectElement>('select[name="reason"]')!, "no_driver_in_time");
    await submit(filters);

    expect(api.cancellations).toHaveBeenNthCalledWith(3, "admin-token", {
      from: "2026-11-01",
      to: "2026-11-12T23:59:59.999Z",
      kind: "automatic",
      role: "system",
      reason: "no_driver_in_time",
      limit: 50
    });
    expect(page.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(page.textContent).toContain("Passenger parcel · Lina");
  });

  it("offers every reason code as a filter and reads in Arabic", async () => {
    const api = { cancellations: vi.fn().mockResolvedValue(pageOf([], null)) };
    const page = await mount(<CancellationsPage api={api} token="admin-token" />, "ar");

    const reasons = [...page.querySelectorAll<HTMLOptionElement>('select[name="reason"] option')].map((option) => option.value).filter(Boolean);
    expect(reasons).toHaveLength(16);
    expect(reasons).toEqual(expect.arrayContaining(["no_driver_in_time", "vehicle_problem", "route_changed", "safety_concern", "other"]));
    expect(page.textContent).toContain("سجل الإلغاءات");
    expect(page.textContent).toContain("لا توجد إلغاءات تطابق هذه المرشحات.");
  });

  it("builds an empty query as just the page size", () => {
    expect(cancellationQuery({ from: "", to: "", kind: "", role: "", reason: "" })).toEqual({ limit: 50 });
  });
});
