import { describe, expect, it } from "vitest";
import {
  checkpointsAlongRoute,
  distanceMeters,
  distanceToPolyline,
  offsetFromSegment,
  prepareCheckpoints,
  selectCandidate,
  worstStatus
} from "../services/checkpointRouting.js";
import { A, B, FRESH, NOW, at, candidate, line, northRoad, primary, southRoad, thresholds } from "./checkpointRoutingFixtures.js";

describe("polyline geometry", () => {
  it("measures the distance from a point to a polyline in meters", () => {
    // 0.0009 degrees of latitude is about 100 m.
    const result = distanceToPolyline({ lat: 31.5009, lng: 35.2 }, line(A, B));
    expect(result.meters).toBeGreaterThan(95);
    expect(result.meters).toBeLessThan(105);
  });

  it("measures to the segment, not to the nearest vertex", () => {
    const sparse = [A, B]; // one 19 km segment: the nearest vertex is 9 km away
    expect(distanceToPolyline({ lat: 31.5009, lng: 35.2 }, sparse).meters).toBeLessThan(105);
  });

  it("agrees with the great-circle distance for a single point", () => {
    const d = distanceToPolyline({ lat: 31.51, lng: 35.1 }, [A]);
    expect(d.meters).toBeCloseTo(distanceMeters({ lat: 31.51, lng: 35.1 }, A), 3);
  });

  it("returns infinity for an empty line", () => {
    expect(distanceToPolyline(A, []).meters).toBe(Number.POSITIVE_INFINITY);
  });

  it("offsets to the left of the direction of travel", () => {
    const via = offsetFromSegment(line(A, B), 10, { lat: 31.5, lng: 35.12 }, 1_500);
    expect(via.lat).toBeGreaterThan(31.5); // heading east: left is north
    expect(distanceMeters(via, { lat: 31.5, lng: 35.12 })).toBeGreaterThan(1_450);
    expect(distanceMeters(via, { lat: 31.5, lng: 35.12 })).toBeLessThan(1_550);
    expect(offsetFromSegment(line(A, B), 10, { lat: 31.5, lng: 35.12 }, -1_500).lat).toBeLessThan(31.5);
  });
});

describe("prepareCheckpoints", () => {
  it("keeps statuses while the feed is fresh", () => {
    const { checkpoints, statusTrusted } = prepareCheckpoints({ checkpoints: [at(35.2, 31.5, { status: "closed" })], fetched_at: FRESH }, thresholds, NOW);
    expect(statusTrusted).toBe(true);
    expect(checkpoints[0]).toMatchObject({ status: "closed", reported_status: "closed" });
  });

  it("treats a feed older than the TTL as unknown, never as closed or open", () => {
    const old = "2026-11-05T11:50:00Z"; // 10 minutes, TTL is 5
    const { checkpoints, statusTrusted } = prepareCheckpoints(
      { checkpoints: [at(35.2, 31.5, { status: "closed" }), at(35.21, 31.5, { status: "open" })], fetched_at: old },
      thresholds,
      NOW
    );
    expect(statusTrusted).toBe(false);
    expect(checkpoints.map((c) => c.status)).toEqual(["unknown", "unknown"]);
    expect(checkpoints[0]!.reported_status).toBe("closed");
  });

  it("treats a feed flagged stale, or with an unreadable time, as unknown", () => {
    const row = at(35.2, 31.5, { status: "closed" });
    expect(prepareCheckpoints({ checkpoints: [row], fetched_at: FRESH, stale: true }, thresholds, NOW).checkpoints[0]!.status).toBe("unknown");
    expect(prepareCheckpoints({ checkpoints: [row], fetched_at: "not a date" }, thresholds, NOW).checkpoints[0]!.status).toBe("unknown");
  });

  it("drops rows without a usable position", () => {
    const { checkpoints } = prepareCheckpoints(
      {
        checkpoints: [at(35.2), at(Number.NaN), at(0, 0), at(200), { ...at(35.2), latitude: Number.POSITIVE_INFINITY }],
        fetched_at: FRESH
      },
      thresholds,
      NOW
    );
    expect(checkpoints).toHaveLength(1);
  });
});

describe("checkpointsAlongRoute", () => {
  const prep = (rows: ReturnType<typeof at>[]) => prepareCheckpoints({ checkpoints: rows, fetched_at: FRESH }, thresholds, NOW).checkpoints;

  it("finds checkpoints within the threshold and ignores farther ones", () => {
    const near = at(35.15, 31.5009); // ~100 m
    const far = at(35.2, 31.5018); // ~200 m
    const hits = checkpointsAlongRoute(primary.line, prep([near, far]), thresholds);
    expect(hits.map((h) => h.checkpoint.id)).toEqual([near.id]);
    expect(hits[0]!.distance_meters).toBeLessThan(150);
  });

  it("orders hits along the route", () => {
    const late = at(35.25);
    const early = at(35.12);
    const hits = checkpointsAlongRoute(primary.line, prep([late, early]), thresholds);
    expect(hits.map((h) => h.checkpoint.id)).toEqual([early.id, late.id]);
    expect(hits[0]!.progress).toBeLessThan(hits[1]!.progress);
  });

  it("uses the wider radius for an approximate position", () => {
    const exact = at(35.2, 31.5036); // ~400 m north of the line
    const approximate = { ...exact, id: "approx", position_approximate: true };
    const hits = checkpointsAlongRoute(primary.line, prep([exact, approximate]), thresholds);
    expect(hits.map((h) => h.checkpoint.id)).toEqual(["approx"]);
  });
});

