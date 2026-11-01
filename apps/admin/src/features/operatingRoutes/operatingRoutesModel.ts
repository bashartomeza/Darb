import type { AdminOperatingRoute, ApiError, OperatingCity, OperatingCityDraft, OperatingRouteDraft } from "../../api";
import type { Locale, TranslationKey } from "../../i18n/translations";

/** The service area the API accepts for a new city (docs/routes/route-based-orders.md). */
export const SERVICE_AREA = { minLat: 29.4, maxLat: 33.4, minLng: 34.2, maxLng: 35.95 } as const;

export type RouteStatusFilter = "all" | "active" | "off";
export type RouteFilters = { search: string; cityId: string; status: RouteStatusFilter };

export function cityName(city: Pick<OperatingCity, "name_ar" | "name_en">, locale: Locale) {
  return (locale === "ar" ? city.name_ar : city.name_en) || city.name_en || city.name_ar;
}

export function routeName(route: Pick<AdminOperatingRoute, "name_ar" | "name_en">, locale: Locale) {
  return (locale === "ar" ? route.name_ar : route.name_en) || route.name_en || route.name_ar;
}

/** Every known city (route ends plus the city catalog) for the city filter, sorted by the UI-language name. */
export function routeCities(routes: AdminOperatingRoute[], cities: OperatingCity[], locale: Locale) {
  const byId = new Map<string, OperatingCity>();
  for (const route of routes) {
    byId.set(route.origin.id, route.origin);
    byId.set(route.destination.id, route.destination);
  }
  for (const city of cities) if (!byId.has(city.id)) byId.set(city.id, city);
  return sortCities([...byId.values()], locale);
}

export function sortCities(cities: OperatingCity[], locale: Locale) {
  return [...cities].sort((a, b) => cityName(a, locale).localeCompare(cityName(b, locale), locale));
}

export function filterRoutes(routes: AdminOperatingRoute[], filters: RouteFilters) {
  const needle = filters.search.trim().toLowerCase();
  return routes.filter((route) => {
    if (filters.status === "active" && !route.active) return false;
    if (filters.status === "off" && route.active) return false;
    if (filters.cityId && route.origin.id !== filters.cityId && route.destination.id !== filters.cityId) return false;
    if (!needle) return true;
    return [
      route.name_ar,
      route.name_en,
      route.route_key,
      route.origin.name_ar,
      route.origin.name_en,
      route.destination.name_ar,
      route.destination.name_en
    ].some((value) => (value ?? "").toLowerCase().includes(needle));
  });
}

export function routeExists(routes: AdminOperatingRoute[], originId: string, destinationId: string) {
  return routes.some((route) => route.origin.id === originId && route.destination.id === destinationId);
}

/** Client-side checks before `POST /admin/operating-routes`; the server stays authoritative (409 route_exists). */
export function validateRouteDraft(draft: OperatingRouteDraft, routes: AdminOperatingRoute[]): TranslationKey | null {
  if (!draft.origin_city_id || !draft.destination_city_id) return "opRoutesChooseBoth";
  if (draft.origin_city_id === draft.destination_city_id) return "opRoutesSameCity";
  if (routeExists(routes, draft.origin_city_id, draft.destination_city_id)) return "opRoutesAlreadyListed";
  return null;
}

export function routeCreateErrorKey(error: unknown): TranslationKey {
  const apiError = error as ApiError | undefined;
  if (apiError?.message === "route_exists" || apiError?.status === 409) return "opRoutesExists";
  if (apiError?.message === "Failed to fetch") return "failedToFetch";
  return "opRoutesCreateFailed";
}

export type CityForm = { name_ar: string; name_en: string; latitude: string; longitude: string };

function coordinate(value: string) {
  const text = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

/** Validates the "Add city" form, including the service-area bounds the API enforces. */
export function validateCityForm(form: CityForm):
  | { ok: true; draft: OperatingCityDraft }
  | { ok: false; error: TranslationKey } {
  const name_ar = form.name_ar.trim();
  const name_en = form.name_en.trim();
  if (name_ar.length < 2 || name_en.length < 2) return { ok: false, error: "opCityNamesRequired" };
  const latitude = coordinate(form.latitude);
  if (latitude === null || latitude < SERVICE_AREA.minLat || latitude > SERVICE_AREA.maxLat) {
    return { ok: false, error: "opCityLatitudeInvalid" };
  }
  const longitude = coordinate(form.longitude);
  if (longitude === null || longitude < SERVICE_AREA.minLng || longitude > SERVICE_AREA.maxLng) {
    return { ok: false, error: "opCityLongitudeInvalid" };
  }
  return { ok: true, draft: { name_ar, name_en, latitude, longitude } };
}

export function cityCreateErrorKey(error: unknown): TranslationKey {
  const apiError = error as ApiError | undefined;
  if (apiError?.status === 409) return "opCityExists";
  if (apiError?.message === "Failed to fetch") return "failedToFetch";
  return "opCityCreateFailed";
}
