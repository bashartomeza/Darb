import 'package:flutter/material.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../features/notifications/presentation/notification_bell.dart';

import '../theme/app_theme.dart';
import 'entity_cards.dart';

/// The top bar shared by every role's home screen: avatar, centred wordmark,
/// notifications.
///
/// The bar's arrangement is pinned left-to-right so it holds its shape in both
/// locales; the text inside still renders in the ambient direction. Roles that
/// lead with the bell rather than the avatar pass [avatarLeading] as false.
class HomeTopBar extends StatelessWidget {
  const HomeTopBar({
    required this.title,
    required this.role,
    this.name,
    this.imageUrl,
    this.avatarLeading = true,
    this.notificationsKey,
    super.key,
  });

  final String title;

  /// API role value, used for the avatar's indicator colour.
  final String role;

  final String? name;
  final String? imageUrl;

  /// Whether the avatar sits on the left and the bell on the right.
  final bool avatarLeading;

  final Key? notificationsKey;

  @override
  Widget build(BuildContext context) {
    final avatar = RoleAvatar(
      name: name ?? '',
      role: role,
      imageUrl: imageUrl,
      size: 44,
    );

    final bell = NotificationBell(key: notificationsKey);

    return Row(
      textDirection: TextDirection.ltr,
      children: [
        avatarLeading ? avatar : bell,
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
        avatarLeading ? bell : avatar,
      ],
    );
  }
}

/// Time-aware greeting used across the role dashboards.
String homeGreeting(AppLocalizations l10n, String who, {DateTime? now}) {
  final hour = (now ?? DateTime.now()).hour;
  if (hour < 12) return l10n.greetingMorning(who);
  if (hour < 17) return l10n.greetingAfternoon(who);
  return l10n.greetingEvening(who);
}
