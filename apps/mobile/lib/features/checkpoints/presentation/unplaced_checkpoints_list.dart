import 'package:flutter/material.dart';

import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/maps/checkpoint_map_markers.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/theme/semantic_colors.dart';
import '../domain/checkpoint_models.dart';

/// Provider checkpoints with no reliable map position: listed by name, city
/// and last-changed times, never pinned at a guessed place.
class UnplacedCheckpointsList extends StatelessWidget {
  const UnplacedCheckpointsList({required this.unplaced, super.key});

  final List<UnplacedCheckpoint> unplaced;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Card(
      key: const ValueKey('unplacedCheckpoints'),
      margin: EdgeInsets.zero,
      child: ExpansionTile(
        leading: const Icon(
          Icons.location_off_outlined,
          color: SemanticColors.pending,
        ),
        title: Text(
          '${l10n.checkpointsUnplacedTitle} (${unplaced.length})',
          style: theme.textTheme.titleSmall,
        ),
        subtitle: Text(
          l10n.checkpointsUnplacedBody,
          style: theme.textTheme.bodySmall?.copyWith(
            color: AppTheme.onSurfaceVariant,
          ),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(
          AppTokens.spaceMedium,
          0,
          AppTokens.spaceMedium,
          AppTokens.spaceSmall,
        ),
        children: [
          for (final checkpoint in unplaced)
            ListTile(
              key: ValueKey('unplaced-${checkpoint.id}'),
              contentPadding: EdgeInsets.zero,
              dense: true,
              leading: Icon(
                checkpointStatusIcon(checkpoint.status),
                color: checkpointStatusColor(checkpoint.status),
              ),
              title: Text(checkpoint.nameAr),
              subtitle: Text(
                [
                  if (checkpoint.city.isNotEmpty) checkpoint.city,
                  if (checkpoint.enteringStatus != null)
                    l10n.checkpointEnteringStatus(checkpoint.enteringStatus!),
                  if (checkpoint.leavingStatus != null)
                    l10n.checkpointLeavingStatus(checkpoint.leavingStatus!),
                  if (checkpoint.enteringLastChangedText != null)
                    l10n.checkpointEnteringChanged(
                      formatProviderTime(checkpoint.enteringLastChangedText!),
                    ),
                  if (checkpoint.leavingLastChangedText != null)
                    l10n.checkpointLeavingChanged(
                      formatProviderTime(checkpoint.leavingLastChangedText!),
                    ),
                ].join(' · '),
              ),
            ),
        ],
      ),
    );
  }
}
