import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/app_tokens.dart';
import 'masari_section.dart';
import 'route_chip.dart';
import 'status_chip.dart';

/// One match in an inbox list.
///
/// Anatomy is fixed: what the job is and its state on the first line, the
/// corridor beneath it, then any load details, then a single action. Scanning a
/// column of these means reading one line per row.
class MatchResultCard extends StatelessWidget {
  const MatchResultCard({
    required this.title,
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
          if (from != null && to != null)
            RouteChip(from: from!, to: to!, compact: true),
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
