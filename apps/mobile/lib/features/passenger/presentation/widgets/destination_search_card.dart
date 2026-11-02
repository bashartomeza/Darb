import 'package:flutter/material.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_tokens.dart';

/// The "where do you want to go?" entry point.
///
/// The field is a button, not a text input: the corridor is fixed, so there is
/// nothing to free-text search against. Tapping opens the request flow, which
/// is where a destination is actually chosen. Styling it as a search field
/// keeps the familiar affordance without implying a search API that does not
/// exist.
class DestinationSearchCard extends StatelessWidget {
  const DestinationSearchCard({required this.onTap, super.key});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);

    return Container(
      padding: const EdgeInsets.all(AppTokens.spaceMedium),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
        border: Border.all(color: AppTheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            Localizations.localeOf(context).languageCode == 'ar'
                ? 'رحلة جديدة'
                : 'NEW RIDE',
            textAlign: TextAlign.center,
            style: theme.textTheme.labelSmall?.copyWith(
              color: AppTheme.tertiary,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            l10n.whereToGo,
            textAlign: TextAlign.center,
            style: theme.textTheme.headlineMedium?.copyWith(
              color: AppTheme.primary,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            Localizations.localeOf(context).languageCode == 'ar'
                ? 'حدد نقطة الانطلاق والوجهة، لنساعدك في إيجاد الرحلة المناسبة.'
                : 'Choose your pickup and destination to find a suitable ride.',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          Material(
            color: AppTheme.surfaceContainerLowest,
            borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
            child: InkWell(
              key: const ValueKey('openDestinationSearch'),
              onTap: onTap,
              borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
              child: Container(
                constraints: const BoxConstraints(
                  minHeight: AppTokens.buttonHeight,
                ),
                padding: const EdgeInsets.symmetric(
                  horizontal: AppTokens.gutterMobile,
                  vertical: AppTokens.spaceSmall,
                ),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
                  border: Border.all(color: AppTheme.outlineVariant),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.search,
                      size: 22,
                      color: AppTheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: AppTokens.spaceSmall),
                    Expanded(
                      child: Text(
                        l10n.destinationSearchHint,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: AppTheme.onSurfaceVariant,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: AppTokens.spaceSmall),
                    const _SmartSearchBadge(),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            key: const ValueKey('searchForTripCta'),
            onPressed: onTap,
            icon: const Icon(Icons.search, size: 20),
            label: Text(l10n.searchForTrip),
          ),
        ],
      ),
    );
  }
}

/// The accent badge on the search field.
class _SmartSearchBadge extends StatelessWidget {
  const _SmartSearchBadge();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTokens.gutterMobile,
        vertical: AppTokens.spaceExtraSmall + 2,
      ),
      decoration: BoxDecoration(
        // A highlight badge, not an action — orange is reserved for the one
        // actionable element per screen, so this stays on the structural
        // navy accent instead.
        color: AppTheme.primaryContainer,
        borderRadius: BorderRadius.circular(AppTokens.radiusDefault),
      ),
      child: Text(
        l10n.smartSearch,
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
          color: AppTheme.onPrimaryContainer,
          fontWeight: FontWeight.w700,
        ),
        maxLines: 1,
      ),
    );
  }
}

/// One tappable shortcut to a destination.
class QuickDestinationChip {
  const QuickDestinationChip({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;
}

/// A horizontally scrolling row of destination shortcuts.
///
/// Scrolls rather than wraps so the row keeps a predictable height whatever the
/// catalog returns, and long Arabic route names do not reflow the screen.
class QuickDestinationChips extends StatelessWidget {
  const QuickDestinationChips({required this.chips, super.key});

  final List<QuickDestinationChip> chips;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return SizedBox(
      height: AppTokens.minTouchTarget + AppTokens.spaceSmall,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: EdgeInsets.zero,
        itemCount: chips.length,
        separatorBuilder: (context, _) =>
            const SizedBox(width: AppTokens.spaceSmall),
        itemBuilder: (context, index) {
          final chip = chips[index];
          return Material(
            color: AppTheme.surfaceContainerLowest,
            borderRadius: BorderRadius.circular(AppTokens.radiusFull),
            child: InkWell(
              onTap: chip.onTap,
              borderRadius: BorderRadius.circular(AppTokens.radiusFull),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppTokens.spaceMedium,
                ),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(AppTokens.radiusFull),
                  border: Border.all(color: AppTheme.outlineVariant),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(chip.icon, size: 18, color: AppTheme.primary),
                    const SizedBox(width: AppTokens.spaceSmall),
                    Text(
                      chip.label,
                      style: theme.textTheme.bodyMedium,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
