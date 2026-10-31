import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scoreDriverRoute } from "../lib/routeScoring.js";
import {
  BATCH_RULES,
  batchParcelOrders,
  buildScenarioSet,
  corridorPoint,
  DEFAULT_SIM_PARAMS,
  percentile,
  runComparisonSimulation,
  runScenario,
  summarise,
  type SimDriver,
  type SimRequest,
  type SimScenario
} from "../services/matchingComparison.js";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() }
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");

const params = DEFAULT_SIM_PARAMS;

function driver(id: string, overrides: Partial<SimDriver> = {}): SimDriver {
  return {
    id, direction: "forward", origin: corridorPoint(0), destination: corridorPoint(1),
    departAt: 30, seats: 4, parcelCapacity: 5, trustScore: 80, ...overrides
  };
}

function passengerRequest(id: string, at = 0, overrides: Partial<SimRequest> = {}): SimRequest {
  return { id, kind: "passenger", requestedAt: at, pickup: corridorPoint(0.1, 0.2), dropoff: corridorPoint(0.9), passengers: 1, parcels: 0, ...overrides };
}

function parcelRequest(id: string, at: number, parcels: number, merchantId = "m1"): SimRequest {
  return { id, kind: "parcel", merchantId, requestedAt: at, pickup: corridorPoint(0.03, 0.1), dropoff: corridorPoint(1), passengers: 0, parcels };
}

function scenario(drivers: SimDriver[], requests: SimRequest[]): SimScenario {
  return { key: "t", label: "t", origin: "hand_written", drivers, requests };
}

describe("matching comparison simulation", () => {
  it("is deterministic for a fixed seed and changes with another seed", () => {
    const a = runComparisonSimulation({ seed: 7 });
    const b = runComparisonSimulation({ seed: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = runComparisonSimulation({ seed: 8 });
    expect(JSON.stringify(c.scenarios.filter((s) => s.origin === "generated"))).not.toBe(
      JSON.stringify(a.scenarios.filter((s) => s.origin === "generated"))
    );
    // Hand-written scenarios do not depend on the seed for the deterministic methods.
    expect(c.scenarios[0]!.methods.masari).toEqual(a.scenarios[0]!.methods.masari);
  });

  it("keeps the default-seed headline metrics stable", () => {
    const result = runComparisonSimulation();
    expect(result.simulated).toBe(true);
    expect(result.scenarios.map((s) => s.key)).toEqual([
      "morning_commute_rush", "merchant_parcel_wave", "sparse_evening", "wrong_direction_trap",
      "generated_small", "generated_medium", "generated_busy"
    ]);
    expect(result.aggregate.masari.requests).toBe(result.aggregate.nearest.requests);
    expect(result.aggregate.masari.requests).toBe(result.aggregate.manual.requests);
    const snapshot = Object.fromEntries(
      (["manual", "nearest", "masari"] as const).map((key) => {
        const m = result.aggregate[key];
        return [key, { matched: m.matched, wait: m.waitingMin, match: m.matchingMin, km: m.routeDeviationKm, unmatchedPct: m.unmatchedPct }];
      })
    );
    expect(snapshot).toMatchInlineSnapshot(`
      {
        "manual": {
          "km": 130.79,
          "match": {
            "avg": 22.65,
            "median": 20.7,
            "p90": 42.41,
          },
          "matched": 38,
          "unmatchedPct": 74.8,
          "wait": {
            "avg": 56.03,
            "median": 47.47,
            "p90": 100.32,
          },
        },
        "masari": {
          "km": 271.24,
          "match": {
            "avg": 2,
            "median": 1.5,
            "p90": 4.07,
          },
          "matched": 128,
          "unmatchedPct": 15.2,
          "wait": {
            "avg": 42.77,
            "median": 37.28,
            "p90": 83.44,
          },
        },
        "nearest": {
          "km": 270.66,
          "match": {
            "avg": 0.5,
            "median": 0.5,
            "p90": 0.5,
          },
          "matched": 129,
          "unmatchedPct": 14.6,
          "wait": {
            "avg": 41.1,
            "median": 36.3,
            "p90": 75.94,
          },
        },
      }
    `);
  });

  it("never exceeds driver capacity or reports negative times, for every method", () => {
    for (const set of buildScenarioSet(params.seed)) {
      const raw = runScenario(set, params);
      for (const key of ["manual", "nearest", "masari"] as const) {
        expect(raw[key].matched).toBeLessThanOrEqual(set.requests.length);
        expect(raw[key].seatsUsed).toBeLessThanOrEqual(raw[key].seatCapacityOfUsed);
        expect(raw[key].parcelsUsed).toBeLessThanOrEqual(raw[key].parcelCapacityOfUsed);
        expect(raw[key].waits.every((w) => w >= 0)).toBe(true);
        expect(raw[key].matchTimes.every((w) => w >= 0)).toBe(true);
      }
    }
  });

  it("Masari picks the driver the real scoring function ranks first", () => {
    const near = driver("a-near-wrong", { direction: "reverse", origin: corridorPoint(0.1, 0.2), destination: corridorPoint(0) });
    const onRoute = driver("b-route", { origin: corridorPoint(0, 1.5) });
    const req = passengerRequest("r1");
    const scoreOf = (d: SimDriver) =>
      scoreDriverRoute({
        route: {
          origin_label: d.direction === "forward" ? "Hebron / PPU / Bab Al-Zawiya" : "Bethlehem",
          destination_label: d.direction === "forward" ? "Bethlehem" : "Hebron / PPU / Bab Al-Zawiya",
          origin_lat: d.origin.lat, origin_lng: d.origin.lng, seats_available: d.seats,
          parcel_capacity_available: d.parcelCapacity, driver: { trust_score: d.trustScore }
        },
        passengerRequest: { pickup_lat: req.pickup.lat, pickup_lng: req.pickup.lng, passenger_count: 1, preferred_time: new Date(0) },
        parcelCount: 0
      }).finalScore;
    expect(scoreOf(onRoute)).toBeGreaterThan(scoreOf(near));
    const raw = runScenario(scenario([near, onRoute], [req]), params);
    // Nearest takes the closer wrong-direction driver (large detour); Masari takes the route-aligned one.
    expect(raw.nearest.extraKm).toBeGreaterThan(raw.masari.extraKm);
    expect(raw.masari.vehiclesUsed).toBe(1);
  });

  it("Masari follows real filters: no split of an oversized batch, no departed drivers", () => {
    const small = driver("small", { parcelCapacity: 3 });
    const orders = [parcelRequest("o1", 0, 2), parcelRequest("o2", 1, 2)];
    const raw = runScenario(scenario([small], orders), params);
    // One batch of 4 parcels does not fit a 3-parcel driver; the real matcher would not split it.
    expect(raw.masari.matched).toBe(0);
    // The baselines match order by order.
    expect(raw.nearest.matched).toBe(1);

    const gone = driver("gone", { departAt: 0.2 });
    expect(runScenario(scenario([gone], [passengerRequest("r1")]), params).masari.matched).toBe(0);
  });

  it("batches parcel orders with the real batching limits", () => {
    const many = Array.from({ length: 25 }, (_, i) => parcelRequest(`o${i}`, i * 0.1, 1));
    const units = batchParcelOrders(many, 60);
    expect(units[0]!.members.length).toBe(BATCH_RULES.maxOrders);
    expect(units.reduce((sum, unit) => sum + unit.members.length, 0)).toBe(25);
    const otherMerchant = [parcelRequest("a", 0, 1, "m1"), parcelRequest("b", 0, 1, "m2")];
    expect(batchParcelOrders(otherMerchant, 60)).toHaveLength(2);
    const late = [parcelRequest("a", 0, 1), parcelRequest("b", 100, 1)];
    expect(batchParcelOrders(late, 6)).toHaveLength(2);
  });

  it("manual dispatch is slower to match because of the configurable reply delay", () => {
    const set = buildScenarioSet(params.seed);
    const fast = runComparisonSimulation({ manualResponseDelayMin: 1 }, set);
    const slow = runComparisonSimulation({ manualResponseDelayMin: 8 }, set);
    expect(slow.aggregate.manual.matchingMin.avg).toBeGreaterThan(fast.aggregate.manual.matchingMin.avg);
    expect(slow.aggregate.masari).toEqual(fast.aggregate.masari);
    expect(fast.aggregate.manual.matchingMin.avg).toBeGreaterThan(fast.aggregate.nearest.matchingMin.avg);
  });

  it("computes percentiles and empty summaries safely", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([5], 90)).toBe(5);
    expect(percentile([], 50)).toBe(0);
    const empty = summarise({ total: 0, matched: 0, waits: [], matchTimes: [], extraKm: 0, vehiclesUsed: 0, vehiclesTotal: 0, seatsUsed: 0, seatCapacityOfUsed: 0, parcelsUsed: 0, parcelCapacityOfUsed: 0 });
    expect(empty.unmatchedPct).toBe(0);
    expect(empty.waitingMin).toEqual({ avg: 0, median: 0, p90: 0 });
  });
});

