import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/brand_logo.dart';
import '../../../core/widgets/language_switch.dart';
import '../application/auth_controller.dart';

class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final auth = ref.watch(authControllerProvider).value;
    final error = auth?.error;

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppTokens.spaceLarge),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Align(
                alignment: AlignmentDirectional.centerEnd,
                child: LanguageSwitch(),
              ),
              const Spacer(),
              Center(
                child: BrandLogo(width: 220, semanticLabel: l10n.appTitle),
              ),
              const SizedBox(height: AppTokens.spaceMedium),
              if (auth?.status == AuthStatus.restoreFailed) ...[
                Text(
                  _localizedError(l10n, error),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: AppTokens.spaceMedium),
                FilledButton(
                  onPressed: () =>
                      ref.read(authControllerProvider.notifier).retryRestore(),
                  child: Text(l10n.retry),
                ),
              ] else ...[
                Text(
                  l10n.loadingSession,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: AppTokens.spaceMedium),
                const Center(child: CircularProgressIndicator()),
              ],
              const Spacer(),
            ],
          ),
        ),
      ),
    );
  }
}

String _localizedError(AppLocalizations l10n, ApiException? error) {
  return switch (error?.type) {
    ApiErrorType.network => l10n.networkUnavailable,
    ApiErrorType.timeout => l10n.requestTimedOut,
    _ => l10n.sessionRestoreFailed,
  };
}
