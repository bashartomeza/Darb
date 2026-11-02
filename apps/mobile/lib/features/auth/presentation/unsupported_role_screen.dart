import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/darb_card.dart';
import '../application/auth_controller.dart';

class UnsupportedRoleScreen extends ConsumerWidget {
  const UnsupportedRoleScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final user = ref.watch(authControllerProvider).value?.user;

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(AppTokens.spaceLarge),
          children: [
            const Align(
              alignment: AlignmentDirectional.centerEnd,
              child: LanguageSwitch(),
            ),
            const SizedBox(height: AppTokens.spaceLarge),
            Text(
              l10n.appTitle,
              style: Theme.of(
                context,
              ).textTheme.headlineLarge?.copyWith(color: AppTheme.deepGreen),
            ),
            const SizedBox(height: AppTokens.spaceLarge),
            DarbCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.unsupportedRoleTitle,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: AppTokens.spaceMedium),
                  if (user != null) ...[Text(user.name)],
                  const SizedBox(height: AppTokens.spaceMedium),
                  Text(l10n.adminWebConsoleMessage),
                  const SizedBox(height: AppTokens.spaceLarge),
                  FilledButton(
                    onPressed: () =>
                        ref.read(authControllerProvider.notifier).logout(),
                    child: Text(l10n.logout),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
