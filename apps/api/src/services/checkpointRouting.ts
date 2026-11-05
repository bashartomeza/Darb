/**
 * Checkpoint-aware route selection: pure geometry and decision logic, no I/O.
 *
 * A routing engine (OSRM) knows roads, not barriers. Given candidate road
 * polylines for one origin-destination pair, this module finds which known
 * checkpoints a candidate passes (within a distance threshold), decides how
 * much to trust each checkpoint's status, and picks the candidate to show.
 *
 * Rules (see docs/api/route-plans.md and docs/decisions/0004-checkpoint-aware-routing.md):
 * - A CLOSED checkpoint on a candidate disqualifies it when any candidate is free of closed ones.
 * - A CONGESTED checkpoint is avoided only when the clean alternative costs no more than the
 *   configured extra time AND extra distance; otherwise the route stays and carries a warning.
 * - Status older than the TTL (or from a feed flagged stale) is UNKNOWN: never closed, never open.
 * - A checkpoint whose position is approximate is matched with a wider radius (conservative).
 * - UNKNOWN checkpoints never change the choice; they are only listed.
 * - If every candidate passes a closed checkpoint the least-bad one is returned with the
 *   `all_routes_closed` warning; the caller must show it rather than pass it off as a clean route.
 */

export type TrafficStatus = "open" | "congested" | "closed" | "unknown";

export type LatLng = { lat: number; lng: number };

/** A checkpoint as the feeds give it (coordinate feed or partner map). */
export type FeedCheckpoint = {
  id: string;
  name_ar?: string | null;
  name_en?: string | null;
  city?: string | null;
  latitude: number;
  longitude: number;
  status: TrafficStatus;
  /** Partner pins rated low or unverified. */
  position_approximate?: boolean;
};

export type CheckpointFeed = {
  checkpoints: FeedCheckpoint[];
  /** ISO time the feed was read from its source. */
  fetched_at: string;
  /** The feed itself says it is serving an old read. */
  stale?: boolean;
};

export type RoutingCheckpoint = {
  id: string;
  name_ar: string | null;
  name_en: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  /** Status as the feed reported it. */
  reported_status: TrafficStatus;
  /** Status used for decisions: `unknown` when the data is older than the TTL. */
  status: TrafficStatus;
  position_approximate: boolean;
};

export type RoutingThresholds = {
  /** A checkpoint within this distance of the polyline counts as on the route. */
  thresholdMeters: number;
  /** Same, for a checkpoint whose position is only approximate. */
  approximateThresholdMeters: number;
  /** Feed older than this is treated as unknown status. */
  statusTtlSeconds: number;
  /** A congestion-free alternative is taken only if it costs at most this much extra time ... */
  congestionMaxExtraSeconds: number;
  /** ... and at most this much extra distance. */
  congestionMaxExtraMeters: number;
};

