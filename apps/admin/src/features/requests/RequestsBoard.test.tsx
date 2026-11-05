// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { MerchantOrder, PassengerRequest } from "../../api";
import { buttonNamed, click, mount, unmount } from "../../testing/mount";
import { DELIVERIES_PAGE_SIZE, RequestsBoard, type RequestsBoardApi } from "./RequestsBoard";

const routed: PassengerRequest = {
  id: "request_1",
  status: "pending",
  pickup_label: "Hebron",
  destination_label: "Bethlehem",
  passenger_count: 1,
  service_route_id: "route_1",
  route_name_ar: "الخليل ← بيت لحم",
  route_name_en: "Hebron → Bethlehem",
  pickup_details: "near the PPU main gate",
  dropoff_details: "Bethlehem bus station"
};
const legacy: PassengerRequest = { id: "request_0", status: "pending", pickup_label: "Hebron / PPU", destination_label: "Bethlehem", passenger_count: 2, route_name_ar: null, route_name_en: null, pickup_details: null, dropoff_details: null };
const order: MerchantOrder = {
  id: "order_1",
  status: "pending",
  pickup_label: "Hebron",
  pickup_details: "store, Ein Sarah street",
  route_name_ar: "الخليل ← بيت لحم",
  route_name_en: "Hebron → Bethlehem",
  parcels: [
    { id: "p1", status: "pending", destination_label: "Bethlehem", size: "S", priority: "normal", dropoff_details: "Manger Square shop" },
    { id: "p2", status: "pending", destination_label: "Bethlehem", size: "S", priority: "normal", dropoff_details: null }
  ]
};

function fakeApi(overrides: Partial<Record<keyof RequestsBoardApi, unknown>> = {}) {
  return {
    requests: vi.fn().mockResolvedValue({ requests: [routed, legacy], page: 1, limit: DELIVERIES_PAGE_SIZE, total: 2 }),
    orders: vi.fn().mockResolvedValue({ orders: [order], page: 1, limit: DELIVERIES_PAGE_SIZE, total: 1 }),
    ...overrides
  } as unknown as RequestsBoardApi & Record<keyof RequestsBoardApi, ReturnType<typeof vi.fn>>;
}

afterEach(unmount);

describe("deliveries board", () => {
  it("loads its own first page of requests and orders and shows route details", async () => {
    const api = fakeApi();
    const host = await mount(<RequestsBoard api={api} token="t" search="" />);

    expect(api.requests).toHaveBeenCalledWith("t", { page: 1, limit: DELIVERIES_PAGE_SIZE, search: "" });
    expect(api.orders).toHaveBeenCalledWith("t", { page: 1, limit: DELIVERIES_PAGE_SIZE, search: "" });
    const text = host.textContent ?? "";
    expect(text).toContain("near the PPU main gate");
    expect(text).toContain("Bethlehem bus station");
    expect(text).toContain("store, Ein Sarah street");
    expect(text).toContain("Manger Square shop");
    expect(text).toContain("Hebron / PPU");
  });

  it("sends the search to the API so it covers every page", async () => {
    const api = fakeApi();
    await mount(<RequestsBoard api={api} token="t" search="  bus station " />);
    expect(api.requests).toHaveBeenCalledWith("t", { page: 1, limit: DELIVERIES_PAGE_SIZE, search: "bus station" });
  });

  it("pages through every request using the returned total", async () => {
    const api = fakeApi({
      requests: vi.fn().mockResolvedValue({ requests: [routed], page: 1, limit: DELIVERIES_PAGE_SIZE, total: DELIVERIES_PAGE_SIZE * 2 + 1 })
    });
    const host = await mount(<RequestsBoard api={api} token="t" search="" />);
    expect(host.textContent).toContain("Page 1 of 3");

    await click(buttonNamed(host, "Next"));
    expect(api.requests).toHaveBeenLastCalledWith("t", { page: 2, limit: DELIVERIES_PAGE_SIZE, search: "" });
    expect(api.orders).toHaveBeenCalledTimes(1);
  });

  it("shows a loading state, then an error with retry that does not depend on the overview", async () => {
    let fail = true;
    const api = fakeApi({
      requests: vi.fn(() => (fail ? Promise.reject(new Error("offline")) : Promise.resolve({ requests: [routed], page: 1, limit: 25, total: 1 })))
    });
    const host = await mount(<RequestsBoard api={api} token="t" search="" />);

    expect(host.textContent).toContain("This section could not be loaded");
    expect(host.textContent).toContain("Manger Square shop");

    fail = false;
    await click(buttonNamed(host, "Retry"));
    expect(host.textContent).toContain("near the PPU main gate");
  });

  it("refreshes a list on demand and shows empty states", async () => {
    const api = fakeApi({
      requests: vi.fn().mockResolvedValue({ requests: [], page: 1, limit: 25, total: 0 }),
      orders: vi.fn().mockResolvedValue({ orders: [], page: 1, limit: 25, total: 0 })
    });
    const host = await mount(<RequestsBoard api={api} token="t" search="" />);
    expect(host.textContent).toContain("No requests");
    expect(host.textContent).toContain("No orders");

    const [refreshRequests] = [...host.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.textContent?.includes("Refresh Data"));
    await click(refreshRequests);
    expect(api.requests).toHaveBeenCalledTimes(2);
  });
});
