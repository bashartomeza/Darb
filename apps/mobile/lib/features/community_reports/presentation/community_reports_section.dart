import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart' show TileProvider;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/location/location_service.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/theme/semantic_colors.dart';
import '../../../core/widgets/foreground_refresh.dart';
import '../../../core/widgets/darb_bottom_nav.dart';
import '../../../core/widgets/darb_map.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/maps/checkpoint_map_markers.dart';
import '../../../core/maps/service_area.dart';
import '../../canonical_routes/domain/canonical_route_models.dart';
import '../../checkpoints/domain/checkpoint_models.dart';
import '../application/community_reports_controller.dart';
import '../data/community_report_models.dart';

String communityCategoryLabel(
  AppLocalizations l10n,
  CommunityReportCategory category,
) => switch (category) {
  CommunityReportCategory.roadClosure => l10n.communityCategoryRoadClosure,
  CommunityReportCategory.roadReopened => l10n.communityCategoryRoadReopened,
  CommunityReportCategory.roadCongestion =>
    l10n.communityCategoryRoadCongestion,
  CommunityReportCategory.checkpointOpenMarkedClosed =>
    l10n.communityCategoryCheckpointOpenMarkedClosed,
  CommunityReportCategory.checkpointClosedMarkedOpen =>
    l10n.communityCategoryCheckpointClosedMarkedOpen,
  CommunityReportCategory.checkpointOutdated =>
    l10n.communityCategoryCheckpointOutdated,
  CommunityReportCategory.safetyAlert => l10n.communityCategorySafetyAlert,
  CommunityReportCategory.driverReport => l10n.communityCategoryDriverReport,
  CommunityReportCategory.incorrectMapInfo =>
    l10n.communityCategoryIncorrectMapInfo,
  CommunityReportCategory.other => l10n.communityCategoryOther,
};

String communityGroupLabel(AppLocalizations l10n, CommunityReportGroup group) =>
    switch (group) {
      CommunityReportGroup.road => l10n.communityGroupRoad,
      CommunityReportGroup.checkpoint => l10n.communityGroupCheckpoint,
      CommunityReportGroup.safety => l10n.communityGroupSafety,
      CommunityReportGroup.other => l10n.communityGroupOther,
    };

String communityTimeAgo(
  AppLocalizations l10n,
  DateTime createdAt,
  DateTime now,
) {
  final age = now.difference(createdAt);
  if (age.inMinutes < 1) return l10n.communityJustNow;
  if (age.inHours < 1) return l10n.communityMinutesAgo(age.inMinutes);
  if (age.inDays < 1) return l10n.communityHoursAgo(age.inHours);
  return l10n.communityDaysAgo(age.inDays);
}

Color communityGroupColor(CommunityReportGroup group) => switch (group) {
  CommunityReportGroup.road => SemanticColors.warning,
  CommunityReportGroup.checkpoint => SemanticColors.info,
  CommunityReportGroup.safety => SemanticColors.error,
  CommunityReportGroup.other => SemanticColors.pending,
};

/// Map pins for reports that carry a location. Labels repeat the category and
/// place only, never the free-text description, and flag the report as
/// unverified. Disputed reports are drawn faded; well-supported ones get a
/// badge. Reports outside the service area are not drawn.
List<DarbMapMarker> communityReportMarkers(
  AppLocalizations l10n,
  List<CommunityReport> reports, {
  DateTime? now,
}) {
  final at = now ?? DateTime.now();
  return [
    for (final report in reports)
      if (report.hasLocation &&
          DarbServiceArea.contains(report.latitude!, report.longitude!))
        _reportMarker(l10n, report, report.badges(at)),
  ];
}

DarbMapMarker _reportMarker(
  AppLocalizations l10n,
  CommunityReport report,
  Set<CommunityReportBadge> badges,
) {
  final disputed = badges.contains(CommunityReportBadge.disputed);
  final supported = badges.contains(CommunityReportBadge.wellSupported);
  return DarbMapMarker(
    position: GeoPoint(report.latitude!, report.longitude!),
    icon: report.category.icon,
    color: communityGroupColor(report.category.group),
    type: DarbMapMarkerType.report,
    dimmed: disputed,
    badgeIcon: supported ? Icons.verified_rounded : null,
    label: [
      '${l10n.communityUnverifiedPrefix}'
          '${communityCategoryLabel(l10n, report.category)} - '
          '${report.locationName}',
      if (disputed) l10n.communityBadgeDisputed,
      if (supported) l10n.communityBadgeWellSupported,
    ].join('\n'),
    size: 30,
  );
}

