import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/app_tokens.dart';
import 'entity_cards.dart';

/// The greeting block at the top of each role dashboard.
///
/// Shows the signed-in user's own name and their operating area. Everything
/// rendered comes from data the app already holds — there is no notifications
/// bell, because no notifications backend exists.
class RoleHeader extends StatelessWidget {
  const RoleHeader({
    required this.title,
    required this.roleLabel,
    this.name,
    this.role,
    this.locationLabel,
    this.trailing,
    super.key,
  });

  /// App or screen title, e.g. "درب".
  final String title;

  /// Localised role name, shown under the user's name.
  final String roleLabel;

  /// The signed-in user's name; the avatar falls back to the role glyph when
  /// this is absent.
  final String? name;

  /// API role value, used for the avatar's indicator colour.
  final String? role;

  /// Operating area, e.g. the locked corridor.
  final String? locationLabel;

  /// Optional end-aligned control, e.g. the language switch.
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final displayName = name?.trim();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            RoleAvatar(name: displayName ?? roleLabel, role: role, size: 44),
            const SizedBox(width: AppTokens.gutterMobile),
            Expanded(
              child: Text(
                title,
                style: theme.textTheme.headlineSmall?.copyWith(
                  color: AppTheme.primary,
                  fontWeight: FontWeight.w700,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            ?trailing,
          ],
        ),
        const SizedBox(height: AppTokens.spaceMedium),
        if (displayName != null && displayName.isNotEmpty)
          Text(
            displayName,
            style: theme.textTheme.headlineLarge?.copyWith(
              color: AppTheme.primary,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        Text(
          roleLabel,
          style: theme.textTheme.bodySmall?.copyWith(
            color: AppTheme.onSurfaceVariant,
          ),
        ),
        if (locationLabel != null) ...[
          const SizedBox(height: AppTokens.spaceExtraSmall),
          Row(
            children: [
              const Icon(
                Icons.my_location,
                size: 16,
                color: AppTheme.onSurfaceVariant,
              ),
              const SizedBox(width: AppTokens.spaceExtraSmall),
              Expanded(
                child: Text(
                  locationLabel!,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: AppTheme.onSurfaceVariant,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}