describe("selectCandidate", () => {
  it("keeps the fastest route when nothing is closed or congested", () => {
    const fast = candidate(primary, [at(35.2)]);
    const slow = candidate(northRoad, [at(35.2)], "osrm_alternative");
    const selection = selectCandidate([fast, slow], thresholds);
    expect(selection.chosen).toBe(fast);
    expect(selection.status).toBe("clear");
    expect(selection.warnings).toEqual([]);
  });

  it("reroutes around a closed checkpoint and says which one was avoided", () => {
    const closed = at(35.2, 31.5, { status: "closed" });
    const fast = candidate(primary, [closed]);
    const detour = candidate(northRoad, [closed], "osrm_alternative");
    const selection = selectCandidate([fast, detour], thresholds);
    expect(selection.chosen).toBe(detour);
    expect(selection.status).toBe("rerouted_closed");
    expect(selection.avoided.map((c) => c.id)).toEqual([closed.id]);
  });

  it("reroutes however long the detour is, because a closed checkpoint cannot be passed", () => {
    const closed = at(35.2, 31.5, { status: "closed" });
    const fast = candidate(primary, [closed]);
    const long = candidate({ ...northRoad, duration_seconds: 9_000, distance_meters: 90_000 }, [closed], "osrm_alternative");
    expect(selectCandidate([fast, long], thresholds).chosen).toBe(long);
  });

  it("reports blocked, with a warning, when every route passes a closed checkpoint", () => {
    const closed = at(35.2, 31.5, { status: "closed" });
    const closedToo = at(35.2, 31.56, { status: "closed", name_ar: "ثاني" });
    const a = candidate(primary, [closed]);
    const b = candidate(northRoad, [closedToo], "osrm_alternative");
    const selection = selectCandidate([a, b], thresholds);
    expect(selection.status).toBe("blocked");
    expect(selection.warnings).toContain("all_routes_closed");
    expect(selection.chosen).toBe(a); // equal closures: the faster one
  });

  it("prefers the route with fewer closed checkpoints when all are blocked", () => {
    const one = at(35.2, 31.5, { status: "closed" });
    const two = at(35.12, 31.5, { status: "closed" });
    const a = candidate(primary, [one, two]);
    const b = candidate(southRoad, [{ ...one, latitude: 31.44 }], "osrm_alternative");
    expect(selectCandidate([a, b], thresholds).chosen).toBe(b);
  });

  it("avoids congestion when the alternative costs little extra", () => {
    const busy = at(35.2, 31.5, { status: "congested" });
    const fast = candidate(primary, [busy]);
    const calm = candidate({ ...northRoad, duration_seconds: 1_700, distance_meters: 21_000 }, [busy], "osrm_alternative");
    const selection = selectCandidate([fast, calm], thresholds);
    expect(selection.chosen).toBe(calm);
    expect(selection.status).toBe("rerouted_congestion");
  });

  it("keeps the congested route, with a warning, when the alternative costs too much time", () => {
    const busy = at(35.2, 31.5, { status: "congested" });
    const fast = candidate(primary, [busy]);
    const calm = candidate({ ...northRoad, duration_seconds: 2_500 }, [busy], "osrm_alternative"); // +1000 s
    const selection = selectCandidate([fast, calm], thresholds);
    expect(selection.chosen).toBe(fast);
    expect(selection.status).toBe("congestion_warning");
    expect(selection.warnings).toContain("congestion_unavoidable");
  });

  it("keeps the congested route when the alternative costs too much distance", () => {
    const busy = at(35.2, 31.5, { status: "congested" });
    const fast = candidate(primary, [busy]);
    const calm = candidate({ ...northRoad, duration_seconds: 1_600, distance_meters: 30_000 }, [busy], "osrm_alternative"); // +11 km
    expect(selectCandidate([fast, calm], thresholds).status).toBe("congestion_warning");
  });

  it("honours a configured extra-time limit", () => {
    const busy = at(35.2, 31.5, { status: "congested" });
    const fast = candidate(primary, [busy]);
    const calm = candidate({ ...northRoad, duration_seconds: 2_500, distance_meters: 21_000 }, [busy], "osrm_alternative");
    expect(selectCandidate([fast, calm], { ...thresholds, congestionMaxExtraSeconds: 1_200 }).chosen).toBe(calm);
  });

  it("never reroutes for an unknown status", () => {
    const unknown = at(35.2, 31.5, { status: "unknown" });
    const fast = candidate(primary, [unknown]);
    const slow = candidate(northRoad, [unknown], "osrm_alternative");
    const selection = selectCandidate([fast, slow], thresholds);
    expect(selection.chosen).toBe(fast);
    expect(selection.status).toBe("clear");
  });

  it("flags an approximate position that is not known to be open", () => {
    const fuzzy = at(35.2, 31.5, { status: "congested", position_approximate: true });
    const fast = candidate(primary, [fuzzy]);
    expect(selectCandidate([fast], thresholds).warnings).toContain("position_approximate");
  });

  it("treats a closed checkpoint at the edge of the threshold as on the route", () => {
    const edge = at(35.2, 31.5013, { status: "closed" }); // ~145 m
    expect(candidate(primary, [edge]).hits).toHaveLength(1);
    const beyond = at(35.2, 31.5015, { status: "closed" }); // ~167 m
    expect(candidate(primary, [beyond]).hits).toHaveLength(0);
  });
});

describe("worstStatus", () => {
  it("lets the worst leg decide", () => {
    expect(worstStatus(["clear", "rerouted_closed", "blocked"])).toBe("blocked");
    expect(worstStatus(["clear", "clear"])).toBe("clear");
    expect(worstStatus([])).toBe("unchecked");
  });
});
