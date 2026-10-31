import 'dart:convert';

import '../../../core/fares/fare.dart';

enum CanonicalRouteDirection { outbound, inbound, loop }

/// A position the server actually reported.
///
/// There is no default and no origin fallback: code that has no [GeoPoint] must
/// say so on screen rather than draw something plausible.
class GeoPoint {
  const GeoPoint(this.latitude, this.longitude);

  final double latitude;
  final double longitude;

  @override
  bool operator ==(Object other) =>
      other is GeoPoint &&
      other.latitude == latitude &&
      other.longitude == longitude;

  @override
  int get hashCode => Object.hash(latitude, longitude);
}

enum RouteGeometryStatus { pending, available, unavailable }

/// The drawn shape of a route version.
///
/// [points] is empty unless the server marked the geometry `available` and the
/// encoding is one this build understands. Callers fall back to joining the
/// ordered stops, which is real data, rather than inventing a road shape.
class RouteGeometry {
  const RouteGeometry({
    required this.status,
    required this.points,
    this.distanceMeters,
    this.durationSeconds,
  });

  final RouteGeometryStatus status;
  final List<GeoPoint> points;
  final int? distanceMeters;
  final int? durationSeconds;

  bool get hasPoints => points.length >= 2;

  static const empty = RouteGeometry(
    status: RouteGeometryStatus.pending,
    points: <GeoPoint>[],
  );

  factory RouteGeometry.fromJson(Map<String, dynamic> json) {
    final status =
        RouteGeometryStatus.values
            .where((value) => value.name == json['status'])
            .firstOrNull ??
        RouteGeometryStatus.pending;
    return RouteGeometry(
      status: status,
      points: status == RouteGeometryStatus.available
          ? _decodeGeometry(json['encoding'], json['encoded'])
          : const <GeoPoint>[],
      distanceMeters: _optionalInteger(json, 'estimated_distance_m'),
      durationSeconds: _optionalInteger(json, 'estimated_duration_s'),
    );
  }
}

/// Only `demo-json-v1` exists server-side today. An unknown encoding yields no
/// points instead of a guess, so a new provider degrades to the stop polyline
/// until this understands it.
List<GeoPoint> _decodeGeometry(Object? encoding, Object? encoded) {
  if (encoding != 'demo-json-v1' || encoded is! String) {
    return const <GeoPoint>[];
  }
  final Object? decoded;
  try {
    decoded = jsonDecode(encoded);
  } on FormatException {
    return const <GeoPoint>[];
  }
  if (decoded is! List) return const <GeoPoint>[];
  final points = <GeoPoint>[];
  for (final value in decoded) {
    if (value is! Map<String, dynamic>) return const <GeoPoint>[];
    final latitude = _coordinate(value['lat'], 90);
    final longitude = _coordinate(value['lng'], 180);
    if (latitude == null || longitude == null) return const <GeoPoint>[];
    points.add(GeoPoint(latitude, longitude));
  }
  return List.unmodifiable(points);
}

double? _coordinate(Object? value, num limit) {
  final numeric = value is num ? value.toDouble() : null;
  if (numeric == null || numeric.abs() > limit) return null;
  return numeric;
}

enum CanonicalRouteStatus { active, retired }

enum CanonicalRouteVersionStatus { draft, published, paused, retired }

enum DriverAvailabilityStatus {
  draft,
  active,
  paused,
  filled,
  departed,
  completed,
  cancelled,
  expired,
}

class MobileCapabilities {
  const MobileCapabilities({
    required this.routeCatalogAvailable,
    required this.multiRouteEntryAvailable,
    required this.matchingAvailable,
    required this.canonicalTripCreationAvailable,
    required this.driverCanonicalOffersAvailable,
    required this.canonicalAssignmentStatusAvailable,
    this.canonicalSharedTripPresentationAvailable = false,
    this.canonicalSharedDriverOffersAvailable = false,
    this.canonicalSharedAssignmentStatusAvailable = false,
    required this.mapsAvailable,
    this.checkpointsAvailable = false,
    required this.liveTrackingAvailable,
  });

