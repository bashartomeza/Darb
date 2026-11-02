import { describe, expect, it } from "vitest";
import type { ApiError } from "../../api";
import { translations } from "../../i18n/translations";
import { cityCreateErrorKey, routeCreateErrorKey, validateCityForm, validateRouteDraft } from "./operatingRoutesModel";

const city = (id: string) => ({ id, name_ar: id, name_en: id, latitude: 31.5, longitude: 35.1 });
const existing = [{ id: "r1", route_key: "a-to-b", name_ar: "a ← b", name_en: "a → b", origin: city("a"), destination: city("b"), active: false, orders_count: 0 }];

function apiError(status: number, message: string) {
  const error = new Error(message) as ApiError;
  error.status = status;
  return error;
}

describe("operating routes model", () => {
  it("accepts the service area bounds inclusively and rejects anything outside", () => {
    const form = { name_ar: "مدينة", name_en: "City", latitude: "29.4", longitude: "34.2" };
    expect(validateCityForm(form)).toEqual({ ok: true, draft: { name_ar: "مدينة", name_en: "City", latitude: 29.4, longitude: 34.2 } });
    expect(validateCityForm({ ...form, latitude: "33.4", longitude: "35.95" }).ok).toBe(true);
    expect(validateCityForm({ ...form, latitude: "29.39" })).toEqual({ ok: false, error: "opCityLatitudeInvalid" });
    expect(validateCityForm({ ...form, latitude: "33.41" })).toEqual({ ok: false, error: "opCityLatitudeInvalid" });
    expect(validateCityForm({ ...form, longitude: "34.19" })).toEqual({ ok: false, error: "opCityLongitudeInvalid" });
    expect(validateCityForm({ ...form, longitude: "35.96" })).toEqual({ ok: false, error: "opCityLongitudeInvalid" });
    expect(validateCityForm({ ...form, latitude: "" })).toEqual({ ok: false, error: "opCityLatitudeInvalid" });
    expect(validateCityForm({ ...form, latitude: "31,5" })).toEqual({ ok: false, error: "opCityLatitudeInvalid" });
    expect(validateCityForm({ ...form, name_en: " " })).toEqual({ ok: false, error: "opCityNamesRequired" });
  });

  it("checks a route draft before it is sent", () => {
    expect(validateRouteDraft({ origin_city_id: "", destination_city_id: "b", both_directions: true }, [])).toBe("opRoutesChooseBoth");
    expect(validateRouteDraft({ origin_city_id: "a", destination_city_id: "a", both_directions: true }, [])).toBe("opRoutesSameCity");
    expect(validateRouteDraft({ origin_city_id: "a", destination_city_id: "b", both_directions: false }, existing)).toBe("opRoutesAlreadyListed");
    // Only the forward direction is checked locally; the server answers 409 for the return direction.
    expect(validateRouteDraft({ origin_city_id: "b", destination_city_id: "a", both_directions: true }, existing)).toBeNull();
  });

  it("maps API failures onto translated messages", () => {
    expect(routeCreateErrorKey(apiError(409, "route_exists"))).toBe("opRoutesExists");
    expect(routeCreateErrorKey(apiError(400, "validation_error"))).toBe("opRoutesCreateFailed");
    expect(routeCreateErrorKey(new Error("Failed to fetch"))).toBe("failedToFetch");
    expect(cityCreateErrorKey(apiError(409, "city_exists"))).toBe("opCityExists");
    expect(cityCreateErrorKey(apiError(400, "outside_service_area"))).toBe("opCityCreateFailed");
  });

  it("has Arabic and English copy for every new Routes page string", () => {
    const keys = Object.keys(translations.en).filter((key) => /^(opRoutes|opCity|operatingRoutes|order(Pickup|Dropoff))/.test(key));
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) {
      expect(translations.ar[key as keyof typeof translations.ar], key).toBeTruthy();
      expect(translations.en[key as keyof typeof translations.en], key).toBeTruthy();
    }
  });
});
