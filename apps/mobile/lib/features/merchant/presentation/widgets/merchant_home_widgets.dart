import 'package:flutter/material.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../../core/presentation/localized_labels.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_tokens.dart';
import '../../../../core/widgets/darb_card.dart';
import '../../../../core/widgets/darb_section.dart';
import '../../../../core/widgets/status_chip.dart';
import '../../data/merchant_models.dart';
import '../../domain/merchant_home_stats.dart';
import '../merchant_ui.dart';

/// The consolidation-savings hero card.
///
/// Shows money when a source can supply it, and otherwise the distance saved —
/// which is the figure the schema actually records. It never shows a currency
/// value it cannot substantiate.
class SavingsHeroCard extends StatelessWidget {
  const SavingsHeroCard({required this.stats, super.key});

  final MerchantHomeStats stats;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final money = stats.moneySavedLabel;
    final headline =
        money ??
        (stats.distanceSavedKm > 0
            ? l10n.distanceSavedKm(stats.distanceSavedKm.toStringAsFixed(2))
            : l10n.noSavingsYet);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppTokens.spaceMedium),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
        border: Border.all(color: AppTheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.savings_outlined,
                size: 22,
                color: AppTheme.primary,
              ),
              const SizedBox(width: AppTokens.spaceSmall),
              Expanded(
                child: Text(
                  l10n.batchSavings,
                  style: theme.textTheme.titleSmall?.copyWith(
                    color: AppTheme.onSurfaceVariant,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          Text(
            headline,
            key: const ValueKey('merchantSavingsValue'),
            style:
                (stats.hasSavings
                        ? theme.textTheme.displayMedium
                        : theme.textTheme.titleMedium)
                    ?.copyWith(
                      color: AppTheme.primary,
                      fontWeight: FontWeight.w700,
                    ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          if (stats.hasSavings) ...[
            const SizedBox(height: AppTokens.spaceExtraSmall),
            Text(
              l10n.batchSavingsCaption,
              style: theme.textTheme.bodySmall?.copyWith(
                color: AppTheme.onSurfaceVariant,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ],
      ),
    );
  }
}

/// One of the two counters under the hero card.
class MerchantCountCard extends StatelessWidget {
  const MerchantCountCard({
    required this.label,
    required this.value,
    required this.caption,
    required this.icon,
    required this.iconColor,
    this.valueKey,
    super.key,
  });

  final String label;
  final String value;
  final String caption;
  final IconData icon;
  final Color iconColor;
  final Key? valueKey;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return DarbCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 22, color: iconColor),
              const SizedBox(width: AppTokens.spaceSmall),
              Expanded(
                child: Text(
                  label,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: AppTheme.onSurfaceVariant,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          Text(
            value,
            key: valueKey,
            style: theme.textTheme.displayMedium?.copyWith(
              color: AppTheme.onSurface,
              fontWeight: FontWeight.w700,
            ),
            maxLines: 1,
          ),
          Text(
            caption,
            style: theme.textTheme.bodySmall?.copyWith(
              color: AppTheme.onSurfaceVariant,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}

/// A consolidation opportunity, with the action that performs it.
class BatchSuggestionCard extends StatelessWidget {
  const BatchSuggestionCard({
    required this.suggestion,
    required this.busy,
    required this.onMerge,
    super.key,
  });

  final BatchSuggestion suggestion;
  final bool busy;
  final VoidCallback onMerge;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return DarbInfoCard(
      title: l10n.batchSuggestionTitle(
        suggestion.parcelCount,
        merchantDestinationLabel(context, suggestion.destinationLabel),
      ),
      subtitle: l10n.batchSuggestionBody,
      icon: Icons.layers_outlined,
      primaryAction: CardAction(
        key: ValueKey('mergeOrder-${suggestion.orderId}'),
        label: l10n.mergeAndSend,
        onPressed: busy ? null : onMerge,
      ),
    );
  }
}

/// One row in the recent-orders timeline.
///
/// The connector dot and rail make the sequence readable at a glance without
/// each row needing its own card.
class OrderTimelineRow extends StatelessWidget {
  const OrderTimelineRow({
    required this.order,
    required this.isLast,
    required this.onTap,
    super.key,
  });

  final MerchantOrder order;
  final bool isLast;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final tone = statusToneFor(order.status);
    final destination = order.parcels.isEmpty
        ? null
        : merchantDestinationLabel(
            context,
            order.parcels.first.destinationLabel,
          );

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Timeline rail.
          SizedBox(
            width: 20,
            child: Column(
              children: [
                Container(
                  width: 10,
                  height: 10,
                  margin: const EdgeInsets.only(top: AppTokens.spaceMedium),
                  decoration: BoxDecoration(
                    color: AppTheme.primary,
                    shape: BoxShape.circle,
                  ),
                ),
                if (!isLast)
                  Expanded(
                    child: Container(width: 2, color: AppTheme.outlineVariant),
                  ),
              ],
            ),
          ),
          const SizedBox(width: AppTokens.spaceSmall),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: AppTokens.spaceSmall),
              child: DarbCard(
                onTap: onTap,
                padding: const EdgeInsets.all(AppTokens.gutterMobile),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            l10n.orderReference(_shortReference(order.id)),
                            style: theme.textTheme.titleSmall,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            destination == null
                                ? localizedCorridorPlace(
                                    context,
                                    order.pickupLabel,
                                  )
                                : '${localizedCorridorPlace(context, order.pickupLabel)}'
                                      ' ← $destination',
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
                      label: merchantStatusLabel(l10n, order.status),
                      tone: tone,
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
}

/// Order ids are opaque cuids; the tail is enough to tell rows apart without
/// filling the row with an unreadable string.
String _shortReference(String id) {
  if (id.length <= 6) return id;
  return id.substring(id.length - 6);
}
