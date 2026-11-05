import 'package:flutter/foundation.dart';
import 'package:flutter_map/flutter_map.dart' show LatLngBounds;
import 'package:latlong2/latlong.dart';

import '../../canonical_routes/domain/canonical_route_models.dart';

/// A place of interest from `GET /map/places`.
@immutable
class MapPlace {
  const MapPlace({
    required this.id,
    required this.category,
    required this.position,
    this.nameAr,
    this.nameEn,
    this.phone,
    this.openingHours,
  });

  factory MapPlace.fromJson(Map<String, dynamic> json) {
    String? text(Object? value) =>
        value is String && value.trim().isNotEmpty ? value.trim() : null;
    return MapPlace(
      id: json['id'] as String,
      category: json['category'] as String,
      position: GeoPoint(
        (json['lat'] as num).toDouble(),
        (json['lng'] as num).toDouble(),
      ),
      nameAr: text(json['name_ar']),
      nameEn: text(json['name_en']),
      phone: text(json['phone']),
      openingHours: text(json['opening_hours']),
    );
  }

  final String id;
  final String category;
  final GeoPoint position;
  final String? nameAr;
  final String? nameEn;
  final String? phone;

  /// OpenStreetMap `opening_hours` text, shown as is when it cannot be read.
  final String? openingHours;

  /// The name in the reader's language, falling back to the other one.
  String? name({required bool arabic}) =>
      arabic ? (nameAr ?? nameEn) : (nameEn ?? nameAr);

  @override
  bool operator ==(Object other) =>
      other is MapPlace &&
      other.id == id &&
      other.category == category &&
      other.position == position &&
      other.nameAr == nameAr &&
      other.nameEn == nameEn &&
      other.phone == phone &&
      other.openingHours == openingHours;

  @override
  int get hashCode =>
      Object.hash(id, category, position, nameAr, nameEn, phone, openingHours);
}

/// A rectangle of the map, in degrees.
@immutable
class GeoBox {
  const GeoBox({
    required this.south,
    required this.west,
    required this.north,
    required this.east,
  });

  factory GeoBox.fromBounds(LatLngBounds bounds) => GeoBox(
    south: bounds.south,
    west: bounds.west,
    north: bounds.north,
    east: bounds.east,
  );

  /// A square of [halfSpan] degrees either side of [center].
  factory GeoBox.around(GeoPoint center, double halfSpan) => GeoBox(
    south: center.latitude - halfSpan,
    west: center.longitude - halfSpan,
    north: center.latitude + halfSpan,
    east: center.longitude + halfSpan,
  );

  final double south;
  final double west;
  final double north;
  final double east;

  GeoPoint get center => GeoPoint((south + north) / 2, (west + east) / 2);

  /// Grown to the [step]-degree grid and cut down to [maxSpan], so panning a
  /// little asks for the same box again (one request, and a cache hit on the
  /// server) and the box never exceeds what the API accepts.
  GeoBox snapped({double step = 0.05, double maxSpan = 0.9}) {
    double down(double v) => (v / step).floorToDouble() * step;
    double up(double v) => (v / step).ceilToDouble() * step;
    final c = center;
    var s = down(south), n = up(north), w = down(west), e = up(east);
    if (n - s > maxSpan) {
      s = down(c.latitude - maxSpan / 2);
      n = s + maxSpan;
    }
    if (e - w > maxSpan) {
      w = down(c.longitude - maxSpan / 2);
      e = w + maxSpan;
    }
    double r(double v) => double.parse(v.toStringAsFixed(4));
    return GeoBox(south: r(s), west: r(w), north: r(n), east: r(e));
  }

  /// The `bbox` query value: `south,west,north,east`.
  String get query => '$south,$west,$north,$east';

  @override
  bool operator ==(Object other) =>
      other is GeoBox &&
      other.south == south &&
      other.west == west &&
      other.north == north &&
      other.east == east;

  @override
  int get hashCode => Object.hash(south, west, north, east);

  @override
  String toString() => query;
}

/// What `GET /map/places` answered.
@immutable
class PlacesResult {
  const PlacesResult({required this.places, required this.truncated});

  factory PlacesResult.fromJson(Map<String, dynamic> json) {
    final raw = json['places'];
    return PlacesResult(
      places: [
        if (raw is List)
          for (final item in raw)
            if (item is Map<String, dynamic>) MapPlace.fromJson(item),
      ],
      truncated: json['truncated'] == true,
    );
  }

  static const empty = PlacesResult(places: [], truncated: false);

  final List<MapPlace> places;

  /// More places matched than were returned.
  final bool truncated;
}

const Distance _distance = Distance();

/// Straight-line distance between two points, in metres.
double distanceMetres(GeoPoint a, GeoPoint b) => _distance.as(
  LengthUnit.Meter,
  LatLng(a.latitude, a.longitude),
  LatLng(b.latitude, b.longitude),
);
