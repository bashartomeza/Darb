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
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/status_chip.dart';
import '../../delivery_handover/presentation/handover_code_card.dart';
import '../application/merchant_controller.dart';
import '../data/merchant_models.dart';
import 'merchant_ui.dart';

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

    return ForegroundRefresh(
      refresh: () async {
        await ref
            .read(merchantOrderProvider(widget.orderId).notifier)
            .refresh();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.orderDetails),
          actions: const [
            LanguageSwitch(),
            SizedBox(width: AppTokens.spaceSmall),
          ],
        ),
        body: SafeArea(
          top: false,
          bottom: false,
          child: RefreshIndicator(
            onRefresh: () => ref
                .read(merchantOrderProvider(widget.orderId).notifier)
                .refresh(),
            child: detail.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => ErrorStateView(
                title: merchantErrorLabel(l10n, error),
                retryLabel: l10n.retry,
                onRetry: () => ref
                    .read(merchantOrderProvider(widget.orderId).notifier)
                    .refresh(),
              ),
              data: (state) => _content(l10n, state),
            ),
          ),
        ),
      ),
    );
  }

  Widget _content(AppLocalizations l10n, MerchantOrderViewState state) {
    final order = state.order;

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppTokens.marginMobile,
        AppTokens.spaceMedium,
        AppTokens.marginMobile,
        AppTokens.spaceExtraLarge,
      ),
      children: [
        // ------------------------------------------------------------------
        // Summary: what this order is and where it stands.
        // ------------------------------------------------------------------
        MasariInfoCard(
          title: l10n.orderDetails,
          icon: Icons.inventory_2_outlined,
          statusLabel: merchantStatusLabel(l10n, order.status),
          statusTone: statusToneFor(order.status),
          statusKey: const ValueKey('merchantOrderStatus'),
          primaryAction: order.canCancel
              ? CardAction(
                  key: const ValueKey('cancelMerchantOrderButton'),
                  label: l10n.cancelRequest,
                  onPressed: _busy ? null : _cancelOrder,
                )
              : null,
          body: Column(
            children: [
              DetailRow(
                label: l10n.pickup,
                value: l10n.lockedCorridor,
                icon: Icons.place_outlined,
              ),
              DetailRow(
                label: l10n.parcelCount,
                value: '${order.parcels.length}',
                icon: Icons.widgets_outlined,
              ),
              DetailRow(
                label: l10n.createdTime,
                value: _formatDate(context, order.createdAt),
                icon: Icons.schedule_outlined,
              ),
            ],
          ),
        ),
        const SizedBox(height: AppTokens.spaceLarge),

        // ------------------------------------------------------------------
        // Receiver hand-over code: what the receiver tells the driver at delivery.
        // ------------------------------------------------------------------
        if (order.status != 'cancelled' &&
            order.status != 'failed' &&
            order.status != 'expired') ...[
          HandoverCodeCard(orderId: order.id, initial: order.handover),
          const SizedBox(height: AppTokens.spaceLarge),
        ],

        // ------------------------------------------------------------------
        // Batch: consolidating parcels into one corridor trip.
        // ------------------------------------------------------------------
        MasariSection(
          title: l10n.parcelBatch,
          child: _BatchCard(
            order: order,
            busy: _busy,
            onCreateBatch: _createBatch,
          ),
        ),
        const SizedBox(height: AppTokens.spaceLarge),

        // ------------------------------------------------------------------
        // Matching: finding a driver route for the batch.
        // ------------------------------------------------------------------
        MasariSection(
          title: l10n.matchResult,
          child: _MatchCard(state: state, busy: _busy, onRunMatch: _runMatch),
        ),

        if (_error != null) ...[
          const SizedBox(height: AppTokens.spaceMedium),
          OfflineBanner(message: _error!, tone: BannerTone.error),
        ],

        // ------------------------------------------------------------------
        // Parcels: the line items. Last, because they are reference detail
        // rather than something the merchant acts on here.
        // ------------------------------------------------------------------
        const SizedBox(height: AppTokens.spaceLarge),
        MasariSection(
          title: '${l10n.parcel} (${order.parcels.length})',
          child: Column(
            children: [
              for (final (index, parcel) in order.parcels.indexed) ...[
                _ParcelRow(index: index, parcel: parcel),
                if (index < order.parcels.length - 1)
                  const SizedBox(height: AppTokens.spaceSmall),
              ],
            ],
          ),
        ),

        const SizedBox(height: AppTokens.spaceLarge),
        DefaultTextStyle.merge(
          style: Theme.of(
            context,
          ).textTheme.labelSmall?.copyWith(color: AppTheme.onSurfaceVariant),
          textAlign: TextAlign.center,
          child: merchantTechnicalText(
            order.id,
            key: const ValueKey('merchantOrderId'),
          ),
        ),
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

/// The order's parcel batch, or the action that creates one.
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
      return MasariInfoCard(
        title: l10n.createBatch,
        subtitle: l10n.parcelBatchExplanationDemo(order.parcels.length),
        icon: Icons.layers_outlined,
        emphasis: order.canBatch,
        primaryAction: CardAction(
          key: const ValueKey('createBatchButton'),
          label: l10n.createBatch,
          onPressed: busy || !order.canBatch ? null : onCreateBatch,
        ),
      );
    }

    return MasariInfoCard(
      title: l10n.parcelBatch,
      icon: Icons.layers_outlined,
      statusLabel: merchantStatusLabel(l10n, batch.status),
      statusTone: statusToneFor(batch.status),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DetailRow(
            label: l10n.estimatedDistanceSaved,
            value: '${batch.estimatedDistanceSaved.toStringAsFixed(2)} km',
            icon: Icons.eco_outlined,
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          ExplanationNote(
            message: l10n.parcelBatchExplanationDemo(order.parcels.length),
            icon: Icons.layers_outlined,
          ),
        ],
      ),
    );
  }
}

