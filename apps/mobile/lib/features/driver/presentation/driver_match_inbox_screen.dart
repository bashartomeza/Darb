import '../../../core/widgets/foreground_refresh.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_section.dart';
import '../../../core/widgets/match_widgets.dart';
import '../../../core/widgets/state_views.dart';
import '../application/driver_controller.dart';
import '../data/driver_models.dart';
import 'driver_ui.dart';

class DriverMatchInboxScreen extends ConsumerStatefulWidget {
  const DriverMatchInboxScreen({super.key});
  @override
  ConsumerState<DriverMatchInboxScreen> createState() =>
      _DriverMatchInboxScreenState();
}

class _DriverMatchInboxScreenState
    extends ConsumerState<DriverMatchInboxScreen> {
  String? _status;

  void _refresh() =>
      ref.read(driverMatchInboxProvider.notifier).refresh(status: _status);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final inbox = ref.watch(driverMatchInboxProvider);

    return ForegroundRefresh(
      refresh: () async {
        await ref
            .read(driverMatchInboxProvider.notifier)
            .refresh(status: _status);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.matchInbox),
          actions: const [
            LanguageSwitch(),
            SizedBox(width: AppTokens.spaceSmall),
          ],
        ),
        body: SafeArea(
          top: false,
          bottom: false,
          child: RefreshIndicator(
            onRefresh: () async => _refresh(),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                AppTokens.marginMobile,
                AppTokens.spaceMedium,
                AppTokens.marginMobile,
                AppTokens.spaceExtraLarge,
              ),
              children: [
                // A filter belongs above the results it filters, full width, so
                // the active scope is always visible while scanning the list.
                SegmentedButton<String?>(
                  segments: [
                    ButtonSegment(value: null, label: Text(l10n.allMatches)),
                    ButtonSegment(
                      value: 'proposed',
                      label: Text(l10n.proposedMatches),
                    ),
                  ],
                  selected: {_status},
                  showSelectedIcon: false,
                  onSelectionChanged: (selection) {
                    setState(() => _status = selection.first);
                    _refresh();
                  },
                ),
                const SizedBox(height: AppTokens.spaceLarge),
                inbox.when(
                  loading: () => const Column(
                    children: [
                      LoadingSkeleton.card(),
                      SizedBox(height: AppTokens.spaceMedium),
                      LoadingSkeleton.card(),
                    ],
                  ),
                  error: (error, _) => ErrorStateView(
                    title: driverErrorLabel(l10n, error),
                    retryLabel: l10n.retry,
                    onRetry: _refresh,
                  ),
                  data: (matches) => matches.isEmpty
                      ? EmptyState(
                          title: l10n.noAvailableMatches,
                          icon: Icons.inbox_outlined,
                          actionLabel: l10n.refresh,
                          onAction: _refresh,
                        )
                      : Column(
                          children: [
                            for (final match in matches) ...[
                              _MatchCard(match: match),
                              const SizedBox(height: AppTokens.spaceMedium),
                            ],
                          ],
                        ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MatchCard extends StatelessWidget {
  const _MatchCard({required this.match});

  final DriverMatch match;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    // Only the load figures that apply to this match type are listed. The old
    // card printed every field with an empty value where it did not apply,
    // which made a passenger ride and a parcel run look identical at a glance.
    final details = <({String label, String value, IconData icon})>[
      if (match.passengerRequest != null)
        (
          label: l10n.passengerCount,
          value: '${match.passengerRequest!.passengerCount}',
          icon: Icons.person_outline,
        ),
      if (match.merchantOrder != null)
        (
          label: l10n.parcelCount,
          value:
              '${match.parcelBatch?.parcelCount ?? match.merchantOrder!.parcelCount}',
          icon: Icons.widgets_outlined,
        ),
      if (match.parcelBatch != null)
        (
          label: l10n.estimatedDistanceSaved,
          value:
              '${match.parcelBatch!.estimatedDistanceSaved.toStringAsFixed(2)} km',
          icon: Icons.eco_outlined,
        ),
    ];

    return MatchResultCard(
      title: matchTypeLabel(l10n, match),
      statusLabel: driverStatusLabel(l10n, match.status),
      statusTone: statusToneFor(match.status),
      score: match.score,
      scoreLabel: l10n.matchScore,
      from: match.pickupLabel,
      to: match.destinationLabel,
      details: details,
      actionKey: ValueKey('openMatch-${match.id}'),
      actionLabel: l10n.viewDetails,
      onAction: () => context.push('/driver/match/${match.id}'),
      onTap: () => context.push('/driver/match/${match.id}'),
    );
  }
}
