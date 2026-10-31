import { DEMO_ROUTE_POINTS, haversineKm, LOCKED_DESTINATION, LOCKED_ORIGIN, round, type Point } from "../lib/geo.js";
import { compareRankedRoutes, scoreDriverRoute } from "../lib/routeScoring.js";

/**
 * Deterministic simulation that compares three dispatch methods over the same
 * scenarios. Everything here is SIMULATED: no database is read and no real
 * trip is created. See docs/engineering/matching-comparison-simulation.md.
 */

export type MethodKey = "manual" | "nearest" | "masari";
export const METHOD_KEYS: readonly MethodKey[] = ["manual", "nearest", "masari"];

export type SimDriver = {
  id: string;
  direction: "forward" | "reverse";
  origin: Point;
  destination: Point;
  /** Minute at which the driver leaves; after that the driver can no longer take requests. */
  departAt: number;
  seats: number;
  parcelCapacity: number;
  trustScore: number;
};

export type SimRequest = {
  id: string;
  kind: "passenger" | "parcel";
  requestedAt: number;
  pickup: Point;
  dropoff: Point;
  passengers: number;
  parcels: number;
  merchantId?: string;
};

export type SimScenario = {
  key: string;
  label: string;
  origin: "hand_written" | "generated";
  drivers: SimDriver[];
  requests: SimRequest[];
};

export type SimParams = {
  seed: number;
  /** Mean minutes a dispatcher waits for one driver's reply in the manual (WhatsApp-style) method. */
  manualResponseDelayMin: number;
  manualMaxAsks: number;
  manualAcceptProbability: number;
  manualWrongDirectionAcceptProbability: number;
  /** Fixed processing delay of the nearest-driver method. */
  nearestMatchDelayMin: number;
  /** Delay between a Masari match run and the driver accepting the offer. */
  masariOfferDelayMin: number;
  /** Orders from one merchant submitted within this many minutes of the first one share a batch. */
  masariBatchWindowMin: number;
  driverSpeedKmh: number;
};

export const DEFAULT_SIM_PARAMS: SimParams = {
  seed: 20261029,
  manualResponseDelayMin: 4,
  manualMaxAsks: 8,
  manualAcceptProbability: 0.6,
  manualWrongDirectionAcceptProbability: 0.15,
  nearestMatchDelayMin: 0.5,
  masariOfferDelayMin: 1.5,
  masariBatchWindowMin: 6,
  driverSpeedKmh: 40
};

/** Values copied from the real batching module (createParcelBatch). */
export const BATCH_RULES = { maxPickupSpreadKm: 1, maxOrders: 20, maxParcels: 50 } as const;

const FORWARD_LABELS = { origin: "Hebron / PPU / Bab Al-Zawiya", destination: "Bethlehem" };
const REVERSE_LABELS = { origin: "Bethlehem", destination: "Hebron / PPU / Bab Al-Zawiya" };

// ---------------------------------------------------------------- random

