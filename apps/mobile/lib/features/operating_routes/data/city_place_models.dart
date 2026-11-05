/// A village or town inside one city of a route, as served by
/// `GET /operating-routes/:id/places`. Riders and senders pick one for the
/// pickup and one for the drop-off; the exact spot is the optional details.
class CityPlace {
  const CityPlace({
    required this.id,
    required this.nameAr,
    required this.nameEn,
    required this.lat,
    required this.lng,
    this.approximate = true,
  });

  final String id;
  final String nameAr;
  final String nameEn;
  final double lat;
  final double lng;

  /// True for a village-centre point; the exact spot is what the details say.
  final bool approximate;

  String displayName({required bool arabic}) =>
      arabic && nameAr.trim().isNotEmpty ? nameAr : nameEn;

  /// Whether [query] occurs in either name (case-insensitive).
  bool matches(String query) {
    final needle = query.trim().toLowerCase();
    if (needle.isEmpty) return true;
    return nameAr.toLowerCase().contains(needle) ||
        nameEn.toLowerCase().contains(needle);
  }

  factory CityPlace.fromJson(Map<String, dynamic> json) => CityPlace(
    id: _string(json, 'id'),
    nameAr: _string(json, 'name_ar'),
    nameEn: _string(json, 'name_en'),
    lat: _double(json, 'latitude'),
    lng: _double(json, 'longitude'),
    approximate: json['approximate'] is bool
        ? json['approximate'] as bool
        : true,
  );
}

/// The choices for one route: pickup places of its origin city and drop-off
/// places of its destination city. The reverse route lists them the other way
/// round, so the picker always follows the route the passenger chose.
class RoutePlaces {
  const RoutePlaces({
    required this.routeId,
    required this.pickup,
    required this.dropoff,
  });

  final String routeId;
  final List<CityPlace> pickup;
  final List<CityPlace> dropoff;

  factory RoutePlaces.fromJson(Map<String, dynamic> json) {
    List<CityPlace> places(String key) {
      final raw = json[key];
      if (raw is! List) throw FormatException('Invalid $key');
      return List.unmodifiable([
        for (final item in raw)
          if (item is Map<String, dynamic>)
            CityPlace.fromJson(item)
          else
            throw const FormatException('Invalid place'),
      ]);
    }

    return RoutePlaces(
      routeId: _string(json, 'route_id'),
      pickup: places('pickup_places'),
      dropoff: places('dropoff_places'),
    );
  }
}

/// The place name and the optional details as one line for lists and detail
/// screens: "Halhul · In front of the mosque", just the place, just the
/// details (an order from an older app build), or null when neither exists.
String? placeWithDetails({
  required bool arabic,
  String? nameAr,
  String? nameEn,
  String? details,
}) {
  final preferred = arabic ? nameAr : nameEn;
  final name = _clean(preferred) ?? _clean(nameEn) ?? _clean(nameAr);
  final extra = _clean(details);
  if (name != null && extra != null) return '$name · $extra';
  return name ?? extra;
}

String? _clean(String? value) {
  final trimmed = value?.trim();
  return trimmed == null || trimmed.isEmpty ? null : trimmed;
}

/// One end of an order as the server returned it: the chosen place (both
/// names), the optional details and, for orders from before places, a plain
/// label to fall back on.
class PlaceLine {
  const PlaceLine({this.nameAr, this.nameEn, this.details, this.fallback});

  /// Reads `<prefix>_place_name_ar`, `<prefix>_place_name_en` and
  /// `<prefix>_details` of an order JSON object.
  factory PlaceLine.fromJson(
    Map<String, dynamic> json,
    String prefix, {
    String? fallback,
  }) => PlaceLine(
    nameAr: optionalPlaceText(json['${prefix}_place_name_ar']),
    nameEn: optionalPlaceText(json['${prefix}_place_name_en']),
    details: optionalPlaceText(json['${prefix}_details']),
    fallback: fallback,
  );

  final String? nameAr;
  final String? nameEn;
  final String? details;
  final String? fallback;

  /// The place and details in the reading language, else the fallback label.
  String? text({required bool arabic}) =>
      placeWithDetails(
        arabic: arabic,
        nameAr: nameAr,
        nameEn: nameEn,
        details: details,
      ) ??
      fallback;
}

/// An optional text value of a JSON object: null when absent or blank.
String? optionalPlaceText(Object? value) =>
    value is String ? _clean(value) : null;

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
