import '../../../core/widgets/foreground_refresh.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/presentation/localized_labels.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/theme/semantic_colors.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_map.dart';
import '../../../core/widgets/masari_section.dart';
import '../../../core/widgets/state_views.dart';
import '../../auth/application/auth_controller.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../security/presentation/security_actions.dart';
import '../../security/presentation/session_status_banner.dart';
import '../../driver_renewal/presentation/driver_renewal_banner.dart';
import '../application/driver_controller.dart';
import '../data/driver_stats_source.dart';
import '../domain/driver_home_stats.dart';
import 'driver_ui.dart';
import 'widgets/driver_home_widgets.dart';

class DriverHomeScreen extends ConsumerStatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  ConsumerState<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends ConsumerState<DriverHomeScreen> {
  bool _busy = false;
  String? _error;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final user = ref.watch(authControllerProvider).value?.user;
    final dashboard = ref.watch(driverDashboardProvider);
    final stats = ref.watch(driverHomeStatsProvider);
    final capabilities = ref.watch(mobileCapabilitiesProvider).value;
    final canonicalEntry = capabilities?.multiRouteEntryAvailable == true;
    final canonicalOffers =
        capabilities?.driverCanonicalOffersAvailable == true;
    final sharedOffers =
        capabilities?.canonicalSharedDriverOffersAvailable == true;

    final route = dashboard.value?.currentRoute;
    final isOnline = route?.isOperational ?? false;

