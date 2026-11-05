/**
 * Configuration of the authenticated road-routing proxy (`GET /api/v1/maps/route`).
 *
 * The proxy keeps provider keys on the server so they never ship in the mobile
 * app. In staging and production it refuses the public OSRM demo server (which
 * forbids production traffic) and requires HTTPS; there is no default provider,
 * so an unconfigured production API answers 503 and the app draws a straight line.
 * Problems name variables only, never values.
 */

export const ROUTE_PROXY_PROVIDERS = ["disabled", "osrm", "openrouteservice", "graphhopper", "mapbox"] as const;
export type RouteProxyProviderId = (typeof ROUTE_PROXY_PROVIDERS)[number];

export type RawRouteProxyEnvironment = {
  MAPS_ROUTING_PROVIDER?: string;
  MAPS_ROUTING_BASE_URL?: string;
  MAPS_ROUTING_API_KEY?: string;
  MAPS_ROUTING_ATTRIBUTION?: string;
  MAPS_ROUTING_TIMEOUT_MS?: string;
  MAPS_ROUTING_CACHE_TTL_SECONDS?: string;
  MAPS_ROUTING_MAX_WAYPOINTS?: string;
  MAPS_ROUTING_MAX_RESPONSE_BYTES?: string;
  MAPS_ROUTING_USER_RATE_PER_MINUTE?: string;
  MAPS_ROUTING_GLOBAL_RATE_PER_MINUTE?: string;
};

export type RouteProxyConfig = Readonly<{
  provider: RouteProxyProviderId;
  baseUrl?: string;
  apiKey?: string;
  attribution: string;
  timeoutMs: number;
  cacheTtlSeconds: number;
  maxWaypoints: number;
  maxResponseBytes: number;
  maxGeometryPoints: number;
  userRatePerMinute: number;
  globalRatePerMinute: number;
}>;

export const DEFAULT_PROVIDER_BASE_URLS: Record<Exclude<RouteProxyProviderId, "disabled" | "osrm">, string> = {
  openrouteservice: "https://api.openrouteservice.org",
  graphhopper: "https://graphhopper.com/api/1",
  mapbox: "https://api.mapbox.com"
};

const DEFAULT_ATTRIBUTION: Record<RouteProxyProviderId, string> = {
  disabled: "",
  osrm: "© OpenStreetMap contributors",
  openrouteservice: "© openrouteservice.org, © OpenStreetMap contributors",
  graphhopper: "Powered by GraphHopper, © OpenStreetMap contributors",
  mapbox: "© Mapbox, © OpenStreetMap contributors"
};

const PLACEHOLDER_MARKERS = ["changeme", "example", "your-", "test-key", "xxxx"];

/** Hosts of free public demo servers that forbid production or heavy traffic. */
export function isPublicDemoRoutingHost(host: string) {
  const h = host.toLowerCase();
  return h === "project-osrm.org" || h.endsWith(".project-osrm.org") || h === "openstreetmap.org" || h.endsWith(".openstreetmap.org");
}

function integer(name: string, value: string | undefined, fallback: number, min: number, max: number, problems: string[]) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    problems.push(`${name} must be an integer from ${min} through ${max}`);
    return fallback;
  }
  return parsed;
}

function parseBase(name: string, value: string, productionLike: boolean, problems: string[]) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    problems.push(`${name} must be an absolute URL`);
    return undefined;
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && !productionLike)) {
    problems.push(`${name} must use HTTPS`);
    return undefined;
  }
  if (url.username || url.password || url.search || url.hash) {
    problems.push(`${name} must not contain credentials, a query string or a fragment`);
    return undefined;
  }
  if (productionLike && isPublicDemoRoutingHost(url.hostname)) {
    problems.push(`${name} points at a public demo server, which is forbidden in staging and production`);
    return undefined;
  }
  return value.trim().replace(/\/+$/, "");
}

export function parseRouteProxyConfig(raw: RawRouteProxyEnvironment, productionLike: boolean, problems: string[]): RouteProxyConfig {
  const providerText = (raw.MAPS_ROUTING_PROVIDER ?? "").trim() || "disabled";
  const provider = (ROUTE_PROXY_PROVIDERS as readonly string[]).includes(providerText)
    ? (providerText as RouteProxyProviderId)
    : undefined;
  if (!provider) problems.push(`MAPS_ROUTING_PROVIDER must be one of ${ROUTE_PROXY_PROVIDERS.join(", ")}`);

  const timeoutMs = integer("MAPS_ROUTING_TIMEOUT_MS", raw.MAPS_ROUTING_TIMEOUT_MS, 4_000, 250, 20_000, problems);
  const cacheTtlSeconds = integer("MAPS_ROUTING_CACHE_TTL_SECONDS", raw.MAPS_ROUTING_CACHE_TTL_SECONDS, 600, 0, 86_400, problems);
  const maxWaypoints = integer("MAPS_ROUTING_MAX_WAYPOINTS", raw.MAPS_ROUTING_MAX_WAYPOINTS, 25, 2, 25, problems);
  const maxResponseBytes = integer("MAPS_ROUTING_MAX_RESPONSE_BYTES", raw.MAPS_ROUTING_MAX_RESPONSE_BYTES, 1_000_000, 10_000, 5_000_000, problems);
  const userRatePerMinute = integer("MAPS_ROUTING_USER_RATE_PER_MINUTE", raw.MAPS_ROUTING_USER_RATE_PER_MINUTE, 20, 1, 600, problems);
  const globalRatePerMinute = integer("MAPS_ROUTING_GLOBAL_RATE_PER_MINUTE", raw.MAPS_ROUTING_GLOBAL_RATE_PER_MINUTE, 120, 1, 6_000, problems);

  const active = provider ?? "disabled";
  const explicitBase = raw.MAPS_ROUTING_BASE_URL?.trim();
  let baseUrl: string | undefined;
  if (active === "osrm") {
    if (!explicitBase) problems.push("MAPS_ROUTING_BASE_URL is required when MAPS_ROUTING_PROVIDER=osrm");
    else baseUrl = parseBase("MAPS_ROUTING_BASE_URL", explicitBase, productionLike, problems);
  } else if (active !== "disabled") {
    baseUrl = explicitBase
      ? parseBase("MAPS_ROUTING_BASE_URL", explicitBase, productionLike, problems)
      : DEFAULT_PROVIDER_BASE_URLS[active];
  }

  const key = raw.MAPS_ROUTING_API_KEY?.trim();
  let apiKey: string | undefined;
  if (active !== "disabled" && active !== "osrm") {
    if (!key) problems.push(`MAPS_ROUTING_API_KEY is required when MAPS_ROUTING_PROVIDER=${active}`);
    else if (key.length < 8 || PLACEHOLDER_MARKERS.some((marker) => key.toLowerCase().includes(marker))) {
      problems.push("MAPS_ROUTING_API_KEY uses a known placeholder or is too short");
    } else apiKey = key;
  }

  const attribution = (raw.MAPS_ROUTING_ATTRIBUTION ?? "").trim().slice(0, 200) || DEFAULT_ATTRIBUTION[active];

  const config: RouteProxyConfig = {
    provider: active,
    baseUrl,
    attribution,
    timeoutMs,
    cacheTtlSeconds,
    maxWaypoints,
    maxResponseBytes,
    maxGeometryPoints: 20_000,
    userRatePerMinute,
    globalRatePerMinute
  };
  // Not enumerable: logging or serialising the config never prints the key.
  Object.defineProperty(config, "apiKey", { value: apiKey, enumerable: false });
  return config;
}
