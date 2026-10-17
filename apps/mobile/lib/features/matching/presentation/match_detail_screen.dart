import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_section.dart';
import '../../../core/widgets/state_views.dart';
import '../../passenger/application/passenger_controller.dart';
import '../data/matching_repository.dart';

final matchDetailProvider = FutureProvider.autoDispose.family((ref, String id) {
  return ref.watch(matchingRepositoryProvider).detail(id);
});

class MatchDetailScreen extends ConsumerStatefulWidget {
  const MatchDetailScreen({required this.matchId, super.key});
  final String matchId;

  @override
  ConsumerState<MatchDetailScreen> createState() => _MatchDetailScreenState();
}

class _MatchDetailScreenState extends ConsumerState<MatchDetailScreen> {
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (mounted) ref.invalidate(matchDetailProvider(widget.matchId));
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final detail = ref.watch(matchDetailProvider(widget.matchId));

    return Scaffold(
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
            title: _matchDetailErrorLabel(l10n, error),
            retryLabel: l10n.retry,
            onRetry: () => ref.invalidate(matchDetailProvider(widget.matchId)),
          ),
          data: (match) => ListView(
            padding: const EdgeInsets.fromLTRB(
              AppTokens.marginMobile,
              AppTokens.spaceMedium,
              AppTokens.marginMobile,
              AppTokens.spaceExtraLarge,
            ),
            children: [
              MasariInfoCard(
                title: match.driverName,
                subtitle: l10n.selectedDriver,
                icon: Icons.person_outline,
                statusLabel: localizedMatchStatus(l10n, match.status),
                statusTone: statusToneFor(match.status),
                body: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    DetailRow(
                      label: l10n.selectedRoute,
                      value: match.routeLabel,
                      icon: Icons.route_outlined,
                    ),
                    DetailRow(
                      label: l10n.seatsAvailable,
                      value: '${match.seatsAvailable}',
                      icon: Icons.event_seat_outlined,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppTokens.spaceLarge),
              if (match.passengerRequestId != null)
                _PassengerMatchLifecycleActions(
                  matchStatus: match.status,
                  requestId: match.passengerRequestId!,
                ),
              const SizedBox(height: AppTokens.spaceLarge),
              DefaultTextStyle.merge(
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: AppTheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
                child: Directionality(
                  textDirection: TextDirection.ltr,
                  child: SelectableText(match.id),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PassengerMatchLifecycleActions extends ConsumerWidget {
  const _PassengerMatchLifecycleActions({
    required this.matchStatus,
    required this.requestId,
  });

  final String matchStatus;
  final String requestId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    if (matchStatus == 'accepted') {
      final trip = ref.watch(passengerTripForRequestProvider(requestId));
      return trip.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, _) => OutlinedButton(
          onPressed: () =>
              ref.invalidate(passengerTripForRequestProvider(requestId)),
          child: Text(l10n.retry),
        ),
        data: (value) => value == null
            ? Text(l10n.waitingForDriver)
            : FilledButton.icon(
                onPressed: () => context.go('/passenger/trip/${value.id}'),
                icon: const Icon(Icons.route_outlined),
                label: Text(l10n.tripTimeline),
              ),
      );
    }

    if (matchStatus == 'rejected' ||
        matchStatus == 'expired' ||
        matchStatus == 'invalidated') {
      return OutlinedButton.icon(
        onPressed: () => context.go('/passenger/request/$requestId'),
        icon: const Icon(Icons.refresh_rounded),
        label: Text(l10n.findCompatibleRoute),
      );
    }

    return Text(l10n.waitingForDriver);
  }
}

String _matchDetailErrorLabel(AppLocalizations l10n, Object error) {
  if (error is ApiException) {
    if (error.type == ApiErrorType.network) return l10n.networkUnavailable;
    if (error.type == ApiErrorType.timeout) return l10n.requestTimedOut;
    if (error.type == ApiErrorType.forbidden) return l10n.forbidden;
    if (error.message == 'match_not_found') return l10n.requestFailed;
  }
  return l10n.requestFailed;
}

String localizedMatchStatus(AppLocalizations l10n, String status) =>
    switch (status) {
      'proposed' => l10n.statusProposed,
      'sent_to_driver' => l10n.statusSentToDriver,
      'accepted' => l10n.statusAccepted,
      'rejected' => l10n.statusRejected,
      'expired' => l10n.statusExpired,
      'invalidated' => l10n.statusExpired,
      _ => status,
    };