  final bool routeCatalogAvailable;
  final bool multiRouteEntryAvailable;
  final bool matchingAvailable;
  final bool canonicalTripCreationAvailable;
  final bool driverCanonicalOffersAvailable;
  final bool canonicalAssignmentStatusAvailable;
  final bool canonicalSharedTripPresentationAvailable;
  final bool canonicalSharedDriverOffersAvailable;
  final bool canonicalSharedAssignmentStatusAvailable;
  final bool mapsAvailable;
  final bool checkpointsAvailable;
  final bool liveTrackingAvailable;

  factory MobileCapabilities.fromJson(Map<String, dynamic> json) {
    _requireKeys(json, const {
      'canonical_route_catalog_available',
      'canonical_multi_route_entry_available',
      'canonical_matching_available',
      'canonical_trip_creation_available',
      'driver_canonical_offers_available',
      'canonical_assignment_status_available',
      'canonical_shared_trip_presentation_available',
      'canonical_shared_driver_offers_available',
      'canonical_shared_assignment_status_available',
      'maps_available',
      'checkpoints_available',
      'live_tracking_available',
    });
    return MobileCapabilities(
      routeCatalogAvailable: _bool(json, 'canonical_route_catalog_available'),
      multiRouteEntryAvailable: _bool(
        json,
        'canonical_multi_route_entry_available',
      ),
      matchingAvailable: _bool(json, 'canonical_matching_available'),
      canonicalTripCreationAvailable: _bool(
        json,
        'canonical_trip_creation_available',
      ),
      driverCanonicalOffersAvailable: _bool(
        json,
        'driver_canonical_offers_available',
      ),
      canonicalAssignmentStatusAvailable: _bool(
        json,
        'canonical_assignment_status_available',
      ),
      canonicalSharedTripPresentationAvailable: _optionalBool(
        json,
        'canonical_shared_trip_presentation_available',
      ),
      canonicalSharedDriverOffersAvailable: _optionalBool(
        json,
        'canonical_shared_driver_offers_available',
      ),
      canonicalSharedAssignmentStatusAvailable: _optionalBool(
        json,
        'canonical_shared_assignment_status_available',
      ),
      mapsAvailable: _bool(json, 'maps_available'),
      checkpointsAvailable: _optionalBool(json, 'checkpoints_available'),
      liveTrackingAvailable: _bool(json, 'live_tracking_available'),
    );
  }
}

class CanonicalStop {
  const CanonicalStop({
    required this.id,
    required this.nameAr,
    required this.nameEn,
    required this.sequence,
    required this.passengerPickupAllowed,
    required this.passengerDropoffAllowed,
    required this.parcelPickupAllowed,
    required this.parcelDropoffAllowed,
    this.position,
  });

  final String id;
  final String nameAr;
  final String nameEn;
  final int sequence;
  final bool passengerPickupAllowed;
  final bool passengerDropoffAllowed;
  final bool parcelPickupAllowed;
  final bool parcelDropoffAllowed;

  /// Null whenever the server withholds coordinates, which it does until maps
  /// are enabled. A stop without one is still selectable by name; it simply
  /// cannot be drawn.
  final GeoPoint? position;

  factory CanonicalStop.fromMembership(Map<String, dynamic> json) {
    _requireKeys(json, const {
      'sequence',
      'passenger_pickup_allowed',
      'passenger_dropoff_allowed',
      'parcel_pickup_allowed',
      'parcel_dropoff_allowed',
      'stop',
    });
    final stop = _object(json, 'stop');
    _requireKeys(stop, const {
      'id',
      'name_ar',
      'name_en',
      'latitude',
      'longitude',
    });
    final latitude = _coordinate(stop['latitude'], 90);
    final longitude = _coordinate(stop['longitude'], 180);
    return CanonicalStop(
      id: _string(stop, 'id'),
      nameAr: _string(stop, 'name_ar'),
      nameEn: _string(stop, 'name_en'),
      position: latitude == null || longitude == null
          ? null
          : GeoPoint(latitude, longitude),
      sequence: _integer(json, 'sequence'),
      passengerPickupAllowed: _bool(json, 'passenger_pickup_allowed'),
      passengerDropoffAllowed: _bool(json, 'passenger_dropoff_allowed'),
      parcelPickupAllowed: _bool(json, 'parcel_pickup_allowed'),
      parcelDropoffAllowed: _bool(json, 'parcel_dropoff_allowed'),
    );
  }
}

