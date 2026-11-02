import '../../delivery_handover/data/delivery_handover_models.dart';
import '../../matching/data/matching_models.dart';
import '../../canonical_routes/domain/canonical_route_models.dart';

const driverTripTimeline = [
  'accepted',
  'pickup_started',
  'picked_up',
  'in_transit',
  'delivered',
  'completed',
];

class DriverRoute {
  const DriverRoute({
    required this.id,
    required this.originLabel,
    required this.originLat,
    required this.originLng,
    required this.destinationLabel,
    required this.destinationLat,
    required this.destinationLng,
    required this.corridorKey,
    required this.seatsAvailable,
    required this.parcelCapacityAvailable,
    required this.status,
    required this.activatedAt,
    required this.completedAt,
    this.serviceRouteId,
    this.routeNameAr,
    this.routeNameEn,
  });

  final String id;
  final String originLabel;
  final double originLat;
  final double originLng;
  final String destinationLabel;
  final double destinationLat;
  final double destinationLng;
  final String corridorKey;
  final int seatsAvailable;
  final int parcelCapacityAvailable;
  final String status;
  final DateTime? activatedAt;
  final DateTime? completedAt;

  /// The predefined route the driver chose; null for routes created before
  /// routes existed.
  final String? serviceRouteId;
  final String? routeNameAr;
  final String? routeNameEn;

  String? routeName({required bool arabic}) =>
      _routeName(routeNameAr, routeNameEn, arabic: arabic);

  bool get isOperational =>
      status == 'active' || status == 'assigned' || status == 'on_trip';
  bool get canDeactivate => status == 'active';

  factory DriverRoute.fromJson(Map<String, dynamic> json) {
    return DriverRoute(
      id: _string(json, 'id'),
      originLabel: _string(json, 'origin_label'),
      originLat: _coordinate(json['origin_lat']),
      originLng: _coordinate(json['origin_lng']),
      destinationLabel: _string(json, 'destination_label'),
      destinationLat: _coordinate(json['destination_lat']),
      destinationLng: _coordinate(json['destination_lng']),
      corridorKey: _string(json, 'corridor_key'),
      seatsAvailable: _int(json, 'seats_available'),
      parcelCapacityAvailable: _int(json, 'parcel_capacity_available'),
      status: _string(json, 'status'),
      activatedAt: _dateTimeOrNull(json['activated_at']),
      completedAt: _dateTimeOrNull(json['completed_at']),
      serviceRouteId: _text(json['service_route_id']),
      routeNameAr: _text(json['route_name_ar']),
      routeNameEn: _text(json['route_name_en']),
    );
  }
}

class DriverRouteSummary {
  const DriverRouteSummary({
    required this.id,
    required this.originLabel,
    required this.destinationLabel,
    required this.corridorKey,
    required this.seatsAvailable,
    required this.parcelCapacityAvailable,
    required this.status,
    this.routeNameAr,
    this.routeNameEn,
  });

  final String id;
  final String originLabel;
  final String destinationLabel;
  final String corridorKey;
  final int seatsAvailable;
  final int parcelCapacityAvailable;
  final String status;
  final String? routeNameAr;
  final String? routeNameEn;

  String? routeName({required bool arabic}) =>
      _routeName(routeNameAr, routeNameEn, arabic: arabic);

  factory DriverRouteSummary.fromJson(Map<String, dynamic> json) {
    return DriverRouteSummary(
      id: _string(json, 'id'),
      originLabel: _string(json, 'origin_label'),
      destinationLabel: _string(json, 'destination_label'),
      corridorKey: _string(json, 'corridor_key'),
      seatsAvailable: _int(json, 'seats_available'),
      parcelCapacityAvailable: _int(json, 'parcel_capacity_available'),
      status: _string(json, 'status'),
      routeNameAr: _text(json['route_name_ar']),
      routeNameEn: _text(json['route_name_en']),
    );
  }
}

