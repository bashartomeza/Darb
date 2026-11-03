import '../../../core/fares/fare.dart';

/// Fare items as the API names them: a seat, then each parcel size.
const driverPriceSeatItem = 'passenger_seat';
String driverPriceParcelItem(String size) => 'parcel_${size.toLowerCase()}';
final driverPriceItems = [
  driverPriceSeatItem,
  for (final size in fareParcelSizes) driverPriceParcelItem(size),
];

/// The prices a driver sets for one route when going online, in integer
/// minor units per fare item. An item left out charges the route's default;
/// the server checks each one against the admin's range.
class DriverPrices {
  const DriverPrices([this.minorByItem = const {}]);

  static const none = DriverPrices();

  final Map<String, int> minorByItem;

  bool get isEmpty => minorByItem.isEmpty;

  int? operator [](String item) => minorByItem[item];

  /// The `prices` body field, or null when every price is the default.
  Map<String, int>? toJson() =>
      isEmpty ? null : Map.unmodifiable(Map.of(minorByItem));

  /// Reads a saved payload's `prices` back; anything unreadable is left out.
  static DriverPrices fromJson(Object? json) {
    if (json is! Map) return none;
    final prices = <String, int>{};
    for (final item in driverPriceItems) {
      final value = json[item];
      if (value is int && value > 0) prices[item] = value;
    }
    return DriverPrices(Map.unmodifiable(prices));
  }

  /// The driver route's own prices as `GET /driver/routes` returns them
  /// (`{passenger_seat_minor, parcel_minor: {S, M, L}}`; null items are the
  /// route's defaults).
  static DriverPrices fromRouteJson(Object? json) {
    if (json is! Map) return none;
    final prices = <String, int>{};
    final seat = json['passenger_seat_minor'];
    if (seat is int && seat > 0) prices[driverPriceSeatItem] = seat;
    final parcels = json['parcel_minor'];
    if (parcels is Map) {
      for (final size in fareParcelSizes) {
        final value = parcels[size];
        if (value is int && value > 0) {
          prices[driverPriceParcelItem(size)] = value;
        }
      }
    }
    return DriverPrices(Map.unmodifiable(prices));
  }
}

/// What a driver picked in the route picker: the route and their prices.
class DriverRouteChoice {
  const DriverRouteChoice(
    this.serviceRouteId, [
    this.prices = DriverPrices.none,
  ]);

  final String serviceRouteId;
  final DriverPrices prices;
}
