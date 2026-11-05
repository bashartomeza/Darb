import { createHash } from "node:crypto";
import type { RouteProxyConfig } from "./routeProxyConfig.js";

/** Where Darb operates; the same box the mobile app and community reports use. */
export const ROUTE_PROXY_BOUNDS = { minLat: 29.4, maxLat: 33.4, minLng: 34.2, maxLng: 35.95 } as const;

export type LatLng = Readonly<{ lat: number; lng: number }>;

export type ProxyRoute = Readonly<{
  distanceMeters: number;
  durationSeconds: number;
  /** GeoJSON order: [longitude, latitude]. */
  coordinates: ReadonlyArray<readonly [number, number]>;
}>;

export type RouteProxyErrorCode =
  | "route_provider_unavailable"
  | "route_provider_timeout"
  | "route_provider_failed"
  | "route_provider_busy"
  | "invalid_waypoints";

export class RouteProxyError extends Error {
  constructor(readonly code: RouteProxyErrorCode, readonly status: number) {
    super(code);
    this.name = "RouteProxyError";
  }
}

export function inServiceArea(point: LatLng) {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= ROUTE_PROXY_BOUNDS.minLat &&
    point.lat <= ROUTE_PROXY_BOUNDS.maxLat &&
    point.lng >= ROUTE_PROXY_BOUNDS.minLng &&
    point.lng <= ROUTE_PROXY_BOUNDS.maxLng
  );
}

/**
 * Parses `lat,lng;lat,lng;...`. Throws `invalid_waypoints` for a malformed list,
 * too few or too many points, or any point outside the service area.
 */
export function parseWaypoints(value: unknown, maxWaypoints: number): LatLng[] {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_000) {
    throw new RouteProxyError("invalid_waypoints", 400);
  }
  const parts = value.split(";");
  if (parts.length < 2 || parts.length > maxWaypoints) throw new RouteProxyError("invalid_waypoints", 400);
  return parts.map((part) => {
    const match = /^(-?\d{1,3}(?:\.\d{1,9})?),(-?\d{1,3}(?:\.\d{1,9})?)$/.exec(part.trim());
    if (!match) throw new RouteProxyError("invalid_waypoints", 400);
    const point = { lat: Number(match[1]), lng: Number(match[2]) };
    if (!inServiceArea(point)) throw new RouteProxyError("invalid_waypoints", 400);
    return point;
  });
}

type FetchLike = typeof fetch;

export type RouteProxyService = Readonly<{
  enabled: boolean;
  provider: string;
  attribution: string;
  route(waypoints: readonly LatLng[]): Promise<{ route: ProxyRoute; cacheStatus: "hit" | "miss" }>;
}>;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalise(
  distance: unknown,
  duration: unknown,
  coordinates: unknown,
  maxPoints: number
): ProxyRoute {
  const bad = () => new RouteProxyError("route_provider_failed", 502);
  if (!finite(distance) || !finite(duration) || distance < 0 || duration < 0) throw bad();
  if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > maxPoints) throw bad();
  const points: Array<readonly [number, number]> = [];
  for (const coordinate of coordinates) {
    if (!Array.isArray(coordinate) || !finite(coordinate[0]) || !finite(coordinate[1])) throw bad();
    const lng = Math.round(coordinate[0] * 1e6) / 1e6;
    const lat = Math.round(coordinate[1] * 1e6) / 1e6;
    // A road line leaving the service area means the provider answered for the wrong place.
    if (!inServiceArea({ lat, lng })) throw bad();
    points.push([lng, lat]);
  }
  return { distanceMeters: Math.round(distance), durationSeconds: Math.round(duration), coordinates: points };
}

function lngLat(points: readonly LatLng[]) {
  return points.map((p) => `${p.lng},${p.lat}`).join(";");
}

async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const bad = () => new RouteProxyError("route_provider_failed", 502);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw bad();
  if (!response.body) throw bad();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw bad();
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    throw bad();
  }
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" ? (value as Obj) : {});
const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : undefined);

