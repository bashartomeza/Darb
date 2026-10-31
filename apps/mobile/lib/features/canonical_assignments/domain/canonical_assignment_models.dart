import '../../../core/fares/fare.dart';

enum CanonicalOfferStatus { offered, accepted, rejected, expired }

enum CanonicalDemandType { passenger, merchantOrder }

enum CanonicalAssignmentStatus {
  pending,
  offered,
  assigned,
  unavailable,
  cancelled,
}

enum CanonicalRejectReason {
  driverDeclined('driver_declined'),
  scheduleConflict('schedule_conflict'),
  capacityUnavailable('capacity_unavailable');

  const CanonicalRejectReason(this.apiValue);
  final String apiValue;
}

const canonicalRouteMatchVersion = 'canonical_route_match_v1';

enum CanonicalTripVersion { single, shared }

enum CanonicalTripStatus { accepted, unsupported }

enum CanonicalVehicleType { sedan, van, unsupported }

CanonicalTripStatus canonicalTripStatusFromApi(String value) => switch (value) {
  'accepted' => CanonicalTripStatus.accepted,
  _ => CanonicalTripStatus.unsupported,
};

CanonicalVehicleType? canonicalVehicleTypeFromApi(String? value) =>
    switch (value) {
      null => null,
      'sedan' => CanonicalVehicleType.sedan,
      'van' => CanonicalVehicleType.van,
      _ => CanonicalVehicleType.unsupported,
    };

class CanonicalRouteStopSummary {
  const CanonicalRouteStopSummary({
    required this.id,
    required this.nameAr,
    required this.nameEn,
    required this.sequence,
  });

  final String id;
  final String nameAr;
  final String nameEn;
  final int sequence;

  factory CanonicalRouteStopSummary.fromJson(Map<String, dynamic> json) {
    return CanonicalRouteStopSummary(
      id: _string(json, 'id'),
      nameAr: _string(json, 'name_ar'),
      nameEn: _string(json, 'name_en'),
      sequence: _integer(json, 'sequence'),
    );
  }
}

class CanonicalRouteSummary {
  const CanonicalRouteSummary({
    required this.id,
    required this.nameAr,
    required this.nameEn,
    required this.direction,
    required this.stops,
  });

  final String id;
  final String nameAr;
  final String nameEn;
  final String direction;
  final List<CanonicalRouteStopSummary> stops;

  factory CanonicalRouteSummary.fromJson(Map<String, dynamic> json) {
    final rawStops = json['stops'];
    if (rawStops is! List) throw const FormatException('Invalid route stops');
    final stops =
        rawStops
            .map((value) => CanonicalRouteStopSummary.fromJson(_map(value)))
            .toList(growable: false)
          ..sort((left, right) => left.sequence.compareTo(right.sequence));
    return CanonicalRouteSummary(
      id: _string(json, 'id'),
      nameAr: _string(json, 'name_ar'),
      nameEn: _string(json, 'name_en'),
      direction: _string(json, 'direction'),
      stops: List.unmodifiable(stops),
    );
  }

  CanonicalRouteStopSummary? stop(String id) =>
      stops.where((value) => value.id == id).firstOrNull;
}

class CanonicalTripSummary {
  const CanonicalTripSummary({
    required this.id,
    required this.version,
    required this.status,
    required this.routeVersionId,
    required this.departureAt,
    required this.vehicleType,
    required this.createdAt,
  });

  final String id;
  final CanonicalTripVersion version;
  final CanonicalTripStatus status;
  final String routeVersionId;
  final DateTime? departureAt;
  final CanonicalVehicleType? vehicleType;
  final DateTime? createdAt;

  factory CanonicalTripSummary.fromJson(Map<String, dynamic> json) {
    final version = switch (_string(json, 'trip_version')) {
      'canonical_route_trip_v1' => CanonicalTripVersion.single,
      'canonical_shared_trip_v1' => CanonicalTripVersion.shared,
      _ => throw const FormatException('Unsupported canonical Trip version'),
    };
    final shared = json['shared_trip'];
    if (shared is! bool || shared != (version == CanonicalTripVersion.shared)) {
      throw const FormatException('Invalid canonical Trip discriminator');
    }
    return CanonicalTripSummary(
      id: _string(json, 'id'),
      version: version,
      status: canonicalTripStatusFromApi(_string(json, 'status')),
      routeVersionId: _string(json, 'route_version_id'),
      departureAt: _optionalDate(json, 'departure_at'),
      vehicleType: canonicalVehicleTypeFromApi(
        _optionalString(json, 'vehicle_type'),
      ),
      createdAt: _optionalDate(json, 'created_at'),
    );
  }
}

