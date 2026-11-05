import 'package:flutter/material.dart';

import 'package:darb_mobile/l10n/app_localizations.dart';

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
  CheckpointStatus.unknown => SemanticColors.checkpointUnknown,
};

IconData checkpointStatusIcon(CheckpointStatus status) => switch (status) {
  CheckpointStatus.open => Icons.directions_car_rounded,
  CheckpointStatus.congested => Icons.traffic_rounded,
  CheckpointStatus.closed => Icons.car_crash_rounded,
  CheckpointStatus.unknown => Icons.signpost_rounded,
};

/// What recent community reports near a checkpoint say. Unverified: it is
/// shown beside the official state and never replaces it.
enum CommunityCheckpointClaim { open, congested, closed, outdated }

class CheckpointCommunityNote {
  const CheckpointCommunityNote({
    required this.claim,
    this.wellSupported = false,
  });

  final CommunityCheckpointClaim claim;
  final bool wellSupported;

  Color get color => switch (claim) {
    CommunityCheckpointClaim.open => SemanticColors.checkpointOpen,
    CommunityCheckpointClaim.congested => SemanticColors.checkpointCongested,
    CommunityCheckpointClaim.closed => SemanticColors.checkpointClosed,
    CommunityCheckpointClaim.outdated => SemanticColors.pending,
  };

  String text(AppLocalizations l10n) =>
      l10n.checkpointCommunitySays(switch (claim) {
        CommunityCheckpointClaim.open => l10n.communityStatusOpen,
        CommunityCheckpointClaim.congested => l10n.checkpointCongested,
        CommunityCheckpointClaim.closed => l10n.communityStatusClosed,
        CommunityCheckpointClaim.outdated => l10n.communityStatusOutdated,
      });
}

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
///
/// [community] adds what nearby community reports say, keyed by checkpoint id;
/// [l10n] words the partner's "last changed" times and the community line.
List<DarbMapMarker> checkpointTrafficMarkers(
  Iterable<Checkpoint> checkpoints, {
  AppLocalizations? l10n,
  Map<String, CheckpointCommunityNote> community = const {},
}) => [
  for (final checkpoint in checkpoints)
    if (hasValidCheckpointPosition(checkpoint))
      checkpointTrafficMarker(
        checkpoint,
        l10n: l10n,
        community: community[checkpoint.id],
      ),
];

/// Builds a visually distinct marker for a checkpoint and includes both
/// direction statuses in the information card shown when the marker is tapped.
DarbMapMarker checkpointTrafficMarker(
  Checkpoint checkpoint, {
  AppLocalizations? l10n,
  CheckpointCommunityNote? community,
}) {
  // The official state colours the pin; the community only colours its ring.
  final status = checkpoint.status;
  final title = checkpoint.displayName;
  final details = _buildDetails(checkpoint, l10n: l10n, community: community);

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
    ringColor: community?.color,
    badgeIcon: community == null
        ? null
        : community.wellSupported
        ? Icons.verified_rounded
        : Icons.groups_rounded,
    label: [title, for (final detail in details) detail.text].join('\n'),
    details: details,
  );
}

/// The lines under a checkpoint's name in its callout. Entering and leaving
/// lines are tagged as such, so the map picks their icons from data.
List<DarbMapDetail> _buildDetails(
  Checkpoint checkpoint, {
  AppLocalizations? l10n,
  CheckpointCommunityNote? community,
}) {
  // Callers without a context (tests, background builders) keep Arabic, the
  // app's default language.
  final strings = l10n ?? lookupAppLocalizations(const Locale('ar'));
  final city = checkpoint.city.trim();
  final entering = checkpoint.enteringStatus?.trim();
  final leaving = checkpoint.leavingStatus?.trim();
  final enteringChanged = checkpoint.enteringLastChangedText;
  final leavingChanged = checkpoint.leavingLastChangedText;
  return [
    if (city.isNotEmpty) DarbMapDetail(city),
    if (l10n != null && checkpoint.status == CheckpointStatus.unknown)
      DarbMapDetail(
        l10n.checkpointOfficialUnknown,
        status: CheckpointStatus.unknown,
      )
    else
      DarbMapDetail(
        checkpointStatusLabel(strings, checkpoint.status),
        status: checkpoint.status,
      ),
    if (entering != null && entering.isNotEmpty)
      DarbMapDetail(
        strings.checkpointEnteringStatus(entering),
        kind: DarbMapDetailKind.entering,
        status: parseCheckpointStatus(entering),
      )
    else if (l10n != null && enteringChanged != null)
      DarbMapDetail(
        l10n.checkpointEnteringChanged(formatProviderTime(enteringChanged)),
        kind: DarbMapDetailKind.entering,
        status: CheckpointStatus.unknown,
      )
    else
      DarbMapDetail(
        strings.checkpointEnteringStatus(strings.checkpointStatusUnknown),
        kind: DarbMapDetailKind.entering,
        status: CheckpointStatus.unknown,
      ),
    if (leaving != null && leaving.isNotEmpty)
      DarbMapDetail(
        strings.checkpointLeavingStatus(leaving),
        kind: DarbMapDetailKind.leaving,
        status: parseCheckpointStatus(leaving),
      )
    else if (l10n != null && leavingChanged != null)
      DarbMapDetail(
        l10n.checkpointLeavingChanged(formatProviderTime(leavingChanged)),
        kind: DarbMapDetailKind.leaving,
        status: CheckpointStatus.unknown,
      )
    else
      DarbMapDetail(
        strings.checkpointLeavingStatus(strings.checkpointStatusUnknown),
        kind: DarbMapDetailKind.leaving,
        status: CheckpointStatus.unknown,
      ),
    if (l10n != null && community != null) DarbMapDetail(community.text(l10n)),
    if (l10n != null && checkpoint.positionFromOpenStreetMap)
      DarbMapDetail(l10n.checkpointPositionOsm),
    if (l10n != null && checkpoint.positionApproximate)
      DarbMapDetail(l10n.checkpointPositionApproximate),
  ];
}
