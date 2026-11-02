import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/app_tokens.dart';
import '../presentation/localized_labels.dart';

/// A compact "from → to" pill.
///
/// The arrow follows the reading direction: it points left under Arabic and
/// right under English, so travel always reads as forward motion. Flutter does
/// not mirror `Icons.arrow_forward` automatically, so the glyph is chosen from
/// the ambient [Directionality].
class RouteChip extends StatelessWidget {
  const RouteChip({
    required this.from,
    required this.to,
    this.compact = false,
    super.key,
  });

  final String from;
  final String to;

  /// Renders without the surrounding pill, for use inside a card that already
  /// provides its own background.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isRtl = Directionality.of(context) == TextDirection.rtl;
    final style = theme.textTheme.bodySmall?.copyWith(
      fontWeight: FontWeight.w600,
      color: AppTheme.onSurface,
    );

    final content = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Flexible(
          child: Text(
            localizedCorridorPlace(context, from),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: style,
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppTokens.spaceSmall),
          child: Icon(
            isRtl ? Icons.arrow_back : Icons.arrow_forward,
            size: 16,
            color: AppTheme.onSurfaceVariant,
          ),
        ),
        Flexible(
          child: Text(
            localizedCorridorPlace(context, to),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: style,
          ),
        ),
      ],
    );

    if (compact) return content;

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTokens.gutterMobile,
        vertical: AppTokens.spaceSmall,
      ),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(AppTokens.radiusFull),
      ),
      child: content,
    );
  }
}