export function hashSeed(...parts: Array<string | number>) {
  let hash = 2166136261;
  for (const char of parts.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, fully deterministic. */
export function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -------------------------------------------------------------- geometry

const segmentLengths = DEMO_ROUTE_POINTS.slice(1).map((point, index) => haversineKm(DEMO_ROUTE_POINTS[index]!, point));
const corridorLengthKm = segmentLengths.reduce((sum, value) => sum + value, 0);

/** Point at a fraction (0..1) of the real demo corridor, shifted north by offsetKm. */
export function corridorPoint(fraction: number, offsetKm = 0): Point {
  let remaining = Math.min(1, Math.max(0, fraction)) * corridorLengthKm;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const length = segmentLengths[index]!;
    if (remaining <= length || index === segmentLengths.length - 1) {
      const ratio = length === 0 ? 0 : Math.min(1, remaining / length);
      const a = DEMO_ROUTE_POINTS[index]!;
      const b = DEMO_ROUTE_POINTS[index + 1]!;
      return { lat: a.lat + (b.lat - a.lat) * ratio + offsetKm / 111, lng: a.lng + (b.lng - a.lng) * ratio };
    }
    remaining -= length;
  }
  return LOCKED_DESTINATION;
}

function forwardDriver(id: string, departAt: number, seats: number, parcelCapacity: number, trustScore: number, jitterKm = 0): SimDriver {
  return {
    id, direction: "forward", departAt, seats, parcelCapacity, trustScore,
    origin: { lat: LOCKED_ORIGIN.lat + jitterKm / 111, lng: LOCKED_ORIGIN.lng },
    destination: LOCKED_DESTINATION
  };
}

function reverseDriver(id: string, departAt: number, seats: number, parcelCapacity: number, trustScore: number, jitterKm = 0): SimDriver {
  return {
    id, direction: "reverse", departAt, seats, parcelCapacity, trustScore,
    origin: { lat: LOCKED_DESTINATION.lat - jitterKm / 111, lng: LOCKED_DESTINATION.lng },
    destination: LOCKED_ORIGIN
  };
}

function passenger(id: string, requestedAt: number, from: number, to: number, offsetKm: number, passengers = 1): SimRequest {
  return { id, kind: "passenger", requestedAt, pickup: corridorPoint(from, offsetKm), dropoff: corridorPoint(to), passengers, parcels: 0 };
}

function parcelOrder(id: string, merchantId: string, requestedAt: number, spotFraction: number, parcels: number): SimRequest {
  // Every order of one merchant ships from the same shop, so pickups differ by metres only.
  return {
    id, kind: "parcel", merchantId, requestedAt, parcels, passengers: 0,
    pickup: corridorPoint(spotFraction, 0.1), dropoff: LOCKED_DESTINATION
  };
}

// ------------------------------------------------------------- scenarios

export function generateScenario(
  seed: number,
  spec: { key: string; label: string; passengers: number; parcelOrders: number; drivers: number; windowMin: number; reverseDriverShare: number }
): SimScenario {
  const rng = createRng(hashSeed(seed, "scenario", spec.key));
  const requests: SimRequest[] = [];
  for (let index = 0; index < spec.passengers; index += 1) {
    const from = rng() * 0.6;
    const to = Math.min(0.99, from + 0.25 + rng() * 0.3);
    requests.push(passenger(`${spec.key}-p${index + 1}`, round(rng() * spec.windowMin, 2), from, to, round(rng() * 2.5, 2), 1 + Math.floor(rng() * 3)));
  }
  const merchants = [
    { id: `${spec.key}-m1`, spot: 0.03 },
    { id: `${spec.key}-m2`, spot: 0.4 }
  ];
  for (let index = 0; index < spec.parcelOrders; index += 1) {
    const merchant = merchants[Math.floor(rng() * merchants.length)]!;
    requests.push(parcelOrder(`${spec.key}-o${index + 1}`, merchant.id, round(rng() * spec.windowMin, 2), merchant.spot, 1 + Math.floor(rng() * 5)));
  }
  requests.sort((a, b) => a.requestedAt - b.requestedAt || a.id.localeCompare(b.id));

  const drivers: SimDriver[] = [];
  const seatChoices = [3, 4, 6];
  const parcelChoices = [5, 10, 20];
  for (let index = 0; index < spec.drivers; index += 1) {
    const departAt = round(8 + rng() * (spec.windowMin + 25), 2);
    const seats = seatChoices[Math.floor(rng() * seatChoices.length)]!;
    const parcels = parcelChoices[Math.floor(rng() * parcelChoices.length)]!;
    const trust = 60 + Math.floor(rng() * 41);
    const jitter = round(rng() * 3, 2);
    const id = `${spec.key}-d${index + 1}`;
    drivers.push(rng() < spec.reverseDriverShare ? reverseDriver(id, departAt, seats, parcels, trust, jitter) : forwardDriver(id, departAt, seats, parcels, trust, jitter));
  }
  return { key: spec.key, label: spec.label, origin: "generated", drivers, requests };
}

function handWrittenScenarios(): SimScenario[] {
  const rush: SimScenario = {
    key: "morning_commute_rush",
    label: "Morning commute rush",
    origin: "hand_written",
    drivers: [
      forwardDriver("rush-d1", 12, 4, 5, 92, 0.4), forwardDriver("rush-d2", 18, 4, 5, 85, 1.2),
      forwardDriver("rush-d3", 24, 6, 10, 78, 0.8), forwardDriver("rush-d4", 30, 4, 5, 95, 2),
      forwardDriver("rush-d5", 36, 6, 20, 70, 0.2), forwardDriver("rush-d6", 42, 4, 5, 88, 1.6),
      reverseDriver("rush-d7", 20, 4, 5, 90, 0.5), reverseDriver("rush-d8", 34, 4, 5, 82, 1.5)
    ],
    requests: Array.from({ length: 24 }, (_, index) =>
      passenger(`rush-p${index + 1}`, round(index * 1.25, 2), (index * 0.037) % 0.6, Math.min(0.98, ((index * 0.037) % 0.6) + 0.3), (index % 4) * 0.6, index % 3 === 0 ? 2 : 1)
    )
  };
  const parcelWave: SimScenario = {
    key: "merchant_parcel_wave",
    label: "Merchant parcel wave",
    origin: "hand_written",
    drivers: [
      forwardDriver("wave-d1", 15, 3, 30, 90, 0.5), forwardDriver("wave-d2", 25, 3, 20, 84, 1.1),
      forwardDriver("wave-d3", 35, 4, 12, 75, 0.3), reverseDriver("wave-d4", 18, 4, 30, 96, 0.4)
    ],
    requests: [
      ...Array.from({ length: 8 }, (_, index) => parcelOrder(`wave-a${index + 1}`, "wave-m1", index * 0.5, 0.03, 1 + (index % 3))),
      ...Array.from({ length: 6 }, (_, index) => parcelOrder(`wave-b${index + 1}`, "wave-m2", 2 + index * 0.7, 0.4, 1 + (index % 2))),
      passenger("wave-p1", 3, 0.05, 0.9, 0.5), passenger("wave-p2", 6, 0.1, 0.8, 1)
    ].sort((a, b) => a.requestedAt - b.requestedAt || a.id.localeCompare(b.id))
  };
  const sparse: SimScenario = {
    key: "sparse_evening",
    label: "Sparse evening",
    origin: "hand_written",
    drivers: [
      forwardDriver("eve-d1", 20, 4, 5, 80, 0.5), forwardDriver("eve-d2", 45, 4, 5, 91, 1),
      forwardDriver("eve-d3", 70, 6, 10, 73, 2), reverseDriver("eve-d4", 30, 4, 5, 88, 0.5),
      reverseDriver("eve-d5", 60, 4, 5, 95, 1), forwardDriver("eve-d6", 90, 4, 5, 86, 0.9)
    ],
    requests: [
      passenger("eve-p1", 0, 0.1, 0.9, 0.5), passenger("eve-p2", 15, 0.3, 0.95, 1.5),
      passenger("eve-p3", 28, 0.05, 0.6, 0.2), passenger("eve-p4", 50, 0.5, 0.97, 2), passenger("eve-p5", 66, 0.2, 0.9, 0.8, 2)
    ]
  };
  const trap: SimScenario = {
    key: "wrong_direction_trap",
    label: "Wrong-direction trap",
    origin: "hand_written",
    drivers: [
      reverseDriver("trap-d1", 10, 4, 5, 90, 0.3), reverseDriver("trap-d2", 14, 4, 5, 88, 0.6),
      forwardDriver("trap-d3", 16, 4, 5, 82, 1.5), forwardDriver("trap-d4", 22, 6, 10, 76, 2.5)
    ],
    requests: [
      passenger("trap-p1", 0, 0.88, 0.99, 0.3), passenger("trap-p2", 2, 0.85, 0.98, 0.5),
      passenger("trap-p3", 4, 0.9, 1, 0.2), passenger("trap-p4", 6, 0.8, 0.97, 0.9)
    ]
  };
  return [rush, parcelWave, sparse, trap];
}

export function buildScenarioSet(seed: number): SimScenario[] {
  return [
    ...handWrittenScenarios(),
    generateScenario(seed, { key: "generated_small", label: "Generated: small day", passengers: 8, parcelOrders: 4, drivers: 5, windowMin: 40, reverseDriverShare: 0.3 }),
    generateScenario(seed, { key: "generated_medium", label: "Generated: medium day", passengers: 20, parcelOrders: 10, drivers: 10, windowMin: 60, reverseDriverShare: 0.3 }),
    generateScenario(seed, { key: "generated_busy", label: "Generated: busy day", passengers: 40, parcelOrders: 20, drivers: 14, windowMin: 90, reverseDriverShare: 0.35 })
  ];
}

// --------------------------------------------------------------- engine

type Unit = { members: SimRequest[]; readyAt: number; pickup: Point; dropoff: Point; passengers: number; parcels: number };

type DriverState = { driver: SimDriver; seatsLeft: number; parcelsLeft: number; units: Unit[] };

export type RawMetrics = {
  total: number;
  matched: number;
  waits: number[];
  matchTimes: number[];
  extraKm: number;
  vehiclesUsed: number;
  vehiclesTotal: number;
  seatsUsed: number;
  seatCapacityOfUsed: number;
  parcelsUsed: number;
  parcelCapacityOfUsed: number;
};

function emptyRaw(): RawMetrics {
  return { total: 0, matched: 0, waits: [], matchTimes: [], extraKm: 0, vehiclesUsed: 0, vehiclesTotal: 0, seatsUsed: 0, seatCapacityOfUsed: 0, parcelsUsed: 0, parcelCapacityOfUsed: 0 };
}

function unitOf(request: SimRequest): Unit {
  return { members: [request], readyAt: request.requestedAt, pickup: request.pickup, dropoff: request.dropoff, passengers: request.passengers, parcels: request.parcels };
}

function fits(state: DriverState, unit: Unit, at: number) {
  return state.driver.departAt >= at && state.seatsLeft >= unit.passengers && state.parcelsLeft >= unit.parcels;
}

/** Km driven beyond the driver's own planned trip: origin -> pickups -> drop-offs -> destination. */
export function tourExtraKm(driver: SimDriver, units: Unit[]) {
  if (units.length === 0) return 0;
  const byDistance = (a: Point, b: Point) => haversineKm(driver.origin, a) - haversineKm(driver.origin, b);
  const stops = [
    ...units.map((unit) => unit.pickup).sort(byDistance),
    ...units.map((unit) => unit.dropoff).sort(byDistance)
  ];
  let km = 0;
  let current = driver.origin;
  for (const stop of [...stops, driver.destination]) {
    km += haversineKm(current, stop);
    current = stop;
  }
  return Math.max(0, km - haversineKm(driver.origin, driver.destination));
}

function commit(raw: RawMetrics, state: DriverState, unit: Unit, matchDone: number, params: SimParams) {
  state.seatsLeft -= unit.passengers;
  state.parcelsLeft -= unit.parcels;
  state.units.push(unit);
  const pickupEta = Math.max(state.driver.departAt, matchDone) + (haversineKm(state.driver.origin, unit.pickup) / params.driverSpeedKmh) * 60;
  for (const member of unit.members) {
    raw.matched += 1;
    raw.waits.push(pickupEta - member.requestedAt);
    raw.matchTimes.push(matchDone - member.requestedAt);
  }
}

function finish(raw: RawMetrics, states: Map<string, DriverState>) {
  raw.vehiclesTotal = states.size;
  for (const state of states.values()) {
    if (state.units.length === 0) continue;
    raw.vehiclesUsed += 1;
    raw.extraKm += tourExtraKm(state.driver, state.units);
    const seats = state.units.reduce((sum, unit) => sum + unit.passengers, 0);
    const parcels = state.units.reduce((sum, unit) => sum + unit.parcels, 0);
    if (seats > 0) {
      raw.seatsUsed += seats;
      raw.seatCapacityOfUsed += state.driver.seats;
    }
    if (parcels > 0) {
      raw.parcelsUsed += parcels;
      raw.parcelCapacityOfUsed += state.driver.parcelCapacity;
    }
  }
  return raw;
}

function freshStates(scenario: SimScenario) {
  return new Map(scenario.drivers.map((driver) => [driver.id, { driver, seatsLeft: driver.seats, parcelsLeft: driver.parcelCapacity, units: [] as Unit[] } satisfies DriverState]));
}

function orderedRequests(scenario: SimScenario) {
  return [...scenario.requests].sort((a, b) => a.requestedAt - b.requestedAt || a.id.localeCompare(b.id));
}

function runManual(scenario: SimScenario, params: SimParams): RawMetrics {
  const rng = createRng(hashSeed(params.seed, scenario.key, "manual"));
  const states = freshStates(scenario);
  const raw = emptyRaw();
  let dispatcherFreeAt = 0;
  for (const request of orderedRequests(scenario)) {
    raw.total += 1;
    const unit = unitOf(request);
    let now = Math.max(request.requestedAt, dispatcherFreeAt);
    const pool = [...states.values()].filter((state) => state.driver.departAt >= now);
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(rng() * (index + 1));
      [pool[index], pool[swap]] = [pool[swap]!, pool[index]!];
    }
    let accepted: DriverState | null = null;
    for (const state of pool.slice(0, params.manualMaxAsks)) {
      now += params.manualResponseDelayMin * (0.5 + rng());
      if (!fits(state, unit, now)) continue;
      const sameDirection = state.driver.direction === "forward";
      const probability = sameDirection ? params.manualAcceptProbability : params.manualWrongDirectionAcceptProbability;
      if (rng() < probability) {
        accepted = state;
        break;
      }
    }
    dispatcherFreeAt = now;
    if (accepted) commit(raw, accepted, unit, now, params);
  }
  return finish(raw, states);
}

