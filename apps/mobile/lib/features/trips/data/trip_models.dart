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
    );
  }
}

class TripLocation {
  const TripLocation({
    required this.lat,
    required this.lng,
    required this.source,
    required this.sequence,
    required this.recordedAt,
  });

  final double lat;
  final double lng;
  final String source;
  final int sequence;
  final DateTime recordedAt;

  factory TripLocation.fromJson(Map<String, dynamic> json) {
    return TripLocation(
      lat: _double(json, 'lat'),
      lng: _double(json, 'lng'),
      source: _string(json, 'source'),
      sequence: _int(json, 'sequence'),
      recordedAt: DateTime.parse(_string(json, 'recorded_at')).toLocal(),
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
