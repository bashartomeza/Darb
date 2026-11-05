import { describe, expect, it, vi } from "vitest";
import type { CheckpointFeed } from "../services/checkpointRouting.js";
import { DEFAULT_PLANNER_CONFIG, OsrmEngine, RoutePlanner, parseOsrm, type RoutingEngine } from "../services/routePlanner.js";
import { A, B, FRESH, NOW, at, fakeEngine, northRoad, primary, southRoad } from "./checkpointRoutingFixtures.js";

const feedOf = (rows: ReturnType<typeof at>[], extra: Partial<CheckpointFeed> = {}) => async (): Promise<CheckpointFeed> => ({
  checkpoints: rows,
  fetched_at: FRESH,
  ...extra
});
const planner = (engine: RoutingEngine, feed: () => Promise<CheckpointFeed>, config = DEFAULT_PLANNER_CONFIG) =>
  new RoutePlanner(engine, feed, config, () => NOW);

describe("RoutePlanner", () => {
  it("returns the engine's fastest route when no checkpoint is in the way", async () => {
    const plan = await planner(fakeEngine([northRoad]), feedOf([at(35.2, 31.7)])).plan([A, B]);
    expect(plan.status).toBe("clear");
    expect(plan.distance_meters).toBe(19_000);
    expect(plan.extra_duration_seconds).toBe(0);
    expect(plan.checkpoints_on_route).toEqual([]);
    expect(plan.evaluated.engine_calls).toBe(1);
  });

  it("lists checkpoints on the route with their status, without changing the route", async () => {
    const open = at(35.15, 31.5, { status: "open" });
    const unknown = at(35.25, 31.5, { status: "unknown" });
    const plan = await planner(fakeEngine([northRoad]), feedOf([open, unknown])).plan([A, B]);
    expect(plan.status).toBe("clear");
    expect(plan.checkpoints_on_route.map((c) => [c.id, c.status])).toEqual([
      [open.id, "open"],
      [unknown.id, "unknown"]
    ]);
  });

  it("chooses an engine alternative that avoids a closed checkpoint", async () => {
    const closed = at(35.2, 31.5, { status: "closed" });
    const plan = await planner(fakeEngine([northRoad]), feedOf([closed])).plan([A, B]);
    expect(plan.status).toBe("rerouted_closed");
    expect(plan.distance_meters).toBe(24_000);
    expect(plan.extra_distance_meters).toBe(5_000);
    expect(plan.extra_duration_seconds).toBe(400);
    expect(plan.avoided_checkpoints.map((c) => c.id)).toEqual([closed.id]);
    expect(plan.checkpoints_on_route).toEqual([]);
    expect(plan.evaluated.detour_candidates).toBe(0);
  });

  it("falls back to a via-point detour when the engine offers no clean alternative", async () => {
    const closed = at(35.2, 31.5, { status: "closed" });
    const engine = fakeEngine([]);
    const plan = await planner(engine, feedOf([closed])).plan([A, B]);
    expect(plan.status).toBe("rerouted_closed");
    expect(plan.evaluated.detour_candidates).toBeGreaterThan(0);
    // Every detour request has the via point between the endpoints and no alternatives.
    const detours = engine.calls.filter((c) => c.coordinates.length === 3);
    expect(detours.length).toBeGreaterThan(0);
    expect(detours.every((c) => !c.alternatives)).toBe(true);
    expect(plan.coordinates[0]).toEqual([A.lng, A.lat]);
  });

  it("says so plainly when no clean route exists", async () => {
    // Closed on the straight road and on both bulging roads.
    const rows = [
      at(35.2, 31.5, { status: "closed" }),
      at(35.2, 31.56, { status: "closed" }),
      at(35.2, 31.44, { status: "closed" })
    ];
    const plan = await planner(fakeEngine([northRoad]), feedOf(rows)).plan([A, B]);
    expect(plan.status).toBe("blocked");
    expect(plan.warnings).toContain("all_routes_closed");
    expect(plan.checkpoints_on_route.some((c) => c.status === "closed")).toBe(true);
  });

  it("uses a detour for congestion when it is cheap, and keeps the route with a warning when it is not", async () => {
    const busy = at(35.2, 31.5, { status: "congested" });
    const plan = await planner(fakeEngine([{ ...northRoad, duration_seconds: 4_000 }]), feedOf([busy])).plan([A, B]);
    // The engine alternative is too slow; detour attempts (north/south roads) cost +400 s / +450 s
    // which is within the 600 s limit, so a calm detour is accepted instead of the warning.
    expect(plan.status).toBe("rerouted_congestion");
    expect(plan.distance_meters).toBe(24_000);
    const strict = await planner(fakeEngine([]), feedOf([busy]), { ...DEFAULT_PLANNER_CONFIG, congestionMaxExtraSeconds: 100 }).plan([A, B]);
    expect(strict.status).toBe("congestion_warning");
    expect(strict.warnings).toContain("congestion_unavoidable");
    expect(strict.distance_meters).toBe(19_000);
  });

  it("treats stale statuses as unknown: no reroute, with a warning", async () => {
    const closed = at(35.2, 31.5, { status: "closed" });
    const plan = await planner(fakeEngine([northRoad]), feedOf([closed], { fetched_at: "2026-11-05T11:00:00Z" })).plan([A, B]);
    expect(plan.status).toBe("clear");
    expect(plan.distance_meters).toBe(19_000);
    expect(plan.warnings).toContain("status_stale");
    expect(plan.checkpoints_on_route[0]).toMatchObject({ status: "unknown", reported_status: "closed" });
    expect(plan.checkpoint_data.status_trusted).toBe(false);
  });

  it("still returns the road when checkpoint data cannot be read, marked unchecked", async () => {
    const plan = await planner(fakeEngine([northRoad]), async () => {
      throw new Error("down");
    }).plan([A, B]);
    expect(plan.status).toBe("unchecked");
    expect(plan.warnings).toContain("checkpoint_data_unavailable");
    expect(plan.checkpoint_data.available).toBe(false);
  });

  it("fails with 502 when the routing engine is down", async () => {
    const down: RoutingEngine = {
      route: async () => {
        throw new Error("engine_status_503");
      }
    };
    await expect(planner(down, feedOf([])).plan([A, B])).rejects.toMatchObject({ statusCode: 502, message: "route_provider_unavailable" });
  });

  it("survives a failed detour attempt", async () => {
    const closed = at(35.2, 31.5, { status: "closed" });
    const engine: RoutingEngine = {
      async route(coordinates) {
        if (coordinates.length === 2) return [primary];
        const via = coordinates[1]!;
        if (via.lat < A.lat) throw new Error("engine_no_route");
        return [northRoad];
      }
    };
    const plan = await planner(engine, feedOf([closed])).plan([A, B]);
    expect(plan.status).toBe("rerouted_closed");
  });

  it("plans each leg of a multi-stop trip and joins them", async () => {
    const mid = { lat: 31.5, lng: 35.2 };
    const closed = at(35.15, 31.5, { status: "closed" });
    const engine: RoutingEngine = {
      async route(coordinates) {
        const [from, to] = coordinates as [typeof A, typeof B];
        const straight = {
          line: [from, to],
          distance_meters: 9_500,
          duration_seconds: 750
        };
        return from.lng === A.lng ? [straight, { line: [from, { lat: 31.56, lng: 35.15 }, to], distance_meters: 12_000, duration_seconds: 950 }] : [straight];
      }
    };
    const plan = await planner(engine, feedOf([closed])).plan([A, mid, B]);
    expect(plan.status).toBe("rerouted_closed");
    expect(plan.distance_meters).toBe(12_000 + 9_500);
    // The join point appears once.
    const joins = plan.coordinates.filter(([lng, lat]) => lng === mid.lng && lat === mid.lat);
    expect(joins).toHaveLength(1);
  });

  it("rejects too few or too many waypoints", async () => {
    const p = planner(fakeEngine(), feedOf([]));
    await expect(p.plan([A])).rejects.toMatchObject({ statusCode: 400 });
    await expect(p.plan(Array.from({ length: 7 }, () => A))).rejects.toMatchObject({ statusCode: 400 });
  });

  it("answers a repeat request from its cache until statuses change", async () => {
    const engine = fakeEngine([northRoad]);
    let status: "open" | "closed" = "open";
    const feed = async (): Promise<CheckpointFeed> => ({ checkpoints: [at(35.2, 31.5, { status })], fetched_at: FRESH });
    const p = planner(engine, feed);
    const first = await p.plan([A, B]);
    await p.plan([A, B]);
    expect(engine.calls).toHaveLength(1);
    status = "closed";
    const flipped = await p.plan([A, B]);
    expect(first.status).toBe("clear");
    expect(flipped.status).toBe("rerouted_closed");
    // The engine answer was reused: a status flip does not cost another engine call.
    expect(engine.calls).toHaveLength(1);
  });

  it("shares one computation between simultaneous identical requests", async () => {
    const route = vi.fn(async () => [primary]);
    const p = planner({ route }, feedOf([]));
    await Promise.all([p.plan([A, B]), p.plan([A, B]), p.plan([A, B])]);
    expect(route).toHaveBeenCalledTimes(1);
  });

  it("never exceeds the engine call budget", async () => {
    const rows = [at(35.2, 31.5, { status: "closed" }), at(35.2, 31.56, { status: "closed" }), at(35.2, 31.44, { status: "closed" }), at(35.12, 31.5, { status: "closed" })];
    const engine = fakeEngine([]);
    await planner(engine, feedOf(rows), { ...DEFAULT_PLANNER_CONFIG, maxEngineCalls: 4 }).plan([A, B]);
    expect(engine.calls.length).toBeLessThanOrEqual(4);
    void southRoad;
  });
});

