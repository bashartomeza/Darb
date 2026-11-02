/// One active stop of the locked corridor, as served by `GET /legacy-corridor`.
///
/// The flags are the route version's own rules for this stop; the legacy
/// screens offer a stop only for the uses the server allows.
class CorridorPlace {
  const CorridorPlace({
    required this.key,
    required this.nameAr,
    required this.nameEn,
    required this.lat,
    required this.lng,
    this.passengerPickup = false,
    this.passengerDropoff = false,
    this.parcelPickup = false,
    this.parcelDropoff = false,
  });

  /// The stop's `stop_key`; the assistant uses the same keys.
  final String key;
  final String nameAr;
  final String nameEn;
  final double lat;
  final double lng;
  final bool passengerPickup;
  final bool passengerDropoff;
  final bool parcelPickup;
  final bool parcelDropoff;

  /// The label sent to the API. Stored labels stay in English, like the rest
  /// of the legacy records.
  String get label => nameEn;

  String displayName({required bool arabic}) =>
      arabic && nameAr.trim().isNotEmpty ? nameAr : nameEn;

  factory CorridorPlace.fromJson(Map<String, dynamic> json) => CorridorPlace(
    key: _string(json, 'stop_key'),
    nameAr: _string(json, 'name_ar'),
    nameEn: _string(json, 'name_en'),
    lat: _double(json, 'latitude'),
    lng: _double(json, 'longitude'),
    passengerPickup: json['passenger_pickup'] == true,
    passengerDropoff: json['passenger_dropoff'] == true,
    parcelPickup: json['parcel_pickup'] == true,
    parcelDropoff: json['parcel_dropoff'] == true,
  );
}

/// The ends of a legacy driver route, exactly as the server locks them.
class CorridorDriverRoute {
  const CorridorDriverRoute({
    required this.originLabel,
    required this.originLat,
    required this.originLng,
    required this.destinationLabel,
    required this.destinationLat,
    required this.destinationLng,
  });

  final String originLabel;
  final double originLat;
  final double originLng;
  final String destinationLabel;
  final double destinationLat;
  final double destinationLng;

  factory CorridorDriverRoute.fromJson(Map<String, dynamic> json) =>
      CorridorDriverRoute(
        originLabel: _string(json, 'origin_label'),
        originLat: _double(json, 'origin_lat'),
        originLng: _double(json, 'origin_lng'),
        destinationLabel: _string(json, 'destination_label'),
        destinationLat: _double(json, 'destination_lat'),
        destinationLng: _double(json, 'destination_lng'),
      );
}

/// The single corridor the legacy passenger, driver and merchant flows use.
class LegacyCorridor {
  const LegacyCorridor({
    required this.key,
    required this.nameEn,
    required this.driverRoute,
    required this.stops,
    this.nameAr,
  });

  final String key;
  final String? nameAr;
  final String nameEn;
  final CorridorDriverRoute driverRoute;

  /// Active stops in route order. Empty when the corridor is not published.
  final List<CorridorPlace> stops;

  List<CorridorPlace> get passengerPickups =>
      stops.where((stop) => stop.passengerPickup).toList(growable: false);
  List<CorridorPlace> get passengerDropoffs =>
      stops.where((stop) => stop.passengerDropoff).toList(growable: false);
  List<CorridorPlace> get parcelPickups =>
      stops.where((stop) => stop.parcelPickup).toList(growable: false);
  List<CorridorPlace> get parcelDropoffs =>
      stops.where((stop) => stop.parcelDropoff).toList(growable: false);

  /// The corridor's display name; null Arabic falls back to the English name.
  String displayName({required bool arabic}) {
    final ar = nameAr;
    return arabic && ar != null && ar.trim().isNotEmpty ? ar : nameEn;
  }

  factory LegacyCorridor.fromJson(Map<String, dynamic> json) {
    final route = json['driver_route'];
    final stops = json['stops'];
    if (route is! Map<String, dynamic> || stops is! List) {
      throw const FormatException('Invalid legacy corridor');
    }
    final nameAr = json['name_ar'];
    return LegacyCorridor(
      key: _string(json, 'key'),
      nameAr: nameAr is String ? nameAr : null,
      nameEn: _string(json, 'name_en'),
      driverRoute: CorridorDriverRoute.fromJson(route),
      stops: List.unmodifiable(
        stops.map((value) {
          if (value is! Map<String, dynamic>) {
            throw const FormatException('Invalid corridor stop');
          }
          return CorridorPlace.fromJson(value);
        }),
      ),
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
