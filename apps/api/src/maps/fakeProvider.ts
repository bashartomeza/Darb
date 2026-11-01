import {
  geometryChecksum,
  routeInputChecksum,
  RouteProviderError,
  validateRouteInput,
  validateGeocodeResult,
  type GeocodeInput,
  type GeocodeResult,
  type NormalizedRouteResult,
  type RouteCalculationInput,
  type RouteProvider
} from "./contracts.js";

function encodePolyline6(points: readonly { latitude: number; longitude: number }[]) {
  let lastLatitude = 0; let lastLongitude = 0; let encoded = "";
  const encode = (delta: number) => {
    let value = delta < 0 ? ~(delta << 1) : delta << 1; let output = "";
    while (value >= 0x20) { output += String.fromCharCode((0x20 | (value & 0x1f)) + 63); value >>= 5; }
    return output + String.fromCharCode(value + 63);
  };
  for (const point of points) {
    const latitude = Math.round(point.latitude * 1_000_000); const longitude = Math.round(point.longitude * 1_000_000);
    encoded += encode(latitude - lastLatitude) + encode(longitude - lastLongitude); lastLatitude = latitude; lastLongitude = longitude;
  }
  return encoded;
}

export type FakeProviderScenario = "normal" | "timeout" | "rate_limit" | "quota" | "unauthorized" | "unavailable" | "malformed";

const fixtures = [
  { aliases: ["hebron", "الخليل"], label: "Hebron / الخليل", latitude: 31.5326, longitude: 35.0998, category: "locality" },
  { aliases: ["palestine polytechnic university", "ppu", "جامعة بوليتكنك فلسطين"], label: "Palestine Polytechnic University - Dahiat Al-Baladiyah / جامعة بوليتكنك فلسطين - ضاحية البلدية", latitude: 31.5073157, longitude: 35.0908933, category: "university" },
  { aliases: ["bab al-zawiya", "bab al zawiya", "bab al-zawiya square", "باب الزاوية", "ميدان باب الزاوية"], label: "Bab Al-Zawiya Square / ميدان باب الزاوية", latitude: 31.5275134, longitude: 35.1018593, category: "public_square" },
  { aliases: ["bethlehem", "بيت لحم"], label: "Bethlehem / بيت لحم", latitude: 31.7054, longitude: 35.2024, category: "locality" }
] as const;

function fail(scenario: FakeProviderScenario): never | void {
  if (scenario === "normal") return;
  if (scenario === "timeout") throw new RouteProviderError("provider_timeout");
  if (scenario === "rate_limit") throw new RouteProviderError("provider_rate_limited");
  if (scenario === "quota") throw new RouteProviderError("provider_quota_exhausted");
  if (scenario === "unauthorized") throw new RouteProviderError("provider_unauthorized");
  if (scenario === "unavailable") throw new RouteProviderError("provider_unavailable");
  throw new RouteProviderError("malformed_provider_response");
}

export class FakeRouteProvider implements RouteProvider {
  readonly id = "fake" as const;
  constructor(private readonly scenario: FakeProviderScenario = "normal", private readonly now = () => new Date("2026-08-07T00:00:00.000Z")) {}

  async geocodeStop(input: GeocodeInput): Promise<GeocodeResult> {
    fail(this.scenario);
    const query = input.query.trim().normalize("NFC").toLocaleLowerCase("en");
    if (!query || query.length > 200) throw new RouteProviderError("invalid_input");
    const fixture = fixtures.find((item) => item.aliases.some((alias) => query.includes(alias.toLocaleLowerCase("en"))));
    if (!fixture) throw new RouteProviderError("provider_unavailable");
    return validateGeocodeResult({
      displayLabel: fixture.label,
      coordinates: { latitude: fixture.latitude, longitude: fixture.longitude },
      confidence: 1,
      category: fixture.category,
      provenance: { provider: "fake", apiVersion: "fake-v1", providerReferenceId: `fixture:${fixture.category}`, providerReferenceStoragePermitted: true },
      attribution: [{ text: "Darb non-production deterministic fixture", displayRequired: false }]
    }, this.id);
  }

  async calculateRoute(input: RouteCalculationInput): Promise<NormalizedRouteResult> {
    fail(this.scenario);
    validateRouteInput(input);
    const inputChecksum = routeInputChecksum(input, this.id);
    const encodedGeometry = encodePolyline6(input.orderedStops.map((stop) => stop.coordinates));
    const distanceMeters = 21_530 + (input.orderedStops.length - 2) * 137;
    const durationSeconds = 2_580 + (input.orderedStops.length - 2) * 31;
    const checksum = geometryChecksum({
      routeVersionId: input.routeVersionId,
      orderedStopInputChecksum: inputChecksum,
      provider: this.id,
      profile: input.profile,
      apiVersion: "fake-v1",
      geometryEncoding: "polyline6",
      geometryPrecision: 6,
      encodedGeometry,
      distanceMeters,
      durationSeconds
    });
    return {
      encodedGeometry,
      geometryEncoding: "polyline6",
      geometryPrecision: 6,
      distanceMeters,
      durationSeconds,
      calculatedAt: this.now().toISOString(),
      provenance: { provider: "fake", apiVersion: "fake-v1", profile: input.profile, providerReferenceStoragePermitted: true },
      attribution: [{ text: "Darb non-production deterministic fixture", displayRequired: false }],
      inputChecksum,
      geometryChecksum: checksum
    };
  }
}
