import { describe, expect, it } from "vitest";
import { scoreDriverRoute, timingFit, UNDATED_TIMING_FIT } from "../lib/routeScoring.js";
import { batchTripLengthKm } from "../modules/batching.js";
import { haversineKm } from "../lib/geo.js";

const now = new Date("2026-11-05T08:00:00.000Z");
const minutes = (value: number) => new Date(now.getTime() + value * 60_000);

// A route far away from the old Hebron - Bethlehem corridor (Nablus area).
const route = (overrides: Record<string, unknown> = {}) => ({
  origin_lat: 32.2211,
  origin_lng: 35.2544,
  seats_available: 3,
  parcel_capacity_available: 4,
  driver: { trust_score: 80 },
  ...overrides
});

describe("timingFit", () => {
  it("is 1 at the wanted time and falls to 0 three hours away", () => {
    expect(timingFit(minutes(60), minutes(60), now)).toBe(1);
    expect(timingFit(minutes(150), minutes(60), now)).toBeCloseTo(0.5);
    expect(timingFit(minutes(300), minutes(60), now)).toBe(0);
  });

  it("measures parcel-only demand (no wanted time) from now", () => {
    expect(timingFit(minutes(18), null, now)).toBeCloseTo(0.9);
    expect(timingFit(minutes(120), undefined, now)).toBeCloseTo(1 / 3);
  });

  it("keeps the old neutral value for undated routes", () => {
    expect(timingFit(null, minutes(60), now)).toBe(UNDATED_TIMING_FIT);
  });
});

describe("scoreDriverRoute", () => {
  it("scores parcel-only demand from the order's own pickup, not the old Hebron origin", () => {
    const nearPickup = { lat: 32.222, lng: 35.255 };
    const breakdown = scoreDriverRoute({ route: route(), pickupPoint: nearPickup, parcelCount: 2, sameRoute: true, now });
    expect(breakdown.estimatedDeviationKm).toBeLessThan(1);
    expect(breakdown.pickupDistanceScore).toBeGreaterThan(0.95);
  });

  it("without any pickup point uses the route's own origin", () => {
    const breakdown = scoreDriverRoute({ route: route(), parcelCount: 1, sameRoute: true, now });
    expect(breakdown.estimatedDeviationKm).toBe(0);
  });

  it("ranks the route leaving closer to the passenger's time higher", () => {
    const passengerRequest = { pickup_lat: 32.2211, pickup_lng: 35.2544, passenger_count: 1, preferred_time: minutes(60) };
    const onTime = scoreDriverRoute({ route: route({ departure_at: minutes(65) }), passengerRequest, parcelCount: 0, sameRoute: true, now });
    const late = scoreDriverRoute({ route: route({ departure_at: minutes(200) }), passengerRequest, parcelCount: 0, sameRoute: true, now });
    expect(onTime.timingFit).toBeGreaterThan(late.timingFit);
    expect(onTime.finalScore).toBeGreaterThan(late.finalScore);
  });

  it("only rewards overlap the caller vouches for", () => {
    const same = scoreDriverRoute({ route: route(), parcelCount: 0, sameRoute: true, now });
    const other = scoreDriverRoute({ route: route(), parcelCount: 0, sameRoute: false, now });
    expect(same.corridorOverlap).toBe(0.95);
    expect(other.corridorOverlap).toBe(0.3);
  });
});

describe("batchTripLengthKm", () => {
  const fallback = { pickup: { lat: 32.2211, lng: 35.2544 }, dropoff: { lat: 32.3104, lng: 35.0286 } };
  const stop = (sequence: number, lat: number, lng: number, offset: number | null = null) => ({
    sequence,
    distance_from_origin_meters: offset,
    stop: { latitude: lat, longitude: lng }
  });

  it("uses the route version's measured length first", () => {
    expect(batchTripLengthKm({ estimated_distance_meters: 41_500, stops: [] }, fallback)).toBe(41.5);
  });

  it("then the last stop's offset, then the distance along the ordered stops", () => {
    expect(batchTripLengthKm({ stops: [stop(1, 32.2211, 35.2544, 0), stop(2, 32.3104, 35.0286, 27_000)] }, fallback)).toBe(27);
    const unordered = [stop(3, 32.4, 35.0), stop(1, 32.2, 35.2), stop(2, 32.3, 35.1)];
    const expected =
      haversineKm({ lat: 32.2, lng: 35.2 }, { lat: 32.3, lng: 35.1 }) + haversineKm({ lat: 32.3, lng: 35.1 }, { lat: 32.4, lng: 35.0 });
    expect(batchTripLengthKm({ stops: unordered }, fallback)).toBeCloseTo(expected, 6);
  });

  it("falls back to the order's own pickup-to-dropoff distance for route-less orders", () => {
    expect(batchTripLengthKm(null, fallback)).toBeCloseTo(haversineKm(fallback.pickup, fallback.dropoff), 6);
    expect(batchTripLengthKm({ estimated_distance_meters: null, stops: [stop(1, 32.2, 35.2)] }, fallback)).toBeCloseTo(
      haversineKm(fallback.pickup, fallback.dropoff),
      6
    );
  });
});