function runNearest(scenario: SimScenario, params: SimParams): RawMetrics {
  const states = freshStates(scenario);
  const raw = emptyRaw();
  for (const request of orderedRequests(scenario)) {
    raw.total += 1;
    const unit = unitOf(request);
    const matchDone = request.requestedAt + params.nearestMatchDelayMin;
    const candidate = [...states.values()]
      .filter((state) => fits(state, unit, matchDone))
      .sort((a, b) => haversineKm(a.driver.origin, request.pickup) - haversineKm(b.driver.origin, request.pickup) || a.driver.id.localeCompare(b.driver.id))[0];
    if (candidate) commit(raw, candidate, unit, matchDone, params);
  }
  return finish(raw, states);
}

/** Groups parcel orders the way createParcelBatch does: same merchant, pickups within 1 km, 20 orders / 50 parcels. */
export function batchParcelOrders(requests: SimRequest[], windowMin: number): Unit[] {
  const units: Unit[] = [];
  const used = new Set<string>();
  const sorted = [...requests].sort((a, b) => a.requestedAt - b.requestedAt || a.id.localeCompare(b.id));
  for (const seed of sorted) {
    if (used.has(seed.id)) continue;
    if (seed.kind === "passenger") {
      used.add(seed.id);
      units.push(unitOf(seed));
      continue;
    }
    const members: SimRequest[] = [];
    let parcels = 0;
    for (const candidate of sorted) {
      if (used.has(candidate.id) || candidate.kind !== "parcel" || candidate.merchantId !== seed.merchantId) continue;
      if (candidate.requestedAt - seed.requestedAt > windowMin) continue;
      if (haversineKm(candidate.pickup, seed.pickup) > BATCH_RULES.maxPickupSpreadKm) continue;
      if (members.length >= BATCH_RULES.maxOrders || parcels + candidate.parcels > BATCH_RULES.maxParcels) continue;
      members.push(candidate);
      parcels += candidate.parcels;
      used.add(candidate.id);
    }
    units.push({
      members, parcels, passengers: 0, pickup: seed.pickup, dropoff: seed.dropoff,
      readyAt: Math.max(...members.map((member) => member.requestedAt))
    });
  }
  return units.sort((a, b) => a.readyAt - b.readyAt || a.members[0]!.id.localeCompare(b.members[0]!.id));
}

