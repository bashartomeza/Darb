import '../../operating_routes/data/city_place_models.dart';
import '../../../core/fares/fare.dart';

class MatchResult {
  const MatchResult({
    required this.id,
    required this.status,
    required this.score,
    required this.explanation,
    required this.driverName,
    required this.routeLabel,
    required this.seatsAvailable,
    required this.breakdown,
    required this.passengerRequestId,
    this.routeNameAr,
    this.routeNameEn,
    this.pickupDetails,
    this.dropoffDetails,
    this.pickupPlaceAr,
    this.pickupPlaceEn,
    this.dropoffPlaceAr,
    this.dropoffPlaceEn,
    this.fare,
    this.passengerCount,
  });

  final String id;
  final String status;
  final double score;
  final String explanation;
  final String driverName;
  final String routeLabel;
  final int seatsAvailable;
  final ScoringBreakdown breakdown;
  final String? passengerRequestId;

  /// The predefined route and the exact places the passenger typed, when the
  /// request was booked on a route (null for older requests).
  final String? routeNameAr;
  final String? routeNameEn;
  final String? pickupDetails;
  final String? dropoffDetails;

  /// The village or town picked from the route's city list for each end
  /// (names as saved when ordering); null for orders typed as free text.
  final String? pickupPlaceAr;
  final String? pickupPlaceEn;
  final String? dropoffPlaceAr;
  final String? dropoffPlaceEn;

  /// The pickup as one line: the chosen place and the optional details, or
  /// only the details of an older order; null when neither was saved.
  String? pickupSummary({required bool arabic}) => placeWithDetails(
    arabic: arabic,
    nameAr: pickupPlaceAr,
    nameEn: pickupPlaceEn,
    details: pickupDetails,
  );

  /// The drop-off as one line, like [pickupSummary].
  String? dropoffSummary({required bool arabic}) => placeWithDetails(
    arabic: arabic,
    nameAr: dropoffPlaceAr,
    nameEn: dropoffPlaceEn,
    details: dropoffDetails,
  );

  /// The request's saved fare: this driver's price (their own inside the
  /// route's range, else the route default). Null when the route has none.
  final FareSnapshot? fare;
  final int? passengerCount;

  /// The route's name in the reading language, falling back to the driver
  /// route's "origin -> destination" label.
  String routeName({required bool arabic}) {
    final ar = routeNameAr;
    final en = routeNameEn;
    if (arabic && ar != null) return ar;
    return en ?? ar ?? routeLabel;
  }

  factory MatchResult.fromJson(
    Map<String, dynamic> json,
    Map<String, dynamic> scoring,
  ) {
    final route = json['driver_route'] as Map<String, dynamic>;
    final driver = route['driver'] as Map<String, dynamic>?;
    final request = json['passenger_request'];
    final passengerRequest = request is Map<String, dynamic>
        ? request
        : const <String, dynamic>{};
    String? named(String key) =>
        _optionalString(passengerRequest, key) ?? _optionalString(route, key);
    return MatchResult(
      id: _string(json, 'id'),
      status: _string(json, 'status'),
      score: _double(json, 'score'),
      explanation: _string(json, 'explanation'),
      driverName: driver?['name'] as String? ?? 'Driver route',
      routeLabel:
          '${_string(route, 'origin_label')} -> ${_string(route, 'destination_label')}',
      seatsAvailable: _intOrZero(route['seats_available']),
      breakdown: ScoringBreakdown.fromJson(scoring),
      passengerRequestId: _nestedIdOrNull(json['passenger_request']),
      routeNameAr: named('route_name_ar'),
      routeNameEn: named('route_name_en'),
      pickupDetails: _optionalString(passengerRequest, 'pickup_details'),
      dropoffDetails: _optionalString(passengerRequest, 'dropoff_details'),
      pickupPlaceAr: _optionalString(passengerRequest, 'pickup_place_name_ar'),
      pickupPlaceEn: _optionalString(passengerRequest, 'pickup_place_name_en'),
      dropoffPlaceAr: _optionalString(
        passengerRequest,
        'dropoff_place_name_ar',
      ),
      dropoffPlaceEn: _optionalString(
        passengerRequest,
        'dropoff_place_name_en',
      ),
      fare: FareSnapshot.tryParse(passengerRequest['fare']),
      passengerCount: passengerRequest['passenger_count'] is int
          ? passengerRequest['passenger_count'] as int
          : null,
    );
  }
}

class ScoringBreakdown {
  const ScoringBreakdown({
    required this.corridorOverlap,
    required this.pickupDistanceScore,
    required this.timingFit,
    required this.trustScore,
    required this.capacityFit,
    required this.finalScore,
  });

  final double corridorOverlap;
  final double pickupDistanceScore;
  final double timingFit;
  final double trustScore;
  final double capacityFit;
  final double finalScore;

  factory ScoringBreakdown.fromJson(Map<String, dynamic> json) {
    return ScoringBreakdown(
      corridorOverlap: _double(json, 'corridorOverlap'),
      pickupDistanceScore: _double(json, 'pickupDistanceScore'),
      timingFit: _double(json, 'timingFit'),
      trustScore: _double(json, 'trustScore'),
      capacityFit: _double(json, 'capacityFit'),
      finalScore: _double(json, 'finalScore'),
    );
  }
}

String _string(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is String) return value;
  throw FormatException('Missing $key');
}

double _double(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is num) return value.toDouble();
  if (value is String) return double.parse(value);
  throw FormatException('Missing $key');
}

String? _optionalString(Map<String, dynamic> json, String key) {
  final value = json[key];
  return value is String && value.trim().isNotEmpty ? value.trim() : null;
}

String? _nestedIdOrNull(Object? value) {
  if (value is Map<String, dynamic> && value['id'] is String) {
    return value['id'] as String;
  }
  return null;
}

int _intOrZero(Object? value) =>
    value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? 0;
