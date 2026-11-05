import '../../../core/cancellation/cancellation.dart';

class PassengerTrip {
  const PassengerTrip({
    required this.id,
    required this.status,
    required this.createdAt,
    required this.routeLabel,
    this.passengerRequestId,
    this.originLabel,
    this.destinationLabel,
    this.originLat,
    this.originLng,
    this.destinationLat,
    this.destinationLng,
    this.routeNameAr,
    this.routeNameEn,
    this.pickupDetails,
    this.dropoffDetails,
    this.driverPhone,
    this.cancellation,
  });

  final String id;
  final String status;
  final DateTime createdAt;
  final String routeLabel;
  final String? passengerRequestId;

  // API endpoint labels are opaque user data, not a route-string grammar.
  final String? originLabel;
  final String? destinationLabel;

  String get originDisplayLabel => originLabel ?? _legacyRouteLabels.$1;
  String get destinationDisplayLabel =>
      destinationLabel ?? _legacyRouteLabels.$2;

  (String, String) get _legacyRouteLabels {
    final route = routeLabel.trim();
    final arrows = RegExp(r"→|->").allMatches(route).toList();
    // Arrows take precedence over spaced hyphens inside endpoint names.
    // Ambiguous legacy strings remain whole rather than losing name content.
    final delimiters = arrows.isNotEmpty
        ? arrows
        : RegExp(r"\s+-(?=\s)").allMatches(route).toList();
    if (delimiters.length != 1) return (route, route);
    final delimiter = delimiters.single;
    return (
      route.substring(0, delimiter.start).trim(),
      route.substring(delimiter.end).trim(),
    );
  }

  final double? originLat;
  final double? originLng;
  final double? destinationLat;
  final double? destinationLng;

  /// The predefined route and the exact places the passenger typed, read
  /// from the trip's passenger request. Null for trips of older requests.
  final String? routeNameAr;
  final String? routeNameEn;
  final String? pickupDetails;
  final String? dropoffDetails;

  /// The driver's phone, sent only from the driver's acceptance until drop-off.
  /// Null whenever the server leaves it out: the call action hides with it.
  final String? driverPhone;

  /// Who cancelled the trip and why; null while it is not cancelled.
  final CancellationInfo? cancellation;

  /// Before pickup the passenger can still cancel (the driver is told).
  bool get passengerCanCancel =>
      passengerRequestId != null &&
      (status == 'accepted' || status == 'pickup_started');

  /// The route's name in the reading language, or null for older trips.
  String? routeName({required bool arabic}) {
    final ar = routeNameAr;
    final en = routeNameEn;
    if (arabic && ar != null) return ar;
    return en ?? ar;
  }

  bool get hasRouteCoordinates =>
      originLat != null &&
      originLng != null &&
      destinationLat != null &&
      destinationLng != null;

  factory PassengerTrip.fromJson(Map<String, dynamic> json) {
    final route = json['driver_route'] as Map<String, dynamic>?;

    final originLabel = route == null
        ? null
        : route['origin_label'] as String? ?? '';
    final destinationLabel = route == null
        ? null
        : route['destination_label'] as String? ?? '';
    final routeLabel = route == null ? '' : '$originLabel -> $destinationLabel';
    final rawRequest = json['passenger_request'];
    final request = rawRequest is Map<String, dynamic>
        ? rawRequest
        : const <String, dynamic>{};
    String? named(String key) =>
        _optionalString(request, key) ??
        (route == null ? null : _optionalString(route, key));

    return PassengerTrip(
      id: _string(json, 'id'),
      status: _string(json, 'status'),
      createdAt: DateTime.parse(_string(json, 'created_at')).toLocal(),
      routeLabel: routeLabel,
      originLabel: originLabel,
      destinationLabel: destinationLabel,
      passengerRequestId: json['passenger_request_id'] as String?,
      originLat: route == null ? null : _nullableDouble(route['origin_lat']),
      originLng: route == null ? null : _nullableDouble(route['origin_lng']),
      destinationLat: route == null
          ? null
          : _nullableDouble(route['destination_lat']),
      destinationLng: route == null
          ? null
          : _nullableDouble(route['destination_lng']),
      routeNameAr: named('route_name_ar'),
      routeNameEn: named('route_name_en'),
      pickupDetails: _optionalString(request, 'pickup_details'),
      dropoffDetails: _optionalString(request, 'dropoff_details'),
      driverPhone: tripDriverPhone(json),
      cancellation: CancellationInfo.tryParse(json['cancellation']),
    );
  }
}