function runMasari(scenario: SimScenario, params: SimParams): RawMetrics {
  const states = freshStates(scenario);
  const raw = emptyRaw();
  raw.total = scenario.requests.length;
  for (const unit of batchParcelOrders(scenario.requests, params.masariBatchWindowMin)) {
    const matchDone = unit.readyAt + params.masariOfferDelayMin;
    const lead = unit.members[0]!;
    const ranked = [...states.values()]
      .filter((state) => fits(state, unit, matchDone))
      .map((state) => {
        const labels = state.driver.direction === "forward" ? FORWARD_LABELS : REVERSE_LABELS;
        const route = {
          id: state.driver.id,
          origin_label: labels.origin,
          destination_label: labels.destination,
          origin_lat: state.driver.origin.lat,
          origin_lng: state.driver.origin.lng,
          seats_available: state.seatsLeft,
          parcel_capacity_available: state.parcelsLeft,
          driver: { trust_score: state.driver.trustScore }
        };
        const breakdown = scoreDriverRoute({
          route,
          passengerRequest:
            lead.kind === "passenger"
              ? { pickup_lat: lead.pickup.lat, pickup_lng: lead.pickup.lng, passenger_count: lead.passengers, preferred_time: new Date(0) }
              : null,
          parcelCount: unit.parcels
        });
        return { state, route, breakdown };
      })
      .sort(compareRankedRoutes);
    const best = ranked[0];
    if (best) commit(raw, best.state, unit, matchDone, params);
  }
  return finish(raw, states);
}

