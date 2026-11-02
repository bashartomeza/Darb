// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminOperatingRoute, ApiError, OperatingCity } from "../../api";
import { LocaleProvider } from "../../i18n/LocaleContext";
import type { Locale } from "../../i18n/translations";
import { OperatingRoutesPage, type OperatingRoutesApi } from "./OperatingRoutesPage";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const hebron: OperatingCity = { id: "city_hebron", name_ar: "الخليل", name_en: "Hebron", latitude: 31.5326, longitude: 35.0998 };
const bethlehem: OperatingCity = { id: "city_bethlehem", name_ar: "بيت لحم", name_en: "Bethlehem", latitude: 31.7054, longitude: 35.2024 };
const ramallah: OperatingCity = { id: "city_ramallah", name_ar: "رام الله", name_en: "Ramallah", latitude: 31.9038, longitude: 35.2034 };
const nablus: OperatingCity = { id: "city_nablus", name_ar: "نابلس", name_en: "Nablus", latitude: 32.2211, longitude: 35.2544 };

function route(origin: OperatingCity, destination: OperatingCity, overrides: Partial<AdminOperatingRoute> = {}): AdminOperatingRoute {
  return {
    id: `route_${origin.name_en}_${destination.name_en}`.toLowerCase(),
    route_key: `${origin.name_en}-to-${destination.name_en}`.toLowerCase(),
    name_ar: `${origin.name_ar} ← ${destination.name_ar}`,
    name_en: `${origin.name_en} → ${destination.name_en}`,
    origin,
    destination,
    active: true,
    orders_count: 0,
    ...overrides
  };
}

const hebronToBethlehem = route(hebron, bethlehem, { orders_count: 12 });
const bethlehemToHebron = route(bethlehem, hebron, { orders_count: 3 });
const ramallahToNablus = route(ramallah, nablus, { active: false, orders_count: 0 });

function apiError(status: number, message: string) {
  const error = new Error(message) as ApiError;
  error.status = status;
  return error;
}

function fakeApi(overrides: Partial<Record<keyof OperatingRoutesApi, unknown>> = {}) {
  return {
    operatingRoutes: vi.fn().mockResolvedValue({ routes: [hebronToBethlehem, bethlehemToHebron, ramallahToNablus] }),
    operatingCities: vi.fn().mockResolvedValue({ cities: [hebron, bethlehem, ramallah, nablus] }),
    setOperatingRouteActive: vi.fn().mockResolvedValue({}),
    createOperatingRoute: vi.fn().mockResolvedValue({}),
    createOperatingCity: vi.fn().mockResolvedValue({}),
    ...overrides
  } as unknown as OperatingRoutesApi & Record<keyof OperatingRoutesApi, ReturnType<typeof vi.fn>>;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function settle() {
  await act(async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  });
}

