import '../../../core/fares/fare.dart';

/// One end of an operating route: a city, as served by
/// `GET /operating-routes`.
class RouteCity {
  const RouteCity({
    required this.id,
    required this.nameAr,
    required this.nameEn,
    required this.lat,
    required this.lng,
  });

  final String id;
  final String nameAr;
  final String nameEn;

  /// The city's reference point. Orders keep it for maps and matching; the
  /// exact place is the text the user types.
  final double lat;
  final double lng;

  String displayName({required bool arabic}) =>
      arabic && nameAr.trim().isNotEmpty ? nameAr : nameEn;

  factory RouteCity.fromJson(Map<String, dynamic> json) => RouteCity(
    id: _string(json, 'id'),
    nameAr: _string(json, 'name_ar'),
    nameEn: _string(json, 'name_en'),
    lat: _double(json, 'latitude'),
    lng: _double(json, 'longitude'),
  );
}

/// A predefined route ("Hebron → Bethlehem") that passengers, merchants and
/// drivers choose. Every order names one route and adds the exact pickup and
/// drop-off as free text.
class OperatingRoute {
  const OperatingRoute({
    required this.id,
    required this.key,
    required this.nameAr,
    required this.nameEn,
    required this.origin,
    required this.destination,
    this.fares,
  });

  /// The service route id sent as `service_route_id`.
  final String id;
  final String key;
  final String nameAr;
  final String nameEn;
  final RouteCity origin;
  final RouteCity destination;

  /// The route's default prices and the range a driver may charge within;
  /// null until an admin sets prices (or when they cannot be read).
  final RouteFares? fares;

  String displayName({required bool arabic}) =>
      arabic && nameAr.trim().isNotEmpty ? nameAr : nameEn;

  factory OperatingRoute.fromJson(Map<String, dynamic> json) {
    final origin = json['origin'];
    final destination = json['destination'];
    if (origin is! Map<String, dynamic> ||
        destination is! Map<String, dynamic>) {
      throw const FormatException('Invalid route ends');
    }
    return OperatingRoute(
      id: _string(json, 'id'),
      key: _string(json, 'route_key'),
      nameAr: _string(json, 'name_ar'),
      nameEn: _string(json, 'name_en'),
      origin: RouteCity.fromJson(origin),
      destination: RouteCity.fromJson(destination),
      fares: RouteFares.tryParse(json['fares']),
    );
  }
}

/// Limits shared by every "details" text field (pickup and drop-off).
const routeDetailsMaxLength = 300;

/// Parses `{"routes": [...]}`. A malformed route is an error, not skipped, so
/// the app never offers a route the server would read differently.
List<OperatingRoute> parseOperatingRoutes(Map<String, dynamic> json) {
  final raw = json['routes'];
  if (raw is! List) throw const FormatException('Invalid routes');
  return List.unmodifiable([
    for (final item in raw)
      if (item is Map<String, dynamic>)
        OperatingRoute.fromJson(item)
      else
        throw const FormatException('Invalid route'),
  ]);
}

String _string(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! String || value.trim().isEmpty) {
    throw FormatException('Invalid $key');
  }
  return value.trim();
}

double _double(Map<String, dynamic> json, String key) {
  final value = json[key];
  final number = value is num
      ? value.toDouble()
      : value is String
      ? double.tryParse(value)
      : null;
  if (number == null || !number.isFinite) {
    throw FormatException('Invalid $key');
  }
  return number;
}