/// How close a checkpoint-related report must be to count for a checkpoint.
const communityCheckpointRadiusMeters = 300.0;

/// Reports older than this no longer describe a checkpoint's current state.
const communityCheckpointMaxAge = Duration(hours: 6);

/// What recent, not-disputed community reports within 300 m say about each
/// checkpoint, keyed by checkpoint id. Votes and reports never change the
/// official status; this is only shown next to it.
Map<String, CheckpointCommunityNote> communityCheckpointNotes(
  Iterable<Checkpoint> checkpoints,
  List<CommunityReport> reports, {
  DateTime? now,
}) {
  final at = now ?? DateTime.now();
  const distance = Distance();
  final relevant = [
    for (final report in reports)
      if (report.hasLocation &&
          _claimFor(report.category) != null &&
          at.difference(report.createdAt) <= communityCheckpointMaxAge &&
          !report.badges(at).contains(CommunityReportBadge.disputed))
        report,
  ]..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  final notes = <String, CheckpointCommunityNote>{};
  for (final checkpoint in checkpoints) {
    final here = LatLng(
      checkpoint.position.latitude,
      checkpoint.position.longitude,
    );
    for (final report in relevant) {
      final meters = distance.as(
        LengthUnit.Meter,
        here,
        LatLng(report.latitude!, report.longitude!),
      );
      if (meters > communityCheckpointRadiusMeters) continue;
      notes[checkpoint.id] = CheckpointCommunityNote(
        claim: _claimFor(report.category)!,
        wellSupported: report
            .badges(at)
            .contains(CommunityReportBadge.wellSupported),
      );
      break; // The most recent nearby report speaks for the community.
    }
  }
  return notes;
}

CommunityCheckpointClaim? _claimFor(CommunityReportCategory category) =>
    switch (category) {
      // "Open but marked closed": people there say it is open.
      CommunityReportCategory.checkpointOpenMarkedClosed =>
        CommunityCheckpointClaim.open,
      CommunityReportCategory.checkpointClosedMarkedOpen =>
        CommunityCheckpointClaim.closed,
      CommunityReportCategory.checkpointOutdated =>
        CommunityCheckpointClaim.outdated,
      CommunityReportCategory.roadClosure => CommunityCheckpointClaim.closed,
      CommunityReportCategory.roadCongestion =>
        CommunityCheckpointClaim.congested,
      CommunityReportCategory.roadReopened => CommunityCheckpointClaim.open,
      _ => null,
    };

/// Community reports list with filters, votes and a submit sheet.
class CommunityReportsSection extends ConsumerStatefulWidget {
  const CommunityReportsSection({super.key});

  @override
  ConsumerState<CommunityReportsSection> createState() =>
      _CommunityReportsSectionState();
}

