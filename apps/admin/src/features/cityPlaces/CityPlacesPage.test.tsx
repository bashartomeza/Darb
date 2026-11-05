// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiError, CityPlace } from "../../api";
import { buttonNamed, click, dialog, inputNamed, mount, settle, type, unmount } from "../../testing/mount";
import { CityPlacesPage, emptyPlaceForm, insideServiceArea, placeDraftFrom, placeUpdateFrom, validatePlaceForm, type CityPlacesApi } from "./CityPlacesPage";

const halhul: CityPlace = {
  id: "cp_hebron_11",
  city_key: "city-hebron",
  name_ar: "حلحول",
  name_en: "Halhul",
  latitude: 31.577547,
  longitude: 35.099316,
  approximate: true,
  source: "OpenStreetMap place node/332791394",
  active: true,
  sort_order: 11,
  created_at: "2026-11-04T08:00:00.000Z",
  updated_at: "2026-11-04T08:00:00.000Z"
};
const yatta: CityPlace = { ...halhul, id: "cp_hebron_01", name_ar: "يطا", name_en: "Yatta", active: false, approximate: false, source: "admin" };
const cities = [
  { city_key: "city-hebron", name_ar: "الخليل", name_en: "Hebron", places_total: 2, places_active: 1 },
  { city_key: "city-ramallah", name_ar: "رام الله", name_en: "Ramallah", places_total: 1, places_active: 1 }
];

function apiError(status: number, message: string) {
  const error = new Error(message) as ApiError;
  error.status = status;
  return error;
}

function fakeApi(overrides: Partial<Record<keyof CityPlacesApi, unknown>> = {}) {
  return {
    cityPlaces: vi.fn().mockResolvedValue({ cities, places: [halhul, yatta] }),
    createCityPlace: vi.fn().mockResolvedValue({ place: halhul }),
    updateCityPlace: vi.fn().mockResolvedValue({ place: halhul }),
    ...overrides
  } as unknown as CityPlacesApi & Record<keyof CityPlacesApi, ReturnType<typeof vi.fn>>;
}

async function submit(form: HTMLFormElement) {
  await click(form.querySelector<HTMLButtonElement>('button[type="submit"]')!);
  await settle();
}

afterEach(unmount);

describe("city place rules", () => {
  it("accepts positions inside the service area only", () => {
    expect(insideServiceArea(31.5326, 35.0998)).toBe(true);
    expect(insideServiceArea(48.8, 2.3)).toBe(false);
    expect(insideServiceArea(35.2, 32.1)).toBe(false);
  });

  it("validates a form the way the API does", () => {
    const form = { ...emptyPlaceForm("city-hebron"), name_ar: "بيت كاحل", name_en: "Beit Kahel", latitude: "31.5967", longitude: "35.1281" };
    expect(validatePlaceForm(form)).toBeNull();
    expect(validatePlaceForm({ ...form, name_en: "" })).toBe("names");
    expect(validatePlaceForm({ ...form, latitude: "abc" })).toBe("coordinates");
    expect(validatePlaceForm({ ...form, latitude: "48.8" })).toBe("outside_area");
    expect(placeDraftFrom(form)).toEqual({ city_key: "city-hebron", name_ar: "بيت كاحل", name_en: "Beit Kahel", latitude: 31.5967, longitude: 35.1281 });
  });

  it("sends only the fields that changed", () => {
    const form = { city_key: halhul.city_key, name_ar: "حلحول", name_en: "Halhul", latitude: "31.58", longitude: "35.099316" };
    expect(placeUpdateFrom(form, halhul)).toEqual({ latitude: 31.58 });
  });
});

