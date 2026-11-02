import 'dart:math' as math;

/// Module 09 - on-device privacy geofencing.
///
/// The driver's raw GPS NEVER leaves the phone: this runs locally and only one
/// of four discrete milestone signals (or a tamper block) is allowed to reach
/// the server. Parity with apps/api/ai_services/logistics_math.py is enforced
/// by test/ai_ui_directives_test.dart.
enum EdgeMilestone { dispatch, pickup, transit, destination }

enum EdgeSignal {
  dispatchInitiated,
  pickupGeofenceTriggered,
  transitInProgress,
  destinationGeofenceTriggered,
  silentHold,
  securityTamperingBlocked,
}

class EdgeGeofenceResult {
  const EdgeGeofenceResult({
    required this.signal,
    required this.cloudUpdateAllowed,
    this.localDistanceMeters,
  });

  final EdgeSignal signal;
  final bool cloudUpdateAllowed;

  /// Computed and kept locally; never serialise this into a network payload.
  final double? localDistanceMeters;
}

const double geofenceRadiusMeters = 100.0;

/// (minLat, minLon, maxLat, maxLon). Negative or far-away fixes are treated as
/// spoofed for this Palestine-only deployment.
const List<double> operatingRegionBbox = [29.0, 33.5, 33.5, 36.5];

bool _insideRegion(double lat, double lon) =>
    lat.isFinite &&
    lon.isFinite &&
    lat >= operatingRegionBbox[0] &&
    lat <= operatingRegionBbox[2] &&
    lon >= operatingRegionBbox[1] &&
    lon <= operatingRegionBbox[3];

double haversineMeters(double lat1, double lon1, double lat2, double lon2) {
  const radius = 6371000.0;
  double rad(double d) => d * math.pi / 180.0;
  final dPhi = rad(lat2 - lat1);
  final dLambda = rad(lon2 - lon1);
  final a =
      math.pow(math.sin(dPhi / 2), 2) +
      math.cos(rad(lat1)) *
          math.cos(rad(lat2)) *
          math.pow(math.sin(dLambda / 2), 2);
  return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
}

EdgeGeofenceResult evaluateEdgeGeofence({
  required double driverLat,
  required double driverLon,
  required double centerLat,
  required double centerLon,
  required EdgeMilestone milestone,
}) {
  if (!_insideRegion(driverLat, driverLon) ||
      !_insideRegion(centerLat, centerLon)) {
    return const EdgeGeofenceResult(
      signal: EdgeSignal.securityTamperingBlocked,
      cloudUpdateAllowed: false,
    );
  }
  final distance = double.parse(
    haversineMeters(driverLat, driverLon, centerLat, centerLon)
        .toStringAsFixed(2),
  );
  final inside = distance <= geofenceRadiusMeters;
  switch (milestone) {
    case EdgeMilestone.dispatch:
      return EdgeGeofenceResult(
        signal: EdgeSignal.dispatchInitiated,
        cloudUpdateAllowed: true,
        localDistanceMeters: distance,
      );
    case EdgeMilestone.transit:
      return EdgeGeofenceResult(
        signal: EdgeSignal.transitInProgress,
        cloudUpdateAllowed: true,
        localDistanceMeters: distance,
      );
    case EdgeMilestone.pickup:
      return EdgeGeofenceResult(
        signal: inside
            ? EdgeSignal.pickupGeofenceTriggered
            : EdgeSignal.silentHold,
        cloudUpdateAllowed: inside,
        localDistanceMeters: distance,
      );
    case EdgeMilestone.destination:
      return EdgeGeofenceResult(
        signal: inside
            ? EdgeSignal.destinationGeofenceTriggered
            : EdgeSignal.silentHold,
        cloudUpdateAllowed: inside,
        localDistanceMeters: distance,
      );
  }
}
