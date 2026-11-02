import { describe, expect, it } from "vitest";
import {
  computeTrustScore,
  TRUST_RATINGS_PER_PASSENGER_CAP,
  TRUST_WEIGHTS,
  type TrustTripInput
} from "../services/trustScore.js";

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 8, 0) + minutes * 60_000);

function completedTrip(overrides: Partial<TrustTripInput> = {}): TrustTripInput {
  return {
    status: "completed",
    cancelledByDriver: false,
    scheduledDepartureAt: at(0),
    startedAt: at(2),
    arrivalDeadlineAt: at(120),
    completedAt: at(90),
    ...overrides
  };
}

const many = (count: number, make: () => TrustTripInput) => Array.from({ length: count }, make);

describe("computeTrustScore", () => {
  it("weights add up to 100", () => {
    expect(Object.values(TRUST_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("gives a driver with no history the neutral score of 70", () => {
    const result = computeTrustScore({ trips: [], ratings: [] });
    expect(result.score).toBe(70);
    for (const component of Object.values(result.components)) {
      expect(component.sample).toBe(0);
      expect(component.value).toBeCloseTo(0.7);
    }
  });

  it("moves a new driver only a little after one good trip", () => {
    const result = computeTrustScore({ trips: [completedTrip()], ratings: [{ count: 1, averageStars: 5 }] });
    expect(result.score).toBeGreaterThan(70);
    expect(result.score).toBeLessThan(80);
  });

  it("approaches the top for a long, punctual, well-rated record", () => {
    const result = computeTrustScore({
      trips: many(100, () => completedTrip()),
      ratings: Array.from({ length: 40 }, () => ({ count: 2, averageStars: 5 }))
    });
    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("scores a driver whose every trip was cancelled by them well below neutral", () => {
    const result = computeTrustScore({
      trips: many(20, () => ({ status: "cancelled", cancelledByDriver: true, scheduledDepartureAt: null, startedAt: null, arrivalDeadlineAt: null, completedAt: null })),
      ratings: []
    });
    expect(result.components.cancellation.value).toBeLessThan(0.2);
    expect(result.score).toBeLessThan(60);
  });

  it("does not hold passenger or admin cancellations against the driver", () => {
    const result = computeTrustScore({
      trips: many(10, () => ({ status: "cancelled", cancelledByDriver: false, scheduledDepartureAt: null, startedAt: null, arrivalDeadlineAt: null, completedAt: null })),
      ratings: []
    });
    expect(result.components.cancellation.sample).toBe(0);
    expect(result.score).toBe(70);
  });

  it("counts failed trips as the driver's non-completions", () => {
    const failed = computeTrustScore({
      trips: many(10, () => ({ ...completedTrip(), status: "failed" as const })),
      ratings: []
    });
    expect(failed.components.cancellation.sample).toBe(10);
    expect(failed.components.cancellation.value).toBeLessThan(0.5);
  });

  it("penalises late departures and late arrivals", () => {
    const onTime = computeTrustScore({ trips: many(20, () => completedTrip()), ratings: [] });
    const late = computeTrustScore({
      trips: many(20, () => completedTrip({ startedAt: at(45), completedAt: at(200) })),
      ratings: []
    });
    expect(late.components.departure.value).toBeLessThan(onTime.components.departure.value);
    expect(late.components.arrival.value).toBeLessThan(onTime.components.arrival.value);
    expect(late.score).toBeLessThan(onTime.score);
  });

  it("allows a grace period and ignores trips with no schedule data", () => {
    const graceful = computeTrustScore({ trips: [completedTrip({ startedAt: at(10) })], ratings: [] });
    const strict = computeTrustScore({ trips: [completedTrip({ startedAt: at(11) })], ratings: [] });
    expect(graceful.components.departure.value).toBeGreaterThan(strict.components.departure.value);

    const unscheduled = computeTrustScore({
      trips: [completedTrip({ scheduledDepartureAt: null, arrivalDeadlineAt: null })],
      ratings: []
    });
    expect(unscheduled.components.departure.sample).toBe(0);
    expect(unscheduled.components.arrival.sample).toBe(0);
  });

  it("lets low ratings pull the score down", () => {
    const base = { trips: many(30, () => completedTrip()) };
    const good = computeTrustScore({ ...base, ratings: Array.from({ length: 20 }, () => ({ count: 1, averageStars: 5 })) });
    const bad = computeTrustScore({ ...base, ratings: Array.from({ length: 20 }, () => ({ count: 1, averageStars: 1 })) });
    expect(bad.score).toBeLessThan(good.score - 15);
  });

  describe("rating spam", () => {
    it("caps how much one passenger can contribute", () => {
      const result = computeTrustScore({ trips: [], ratings: [{ count: 500, averageStars: 5 }] });
      expect(result.components.rating.sample).toBe(TRUST_RATINGS_PER_PASSENGER_CAP);
    });

    it("cannot be lifted to the top by a single account rating five stars repeatedly", () => {
      const spam = computeTrustScore({ trips: [], ratings: [{ count: 10_000, averageStars: 5 }] });
      expect(spam.score).toBeLessThan(80);
    });

    it("cannot be sunk by a single account rating one star repeatedly", () => {
      const spam = computeTrustScore({
        trips: many(30, () => completedTrip()),
        ratings: [{ count: 10_000, averageStars: 1 }, ...Array.from({ length: 10 }, () => ({ count: 1, averageStars: 5 }))]
      });
      const clean = computeTrustScore({
        trips: many(30, () => completedTrip()),
        ratings: Array.from({ length: 10 }, () => ({ count: 1, averageStars: 5 }))
      });
      expect(clean.score - spam.score).toBeLessThanOrEqual(8);
    });

    it("ignores malformed rating aggregates", () => {
      const result = computeTrustScore({
        trips: [],
        ratings: [
          { count: 0, averageStars: 5 },
          { count: -3, averageStars: 5 },
          { count: 2, averageStars: Number.NaN }
        ]
      });
      expect(result.components.rating.sample).toBe(0);
      expect(result.score).toBe(70);
    });
  });

  it("always returns an integer between 0 and 100", () => {
    const worst = computeTrustScore({
      trips: many(300, () => ({ status: "cancelled", cancelledByDriver: true, scheduledDepartureAt: null, startedAt: null, arrivalDeadlineAt: null, completedAt: null })),
      ratings: Array.from({ length: 100 }, () => ({ count: 3, averageStars: 1 }))
    });
    expect(Number.isInteger(worst.score)).toBe(true);
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThan(40);
  });
});
