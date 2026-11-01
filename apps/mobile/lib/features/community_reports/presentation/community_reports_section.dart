import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/location/location_service.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/theme/semantic_colors.dart';
import '../../../core/widgets/foreground_refresh.dart';
import '../../../core/widgets/masari_bottom_nav.dart';
import '../../../core/widgets/masari_map.dart';
import '../../canonical_routes/domain/canonical_route_models.dart';
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
/// unverified.
List<MasariMapMarker> communityReportMarkers(
  AppLocalizations l10n,
  List<CommunityReport> reports,
) {
  return [
    for (final report in reports)
      if (report.hasLocation)
        MasariMapMarker(
          position: GeoPoint(report.latitude!, report.longitude!),
          icon: report.category.icon,
          color: communityGroupColor(report.category.group),
          label:
              '${l10n.communityUnverifiedPrefix}'
              '${communityCategoryLabel(l10n, report.category)} - '
              '${report.locationName}',
          size: 30,
        ),
  ];
}

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

  Future<void> _add() => showMasariBottomSheet<void>(
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
class CommunityReportForm extends ConsumerStatefulWidget {
  const CommunityReportForm({super.key});

  @override
  ConsumerState<CommunityReportForm> createState() =>
      _CommunityReportFormState();
}

class _CommunityReportFormState extends ConsumerState<CommunityReportForm> {
  final _description = TextEditingController();
  final _location = TextEditingController();
  CommunityReportCategory _category = CommunityReportCategory.roadCongestion;
  bool _attach = false;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _description.dispose();
    _location.dispose();
    super.dispose();
  }

  bool get _valid =>
      _description.text.trim().length >= communityReportDescriptionMinLength &&
      _location.text.trim().length >= 2;

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      GeoPoint? point;
      if (_attach) {
        point = ref.read(currentPositionProvider).value;
      }
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
        SwitchListTile(
          key: const ValueKey('communityAttach'),
          contentPadding: EdgeInsets.zero,
          title: Text(l10n.communityAttachLocation),
          value: _attach,
          onChanged: _submitting ? null : (v) => setState(() => _attach = v),
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
