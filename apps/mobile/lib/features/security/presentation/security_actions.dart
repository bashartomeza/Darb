import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/routing/app_router.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/darb_card.dart';
import '../../auth/application/auth_controller.dart';

/// Quick account actions at the foot of a role dashboard.
///
/// Deliberately low-emphasis: session management has its own tab now, so these
/// are shortcuts rather than the dashboard's purpose. They were previously an
/// outlined button stacked on a *filled* one, which made "log out" compete with
/// the screen's real actions for attention.
class RoleSecurityActions extends ConsumerWidget {
  const RoleSecurityActions({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);

    return Row(
      children: [
        Expanded(
          child: DarbCard(
            padding: const EdgeInsets.all(8),
            child: TextButton.icon(
              key: const ValueKey('securitySessionsButton'),
              onPressed: () => context.go(securitySessionsPath),
              icon: const Icon(Icons.security_outlined, size: 18),
              label: Text(
                l10n.securityAndSessions,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
        ),
        const SizedBox(width: AppTokens.spaceSmall),
        Expanded(
          child: DarbCard(
            padding: const EdgeInsets.all(8),
            child: TextButton.icon(
              key: const ValueKey('logoutButton'),
              onPressed: () async {
                final confirmed = await confirmSecurityAction(
                  context,
                  title: l10n.confirmLogout,
                  message: l10n.confirmLogoutMessage,
                  confirmLabel: l10n.logout,
                );
                if (confirmed && context.mounted) {
                  await ref.read(authControllerProvider.notifier).logout();
                }
              },
              style: TextButton.styleFrom(
                foregroundColor: Theme.of(context).colorScheme.error,
              ),
              icon: const Icon(Icons.logout, size: 18),
              label: Text(
                l10n.logout,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

Future<bool> confirmSecurityAction(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
}) async {
  return await showDialog<bool>(
        context: context,
        builder: (dialogContext) {
          final l10n = AppLocalizations.of(dialogContext);
          return AlertDialog(
            title: Text(title),
            content: Text(message),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: Text(l10n.cancel),
              ),
              FilledButton(
                key: const ValueKey('confirmSecurityActionButton'),
                onPressed: () => Navigator.of(dialogContext).pop(true),
                child: Text(confirmLabel),
              ),
            ],
          );
        },
      ) ??
      false;
}