    return ForegroundRefresh(
      refresh: () async {
        await ref.read(driverDashboardProvider.notifier).refresh();
      },
      child: Column(
        key: const ValueKey('driverHome'),
        children: [
          Expanded(
            child: SafeArea(
              bottom: false,
              child: RefreshIndicator(
                onRefresh: () =>
                    ref.read(driverDashboardProvider.notifier).refresh(),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(
                    AppTokens.marginMobile,
                    AppTokens.spaceSmall,
                    AppTokens.marginMobile,
                    AppTokens.spaceLarge,
                  ),
                  children: [
                    DriverTopBar(title: l10n.appTitle, name: user?.name),
                    const SizedBox(height: AppTokens.spaceMedium),

                    DriverStatusCard(
                      greeting: _greeting(l10n, user?.name),
                      // Keeps the role visible alongside the operating area.
                      subtitle:
                          '${l10n.driver} • '
                          '${localizedCorridorPlace(context, 'Hebron / PPU / Bab Al-Zawiya')}',
                      isOnline: isOnline,
                      busy: _busy || dashboard.isLoading,
                      onChanged: (value) => _toggleOnline(l10n, value),
                    ),

                    if (_error != null) ...[
                      const SizedBox(height: AppTokens.spaceMedium),
                      OfflineBanner(message: _error!, tone: BannerTone.error),
                    ],

                    const SizedBox(height: AppTokens.spaceMedium),
                    const SessionStatusBanner(),
                    const SizedBox(height: AppTokens.spaceMedium),
                    const DriverRenewalBanner(),

                    _StatsRow(stats: stats),

                    const SizedBox(height: AppTokens.spaceLarge),
                    FilledButton.icon(
                      key: const ValueKey('openDriverRoute'),
                      onPressed: () => context.go('/driver/route'),
                      style: FilledButton.styleFrom(
                        backgroundColor: SemanticColors.action,
                        foregroundColor: SemanticColors.onAction,
                        minimumSize: const Size.fromHeight(64),
                      ),
                      icon: const Icon(Icons.route_outlined),
                      label: Text(
                        isOnline ? l10n.viewRoute : l10n.activateYourRoute,
                      ),
                    ),
                    const SizedBox(height: AppTokens.spaceSmall),
                    Text(
                      l10n.activateRouteHint,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppTheme.onSurfaceVariant,
                      ),
                    ),

                    const SizedBox(height: AppTokens.spaceMedium),
                    // No driver position is published to this screen yet, so the
                    // map renders its empty state rather than a decorative one.
                    MasariMap(
                      emptyLabel: l10n.mapNoLocation,
                      attributionLabel: l10n.mapAttribution,
                      height: 190,
                    ),

                    const SizedBox(height: AppTokens.spaceLarge),
                    _InboxSection(dashboard: dashboard),

                    if (canonicalEntry) ...[
                      const SizedBox(height: AppTokens.spaceLarge),
                      MasariSection(
                        title: l10n.canonicalRoutes,
                        child: MasariInfoCard(
                          title: l10n.driverAvailabilities,
                          subtitle: l10n.canonicalRoutesBody,
                          icon: Icons.alt_route_outlined,
                          primaryAction: CardAction(
                            key: const ValueKey('openCanonicalAvailabilities'),
                            label: l10n.driverAvailabilities,
                            onPressed: () =>
                                context.go('/driver/availabilities'),
                          ),
                          secondaryAction: canonicalOffers
                              ? CardAction(
                                  key: const ValueKey(
                                    'openCanonicalDriverOffers',
                                  ),
                                  label: l10n.canonicalDriverOffers,
                                  filled: false,
                                  onPressed: () =>
                                      context.go('/driver/canonical-offers'),
                                )
                              : null,
                        ),
                      ),
                    ],

                    if (sharedOffers) ...[
                      const SizedBox(height: AppTokens.spaceMedium),
                      MasariInfoCard(
                        title: l10n.sharedOffers,
                        icon: Icons.groups_outlined,
                        primaryAction: CardAction(
                          key: const ValueKey('openSharedDriverOffers'),
                          label: l10n.sharedOffers,
                          onPressed: () => context.go('/driver/shared-offers'),
                        ),
                      ),
                    ],

                    const SizedBox(height: AppTokens.spaceLarge),
                    const Divider(),
                    const RoleSecurityActions(),
                    const Align(
                      alignment: AlignmentDirectional.centerEnd,
                      child: LanguageSwitch(),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _greeting(AppLocalizations l10n, String? name) {
    final display = name?.trim();
    final who = (display == null || display.isEmpty) ? l10n.driver : display;
    final hour = DateTime.now().hour;
    if (hour < 12) return l10n.greetingMorning(who);
    if (hour < 17) return l10n.greetingAfternoon(who);
    return l10n.greetingEvening(who);
  }

  /// Reconciles an explicit desired state through the response-loss-safe
  /// legacy operation slot.
  Future<void> _toggleOnline(AppLocalizations l10n, bool value) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(legacyDriverOnlineControllerProvider).setOnline(value);
    } catch (error) {
      if (mounted) setState(() => _error = driverErrorLabel(l10n, error));
      await ref.read(driverDashboardProvider.notifier).refresh();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

/// The two headline stat cards.
class _StatsRow extends StatelessWidget {
  const _StatsRow({required this.stats});

  final AsyncValue<DriverHomeStats> stats;

  @override
  Widget build(BuildContext context) {
    return stats.when(
      loading: () => const Row(
        children: [
          Expanded(child: LoadingSkeleton(height: 150)),
          SizedBox(width: AppTokens.gutterMobile),
          Expanded(child: LoadingSkeleton(height: 150)),
        ],
      ),
      error: (error, _) => const SizedBox.shrink(),
      data: (value) => Column(
        children: [
          if (value.isSample) ...[
            OfflineBanner(
              message: AppLocalizations.of(context).sampleDataNotice,
              icon: Icons.science_outlined,
            ),
            const SizedBox(height: AppTokens.spaceMedium),
          ],
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: EarningsCard(stats: value)),
                const SizedBox(width: AppTokens.gutterMobile),
                Expanded(child: TrustScoreCard(stats: value)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Proposed matches waiting on the driver.
class _InboxSection extends StatelessWidget {
  const _InboxSection({required this.dashboard});

  final AsyncValue<DriverDashboardState> dashboard;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return dashboard.when(
      skipError: dashboard.hasValue,
      loading: () => const LoadingSkeleton.card(),
      error: (error, _) => ErrorStateView(
        title: driverErrorLabel(l10n, error),
        retryLabel: l10n.retry,
        onRetry: () {},
      ),
      data: (state) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          MasariInfoCard(
            title: l10n.matchInbox,
            icon: Icons.inbox_outlined,
            emphasis: state.proposedMatchCount > 0,
            body: StatStrip(
              stats: [
                (
                  label: l10n.proposedMatches,
                  value: '${state.proposedMatchCount}',
                  valueKey: const ValueKey('proposedMatchCount'),
                ),
              ],
            ),
            primaryAction: CardAction(
              key: const ValueKey('openMatchInbox'),
              label: l10n.matchInbox,
              onPressed: () => context.go('/driver/matches'),
            ),
          ),
          if (state.activeTrip != null) ...[
            const SizedBox(height: AppTokens.spaceMedium),
            MasariInfoCard(
              title: l10n.activeTrip,
              icon: Icons.local_shipping_outlined,
              statusLabel: driverStatusLabel(l10n, state.activeTrip!.status),
              statusTone: statusToneFor(state.activeTrip!.status),
              primaryAction: CardAction(
                key: const ValueKey('openActiveTrip'),
                label: l10n.openActiveTrip,
                onPressed: () =>
                    context.go('/driver/trip/${state.activeTrip!.id}'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