export const DEFAULT_THRESHOLDS: RoutingThresholds = {
  thresholdMeters: 150,
  approximateThresholdMeters: 500,
  statusTtlSeconds: 300,
  congestionMaxExtraSeconds: 600,
  congestionMaxExtraMeters: 8_000
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Prepares the feed for routing. Rows with unusable coordinates are dropped.
 * When the feed is older than the TTL (or flagged stale, or has no readable time)
 * every status becomes `unknown`, so a possibly outdated "closed" never reroutes
 * a driver and a possibly outdated "open" never reassures one.
 */
export function prepareCheckpoints(
  feed: CheckpointFeed,
  thresholds: Pick<RoutingThresholds, "statusTtlSeconds">,
  now: Date = new Date()
): { checkpoints: RoutingCheckpoint[]; statusTrusted: boolean } {
  const fetchedAt = Date.parse(feed.fetched_at);
  const ageSeconds = Number.isFinite(fetchedAt) ? (now.getTime() - fetchedAt) / 1000 : Number.POSITIVE_INFINITY;
  const statusTrusted = feed.stale !== true && ageSeconds <= thresholds.statusTtlSeconds;
  const checkpoints: RoutingCheckpoint[] = [];
  for (const row of feed.checkpoints) {
    if (!finite(row.latitude) || !finite(row.longitude)) continue;
    if (Math.abs(row.latitude) > 90 || Math.abs(row.longitude) > 180) continue;
    if (row.latitude === 0 && row.longitude === 0) continue;
    checkpoints.push({
      id: row.id,
      name_ar: row.name_ar ?? null,
      name_en: row.name_en ?? null,
      city: row.city ?? null,
      latitude: row.latitude,
      longitude: row.longitude,
      reported_status: row.status,
      status: statusTrusted ? row.status : "unknown",
      position_approximate: row.position_approximate === true
    });
  }
  return { checkpoints, statusTrusted };
}

// ---------------------------------------------------------------- geometry

const METERS_PER_DEGREE_LAT = 111_320;

/** Haversine distance in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Distance from a point to a segment, and the 0..1 position of the closest point on it. */
function segmentDistance(point: LatLng, a: LatLng, b: LatLng): { meters: number; t: number } {
  const kx = METERS_PER_DEGREE_LAT * Math.cos(point.lat * (Math.PI / 180));
  const ky = METERS_PER_DEGREE_LAT;
  const ax = (a.lng - point.lng) * kx;
  const ay = (a.lat - point.lat) * ky;
  const bx = (b.lng - point.lng) * kx;
  const by = (b.lat - point.lat) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  const px = ax + t * dx;
  const py = ay + t * dy;
  return { meters: Math.hypot(px, py), t };
}

/** Closest distance from [point] to the polyline, and the index of the segment it is nearest to. */
export function distanceToPolyline(point: LatLng, line: LatLng[]): { meters: number; segment: number; t: number } {
  if (line.length === 0) return { meters: Number.POSITIVE_INFINITY, segment: -1, t: 0 };
  if (line.length === 1) return { meters: distanceMeters(point, line[0]!), segment: 0, t: 0 };
  let best = { meters: Number.POSITIVE_INFINITY, segment: 0, t: 0 };
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i]!;
    const b = line[i + 1]!;
    // Cheap reject: both ends further than ~0.2 degrees (>20 km) from the point.
    if (Math.abs(a.lat - point.lat) > 0.2 && Math.abs(b.lat - point.lat) > 0.2) {
      if ((a.lat - point.lat) * (b.lat - point.lat) > 0) continue;
    }
    const result = segmentDistance(point, a, b);
    if (result.meters < best.meters) best = { meters: result.meters, segment: i, t: result.t };
  }
  return best;
}

/** Bearing-free perpendicular offset: a point [meters] to the left (positive) or right of the line at [segment]. */
export function offsetFromSegment(line: LatLng[], segment: number, at: LatLng, meters: number): LatLng {
  const a = line[Math.max(0, Math.min(line.length - 2, segment))]!;
  const b = line[Math.max(1, Math.min(line.length - 1, segment + 1))]!;
  const kx = Math.cos(at.lat * (Math.PI / 180));
  const dx = (b.lng - a.lng) * kx;
  const dy = b.lat - a.lat;
  const length = Math.hypot(dx, dy) || 1;
  // Left normal of the direction of travel, in degree space.
  const nx = -dy / length;
  const ny = dx / length;
  return {
    lat: at.lat + (ny * meters) / METERS_PER_DEGREE_LAT,
    lng: at.lng + (nx * meters) / (METERS_PER_DEGREE_LAT * kx)
  };
}

// -------------------------------------------------------------- evaluation

export type CheckpointHit = {
  checkpoint: RoutingCheckpoint;
  /** Closest distance between the checkpoint and the route line. */
  distance_meters: number;
  /** Where along the route (0 start .. 1 end, by segment index) the closest point lies. */
  progress: number;
  segment: number;
};

/** Checkpoints a polyline passes, ordered along the route. */
export function checkpointsAlongRoute(
  line: LatLng[],
  checkpoints: RoutingCheckpoint[],
  thresholds: Pick<RoutingThresholds, "thresholdMeters" | "approximateThresholdMeters">
): CheckpointHit[] {
  const hits: CheckpointHit[] = [];
  const segments = Math.max(1, line.length - 1);
  for (const checkpoint of checkpoints) {
    const limit = checkpoint.position_approximate ? thresholds.approximateThresholdMeters : thresholds.thresholdMeters;
    const near = distanceToPolyline({ lat: checkpoint.latitude, lng: checkpoint.longitude }, line);
    if (near.meters <= limit) {
      hits.push({ checkpoint, distance_meters: near.meters, progress: (near.segment + near.t) / segments, segment: near.segment });
    }
  }
  return hits.sort((a, b) => a.progress - b.progress);
}