class _CommunityReportsSectionState
    extends ConsumerState<CommunityReportsSection> {
  CommunityReportGroup? _group;
  CommunityReportSort _sort = CommunityReportSort.recent;

  Future<void> _add() => showDarbBottomSheet<void>(
    context: context,
    child: const CommunityReportForm(),
  );

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final reports = ref.watch(communityReportsProvider);

    return ForegroundRefresh(
      refresh: () => ref.read(communityReportsProvider.notifier).refresh(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.communityReportsTitle, style: theme.textTheme.titleMedium),
          const SizedBox(height: AppTokens.spaceExtraSmall),
          Text(
            l10n.communityReportsNote,
            key: const ValueKey('communityNote'),
            style: theme.textTheme.bodySmall?.copyWith(
              color: AppTheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          FilledButton.icon(
            key: const ValueKey('communityAdd'),
            onPressed: _add,
            icon: const Icon(Icons.add_rounded),
            label: Text(l10n.communityReportsAdd),
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          Wrap(
            spacing: AppTokens.spaceSmall,
            children: [
              ChoiceChip(
                key: const ValueKey('communityGroup-all'),
                label: Text(l10n.communityFilterAll),
                selected: _group == null,
                onSelected: (_) => setState(() => _group = null),
              ),
              for (final group in CommunityReportGroup.values)
                ChoiceChip(
                  key: ValueKey('communityGroup-${group.name}'),
                  label: Text(communityGroupLabel(l10n, group)),
                  selected: _group == group,
                  onSelected: (_) => setState(() => _group = group),
                ),
            ],
          ),
          Wrap(
            spacing: AppTokens.spaceSmall,
            children: [
              for (final sort in CommunityReportSort.values)
                ChoiceChip(
                  key: ValueKey('communitySort-${sort.name}'),
                  label: Text(switch (sort) {
                    CommunityReportSort.recent => l10n.communitySortRecent,
                    CommunityReportSort.top => l10n.communitySortTop,
                    CommunityReportSort.disputed => l10n.communitySortDisputed,
                  }),
                  selected: _sort == sort,
                  onSelected: (_) => setState(() => _sort = sort),
                ),
            ],
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          reports.when(
            loading: () => const Padding(
              padding: EdgeInsets.all(AppTokens.spaceMedium),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (_, _) => Column(
              children: [
                Text(
                  l10n.communityReportsLoadFailed,
                  key: const ValueKey('communityLoadFailed'),
                ),
                TextButton(
                  onPressed: () => ref.invalidate(communityReportsProvider),
                  child: Text(l10n.retry),
                ),
              ],
            ),
            data: (data) {
              final shown = arrangeReports(data, group: _group, sort: _sort);
              if (shown.isEmpty) {
                return Padding(
                  padding: const EdgeInsets.all(AppTokens.spaceMedium),
                  child: Text(
                    l10n.communityReportsEmpty,
                    key: const ValueKey('communityEmpty'),
                    textAlign: TextAlign.center,
                  ),
                );
              }
              return Column(
                children: [
                  for (final report in shown.take(30))
                    CommunityReportCard(
                      key: ValueKey('communityReport-${report.id}'),
                      report: report,
                    ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class CommunityReportCard extends ConsumerWidget {
  const CommunityReportCard({required this.report, super.key});

  final CommunityReport report;

  Future<void> _vote(BuildContext context, WidgetRef ref, int value) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(communityReportsProvider.notifier).vote(report, value);
    } catch (_) {
      messenger.showSnackBar(SnackBar(content: Text(l10n.communityVoteFailed)));
    }
  }

  Future<void> _flag(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(communityReportsProvider.notifier).flag(report);
      messenger.showSnackBar(SnackBar(content: Text(l10n.communityFlagged)));
    } catch (_) {
      messenger.showSnackBar(SnackBar(content: Text(l10n.communityFlagFailed)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final now = DateTime.now();
    final category = report.category;
    final color = communityGroupColor(category.group);
    final badges = report.badges(now);
    final title = communityCategoryLabel(l10n, category);

    return Card(
      margin: const EdgeInsets.only(bottom: AppTokens.spaceSmall),
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.gutterMobile),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(category.icon, color: color),
                const SizedBox(width: AppTokens.spaceSmall),
                Expanded(
                  child: Text(
                    category.sensitive
                        ? '${l10n.communityUnverifiedPrefix}$title'
                        : title,
                    style: theme.textTheme.titleSmall,
                  ),
                ),
                if (!report.isMine)
                  IconButton(
                    key: ValueKey('communityFlag-${report.id}'),
                    tooltip: l10n.communityFlag,
                    icon: const Icon(Icons.outlined_flag_rounded),
                    onPressed: () => _flag(context, ref),
                  ),
              ],
            ),
            Text(report.description, style: theme.textTheme.bodyMedium),
            const SizedBox(height: AppTokens.spaceExtraSmall),
            Text(
              '${report.locationName} - '
              '${communityTimeAgo(l10n, report.createdAt, now)}',
              style: theme.textTheme.bodySmall?.copyWith(
                color: AppTheme.onSurfaceVariant,
              ),
            ),
            if (badges.isNotEmpty || report.awaitingAdminReview)
              Padding(
                padding: const EdgeInsets.only(top: AppTokens.spaceSmall),
                child: Wrap(
                  spacing: AppTokens.spaceSmall,
                  runSpacing: AppTokens.spaceExtraSmall,
                  children: [
                    for (final badge in badges) _BadgeChip(badge: badge),
                    if (report.awaitingAdminReview)
                      _Pill(
                        key: ValueKey('communityReview-${report.id}'),
                        label: l10n.communityAwaitingReview,
                        background: SemanticColors.pendingContainer,
                        foreground: SemanticColors.onPendingContainer,
                      ),
                  ],
                ),
              ),
            Row(
              children: [
                _VoteButton(
                  key: ValueKey('communityUp-${report.id}'),
                  icon: Icons.thumb_up_alt_outlined,
                  activeIcon: Icons.thumb_up_alt_rounded,
                  tooltip: l10n.communityUpvote,
                  count: report.upvotes,
                  active: report.myVote == 1,
                  onPressed: report.isMine
                      ? null
                      : () => _vote(context, ref, 1),
                ),
                const SizedBox(width: AppTokens.spaceSmall),
                _VoteButton(
                  key: ValueKey('communityDown-${report.id}'),
                  icon: Icons.thumb_down_alt_outlined,
                  activeIcon: Icons.thumb_down_alt_rounded,
                  tooltip: l10n.communityDownvote,
                  count: report.downvotes,
                  active: report.myVote == -1,
                  onPressed: report.isMine
                      ? null
                      : () => _vote(context, ref, -1),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _VoteButton extends StatelessWidget {
  const _VoteButton({
    required this.icon,
    required this.activeIcon,
    required this.tooltip,
    required this.count,
    required this.active,
    required this.onPressed,
    super.key,
  });

  final IconData icon;
  final IconData activeIcon;
  final String tooltip;
  final int count;
  final bool active;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return TextButton.icon(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        minimumSize: const Size(AppTokens.minTouchTarget, 40),
        foregroundColor: active ? AppTheme.primaryText : AppTheme.onSurface,
      ),
      icon: Icon(active ? activeIcon : icon, semanticLabel: tooltip),
      label: Text('$count'),
    );
  }
}

class _BadgeChip extends StatelessWidget {
  const _BadgeChip({required this.badge});

  final CommunityReportBadge badge;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final (label, background, foreground) = switch (badge) {
      CommunityReportBadge.recent => (
        l10n.communityBadgeRecent,
        SemanticColors.infoContainer,
        SemanticColors.onInfoContainer,
      ),
      CommunityReportBadge.disputed => (
        l10n.communityBadgeDisputed,
        SemanticColors.warningContainer,
        SemanticColors.onWarningContainer,
      ),
      CommunityReportBadge.wellSupported => (
        l10n.communityBadgeWellSupported,
        SemanticColors.successContainer,
        SemanticColors.onSuccessContainer,
      ),
    };
    return _Pill(
      key: ValueKey('communityBadge-${badge.name}'),
      label: label,
      background: background,
      foreground: foreground,
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({
    required this.label,
    required this.background,
    required this.foreground,
    super.key,
  });

  final String label;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(AppTokens.radiusFull),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
          color: foreground,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

/// Submit sheet. Sensitive categories show a reminder to describe only what was
/// seen, and the server never returns the author or any driver details.
///
/// The place is chosen by tapping the small map or with the current location,
/// and must be inside Darb's service area. Map-related categories cannot be
/// sent without one; driver and "other" reports may be.
class CommunityReportForm extends ConsumerStatefulWidget {
  const CommunityReportForm({this.initialPoint, this.tileProvider, super.key});

  /// Pre-selected place, e.g. where the user long-pressed a map.
  final GeoPoint? initialPoint;

  /// Tests pass a fake tile source.
  final TileProvider? tileProvider;

  @override
  ConsumerState<CommunityReportForm> createState() =>
      _CommunityReportFormState();
}

class _CommunityReportFormState extends ConsumerState<CommunityReportForm> {
  final _description = TextEditingController();
  final _location = TextEditingController();
  CommunityReportCategory _category = CommunityReportCategory.roadCongestion;
  GeoPoint? _point;
  bool _locating = false;
  bool _submitting = false;
  String? _error;
  String? _locationError;

  @override
  void initState() {
    super.initState();
    final initial = widget.initialPoint;
    if (initial != null &&
        DarbServiceArea.contains(initial.latitude, initial.longitude)) {
      _point = initial;
    }
  }

  @override
  void dispose() {
    _description.dispose();
    _location.dispose();
    super.dispose();
  }

  bool get _locationMissing => _category.requiresLocation && _point == null;

  bool get _valid =>
      _description.text.trim().length >= communityReportDescriptionMinLength &&
      _location.text.trim().length >= 2 &&
      !_locationMissing;

  void _setPoint(LatLng point) {
    final l10n = AppLocalizations.of(context);
    setState(() {
      if (DarbServiceArea.containsLatLng(point)) {
        _point = GeoPoint(point.latitude, point.longitude);
        _locationError = null;
      } else {
        _locationError = l10n.communityLocationOutside;
      }
    });
  }

  Future<void> _useCurrentLocation() async {
    final l10n = AppLocalizations.of(context);
    setState(() {
      _locating = true;
      _locationError = null;
    });
    await ref.read(currentPositionProvider.notifier).refresh();
    if (!mounted) return;
    final here = ref.read(currentPositionProvider).value;
    setState(() {
      _locating = false;
      if (here == null) {
        _locationError = l10n.communityLocationUnavailable;
      } else if (!DarbServiceArea.contains(here.latitude, here.longitude)) {
        // e.g. an emulator's default position abroad: never sent as a place.
        _locationError = l10n.communityLocationOutside;
      } else {
        _point = here;
      }
    });
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final point = _point;
      await ref
          .read(communityReportsProvider.notifier)
          .submit(
            category: _category,
            description: _description.text,
            locationName: _location.text,
            latitude: point?.latitude,
            longitude: point?.longitude,
          );
      messenger.showSnackBar(SnackBar(content: Text(l10n.communitySubmitted)));
      navigator.pop();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = error is ApiException && error.statusCode == 429
            ? l10n.communityTooMany
            : l10n.communitySubmitFailed;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final point = _point;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(l10n.communitySheetTitle, style: theme.textTheme.titleLarge),
        const SizedBox(height: AppTokens.spaceSmall),
        Text(l10n.communityFieldCategory, style: theme.textTheme.labelLarge),
        Wrap(
          spacing: AppTokens.spaceSmall,
          children: [
            for (final category in CommunityReportCategory.values)
              ChoiceChip(
                key: ValueKey('communityCategory-${category.apiValue}'),
                label: Text(communityCategoryLabel(l10n, category)),
                selected: _category == category,
                onSelected: _submitting
                    ? null
                    : (_) => setState(() => _category = category),
              ),
          ],
        ),
        if (_category.sensitive) ...[
          const SizedBox(height: AppTokens.spaceSmall),
          Text(
            l10n.communitySensitiveNote,
            key: const ValueKey('communitySensitiveNote'),
            style: theme.textTheme.bodySmall?.copyWith(
              color: SemanticColors.onWarningContainer,
            ),
          ),
        ],
        const SizedBox(height: AppTokens.spaceMedium),
        TextField(
          key: const ValueKey('communityDescription'),
          controller: _description,
          enabled: !_submitting,
          maxLines: 3,
          maxLength: communityReportDescriptionMaxLength,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            labelText: l10n.communityFieldDescription,
            border: const OutlineInputBorder(),
          ),
        ),
        TextField(
          key: const ValueKey('communityLocation'),
          controller: _location,
          enabled: !_submitting,
          maxLength: 120,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            labelText: l10n.communityFieldLocation,
            border: const OutlineInputBorder(),
          ),
        ),
        Text(
          _category.requiresLocation
              ? l10n.communityPickLocation
              : '${l10n.communityLocationOptional} - ${l10n.communityPickLocation}',
          key: const ValueKey('communityPickHint'),
          style: theme.textTheme.labelLarge,
        ),
        const SizedBox(height: AppTokens.spaceExtraSmall),
        DarbMap(
          key: const ValueKey('communityLocationMap'),
          height: 200,
          emptyLabel: l10n.communityPickLocation,
          attributionLabel: l10n.mapAttribution,
          tileProvider: widget.tileProvider,
          interactive: !_submitting,
          onTap: _submitting ? null : _setPoint,
          markers: [
            if (point != null)
              DarbMapMarker(
                position: point,
                icon: _category.icon,
                color: communityGroupColor(_category.group),
                type: DarbMapMarkerType.destination,
                label: l10n.communityLocationSet,
                size: 30,
              ),
          ],
        ),
        Row(
          children: [
            Expanded(
              child: TextButton.icon(
                key: const ValueKey('communityUseMyLocation'),
                onPressed: _submitting || _locating
                    ? null
                    : _useCurrentLocation,
                icon: _locating
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.my_location_rounded),
                label: Text(l10n.communityUseMyLocation),
              ),
            ),
            if (point != null)
              TextButton(
                key: const ValueKey('communityClearLocation'),
                onPressed: _submitting
                    ? null
                    : () => setState(() => _point = null),
                child: Text(l10n.communityClearLocation),
              ),
          ],
        ),
        if (_locationError != null)
          Text(
            _locationError!,
            key: const ValueKey('communityLocationError'),
            style: TextStyle(color: theme.colorScheme.error),
          )
        else if (_locationMissing)
          Text(
            l10n.communityLocationRequired,
            key: const ValueKey('communityLocationRequired'),
            style: theme.textTheme.bodySmall?.copyWith(
              color: AppTheme.onSurfaceVariant,
            ),
          ),
        if (_error != null)
          Text(
            _error!,
            key: const ValueKey('communityError'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
        const SizedBox(height: AppTokens.spaceSmall),
        FilledButton(
          key: const ValueKey('communitySubmit'),
          onPressed: _valid && !_submitting ? _submit : null,
          child: _submitting
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(l10n.communitySubmit),
        ),
      ],
    );
  }
}
