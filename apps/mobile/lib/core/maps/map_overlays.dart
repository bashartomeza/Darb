import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:darb_mobile/l10n/app_localizations.dart';

import '../api/api_error.dart';
import '../../features/canonical_routes/application/canonical_route_controller.dart';
import '../../features/checkpoints/application/checkpoint_controller.dart';
import '../../features/checkpoints/domain/checkpoint_models.dart';
import '../../features/community_reports/application/community_reports_controller.dart';
import '../../features/community_reports/data/community_report_models.dart';
import '../../features/community_reports/presentation/community_reports_section.dart';
import '../widgets/darb_map.dart';
import 'checkpoint_map_markers.dart';

/// The shared background layers of every Darb map: checkpoints (with what the
/// community says about them) and located community reports, plus honest
/// notes when a layer has no data.
class MapOverlay {
  const MapOverlay({
    required this.checkpointMarkers,
    required this.reportMarkers,
    required this.notes,
    required this.snapshot,
    required this.checkpointsAvailable,
  });

  final List<DarbMapMarker> checkpointMarkers;
  final List<DarbMapMarker> reportMarkers;

  /// E.g. "Checkpoint data unavailable", "barrier states may be out of date".
  final List<String> notes;

  final CheckpointSnapshot snapshot;

  /// Null while the server's capabilities are still loading.
  final bool? checkpointsAvailable;

  List<DarbMapMarker> get markers => [...checkpointMarkers, ...reportMarkers];
}

/// Reads the checkpoint and community layers for a map.
///
/// Checkpoints are requested only when the server says a source is
/// configured (`checkpoints_available`); otherwise the map says so instead of
/// staying silently empty. Community reports are read for the roles that may
/// read them (passengers and drivers).
MapOverlay watchMapOverlay(
  WidgetRef ref,
  AppLocalizations l10n, {
  bool includeReports = true,
}) {
  final capabilities = ref.watch(mobileCapabilitiesProvider);
  // Unknown while capabilities load; when they could not be read at all the
  // checkpoint endpoint itself is asked (it answers 404 when no source is on).
  final declared = capabilities.value?.checkpointsAvailable;
  final tryCheckpoints =
      declared == true || (capabilities.hasError && !capabilities.hasValue);

  var snapshot = CheckpointSnapshot.empty;
  bool? available = declared;
  final notes = <String>[];
  if (tryCheckpoints) {
    final checkpoints = ref.watch(checkpointsProvider);
    snapshot = checkpoints.value ?? CheckpointSnapshot.empty;
    final error = checkpoints.error;
    if (error != null && !checkpoints.hasValue) {
      final missing =
          error is ApiException &&
          (error.statusCode == 404 || error.statusCode == 403);
      if (missing) available = false;
      notes.add(
        missing
            ? l10n.mapCheckpointsUnavailable
            : l10n.mapCheckpointsLoadFailed,
      );
    } else if (checkpoints.hasValue) {
      available = true;
      if (snapshot.stale) notes.add(l10n.checkpointsStale);
    }
  } else if (declared == false) {
    notes.add(l10n.mapCheckpointsUnavailable);
  }

  final reports = includeReports
      ? watchCommunityReportsForMap(ref)
      : const <CommunityReport>[];

  return MapOverlay(
    checkpointMarkers: checkpointTrafficMarkers(
      snapshot.checkpoints,
      l10n: l10n,
      community: communityCheckpointNotes(snapshot.checkpoints, reports),
    ),
    reportMarkers: communityReportMarkers(l10n, reports),
    notes: notes,
    snapshot: snapshot,
    checkpointsAvailable: available,
  );
}
