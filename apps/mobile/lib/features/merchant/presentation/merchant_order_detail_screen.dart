import '../../../core/widgets/foreground_refresh.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/state_views.dart';
import '../../canonical_routes/presentation/canonical_route_widgets.dart';
import '../../delivery_handover/presentation/handover_code_card.dart';
import '../application/merchant_controller.dart';
import '../data/merchant_models.dart';
import 'merchant_order_route_map.dart';
import 'merchant_ui.dart';
import '../../../core/theme/merchant_theme.dart';
import '../../auth/application/auth_controller.dart';
import 'widgets/merchant_design.dart';

class MerchantOrderDetailScreen extends ConsumerStatefulWidget {
  const MerchantOrderDetailScreen({required this.orderId, super.key});
  final String orderId;

  @override
  ConsumerState<MerchantOrderDetailScreen> createState() =>
      _MerchantOrderDetailScreenState();
}

class _MerchantOrderDetailScreenState
    extends ConsumerState<MerchantOrderDetailScreen> {
  bool _busy = false;
  String? _error;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final detail = ref.watch(merchantOrderProvider(widget.orderId));
    Future<void> refresh() async {
      await ref.read(merchantOrderProvider(widget.orderId).notifier).refresh();
    }

    return ForegroundRefresh(
      refresh: refresh,
      child: Scaffold(
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              MerchantHeader(
                title: l10n.orderDetails,
                fallback: '/merchant/shipments',
              ),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: refresh,
                  child: detail.when(
                    loading: () =>
                        const Center(child: CircularProgressIndicator()),
                    error: (error, _) => ErrorStateView(
                      title: merchantErrorLabel(l10n, error),
                      retryLabel: l10n.retry,
                      onRetry: refresh,
                    ),
                    data: (state) => _content(l10n, state),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _content(AppLocalizations l10n, MerchantOrderViewState state) {
    final order = state.order;
    final user = ref.watch(authControllerProvider).value?.user;
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
      children: [
        MerchantCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      merchantReference(order.id),
                      key: const ValueKey('merchantOrderId'),
                      style: MerchantStyle.text(
                        size: 20,
                        weight: FontWeight.w700,
                      ),
                    ),
                  ),
                  MerchantStatusPill(
                    key: const ValueKey('merchantOrderStatus'),
                    status: order.status,
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  const Icon(
                    Icons.inventory_2_outlined,
                    color: MerchantStyle.orange,
                    size: 17,
                  ),
                  const SizedBox(width: 7),
                  Text(
                    '${order.parcels.length} ${l10n.parcel}',
                    style: MerchantStyle.text(size: 13),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        // Route orders name their predefined route; older orders have none.
        if (order.routeName(arabic: _arabic(context)) case final route?) ...[
          MerchantInfoTile(
            icon: Icons.route_outlined,
            title: l10n.orderRouteLabel,
            value: route,
            valueKey: const ValueKey('merchantOrderRoute'),
          ),
          const SizedBox(height: 12),
        ],
        MerchantInfoTile(
          icon: Icons.storefront_outlined,
          title: merchantText(context, 'المنتجات', 'Shipment'),
          value:
              '${user?.name ?? l10n.merchant} · ${l10n.parcelCount}: ${order.parcels.length}',
        ),
        const SizedBox(height: 12),
        MerchantInfoTile(
          icon: Icons.person_outline_rounded,
          title: merchantText(context, 'التسليم', 'Delivery'),
          value: merchantOrderDestination(context, order),
        ),
        const SizedBox(height: 12),
        MerchantInfoTile(
          icon: Icons.location_on_outlined,
          title: l10n.pickup,
          value: merchantPickupText(context, order),
          valueKey: const ValueKey('merchantOrderPickup'),
        ),
        const SizedBox(height: 12),
        MerchantInfoTile(
          icon: Icons.access_time_rounded,
          title: l10n.createdTime,
          value:
              '${_formatDate(context, order.createdAt)} · ${MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(order.createdAt))}',
        ),
        // The fare frozen at creation; absent when the route had no fare.
        if (order.fare != null) ...[
          const SizedBox(height: 4),
          fareSnapshotBox(context, order.fare),
        ],
        // The order's own pickup and parcel drop-offs on the map.
        if (order.routeWaypoints.length >= 2) ...[
          const SizedBox(height: 16),
          Text(
            l10n.merchantOrderMapTitle,
            style: MerchantStyle.text(size: 16, weight: FontWeight.w700),
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(MerchantStyle.radius),
            child: MerchantOrderRouteMap(
              key: const ValueKey('merchantOrderMap'),
              order: order,
            ),
          ),
        ],
        const SizedBox(height: 16),
        _BatchCard(order: order, busy: _busy, onCreateBatch: _createBatch),
        const SizedBox(height: 12),
        _MatchCard(state: state, busy: _busy, onRunMatch: _runMatch),
        if (_error != null) ...[
          const SizedBox(height: 12),
          OfflineBanner(message: _error!, tone: BannerTone.error),
        ],
        if (order.status != 'cancelled' &&
            order.status != 'failed' &&
            order.status != 'expired') ...[
          const SizedBox(height: 20),
          HandoverCodeCard(orderId: order.id, initial: order.handover),
        ],
        const SizedBox(height: 20),
        Text(
          '${l10n.parcel} (${order.parcels.length})',
          style: MerchantStyle.text(size: 16, weight: FontWeight.w700),
        ),
        const SizedBox(height: 12),
        for (final (index, parcel) in order.parcels.indexed) ...[
          _ParcelRow(index: index, parcel: parcel),
          const SizedBox(height: 10),
        ],
        if (order.canCancel) ...[
          const SizedBox(height: 12),
          TextButton(
            key: const ValueKey('cancelMerchantOrderButton'),
            onPressed: _busy ? null : _cancelOrder,
            child: Text(l10n.cancelRequest),
          ),
        ],
      ],
    );
  }

  Future<void> _cancelOrder() => _action(() async {
    await ref
        .read(merchantOrderProvider(widget.orderId).notifier)
        .cancelOrder();
  });

  Future<void> _createBatch() => _action(() async {
    await ref
        .read(merchantOrderProvider(widget.orderId).notifier)
        .createBatch();
  });

  Future<void> _runMatch() => _action(() async {
    final match = await ref
        .read(merchantOrderProvider(widget.orderId).notifier)
        .runMatch();
    if (mounted) context.go('/merchant/match/${match.id}');
  });

  Future<void> _action(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) {
        setState(
          () =>
              _error = merchantErrorLabel(AppLocalizations.of(context), error),
        );
        await ref
            .read(merchantOrderProvider(widget.orderId).notifier)
            .refresh();
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _BatchCard extends StatelessWidget {
  const _BatchCard({
    required this.order,
    required this.busy,
    required this.onCreateBatch,
  });
  final MerchantOrder order;
  final bool busy;
  final VoidCallback onCreateBatch;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final batch = order.latestBatch;
    if (batch == null) {
      if (!order.canBatch) return const SizedBox.shrink();
      return FilledButton(
        key: const ValueKey('createBatchButton'),
        onPressed: busy ? null : onCreateBatch,
        child: Text(l10n.createBatch),
      );
    }
    return MerchantInfoTile(
      icon: Icons.layers_outlined,
      title: l10n.parcelBatch,
      value:
          '${l10n.estimatedDistanceSaved}: ${batch.estimatedDistanceSaved.toStringAsFixed(2)} km',
    );
  }
}

class _MatchCard extends StatelessWidget {
  const _MatchCard({
    required this.state,
    required this.busy,
    required this.onRunMatch,
  });
  final MerchantOrderViewState state;
  final bool busy;
  final VoidCallback onRunMatch;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    if (state.canRunMatch) {
      return FilledButton(
        key: const ValueKey('runMerchantMatchButton'),
        onPressed: busy ? null : onRunMatch,
        child: Text(l10n.runMatching),
      );
    }
    final match = state.latestMatch;
    return Column(
      children: [
        if (state.trip != null)
          FilledButton.icon(
            key: const ValueKey('openOrderTrip'),
            onPressed: () => context.push('/merchant/trip/${state.trip!.id}'),
            icon: const Icon(Icons.local_shipping_outlined, size: 20),
            label: Text(
              merchantText(context, 'متابعة التوصيل', 'Track delivery'),
            ),
          ),
        if (match != null) ...[
          if (state.trip != null) const SizedBox(height: 12),
          MerchantMenuRow(
            key: const ValueKey('openOrderMatch'),
            icon: Icons.route_outlined,
            label:
                '${l10n.matchResult} · ${merchantStatusLabel(l10n, match.status)}',
            onTap: () => context.push('/merchant/match/${match.id}'),
          ),
        ],
      ],
    );
  }
}

/// One parcel line item.
///
/// A dense row rather than a card: parcels are scanned as a list, and eleven
/// stacked cards buried the actions above them.
class _ParcelRow extends StatelessWidget {
  const _ParcelRow({required this.index, required this.parcel});

  final int index;
  final MerchantParcel parcel;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.all(AppTokens.gutterMobile),
      decoration: BoxDecoration(
        color: MerchantStyle.card,
        borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
        border: Border.all(color: MerchantStyle.border),
      ),
      child: Row(
        children: [
          // The index doubles as the parcel's label on a physical package.
          Container(
            width: 32,
            height: 32,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppTheme.surfaceContainer,
              borderRadius: BorderRadius.circular(AppTokens.radiusDefault),
            ),
            child: Text(
              '${index + 1}',
              style: theme.textTheme.labelLarge?.copyWith(
                color: AppTheme.primary,
              ),
            ),
          ),
          const SizedBox(width: AppTokens.gutterMobile),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  merchantParcelDropoffText(context, parcel),
                  key: ValueKey('merchantParcelDropoff-$index'),
                  style: theme.textTheme.titleSmall,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  [
                    parcel.size,
                    merchantPriorityLabel(l10n, parcel.priority),
                    if (parcel.receiverName != null)
                      '${l10n.merchantReceiverLabel}: ${parcel.receiverName}',
                  ].join(' · '),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: AppTheme.onSurfaceVariant,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: AppTokens.spaceSmall),
          MerchantStatusPill(status: parcel.status),
        ],
      ),
    );
  }
}

bool _arabic(BuildContext context) =>
    Localizations.localeOf(context).languageCode == 'ar';

String _formatDate(BuildContext context, DateTime value) {
  return MaterialLocalizations.of(context).formatMediumDate(value.toLocal());
}