describe("OSRM transport", () => {
  const body = (routes: unknown[]) => JSON.stringify({ code: "Ok", routes });
  const geo = (pairs: number[][]) => ({ geometry: { coordinates: pairs }, distance: 100, duration: 10 });

  it("asks for alternatives only on two-point requests and parses lon/lat", async () => {
    const transport = vi.fn(async () => new Response(body([geo([[35.1, 31.5], [35.2, 31.5]]), geo([[35.1, 31.5], [35.15, 31.55], [35.2, 31.5]])])));
    const engine = new OsrmEngine("https://osrm.example", 1_000, transport as unknown as typeof fetch);
    const routes = await engine.route([A, B], { alternatives: true });
    expect(routes).toHaveLength(2);
    expect(routes[0]!.line[0]).toEqual({ lat: 31.5, lng: 35.1 });
    const url = String((transport.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("/route/v1/driving/35.100000,31.500000;35.300000,31.500000");
    expect(url).toContain("alternatives=3");
    await engine.route([A, A, B], { alternatives: true });
    expect(String((transport.mock.calls[1] as unknown[])[0])).toContain("alternatives=false");
  });

  it("rejects non-200 answers and malformed bodies", async () => {
    const make = (response: Response) => new OsrmEngine("https://osrm.example", 1_000, (async () => response) as unknown as typeof fetch);
    await expect(make(new Response("no", { status: 429 })).route([A, B], { alternatives: false })).rejects.toThrow("engine_status_429");
    await expect(make(new Response("{not json")).route([A, B], { alternatives: false })).rejects.toThrow();
    expect(() => parseOsrm({ code: "NoRoute", routes: [] })).toThrow("engine_no_route");
    expect(() => parseOsrm({ code: "Ok", routes: [{ geometry: { coordinates: [[1, "x"], [2, 3]] }, distance: 1, duration: 1 }] })).toThrow("engine_malformed");
    expect(() => parseOsrm({ code: "Ok", routes: [{ geometry: { coordinates: [[1, 2], [2, 3]] }, distance: -1, duration: 1 }] })).toThrow("engine_malformed");
  });
});
