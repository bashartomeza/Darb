import 'package:flutter/material.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../notifications/presentation/notification_bell.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_tokens.dart';
import '../../../../core/widgets/entity_cards.dart';

/// The home screen's top bar: avatar, centred wordmark, notifications.
///
/// Laid out left-to-right regardless of locale so it keeps the arrangement in
/// the design — avatar on the left, bell on the right — in both Arabic and
/// English. Only the bar's *arrangement* is pinned; the text inside still
/// renders in the ambient direction.
class PassengerTopBar extends StatelessWidget {
  const PassengerTopBar({
    required this.title,
    this.name,
    this.imageUrl,
    super.key,
  });

  final String title;
  final String? name;
  final String? imageUrl;

  @override
  Widget build(BuildContext context) {
    return Row(
      textDirection: TextDirection.ltr,
      children: [
        RoleAvatar(
          name: name ?? '',
          role: 'passenger',
          imageUrl: imageUrl,
          size: 44,
        ),
        Expanded(
          child: Text(
            title,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              color: AppTheme.primary,
              fontWeight: FontWeight.w700,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        const NotificationBell(key: ValueKey('passengerNotifications')),
      ],
    );
  }
}

/// Time-aware greeting plus the corridor the passenger is operating in.
class PassengerGreeting extends StatelessWidget {
  const PassengerGreeting({
    required this.name,
    required this.locationLabel,
    this.now,
    super.key,
  });

  final String name;
  final String locationLabel;

  /// Injectable so the greeting is testable without waiting for the clock.
  final DateTime? now;

  String _greeting(AppLocalizations l10n) {
    final hour = (now ?? DateTime.now()).hour;
    if (hour < 12) return l10n.greetingMorning(name);
    if (hour < 17) return l10n.greetingAfternoon(name);
    return l10n.greetingEvening(name);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          _greeting(l10n),
          style: theme.textTheme.headlineLarge?.copyWith(
            color: AppTheme.primary,
            fontWeight: FontWeight.w700,
          ),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
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
                locationLabel,
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
    );
  }
}
