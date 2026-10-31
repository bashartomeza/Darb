import '../../../core/widgets/foreground_refresh.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/theme/semantic_colors.dart';
import '../../../core/widgets/home_top_bar.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_map.dart';
import '../../../core/widgets/masari_section.dart';
import '../../../core/widgets/state_views.dart';
import '../../auth/application/auth_controller.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../security/presentation/security_actions.dart';
import '../../security/presentation/session_status_banner.dart';
import '../application/merchant_controller.dart';
import '../data/merchant_stats_source.dart';
import '../domain/merchant_home_stats.dart';
import 'merchant_ui.dart';
import 'widgets/merchant_home_widgets.dart';

class MerchantHomeScreen extends ConsumerStatefulWidget {
  const MerchantHomeScreen({super.key});

  @override
  ConsumerState<MerchantHomeScreen> createState() => _MerchantHomeScreenState();
}

class _MerchantHomeScreenState extends ConsumerState<MerchantHomeScreen> {
  bool _busy = false;
  String? _error;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final user = ref.watch(authControllerProvider).value?.user;
    final dashboard = ref.watch(merchantDashboardProvider);
    final stats = ref.watch(merchantHomeStatsProvider);
    final capabilities = ref.watch(mobileCapabilitiesProvider).value;
    final canonicalEntry = capabilities?.multiRouteEntryAvailable == true;
    final canonicalStatus =
        capabilities?.canonicalAssignmentStatusAvailable == true;

