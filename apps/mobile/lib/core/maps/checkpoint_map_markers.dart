import 'package:flutter/material.dart';

import '../../features/canonical_routes/domain/canonical_route_models.dart';
import '../../features/checkpoints/domain/checkpoint_models.dart';
import '../theme/semantic_colors.dart';
import '../widgets/darb_map.dart';

/// Colour for a checkpoint status: green open, red closed, orange moderate
/// congestion, neutral grey when the status is unknown.
Color checkpointStatusColor(CheckpointStatus status) => switch (status) {
  CheckpointStatus.open => SemanticColors.checkpointOpen,
  CheckpointStatus.congested => SemanticColors.checkpointCongested,
  CheckpointStatus.closed => SemanticColors.checkpointClosed,
  CheckpointStatus.unknown => const Color(0xFF64748B),
};

IconData checkpointStatusIcon(CheckpointStatus status) => switch (status) {
  CheckpointStatus.open => Icons.directions_car_rounded,
  CheckpointStatus.congested => Icons.traffic_rounded,
  CheckpointStatus.closed => Icons.car_crash_rounded,
  CheckpointStatus.unknown => Icons.signpost_rounded,
};

/// True when the checkpoint has a usable, in-range, non-null-island position.
bool hasValidCheckpointPosition(Checkpoint checkpoint) {
  final lat = checkpoint.position.latitude;
  final lng = checkpoint.position.longitude;
  return lat.isFinite &&
      lng.isFinite &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180 &&
      !(lat == 0 && lng == 0);
}

/// Markers for every checkpoint that can be drawn. Invalid entries are skipped
/// so one bad record never breaks the map. Shared by every map screen.
List<DarbMapMarker> checkpointTrafficMarkers(
  Iterable<Checkpoint> checkpoints,
) => [
  for (final checkpoint in checkpoints)
    if (hasValidCheckpointPosition(checkpoint))
      checkpointTrafficMarker(checkpoint),
];

/// Builds a visually distinct marker for a checkpoint and includes both
/// direction statuses in the information card shown when the marker is tapped.
DarbMapMarker checkpointTrafficMarker(Checkpoint checkpoint) {
  final entering = _normaliseStatus(checkpoint.enteringStatus);
  final leaving = _normaliseStatus(checkpoint.leavingStatus);

  // Use the most severe of the two directions to colour the marker.
  final status = checkpoint.status;

  return DarbMapMarker(
    position: GeoPoint(
      checkpoint.position.latitude,
      checkpoint.position.longitude,
    ),
    icon: checkpointStatusIcon(status),
    color: checkpointStatusColor(status),
    foreground: Colors.white,
    size: 40,
    type: DarbMapMarkerType.checkpoint,
    label: _buildLabel(checkpoint, entering: entering, leaving: leaving),
  );
}

String _buildLabel(
  Checkpoint checkpoint, {
  required String entering,
  required String leaving,
}) {
  final name = checkpoint.displayName;
  final city = checkpoint.city.trim();
  return [
    name,
    if (city.isNotEmpty) city,
    checkpointStatusLabel(checkpoint.status),
    'دخول: $entering',
    'خروج: $leaving',
  ].join('\n');
}

String _normaliseStatus(String? status) {
  final value = status?.trim();
  return value == null || value.isEmpty ? 'غير معروف' : value;
}
