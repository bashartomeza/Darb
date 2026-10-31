import 'package:intl/intl.dart';

/// Display-only route fares.
///
/// Masari does not process payments: a fare is an estimate that the passenger
/// or merchant pays the driver directly. Amounts travel as integer minor units
/// (agorot) so no floating point is involved until the final, locale-aware
/// formatting step.

/// Parcel size classes the tariff is defined for.
const fareParcelSizes = ['S', 'M', 'L'];

/// The current published tariff of a canonical route.
class RouteFares {
  const RouteFares({
    required this.currency,
    this.passengerSeatMinor,
    this.parcelMinor = const {},
  });

  final String currency;

  /// Price of one seat, or null when no seat fare is published.
  final int? passengerSeatMinor;

  /// Price per parcel size (`S`, `M`, `L`); absent sizes have no fare.
  final Map<String, int> parcelMinor;

  bool get isEmpty => passengerSeatMinor == null && parcelMinor.isEmpty;

  int? parcelFor(String size) => parcelMinor[size];

  /// Seats are priced per passenger; the total is an exact integer product.
  int? seatTotal(int passengers) {
    final unit = passengerSeatMinor;
    if (unit == null || passengers < 1) return null;
    return unit * passengers;
  }

  /// The sum for these parcel sizes, or null unless every size is priced.
  int? parcelTotal(Iterable<String> sizes) {
    var total = 0;
    var any = false;
    for (final size in sizes) {
      final price = parcelMinor[size];
      if (price == null) return null;
      total += price;
      any = true;
    }
    return any ? total : null;
  }

  /// Returns null for a missing/empty tariff or an unparsable one: a fare that
  /// cannot be read must disappear, never render as a wrong number.
  static RouteFares? tryParse(Object? json) {
    if (json is! Map) return null;
    final currency = json['currency'];
    if (currency is! String || currency.isEmpty) return null;
    final seat = _minor(json['passenger_seat_minor']);
    final parcels = <String, int>{};
    final raw = json['parcel_minor'];
    if (raw is Map) {
      for (final size in fareParcelSizes) {
        final value = _minor(raw[size]);
        if (value != null) parcels[size] = value;
      }
    }
    final fares = RouteFares(
      currency: currency,
      passengerSeatMinor: seat,
      parcelMinor: Map.unmodifiable(parcels),
    );
    return fares.isEmpty ? null : fares;
  }
}

/// The fare frozen on a request or parcel when it was created.
///
/// Later tariff edits never change this value; it is what the person was
/// shown when they asked.
class FareSnapshot {
  const FareSnapshot({
    required this.currency,
    required this.totalMinor,
    this.unitMinor,
  });

  final String currency;
  final int totalMinor;
  final int? unitMinor;

  static FareSnapshot? tryParse(Object? json) {
    if (json is! Map) return null;
    final currency = json['currency'];
    final total = _minor(json['total_minor']);
    if (currency is! String || currency.isEmpty || total == null) return null;
    return FareSnapshot(
      currency: currency,
      totalMinor: total,
      unitMinor: _minor(json['unit_minor']),
    );
  }
}

int? _minor(Object? value) {
  if (value is int && value > 0) return value;
  return null;
}

/// Formats minor units for [languageCode] ("ar" or "en"), e.g. 1250 becomes
/// `₪12.50` in English and Arabic-Indic digits in Arabic. Only ILS is shown
/// with its symbol; any other code is shown as its ISO code.
String formatFare(int minor, String currency, String languageCode) {
  final symbol = currency == 'ILS' ? '₪' : currency;
  final format = NumberFormat.currency(
    locale: languageCode == 'ar' ? 'ar' : 'en',
    symbol: symbol,
    decimalDigits: 2,
  );
  // Integer arithmetic until the very end: whole + hundredths is exact for the
  // API's maximum of 10,000,000 minor units.
  return format.format(minor ~/ 100 + (minor % 100) / 100);
}
