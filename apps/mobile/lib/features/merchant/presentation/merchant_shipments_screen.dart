import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/theme/merchant_theme.dart';
import '../../../core/widgets/foreground_refresh.dart';
import '../../../core/widgets/state_views.dart';
import '../application/merchant_controller.dart';
import '../data/merchant_models.dart';
import 'merchant_ui.dart';
import 'widgets/merchant_design.dart';

enum MerchantOrderFilter { all, newOrders, inDelivery, completed }

bool merchantOrderMatchesFilter(
  MerchantOrder order,
  MerchantOrderFilter filter,
) => switch (filter) {
  MerchantOrderFilter.all => true,
  MerchantOrderFilter.newOrders => const {
    'draft',
    'submitted',
    'pending',
    'batched',
    'matched',
  }.contains(order.status),
  MerchantOrderFilter.inDelivery => const {
    'accepted',
    'assigned',
    'pickup_started',
    'picked_up',
    'in_transit',
  }.contains(order.status),
  MerchantOrderFilter.completed => const {
    'completed',
    'delivered',
  }.contains(order.status),
};

class MerchantShipmentsScreen extends ConsumerStatefulWidget {
  const MerchantShipmentsScreen({super.key});

  @override
  ConsumerState<MerchantShipmentsScreen> createState() =>
      _MerchantShipmentsScreenState();
}

class _MerchantShipmentsScreenState
    extends ConsumerState<MerchantShipmentsScreen> {
  MerchantOrderFilter _filter = MerchantOrderFilter.all;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final dashboard = ref.watch(merchantDashboardProvider);
    Future<void> refresh() async {
      await ref.read(merchantDashboardProvider.notifier).refresh();
    }

    return ForegroundRefresh(
      refresh: refresh,
      child: Scaffold(
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              MerchantHeader(title: l10n.orders),
              Padding(
                padding: MerchantStyle.pagePadding,
                child: Container(
                  padding: const EdgeInsets.all(4),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF1F0E8),
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Row(
                    children: [
                      for (final filter in MerchantOrderFilter.values)
                        Expanded(
                          child: Semantics(
                            selected: _filter == filter,
                            child: InkWell(
                              key: ValueKey(
                                'merchantOrderFilter-${filter.name}',
                              ),
                              borderRadius: BorderRadius.circular(10),
                              onTap: () => setState(() => _filter = filter),
                              child: AnimatedContainer(
                                duration: const Duration(milliseconds: 160),
                                alignment: Alignment.center,
                                padding: const EdgeInsets.symmetric(
                                  vertical: 10,
                                  horizontal: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: _filter == filter
                                      ? MerchantStyle.orange
                                      : Colors.transparent,
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Text(
                                  switch (filter) {
                                    MerchantOrderFilter.all => merchantText(
                                      context,
                                      'الكل',
                                      'All',
                                    ),
                                    MerchantOrderFilter.newOrders =>
                                      merchantText(context, 'جديدة', 'New'),
                                    MerchantOrderFilter.inDelivery =>
                                      merchantText(
                                        context,
                                        'قيد التوصيل',
                                        'In delivery',
                                      ),
                                    MerchantOrderFilter.completed =>
                                      merchantText(
                                        context,
                                        'مكتملة',
                                        'Completed',
                                      ),
                                  },
                                  style: MerchantStyle.text(
                                    size: 11,
                                    weight: FontWeight.w600,
                                    color: _filter == filter
                                        ? Colors.white
                                        : MerchantStyle.ink,
                                  ),
                                  maxLines: 1,
                                ),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: refresh,
                  child: ListView(
                    key: const ValueKey('merchantShipmentsList'),
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
                    children: [
                      dashboard.when(
                        skipError: dashboard.hasValue,
                        loading: () => const LoadingSkeleton.card(),
                        error: (error, _) => ErrorStateView(
                          title: l10n.shipmentsFailed,
                          message: merchantErrorLabel(l10n, error),
                          onRetry: refresh,
                        ),
                        data: (state) {
                          final orders = state.orders
                              .where(
                                (o) => merchantOrderMatchesFilter(o, _filter),
                              )
                              .toList();
                          if (orders.isEmpty) {
                            return EmptyState(
                              title: l10n.noOrders,
                              message: _filter == MerchantOrderFilter.all
                                  ? l10n.noShipmentsBody
                                  : merchantText(
                                      context,
                                      'لا توجد طلبات بهذه الحالة حاليًا',
                                      'No orders with this status yet',
                                    ),
                              icon: Icons.inventory_2_outlined,
                              actionLabel: _filter == MerchantOrderFilter.all
                                  ? l10n.createShipment
                                  : null,
                              onAction: _filter == MerchantOrderFilter.all
                                  ? () => context.push('/merchant/order/new')
                                  : null,
                            );
                          }
                          return Column(
                            children: [
                              for (final order in orders) ...[
                                MerchantOrderCard(
                                  key: ValueKey('merchantShipment-${order.id}'),
                                  order: order,
                                  tripId: _activeTripId(state, order.id),
                                ),
                                const SizedBox(height: 12),
                              ],
                            ],
                          );
                        },
                      ),
                      const SizedBox(height: 8),
                      MerchantMenuRow(
                        key: const ValueKey('openMerchantMatchesFromShipments'),
                        icon: Icons.inbox_outlined,
                        label: l10n.merchantMatchInbox,
                        onTap: () => context.push('/merchant/matches'),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String? _activeTripId(MerchantDashboardState state, String orderId) {
    for (final trip in state.trips) {
      if (trip.order.id == orderId && trip.isActive) return trip.id;
    }
    return null;
  }
}