describe("GET /api/v1/compare/simulation", () => {
  const secret = "test-only-jwt-secret-with-at-least-thirty-two-characters";
  const users: Record<string, { id: string; role: string }> = {
    admin_1: { id: "admin_1", role: "admin" },
    merchant_1: { id: "merchant_1", role: "merchant" }
  };
  const auth = (id: string) => ({
    Authorization: `Bearer ${jwt.sign({ role: users[id]!.role, sid: `session_${id}`, ver: 1 }, secret, { subject: id, expiresIn: "1h" })}`
  });

  beforeEach(() => {
    vi.clearAllMocks();
    const full = (u: { id: string; role: string }) => ({ ...u, name: u.id, phone: "+1", demo_account: true, account_status: "active", security_version: 1 });
    prismaMock.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => (where.id && users[where.id] ? full(users[where.id]!) : null));
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const user = users[where.id.replace(/^session_/, "")];
      return user
        ? { id: where.id, user_id: user.id, user: { email_verified_at: new Date(), ...full(user) }, security_version_at_issue: 1, expires_at: new Date(Date.now() + 60_000), revoked_at: null }
        : null;
    });
    prismaMock.authSession.update.mockResolvedValue({});
  });

  it("is admin only", async () => {
    await request(createApp()).get("/api/v1/compare/simulation").expect(401);
    await request(createApp()).get("/api/v1/compare/simulation").set(auth("merchant_1")).expect(403);
  });

  it("returns the simulated result and validates the query", async () => {
    const response = await request(createApp()).get("/api/v1/compare/simulation?seed=5").set(auth("admin_1")).expect(200);
    expect(response.body.simulation.simulated).toBe(true);
    expect(response.body.simulation.params.seed).toBe(5);
    expect(response.body.simulation.aggregate.masari.requests).toBeGreaterThan(0);
    await request(createApp()).get("/api/v1/compare/simulation?seed=-1").set(auth("admin_1")).expect(400);
    await request(createApp()).get("/api/v1/compare/simulation?bogus=1").set(auth("admin_1")).expect(400);
  });
});
