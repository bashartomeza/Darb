import { clamp01, haversineKm, LOCKED_ORIGIN, round, toNumber } from "./geo.js";

/** Legacy route scoring, shared by the live matching module and the comparison simulation. */
export function scoreDriverRoute(input: {
  route: {
    origin_label: string;
    destination_label: string;
    origin_lat: unknown;
    origin_lng: unknown;
    seats_available: number;
    parcel_capacity_available: number;
    driver: { trust_score: number };
  };
  passengerRequest?: { pickup_lat: unknown; pickup_lng: unknown; passenger_count: number; preferred_time: Date | string } | null;
  parcelCount: number;
}) {
  const isForwardCorridor =
    input.route.origin_label === "Hebron / PPU / Bab Al-Zawiya" && input.route.destination_label === "Bethlehem";
  const corridorOverlap = isForwardCorridor ? 0.95 : 0.3;
  const pickupPoint = input.passengerRequest
    ? { lat: toNumber(input.passengerRequest.pickup_lat), lng: toNumber(input.passengerRequest.pickup_lng) }
    : LOCKED_ORIGIN;
  const routeOrigin = { lat: toNumber(input.route.origin_lat), lng: toNumber(input.route.origin_lng) };
  const pickupDistanceKm = haversineKm(routeOrigin, pickupPoint);
  const pickupDistanceScore = clamp01(1 - pickupDistanceKm / 25);
  const timingFit = 0.9;
  const trustScore = clamp01(input.route.driver.trust_score / 100);
  const seatFit = input.passengerRequest ? input.route.seats_available / Math.max(1, input.passengerRequest.passenger_count) : 1;
  const parcelFit = input.parcelCount > 0 ? input.route.parcel_capacity_available / input.parcelCount : 1;
  const capacityFit = clamp01(Math.min(seatFit, parcelFit));
  const finalScore = round(
    0.4 * corridorOverlap + 0.25 * pickupDistanceScore + 0.15 * timingFit + 0.1 * trustScore + 0.1 * capacityFit
  );

  return {
    corridorOverlap: round(corridorOverlap),
    pickupDistanceScore: round(pickupDistanceScore),
    timingFit: round(timingFit),
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
