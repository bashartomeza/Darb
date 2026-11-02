/**
 * Operating route rows as `serviceRoute.findUnique/findMany` return them with
 * `operatingRouteInclude`, for tests that mock Prisma.
 */

type City = { id: string; stop_key: string; name_ar: string; name_en: string; latitude: string; longitude: string };

export const CITY = {
  hebron: { id: "stop_hebron", stop_key: "city-hebron", name_ar: "الخليل", name_en: "Hebron", latitude: "31.532600", longitude: "35.099800" },
  bethlehem: { id: "stop_bethlehem", stop_key: "city-bethlehem", name_ar: "بيت لحم", name_en: "Bethlehem", latitude: "31.705400", longitude: "35.202400" },
  ramallah: { id: "stop_ramallah", stop_key: "city-ramallah", name_ar: "رام الله", name_en: "Ramallah", latitude: "31.903800", longitude: "35.203400" },
  nablus: { id: "stop_nablus", stop_key: "city-nablus", name_ar: "نابلس", name_en: "Nablus", latitude: "32.221100", longitude: "35.254400" }
} satisfies Record<string, City>;

export function operatingRouteRow(input: {
  id?: string;
  versionId?: string;
  origin?: City;
  destination?: City;
  status?: "active" | "retired";
  versionStatus?: "draft" | "published" | "paused" | "retired";
  stops?: number;
} = {}) {
  const origin = input.origin ?? CITY.hebron;
  const destination = input.destination ?? CITY.bethlehem;
  const originSlug = origin.stop_key.replace("city-", "");
  const destinationSlug = destination.stop_key.replace("city-", "");
  return {
    id: input.id ?? `service_route_${originSlug}_${destinationSlug}`,
    route_key: `${originSlug}-to-${destinationSlug}`,
    status: input.status ?? "active",
    current_version_id: input.versionId ?? `route_version_${originSlug}_${destinationSlug}`,
    current_version: {
      id: input.versionId ?? `route_version_${originSlug}_${destinationSlug}`,
      service_route_id: input.id ?? `service_route_${originSlug}_${destinationSlug}`,
      status: input.versionStatus ?? "published",
      name_ar: `${origin.name_ar} ← ${destination.name_ar}`,
      name_en: `${origin.name_en} → ${destination.name_en}`,
      origin_stop: origin,
      destination_stop: destination,
      _count: { stops: input.stops ?? 2 }
    }
  };
}

export type OperatingRouteRow = ReturnType<typeof operatingRouteRow>;

/** The default route every old coordinate body maps to. */
export const HEBRON_TO_BETHLEHEM = operatingRouteRow();

/** A `serviceRoute.findUnique` implementation over [routes], by id or by route_key. */
export function findOperatingRoute(routes: OperatingRouteRow[] = [HEBRON_TO_BETHLEHEM]) {
  return async ({ where }: { where: { id?: string; route_key?: string } }) =>
    routes.find((route) => (where.id !== undefined && route.id === where.id) || (where.route_key !== undefined && route.route_key === where.route_key)) ?? null;
}

/** The summary `routeSummarySelect` returns for [route]. */
export function routeSummary(route: OperatingRouteRow = HEBRON_TO_BETHLEHEM) {
  return { service_route_id: route.id, name_ar: route.current_version.name_ar, name_en: route.current_version.name_en };
}