describe("city places page", () => {
  it("lists places with their city, position state and status", async () => {
    const api = fakeApi();
    const host = await mount(<CityPlacesPage api={api} token="t" search="" />);
    expect(api.cityPlaces).toHaveBeenCalledWith("t", { city_key: "", search: "" });
    const text = host.textContent ?? "";
    expect(text).toContain("حلحول");
    expect(text).toContain("Halhul");
    expect(text).toContain("31.577547, 35.099316");
    expect(text).toContain("Approximate");
    expect(text).toContain("Verified");
    expect(text).toContain("Active");
    expect(text).toContain("Disabled");
  });

  it("filters by city", async () => {
    const api = fakeApi();
    const host = await mount(<CityPlacesPage api={api} token="t" search="" />);
    const select = host.querySelector<HTMLSelectElement>('select[name="city_filter"]')!;
    select.value = "city-ramallah";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(api.cityPlaces).toHaveBeenLastCalledWith("t", { city_key: "city-ramallah", search: "" });
  });

  it("adds a place", async () => {
    const api = fakeApi();
    const host = await mount(<CityPlacesPage api={api} token="t" search="" />);
    await click(buttonNamed(host, "Add place"));
    const form = dialog()!.querySelector("form")!;
    await type(inputNamed(form, "name_ar"), "بيت كاحل");
    await type(inputNamed(form, "name_en"), "Beit Kahel");
    await type(inputNamed(form, "latitude"), "31.5967");
    await type(inputNamed(form, "longitude"), "35.1281");
    await submit(form);
    expect(api.createCityPlace).toHaveBeenCalledWith("t", { city_key: "city-hebron", name_ar: "بيت كاحل", name_en: "Beit Kahel", latitude: 31.5967, longitude: 35.1281 });
    expect(dialog()).toBeNull();
    expect(host.textContent).toContain("Place added.");
  });

  it("stops an out-of-area position before sending it", async () => {
    const api = fakeApi();
    const host = await mount(<CityPlacesPage api={api} token="t" search="" />);
    await click(buttonNamed(host, "Add place"));
    const form = dialog()!.querySelector("form")!;
    await type(inputNamed(form, "name_ar"), "بيت كاحل");
    await type(inputNamed(form, "name_en"), "Beit Kahel");
    await type(inputNamed(form, "latitude"), "48.8");
    await type(inputNamed(form, "longitude"), "35.1281");
    await submit(form);
    expect(api.createCityPlace).not.toHaveBeenCalled();
    expect(dialog()!.textContent).toContain("outside the service area");
  });

  it("shows the duplicate error from the server", async () => {
    const api = fakeApi({ createCityPlace: vi.fn().mockRejectedValue(apiError(409, "city_place_exists")) });
    const host = await mount(<CityPlacesPage api={api} token="t" search="" />);
    await click(buttonNamed(host, "Add place"));
    const form = dialog()!.querySelector("form")!;
    await type(inputNamed(form, "name_ar"), "حلحول");
    await type(inputNamed(form, "name_en"), "Halhul");
    await type(inputNamed(form, "latitude"), "31.57");
    await type(inputNamed(form, "longitude"), "35.1");
    await submit(form);
    expect(dialog()!.textContent).toContain("already exists");
  });

  it("disables an active place and enables a disabled one", async () => {
    const api = fakeApi();
    const host = await mount(<CityPlacesPage api={api} token="t" search="" />);
    await click(buttonNamed(host, "Disable"));
    expect(api.updateCityPlace).toHaveBeenCalledWith("t", "cp_hebron_11", { active: false });
    expect(host.textContent).toContain("Place disabled");
    await click(buttonNamed(host, "Enable"));
    expect(api.updateCityPlace).toHaveBeenCalledWith("t", "cp_hebron_01", { active: true });
  });

  it("edits only the changed fields", async () => {
    const api = fakeApi();
    const host = await mount(<CityPlacesPage api={api} token="t" search="" />);
    await click(buttonNamed(host, "Edit"));
    const form = dialog()!.querySelector("form")!;
    expect(inputNamed(form, "name_en").value).toBe("Halhul");
    await type(inputNamed(form, "latitude"), "31.58");
    await submit(form);
    expect(api.updateCityPlace).toHaveBeenCalledWith("t", "cp_hebron_11", { latitude: 31.58 });
  });
});