class CanonicalRoute {
  const CanonicalRoute({
    required this.id,
    required this.routeStatus,
    required this.direction,
    required this.versionId,
    required this.versionNumber,
    required this.nameAr,
    required this.nameEn,
    required this.versionStatus,
    required this.activeFrom,
    required this.activeUntil,
    required this.stops,
    this.geometry = RouteGeometry.empty,
    this.fares,
  });

  final String id;
  final CanonicalRouteStatus routeStatus;
  final CanonicalRouteDirection direction;
  final String versionId;
  final int versionNumber;
  final String nameAr;
  final String nameEn;
  final CanonicalRouteVersionStatus versionStatus;
  final DateTime? activeFrom;
  final DateTime? activeUntil;
  final List<CanonicalStop> stops;
  final RouteGeometry geometry;

  /// Display-only estimated tariff; null until an admin publishes one.
  final RouteFares? fares;

  /// The line to draw for this route.
  ///
  /// Prefers the published geometry and otherwise joins the stops that have
  /// coordinates, in sequence. Both are server data; neither is interpolated.
  List<GeoPoint> get path {
    if (geometry.hasPoints) return geometry.points;
    return List.unmodifiable([
      for (final stop in stops)
        if (stop.position != null) stop.position!,
    ]);
  }

  CanonicalStop? get originStop => stops.isEmpty ? null : stops.first;

  CanonicalStop? get destinationStop => stops.isEmpty ? null : stops.last;

  bool get currentlyEligible {
    final now = DateTime.now().toUtc();
    return routeStatus == CanonicalRouteStatus.active &&
        versionStatus == CanonicalRouteVersionStatus.published &&
        (activeFrom == null || !activeFrom!.isAfter(now)) &&
        (activeUntil == null || activeUntil!.isAfter(now));
  }

  CanonicalRoute withStops(List<CanonicalStop> value) => CanonicalRoute(
    id: id,
    routeStatus: routeStatus,
    direction: direction,
    versionId: versionId,
    versionNumber: versionNumber,
    nameAr: nameAr,
    nameEn: nameEn,
    versionStatus: versionStatus,
    activeFrom: activeFrom,
    activeUntil: activeUntil,
    stops: _validatedStops(value),
    geometry: geometry,
    fares: fares,
  );

  factory CanonicalRoute.fromJson(Map<String, dynamic> json) {
    _requireKeys(json, const {
      'id',
      'direction',
      'status',
      'current_version',
      'fares',
    });
    final version = _object(json, 'current_version');
    _requireKeys(version, const {
      'id',
      'version_number',
      'status',
      'name_ar',
      'name_en',
      'active_from',
      'active_until',
      'stops',
      'geometry',
    });
    final direction = CanonicalRouteDirection.values
        .where((value) => value.name == _string(json, 'direction'))
        .firstOrNull;
    if (direction == null) throw const FormatException('Invalid direction');
    final routeStatus = CanonicalRouteStatus.values
        .where((value) => value.name == _string(json, 'status'))
        .firstOrNull;
    final versionStatus = CanonicalRouteVersionStatus.values
        .where((value) => value.name == _string(version, 'status'))
        .firstOrNull;
    if (routeStatus == null || versionStatus == null) {
      throw const FormatException('Invalid route status');
    }
    final rawStops = version['stops'];
    final stops = rawStops is List
        ? rawStops
              .map((value) => CanonicalStop.fromMembership(_map(value)))
              .toList(growable: false)
        : const <CanonicalStop>[];
    return CanonicalRoute(
      id: _string(json, 'id'),
      routeStatus: routeStatus,
      direction: direction,
      versionId: _string(version, 'id'),
      versionNumber: _integer(version, 'version_number'),
      nameAr: _string(version, 'name_ar'),
      nameEn: _string(version, 'name_en'),
      versionStatus: versionStatus,
      activeFrom: _optionalDate(version, 'active_from'),
      activeUntil: _optionalDate(version, 'active_until'),
      stops: _validatedStops(stops),
      geometry: version['geometry'] is Map<String, dynamic>
          ? RouteGeometry.fromJson(_object(version, 'geometry'))
          : RouteGeometry.empty,
      fares: RouteFares.tryParse(json['fares']),
    );
  }
}

