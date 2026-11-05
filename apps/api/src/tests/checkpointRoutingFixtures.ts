import type { Candidate, FeedCheckpoint, LatLng } from "../services/checkpointRouting.js";
import { checkpointsAlongRoute, prepareCheckpoints } from "../services/checkpointRouting.js";
import type { EngineRoute, RoutingEngine } from "../services/routePlanner.js";

// Synthetic geography: nothing here is a real road or checkpoint.
export const A: LatLng = { lat: 31.5, lng: 35.1 };
export const B: LatLng = { lat: 31.5, lng: 35.3 };

/** A line of points about 200 m apart, with an optional bulge in latitude. */
export function line(from: LatLng, to: LatLng, steps = 100, bulge = 0): LatLng[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return { lat: from.lat + (to.lat - from.lat) * t + bulge * Math.sin(Math.PI * t), lng: from.lng + (to.lng - from.lng) * t };
  });
}

/** The engine's fastest road: straight along latitude 31.5 (about 19 km). */
export const primary: EngineRoute = { line: line(A, B), distance_meters: 19_000, duration_seconds: 1_500 };
/** A road that bulges 0.06 degrees (about 6.7 km) north: longer and slower. */
export const northRoad: EngineRoute = { line: line(A, B, 100, 0.06), distance_meters: 24_000, duration_seconds: 1_900 };
/** A road that bulges 0.06 degrees south. */
export const southRoad: EngineRoute = { line: line(A, B, 100, -0.06), distance_meters: 24_500, duration_seconds: 1_950 };

export const at = (lng: number, lat = 31.5, extra: Partial<FeedCheckpoint> = {}): FeedCheckpoint => ({
  id: `cp-${lng}-${lat}`,
  name_ar: `حاجز ${lng}`,
  name_en: null,
  latitude: lat,
  longitude: lng,
  status: "open",
  ...extra
});

export const NOW = new Date("2026-11-05T12:00:00Z");
export const FRESH = "2026-11-05T11:59:50Z";

export const thresholds = {
  thresholdMeters: 150,
  approximateThresholdMeters: 500,
  statusTtlSeconds: 300,
  congestionMaxExtraSeconds: 600,
  congestionMaxExtraMeters: 8_000
};

export function candidate(route: EngineRoute, rows: FeedCheckpoint[], origin: Candidate["origin"] = "osrm_primary"): Candidate {
  const { checkpoints } = prepareCheckpoints({ checkpoints: rows, fetched_at: FRESH }, thresholds, NOW);
  return { origin, ...route, hits: checkpointsAlongRoute(route.line, checkpoints, thresholds) };
}

export type EngineCall = { coordinates: LatLng[]; alternatives: boolean };

/**
 * Engine double. Two-coordinate requests return [primary, ...alternatives];
 * a request with a via point returns the north road when the via is north of
 * the line, the south road otherwise (like a router honouring the via).
 */
export function fakeEngine(alternatives: EngineRoute[] = [], calls: EngineCall[] = []): RoutingEngine & { calls: EngineCall[] } {
  return {
    calls,
    async route(coordinates, options) {
      calls.push({ coordinates, alternatives: options.alternatives });
      if (coordinates.length === 2) return [primary, ...alternatives];
      const via = coordinates[1]!;
      return [via.lat > A.lat ? northRoad : southRoad];
    }
  };
}
