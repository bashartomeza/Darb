import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/config/app_config.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/theme/semantic_colors.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_card.dart';
import '../../onboarding/application/onboarding_controller.dart';
import '../../onboarding/domain/onboarding_models.dart';
import '../application/auth_controller.dart';
import '../domain/auth_models.dart';
import 'auth_completion_screen.dart';
import 'credential_actions.dart';
import 'demo_accounts.dart';
import 'widgets/auth_divider.dart';
import 'widgets/google_auth_button.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _showPassword = false;
  bool _submitting = false;
  bool _googleBusy = false;
  bool _openingOnboarding = false;
  bool _restorationNavigationScheduled = false;
  bool _showAttemptError = false;
  String? _googleErrorKey;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final auth = ref.watch(authControllerProvider);
    final loading =
        _submitting ||
        _googleBusy ||
        _openingOnboarding ||
        auth.value?.status == AuthStatus.authenticating;
    final loginFailure = ref.read(authControllerProvider.notifier).loginFailure;
    final error = _showAttemptError || identical(loginFailure, auth.error)
        ? auth.error
        : null;
    final sessionEndReason = auth.value?.sessionEndReason;
    final demoAccounts = demoAccountsFor(ref.watch(appConfigProvider));
    final onboarding = ref.watch(onboardingControllerProvider).value;
    final onboardingEnabled = onboarding?.enabled == true;
    ref.listen(onboardingControllerProvider, (previous, next) {
      final restored = next.value;
      if (_restorationNavigationScheduled ||
          restored?.restored != true ||
          !_isRestorableOnboardingStage(restored!.stage)) {
        return;
      }
      _restorationNavigationScheduled = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) context.go('/onboarding');
      });
    });

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: ListView(
              padding: const EdgeInsets.all(AppTokens.spaceMedium),
              children: [
                const Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: LanguageSwitch(),
                ),
                const SizedBox(height: AppTokens.spaceMedium),
                Center(
                  child: Container(
                    width: 64,
                    height: 64,
                    decoration: BoxDecoration(
                      color: AppTheme.primary,
                      borderRadius: BorderRadius.circular(
                        AppTokens.radiusMedium,
                      ),
                    ),
                    alignment: Alignment.center,
                    child: const Icon(
                      Icons.alt_route,
                      color: AppTheme.onPrimary,
                      size: 32,
                    ),
                  ),
                ),
                const SizedBox(height: AppTokens.spaceMedium),
                Text(
                  l10n.appTitle,
                  textAlign: TextAlign.center,
                  style: Theme.of(
                    context,
                  ).textTheme.displayMedium?.copyWith(color: AppTheme.primary),
                ),
                const SizedBox(height: AppTokens.spaceExtraSmall),
                Text(
                  l10n.signInWelcome,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: AppTheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: AppTokens.spaceLarge),
                MasariCard(
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          l10n.signIn,
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                        const SizedBox(height: AppTokens.spaceMedium),
                        TextFormField(
                          key: const ValueKey('emailField'),
                          controller: _emailController,
                          onChanged: (_) => _clearAttemptError(),
                          keyboardType: TextInputType.emailAddress,
                          autofillHints: const [AutofillHints.email],
                          inputFormatters: [
                            FilteringTextInputFormatter.deny(RegExp(r'\s')),
                            LengthLimitingTextInputFormatter(191),
                          ],
                          textInputAction: TextInputAction.next,
                          decoration: InputDecoration(
                            labelText: l10n.emailOrPhone,
                          ),
                          validator: (value) =>
                              _validateIdentifier(l10n, value),
                        ),
                        const SizedBox(height: AppTokens.spaceMedium),
                        TextFormField(
                          key: const ValueKey('passwordField'),
                          controller: _passwordController,
                          onChanged: (_) => _clearAttemptError(),
                          obscureText: !_showPassword,
                          autofillHints: const [AutofillHints.password],
                          onFieldSubmitted: (_) => _login(),
                          decoration: InputDecoration(
                            labelText: l10n.password,
                            suffixIcon: IconButton(
                              tooltip: _showPassword
                                  ? l10n.hidePassword
                                  : l10n.showPassword,
                              onPressed: () => setState(
                                () => _showPassword = !_showPassword,
                              ),
                              icon: Icon(
                                _showPassword
                                    ? Icons.visibility_off
                                    : Icons.visibility,
                              ),
                            ),
                          ),
                          validator: (value) => (value == null || value.isEmpty)
                              ? l10n.passwordRequired
                              : null,
                        ),
                        if (error != null || _googleErrorKey != null) ...[
                          const SizedBox(height: AppTokens.spaceMedium),
                          Text(
                            _googleErrorKey != null
                                ? _googleMessage(l10n, _googleErrorKey!)
                                : error is ApiException &&
                                      [
                                        'explicit_link_required',
                                        'email_verification_required',
                                        'google_signup_unavailable',
                                      ].contains(error.message)
                                ? authFailure(context, error)
                                : _errorMessage(l10n, error!),
                            key: const ValueKey('loginError'),
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                        ],
                        if (sessionEndReason != null) ...[
                          const SizedBox(height: AppTokens.spaceMedium),
                          Text(
                            _sessionEndMessage(l10n, sessionEndReason),
                            key: const ValueKey('sessionEndedMessage'),
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                        ],
                        const SizedBox(height: AppTokens.spaceLarge),
                        FilledButton(
                          key: const ValueKey('loginButton'),
                          onPressed: loading ? null : _login,
                          child: loading
                              ? const SizedBox.square(
                                  dimension: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : Text(l10n.signIn),
                        ),
                        const SizedBox(height: AppTokens.spaceMedium),
                        AuthDivider(label: l10n.orSeparator),
                        const SizedBox(height: AppTokens.spaceMedium),
                        GoogleAuthButton(
                          enabled: !loading,
                          onIdToken: _loginWithGoogle,
                          onError: _handleGoogleError,
                        ),
                        const SizedBox(height: AppTokens.spaceSmall),
                        TextButton(
                          key: const ValueKey('goToSignUpButton'),
                          onPressed: loading ? null : _openSignUp,
                          child: Text(l10n.newToMasari),
                        ),
                        TextButton(
                          key: const ValueKey('passwordRecovery'),
                          onPressed: loading
                              ? null
                              : () => openCredentialAction(context, 'reset'),
                          child: Text(
                            authText(
                              context,
                              'Forgot password?',
                              'نسيت كلمة المرور؟',
                            ),
                          ),
                        ),
                        TextButton(
                          key: const ValueKey('emailVerification'),
                          onPressed: loading
                              ? null
                              : () => openCredentialAction(context, 'verify'),
                          child: Text(
                            authText(
                              context,
                              'Verify email',
                              'التحقق من البريد الإلكتروني',
                            ),
                          ),
                        ),
                        if (onboardingEnabled) ...[
                          const Divider(height: AppTokens.spaceLarge),
                          TextButton(
                            key: const ValueKey('checkApplicationStatusButton'),
                            onPressed: loading
                                ? null
                                : () => _openOnboarding('/onboarding/recover'),
                            child: Text(l10n.checkApplicationStatus),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                if (demoAccounts.isNotEmpty) ...[
                  const SizedBox(height: AppTokens.spaceMedium),
                  MasariCard(
                    background: AppTheme.surfaceContainerLow,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          l10n.demoAccounts,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: AppTokens.gutterMobile),
                        for (final account in demoAccounts)
                          Padding(
                            padding: const EdgeInsets.only(
                              bottom: AppTokens.spaceSmall,
                            ),
                            child: OutlinedButton(
                              key: ValueKey('demo-${account.labelKey}'),
                              onPressed: loading
                                  ? null
                                  : () => _fillDemo(account),
                              style: OutlinedButton.styleFrom(
                                alignment: AlignmentDirectional.centerStart,
                                side: const BorderSide(
                                  color: AppTheme.outlineVariant,
                                ),
                                foregroundColor: AppTheme.onSurface,
                              ),
                              child: Row(
                                children: [
                                  Icon(
                                    _demoIcon(account.labelKey),
                                    size: 20,
                                    color: SemanticColors.forRole(
                                      account.labelKey,
                                    ),
                                  ),
                                  const SizedBox(width: AppTokens.gutterMobile),
                                  Expanded(
                                    child: Text(
                                      _demoLabel(l10n, account),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _fillDemo(DemoAccount account) {
    _clearAttemptError();
    _emailController.text = account.email;
    _passwordController.text = account.password;
  }

  Future<void> _login() async {
    if (_submitting) return;
    _clearAttemptError();
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _submitting = true;
      _showAttemptError = true;
    });
    await ref
        .read(authControllerProvider.notifier)
        .login(
          email: _emailController.text.trim().toLowerCase(),
          password: _passwordController.text,
        );
    if (mounted) setState(() => _submitting = false);
  }

  Future<void> _loginWithGoogle(String idToken) async {
    _clearAttemptError();
    setState(() {
      _googleBusy = true;
      _showAttemptError = true;
    });
    await ref
        .read(authControllerProvider.notifier)
        .loginWithGoogle(idToken: idToken);
    if (mounted) setState(() => _googleBusy = false);
  }

  void _handleGoogleError(Object error) {
    if (!mounted) return;
    setState(() {
      _googleBusy = false;
      _showAttemptError = false;
      _googleErrorKey = 'failed';
    });
  }

  void _clearAttemptError() {
    setState(() {
      _showAttemptError = false;
      _googleErrorKey = null;
    });
    ref.read(authControllerProvider.notifier).clearError();
  }

  Future<void> _openSignUp() async {
    setState(() => _googleErrorKey = null);
    ref.read(authControllerProvider.notifier).clearError();
    await context.push<void>('/register');
    if (!mounted) return;
    ref.read(authControllerProvider.notifier).clearError();
  }

  Future<void> _openOnboarding(String route) async {
    if (_openingOnboarding) return;
    setState(() => _openingOnboarding = true);
    await ref.read(onboardingControllerProvider.notifier).refreshAvailability();
    final enabled =
        ref.read(onboardingControllerProvider).value?.enabled == true;
    if (!mounted) return;
    setState(() => _openingOnboarding = false);
    if (enabled) await context.push<void>(route);
  }
}

IconData _demoIcon(String labelKey) => switch (labelKey) {
  'passenger' => Icons.person_outline,
  'driver' => Icons.directions_car_outlined,
  'merchant' => Icons.storefront_outlined,
  _ => Icons.account_circle_outlined,
};

String _demoLabel(AppLocalizations l10n, DemoAccount account) {
  final role = switch (account.labelKey) {
    'passenger' => l10n.passenger,
    'driver' => l10n.driver,
    'merchant' => l10n.merchant,
    _ => account.labelKey,
  };
  return '$role  ${account.email}';
}

/// An email address, or an international phone number such as +970591234567.
String? _validateIdentifier(AppLocalizations l10n, String? value) {
  final text = value?.trim() ?? '';
  if (text.isEmpty) return l10n.emailOrPhoneRequired;
  if (text.contains('@')) return _validateEmail(l10n, text);
  return RegExp(r'^\+[0-9]{7,15}$').hasMatch(text)
      ? null
      : l10n.emailOrPhoneInvalid;
}

String? _validateEmail(AppLocalizations l10n, String? value) {
  final email = value?.trim() ?? '';
  if (email.isEmpty) return l10n.emailRequired;
  final pattern = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
  return pattern.hasMatch(email) ? null : l10n.emailInvalid;
}

bool _isRestorableOnboardingStage(OnboardingStage stage) => switch (stage) {
  OnboardingStage.otpSent ||
  OnboardingStage.enteringAccountDetails ||
  OnboardingStage.pendingReview ||
  OnboardingStage.approvedSignIn ||
  OnboardingStage.retryableFailure => true,
  _ => false,
};

String _googleMessage(AppLocalizations l10n, String key) => switch (key) {
  'unavailable' => l10n.googleSignInUnavailable,
  _ => l10n.googleSignInFailed,
};

String _errorMessage(AppLocalizations l10n, Object error) {
  if (error is! ApiException) {
    return l10n.requestFailed;
  }
  if (error.message == 'account_unavailable') {
    return l10n.accountUnavailable;
  }
  if (error.message == 'google_email_unverified' ||
      error.message == 'invalid_google_token') {
    return l10n.googleSignInFailed;
  }
  if (error.message == 'google_auth_not_configured') {
    return l10n.googleSignInUnavailable;
  }
  return switch (error.type) {
    ApiErrorType.unauthorized => l10n.invalidCredentials,
    ApiErrorType.network => l10n.networkUnavailable,
    ApiErrorType.timeout => l10n.requestTimedOut,
    ApiErrorType.validation => l10n.validationError,
    ApiErrorType.forbidden => l10n.forbidden,
    ApiErrorType.server => l10n.serverError,
    ApiErrorType.unknown => l10n.requestFailed,
  };
}

String _sessionEndMessage(AppLocalizations l10n, SessionEndReason reason) =>
    switch (reason) {
      SessionEndReason.expired => l10n.sessionExpired,
      SessionEndReason.ended => l10n.sessionEnded,
      SessionEndReason.accountUnavailable => l10n.accountUnavailable,
    };