List<CanonicalStop> _validatedStops(List<CanonicalStop> stops) {
  final ids = <String>{};
  final sequences = <int>{};
  for (final stop in stops) {
    if (stop.sequence < 1 ||
        !ids.add(stop.id) ||
        !sequences.add(stop.sequence)) {
      throw const FormatException('Invalid ordered stops');
    }
  }
  return List.unmodifiable(
    [...stops]..sort((a, b) => a.sequence.compareTo(b.sequence)),
  );
}

class DriverAvailability {
  const DriverAvailability({
    required this.id,
    required this.routeVersionId,
    required this.nameAr,
    required this.nameEn,
    required this.direction,
    required this.departureAt,
    required this.windowEnd,
    required this.totalSeats,
    required this.remainingSeats,
    required this.totalParcelCapacity,
    required this.remainingParcelCapacity,
    required this.status,
    required this.revision,
  });

  final String id;
  final String routeVersionId;
  final String nameAr;
  final String nameEn;
  final CanonicalRouteDirection direction;
  final DateTime departureAt;
  final DateTime? windowEnd;
  final int totalSeats;
  final int remainingSeats;
  final int totalParcelCapacity;
  final int remainingParcelCapacity;
  final DriverAvailabilityStatus status;
  final int revision;

  bool get isTerminal => const {
    DriverAvailabilityStatus.filled,
    DriverAvailabilityStatus.departed,
    DriverAvailabilityStatus.completed,
    DriverAvailabilityStatus.cancelled,
    DriverAvailabilityStatus.expired,
  }.contains(status);

  factory DriverAvailability.fromJson(Map<String, dynamic> json) {
    final version = _object(json, 'route_version');
    final status = DriverAvailabilityStatus.values
        .where((value) => value.name == _string(json, 'status'))
        .firstOrNull;
    final direction = CanonicalRouteDirection.values
        .where((value) => value.name == _string(version, 'direction'))
        .firstOrNull;
    if (status == null || direction == null) {
      throw const FormatException('Invalid availability enum');
    }
    return DriverAvailability(
      id: _string(json, 'id'),
      routeVersionId: _string(version, 'id'),
      nameAr: _string(version, 'name_ar'),
      nameEn: _string(version, 'name_en'),
      direction: direction,
      departureAt: _date(json, 'departure_at'),
      windowEnd: _optionalDate(json, 'availability_window_end'),
      totalSeats: _integer(json, 'total_seats'),
      remainingSeats: _integer(json, 'remaining_seats'),
      totalParcelCapacity: _integer(json, 'total_parcel_capacity'),
      remainingParcelCapacity: _integer(json, 'remaining_parcel_capacity'),
      status: status,
      revision: _integer(json, 'revision'),
    );
  }
}

class CanonicalPassengerRequest {
  const CanonicalPassengerRequest({
    required this.id,
    required this.routeVersionId,
    required this.pickupStopId,
    required this.dropoffStopId,
    required this.departureFrom,
    required this.departureUntil,
    required this.passengerCount,
    required this.replayed,
    this.fare,
  });

  final String id;
  final String routeVersionId;
  final String pickupStopId;
  final String dropoffStopId;
  final DateTime departureFrom;
  final DateTime departureUntil;
  final int passengerCount;
  final bool replayed;

  /// Estimated fare frozen when the request was created (null if none).
  final FareSnapshot? fare;

