// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiError, MapPlace, MapPlaceReport } from "../../api";
import { buttonNamed, click, dialog, inputNamed, mount, settle, type, unmount } from "../../testing/mount";
import {
  MAP_PLACES_PAGE_SIZE,
  MapPlacesPage,
  emptyPlaceForm,
  placeDraftFrom,
  placeUpdateFrom,
  validatePlaceForm,
  type MapPlacesApi
} from "./MapPlacesPage";

const cafe: MapPlace = {
  id: "place_1",
  category: "cafe",
  name_ar: "مقهى الأمل",
  name_en: null,
  latitude: 31.9,
  longitude: 35.2,
  phone: null,
  opening_hours: "Mo-Su 08:00-22:00",
  city: "ramallah",
  source: "osm",
  osm_id: "node/1",
  active: true,
  admin_edited: false,
  created_at: "2026-11-04T08:00:00.000Z",
  updated_at: "2026-11-04T08:00:00.000Z"
};

const report: MapPlaceReport = {
  id: "report_1",
  reason: "closed",
  note: "shut since June",
  status: "open",
  created_at: "2026-11-04T09:00:00.000Z",
  resolved_at: null,
  place: cafe
};

function apiError(status: number, message: string) {
  const error = new Error(message) as ApiError;
  error.status = status;
  return error;
}

function fakeApi(overrides: Partial<Record<keyof MapPlacesApi, unknown>> = {}) {
  return {
    mapPlaces: vi.fn().mockResolvedValue({ places: [cafe], page: 1, limit: MAP_PLACES_PAGE_SIZE, total: 1 }),
    mapPlaceSummary: vi.fn().mockResolvedValue({ by_category: { cafe: { active: 7, inactive: 1 } }, by_city: { ramallah: 7 } }),
    createMapPlace: vi.fn().mockResolvedValue({ place: cafe }),
    updateMapPlace: vi.fn().mockResolvedValue({ place: { ...cafe, active: false } }),
    mapPlaceReports: vi.fn().mockResolvedValue({ reports: [report], page: 1, limit: 20, total: 1 }),
    reviewMapPlaceReport: vi.fn().mockResolvedValue({ report: { id: "report_1", status: "resolved" } }),
    ...overrides
  } as unknown as MapPlacesApi & Record<keyof MapPlacesApi, ReturnType<typeof vi.fn>>;
}

async function submit(form: HTMLFormElement) {
  await click(form.querySelector<HTMLButtonElement>('button[type="submit"]')!);
  await settle();
}

afterEach(unmount);

describe("map place form rules", () => {
  const form = { ...emptyPlaceForm(), name_ar: "صيدلية", latitude: "31.95", longitude: "35.2" };

  it("validates a form the way the API does", () => {
    expect(validatePlaceForm(form)).toBeNull();
    expect(validatePlaceForm({ ...form, name_ar: " " })).toBe("names");
    expect(validatePlaceForm({ ...form, name_ar: "", name_en: "Pharmacy" })).toBeNull();
    expect(validatePlaceForm({ ...form, latitude: "abc" })).toBe("coordinates");
    expect(validatePlaceForm({ ...form, latitude: "35.2", longitude: "31.95" })).toBe("outside_area");
    expect(validatePlaceForm({ ...form, phone: "call me" })).toBe("phone");
    expect(placeDraftFrom({ ...form, phone: " +970 2 123 4567 " })).toMatchObject({ category: "cafe", name_ar: "صيدلية", name_en: null, latitude: 31.95, phone: "+970 2 123 4567" });
  });

  it("sends only the fields that changed", () => {
    const edited = { ...emptyPlaceForm(), category: "cafe", name_ar: "مقهى الأمل", latitude: "31.9", longitude: "35.3", phone: "", opening_hours: "Mo-Su 08:00-22:00" };
    expect(placeUpdateFrom(edited, cafe)).toEqual({ longitude: 35.3 });
  });
});

describe("map places page", () => {
  it("lists places, the per-category counts and open reports", async () => {
    const api = fakeApi();
    const host = await mount(<MapPlacesPage api={api} token="t" search="" />);
    expect(api.mapPlaces).toHaveBeenCalledWith("t", { search: "", category: "", active: undefined, page: 1, limit: MAP_PLACES_PAGE_SIZE });
    const text = host.textContent ?? "";
    expect(text).toContain("مقهى الأمل");
    expect(text).toContain("31.900000, 35.200000");
    expect(text).toContain("OpenStreetMap");
    expect(text).toContain("shut since June");
    expect(text).toContain("Permanently closed");
  });

  it("disables a place with one click", async () => {
    const api = fakeApi();
    const host = await mount(<MapPlacesPage api={api} token="t" search="" />);
    await click(buttonNamed(host, "Disable"));
    expect(api.updateMapPlace).toHaveBeenCalledWith("t", "place_1", { active: false });
    expect(host.textContent).toContain("The place was saved.");
  });

  it("adds a place by hand and refuses one outside the West Bank before calling the API", async () => {
    const api = fakeApi();
    const host = await mount(<MapPlacesPage api={api} token="t" search="" />);
    await click(buttonNamed(host, "Add place"));
    const form = dialog()!.querySelector("form")!;
    await type(inputNamed(form, "name_ar"), "صيدلية الشفاء");
    await type(inputNamed(form, "latitude"), "35.25");
    await type(inputNamed(form, "longitude"), "32.15");
    await submit(form);
    expect(api.createMapPlace).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("outside the West Bank");

    await type(inputNamed(form, "latitude"), "32.15");
    await type(inputNamed(form, "longitude"), "35.25");
    await submit(form);
    expect(api.createMapPlace).toHaveBeenCalledWith("t", expect.objectContaining({ name_ar: "صيدلية الشفاء", latitude: 32.15, longitude: 35.25 }));
    expect(dialog()).toBeNull();
    expect(host.textContent).toContain("The place was added.");
  });

  it("shows an error when the server rejects an edit", async () => {
    const api = fakeApi({ updateMapPlace: vi.fn().mockRejectedValue(apiError(404, "map_place_not_found")) });
    const host = await mount(<MapPlacesPage api={api} token="t" search="" />);
    await click(buttonNamed(host, "Edit"));
    const form = dialog()!.querySelector("form")!;
    await type(inputNamed(form, "latitude"), "31.91");
    await submit(form);
    expect(dialog()?.textContent).toContain("no longer exists");
  });

  it("works through a report: disable the place and close the report", async () => {
    const api = fakeApi();
    const host = await mount(<MapPlacesPage api={api} token="t" search="" />);
    await click(buttonNamed(host, "Disable place"));
    expect(api.reviewMapPlaceReport).toHaveBeenCalledWith("t", "report_1", { status: "resolved", deactivate_place: true });
    expect(host.textContent).toContain("The report was reviewed.");
  });
});
