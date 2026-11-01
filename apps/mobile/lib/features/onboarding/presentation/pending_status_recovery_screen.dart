import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/i18n/locale_controller.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/darb_page.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_card.dart';
import '../application/onboarding_controller.dart';
import '../domain/onboarding_models.dart';

class PendingStatusRecoveryScreen extends ConsumerStatefulWidget {
  const PendingStatusRecoveryScreen({super.key});

  @override
  ConsumerState<PendingStatusRecoveryScreen> createState() =>
      _PendingStatusRecoveryScreenState();
}

class _PendingStatusRecoveryScreenState
    extends ConsumerState<PendingStatusRecoveryScreen> {
  final _phone = TextEditingController();
  final _password = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        ref.read(onboardingControllerProvider.notifier).refreshAvailability();
      }
    });
  }

  @override
  void dispose() {
    _phone.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final state = ref.watch(onboardingControllerProvider).value;
    final busy = state?.busy == true;

    if (state?.stage == OnboardingStage.pendingReview) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) context.go('/onboarding');
      });
    }

    if (state == null) {
      return const Scaffold(
        body: SafeArea(child: Center(child: CircularProgressIndicator())),
      );
    }
    if (!state.enabled) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.checkApplicationStatus)),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(AppTokens.spaceLarge),
            child: MasariCard(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(l10n.registrationUnavailable),
                  const SizedBox(height: AppTokens.spaceMedium),
                  FilledButton(
                    onPressed: () => context.go('/login'),
                    child: Text(l10n.signIn),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.checkApplicationStatus),
        actions: const [LanguageSwitch()],
      ),
      body: DarbFormPage(
        icon: Icons.fact_check_outlined,
        title: l10n.checkApplicationStatus,
        children: [
          DarbFormCard(
            children: [
              Directionality(
                textDirection: TextDirection.ltr,
                child: TextField(
                  key: const ValueKey('pendingRecoveryPhoneField'),
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(
                      RegExp(r'[+0-9٠-٩۰-۹ ()-]'),
                    ),
                    LengthLimitingTextInputFormatter(32),
                  ],
                  decoration: InputDecoration(
                    prefixIcon: const Icon(Icons.phone_outlined),
                    labelText: l10n.phoneNumber,
                    hintText: '+[country code][number]',
                  ),
                ),
              ),
              TextField(
                key: const ValueKey('pendingRecoveryPasswordField'),
                controller: _password,
                obscureText: true,
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.lock_outline),
                  labelText: l10n.password,
                ),
              ),
              if (state.errorCode != null)
                Text(
                  state.errorCode == 'invalid_credentials'
                      ? l10n.invalidCredentials
                      : l10n.requestFailed,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
            ],
          ),
          const SizedBox(height: AppTokens.spaceLarge),
          FilledButton(
            key: const ValueKey('pendingRecoveryButton'),
            onPressed: busy ? null : _recover,
            child: busy
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(l10n.checkApplicationStatus),
          ),
        ],
      ),
    );
  }

  Future<void> _recover() async {
    final locale =
        ref.read(localeControllerProvider).value?.languageCode == 'en'
        ? 'en'
        : 'ar';
    final password = _password.text;
    await ref
        .read(onboardingControllerProvider.notifier)
        .recoverPending(phone: _phone.text, password: password, locale: locale);
    final result = ref.read(onboardingControllerProvider).value;
    if (result?.stage == OnboardingStage.pendingReview ||
        result?.ambiguousFailure == false) {
      _password.clear();
    }
    if (result?.stage == OnboardingStage.pendingReview) _phone.clear();
  }
}
