import { HttpError } from "../middleware/error.js";
import {
  checkpointsAlongRoute,
  closedHits,
  congestedHits,
  distanceToPolyline,
  offsetFromSegment,
  prepareCheckpoints,
  selectCandidate,
  worstStatus,
  type Candidate,
  type CheckpointFeed,
  type CheckpointHit,
  type LatLng,
  type PlanStatus,
  type RoutingCheckpoint,
  type RoutingThresholds
} from "./checkpointRouting.js";

/**
 * Checkpoint-aware route planning on top of an OSRM-compatible engine.
 *
 * The public OSRM server cannot "avoid" points, so the planner asks for
 * alternatives, tests every candidate line against the checkpoint positions,
 * and, when the best candidate still passes a closed (or unavoidably congested)
 * checkpoint, tries a few detour candidates through "nudged" via points beside
 * the blocking checkpoint. It reports honestly when nothing clean was found.
 */

export type RoutePlannerConfig = RoutingThresholds & {
  osrmBaseUrl: string;
  timeoutMs: number;
  /** Upper bound on engine calls for one plan (legs + detour attempts). */
  maxEngineCalls: number;
  /** Keep a computed plan for this long (and while the status signature is unchanged). */
  planCacheSeconds: number;
  /** Keep raw engine answers for this long, so a status flip does not re-ask the engine. */
  engineCacheSeconds: number;
};

export const DEFAULT_PLANNER_CONFIG: RoutePlannerConfig = {
  thresholdMeters: 150,
  approximateThresholdMeters: 500,
  statusTtlSeconds: 300,
  congestionMaxExtraSeconds: 600,
  congestionMaxExtraMeters: 8_000,
  osrmBaseUrl: "https://router.project-osrm.org",
  timeoutMs: 6_000,
  maxEngineCalls: 14,
  planCacheSeconds: 30,
  engineCacheSeconds: 300
};

export const MAX_PLAN_WAYPOINTS = 6;

export type EngineRoute = { line: LatLng[]; distance_meters: number; duration_seconds: number };

/** One engine call: routes through [coordinates] in order. Throws on any failure. */
export interface RoutingEngine {
  route(coordinates: LatLng[], options: { alternatives: boolean }): Promise<EngineRoute[]>;
}

export class OsrmEngine implements RoutingEngine {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly transport: typeof fetch = fetch
  ) {}

  async route(coordinates: LatLng[], options: { alternatives: boolean }): Promise<EngineRoute[]> {
    const path = coordinates.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    const url = new URL(`/route/v1/driving/${path}`, this.baseUrl);
    url.searchParams.set("overview", "full");
    url.searchParams.set("geometries", "geojson");
    // OSRM only returns alternatives for a two-coordinate request.
    url.searchParams.set("alternatives", options.alternatives && coordinates.length === 2 ? "3" : "false");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(url, { signal: controller.signal, redirect: "error", headers: { Accept: "application/json" } });
      if (response.status !== 200) throw new Error(`engine_status_${response.status}`);
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > 5_000_000) throw new Error("engine_body_limit");
      const text = await response.text();
      if (text.length > 5_000_000) throw new Error("engine_body_limit");
      return parseOsrm(JSON.parse(text));
    } finally {
      clearTimeout(timer);
    }
  }
}

export function parseOsrm(payload: unknown): EngineRoute[] {
  const body = payload as { code?: unknown; routes?: unknown };
  if (!body || body.code !== "Ok" || !Array.isArray(body.routes) || body.routes.length === 0) throw new Error("engine_no_route");
  const routes: EngineRoute[] = [];
  for (const raw of body.routes as Array<Record<string, unknown>>) {
    const coordinates = (raw.geometry as { coordinates?: unknown } | undefined)?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const line: LatLng[] = [];
    for (const pair of coordinates as unknown[]) {
      if (!Array.isArray(pair) || typeof pair[0] !== "number" || typeof pair[1] !== "number") throw new Error("engine_malformed");
      line.push({ lat: pair[1], lng: pair[0] });
    }
    const distance = raw.distance;
    const duration = raw.duration;
    if (typeof distance !== "number" || typeof duration !== "number" || !Number.isFinite(distance) || !Number.isFinite(duration) || distance < 0 || duration < 0) {
      throw new Error("engine_malformed");
    }
    routes.push({ line, distance_meters: distance, duration_seconds: duration });
  }
  if (routes.length === 0) throw new Error("engine_malformed");
  return routes;
}

export type PlannedCheckpoint = {
  id: string;
  name_ar: string | null;
  name_en: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  status: "open" | "congested" | "closed" | "unknown";
  reported_status: "open" | "congested" | "closed" | "unknown";
  position_approximate: boolean;
  distance_meters?: number;
};