// -------------------------------------------------------------- reporting

export function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export type Distribution = { avg: number; median: number; p90: number };

function distribution(values: number[]): Distribution {
  if (values.length === 0) return { avg: 0, median: 0, p90: 0 };
  return {
    avg: round(values.reduce((sum, value) => sum + value, 0) / values.length, 2),
    median: round(percentile(values, 50), 2),
    p90: round(percentile(values, 90), 2)
  };
}

export type MethodMetrics = {
  requests: number;
  matched: number;
  unmatched: number;
  unmatchedPct: number;
  waitingMin: Distribution;
  matchingMin: Distribution;
  routeDeviationKm: number;
  routeDeviationKmPerMatched: number;
  vehiclesUsed: number;
  vehiclesTotal: number;
  vehicleUtilisationPct: number;
  seatUtilisationPct: number;
  parcelUtilisationPct: number;
};

const pct = (num: number, den: number) => (den === 0 ? 0 : round((num / den) * 100, 1));

export function summarise(raw: RawMetrics): MethodMetrics {
  return {
    requests: raw.total,
    matched: raw.matched,
    unmatched: raw.total - raw.matched,
    unmatchedPct: pct(raw.total - raw.matched, raw.total),
    waitingMin: distribution(raw.waits),
    matchingMin: distribution(raw.matchTimes),
    routeDeviationKm: round(raw.extraKm, 2),
    routeDeviationKmPerMatched: raw.matched === 0 ? 0 : round(raw.extraKm / raw.matched, 2),
    vehiclesUsed: raw.vehiclesUsed,
    vehiclesTotal: raw.vehiclesTotal,
    vehicleUtilisationPct: pct(raw.vehiclesUsed, raw.vehiclesTotal),
    seatUtilisationPct: pct(raw.seatsUsed, raw.seatCapacityOfUsed),
    parcelUtilisationPct: pct(raw.parcelsUsed, raw.parcelCapacityOfUsed)
  };
}

