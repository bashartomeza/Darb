import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/app_tokens.dart';
import '../theme/semantic_colors.dart';

/// The semantic tones a status can carry, matching design-system.html §G
/// "Status chip vocabulary — the fixed six" (searching/confirmed/
/// progress/completed/delayed/cancelled), plus a neutral fallback for
/// anything outside that vocabulary (e.g. an archived-record badge).
enum StatusTone { success, warning, error, pending, active, confirmed, neutral }

/// A pill-shaped status indicator.
///
/// Fully rounded on purpose: the design system uses pill shapes for state and
/// 8px radii for actions, so a chip is never mistaken for a button.
///
/// The label is supplied by the caller already localised — this widget maps
/// *tone* to colour, not meaning to text.
class StatusChip extends StatelessWidget {
  const StatusChip({
    required this.label,
    this.tone = StatusTone.neutral,
    this.icon,
    super.key,
  });

  final String label;
  final StatusTone tone;
  final IconData? icon;

  ({Color background, Color foreground}) get _palette => switch (tone) {
    StatusTone.success => (
      background: SemanticColors.successContainer,
      foreground: SemanticColors.onSuccessContainer,
    ),
    StatusTone.warning => (
      background: SemanticColors.warningContainer,
      foreground: SemanticColors.onWarningContainer,
    ),
    StatusTone.error => (
      background: SemanticColors.errorContainer,
      foreground: SemanticColors.onErrorContainer,
    ),
    StatusTone.pending => (
      background: SemanticColors.pendingContainer,
      foreground: SemanticColors.onPendingContainer,
    ),
    StatusTone.active => (
      background: AppTheme.primaryContainer,
      foreground: AppTheme.onPrimaryContainer,
    ),
    StatusTone.confirmed => (
      background: SemanticColors.infoContainer,
      foreground: SemanticColors.onInfoContainer,
    ),
    StatusTone.neutral => (
      background: AppTheme.surfaceContainerHigh,
      foreground: AppTheme.onSurfaceVariant,
    ),
  };

  @override
  Widget build(BuildContext context) {
    final palette = _palette;

    return Container(
      padding: const EdgeInsetsDirectional.symmetric(
        horizontal: AppTokens.gutterMobile,
        vertical: AppTokens.spaceExtraSmall + 2,
      ),
      decoration: BoxDecoration(
        color: palette.background,
        borderRadius: BorderRadius.circular(AppTokens.radiusFull),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 14, color: palette.foreground),
            const SizedBox(width: AppTokens.spaceExtraSmall),
          ],
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(
                context,
              ).textTheme.labelMedium?.copyWith(color: palette.foreground),
            ),
          ),
        ],
      ),
    );
  }
}
