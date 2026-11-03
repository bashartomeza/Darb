import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/theme/merchant_theme.dart';
import '../../../core/widgets/foreground_refresh.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/state_views.dart';
import '../../auth/application/auth_controller.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../notifications/application/notifications_controller.dart';
import '../../security/presentation/session_status_banner.dart';
import '../application/merchant_controller.dart';
import 'merchant_ui.dart';
import 'widgets/merchant_design.dart';

class MerchantHomeScreen extends ConsumerWidget {
  const MerchantHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final user = ref.watch(authControllerProvider).value?.user;
    final dashboard = ref.watch(merchantDashboardProvider);
    final unread = ref.watch(unreadNotificationCountProvider);
    final capabilities = ref.watch(mobileCapabilitiesProvider).value;
    final name = user?.name.trim();
    Future<void> refresh() async {
      await ref.read(merchantDashboardProvider.notifier).refresh();
    }

    return ForegroundRefresh(
      refresh: refresh,
      child: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: refresh,
          child: ListView(
            key: const ValueKey('merchantHome'),
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${merchantText(context, 'أهلاً،', 'Hello,')} ${name == null || name.isEmpty ? l10n.merchant : name}',
                          key: const ValueKey('merchantDashboardTitle'),
                          style: MerchantStyle.text(
                            size: 21,
                            weight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          merchantText(
                            context,
                            'إدارة طلباتك وتوصيلها بكل سهولة',
                            'Manage your orders and deliveries with ease',
                          ),
                          style: MerchantStyle.text(
                            size: 13,
                            color: MerchantStyle.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const LanguageSwitch(),
                  IconButton(
                    key: const ValueKey('merchantNotifications'),
                    tooltip: l10n.notifications,
                    onPressed: () => context.go('/merchant/notifications'),
                    icon: Badge(
                      isLabelVisible: unread > 0,
                      smallSize: 7,
                      backgroundColor: MerchantStyle.orange,
                      child: const Icon(Icons.notifications_none_rounded),
                    ),
                  ),
                ],
              ),
              const SessionStatusBanner(),
              const SizedBox(height: 24),
              dashboard.when(
                skipError: dashboard.hasValue,
                loading: () => const LoadingSkeleton(height: 112),
                error: (error, _) => ErrorStateView(
                  title: merchantErrorLabel(l10n, error),
                  onRetry: refresh,
                ),
                data: (state) => MerchantCard(
                  padding: const EdgeInsets.symmetric(
                    vertical: 18,
                    horizontal: 4,
                  ),
                  child: IntrinsicHeight(
                    child: Row(
                      children: [
                        _Counter(
                          icon: Icons.inventory_2_outlined,
                          value: state.orders.length,
                          label: merchantText(
                            context,
                            'إجمالي الطلبات',
                            'Total orders',
                          ),
                        ),
                        const VerticalDivider(
                          width: 1,
                          indent: 5,
                          endIndent: 5,
                        ),
                        _Counter(
                          icon: Icons.pending_actions_outlined,
                          value: state.orders
                              .where(
                                (o) => const {
                                  'submitted',
                                  'batched',
                                  'matched',
                                  'pending',
                                }.contains(o.status),
                              )
                              .length,
                          label: merchantText(context, 'جديدة', 'New'),
                        ),
                        const VerticalDivider(
                          width: 1,
                          indent: 5,
                          endIndent: 5,
                        ),
                        _Counter(
                          icon: Icons.local_shipping_outlined,
                          value: state.trips.where((t) => t.isActive).length,
                          label: merchantText(
                            context,
                            'قيد التوصيل',
                            'In delivery',
                          ),
                          valueKey: const ValueKey('merchantActiveShipments'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                key: const ValueKey('createMerchantOrder'),
                onPressed: () => context.push('/merchant/order/new'),
                icon: const Icon(Icons.add_box_outlined, size: 19),
                label: Text(
                  merchantText(context, 'طلب توصيل جديد', l10n.createShipment),
                ),
              ),
              const SizedBox(height: 28),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      l10n.recentOrders,
                      style: MerchantStyle.text(
                        size: 16,
                        weight: FontWeight.w700,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: () => context.go('/merchant/shipments'),
                    style: TextButton.styleFrom(
                      foregroundColor: MerchantStyle.orange,
                      padding: EdgeInsets.zero,
                    ),
                    child: Text(
                      merchantText(context, 'عرض الكل', 'View all'),
                      style: MerchantStyle.text(
                        size: 12,
                        color: MerchantStyle.orange,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 5),
              dashboard.when(
                skipError: dashboard.hasValue,
                loading: () => const LoadingSkeleton.card(),
                error: (error, _) => ErrorStateView(
                  title: l10n.shipmentsFailed,
                  onRetry: refresh,
                ),
                data: (state) => state.orders.isEmpty
                    ? EmptyState(
                        title: l10n.noOrders,
                        icon: Icons.inventory_2_outlined,
                      )
                    : Column(
                        children: [
                          for (final order in state.orders.take(3)) ...[
                            MerchantOrderCard(
                              key: ValueKey('orderRow-${order.id}'),
                              order: order,
                              home: true,
                              tripId: _tripForOrder(state, order.id),
                            ),
                            const SizedBox(height: 12),
                          ],
                        ],
                      ),
              ),
              const SizedBox(height: 12),
              MerchantMenuRow(
                key: const ValueKey('openMerchantMatches'),
                icon: Icons.inbox_outlined,
                label:
                    '${l10n.merchantMatchInbox} · ${dashboard.value?.waitingMatchCount ?? 0}',
                onTap: () => context.push('/merchant/matches'),
              ),
              if (capabilities?.multiRouteEntryAvailable == true) ...[
                const SizedBox(height: 12),
                MerchantMenuRow(
                  key: const ValueKey('openCanonicalMerchantOrder'),
                  icon: Icons.alt_route_rounded,
                  label: l10n.canonicalMerchantOrder,
                  onTap: () => context.push('/merchant/routes/order/new'),
                ),
              ],
              if (capabilities?.canonicalAssignmentStatusAvailable == true) ...[
                const SizedBox(height: 12),
                MerchantMenuRow(
                  key: const ValueKey('openMerchantCanonicalAssignments'),
                  icon: Icons.route_outlined,
                  label: l10n.canonicalAssignmentStatus,
                  onTap: () => context.push('/merchant/canonical-assignments'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

String? _tripForOrder(MerchantDashboardState state, String orderId) {
  for (final trip in state.trips) {
    if (trip.order.id == orderId && trip.isActive) return trip.id;
  }
  return null;
}

class _Counter extends StatelessWidget {
  const _Counter({
    required this.icon,
    required this.value,
    required this.label,
    this.valueKey,
  });
  final IconData icon;
  final int value;
  final String label;
  final Key? valueKey;

  @override
  Widget build(BuildContext context) => Expanded(
    child: Column(
      children: [
        Icon(icon, size: 20),
        const SizedBox(height: 7),
        Text(
          '$value',
          key: valueKey,
          style: MerchantStyle.text(size: 21, weight: FontWeight.w700),
        ),
        const SizedBox(height: 3),
        Text(
          label,
          style: MerchantStyle.text(size: 10, color: MerchantStyle.muted),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ],
    ),
  );
}