/// The driver's phone in a trip detail (`driver_route.driver.phone`), or null
/// when the server did not send one.
String? tripDriverPhone(Map<String, dynamic> trip) {
  final route = trip['driver_route'];
  if (route is! Map<String, dynamic>) return null;
  final driver = route['driver'];
  if (driver is! Map<String, dynamic>) return null;
  return _optionalString(driver, 'phone');
}

class TripLocation {
  const TripLocation({
    required this.lat,
    required this.lng,
    required this.source,
    required this.sequence,
    required this.recordedAt,
    this.ageSeconds,
    this.receivedAt,
  });

  /// A point older than this is the driver's last known position, not a live
  /// one. Matches the server's `stale_after_seconds`.
  static const staleAfter = Duration(minutes: 2);

  final double lat;
  final double lng;
  final String source;
  final int sequence;
  final DateTime recordedAt;

  /// The point's age by the server clock when it was read, if the server sent
  /// it. Preferred over [recordedAt] so a phone with a wrong clock still
  /// tells a fresh point from an old one.
  final int? ageSeconds;

  /// When this device received [ageSeconds].
  final DateTime? receivedAt;

  /// How old the point is at [now], by the server's age when it sent one.
  Duration ageAt(DateTime now) {
    final age = ageSeconds;
    final received = receivedAt;
    if (age != null && received != null) {
      return Duration(seconds: age) + now.difference(received);
    }
    return now.difference(recordedAt);
  }

  bool isStaleAt(DateTime now) => ageAt(now) > staleAfter;

  factory TripLocation.fromJson(Map<String, dynamic> json) {
    final age = json['age_seconds'];
    return TripLocation(
      lat: _double(json, 'lat'),
      lng: _double(json, 'lng'),
      source: _string(json, 'source'),
      sequence: _int(json, 'sequence'),
      recordedAt: DateTime.parse(_string(json, 'recorded_at')).toLocal(),
      ageSeconds: age is num ? age.toInt() : null,
      receivedAt: age is num ? DateTime.now() : null,
    );
  }
}

String _string(Map<String, dynamic> json, String key) {
  final value = json[key];

  if (value is String) {
    return value;
  }

  throw FormatException('Missing $key');
}

double _double(Map<String, dynamic> json, String key) {
  final value = json[key];

  if (value is num) {
    return value.toDouble();
  }

  if (value is String) {
    return double.parse(value);
  }

  throw FormatException('Missing $key');
}

String? _optionalString(Map<String, dynamic> json, String key) {
  final value = json[key];
  return value is String && value.trim().isNotEmpty ? value.trim() : null;
}

double? _nullableDouble(dynamic value) {
  if (value == null) {
    return null;
  }

  if (value is num) {
    return value.toDouble();
  }

  if (value is String) {
    return double.tryParse(value);
  }

  return null;
}

int _int(Map<String, dynamic> json, String key) {
  final value = json[key];

  if (value is int) {
    return value;
  }

  if (value is num) {
    return value.toInt();
  }

  throw FormatException('Missing $key');
}

/// The endpoint orders by stored sequence; timestamp breaks equal-sequence ties.
/// Demo reset alone may restart simulated sequences. A null authoritative read
/// clears an absent location, including the gap immediately following reset.
TripLocation? latestTripLocation(
  TripLocation? current,
  TripLocation? incoming,
) {
  if (current == null || incoming == null) return incoming;
  if (incoming.sequence > current.sequence) return incoming;
  if (incoming.sequence == current.sequence) {
    return incoming.recordedAt.isBefore(current.recordedAt)
        ? current
        : incoming;
  }
  if (current.source == 'simulated' &&
      incoming.source == 'simulated' &&
      incoming.recordedAt.isAfter(current.recordedAt)) {
    return incoming;
  }
  return current;
}