class DriverPassengerSummary {
  const DriverPassengerSummary({
    required this.id,
    required this.pickupLabel,
    required this.destinationLabel,
    required this.passengerCount,
    required this.status,
    this.pickup,
    this.destination,
    this.pickupDetails,
    this.dropoffDetails,
  });

  final String id;
  final String pickupLabel;
  final String destinationLabel;
  final int passengerCount;
  final String status;
  final GeoPoint? pickup;
  final GeoPoint? destination;

  /// Where exactly the passenger waits and gets off, in their own words; null
  /// for requests created before routes existed.
  final String? pickupDetails;
  final String? dropoffDetails;

  factory DriverPassengerSummary.fromJson(Map<String, dynamic> json) {
    return DriverPassengerSummary(
      id: _string(json, 'id'),
      pickupLabel: _string(json, 'pickup_label'),
      destinationLabel: _string(json, 'destination_label'),
      passengerCount: _int(json, 'passenger_count'),
      status: _string(json, 'status'),
      pickup: _point(json['pickup_lat'], json['pickup_lng']),
      destination: _point(json['destination_lat'], json['destination_lng']),
      pickupDetails: _text(json['pickup_details']),
      dropoffDetails: _text(json['dropoff_details']),
    );
  }
}

/// One parcel of a merchant order as the driver delivers it.
class DriverParcelStop {
  const DriverParcelStop({
    this.dropoffDetails,
    this.destinationLabel,
    this.receiverName,
    this.receiverPhone,
    this.size,
  });

  /// Where exactly the parcel goes, as the merchant typed it; null for
  /// parcels created before routes existed.
  final String? dropoffDetails;
  final String? destinationLabel;
  final String? receiverName;
  final String? receiverPhone;
  final String? size;

  factory DriverParcelStop.fromJson(Map<String, dynamic> json) =>
      DriverParcelStop(
        dropoffDetails: _text(json['dropoff_details']),
        destinationLabel: _text(json['destination_label']),
        receiverName: _text(json['receiver_name']),
        receiverPhone: _text(json['receiver_phone']),
        size: _text(json['size']),
      );
}

class DriverMerchantSummary {
  const DriverMerchantSummary({
    required this.id,
    required this.pickupLabel,
    required this.status,
    required this.parcelCount,
    this.pickup,
    this.destination,
    this.destinationLabel,
    this.pickupDetails,
    this.parcels = const [],
  });

  final String id;
  final String pickupLabel;
  final String status;
  final int parcelCount;
  final GeoPoint? pickup;
  final GeoPoint? destination;
  final String? destinationLabel;

  /// Where the parcels are collected, as the merchant typed it; null for
  /// orders created before routes existed.
  final String? pickupDetails;

  /// The parcels, when the payload lists them.
  final List<DriverParcelStop> parcels;

  factory DriverMerchantSummary.fromJson(Map<String, dynamic> json) {
    final parcels = json['parcels'];
    final destinations = parcels is List
        ? parcels
              .whereType<Map>()
              .map(
                (parcel) => (
                  point: _point(
                    parcel['destination_lat'],
                    parcel['destination_lng'],
                  ),
                  label: parcel['destination_label'] as String?,
                ),
              )
              .toList()
        : const <({GeoPoint? point, String? label})>[];
    final first = destinations.firstOrNull;
    final singleDestination =
        first?.point != null &&
        destinations.every((value) => value.point == first!.point);
    return DriverMerchantSummary(
      id: _string(json, 'id'),
      pickupLabel: _string(json, 'pickup_label'),
      status: _string(json, 'status'),
      pickup: _point(json['pickup_lat'], json['pickup_lng']),
      destination: singleDestination ? first!.point : null,
      destinationLabel: singleDestination ? first!.label : null,
      parcelCount: json['parcel_count'] is num
          ? (json['parcel_count'] as num).toInt()
          : parcels is List
          ? parcels.length
          : 0,
      pickupDetails: _text(json['pickup_details']),
      parcels: parcels is List
          ? [
              for (final parcel in parcels)
                if (parcel is Map<String, dynamic>)
                  DriverParcelStop.fromJson(parcel),
            ]
          : const [],
    );
  }
}

