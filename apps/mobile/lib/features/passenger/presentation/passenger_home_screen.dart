import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/masari_card.dart';
import '../../../core/widgets/masari_section.dart';
import '../../../core/widgets/route_chip.dart';
import '../../../core/widgets/state_views.dart';
import '../../security/presentation/security_actions.dart';
import '../../security/presentation/session_status_banner.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../trips/data/trip_models.dart';
import '../application/passenger_controller.dart';
import '../data/passenger_models.dart';
import 'widgets/destination_search_card.dart';

class PassengerHomeScreen extends ConsumerWidget {
  const PassengerHomeScreen({super.key});

  /// Where the request flow starts. Kept in one place because the top bar, the
  /// chips, the empty state, and the pinned CTA all lead here.
  static const _newRequestRoute = '/passenger/request/new';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final dashboard = ref.watch(passengerDashboardProvider);

    void openNewRequest() => context.go(_newRequestRoute);

    Future<void> refresh() async {
      await ref.read(passengerDashboardProvider.notifier).refresh();
    }

    return Column(
      key: const ValueKey('passengerHome'),
      children: [
        Expanded(
          child: SafeArea(
            bottom: false,
            child: RefreshIndicator(
              onRefresh: refresh,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                  AppTokens.marginMobile,
                  AppTokens.spaceSmall,
                  AppTokens.marginMobile,
                  AppTokens.spaceLarge,
                ),
                children: [
                  const SessionStatusBanner(),

                  const SizedBox(height: AppTokens.spaceMedium),
                  const _AssistantEntryCard(),

                  // The passenger's own request outranks anything on offer, so
                  // it sits above the search entry point when one exists.
                  ..._activeWork(context, l10n, dashboard),

                  const SizedBox(height: AppTokens.spaceMedium),
                  DestinationSearchCard(onTap: openNewRequest),

                  const SizedBox(height: AppTokens.spaceMedium),
                  const _ParcelEntryCard(),

                  const SizedBox(height: AppTokens.spaceLarge),
                  const RoleSecurityActions(),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// The active request and connected trip, rendered only when they exist.
  ///
  /// The design has no slot for these, but they are the passenger's live state
  /// and dropping them would remove working functionality.
  List<Widget> _activeWork(
    BuildContext context,
    AppLocalizations l10n,
    AsyncValue<PassengerDashboardState> dashboard,
  ) {
    return dashboard.when(
      loading: () => const [
        SizedBox(height: AppTokens.spaceMedium),
        LoadingSkeleton(height: 72),
      ],
      error: (error, _) => [
        const SizedBox(height: AppTokens.spaceMedium),
        OfflineBanner(message: l10n.requestFailed, tone: BannerTone.error),
      ],
      data: (state) {
        final request = state.activeRequest;
        final trip = request == null
            ? state.activeTrip
            : state.tripForRequest(request.id);
        if (request == null && trip == null) return const [];
        return [
          const SizedBox(height: AppTokens.spaceMedium),
          if (request != null)
            _ActiveRequestCard(request: request, trip: trip)
          else
            _ConnectedTripCard(trip: trip!),
        ];
      },
    );
  }
}

class _AssistantEntryCard extends StatelessWidget {
  const _AssistantEntryCard();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return MasariCard(
      key: const ValueKey('openPassengerAssistant'),
      onTap: () => context.go('/passenger/assistant'),
      background: AppTheme.surface,
      border: const BorderSide(color: AppTheme.primary),
      child: Row(
        children: [
          Container(
            width: AppTokens.minTouchTarget,
            height: AppTokens.minTouchTarget,
            decoration: BoxDecoration(
              color: AppTheme.primaryContainer,
              borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
            ),
            child: const Icon(
              Icons.auto_awesome,
              color: AppTheme.onPrimaryContainer,
            ),
          ),
          const SizedBox(width: AppTokens.gutterMobile),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.assistantHomeTitle,
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: AppTheme.primary,
                  ),
                ),
                const SizedBox(height: AppTokens.spaceExtraSmall),
                Text(
                  l10n.assistantHomeBody,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: AppTheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppTokens.spaceSmall),
          const Icon(Icons.chevron_right, color: AppTheme.primary),
        ],
      ),
    );
  }
}

/// Entry to sending a parcel and to the passenger's own parcels.
class _ParcelEntryCard extends ConsumerWidget {
  const _ParcelEntryCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Parcels travel the canonical routes, so the entry only appears where
    // that is switched on. Any failure to learn this simply hides the card.
    final available =
        ref.watch(mobileCapabilitiesProvider).value?.multiRouteEntryAvailable ??
        false;
    if (!available) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: AppTokens.spaceMedium),
      child: MasariCard(
        key: const ValueKey('openPassengerParcels'),
        onTap: () => context.go('/passenger/parcels'),
        child: Row(
          children: [
            Container(
              width: AppTokens.minTouchTarget,
              height: AppTokens.minTouchTarget,
              decoration: BoxDecoration(
                color: AppTheme.primaryContainer,
                borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
              ),
              child: const Icon(
                Icons.inventory_2_outlined,
                color: AppTheme.onPrimaryContainer,
              ),
            ),
            const SizedBox(width: AppTokens.gutterMobile),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.sendParcelTitle,
                    style: theme.textTheme.titleMedium,
                  ),
                  const SizedBox(height: AppTokens.spaceExtraSmall),
                  Text(
                    l10n.sendParcelEntryBody,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: AppTheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppTokens.spaceSmall),
            const Icon(Icons.chevron_right, color: AppTheme.primary),
          ],
        ),
      ),
    );
  }
}

/// The passenger's own open request.
class _ActiveRequestCard extends StatelessWidget {
  const _ActiveRequestCard({required this.request, this.trip});

  final PassengerRequest request;
  final PassengerTrip? trip;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final connected = trip;

    return MasariInfoCard(
      title: l10n.activeRequest,
      icon: Icons.person_pin_circle_outlined,
      statusLabel: passengerStatusLabel(l10n, request.status),
      statusTone: statusToneFor(request.status),
      emphasis: true,
      body: RouteChip(
        from: request.pickupLabel,
        to: request.destinationLabel,
        compact: true,
      ),
      primaryAction: CardAction(
        label: connected == null ? l10n.requestDetails : l10n.openTrip,
        onPressed: () => context.go(
          connected == null
              ? '/passenger/request/${request.id}'
              : '/passenger/trip/${connected.id}',
        ),
      ),
    );
  }
}

/// A trip that exists without an open request behind it.
class _ConnectedTripCard extends StatelessWidget {
  const _ConnectedTripCard({required this.trip});

  final PassengerTrip trip;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return MasariInfoCard(
      title: l10n.passengerTrip,
      icon: Icons.directions_car_outlined,
      statusLabel: passengerStatusLabel(l10n, trip.status),
      statusTone: statusToneFor(trip.status),
      primaryAction: CardAction(
        label: l10n.openTrip,
        onPressed: () => context.go('/passenger/trip/${trip.id}'),
      ),
    );
  }
}

String passengerStatusLabel(AppLocalizations l10n, String status) =>
    switch (status) {
      'pending' => l10n.statusPending,
      'matched' => l10n.statusMatched,
      'accepted' => l10n.statusAccepted,
      'picked_up' => l10n.statusPickedUp,
      'in_transit' => l10n.statusInTransit,
      'delivered' => l10n.statusDelivered,
      'cancelled' => l10n.statusCancelled,
      'completed' => l10n.statusCompleted,
      'pickup_started' => l10n.statusPickupStarted,
      _ => status,
    };
