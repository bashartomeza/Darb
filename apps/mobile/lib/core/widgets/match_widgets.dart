import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/app_tokens.dart';
import '../theme/semantic_colors.dart';
import 'masari_section.dart';
import 'route_chip.dart';
import 'status_chip.dart';

/// Formats a 0..1 score as a percentage.
///
/// Always Latin digits and one decimal, matching what the API reports, so the
/// figure is comparable between offers and identical in both locales.
String scorePercent(double value) => '${(value * 100).toStringAsFixed(1)}%';

/// A single match score, shown as a figure over a thin meter.
///
/// A driver ranks offers by this number, so it gets the largest type on the
/// card. The bar exists to make two scores comparable without reading digits;
/// the figure is always present, so the meaning never rests on the bar alone.
class MatchScore extends StatelessWidget {
  const MatchScore({
    required this.score,
    required this.label,
    this.compact = false,
    super.key,
  });

  /// 0..1.
  final double score;

  /// Localised caption, e.g. "Match score".
  final String label;

  final bool compact;

  Color get _tone {
    if (score >= 0.8) return SemanticColors.success;
    if (score >= 0.6) return SemanticColors.warning;
    return AppTheme.onSurfaceVariant;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final clamped = score.clamp(0.0, 1.0);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          scorePercent(score),
          style:
              (compact
                      ? theme.textTheme.titleMedium
                      : theme.textTheme.headlineSmall)
                  ?.copyWith(color: _tone, fontWeight: FontWeight.w700),
          maxLines: 1,
        ),
        Text(
          label,
          style: theme.textTheme.labelSmall?.copyWith(
            color: AppTheme.onSurfaceVariant,
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: AppTokens.spaceExtraSmall),
        SizedBox(
          width: compact ? 56 : 72,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppTokens.radiusFull),
            child: LinearProgressIndicator(
              value: clamped,
              minHeight: 4,
              backgroundColor: AppTheme.surfaceContainerHigh,
              valueColor: AlwaysStoppedAnimation(_tone),
            ),
          ),
        ),
      ],
    );
  }
}

/// One match in an inbox list.
///
/// Anatomy is fixed: what the job is and its state on the first line, the
/// corridor beneath it, the score pinned to the trailing edge, then any
/// load details, then a single action. Scanning a column of these means
/// reading one line and one number per row.
class MatchResultCard extends StatelessWidget {
  const MatchResultCard({
    required this.title,
    required this.score,
    required this.scoreLabel,
    this.from,
    this.to,
    this.statusLabel,
    this.statusTone = StatusTone.neutral,
    this.details = const [],
    this.actionLabel,
    this.onAction,
    this.actionKey,
    this.onTap,
    super.key,
  });

  final String title;
  final double score;
  final String scoreLabel;
  final String? from;
  final String? to;
  final String? statusLabel;
  final StatusTone statusTone;

  /// Load details such as passenger or parcel counts.
  final List<({String label, String value, IconData icon})> details;

  final String? actionLabel;
  final VoidCallback? onAction;
  final Key? actionKey;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return MasariInfoCard(
      title: title,
      statusLabel: statusLabel,
      statusTone: statusTone,
      onTap: onTap,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              if (from != null && to != null)
                Expanded(
                  child: RouteChip(from: from!, to: to!, compact: true),
                )
              else
                const Spacer(),
              const SizedBox(width: AppTokens.gutterMobile),
              MatchScore(score: score, label: scoreLabel, compact: true),
            ],
          ),
          if (details.isNotEmpty) ...[
            const SizedBox(height: AppTokens.spaceSmall),
            const Divider(height: AppTokens.spaceMedium),
            for (final detail in details)
              DetailRow(
                label: detail.label,
                value: detail.value,
                icon: detail.icon,
              ),
          ],
        ],
      ),
      primaryAction: actionLabel != null && onAction != null
          ? CardAction(key: actionKey, label: actionLabel!, onPressed: onAction)
          : null,
    );
  }
}

/// The scoring factors behind a match.
///
/// Rendered as labelled meters rather than a list of "factor: 94.0%" lines, so
/// the weakest factor is visible without comparing five numbers by eye. Each
/// row still shows its exact figure — the bar never carries the value alone.
class ScoreBreakdownList extends StatelessWidget {
  const ScoreBreakdownList({required this.factors, super.key});

  final List<({String label, double value})> factors;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final factor in factors)
          Padding(
            padding: const EdgeInsets.only(bottom: AppTokens.gutterMobile),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        factor.label,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: AppTheme.onSurfaceVariant,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: AppTokens.spaceSmall),
                    Text(
                      scorePercent(factor.value),
                      style: theme.textTheme.labelLarge,
                    ),
                  ],
                ),
                const SizedBox(height: AppTokens.spaceExtraSmall),
                ClipRRect(
                  borderRadius: BorderRadius.circular(AppTokens.radiusFull),
                  child: LinearProgressIndicator(
                    value: factor.value.clamp(0.0, 1.0),
                    minHeight: 6,
                    backgroundColor: AppTheme.surfaceContainerHigh,
                    valueColor: const AlwaysStoppedAnimation(AppTheme.primary),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// A short, plain-language note explaining a result.
///
/// Visually distinct from the data around it so it reads as guidance rather
/// than another field.
class ExplanationNote extends StatelessWidget {
  const ExplanationNote({required this.message, this.icon, super.key});

  final String message;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTokens.gutterMobile),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            icon ?? Icons.lightbulb_outline,
            size: 18,
            color: AppTheme.primary,
          ),
          const SizedBox(width: AppTokens.spaceSmall),
          Expanded(
            child: Text(
              message,
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(color: AppTheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }
}