class CanonicalOfferDemand {
  const CanonicalOfferDemand({
    required this.pickupStopId,
    required this.destinationStopIds,
    required this.requestedDepartureFrom,
    required this.requestedDepartureUntil,
    required this.passengerCount,
    required this.parcelCount,
    this.fare,
    this.parcelSizes = const [],
  });

  final String pickupStopId;
  final List<String> destinationStopIds;
  final DateTime requestedDepartureFrom;
  final DateTime requestedDepartureUntil;
  final int? passengerCount;
  final int? parcelCount;

  /// Estimate frozen when the demand was created, shown before accepting.
  /// Display-only: the driver is paid directly, not through the app.
  final FareSnapshot? fare;

  /// Parcel size classes (`S`/`M`/`L`) of a merchant order, when reported.
  final List<String> parcelSizes;

  factory CanonicalOfferDemand.fromJson(
    Map<String, dynamic> json,
    CanonicalDemandType type,
  ) {
    final destinations = switch (type) {
      CanonicalDemandType.passenger => [_string(json, 'dropoff_stop_id')],
      CanonicalDemandType.merchantOrder =>
        (json['destination_stop_ids'] as List?)
                ?.map((value) => value is String ? value : '')
                .where((value) => value.isNotEmpty)
                .toList(growable: false) ??
            (throw const FormatException('Invalid destinations')),
    };
    return CanonicalOfferDemand(
      pickupStopId: _string(json, 'pickup_stop_id'),
      destinationStopIds: List.unmodifiable(destinations),
      requestedDepartureFrom: _date(json, 'requested_departure_from'),
      requestedDepartureUntil: _date(json, 'requested_departure_until'),
      passengerCount: type == CanonicalDemandType.passenger
          ? _integer(json, 'passenger_count')
          : null,
      parcelCount: type == CanonicalDemandType.merchantOrder
          ? _integer(json, 'parcel_count')
          : null,
      fare: FareSnapshot.tryParse(json['fare']),
      parcelSizes: _parcelSizes(json['parcels']),
    );
  }
}

class CanonicalDriverOffer {
  const CanonicalDriverOffer({
    required this.id,
    required this.status,
    required this.demandType,
    required this.routeVersionId,
    required this.attemptNumber,
    required this.offeredAt,
    required this.expiresAt,
    required this.departureAt,
    required this.route,
    required this.demand,
    required this.trip,
    required this.rejectReason,
    required this.createdAt,
  });

  final String id;
  final CanonicalOfferStatus status;
  final CanonicalDemandType demandType;
  final String routeVersionId;
  final int attemptNumber;
  final DateTime offeredAt;
  final DateTime expiresAt;
  final DateTime departureAt;
  final CanonicalRouteSummary route;
  final CanonicalOfferDemand demand;
  final CanonicalTripSummary? trip;
  final String? rejectReason;
  final DateTime createdAt;

  bool expiredAt(DateTime serverNow) =>
      status == CanonicalOfferStatus.expired ||
      !serverNow.toUtc().isBefore(expiresAt);

  bool get actionable => status == CanonicalOfferStatus.offered;

  factory CanonicalDriverOffer.fromJson(Map<String, dynamic> json) {
    if (_string(json, 'offer_version') != canonicalRouteMatchVersion) {
      throw const FormatException('Unsupported canonical offer version');
    }
    final status = CanonicalOfferStatus.values
        .where((value) => value.name == _string(json, 'status'))
        .firstOrNull;
    final demandType = switch (_string(json, 'demand_type')) {
      'passenger' => CanonicalDemandType.passenger,
      'merchant_order' => CanonicalDemandType.merchantOrder,
      _ => null,
    };
    if (status == null || demandType == null) {
      throw const FormatException('Invalid canonical offer enum');
    }
    return CanonicalDriverOffer(
      id: _string(json, 'id'),
      status: status,
      demandType: demandType,
      routeVersionId: _string(json, 'route_version_id'),
      attemptNumber: _integer(json, 'attempt_number'),
      offeredAt: _date(json, 'offered_at'),
      expiresAt: _date(json, 'expires_at'),
      departureAt: _date(json, 'departure_at'),
      route: CanonicalRouteSummary.fromJson(_object(json, 'route')),
      demand: CanonicalOfferDemand.fromJson(
        _object(json, 'demand'),
        demandType,
      ),
      trip: _trip(json),
      rejectReason: _optionalString(json, 'reject_reason'),
      createdAt: _date(json, 'created_at'),
    );
  }
}

class CanonicalOfferPage {
  const CanonicalOfferPage({
    required this.offers,
    required this.nextCursor,
    required this.serverNow,
  });

