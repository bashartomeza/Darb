import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/app_tokens.dart';
import 'darb_card.dart';
import 'status_chip.dart';

/// Maps a domain status string to a semantic tone.
///
/// Centralised so a status reads the same colour everywhere. Unknown values
/// fall back to neutral rather than guessing.
StatusTone statusToneFor(String status) => switch (status) {
  'completed' || 'delivered' || 'accepted' || 'active' => StatusTone.success,
  'cancelled' || 'rejected' || 'expired' => StatusTone.error,
  'in_transit' ||
  'picked_up' ||
  'pickup_started' ||
  'on_trip' ||
  'assigned' ||
  'matched' => StatusTone.active,
  'pending' ||
  'proposed' ||
  'sent_to_driver' ||
  'submitted' ||
  'batched' ||
  'created' ||
  'draft' => StatusTone.pending,
  _ => StatusTone.neutral,
};

/// A titled group of content on a dashboard.
///
/// Section titles live *outside* the card. Putting the title on the surface
/// with the data made every card open with a same-weight line of text, which is
/// what made the old dashboards hard to scan.
class DarbSection extends StatelessWidget {
  const DarbSection({
    required this.title,
    required this.child,
    this.titleKey,
    this.actionLabel,
    this.onAction,
    super.key,
  });

  final String title;
  final Widget child;

  /// Applied to the title's [Text], for widget tests that assert on it.
  final Key? titleKey;

  /// An optional inline text action, e.g. "See all".
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                title,
                key: titleKey,
                style: theme.textTheme.titleSmall?.copyWith(
                  color: AppTheme.onSurfaceVariant,
                  letterSpacing: 0.4,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (actionLabel != null && onAction != null)
              TextButton(
                onPressed: onAction,
                style: TextButton.styleFrom(
                  minimumSize: const Size(0, AppTokens.minTouchTarget),
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppTokens.spaceSmall,
                  ),
                  textStyle: theme.textTheme.labelLarge,
                ),
                child: Text(actionLabel!),
              ),
          ],
        ),
        const SizedBox(height: AppTokens.spaceSmall),
        child,
      ],
    );
  }
}

/// One label/value pair inside a card.
///
/// The label is small and muted, the value carries the weight — so a column of
/// these can be scanned by value alone. Replaces the old
/// `Text('$label: $value')` pattern, which gave both halves equal emphasis and
/// broke under RTL when the value was Latin text.
class DetailRow extends StatelessWidget {
  const DetailRow({
    required this.label,
    required this.value,
    this.icon,
    this.valueKey,
    super.key,
  });

  final String label;
  final String value;
  final IconData? icon;