/// Matching state for the order: run it, or show where the result stands.
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
    final match = state.latestMatch;

    if (match == null || state.canRunMatch) {
      return MasariInfoCard(
        title: l10n.runMatching,
        subtitle: state.canRunMatch ? null : l10n.matchingUnavailable,
        icon: Icons.travel_explore_outlined,
        emphasis: state.canRunMatch,
        primaryAction: state.canRunMatch
            ? CardAction(
                key: const ValueKey('runMerchantMatchButton'),
                label: l10n.runMatching,
                onPressed: busy ? null : onRunMatch,
              )
            : null,
      );
    }

    return MasariInfoCard(
      title: l10n.matchResult,
      icon: Icons.travel_explore_outlined,
      statusLabel: merchantStatusLabel(l10n, match.status),
      statusTone: statusToneFor(match.status),
      primaryAction: CardAction(
        key: const ValueKey('openOrderMatch'),
        label: l10n.viewDetails,
        onPressed: () => context.go('/merchant/match/${match.id}'),
      ),
      secondaryAction: state.trip != null
          ? CardAction(
              key: const ValueKey('openOrderTrip'),
              label: l10n.openTrip,
              filled: false,
              onPressed: () => context.go('/merchant/trip/${state.trip!.id}'),
            )
          : null,
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
        color: AppTheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
        border: Border.all(color: AppTheme.outlineVariant),
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
                  merchantDestinationLabel(context, parcel.destinationLabel),
                  style: theme.textTheme.titleSmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  '${parcel.size} · ${merchantPriorityLabel(l10n, parcel.priority)}',
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
          StatusChip(
            label: merchantStatusLabel(l10n, parcel.status),
            tone: statusToneFor(parcel.status),
          ),
        ],
      ),
    );
  }
}

String _formatDate(BuildContext context, DateTime value) {
  return MaterialLocalizations.of(context).formatMediumDate(value.toLocal());
}
