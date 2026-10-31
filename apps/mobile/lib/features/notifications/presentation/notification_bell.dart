import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_theme.dart';
import '../application/notifications_controller.dart';
import 'notifications_screen.dart';

/// The home-screen bell: shows the unread count and opens the inbox.
class NotificationBell extends ConsumerWidget {
  const NotificationBell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final unread = ref.watch(unreadNotificationCountProvider);

    return IconButton(
      tooltip: l10n.notifications,
      onPressed: () => Navigator.of(context).push<void>(
        MaterialPageRoute(builder: (_) => const NotificationsScreen()),
      ),
      icon: Badge(
        key: const ValueKey('notificationBadge'),
        isLabelVisible: unread > 0,
        label: Text(unread > 99 ? '99+' : '$unread'),
        child: const Icon(Icons.notifications_none, size: 28),
      ),
      color: AppTheme.primary,
    );
  }
}
