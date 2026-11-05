import { clamp01, haversineKm, round, toNumber, type Point } from "./geo.js";

/** Minutes between the wanted time and the route's departure at which the timing fit reaches zero. */
export const TIMING_FIT_WINDOW_MINUTES = 180;
/** Timing fit for supply with no departure time (undated legacy routes): neutral, as before. */
export const UNDATED_TIMING_FIT = 0.9;

/**
 * How well the route's departure suits the demand: 1 when it leaves at the wanted time, falling
 * linearly to 0 at TIMING_FIT_WINDOW_MINUTES away. Parcel-only demand has no wanted time and wants the
 * earliest pickup, so "now" stands in for it. Undated routes keep the old neutral value.
 */
export function timingFit(departureAt: Date | string | null | undefined, wantedAt: Date | string | null | undefined, now = new Date()) {
  if (!departureAt) return UNDATED_TIMING_FIT;
  const departure = new Date(departureAt).getTime();
  const wanted = wantedAt ? new Date(wantedAt).getTime() : now.getTime();
  if (!Number.isFinite(departure) || !Number.isFinite(wanted)) return UNDATED_TIMING_FIT;
  return clamp01(1 - Math.abs(departure - wanted) / (TIMING_FIT_WINDOW_MINUTES * 60_000));
}

/** Legacy route scoring, shared by the live matching module and the comparison simulation. */
export function scoreDriverRoute(input: {
  route: {
    origin_lat: unknown;
    origin_lng: unknown;
    seats_available: number;
    parcel_capacity_available: number;
    departure_at?: Date | string | null;
    driver: { trust_score: number };
  };
  passengerRequest?: { pickup_lat: unknown; pickup_lng: unknown; passenger_count: number; preferred_time: Date | string } | null;
  /**
   * Where parcel-only demand is picked up (the order's own pickup point). Without it, and without a
   * passenger request, the route's own origin is used, so the pickup distance is not penalised.
   */
  pickupPoint?: Point | null;
  parcelCount: number;
  /**
   * Whether the driver route runs on the demand's own service route. Live matching only ranks
   * driver routes already on that route and passes `true`; the comparison simulation, which mixes
   * directions, decides it per simulated driver.
   */
  sameRoute: boolean;
  now?: Date;
}) {
  const corridorOverlap = input.sameRoute ? 0.95 : 0.3;
  const routeOrigin = { lat: toNumber(input.route.origin_lat), lng: toNumber(input.route.origin_lng) };
  const pickupPoint = input.passengerRequest
    ? { lat: toNumber(input.passengerRequest.pickup_lat), lng: toNumber(input.passengerRequest.pickup_lng) }
    : input.pickupPoint ?? routeOrigin;
  const pickupDistanceKm = haversineKm(routeOrigin, pickupPoint);
  const pickupDistanceScore = clamp01(1 - pickupDistanceKm / 25);
  const timing = timingFit(input.route.departure_at, input.passengerRequest?.preferred_time, input.now);
  const trustScore = clamp01(input.route.driver.trust_score / 100);
  const seatFit = input.passengerRequest ? input.route.seats_available / Math.max(1, input.passengerRequest.passenger_count) : 1;
  const parcelFit = input.parcelCount > 0 ? input.route.parcel_capacity_available / input.parcelCount : 1;
  const capacityFit = clamp01(Math.min(seatFit, parcelFit));
  const finalScore = round(
    0.4 * corridorOverlap + 0.25 * pickupDistanceScore + 0.15 * timing + 0.1 * trustScore + 0.1 * capacityFit
  );

  return {
    corridorOverlap: round(corridorOverlap),
    pickupDistanceScore: round(pickupDistanceScore),
    timingFit: round(timing),
    trustScore: round(trustScore),
    capacityFit: round(capacityFit),
    finalScore,
    estimatedDeviationKm: round(pickupDistanceKm, 2)
  };
}

/**
 * Candidate ordering used by the live legacy matcher: highest score, then the
 * smaller deviation, then the higher trust score, then the route id.
 */
export function compareRankedRoutes(
  a: { breakdown: { finalScore: number; estimatedDeviationKm: number }; route: { id: string; driver: { trust_score: number } } },
  b: { breakdown: { finalScore: number; estimatedDeviationKm: number }; route: { id: string; driver: { trust_score: number } } }
) {
  if (b.breakdown.finalScore !== a.breakdown.finalScore) return b.breakdown.finalScore - a.breakdown.finalScore;
  if (a.breakdown.estimatedDeviationKm !== b.breakdown.estimatedDeviationKm) {
    return a.breakdown.estimatedDeviationKm - b.breakdown.estimatedDeviationKm;
  }
  if (b.route.driver.trust_score !== a.route.driver.trust_score) {
    return b.route.driver.trust_score - a.route.driver.trust_score;
  }
  return a.route.id.localeCompare(b.route.id);
}
