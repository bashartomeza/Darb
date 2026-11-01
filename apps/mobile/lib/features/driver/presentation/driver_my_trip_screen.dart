import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/state_views.dart';
import '../application/driver_controller.dart';
import 'driver_trip_screen.dart';
import 'driver_ui.dart';

/// The driver's "My trip" tab.
///
/// The flow diagram makes the live trip a top-level destination rather than
/// something reached from a card on the home screen. This tab resolves the
/// driver's one active trip and hands off to [DriverTripScreen], so the status
/// ladder, tracking and actions all stay in a single implementation.
class DriverMyTripScreen extends ConsumerWidget {
  const DriverMyTripScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final dashboard = ref.watch(driverDashboardProvider);
    final activeTrip = dashboard.value?.activeTrip;

    // With a trip in hand the tab *is* the trip screen — no wrapper chrome, so
    // the driver sees the same layout whether they arrived by tab or by link.
    if (activeTrip != null) {
      return DriverTripScreen(
        key: ValueKey('driverMyTrip-${activeTrip.id}'),
        tripId: activeTrip.id,
      );
    }

    return Scaffold(
      body: SafeArea(
        top: false,
        bottom: false,
        child: RefreshIndicator(
          onRefresh: () => ref.read(driverDashboardProvider.notifier).refresh(),
          child: ListView(
            key: const ValueKey('driverNoActiveTrip'),
            padding: const EdgeInsets.fromLTRB(
              AppTokens.marginMobile,
              AppTokens.spaceMedium,
              AppTokens.marginMobile,
              AppTokens.spaceExtraLarge,
            ),
            children: [
              if (dashboard.isLoading)
                const LoadingSkeleton.card()
              else if (dashboard.hasError)
                ErrorStateView(
                  title: driverErrorLabel(l10n, dashboard.error!),
                  retryLabel: l10n.retry,
                  onRetry: () =>
                      ref.read(driverDashboardProvider.notifier).refresh(),
                )
              else
                EmptyState(
                  title: l10n.noActiveTrip,
                  // Accepting a match is the only way a trip comes into
                  // existence, so the empty state routes there rather than
                  // leaving the driver on a dead end.
                  message: l10n.activateRouteHint,
                  icon: Icons.local_shipping_outlined,
                  actionLabel: l10n.matchInbox,
                  onAction: () => context.go('/driver/matches'),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
