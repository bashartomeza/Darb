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
