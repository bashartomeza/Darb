/// A bookable trip as the passenger home screen needs to display it.
///
/// This is a *presentation* model, deliberately decoupled from any API shape.
/// The backend has no passenger-facing "available trips" endpoint yet
/// (`/driver/availabilities` is `requireRole("driver")`), so today it is filled
/// either by a demo source or not at all. When that endpoint lands, add an
/// implementation of `TripOfferSource` that maps it to this type — the widgets
/// do not change.
///
/// Every field the current schema cannot supply is nullable, and the card omits
/// the corresponding row rather than rendering a placeholder or a zero. That
/// keeps the UI honest about what is real:
///
/// | Field            | Backing data                                    |
/// |------------------|-------------------------------------------------|
/// | [driverName]     | `User.name`                                     |
/// | [vehicleLabel]   | `DriverProfile.vehicle_type`                    |
/// | [trustScore]     | `DriverProfile.trust_score` (0–100)             |
/// | [departureAt]    | `DriverRoute.departure_at`                      |
/// | [remainingSeats] | `DriverRoute.remaining_seats`                   |
/// | [fareSeatMinor]  | `RouteFare` (display-only estimate, agorot)     |
/// | [priceLabel]     | **none** — superseded by [fareSeatMinor]        |
/// | [completedTrips] | **none** — not tracked                          |
/// | [photoUrl]       | **none** — no avatar column                     |
/// | [ratingOutOfFive]| **none** — only a 0–100 trust score is stored   |
class TripOffer {
  const TripOffer({
    required this.id,
    required this.driverName,
    required this.fromLabel,
    required this.toLabel,
    this.vehicleLabel,
    this.photoUrl,
    this.ratingOutOfFive,
    this.completedTrips,
    this.trustScore,
    this.matchScore,
    this.priceLabel,
    this.fareSeatMinor,
    this.fareCurrency,
    this.departureAt,
    this.remainingSeats,
    this.isSample = false,
  });

  final String id;
  final String driverName;
  final String fromLabel;
  final String toLabel;

  /// e.g. a vehicle type and colour. Omitted when unknown.
  final String? vehicleLabel;

  final String? photoUrl;

  /// 0..5. Distinct from [trustScore] — the schema stores only the latter.
  final double? ratingOutOfFive;

  final int? completedTrips;

  /// 0..100, the value the schema actually stores.
  final int? trustScore;

  /// 0..1. Present only when this offer came from the matching search API.
  final double? matchScore;

  /// Already formatted with its currency by the caller.
  final String? priceLabel;

  /// Estimated price of one seat in minor units; formatted by the card for
  /// the active locale. Display-only: paid directly to the driver.
  final int? fareSeatMinor;
  final String? fareCurrency;

  final DateTime? departureAt;
  final int? remainingSeats;

  /// Marks demo content so the UI can label it rather than pass it off as real.
  final bool isSample;
}