  /// Applied to the value's [Text], for widget tests that assert on it.
  final Key? valueKey;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppTokens.spaceExtraSmall),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null) ...[
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Icon(icon, size: 16, color: AppTheme.onSurfaceVariant),
            ),
            const SizedBox(width: AppTokens.spaceSmall),
          ],
          // The label sizes to its text and the value takes the slack: labels
          // are short and fixed, values are not. Sharing the row evenly
          // squeezed long localised datetimes into a ragged two-line wrap.
          Flexible(
            child: Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(
                color: AppTheme.onSurfaceVariant,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: AppTokens.gutterMobile),
          Expanded(
            child: Text(
              value,
              key: valueKey,
              textAlign: TextAlign.end,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The app's standard content card.
///
/// A fixed anatomy — title row with status, body, then a single action row —
/// so every card in the app is read the same way. Optional parts collapse
/// entirely rather than leaving gaps.
class DarbInfoCard extends StatelessWidget {
  const DarbInfoCard({
    required this.title,
    this.subtitle,
    this.icon,
    this.statusLabel,
    this.statusTone = StatusTone.neutral,
    this.titleKey,
    this.statusKey,
    this.body,
    this.primaryAction,
    this.secondaryAction,
    this.onTap,
    this.emphasis = false,
    super.key,
  });

  final String title;
  final String? subtitle;
  final IconData? icon;
  final String? statusLabel;
  final StatusTone statusTone;
  final Key? titleKey;

  /// Applied to the status chip, for widget tests that assert on it.
  final Key? statusKey;

  /// Body content, typically a column of [DetailRow]s.
  ///
  /// Named `body` rather than `child` because it is one slot among several,
  /// not the card's only content.
  final Widget? body;

  /// Rendered as a filled button. At most one per card: a card with several
  /// equally-weighted buttons gives the user no idea what to do next.
  final Widget? primaryAction;

  /// Rendered as a text/outlined action next to [primaryAction].
  final Widget? secondaryAction;

  final VoidCallback? onTap;

  /// Tints the card to mark the one thing that needs attention on the screen.
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasActions = primaryAction != null || secondaryAction != null;

    return DarbCard(
      onTap: onTap,
      background: emphasis ? AppTheme.surfaceContainerLow : null,
      border: emphasis
          ? const BorderSide(color: AppTheme.primary, width: 1.5)
          : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 20, color: AppTheme.primary),
                const SizedBox(width: AppTokens.spaceSmall),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      key: titleKey,
                      style: theme.textTheme.titleMedium,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitle!,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: AppTheme.onSurfaceVariant,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              if (statusLabel != null) ...[
                const SizedBox(width: AppTokens.spaceSmall),
                StatusChip(
                  key: statusKey,
                  label: statusLabel!,
                  tone: statusTone,
                ),
              ],
            ],
          ),
          if (body != null) ...[
            const SizedBox(height: AppTokens.gutterMobile),
            body!,
          ],
          if (hasActions) ...[
            const SizedBox(height: AppTokens.gutterMobile),
            _ActionRow(primary: primaryAction, secondary: secondaryAction),
          ],
        ],
      ),
    );
  }
}

/// Lays out a card's actions.
///
/// Actions are end-aligned and sized to their label rather than stretched: a
/// full-width button inside a card reads as the screen's main action, which it
/// is not.
class _ActionRow extends StatelessWidget {
  const _ActionRow({this.primary, this.secondary});

  final Widget? primary;
  final Widget? secondary;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        if (secondary != null) Flexible(child: secondary!),
        const Spacer(),
        if (primary != null) ...[
          if (secondary != null) const SizedBox(width: AppTokens.spaceSmall),
          Flexible(child: primary!),
        ],
      ],
    );
  }
}

/// A compact action button sized for use inside a card.
///
/// The theme stretches [FilledButton] to full width, which is right for a
/// screen's main action and wrong inside a card; this constrains it back.
class CardAction extends StatelessWidget {
  const CardAction({
    required this.label,
    required this.onPressed,
    this.filled = true,
    this.icon,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool filled;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final style = ButtonStyle(
      minimumSize: WidgetStatePropertyAll(Size(0, AppTokens.minTouchTarget)),
      padding: const WidgetStatePropertyAll(
        EdgeInsets.symmetric(horizontal: AppTokens.spaceMedium),
      ),
    );
    final child = Text(label, maxLines: 1, overflow: TextOverflow.ellipsis);

    if (!filled) {
      return icon == null
          ? OutlinedButton(onPressed: onPressed, style: style, child: child)
          : OutlinedButton.icon(
              onPressed: onPressed,
              style: style,
              icon: Icon(icon, size: 18),
              label: child,
            );
    }
    return icon == null
        ? FilledButton(onPressed: onPressed, style: style, child: child)
        : FilledButton.icon(
            onPressed: onPressed,
            style: style,
            icon: Icon(icon, size: 18),
            label: child,
          );
  }
}

/// A row of small stats, e.g. "3 proposed · 1 active".
///
/// Kept to three entries at most: past that it stops being glanceable.
class StatStrip extends StatelessWidget {
  const StatStrip({required this.stats, super.key});

  final List<({String label, String value, Key? valueKey})> stats;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final (index, stat) in stats.indexed) ...[
          if (index > 0)
            Container(
              width: 1,
              height: 28,
              margin: const EdgeInsets.symmetric(
                horizontal: AppTokens.gutterMobile,
              ),
              color: AppTheme.outlineVariant,
            ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  stat.value,
                  key: stat.valueKey,
                  style: theme.textTheme.titleLarge?.copyWith(
                    color: AppTheme.primary,
                    fontWeight: FontWeight.w700,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  stat.label,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: AppTheme.onSurfaceVariant,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}
