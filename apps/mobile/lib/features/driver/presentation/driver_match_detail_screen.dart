import '../../../core/widgets/foreground_refresh.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_section.dart';
import '../../../core/widgets/match_widgets.dart';
import '../../../core/widgets/route_chip.dart';
import '../../../core/widgets/state_views.dart';
import '../application/driver_controller.dart';
import '../data/driver_models.dart';
import 'driver_ui.dart';

class DriverMatchDetailScreen extends ConsumerStatefulWidget {
  const DriverMatchDetailScreen({required this.matchId, super.key});
  final String matchId;
  @override
  ConsumerState<DriverMatchDetailScreen> createState() =>
      _DriverMatchDetailScreenState();
}

class _DriverMatchDetailScreenState
    extends ConsumerState<DriverMatchDetailScreen> {
  bool _busy = false;
  String? _error;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final detail = ref.watch(driverMatchDetailProvider(widget.matchId));

    return ForegroundRefresh(
      refresh: () async {
        await ref
            .read(driverMatchDetailProvider(widget.matchId).notifier)
            .refresh();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.matchResult),
          actions: const [
            LanguageSwitch(),
            SizedBox(width: AppTokens.spaceSmall),
          ],
        ),
        body: SafeArea(
          top: false,
          bottom: false,
          child: detail.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, _) => ErrorStateView(
              title: driverErrorLabel(l10n, error),
              retryLabel: l10n.retry,
              onRetry: () => ref
                  .read(driverMatchDetailProvider(widget.matchId).notifier)
                  .refresh(),
            ),
            data: (match) => _content(l10n, match),
          ),
        ),
        // The decision is the point of this screen, so its actions are pinned
        // to the bottom rather than buried under the scoring detail.
        bottomNavigationBar: detail.maybeWhen(
          data: (match) => match.canRespond ? _decisionBar(l10n) : null,
          orElse: () => null,
        ),
      ),
    );
  }

  Widget _content(AppLocalizations l10n, DriverMatch match) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppTokens.marginMobile,
        AppTokens.spaceMedium,
        AppTokens.marginMobile,
        AppTokens.spaceExtraLarge,
      ),
      children: [
        MasariInfoCard(
          title: matchTypeLabel(l10n, match),
          statusLabel: driverStatusLabel(l10n, match.status),
          statusTone: statusToneFor(match.status),
          body: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: RouteChip(
                      from: match.pickupLabel,
                      to: match.destinationLabel,
                    ),
                  ),
                  const SizedBox(width: AppTokens.gutterMobile),
                  MatchScore(score: match.score, label: l10n.matchScore),
                ],
              ),
              const Divider(height: AppTokens.spaceLarge),
              if (match.passengerRequest != null)
                DetailRow(
                  label: l10n.passengerCount,
                  value: '${match.passengerRequest!.passengerCount}',
                  icon: Icons.person_outline,
                ),
              if (match.merchantOrder != null)
                DetailRow(
                  label: l10n.parcelCount,
                  value:
                      '${match.parcelBatch?.parcelCount ?? match.merchantOrder!.parcelCount}',
                  icon: Icons.widgets_outlined,
                ),
              if (match.parcelBatch != null)
                DetailRow(
                  label: l10n.estimatedDistanceSaved,
                  value:
                      '${match.parcelBatch!.estimatedDistanceSaved.toStringAsFixed(2)} km',
                  icon: Icons.eco_outlined,
                ),
            ],
          ),
        ),
        const SizedBox(height: AppTokens.spaceLarge),

        MasariSection(
          title: l10n.scoringBreakdown,
          titleKey: const ValueKey('driverScoringBreakdown'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ScoreBreakdownList(
                factors: [
                  (
                    label: l10n.corridorOverlap,
                    value: match.breakdown.corridorOverlap,
                  ),
                  (
                    label: l10n.pickupDistance,
                    value: match.breakdown.pickupDistanceScore,
                  ),
                  (label: l10n.timingFit, value: match.breakdown.timingFit),
                  (label: l10n.trustScore, value: match.breakdown.trustScore),
                  (label: l10n.capacityFit, value: match.breakdown.capacityFit),
                ],
              ),
              ExplanationNote(message: l10n.routeMatchExplanation),
            ],
          ),
        ),

        if (_error != null) ...[
          const SizedBox(height: AppTokens.spaceMedium),
          OfflineBanner(message: _error!, tone: BannerTone.error),
        ],

        // The reference stays selectable for support, but sits last and muted:
        // it is the least useful thing on the screen to a driver deciding.
        const SizedBox(height: AppTokens.spaceLarge),
        DefaultTextStyle.merge(
          style: Theme.of(
            context,
          ).textTheme.labelSmall?.copyWith(color: AppTheme.onSurfaceVariant),
          textAlign: TextAlign.center,
          child: technicalText(match.id, selectable: true),
        ),
      ],
    );
  }

  /// Accept and reject, pinned above the navigation bar.
  Widget _decisionBar(AppLocalizations l10n) {
    return Container(
      decoration: const BoxDecoration(
        color: AppTheme.surfaceContainerLowest,
        border: Border(top: BorderSide(color: AppTheme.outlineVariant)),
      ),
      // No SafeArea here: this bar sits inside the shell, above the app's
      // navigation bar, which already clears the system inset.
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.spaceMedium),
        child: Row(
          children: [
            Expanded(
              child: OutlinedButton(
                key: const ValueKey('rejectMatchButton'),
                onPressed: _busy ? null : _reject,
                child: Text(l10n.rejectMatch),
              ),
            ),
            const SizedBox(width: AppTokens.gutterMobile),
            Expanded(
              flex: 2,
              child: FilledButton(
                key: const ValueKey('acceptMatchButton'),
                onPressed: _busy ? null : _accept,
                child: Text(l10n.acceptMatch),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _accept() async {
    final l10n = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final trip = await ref
          .read(driverMatchDetailProvider(widget.matchId).notifier)
          .accept();
      if (mounted) context.go('/driver/trip/${trip.id}');
    } catch (error) {
      await _recover(error, l10n);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reject() async {
    final l10n = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(driverMatchDetailProvider(widget.matchId).notifier)
          .reject();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(l10n.matchRejected)));
      }
    } catch (error) {
      await _recover(error, l10n);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _recover(Object error, AppLocalizations l10n) async {
    if (mounted) setState(() => _error = driverErrorLabel(l10n, error));
    await ref
        .read(driverMatchDetailProvider(widget.matchId).notifier)
        .refresh();
  }
}