class DriverParcelBatchSummary {
  const DriverParcelBatchSummary({
    required this.id,
    required this.status,
    required this.estimatedDistanceSaved,
    required this.explanation,
    this.parcelCount,
  });

  final String id;
  final String status;
  final double estimatedDistanceSaved;
  final String explanation;
  final int? parcelCount;

  factory DriverParcelBatchSummary.fromJson(Map<String, dynamic> json) {
    return DriverParcelBatchSummary(
      parcelCount: (json['parcel_count'] as num?)?.toInt(),
      id: _string(json, 'id'),
      status: _string(json, 'status'),
      estimatedDistanceSaved: _double(json, 'estimated_distance_saved'),
      explanation: _string(json, 'explanation'),
    );
  }
}

class DriverMatch {
  const DriverMatch({
    required this.id,
    required this.status,
    required this.score,
    required this.method,
    required this.explanation,
    required this.breakdown,
    required this.createdAt,
    required this.route,
    required this.passengerRequest,
    required this.merchantOrder,
    required this.parcelBatch,
  });

  final String id;
  final String status;
  final double score;
  final String method;
  final String explanation;
  final ScoringBreakdown breakdown;
  final DateTime createdAt;
  final DriverRouteSummary route;
  final DriverPassengerSummary? passengerRequest;
  final DriverMerchantSummary? merchantOrder;
  final DriverParcelBatchSummary? parcelBatch;

  bool get canRespond => status == 'proposed' || status == 'sent_to_driver';
  bool get isCombined => passengerRequest != null && merchantOrder != null;
  bool get isMerchantOnly => passengerRequest == null && merchantOrder != null;
  String get pickupLabel =>
      passengerRequest?.pickupLabel ?? merchantOrder?.pickupLabel ?? '';
  String get destinationLabel =>
      passengerRequest?.destinationLabel ?? route.destinationLabel;

  factory DriverMatch.fromJson(Map<String, dynamic> json) {
    final passenger = json['passenger_request'];
    final merchant = json['merchant_order'];
    final batch = json['parcel_batch'];
    return DriverMatch(
      id: _string(json, 'id'),
      status: _string(json, 'status'),
      score: _double(json, 'score'),
      method: _string(json, 'method'),
      explanation: _string(json, 'explanation'),
      breakdown: ScoringBreakdown.fromJson(
        json['scoring_breakdown'] as Map<String, dynamic>,
      ),
      createdAt: DateTime.parse(_string(json, 'created_at')).toLocal(),
      route: DriverRouteSummary.fromJson(
        json['driver_route'] as Map<String, dynamic>,
      ),
      passengerRequest: passenger is Map<String, dynamic>
          ? DriverPassengerSummary.fromJson(passenger)
          : null,
      merchantOrder: merchant is Map<String, dynamic>
          ? DriverMerchantSummary.fromJson(merchant)
          : null,
      parcelBatch: batch is Map<String, dynamic>
          ? DriverParcelBatchSummary.fromJson(batch)
          : null,
    );
  }
}

class DriverTripReference {
  const DriverTripReference({required this.id, required this.status});
  final String id;
  final String status;

  factory DriverTripReference.fromJson(Map<String, dynamic> json) {
    return DriverTripReference(
      id: _string(json, 'id'),
      status: _string(json, 'status'),
    );
  }
}

class DriverTrip {
  const DriverTrip({
    required this.id,
    required this.status,
    required this.createdAt,
    required this.startedAt,
    required this.completedAt,
    required this.route,
    required this.passengerRequest,
    required this.merchantOrder,
    required this.parcelBatch,
    this.deliveryConfirmation,
  });

  final String id;
  final String status;
  final DateTime createdAt;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final DriverRoute route;
  final DriverPassengerSummary? passengerRequest;
  final DriverMerchantSummary? merchantOrder;
  final DriverParcelBatchSummary? parcelBatch;