  factory CanonicalPassengerRequest.fromEnvelope(Map<String, dynamic> json) {
    final value = _object(json, 'request');
    return CanonicalPassengerRequest(
      id: _string(value, 'id'),
      routeVersionId: _string(value, 'route_version_id'),
      pickupStopId: _string(value, 'pickup_stop_id'),
      dropoffStopId: _string(value, 'dropoff_stop_id'),
      departureFrom: _date(value, 'requested_departure_from'),
      departureUntil: _date(value, 'requested_departure_until'),
      passengerCount: _integer(value, 'passenger_count'),
      replayed: json['replayed'] == true,
      fare: FareSnapshot.tryParse(value['fare']),
    );
  }
}

class CanonicalParcelInput {
  const CanonicalParcelInput({
    required this.destinationStopId,
    required this.size,
    required this.priority,
  });
  final String destinationStopId;
  final String size;
  final String priority;
  Map<String, dynamic> toJson() => {
    'destination_stop_id': destinationStopId,
    'size': size,
    'priority': priority,
  };
}

class CanonicalMerchantOrder {
  const CanonicalMerchantOrder({
    required this.id,
    required this.parcelCount,
    required this.replayed,
    this.fare,
  });
  final String id;
  final int parcelCount;
  final bool replayed;

  /// Estimated total frozen at creation; null unless every parcel was priced.
  final FareSnapshot? fare;

  factory CanonicalMerchantOrder.fromEnvelope(Map<String, dynamic> json) {
    final order = _object(json, 'order');
    final parcels = order['parcels'];
    if (parcels is! List) throw const FormatException('Invalid parcels');
    return CanonicalMerchantOrder(
      id: _string(order, 'id'),
      parcelCount: parcels.length,
      replayed: json['replayed'] == true,
      fare: FareSnapshot.tryParse(order['fare']),
    );
  }
}

List<CanonicalStop> passengerPickupStops(CanonicalRoute route) =>
    List.unmodifiable(route.stops.where((stop) => stop.passengerPickupAllowed));

List<CanonicalStop> downstreamPassengerStops(
  CanonicalRoute route,
  CanonicalStop pickup,
) => List.unmodifiable(
  route.stops.where(
    (stop) => stop.passengerDropoffAllowed && stop.sequence > pickup.sequence,
  ),
);

List<CanonicalStop> parcelPickupStops(CanonicalRoute route) =>
    List.unmodifiable(route.stops.where((stop) => stop.parcelPickupAllowed));

List<CanonicalStop> downstreamParcelStops(
  CanonicalRoute route,
  CanonicalStop pickup,
) => List.unmodifiable(
  route.stops.where(
    (stop) => stop.parcelDropoffAllowed && stop.sequence > pickup.sequence,
  ),
);

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  throw const FormatException('Expected object');
}

Map<String, dynamic> _object(Map<String, dynamic> json, String key) =>
    _map(json[key]);

String _string(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is String && value.isNotEmpty) return value;
  throw FormatException('Invalid $key');
}

bool _bool(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is bool) return value;
  throw FormatException('Invalid $key');
}

bool _optionalBool(Map<String, dynamic> json, String key) {
  if (!json.containsKey(key)) return false;
  return _bool(json, key);
}

int _integer(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is int) return value;
  throw FormatException('Invalid $key');
}

int? _optionalInteger(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is int) return value;
  throw FormatException('Invalid $key');
}

DateTime _date(Map<String, dynamic> json, String key) {
  final value = _optionalDate(json, key);
  if (value != null) return value;
  throw FormatException('Invalid $key');
}

DateTime? _optionalDate(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is! String) throw FormatException('Invalid $key');
  final parsed = DateTime.tryParse(value);
  if (parsed == null) throw FormatException('Invalid $key');
  return parsed.toUtc();
}

void _requireKeys(Map<String, dynamic> json, Set<String> allowed) {
  if (json.keys.any((key) => !allowed.contains(key))) {
    throw const FormatException('Unexpected response field');
  }
}
