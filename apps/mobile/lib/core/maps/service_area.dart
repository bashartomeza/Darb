import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

/// Where Darb operates: the single source for every map's default view, camera
/// limits and "is this point plausible" checks.
///
/// A point outside this box (an emulator's default GPS in California, a bad
/// record) is never used to place the camera; the map stays on Palestine.
/// The API applies the same box to community report locations
/// (apps/api/src/modules/communityReports.ts).
abstract final class DarbServiceArea {
  static const double minLatitude = 29.4;
  static const double maxLatitude = 33.4;
  static const double minLongitude = 34.2;
  static const double maxLongitude = 35.95;

  /// Hebron: the default view when there is nothing in the area to show.
  static const LatLng fallbackCenter = LatLng(31.5326, 35.0998);
  static const double fallbackZoom = 12;

  /// Zoom used when the map shows a single point.
  static const double singlePointZoom = 14;

  /// Furthest the user may zoom out: the whole service area stays readable.
  static const double minZoom = 7;
  static const double maxZoom = 18;

  static final LatLngBounds bounds = LatLngBounds(
    const LatLng(minLatitude, minLongitude),
    const LatLng(maxLatitude, maxLongitude),
  );

  /// Keeps the centre of the view inside the service area so the user cannot
  /// pan away and get lost.
  static final CameraConstraint cameraConstraint =
      CameraConstraint.containCenter(bounds: bounds);

  static bool contains(double latitude, double longitude) =>
      latitude.isFinite &&
      longitude.isFinite &&
      latitude >= minLatitude &&
      latitude <= maxLatitude &&
      longitude >= minLongitude &&
      longitude <= maxLongitude;

  static bool containsLatLng(LatLng point) =>
      contains(point.latitude, point.longitude);

  /// The points that may place the camera. Out-of-area or invalid points are
  /// dropped, never moved.
  static List<LatLng> inArea(Iterable<LatLng> points) => [
    for (final point in points)
      if (containsLatLng(point)) point,
  ];
}
