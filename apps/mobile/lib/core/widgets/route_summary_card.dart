import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/app_tokens.dart';
import 'masari_card.dart';

/// Grey summary card with the origin (green dot) above the destination (red
/// dot), plus optional pill chips (date, time, passengers) underneath.
///
/// Used above a list of rides and on booking summaries, as in the Darb
/// "Available Rides" and "Confirm Booking" references.
class RouteSummaryCard extends StatelessWidget {
  const RouteSummaryCard({
    required this.from,
    required this.to,
    this.chips = const [],
    super.key,
  });

  final String from;
  final String to;

  /// Pills shown below the card, e.g. [InfoPill].
  final List<Widget> chips;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    Widget line(Color color, String text) => Row(
      children: [
        Container(
          width: 12,
          height: 12,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: AppTokens.gutterMobile),
        Expanded(
          child: Text(
            text,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.titleMedium,
          ),
        ),
      ],
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        MasariCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              line(AppTheme.routeOrigin, from),
              const SizedBox(height: AppTokens.gutterMobile),
              line(AppTheme.routeDestination, to),
            ],
          ),
        ),
        if (chips.isNotEmpty) ...[
          const SizedBox(height: AppTokens.gutterMobile),
          Wrap(
            spacing: AppTokens.spaceSmall,
            runSpacing: AppTokens.spaceSmall,
            children: chips,
          ),
        ],
      ],
    );
  }
}

/// A rounded pill with a leading icon, for trip facts such as date or time.
class InfoPill extends StatelessWidget {
  const InfoPill({required this.icon, required this.label, super.key});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTokens.gutterMobile,
        vertical: AppTokens.spaceSmall,
      ),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppTokens.radiusFull),
        border: Border.all(color: AppTheme.outlineVariant),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 18, color: AppTheme.onSurface),
          const SizedBox(width: AppTokens.spaceSmall),
          Text(label, style: Theme.of(context).textTheme.labelLarge),
        ],
      ),
    );
  }
}
