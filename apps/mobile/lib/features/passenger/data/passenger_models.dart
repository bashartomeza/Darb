import '../../../core/fares/fare.dart';

class PassengerRequest {
  const PassengerRequest({
    required this.id,
    required this.pickupLabel,
    required this.pickupLat,
    required this.pickupLng,
    required this.destinationLabel,
    required this.destinationLat,
    required this.destinationLng,
    required this.preferredTime,
    required this.passengerCount,
    required this.status,
    required this.createdAt,
    this.selectedDriverRouteId,
  });

  final String id;

  final String pickupLabel;
  final double pickupLat;
  final double pickupLng;

  final String destinationLabel;
  final double destinationLat;
  final double destinationLng;

  final DateTime preferredTime;
  final int passengerCount;
  final String status;
  final DateTime createdAt;

  /// The driver route the passenger picked when booking, saved on the request
  /// by the server. Null when matching may choose the best compatible route.
  final String? selectedDriverRouteId;

  bool get canCancel =>
      status == 'pending' || status == 'matched' || status == 'accepted';

  bool get canMatch => status == 'pending';

  factory PassengerRequest.fromJson(Map<String, dynamic> json) {
    return PassengerRequest(
      id: _string(json, 'id'),

      pickupLabel: _string(json, 'pickup_label'),
      pickupLat: _double(json, 'pickup_lat'),
      pickupLng: _double(json, 'pickup_lng'),

      destinationLabel: _string(json, 'destination_label'),
      destinationLat: _double(json, 'destination_lat'),
      destinationLng: _double(json, 'destination_lng'),

      preferredTime: DateTime.parse(_string(json, 'preferred_time')).toLocal(),

      passengerCount: _int(json, 'passenger_count'),

      status: _string(json, 'status'),

      createdAt: DateTime.parse(_string(json, 'created_at')).toLocal(),

      selectedDriverRouteId: switch (json['selected_driver_route_id']) {
        final String id when id.isNotEmpty => id,
        _ => null,
      },
    );
  }
}

/// A location selected by the passenger on the map.
///
/// It is not restricted to predefined locations.
class PassengerLocation {
  const PassengerLocation({
    required this.label,
    required this.latitude,
    required this.longitude,
  });

  final String label;
  final double latitude;
  final double longitude;
}

/// An active driver availability a passenger could still book.
///
/// Mirrors `GET /passenger/available-departures`.
///
/// The API deliberately exposes only the driver's display name,
/// vehicle type and trust score, plus the route's display-only estimated
/// fare when an admin has published one. There is no rating or
/// completed-trip count in the schema, so those stay absent
/// rather than being invented here.
class AvailableDeparture {
  const AvailableDeparture({
    required this.id,
    required this.routeVersionId,
    required this.originLabel,
    required this.destinationLabel,
    required this.departureAt,
    required this.remainingSeats,
    required this.driverName,
    this.vehicleType,
    this.trustScore,
    this.fares,
  });

  final String id;
  final String routeVersionId;

  /// Display-only tariff of the departure's route (null if none published).
  final RouteFares? fares;

  final String originLabel;
  final String destinationLabel;

  final DateTime departureAt;

  final int remainingSeats;

  final String driverName;
  final String? vehicleType;
  final int? trustScore;

  factory AvailableDeparture.fromJson(Map<String, dynamic> json) {
    final driver = json['driver'];

    final driverMap = driver is Map
        ? driver.map((key, value) => MapEntry(key.toString(), value))
        : const <String, dynamic>{};

    return AvailableDeparture(
      id: _string(json, 'id'),

      routeVersionId: _string(json, 'route_version_id'),

      originLabel: _string(json, 'origin_label'),

      destinationLabel: _string(json, 'destination_label'),

      departureAt: DateTime.parse(_string(json, 'departure_at')).toLocal(),

      remainingSeats: _int(json, 'remaining_seats'),

      driverName: driverMap['name'] as String? ?? '',

      vehicleType: driverMap['vehicle_type'] as String?,

      trustScore: (driverMap['trust_score'] as num?)?.toInt(),

      fares: RouteFares.tryParse(
        json['route'] is Map ? (json['route'] as Map)['fares'] : null,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// JSON HELPERS
// ---------------------------------------------------------------------------

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