export type Candidate = {
  /** Where the candidate came from, for diagnostics. */
  origin: "osrm_primary" | "osrm_alternative" | "nudged";
  line: LatLng[];
  distance_meters: number;
  duration_seconds: number;
  hits: CheckpointHit[];
};

export const closedHits = (c: Candidate) => c.hits.filter((hit) => hit.checkpoint.status === "closed");
export const congestedHits = (c: Candidate) => c.hits.filter((hit) => hit.checkpoint.status === "congested");

export type PlanStatus =
  /** Nothing closed or congested on the chosen route. */
  | "clear"
  /** The fastest route passed a closed checkpoint; this one does not. */
  | "rerouted_closed"
  /** The fastest route passed a congested checkpoint; this reasonable alternative does not. */
  | "rerouted_congestion"
  /** Congestion on the route and no reasonable alternative. */
  | "congestion_warning"
  /** Every known route passes a closed checkpoint. */
  | "blocked"
  /** No checkpoint data was available, so nothing was checked. */
  | "unchecked";

export type Selection = {
  chosen: Candidate;
  baseline: Candidate;
  status: PlanStatus;
  /** Closed or congested checkpoints on the baseline that the chosen route no longer passes. */
  avoided: RoutingCheckpoint[];
  warnings: string[];
};

const byDuration = (a: Candidate, b: Candidate) => a.duration_seconds - b.duration_seconds;

/**
 * Picks the candidate to show. `baseline` is the engine's own fastest route
 * (candidates[0] unless told otherwise); "avoided" and "extra" are measured against it.
 */
export function selectCandidate(candidates: Candidate[], thresholds: RoutingThresholds, baseline: Candidate = candidates[0]!): Selection {
  const warnings: string[] = [];
  const sorted = [...candidates].sort(byDuration);
  const free = sorted.filter((c) => closedHits(c).length === 0);

  let chosen: Candidate;
  let blocked = false;
  if (free.length === 0) {
    // Every route passes a closed checkpoint: show the one passing the fewest, fastest first.
    blocked = true;
    chosen = [...sorted].sort((a, b) => closedHits(a).length - closedHits(b).length || byDuration(a, b))[0]!;
    warnings.push("all_routes_closed");
  } else {
    chosen = free[0]!;
    if (congestedHits(chosen).length > 0) {
      const calm = free.find((c) => congestedHits(c).length === 0);
      if (
        calm &&
        calm.duration_seconds - chosen.duration_seconds <= thresholds.congestionMaxExtraSeconds &&
        calm.distance_meters - chosen.distance_meters <= thresholds.congestionMaxExtraMeters
      ) {
        chosen = calm;
      } else {
        warnings.push("congestion_unavoidable");
      }
    }
  }

  const stillOn = new Set(chosen.hits.map((hit) => hit.checkpoint.id));
  const avoided = baseline.hits
    .filter((hit) => (hit.checkpoint.status === "closed" || hit.checkpoint.status === "congested") && !stillOn.has(hit.checkpoint.id))
    .map((hit) => hit.checkpoint);
  const baselineClosed = closedHits(baseline).length > 0;
  const baselineCongested = congestedHits(baseline).length > 0;

  let status: PlanStatus;
  if (blocked) status = "blocked";
  else if (chosen !== baseline && baselineClosed) status = "rerouted_closed";
  else if (chosen !== baseline && baselineCongested) status = "rerouted_congestion";
  else if (congestedHits(chosen).length > 0) status = "congestion_warning";
  else status = "clear";

  if (chosen.hits.some((hit) => hit.checkpoint.position_approximate && hit.checkpoint.status !== "open")) {
    warnings.push("position_approximate");
  }
  return { chosen, baseline, status, avoided, warnings };
}

/** Worst status first, for combining several legs of one trip. */
const STATUS_RANK: Record<PlanStatus, number> = {
  unchecked: 0,
  clear: 1,
  rerouted_congestion: 2,
  rerouted_closed: 3,
  congestion_warning: 4,
  blocked: 5
};
export function worstStatus(statuses: PlanStatus[]): PlanStatus {
  return statuses.reduce<PlanStatus>((worst, next) => (STATUS_RANK[next] > STATUS_RANK[worst] ? next : worst), "unchecked");
}
