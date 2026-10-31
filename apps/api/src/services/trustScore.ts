/**
 * Driver trust score: a pure function of a driver's recent history.
 * The formula and its rationale are documented in docs/driver-trust-score.md.
 */

export const TRUST_PRIOR = 0.7; // a driver with no history scores 70
export const TRUST_PRIOR_WEIGHT = 5; // the prior counts as this many observations
export const TRUST_GRACE_MINUTES = 10; // lateness tolerated before a trip counts as late
export const TRUST_EXPERIENCE_TARGET = 50; // completed trips for full experience credit
export const TRUST_RATINGS_PER_PASSENGER_CAP = 3; // ratings from one passenger that can count
export const TRUST_TRIP_WINDOW = 500; // most recent finished trips considered

export const TRUST_WEIGHTS = {
  experience: 10,
  cancellation: 25,
  departure: 20,
  arrival: 15,
  rating: 30
} as const;

export type TrustComponentKey = keyof typeof TRUST_WEIGHTS;

export type TrustTripInput = {
  status: "completed" | "cancelled" | "failed";
  /** True only when the driver themself cancelled (admin/passenger cancels do not count). */
  cancelledByDriver: boolean;
  /** Scheduled departure of the driver route, when known. */
  scheduledDepartureAt: Date | null;
  startedAt: Date | null;
  /** End of the driver's availability window, used as the arrival deadline when known. */
  arrivalDeadlineAt: Date | null;
  completedAt: Date | null;
};

/** Ratings given to this driver by one passenger. */
export type TrustPassengerRatings = { count: number; averageStars: number };

export type TrustInput = {
  trips: readonly TrustTripInput[];
  ratings: readonly TrustPassengerRatings[];
};

export type TrustComponent = {
  /** 0..1 after damping toward the prior. */
  value: number;
  /** Observations behind the value (before the prior). */
  sample: number;
  weight: number;
};

export type TrustResult = {
  score: number;
  components: Record<TrustComponentKey, TrustComponent>;
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) return TRUST_PRIOR;
  return Math.min(1, Math.max(0, value));
}

/** (successes + prior*k) / (observations + k): few observations stay near the prior. */
function dampedRate(successes: number, observations: number) {
  return clamp01((successes + TRUST_PRIOR * TRUST_PRIOR_WEIGHT) / (observations + TRUST_PRIOR_WEIGHT));
}

function component(key: TrustComponentKey, value: number, sample: number): TrustComponent {
  return { value: clamp01(value), sample, weight: TRUST_WEIGHTS[key] };
}

export function computeTrustScore(input: TrustInput): TrustResult {
  const graceMs = TRUST_GRACE_MINUTES * 60_000;
  const trips = input.trips.slice(0, TRUST_TRIP_WINDOW);
  const completed = trips.filter((trip) => trip.status === "completed");
  const driverCancelled = trips.filter((trip) => trip.status === "cancelled" && trip.cancelledByDriver);
  const failed = trips.filter((trip) => trip.status === "failed");

  // Cancellations: driver-side cancellations and failures against completions.
  const accountable = completed.length + driverCancelled.length + failed.length;
  const cancellation = dampedRate(completed.length, accountable);

  const departureMeasured = trips.filter((trip) => trip.scheduledDepartureAt && trip.startedAt);
  const departureOnTime = departureMeasured.filter(
    (trip) => trip.startedAt!.getTime() <= trip.scheduledDepartureAt!.getTime() + graceMs
  ).length;

  const arrivalMeasured = completed.filter((trip) => trip.arrivalDeadlineAt && trip.completedAt);
  const arrivalOnTime = arrivalMeasured.filter(
    (trip) => trip.completedAt!.getTime() <= trip.arrivalDeadlineAt!.getTime() + graceMs
  ).length;

  // Ratings: each passenger counts at most CAP times, so one passenger (or a
  // friendly account) rating over and over cannot move the score on their own.
  let ratingCount = 0;
  let ratingStarsSum = 0;
  for (const passenger of input.ratings) {
    if (!(passenger.count > 0) || !Number.isFinite(passenger.averageStars)) continue;
    const stars = Math.min(5, Math.max(1, passenger.averageStars));
    const counted = Math.min(Math.floor(passenger.count), TRUST_RATINGS_PER_PASSENGER_CAP);
    ratingCount += counted;
    ratingStarsSum += counted * ((stars - 1) / 4);
  }

  const components: Record<TrustComponentKey, TrustComponent> = {
    experience: component(
      "experience",
      TRUST_PRIOR + (1 - TRUST_PRIOR) * Math.min(1, completed.length / TRUST_EXPERIENCE_TARGET),
      completed.length
    ),
    cancellation: component("cancellation", cancellation, accountable),
    departure: component("departure", dampedRate(departureOnTime, departureMeasured.length), departureMeasured.length),
    arrival: component("arrival", dampedRate(arrivalOnTime, arrivalMeasured.length), arrivalMeasured.length),
    rating: component("rating", dampedRate(ratingStarsSum, ratingCount), ratingCount)
  };

  const totalWeight = Object.values(TRUST_WEIGHTS).reduce((a, b) => a + b, 0);
  const weighted = (Object.keys(components) as TrustComponentKey[]).reduce(
    (sum, key) => sum + components[key].value * components[key].weight,
    0
  );
  const score = Math.min(100, Math.max(0, Math.round((weighted / totalWeight) * 100)));
  return { score, components };
}