  final List<CanonicalDriverOffer> offers;
  final String? nextCursor;
  final DateTime serverNow;

  factory CanonicalOfferPage.fromJson(Map<String, dynamic> json) {
    final raw = json['offers'];
    if (raw is! List) throw const FormatException('Invalid offers');
    return CanonicalOfferPage(
      offers: List.unmodifiable(
        raw.map((value) => CanonicalDriverOffer.fromJson(_map(value))),
      ),
      nextCursor: _optionalString(json, 'next_cursor'),
      serverNow: _date(json, 'server_now'),
    );
  }
}

class CanonicalAssignment {
  const CanonicalAssignment({
    required this.id,
    required this.routeVersionId,
    required this.route,
    required this.pickupStopId,
    required this.dropoffStopId,
    required this.departureFrom,
    required this.departureUntil,
    required this.status,
    required this.tripVersion,
    required this.trip,
    required this.passengerCount,
    required this.parcelCount,
    required this.destinationStopIds,
    required this.createdAt,
    required this.updatedAt,
    this.fare,
  });

  final String id;
  final String routeVersionId;
  final CanonicalRouteSummary route;
  final String pickupStopId;
  final String? dropoffStopId;
  final DateTime departureFrom;
  final DateTime departureUntil;
  final CanonicalAssignmentStatus status;
  final CanonicalTripVersion? tripVersion;
  final CanonicalTripSummary? trip;
  final int? passengerCount;
  final int? parcelCount;
  final List<String> destinationStopIds;
  final DateTime createdAt;
  final DateTime updatedAt;

  /// Estimate frozen when this request/order was created (null if none).
  final FareSnapshot? fare;

  factory CanonicalAssignment.fromJson(Map<String, dynamic> json) {
    final status = CanonicalAssignmentStatus.values
        .where((value) => value.name == _string(json, 'dispatch_status'))
        .firstOrNull;
    if (status == null) {
      throw const FormatException('Invalid canonical assignment status');
    }
    final tripVersion = switch (_optionalString(
      json,
      'assignment_trip_version',
    )) {
      null => null,
      'canonical_route_trip_v1' => CanonicalTripVersion.single,
      'canonical_shared_trip_v1' => CanonicalTripVersion.shared,
      _ => throw const FormatException('Unsupported assignment Trip version'),
    };
    final rawDestinations = json['destination_stop_ids'];
    return CanonicalAssignment(
      id: _string(json, 'id'),
      routeVersionId: _string(json, 'route_version_id'),
      route: CanonicalRouteSummary.fromJson(_object(json, 'route')),
      pickupStopId: _string(json, 'pickup_stop_id'),
      dropoffStopId: _optionalString(json, 'dropoff_stop_id'),
      departureFrom: _date(json, 'requested_departure_from'),
      departureUntil: _date(json, 'requested_departure_until'),
      status: status,
      tripVersion: tripVersion,
      trip: _trip(json),
      passengerCount: _optionalInteger(json, 'passenger_count'),
      parcelCount: _optionalInteger(json, 'parcel_count'),
      destinationStopIds: rawDestinations is List
          ? List.unmodifiable(
              rawDestinations.whereType<String>().toList(growable: false),
            )
          : const [],
      createdAt: _date(json, 'created_at'),
      updatedAt: _date(json, 'updated_at'),
      fare: FareSnapshot.tryParse(json['fare']),
    );
  }
}

class CanonicalAssignmentEnvelope {
  const CanonicalAssignmentEnvelope({
    required this.assignment,
    required this.serverNow,
  });
  final CanonicalAssignment assignment;
  final DateTime serverNow;
}

class CanonicalOfferEnvelope {
  const CanonicalOfferEnvelope({required this.offer, required this.serverNow});
  final CanonicalDriverOffer offer;
  final DateTime serverNow;
}

List<String> _parcelSizes(Object? value) {
  if (value is! List) return const [];
  return List.unmodifiable([
    for (final item in value)
      if (item is Map && fareParcelSizes.contains(item['size']))
        item['size'] as String,
  ]);
}

CanonicalTripSummary? _trip(Map<String, dynamic> json) {
  final value = _optionalObject(json, 'trip');
  return value == null ? null : CanonicalTripSummary.fromJson(value);
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  throw const FormatException('Expected object');
}

Map<String, dynamic> _object(Map<String, dynamic> json, String key) =>
    _map(json[key]);

Map<String, dynamic>? _optionalObject(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value == null) return null;
  return _map(value);
}

String _string(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is String && value.isNotEmpty) return value;
  throw FormatException('Invalid $key');
}

String? _optionalString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is String && value.isNotEmpty) return value;
  throw FormatException('Invalid $key');
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
