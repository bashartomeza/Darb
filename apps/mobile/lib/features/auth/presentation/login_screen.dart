import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../onboarding/application/onboarding_controller.dart';
import '../../onboarding/domain/onboarding_models.dart';
import '../application/auth_controller.dart';
import '../domain/auth_models.dart';
import 'auth_completion_screen.dart';
import 'credential_actions.dart';
import 'widgets/auth_divider.dart';
import 'widgets/auth_style.dart';
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
  void initState() {
    super.initState();
    // A failure left by an earlier attempt (or another screen) must not greet
    // a freshly opened login form. An attempt still in flight is kept so its
    // result survives router page recreation.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final current = ref.read(authControllerProvider);
      if (current.value?.status == AuthStatus.authenticating) return;
      ref.read(authControllerProvider.notifier).clearError();
    });
  }

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
    // Only a failure from a login attempt is shown here; a restore failure or
    // any other provider error never surfaces as a login error.
    final error =
        auth.error != null &&
            (_showAttemptError || identical(loginFailure, auth.error))
        ? auth.error
        : null;
    final sessionEndReason = auth.value?.sessionEndReason;
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
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: ListView(
              padding: const EdgeInsets.symmetric(
                horizontal: 16,
                vertical: AppTokens.spaceMedium,
              ),
              children: [
                const Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: LanguageSwitch(),
                ),
                const SizedBox(height: 24),
                const Center(child: AuthLogo()),
                const SizedBox(height: 26),
                AuthHeader(
                  title: l10n.welcomeBack,
                  subtitle: l10n.welcomeBackSubtitle,
                ),
                const SizedBox(height: 40),
                Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      AuthTextField(
                        key: const ValueKey('emailField'),
                        controller: _emailController,
                        hint: l10n.email,
                        icon: Icons.email_rounded,
                        onChanged: (_) => _clearAttemptError(),
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email],
                        inputFormatters: [
                          FilteringTextInputFormatter.deny(RegExp(r'\s')),
                          LengthLimitingTextInputFormatter(191),
                        ],
                        textInputAction: TextInputAction.next,
                        validator: (value) => _validateIdentifier(l10n, value),
                      ),
                      const SizedBox(height: 16),
                      AuthTextField(
                        key: const ValueKey('passwordField'),
                        controller: _passwordController,
                        hint: l10n.password.toLowerCase(),
                        icon: Icons.lock_rounded,
                        onChanged: (_) => _clearAttemptError(),
                        obscureText: !_showPassword,
                        autofillHints: const [AutofillHints.password],
                        onFieldSubmitted: (_) => _login(),
                        suffix: IconButton(
                          tooltip: _showPassword
                              ? l10n.hidePassword
                              : l10n.showPassword,
                          onPressed: () =>
                              setState(() => _showPassword = !_showPassword),
                          icon: Icon(
                            _showPassword
                                ? Icons.visibility_outlined
                                : Icons.visibility_off_outlined,
                            color: AuthStyle.hint,
                            size: 20,
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
                      const SizedBox(height: 16),
                      AuthPrimaryButton(
                        buttonKey: const ValueKey('loginButton'),
                        label: l10n.login,
                        loading: loading,
                        onPressed: loading ? null : _login,
                      ),
                      const SizedBox(height: 18),
                      AuthDivider(label: l10n.orSeparator),
                      const SizedBox(height: 8),
                      AuthSwitchPrompt(
                        actionKey: const ValueKey('goToSignUpButton'),
                        prompt: l10n.noAccountPrompt,
                        action: l10n.registerAction,
                        onPressed: loading ? null : _openSignUp,
                      ),
                      const SizedBox(height: 8),
                      GoogleAuthButton(
                        enabled: !loading,
                        onIdToken: _loginWithGoogle,
                        onError: _handleGoogleError,
                      ),
                      const SizedBox(height: AppTokens.spaceSmall),
                      TextButton(
                        key: const ValueKey('passwordRecovery'),
                        onPressed: loading
                            ? null
                            : () => openCredentialAction(context, 'reset'),
                        child: Text(
                          AppLocalizations.of(context).authForgotPassword,
                        ),
                      ),
                      if (onboardingEnabled)
                        TextButton(
                          key: const ValueKey('checkApplicationStatusButton'),
                          onPressed: loading
                              ? null
                              : () => _openOnboarding('/onboarding/recover'),
                          child: Text(l10n.checkApplicationStatus),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
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
    final pendingApplication = await ref
        .read(authControllerProvider.notifier)
        .loginWithGoogle(
          idToken: idToken,
          locale: Localizations.localeOf(context).languageCode,
        );
    if (mounted) setState(() => _googleBusy = false);
    // A driver awaiting Admin approval sees their application, not the app.
    if (pendingApplication && mounted) context.go('/onboarding');
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
