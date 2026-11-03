import 'package:intl/intl.dart';

/// Display-only route fares.
///
/// Darb does not process payments: a fare is an estimate that the passenger
/// or merchant pays the driver directly. Amounts travel as integer minor units
/// (agorot) so no floating point is involved until the final, locale-aware
/// formatting step.

/// Parcel size classes the tariff is defined for.
const fareParcelSizes = ['S', 'M', 'L'];

/// The prices a driver may choose between for one item (inclusive).
class FareRange {
  const FareRange(this.minMinor, this.maxMinor);

  final int minMinor;
  final int maxMinor;

  bool contains(int minor) => minor >= minMinor && minor <= maxMinor;

  static FareRange? tryParse(Object? json) {
    if (json is! Map) return null;
    final min = _minor(json['min_minor']);
    final max = _minor(json['max_minor']);
    if (min == null || max == null || min > max) return null;
    return FareRange(min, max);
  }
}

/// The current published tariff of a canonical route.
class RouteFares {
  const RouteFares({
    required this.currency,
    this.passengerSeatMinor,
    this.parcelMinor = const {},
    this.seatRange,
    this.parcelRanges = const {},
  });

  final String currency;

  /// Price of one seat, or null when no seat fare is published.
  final int? passengerSeatMinor;

  /// Price per parcel size (`S`, `M`, `L`); absent sizes have no fare.
  final Map<String, int> parcelMinor;

  /// What a driver may charge for a seat instead of the default; null when
  /// the default is fixed.
  final FareRange? seatRange;

  /// The same per parcel size; absent sizes are fixed at their default.
  final Map<String, FareRange> parcelRanges;

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
    // A range only counts around a published default that it holds.
    final ranges = json['driver_price_range'];
    FareRange? range(Object? value, int? price) {
      final parsed = FareRange.tryParse(value);
      return parsed != null && price != null && parsed.contains(price)
          ? parsed
          : null;
    }

    final parcelRanges = <String, FareRange>{};
    final rawParcelRanges = ranges is Map ? ranges['parcel'] : null;
    if (rawParcelRanges is Map) {
      for (final size in fareParcelSizes) {
        final value = range(rawParcelRanges[size], parcels[size]);
        if (value != null) parcelRanges[size] = value;
      }
    }
    final fares = RouteFares(
      currency: currency,
      passengerSeatMinor: seat,
      parcelMinor: Map.unmodifiable(parcels),
      seatRange: ranges is Map ? range(ranges['passenger_seat'], seat) : null,
      parcelRanges: Map.unmodifiable(parcelRanges),
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

/// Parses what a person types ("12", "12.5", "12,50", Arabic-Indic digits)
/// into integer minor units. Never rounds: more than two decimals, zero or a
/// negative amount is null, as is anything that is not a plain amount.
int? parseFareInput(String raw) {
  final latin = StringBuffer();
  for (final rune in raw.trim().runes) {
    if (rune >= 0x0660 && rune <= 0x0669) {
      latin.writeCharCode(0x30 + rune - 0x0660);
    } else if (rune >= 0x06F0 && rune <= 0x06F9) {
      latin.writeCharCode(0x30 + rune - 0x06F0);
    } else if (rune == 0x066B || rune == 0x060C) {
      latin.write('.');
    } else {
      latin.writeCharCode(rune);
    }
  }
  final match = RegExp(
    r'^(\d{1,6})(?:[.,](\d{1,2}))?$',
  ).firstMatch(latin.toString());
  if (match == null) return null;
  final whole = int.parse(match.group(1)!);
  final cents = int.parse((match.group(2) ?? '').padRight(2, '0'));
  final minor = whole * 100 + cents;
  return minor > 0 && minor <= 10000000 ? minor : null;
}

/// Plain Latin text for an amount in an edit field, e.g. 1250 -> "12.50".
String fareInputText(int minor) =>
    '${minor ~/ 100}.${(minor % 100).toString().padLeft(2, '0')}';

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