function buildRequest(config: RouteProxyConfig, points: readonly LatLng[]): { url: URL; init: RequestInit } {
  const base = config.baseUrl!;
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "darb-api-route-proxy" };
  switch (config.provider) {
    case "osrm": {
      const url = new URL(`${base}/route/v1/driving/${lngLat(points)}`);
      url.searchParams.set("overview", "full");
      url.searchParams.set("geometries", "geojson");
      return { url, init: { method: "GET", headers } };
    }
    case "mapbox": {
      const url = new URL(`${base}/directions/v5/mapbox/driving/${lngLat(points)}`);
      url.searchParams.set("overview", "full");
      url.searchParams.set("geometries", "geojson");
      url.searchParams.set("access_token", config.apiKey!);
      return { url, init: { method: "GET", headers } };
    }
    case "openrouteservice":
      return {
        url: new URL(`${base}/v2/directions/driving-car/geojson`),
        init: {
          method: "POST",
          headers: { ...headers, authorization: config.apiKey!, "content-type": "application/json" },
          body: JSON.stringify({ coordinates: points.map((p) => [p.lng, p.lat]) })
        }
      };
    case "graphhopper": {
      const url = new URL(`${base}/route`);
      url.searchParams.set("key", config.apiKey!);
      return {
        url,
        init: {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ points: points.map((p) => [p.lng, p.lat]), profile: "car", points_encoded: false })
        }
      };
    }
    default:
      throw new RouteProxyError("route_provider_unavailable", 503);
  }
}

function parseProviderBody(config: RouteProxyConfig, body: unknown): ProxyRoute {
  const max = config.maxGeometryPoints;
  const bad = () => new RouteProxyError("route_provider_failed", 502);
  switch (config.provider) {
    case "osrm":
    case "mapbox": {
      const root = obj(body);
      if (root.code !== "Ok") throw bad();
      const route = obj(first(root.routes));
      return normalise(route.distance, route.duration, obj(route.geometry).coordinates, max);
    }
    case "openrouteservice": {
      const feature = obj(first(obj(body).features));
      const summary = obj(obj(feature.properties).summary);
      return normalise(summary.distance, summary.duration, obj(feature.geometry).coordinates, max);
    }
    case "graphhopper": {
      const path = obj(first(obj(body).paths));
      return normalise(path.distance, finite(path.time) ? path.time / 1000 : NaN, obj(path.points).coordinates, max);
    }
    default:
      throw bad();
  }
}

export function createRouteProxyService(
  config: RouteProxyConfig,
  options: { fetchImpl?: FetchLike; now?: () => number } = {}
): RouteProxyService {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const enabled = config.provider !== "disabled";
  const cache = new Map<string, { expiresAt: number; route: ProxyRoute }>();
  const MAX_CACHE_ENTRIES = 500;
  const inFlight = new Map<string, Promise<ProxyRoute>>();
  let windowStart = 0;
  let windowCount = 0;

  const cacheKey = (points: readonly LatLng[]) =>
    createHash("sha256")
      .update(`${config.provider}|${points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(";")}`)
      .digest("hex");

  /** Fixed one-minute window over provider calls (cache hits are free). */
  function takeGlobalSlot() {
    const t = now();
    if (t - windowStart >= 60_000) {
      windowStart = t;
      windowCount = 0;
    }
    if (windowCount >= config.globalRatePerMinute) throw new RouteProxyError("route_provider_busy", 429);
    windowCount += 1;
  }

  async function callProvider(points: readonly LatLng[]): Promise<ProxyRoute> {
    const { url, init } = buildRequest(config, points);
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(config.timeoutMs) });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") throw new RouteProxyError("route_provider_timeout", 504);
      throw new RouteProxyError("route_provider_failed", 502);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new RouteProxyError(response.status === 429 ? "route_provider_busy" : "route_provider_failed", response.status === 429 ? 429 : 502);
    }
    return parseProviderBody(config, await boundedJson(response, config.maxResponseBytes));
  }

  return {
    enabled,
    provider: config.provider,
    attribution: config.attribution,
    async route(points) {
      if (!enabled) throw new RouteProxyError("route_provider_unavailable", 503);
      const key = cacheKey(points);
      const hit = cache.get(key);
      if (hit && hit.expiresAt > now()) {
        cache.delete(key);
        cache.set(key, hit);
        return { route: hit.route, cacheStatus: "hit" };
      }
      cache.delete(key);
      let pending = inFlight.get(key);
      const shared = pending !== undefined;
      if (!pending) {
        takeGlobalSlot();
        pending = callProvider(points).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      const route = await pending;
      if (!shared && config.cacheTtlSeconds > 0) {
        cache.set(key, { expiresAt: now() + config.cacheTtlSeconds * 1_000, route });
        while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
      }
      return { route, cacheStatus: "miss" };
    }
  };
}
