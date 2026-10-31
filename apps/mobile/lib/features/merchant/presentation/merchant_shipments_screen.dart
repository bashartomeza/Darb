import '../../../core/widgets/foreground_refresh.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/presentation/localized_labels.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_section.dart';
import '../../../core/widgets/route_chip.dart';
import '../../../core/widgets/state_views.dart';
import '../application/merchant_controller.dart';
import '../data/merchant_models.dart';
import 'merchant_ui.dart';

/// The merchant's "Shipments" tab.
///
/// This destination previously rooted at the match inbox while being labelled
/// "orders", so the merchant's own shipments — the thing `GET /merchant/orders`
/// returns — had no list of their own and appeared only as a "recent" strip on
/// the home screen. The tab now lists every order with its parcels, batch state
/// and a route into tracking; the match inbox is reachable from the section
/// below it, where it belongs.
class MerchantShipmentsScreen extends ConsumerWidget {
  const MerchantShipmentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final dashboard = ref.watch(merchantDashboardProvider);

    return ForegroundRefresh(
      refresh: () async {
        await ref.read(merchantDashboardProvider.notifier).refresh();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.shipmentsTitle),
          actions: const [
            LanguageSwitch(),
            SizedBox(width: AppTokens.spaceSmall),
          ],
        ),
        body: SafeArea(
          top: false,
          bottom: false,
          child: RefreshIndicator(
            onRefresh: () =>
                ref.read(merchantDashboardProvider.notifier).refresh(),
            child: ListView(
              key: const ValueKey('merchantShipmentsList'),
              padding: const EdgeInsets.fromLTRB(
                AppTokens.marginMobile,
                AppTokens.spaceMedium,
                AppTokens.marginMobile,
                AppTokens.spaceExtraLarge,
              ),
              children: [
                dashboard.when(
                  skipError: dashboard.hasValue,
                  loading: () => const Column(
                    children: [
                      LoadingSkeleton.card(),
                      SizedBox(height: AppTokens.spaceMedium),
                      LoadingSkeleton.card(),
                    ],
                  ),
                  error: (error, _) => ErrorStateView(
                    title: l10n.shipmentsFailed,
                    message: merchantErrorLabel(l10n, error),
                    retryLabel: l10n.retry,
                    onRetry: () =>
                        ref.read(merchantDashboardProvider.notifier).refresh(),
                  ),
                  data: (state) => state.orders.isEmpty
                      ? EmptyState(
                          title: l10n.noShipments,
                          message: l10n.noShipmentsBody,
                          icon: Icons.inventory_2_outlined,
                          actionLabel: l10n.createShipment,
                          onAction: () => context.go('/merchant/order/new'),
                        )
                      : Column(
                          children: [
                            for (final (index, order)
                                in state.orders.indexed) ...[
                              if (index > 0)
                                const SizedBox(height: AppTokens.spaceMedium),
                              _OrderCard(
                                order: order,
                                // Only the live trip gets a tracking action; the
                                // trips endpoint carries no order id, so tying it
                                // to any other row would be a guess.
                                tripId: index == 0
                                    ? state.activeTrip?.id
                                    : null,
                              ),
                            ],
                          ],
                        ),
                ),

                const SizedBox(height: AppTokens.spaceLarge),
                MasariSection(
                  title: l10n.merchantMatchInbox,
                  child: MasariInfoCard(
                    title: l10n.matchInbox,
                    icon: Icons.inbox_outlined,
                    body: StatStrip(
                      stats: [
                        (
                          label: l10n.waitingForDriver,
                          value: '${dashboard.value?.waitingMatchCount ?? 0}',
                          valueKey: const ValueKey(
                            'shipmentsWaitingMatchCount',
                          ),
                        ),
                      ],
                    ),
                    primaryAction: CardAction(
                      key: const ValueKey('openMerchantMatchesFromShipments'),
                      label: l10n.viewDetails,
                      onPressed: () => context.go('/merchant/matches'),
                    ),
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

class _OrderCard extends StatelessWidget {
  const _OrderCard({required this.order, this.tripId});

  final MerchantOrder order;
  final String? tripId;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final material = MaterialLocalizations.of(context);
    final batch = order.latestBatch;

    // Parcels can fan out to several destinations, so the card names the set
    // rather than pretending there is one.
    final destinations = {
      for (final parcel in order.parcels)
        merchantDestinationLabel(context, parcel.destinationLabel),
    };

    return MasariInfoCard(
      key: ValueKey('merchantShipment-${order.id}'),
      title: l10n.orderReference(order.id.substring(0, 6)),
      icon: Icons.inventory_2_outlined,
      statusLabel: merchantStatusLabel(l10n, order.status),
      statusTone: statusToneFor(order.status),
      body: Column(
        children: [
          RouteChip(
            from: localizedCorridorPlace(context, order.pickupLabel),
            // A bare count would read as a place name, so the plural case is
            // spelled out.
            to: destinations.length == 1
                ? destinations.first
                : l10n.destinationCount(destinations.length),
            compact: true,
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          DetailRow(
            label: l10n.parcelCount,
            value: '${order.parcels.length}',
            icon: Icons.widgets_outlined,
          ),
          DetailRow(
            label: l10n.created,
            value: material.formatCompactDate(order.createdAt),
            icon: Icons.event_outlined,
          ),
          if (batch != null)
            DetailRow(
              label: l10n.parcelBatch,
              value: merchantStatusLabel(l10n, batch.status),
              icon: Icons.merge_type_outlined,
            ),
        ],
      ),
      primaryAction: CardAction(
        label: l10n.orderDetails,
        onPressed: () => context.go('/merchant/order/${order.id}'),
      ),
      secondaryAction: tripId == null
          ? null
          : CardAction(
              label: l10n.openTrip,
              filled: false,
              onPressed: () => context.go('/merchant/trip/$tripId'),
            ),
    );
  }
}