async function mount(api: OperatingRoutesApi, options: { locale?: Locale; search?: string; advancedHref?: string | null } = {}) {
  const locale = options.locale ?? "en";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const storage = { getItem: () => locale, setItem: () => undefined };
  const documentRef = { documentElement: { lang: "", dir: "" } };
  await act(async () => {
    root?.render(
      <LocaleProvider storage={storage} documentRef={documentRef}>
        <OperatingRoutesPage api={api} token="admin-token" search={options.search} advancedHref={options.advancedHref} />
      </LocaleProvider>
    );
  });
  await settle();
  return host;
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

function dialog() {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function rows(scope: ParentNode) {
  return [...scope.querySelectorAll<HTMLTableRowElement>("tbody tr")];
}

function switchFor(scope: ParentNode, routeId: string) {
  return scope.querySelector<HTMLButtonElement>(`[role="switch"][data-route-id="${routeId}"]`)!;
}

function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

describe("Routes page", () => {
  it("lists every route with its name, cities, status and orders count", async () => {
    const api = fakeApi();
    const page = await mount(api);

    expect(api.operatingRoutes).toHaveBeenCalledWith("admin-token");
    expect(api.operatingCities).toHaveBeenCalledWith("admin-token");
    const table = rows(page);
    expect(table).toHaveLength(3);
    expect(table[0].textContent).toContain("Hebron → Bethlehem");
    expect(table[0].textContent).toContain("hebron-to-bethlehem");
    expect(table[0].textContent).toContain("Active");
    expect(table[0].textContent).toContain("12");
    expect(table[2].textContent).toContain("Turned off");
    expect(switchFor(page, hebronToBethlehem.id).getAttribute("aria-checked")).toBe("true");
    expect(switchFor(page, ramallahToNablus.id).getAttribute("aria-checked")).toBe("false");
    expect(switchFor(page, ramallahToNablus.id).getAttribute("aria-label")).toBe("Turn on Ramallah → Nablus");
    expect(page.textContent).toContain("2 active · 1 turned off");
  });

  it("shows Arabic route and city names in an RTL page when the UI is Arabic", async () => {
    const page = await mount(fakeApi(), { locale: "ar" });
    const container = page.querySelector<HTMLElement>(".operating-routes")!;
    expect(container.getAttribute("dir")).toBe("rtl");
    expect(rows(page)[0].textContent).toContain("الخليل ← بيت لحم");
    expect(rows(page)[0].textContent).toContain("نشط");
    expect(rows(page)[2].textContent).toContain("متوقف");
    expect(page.textContent).toContain("إضافة مسار");
  });

  it("filters by city, by status and by the top-bar search", async () => {
    const page = await mount(fakeApi());
    choose(page.querySelector<HTMLSelectElement>('select[name="city_filter"]')!, nablus.id);
    expect(rows(page).map((row) => row.textContent)).toEqual([expect.stringContaining("Ramallah → Nablus")]);

    choose(page.querySelector<HTMLSelectElement>('select[name="city_filter"]')!, "");
    choose(page.querySelector<HTMLSelectElement>('select[name="status_filter"]')!, "active");
    expect(rows(page)).toHaveLength(2);

    choose(page.querySelector<HTMLSelectElement>('select[name="status_filter"]')!, "off");
    choose(page.querySelector<HTMLSelectElement>('select[name="city_filter"]')!, hebron.id);
    expect(rows(page)).toHaveLength(0);
    expect(page.textContent).toContain("No routes match your search or filters.");

    if (root) act(() => root?.unmount());
    document.body.replaceChildren();
    const searched = await mount(fakeApi(), { search: "بيت لحم" });
    expect(rows(searched)).toHaveLength(2);
  });

  it("shows loading, then an error with a working retry", async () => {
    let resolveRoutes: (value: unknown) => void = () => undefined;
    const api = fakeApi({
      operatingRoutes: vi.fn()
        .mockRejectedValueOnce(new Error("Failed to fetch"))
        .mockImplementationOnce(() => new Promise((resolve) => { resolveRoutes = resolve; }))
    });
    const page = await mount(api);

    expect(page.textContent).toContain("Routes could not be loaded.");
    await act(async () => buttonNamed(page, "Retry").click());
    expect(page.querySelector('[role="status"][aria-label="Loading routes…"]')).not.toBeNull();

    await act(async () => resolveRoutes({ routes: [hebronToBethlehem] }));
    await settle();
    expect(rows(page)).toHaveLength(1);
    expect(api.operatingRoutes).toHaveBeenCalledTimes(2);
  });

  it("shows an empty state that offers to add the first route", async () => {
    const page = await mount(fakeApi({ operatingRoutes: vi.fn().mockResolvedValue({ routes: [] }) }));
    expect(page.textContent).toContain("No routes yet.");
    act(() => buttonNamed(page.querySelector(".empty")!, "Add route").click());
    expect(dialog()?.textContent).toContain("Origin city");
  });

  it("asks for confirmation before turning a route off and explains existing orders continue", async () => {
    const api = fakeApi();
    const page = await mount(api);

    act(() => switchFor(page, hebronToBethlehem.id).click());
    expect(api.setOperatingRouteActive).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("Turn this route off?");
    expect(dialog()?.textContent).toContain("won't be able to choose “Hebron → Bethlehem” for new orders");
    expect(dialog()?.textContent).toContain("Existing orders and trips on this route continue");

    act(() => buttonNamed(dialog()!, "Cancel").click());
    expect(dialog()).toBeNull();
    expect(api.setOperatingRouteActive).not.toHaveBeenCalled();

    act(() => switchFor(page, hebronToBethlehem.id).click());
    await act(async () => buttonNamed(dialog()!, "Turn off route").click());
    await settle();

    expect(api.setOperatingRouteActive).toHaveBeenCalledWith("admin-token", hebronToBethlehem.id, false);
    expect(dialog()).toBeNull();
    expect(page.textContent).toContain("Hebron → Bethlehem is turned off. Existing orders continue.");
    expect(api.operatingRoutes).toHaveBeenCalledTimes(2);
  });

  it("turns a route back on without a confirmation and reports failures", async () => {
    const api = fakeApi({
      setOperatingRouteActive: vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(apiError(500, "internal_error"))
    });
    const page = await mount(api);

    await act(async () => switchFor(page, ramallahToNablus.id).click());
    await settle();
    expect(dialog()).toBeNull();
    expect(api.setOperatingRouteActive).toHaveBeenCalledWith("admin-token", ramallahToNablus.id, true);
    expect(page.textContent).toContain("Ramallah → Nablus is on and available for new orders.");

    await act(async () => switchFor(page, ramallahToNablus.id).click());
    await settle();
    expect(page.textContent).toContain("The route status could not be changed. Try again.");
  });

  it("adds a route with its return direction by default", async () => {
    const api = fakeApi();
    const page = await mount(api);
    act(() => buttonNamed(page, "Add route").click());

    const form = document.querySelector<HTMLFormElement>("#add-operating-route-form")!;
    const bothDirections = form.querySelector<HTMLInputElement>('input[name="both_directions"]')!;
    expect(bothDirections.checked).toBe(true);
    expect(form.textContent).toContain("Also create the return direction");

    choose(form.querySelector<HTMLSelectElement>('select[name="origin_city_id"]')!, hebron.id);
    choose(form.querySelector<HTMLSelectElement>('select[name="destination_city_id"]')!, ramallah.id);
    expect(form.textContent).toContain("Hebron → Ramallah");
    expect(form.textContent).toContain("Ramallah → Hebron");
    await submit(form);

    expect(api.createOperatingRoute).toHaveBeenCalledWith("admin-token", {
      origin_city_id: hebron.id,
      destination_city_id: ramallah.id,
      both_directions: true
    });
    expect(dialog()).toBeNull();
    expect(page.textContent).toContain("Route and its return direction added");
    expect(api.operatingRoutes).toHaveBeenCalledTimes(2);
  });

  it("can add a single direction only", async () => {
    const api = fakeApi();
    const page = await mount(api);
    act(() => buttonNamed(page, "Add route").click());
    const form = document.querySelector<HTMLFormElement>("#add-operating-route-form")!;
    choose(form.querySelector<HTMLSelectElement>('select[name="origin_city_id"]')!, nablus.id);
    choose(form.querySelector<HTMLSelectElement>('select[name="destination_city_id"]')!, hebron.id);
    act(() => form.querySelector<HTMLInputElement>('input[name="both_directions"]')!.click());
    expect(form.textContent).not.toContain("Hebron → Nablus");
    await submit(form);

    expect(api.createOperatingRoute).toHaveBeenCalledWith("admin-token", {
      origin_city_id: nablus.id,
      destination_city_id: hebron.id,
      both_directions: false
    });
    expect(page.textContent).toContain("Route added and available for new orders.");
  });

  it("blocks the same city, missing cities and routes already listed", async () => {
    const api = fakeApi();
    const page = await mount(api);
    act(() => buttonNamed(page, "Add route").click());
    const form = document.querySelector<HTMLFormElement>("#add-operating-route-form")!;

    await submit(form);
    expect(form.textContent).toContain("Choose an origin city and a destination city.");

    choose(form.querySelector<HTMLSelectElement>('select[name="origin_city_id"]')!, hebron.id);
    choose(form.querySelector<HTMLSelectElement>('select[name="destination_city_id"]')!, hebron.id);
    await submit(form);
    expect(form.textContent).toContain("The destination must be a different city from the origin.");

    choose(form.querySelector<HTMLSelectElement>('select[name="destination_city_id"]')!, bethlehem.id);
    await submit(form);
    expect(form.textContent).toContain("This route is already in the list.");
    expect(api.createOperatingRoute).not.toHaveBeenCalled();
  });

  it("explains a 409 route_exists from the server and keeps the dialog open", async () => {
    const api = fakeApi({ createOperatingRoute: vi.fn().mockRejectedValue(apiError(409, "route_exists")) });
    const page = await mount(api);
    act(() => buttonNamed(page, "Add route").click());
    const form = document.querySelector<HTMLFormElement>("#add-operating-route-form")!;
    choose(form.querySelector<HTMLSelectElement>('select[name="origin_city_id"]')!, nablus.id);
    choose(form.querySelector<HTMLSelectElement>('select[name="destination_city_id"]')!, ramallah.id);
    await submit(form);

    expect(api.createOperatingRoute).toHaveBeenCalledTimes(1);
    expect(dialog()).not.toBeNull();
    expect(dialog()?.textContent).toContain("This route (or its return direction) already exists.");
    // The list is reloaded behind the dialog so the existing route shows up.
    expect(api.operatingRoutes).toHaveBeenCalledTimes(2);

    // Editing the form clears the message about the previous submission.
    choose(form.querySelector<HTMLSelectElement>('select[name="destination_city_id"]')!, hebron.id);
    expect(dialog()?.textContent).not.toContain("already exists");
  });

  it("validates a new city against the service area before sending it", async () => {
    const api = fakeApi();
    const page = await mount(api);
    act(() => buttonNamed(page, "Add city").click());
    const form = document.querySelector<HTMLFormElement>("#add-operating-city-form")!;
    const field = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;

    await submit(form);
    expect(form.textContent).toContain("Enter the city name in Arabic and English");

    type(field("name_ar"), "جنين");
    type(field("name_en"), "Jenin");
    type(field("latitude"), "34.1");
    type(field("longitude"), "35.29");
    await submit(form);
    expect(form.textContent).toContain("Latitude must be a number between 29.4 and 33.4.");

    type(field("latitude"), "32.46");
    type(field("longitude"), "36.5");
    await submit(form);
    expect(form.textContent).toContain("Longitude must be a number between 34.2 and 35.95.");

    type(field("longitude"), "abc");
    await submit(form);
    expect(form.textContent).toContain("Longitude must be a number between 34.2 and 35.95.");
    expect(api.createOperatingCity).not.toHaveBeenCalled();
  });

  it("adds a city and offers it in the route city selects", async () => {
    const jenin: OperatingCity = { id: "city_jenin", name_ar: "جنين", name_en: "Jenin", latitude: 32.4637, longitude: 35.2938 };
    const api = fakeApi({
      createOperatingCity: vi.fn().mockResolvedValue({ city: jenin }),
      operatingCities: vi.fn()
        .mockResolvedValueOnce({ cities: [hebron, bethlehem, ramallah, nablus] })
        .mockResolvedValue({ cities: [hebron, bethlehem, ramallah, nablus, jenin] })
    });
    const page = await mount(api);
    act(() => buttonNamed(page, "Add city").click());
    const form = document.querySelector<HTMLFormElement>("#add-operating-city-form")!;
    const field = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    type(field("name_ar"), " جنين ");
    type(field("name_en"), "Jenin");
    type(field("latitude"), "32.4637");
    type(field("longitude"), "35.2938");
    await submit(form);

    expect(api.createOperatingCity).toHaveBeenCalledWith("admin-token", { name_ar: "جنين", name_en: "Jenin", latitude: 32.4637, longitude: 35.2938 });
    expect(dialog()).toBeNull();
    expect(page.textContent).toContain("Jenin added. You can now choose it when adding a route.");

    act(() => buttonNamed(page, "Add route").click());
    const origin = document.querySelector<HTMLSelectElement>('select[name="origin_city_id"]')!;
    expect([...origin.options].map((option) => option.textContent)).toContain("Jenin");
  });

  it("shows a duplicate city error from the server", async () => {
    const api = fakeApi({ createOperatingCity: vi.fn().mockRejectedValue(apiError(409, "city_exists")) });
    const page = await mount(api);
    act(() => buttonNamed(page, "Add city").click());
    const form = document.querySelector<HTMLFormElement>("#add-operating-city-form")!;
    const field = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    type(field("name_ar"), "الخليل");
    type(field("name_en"), "Hebron");
    type(field("latitude"), "31.5326");
    type(field("longitude"), "35.0998");
    await submit(form);
    expect(dialog()?.textContent).toContain("A city with this name already exists.");
  });

  it("links to the older route workspace only when one is available", async () => {
    const withLink = await mount(fakeApi(), { advancedHref: "#/routes/advanced" });
    expect(withLink.querySelector('a[href="#/routes/advanced"]')?.textContent).toBe("Advanced route editor (stops, fares, versions)");
    if (root) act(() => root?.unmount());
    document.body.replaceChildren();
    const withoutLink = await mount(fakeApi());
    expect(withoutLink.querySelector('a[href="#/routes/advanced"]')).toBeNull();
  });
});
