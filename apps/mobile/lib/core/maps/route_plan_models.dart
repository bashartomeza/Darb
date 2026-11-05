import '../../features/canonical_routes/domain/canonical_route_models.dart';
import '../../features/checkpoints/domain/checkpoint_models.dart';

/// How the server judged a route against live checkpoint status.
enum RoutePlanStatus {
  /// Nothing closed or congested on the route.
  clear,

  /// The fastest road passed a closed checkpoint; this route does not.
  reroutedClosed,

  /// The fastest road passed a congested checkpoint; this reasonable
  /// alternative does not.
  reroutedCongestion,

  /// Congestion on the route and no reasonable way around it.
  congestionWarning,

  /// Every known route passes a closed checkpoint.
  blocked,

  /// Checkpoint data was not available, so nothing was checked.
  unchecked,
}

RoutePlanStatus parseRoutePlanStatus(Object? value) => switch (value) {
  'clear' => RoutePlanStatus.clear,
  'rerouted_closed' => RoutePlanStatus.reroutedClosed,
  'rerouted_congestion' => RoutePlanStatus.reroutedCongestion,
  'congestion_warning' => RoutePlanStatus.congestionWarning,
  'blocked' => RoutePlanStatus.blocked,
  _ => RoutePlanStatus.unchecked,
};

/// A checkpoint the route passes or avoids.
class PlannedCheckpoint {
  const PlannedCheckpoint({
    required this.id,
    required this.position,
    required this.nameAr,
    this.nameEn = '',
    this.status = CheckpointStatus.unknown,
    this.positionApproximate = false,
  });

  final String id;
  final GeoPoint position;
  final String nameAr;
  final String nameEn;

  /// The status the decision used (unknown when the feed was out of date).
  final CheckpointStatus status;
  final bool positionApproximate;

  String get displayName => nameAr.trim().isNotEmpty
      ? nameAr.trim()
      : nameEn.trim().isNotEmpty
      ? nameEn.trim()
      : 'حاجز';

  static PlannedCheckpoint? tryParse(Object? value) {
    if (value is! Map<String, dynamic>) return null;
    final id = value['id'];
    final lat = value['latitude'];
    final lng = value['longitude'];
    if (id is! String || lat is! num || lng is! num) return null;
    return PlannedCheckpoint(
      id: id,
      position: GeoPoint(lat.toDouble(), lng.toDouble()),
      nameAr: value['name_ar'] is String ? value['name_ar'] as String : '',
      nameEn: value['name_en'] is String ? value['name_en'] as String : '',
      status: parseCheckpointStatus(
        value['status'] is String ? value['status'] as String : null,
      ),
      positionApproximate: value['position_approximate'] == true,
    );
  }
}

/// A road route chosen with live checkpoint status taken into account.
class RoutePlan {
  const RoutePlan({
    required this.points,
    required this.status,
    required this.distanceMeters,
    required this.durationSeconds,
    this.extraDistanceMeters = 0,
    this.extraDurationSeconds = 0,
    this.checkpointsOnRoute = const [],
    this.avoidedCheckpoints = const [],
    this.warnings = const [],
  });

  final List<GeoPoint> points;
  final RoutePlanStatus status;
  final double distanceMeters;
  final double durationSeconds;

  /// Extra cost compared to the engine's own fastest road.
  final double extraDistanceMeters;
  final double extraDurationSeconds;
  final List<PlannedCheckpoint> checkpointsOnRoute;
  final List<PlannedCheckpoint> avoidedCheckpoints;

  /// Server warning codes, e.g. `all_routes_closed`, `status_stale`.
  final List<String> warnings;

  bool hasWarning(String code) => warnings.contains(code);

  List<PlannedCheckpoint> get closedOnRoute => [
    for (final c in checkpointsOnRoute)
      if (c.status == CheckpointStatus.closed) c,
  ];

  List<PlannedCheckpoint> get congestedOnRoute => [
    for (final c in checkpointsOnRoute)
      if (c.status == CheckpointStatus.congested) c,
  ];

  /// Whole minutes of extra travel, rounded up; zero when not meaningful.
  int get extraMinutes =>
      extraDurationSeconds >= 60 ? (extraDurationSeconds / 60).ceil() : 0;

  factory RoutePlan.fromJson(Map<String, dynamic> json) {
    final plan = json['plan'];
    if (plan is! Map<String, dynamic>) {
      throw const FormatException('Invalid route plan');
    }
    final coordinates = plan['coordinates'];
    final distance = plan['distance_meters'];
    final duration = plan['duration_seconds'];
    if (coordinates is! List ||
        coordinates.length < 2 ||
        distance is! num ||
        duration is! num ||
        !distance.isFinite ||
        !duration.isFinite ||
        distance < 0 ||
        duration < 0) {
      throw const FormatException('Invalid route plan');
    }
    final points = <GeoPoint>[];
    for (final pair in coordinates) {
      if (pair is! List ||
          pair.length < 2 ||
          pair[0] is! num ||
          pair[1] is! num) {
        throw const FormatException('Invalid route plan coordinate');
      }
      final lng = (pair[0] as num).toDouble();
      final lat = (pair[1] as num).toDouble();
      if (!lat.isFinite || !lng.isFinite || lat.abs() > 90 || lng.abs() > 180) {
        throw const FormatException('Invalid route plan coordinate');
      }
      points.add(GeoPoint(lat, lng));
    }
    List<PlannedCheckpoint> parseAll(Object? raw) => [
      if (raw is List)
        for (final value in raw) ?PlannedCheckpoint.tryParse(value),
    ];
    num number(Object? value) => value is num && value.isFinite ? value : 0;
    final warnings = plan['warnings'];
    return RoutePlan(
      points: List.unmodifiable(points),
      status: parseRoutePlanStatus(plan['status']),
      distanceMeters: distance.toDouble(),
      durationSeconds: duration.toDouble(),
      extraDistanceMeters: number(plan['extra_distance_meters']).toDouble(),
      extraDurationSeconds: number(plan['extra_duration_seconds']).toDouble(),
      checkpointsOnRoute: List.unmodifiable(
        parseAll(plan['checkpoints_on_route']),
      ),
      avoidedCheckpoints: List.unmodifiable(
        parseAll(plan['avoided_checkpoints']),
      ),
      warnings: List.unmodifiable([
        if (warnings is List)
          for (final w in warnings)
            if (w is String) w,
      ]),
    );
  }
}