  /// Receiver confirmation state for the parcel orders on this trip, when known.
  final TripDeliveryConfirmation? deliveryConfirmation;

  /// A parcel trip cannot be delivered until its receivers have confirmed.
  bool get needsReceiverConfirmation =>
      status == 'in_transit' &&
      (deliveryConfirmation?.needsReceiverConfirmation ?? false);

  GeoPoint? get mapOrigin => passengerRequest != null
      ? passengerRequest!.pickup
      : merchantOrder != null
      ? merchantOrder!.pickup
      : _point(route.originLat, route.originLng);
  GeoPoint? get mapDestination => passengerRequest != null
      ? passengerRequest!.destination
      : merchantOrder != null
      ? merchantOrder!.destination
      : _point(route.destinationLat, route.destinationLng);
  String get mapOriginLabel =>
      passengerRequest?.pickupLabel ??
      merchantOrder?.pickupLabel ??
      route.originLabel;
  String get mapDestinationLabel =>
      passengerRequest?.destinationLabel ??
      (merchantOrder != null
          ? merchantOrder!.destinationLabel ?? ''
          : route.destinationLabel);

  bool get isActive =>
      status != 'completed' && status != 'cancelled' && status != 'failed';
  String? get nextStatus => switch (status) {
    'accepted' => 'pickup_started',
    'pickup_started' => 'picked_up',
    'picked_up' => 'in_transit',
    'in_transit' => 'delivered',
    'delivered' => 'completed',
    _ => null,
  };

  factory DriverTrip.fromJson(Map<String, dynamic> json) {
    final passenger = json['passenger_request'];
    final merchant = json['merchant_order'];
    final batch = json['parcel_batch'];
    return DriverTrip(
      id: _string(json, 'id'),
      status: _string(json, 'status'),
      createdAt: DateTime.parse(_string(json, 'created_at')).toLocal(),
      startedAt: _dateTimeOrNull(json['started_at']),
      completedAt: _dateTimeOrNull(json['completed_at']),
      route: DriverRoute.fromJson(json['driver_route'] as Map<String, dynamic>),
      passengerRequest: passenger is Map<String, dynamic>
          ? DriverPassengerSummary.fromJson(passenger)
          : null,
      merchantOrder: merchant is Map<String, dynamic>
          ? DriverMerchantSummary.fromJson(merchant)
          : null,
      parcelBatch: batch is Map<String, dynamic>
          ? DriverParcelBatchSummary.fromJson(batch)
          : null,
      deliveryConfirmation:
          json['delivery_confirmation'] is Map<String, dynamic>
          ? TripDeliveryConfirmation.fromJson(
              json['delivery_confirmation'] as Map<String, dynamic>,
            )
          : null,
    );
  }
}

GeoPoint? _point(Object? latitude, Object? longitude) {
  final lat = latitude is num
      ? latitude.toDouble()
      : double.tryParse('$latitude');
  final lng = longitude is num
      ? longitude.toDouble()
      : double.tryParse('$longitude');
  if (lat == null ||
      lng == null ||
      !lat.isFinite ||
      !lng.isFinite ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180) {
    return null;
  }
  return GeoPoint(lat, lng);
}

// A missing route coordinate cannot masquerade as a real geographic zero.
// The map's endpoint validation omits invalid positions without losing the trip.
double _coordinate(Object? value) =>
    value is num ? value.toDouble() : double.tryParse('$value') ?? double.nan;

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

int _int(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is num) return value.toInt();
  throw FormatException('Missing $key');
}

/// An optional text field: trimmed, or null when absent or blank.
String? _text(Object? value) {
  if (value is! String) return null;
  final text = value.trim();
  return text.isEmpty ? null : text;
}

String? _routeName(String? nameAr, String? nameEn, {required bool arabic}) {
  if (arabic && nameAr != null) return nameAr;
  return nameEn ?? nameAr;
}

DateTime? _dateTimeOrNull(Object? value) {
  if (value == null) return null;
  if (value is String) return DateTime.parse(value).toLocal();
  throw const FormatException('Invalid date');
}
