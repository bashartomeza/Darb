import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/theme/passenger_theme.dart';
import '../../passenger/presentation/settings/settings_widgets.dart';
import '../application/push_controller.dart';
import '../data/push_messaging.dart';

/// On/off switch for push notifications on the account screens.
///
/// Renders nothing when this build cannot receive pushes, so builds without
/// Firebase show no dead setting. The choice is stored on the server for the
/// account; turning it on also asks the phone for permission if needed.
class PushSettingsTile extends ConsumerWidget {
  const PushSettingsTile({super.key}) : _passenger = false;

  /// The passenger settings list style.
  const PushSettingsTile.passenger({super.key}) : _passenger = true;

  final bool _passenger;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final push = ref.watch(pushControllerProvider);
    if (!push.available) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final preference = ref.watch(pushPreferenceProvider);
    final enabled = preference.value?.enabled ?? false;
    final blocked = push.permission == PushPermission.denied;
    final subtitle = blocked
        ? l10n.pushSettingBlocked
        : l10n.pushSettingSubtitle;
    final onChanged = preference.hasValue
        ? (bool value) => _change(context, ref, value)
        : null;

    if (!_passenger) {
      return SwitchListTile(
        key: const ValueKey('pushNotificationsToggle'),
        secondary: const Icon(Icons.notifications_active_outlined),
        title: Text(l10n.pushSettingTitle),
        subtitle: Text(subtitle),
        value: enabled,
        onChanged: onChanged,
      );
    }
    return Material(
      key: const ValueKey('pushNotificationsRow'),
      color: PassengerStyle.panel,
      borderRadius: BorderRadius.circular(PassengerStyle.radiusTile),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: [
            const SettingsIconBadge(icon: Icons.notifications_active_outlined),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.pushSettingTitle,
                    style: PassengerStyle.inter(
                      size: 16,
                      height: 20,
                      weight: 560,
                      color: PassengerStyle.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: PassengerStyle.inter(
                      size: 13,
                      height: 17,
                      color: PassengerStyle.muted,
                    ),
                  ),
                ],
              ),
            ),
            Switch(
              key: const ValueKey('pushNotificationsToggle'),
              value: enabled,
              onChanged: onChanged,
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _change(BuildContext context, WidgetRef ref, bool value) async {
    final messenger = ScaffoldMessenger.maybeOf(context);
    final failed = AppLocalizations.of(context).pushSettingFailed;
    try {
      await ref.read(pushPreferenceProvider.notifier).setEnabled(value);
    } catch (_) {
      messenger?.showSnackBar(SnackBar(content: Text(failed)));
    }
  }
}
