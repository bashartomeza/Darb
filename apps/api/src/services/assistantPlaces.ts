import { prisma } from "../lib/prisma.js";
import type { AssistantPlace, AssistantRoute } from "./assistantParser.js";

export type AssistantPlaceData = { places: AssistantPlace[]; routes: AssistantRoute[] };

/** Active stops of published routes: the only places the assistant may offer. */
export async function loadAssistantPlaces(): Promise<AssistantPlaceData> {
  const versions = await prisma.serviceRouteVersion.findMany({
    where: { status: "published", service_route: { status: "active" } },
    take: 100,
    select: {
      service_route: { select: { route_key: true } },
      stops: {
        orderBy: { sequence: "asc" },
        select: {
          sequence: true,
          passenger_pickup: true,
          passenger_dropoff: true,
          stop: { select: { stop_key: true, name_ar: true, name_en: true, latitude: true, longitude: true, status: true } }
        }
      }
    }
  });

  const places = new Map<string, AssistantPlace>();
  const routes: AssistantRoute[] = [];
  for (const version of versions) {
    const stops = version.stops.filter((m) => m.stop.status === "active");
    for (const m of stops) {
      places.set(m.stop.stop_key, {
        key: m.stop.stop_key,
        name_ar: m.stop.name_ar,
        name_en: m.stop.name_en,
        lat: Number(m.stop.latitude),
        lng: Number(m.stop.longitude)
      });
    }
    routes.push({
      route_key: version.service_route.route_key,
      stops: stops.map((m) => ({
        stop_key: m.stop.stop_key,
        sequence: m.sequence,
        passenger_pickup: m.passenger_pickup,
        passenger_dropoff: m.passenger_dropoff
      }))
    });
  }
  return { places: [...places.values()], routes };
}