    return ForegroundRefresh(
      refresh: () async {
        await ref.read(merchantDashboardProvider.notifier).refresh();
      },
      child: Column(
        key: const ValueKey('merchantHome'),
        children: [
          Expanded(
            child: SafeArea(
              bottom: false,
              child: RefreshIndicator(
                onRefresh: () =>
                    ref.read(merchantDashboardProvider.notifier).refresh(),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(
                    AppTokens.marginMobile,
                    AppTokens.spaceSmall,
                    AppTokens.marginMobile,
                    AppTokens.spaceLarge,
                  ),
                  children: [
                    HomeTopBar(
                      title: l10n.appTitle,
                      role: 'merchant',
                      name: user?.name,
                      notificationsKey: const ValueKey('merchantNotifications'),
                    ),
                    const SizedBox(height: AppTokens.spaceSmall),
                    Text(
                      homeGreeting(l10n, user?.name.trim() ?? l10n.merchant),
                      key: const ValueKey('merchantDashboardTitle'),
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        color: AppTheme.primary,
                        fontWeight: FontWeight.w700,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: AppTokens.spaceMedium),
                    const SessionStatusBanner(),

                    if (_error != null) ...[
                      const SizedBox(height: AppTokens.spaceMedium),
                      OfflineBanner(message: _error!, tone: BannerTone.error),
                    ],

                    const SizedBox(height: AppTokens.spaceMedium),
                    _StatsBlock(stats: stats),

                    const SizedBox(height: AppTokens.spaceLarge),
                    FilledButton.icon(
                      key: const ValueKey('createMerchantOrder'),
                      onPressed: () => context.go('/merchant/order/new'),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(60),
                      ),
                      icon: const Icon(Icons.add_box_outlined),
                      label: Text(l10n.createShipment),
                    ),

                    const SizedBox(height: AppTokens.spaceLarge),
                    MasariSection(
                      title: l10n.smartBatchingTitle,
                      child: _Suggestions(
                        stats: stats,
                        busy: _busy,
                        onMerge: _merge,
                      ),
                    ),

                    const SizedBox(height: AppTokens.spaceLarge),
                    MasariSection(
                      title: l10n.liveTracking,
                      child: _Tracking(dashboard: dashboard),
                    ),

                    const SizedBox(height: AppTokens.spaceLarge),
                    MasariSection(
                      title: l10n.recentOrders,
                      // The home strip shows only the newest few; the shipments
                      // tab is where the full list lives.
                      actionLabel: l10n.viewDetails,
                      onAction: () => context.go('/merchant/shipments'),
                      child: _RecentOrders(dashboard: dashboard),
                    ),

                    const SizedBox(height: AppTokens.spaceLarge),
                    MasariInfoCard(
                      title: l10n.merchantMatchInbox,
                      icon: Icons.inbox_outlined,
                      body: StatStrip(
                        stats: [
                          (
                            label: l10n.waitingForDriver,
                            value: '${dashboard.value?.waitingMatchCount ?? 0}',
                            valueKey: const ValueKey(
                              'merchantWaitingMatchCount',
                            ),
                          ),
                        ],
                      ),
                      primaryAction: CardAction(
                        key: const ValueKey('openMerchantMatches'),
                        label: l10n.matchInbox,
                        onPressed: () => context.go('/merchant/matches'),
                      ),
                    ),

                    if (canonicalEntry) ...[
                      const SizedBox(height: AppTokens.spaceLarge),
                      MasariSection(
                        title: l10n.canonicalRoutes,
                        child: MasariInfoCard(
                          title: l10n.canonicalMerchantOrder,
                          subtitle: l10n.canonicalMerchantOrderBody,
                          icon: Icons.alt_route_outlined,
                          primaryAction: CardAction(
                            key: const ValueKey('openCanonicalMerchantOrder'),
                            label: l10n.canonicalMerchantOrder,
                            onPressed: () =>
                                context.go('/merchant/routes/order/new'),
                          ),
                          secondaryAction: canonicalStatus
                              ? CardAction(
                                  key: const ValueKey(
                                    'openMerchantCanonicalAssignments',
                                  ),
                                  label: l10n.canonicalAssignmentStatus,
                                  filled: false,
                                  onPressed: () => context.go(
                                    '/merchant/canonical-assignments',
                                  ),
                                )
                              : null,
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

  /// Consolidates an order's parcels into a batch. A real API call.
  Future<void> _merge(String orderId) async {
    final l10n = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(merchantOrderProvider(orderId).notifier).createBatch();
      await ref.read(merchantDashboardProvider.notifier).refresh();
    } catch (error) {
      if (mounted) setState(() => _error = merchantErrorLabel(l10n, error));
      await ref.read(merchantDashboardProvider.notifier).refresh();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

/// Savings hero plus the two counters.
class _StatsBlock extends StatelessWidget {
  const _StatsBlock({required this.stats});

  final AsyncValue<MerchantHomeStats> stats;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return stats.when(
      loading: () => const Column(
        children: [
          LoadingSkeleton(height: 120),
          SizedBox(height: AppTokens.spaceMedium),
          LoadingSkeleton(height: 120),
        ],
      ),
      error: (error, _) => ErrorStateView(
        title: merchantErrorLabel(l10n, error),
        retryLabel: l10n.retry,
        onRetry: () {},
      ),
      data: (value) => Column(
        children: [
          if (value.isSample) ...[
            OfflineBanner(
              message: l10n.sampleDataNotice,
              icon: Icons.science_outlined,
            ),
            const SizedBox(height: AppTokens.spaceMedium),
          ],
          SavingsHeroCard(stats: value),
          const SizedBox(height: AppTokens.spaceMedium),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  child: MerchantCountCard(
                    label: l10n.inDelivery,
                    value: '${value.activeShipments}',
                    caption: l10n.activeShipmentsCount(value.activeShipments),
                    icon: Icons.local_shipping_outlined,
                    iconColor: SemanticColors.action,
                    valueKey: const ValueKey('merchantActiveShipments'),
                  ),
                ),
                const SizedBox(width: AppTokens.gutterMobile),
                Expanded(
                  child: MerchantCountCard(
                    label: l10n.waitingForDriver,
                    value: '${value.waitingForDriver}',
                    // The corridor string is far too long for a caption slot
                    // and truncated mid-word; what the number means is more
                    // useful here anyway.
                    caption: l10n.proposedMatches,
                    icon: Icons.pending_actions_outlined,
                    iconColor: AppTheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Consolidation opportunities, derived from orders that can still be batched.
class _Suggestions extends StatelessWidget {
  const _Suggestions({
    required this.stats,
    required this.busy,
    required this.onMerge,
  });

  final AsyncValue<MerchantHomeStats> stats;
  final bool busy;
  final ValueChanged<String> onMerge;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return stats.when(
      loading: () => const LoadingSkeleton.card(),
      error: (error, _) => const SizedBox.shrink(),
      data: (value) => value.suggestions.isEmpty
          ? EmptyState(
              title: l10n.noBatchSuggestions,
              icon: Icons.layers_outlined,
            )
          : Column(
              children: [
                for (final suggestion in value.suggestions.take(3)) ...[
                  BatchSuggestionCard(
                    suggestion: suggestion,
                    busy: busy,
                    onMerge: () => onMerge(suggestion.orderId),
                  ),
                  const SizedBox(height: AppTokens.spaceMedium),
                ],
              ],
            ),
    );
  }
}

/// Live tracking for the active trip.
class _Tracking extends StatelessWidget {
  const _Tracking({required this.dashboard});

  final AsyncValue<MerchantDashboardState> dashboard;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final trip = dashboard.value?.activeTrip;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // No live fix reaches this screen yet, so the map shows its explicit
        // empty state rather than a decorative one.
        MasariMap(
          emptyLabel: l10n.mapNoLocation,
          attributionLabel: l10n.mapAttribution,
          height: 180,
        ),
        if (trip != null) ...[
          const SizedBox(height: AppTokens.spaceMedium),
          MasariInfoCard(
            title: l10n.activeTrip,
            icon: Icons.local_shipping_outlined,
            statusLabel: merchantStatusLabel(l10n, trip.status),
            statusTone: statusToneFor(trip.status),
            primaryAction: CardAction(
              key: const ValueKey('openMerchantTrip'),
              label: l10n.openTrip,
              onPressed: () => context.go('/merchant/trip/${trip.id}'),
            ),
          ),
        ],
      ],
    );
  }
}

/// The recent-orders timeline.
class _RecentOrders extends StatelessWidget {
  const _RecentOrders({required this.dashboard});

  final AsyncValue<MerchantDashboardState> dashboard;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return dashboard.when(
      skipError: dashboard.hasValue,
      loading: () => const LoadingSkeleton.card(),
      error: (error, _) => ErrorStateView(
        title: merchantErrorLabel(l10n, error),
        retryLabel: l10n.retry,
        onRetry: () {},
      ),
      data: (state) {
        final orders = state.orders.take(5).toList();
        if (orders.isEmpty) {
          return EmptyState(
            title: l10n.noOrders,
            icon: Icons.inventory_2_outlined,
          );
        }
        return Column(
          children: [
            for (final (index, order) in orders.indexed)
              OrderTimelineRow(
                key: ValueKey('orderRow-${order.id}'),
                order: order,
                isLast: index == orders.length - 1,
                onTap: () => context.go('/merchant/order/${order.id}'),
              ),
          ],
        );
      },
    );
  }
}
