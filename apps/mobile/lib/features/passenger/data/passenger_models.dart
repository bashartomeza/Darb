import '../../../core/cancellation/cancellation.dart';
import '../../../core/fares/fare.dart';
import '../../operating_routes/data/city_place_models.dart';

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
    this.serviceRouteId,
    this.routeNameAr,
    this.routeNameEn,
    this.pickupDetails,
    this.dropoffDetails,
    this.pickupPlaceAr,
    this.pickupPlaceEn,
    this.dropoffPlaceAr,
    this.dropoffPlaceEn,
    this.fare,
    this.cancellation,
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

  /// The predefined route ("Hebron → Bethlehem") the request was booked on and
  /// the exact pickup and drop-off the passenger typed. All null for requests
  /// saved before routes existed; screens then fall back to the place labels.
  final String? serviceRouteId;
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

  /// The route's seat fare frozen when the request was made (per seat and for
  /// the whole party); null when the route had no fare.
  final FareSnapshot? fare;

  /// Who cancelled the request and why; null while it is not cancelled (and
  /// for requests cancelled before reasons were recorded).
  final CancellationInfo? cancellation;

  /// The route's name in the reading language, or null for older requests.
  String? routeName({required bool arabic}) {
    final ar = routeNameAr;
    final en = routeNameEn;
    if (arabic && ar != null) return ar;
    return en ?? ar;
  }

  /// A request can be cancelled until the passenger is picked up, also after
  /// a driver accepted it.
  bool get canCancel =>
      status == 'pending' || status == 'matched' || status == 'accepted';

  /// A driver already accepted: cancelling tells that driver.
  bool get hasAcceptedDriver => status == 'accepted';

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

      selectedDriverRouteId: _optionalString(json, 'selected_driver_route_id'),
      serviceRouteId: _optionalString(json, 'service_route_id'),
      routeNameAr: _optionalString(json, 'route_name_ar'),
      routeNameEn: _optionalString(json, 'route_name_en'),
      pickupDetails: _optionalString(json, 'pickup_details'),
      dropoffDetails: _optionalString(json, 'dropoff_details'),
      pickupPlaceAr: _optionalString(json, 'pickup_place_name_ar'),
      pickupPlaceEn: _optionalString(json, 'pickup_place_name_en'),
      dropoffPlaceAr: _optionalString(json, 'dropoff_place_name_ar'),
      dropoffPlaceEn: _optionalString(json, 'dropoff_place_name_en'),
      fare: FareSnapshot.tryParse(json['fare']),
      cancellation: CancellationInfo.tryParse(json['cancellation']),
    );
  }
}

/// The body of `POST /passenger/requests` (and, without the details and the
/// driver route, of `POST /matches/search`): a predefined route plus the exact
/// pickup and drop-off places chosen from the route's cities, plus optional
/// extra details for each. The server fills the labels from the route's
/// cities and the coordinates from the chosen places.
Map<String, dynamic> passengerRouteRequestBody({
  required String serviceRouteId,
  String? pickupPlaceId,
  String? dropoffPlaceId,
  String pickupDetails = '',
  String dropoffDetails = '',
  required DateTime preferredTime,
  required int passengerCount,
  String? selectedDriverRouteId,
}) => {
  'service_route_id': serviceRouteId,
  'pickup_place_id': ?pickupPlaceId,
  'dropoff_place_id': ?dropoffPlaceId,
  if (pickupDetails.trim().isNotEmpty) 'pickup_details': pickupDetails.trim(),
  if (dropoffDetails.trim().isNotEmpty)
    'dropoff_details': dropoffDetails.trim(),
  'preferred_time': preferredTime.toUtc().toIso8601String(),
  'passenger_count': passengerCount,
  'selected_driver_route_id': ?selectedDriverRouteId,
};

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

String? _optionalString(Map<String, dynamic> json, String key) {
  final value = json[key];
  return value is String && value.trim().isNotEmpty ? value.trim() : null;
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