export type RoutePlan = {
  status: PlanStatus;
  /** GeoJSON order: [longitude, latitude]. */
  coordinates: Array<[number, number]>;
  distance_meters: number;
  duration_seconds: number;
  /** The engine's own fastest route, for comparison. */
  baseline: { distance_meters: number; duration_seconds: number };
  extra_distance_meters: number;
  extra_duration_seconds: number;
  checkpoints_on_route: PlannedCheckpoint[];
  avoided_checkpoints: PlannedCheckpoint[];
  warnings: string[];
  checkpoint_data: {
    available: boolean;
    fetched_at: string | null;
    status_trusted: boolean;
    threshold_meters: number;
    approximate_threshold_meters: number;
    status_ttl_seconds: number;
  };
  evaluated: { candidates: number; detour_candidates: number; engine_calls: number };
  provider: { name: "osrm"; attribution: string };
};

const planned = (checkpoint: RoutingCheckpoint, distance?: number): PlannedCheckpoint => ({
  id: checkpoint.id,
  name_ar: checkpoint.name_ar,
  name_en: checkpoint.name_en,
  city: checkpoint.city,
  latitude: checkpoint.latitude,
  longitude: checkpoint.longitude,
  status: checkpoint.status,
  reported_status: checkpoint.reported_status,
  position_approximate: checkpoint.position_approximate,
  ...(distance === undefined ? {} : { distance_meters: Math.round(distance) })
});

const roundCoordinate = (value: number) => value.toFixed(4);
const DETOUR_OFFSETS_METERS = [1_500, 4_000];

export class RoutePlanner {
  private readonly planCache = new Map<string, { until: number; value: RoutePlan }>();
  private readonly engineCache = new Map<string, { until: number; value: EngineRoute[] }>();
  private readonly inFlight = new Map<string, Promise<RoutePlan>>();

  constructor(
    private readonly engine: RoutingEngine,
    private readonly feed: () => Promise<CheckpointFeed>,
    private readonly config: RoutePlannerConfig = DEFAULT_PLANNER_CONFIG,
    private readonly now: () => Date = () => new Date()
  ) {}