function merge(into: RawMetrics, from: RawMetrics) {
  into.total += from.total;
  into.matched += from.matched;
  into.waits.push(...from.waits);
  into.matchTimes.push(...from.matchTimes);
  into.extraKm += from.extraKm;
  into.vehiclesUsed += from.vehiclesUsed;
  into.vehiclesTotal += from.vehiclesTotal;
  into.seatsUsed += from.seatsUsed;
  into.seatCapacityOfUsed += from.seatCapacityOfUsed;
  into.parcelsUsed += from.parcelsUsed;
  into.parcelCapacityOfUsed += from.parcelCapacityOfUsed;
}

export type ComparisonSimulation = {
  simulated: true;
  version: "matching_comparison_sim_v1";
  params: SimParams;
  aggregate: Record<MethodKey, MethodMetrics>;
  scenarios: Array<{
    key: string;
    label: string;
    origin: SimScenario["origin"];
    requests: number;
    passengerRequests: number;
    parcelOrders: number;
    drivers: number;
    methods: Record<MethodKey, MethodMetrics>;
  }>;
};

export function runScenario(scenario: SimScenario, params: SimParams): Record<MethodKey, RawMetrics> {
  return { manual: runManual(scenario, params), nearest: runNearest(scenario, params), masari: runMasari(scenario, params) };
}

export function runComparisonSimulation(
  overrides: Partial<SimParams> = {},
  scenarios?: SimScenario[]
): ComparisonSimulation {
  const params = { ...DEFAULT_SIM_PARAMS, ...overrides };
  const set = scenarios ?? buildScenarioSet(params.seed);
  const pooled: Record<MethodKey, RawMetrics> = { manual: emptyRaw(), nearest: emptyRaw(), masari: emptyRaw() };
  const rows = set.map((scenario) => {
    const raw = runScenario(scenario, params);
    for (const key of METHOD_KEYS) merge(pooled[key], raw[key]);
    return {
      key: scenario.key,
      label: scenario.label,
      origin: scenario.origin,
      requests: scenario.requests.length,
      passengerRequests: scenario.requests.filter((request) => request.kind === "passenger").length,
      parcelOrders: scenario.requests.filter((request) => request.kind === "parcel").length,
      drivers: scenario.drivers.length,
      methods: { manual: summarise(raw.manual), nearest: summarise(raw.nearest), masari: summarise(raw.masari) }
    };
  });
  return {
    simulated: true,
    version: "matching_comparison_sim_v1",
    params,
    aggregate: { manual: summarise(pooled.manual), nearest: summarise(pooled.nearest), masari: summarise(pooled.masari) },
    scenarios: rows
  };
}