  async plan(waypoints: LatLng[]): Promise<RoutePlan> {
    if (waypoints.length < 2 || waypoints.length > MAX_PLAN_WAYPOINTS) throw new HttpError(400, "invalid_waypoints");

    let prepared: ReturnType<typeof prepareCheckpoints> | null = null;
    let fetchedAt: string | null = null;
    try {
      const feed = await this.feed();
      prepared = prepareCheckpoints(feed, this.config, this.now());
      fetchedAt = feed.fetched_at;
    } catch {
      // Checkpoint data unavailable: the road route is still returned, flagged unchecked.
    }

    const signature = prepared
      ? prepared.checkpoints.map((c) => `${c.id}:${c.status}`).sort().join(",")
      : "none";
    const key = `${waypoints.map((p) => `${roundCoordinate(p.lat)},${roundCoordinate(p.lng)}`).join(";")}|${signature}`;
    const cached = this.planCache.get(key);
    if (cached && cached.until > this.now().getTime()) return cached.value;
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const run = this.compute(waypoints, prepared, fetchedAt)
      .then((value) => {
        this.planCache.set(key, { until: this.now().getTime() + this.config.planCacheSeconds * 1000, value });
        if (this.planCache.size > 200) this.planCache.delete(this.planCache.keys().next().value!);
        return value;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, run);
    return run;
  }

  private async engineRoutes(coordinates: LatLng[], alternatives: boolean, budget: { calls: number }): Promise<EngineRoute[]> {
    const key = `${alternatives ? "a" : "s"}|${coordinates.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(";")}`;
    const hit = this.engineCache.get(key);
    if (hit && hit.until > this.now().getTime()) return hit.value;
    if (budget.calls >= this.config.maxEngineCalls) throw new Error("engine_budget");
    budget.calls += 1;
    const value = await this.engine.route(coordinates, { alternatives });
    this.engineCache.set(key, { until: this.now().getTime() + this.config.engineCacheSeconds * 1000, value });
    if (this.engineCache.size > 300) this.engineCache.delete(this.engineCache.keys().next().value!);
    return value;
  }

  private candidate(route: EngineRoute, origin: Candidate["origin"], checkpoints: RoutingCheckpoint[]): Candidate {
    return { origin, ...route, hits: checkpointsAlongRoute(route.line, checkpoints, this.config) };
  }

  private async compute(waypoints: LatLng[], prepared: ReturnType<typeof prepareCheckpoints> | null, fetchedAt: string | null): Promise<RoutePlan> {
    const checkpoints = prepared?.checkpoints ?? [];
    const budget = { calls: 0 };
    const legs: Array<{ selection: ReturnType<typeof selectCandidate>; candidates: number; detours: number }> = [];
    for (let i = 0; i < waypoints.length - 1; i += 1) {
      legs.push(await this.planLeg(waypoints[i]!, waypoints[i + 1]!, checkpoints, budget, waypoints.length - 2 - i));
    }

    const coordinates: Array<[number, number]> = [];
    let distance = 0;
    let duration = 0;
    let baseDistance = 0;
    let baseDuration = 0;
    const onRoute = new Map<string, PlannedCheckpoint>();
    const avoided = new Map<string, PlannedCheckpoint>();
    const warnings = new Set<string>();
    for (const { selection } of legs) {
      const points = selection.chosen.line.map((p): [number, number] => [p.lng, p.lat]);
      coordinates.push(...(coordinates.length > 0 ? points.slice(1) : points));
      distance += selection.chosen.distance_meters;
      duration += selection.chosen.duration_seconds;
      baseDistance += selection.baseline.distance_meters;
      baseDuration += selection.baseline.duration_seconds;
      for (const hit of selection.chosen.hits) {
        if (!onRoute.has(hit.checkpoint.id)) onRoute.set(hit.checkpoint.id, planned(hit.checkpoint, hit.distance_meters));
      }
      for (const checkpoint of selection.avoided) avoided.set(checkpoint.id, planned(checkpoint));
      selection.warnings.forEach((w) => warnings.add(w));
    }
    // A checkpoint that one leg avoided but another leg passes is not "avoided".
    for (const id of onRoute.keys()) avoided.delete(id);

    let status: PlanStatus = worstStatus(legs.map((leg) => leg.selection.status));
    const available = prepared !== null;
    if (!available) {
      status = "unchecked";
      warnings.add("checkpoint_data_unavailable");
    } else {
      if (!prepared.statusTrusted) warnings.add("status_stale");
      if (checkpoints.length === 0) warnings.add("no_checkpoints_known");
    }
    return {
      status,
      coordinates,
      distance_meters: Math.round(distance),
      duration_seconds: Math.round(duration),
      baseline: { distance_meters: Math.round(baseDistance), duration_seconds: Math.round(baseDuration) },
      extra_distance_meters: Math.max(0, Math.round(distance - baseDistance)),
      extra_duration_seconds: Math.max(0, Math.round(duration - baseDuration)),
      checkpoints_on_route: [...onRoute.values()],
      avoided_checkpoints: [...avoided.values()],
      warnings: [...warnings],
      checkpoint_data: {
        available,
        fetched_at: fetchedAt,
        status_trusted: prepared?.statusTrusted ?? false,
        threshold_meters: this.config.thresholdMeters,
        approximate_threshold_meters: this.config.approximateThresholdMeters,
        status_ttl_seconds: this.config.statusTtlSeconds
      },
      evaluated: {
        candidates: legs.reduce((sum, leg) => sum + leg.candidates, 0),
        detour_candidates: legs.reduce((sum, leg) => sum + leg.detours, 0),
        engine_calls: budget.calls
      },
      provider: { name: "osrm", attribution: "© OpenStreetMap contributors" }
    };
  }

  private async planLeg(from: LatLng, to: LatLng, checkpoints: RoutingCheckpoint[], budget: { calls: number }, remainingLegs: number) {
    let routes: EngineRoute[];
    try {
      routes = await this.engineRoutes([from, to], true, budget);
    } catch (error) {
      void error;
      throw new HttpError(502, "route_provider_unavailable");
    }
    const candidates = routes.map((route, index) => this.candidate(route, index === 0 ? "osrm_primary" : "osrm_alternative", checkpoints));
    const baseline = candidates[0]!;
    let selection = selectCandidate(candidates, this.config, baseline);
    let detours = 0;

    // Nothing clean among the engine's alternatives: try detours beside the blocking checkpoint.
    const needsDetour = (s: typeof selection) =>
      s.status === "blocked" || (s.warnings.includes("congestion_unavoidable") && congestedHits(s.chosen).length > 0);
    if (needsDetour(selection) && checkpoints.length > 0) {
      const blockers = this.blockers(selection.chosen);
      const extra: Candidate[] = [];
      for (const hit of blockers) {
        for (const meters of DETOUR_OFFSETS_METERS) {
          for (const side of [1, -1]) {
            // Keep one engine call in hand for every leg still to be planned.
            if (budget.calls >= this.config.maxEngineCalls - remainingLegs) break;
            const at = { lat: hit.checkpoint.latitude, lng: hit.checkpoint.longitude };
            const via = offsetFromSegment(selection.chosen.line, hit.segment, at, side * meters);
            // A via point sitting on top of another closed checkpoint would only move the problem.
            if (checkpoints.some((c) => c.status === "closed" && distanceToPolyline(via, [{ lat: c.latitude, lng: c.longitude }]).meters < this.config.thresholdMeters)) continue;
            try {
              const [route] = await this.engineRoutes([from, via, to], false, budget);
              if (!route) continue;
              extra.push(this.candidate(route, "nudged", checkpoints));
              detours += 1;
            } catch {
              // One failed detour attempt is not a failed plan.
            }
          }
        }
      }
      if (extra.length > 0) {
        // Keep the engine's own fastest route as the comparison baseline.
        selection = selectCandidate([...candidates, ...extra], this.config, baseline);
      }
    }
    return { selection, candidates: candidates.length, detours };
  }

  /** Closed checkpoints on a candidate, or its congested ones when nothing is closed. */
  private blockers(candidate: Candidate): CheckpointHit[] {
    const closed = closedHits(candidate);
    return (closed.length > 0 ? closed : congestedHits(candidate)).slice(0, 2);
  }
}
