import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/validation/password_rule.dart';
import '../../../core/validation/phone_rule.dart';
import '../../../core/widgets/language_switch.dart';
import '../application/auth_controller.dart';
import 'auth_completion_screen.dart';
import 'widgets/auth_divider.dart';
import 'widgets/auth_style.dart';
import 'widgets/google_auth_button.dart';

class SignUpScreen extends ConsumerStatefulWidget {
  const SignUpScreen({super.key});

  @override
  ConsumerState<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends ConsumerState<SignUpScreen> {
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _showPassword = false;
  bool _submitting = false;
  bool _googleBusy = false;
  bool _googleFailed = false;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
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
        auth.value?.status == AuthStatus.authenticating;
    final error = auth.error;

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        scrolledUnderElevation: 0,
        actions: const [LanguageSwitch()],
      ),
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
                const Center(child: AuthLogo()),
                const SizedBox(height: 26),
                AuthHeader(
                  title: l10n.createAccount,
                  subtitle: l10n.createAccountSubtitle,
                ),
                const SizedBox(height: 40),
                Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      AuthTextField(
                        key: const ValueKey('nameField'),
                        controller: _nameController,
                        hint: l10n.fullName,
                        icon: Icons.person_rounded,
                        textCapitalization: TextCapitalization.words,
                        autofillHints: const [AutofillHints.name],
                        textInputAction: TextInputAction.next,
                        inputFormatters: [
                          LengthLimitingTextInputFormatter(120),
                        ],
                        validator: (value) =>
                            (value == null || value.trim().isEmpty)
                            ? l10n.nameRequired
                            : null,
                      ),
                      const SizedBox(height: 16),
                      AuthTextField(
                        key: const ValueKey('emailField'),
                        controller: _emailController,
                        hint: l10n.email,
                        icon: Icons.email_rounded,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email],
                        textInputAction: TextInputAction.next,
                        inputFormatters: [
                          FilteringTextInputFormatter.deny(RegExp(r'\s')),
                          LengthLimitingTextInputFormatter(191),
                        ],
                        validator: (value) => _validateEmail(l10n, value),
                      ),
                      const SizedBox(height: 16),
                      AuthTextField(
                        key: const ValueKey('phoneField'),
                        controller: _phoneController,
                        hint: AppLocalizations.of(context).phoneNumber,
                        icon: Icons.phone_outlined,
                        keyboardType: TextInputType.phone,
                        autofillHints: const [AutofillHints.telephoneNumber],
                        textInputAction: TextInputAction.next,
                        inputFormatters: [LengthLimitingTextInputFormatter(32)],
                        validator: (value) => _validatePhone(context, value),
                      ),
                      const SizedBox(height: 16),
                      AuthTextField(
                        key: const ValueKey('passwordField'),
                        controller: _passwordController,
                        hint: l10n.password.toLowerCase(),
                        icon: Icons.lock_rounded,
                        obscureText: !_showPassword,
                        autofillHints: const [AutofillHints.newPassword],
                        onFieldSubmitted: (_) => _register(),
                        helperText: passwordRuleHint(context),
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
                        validator: (value) =>
                            (value == null || !validNewPassword(value))
                            ? passwordRuleHint(context)
                            : null,
                      ),
                      if (error != null || _googleFailed) ...[
                        const SizedBox(height: AppTokens.spaceMedium),
                        Text(
                          _googleFailed
                              ? l10n.googleSignInFailed
                              : error is ApiException &&
                                    [
                                      'explicit_link_required',
                                      'google_signup_unavailable',
                                    ].contains(error.message)
                              ? authFailure(context, error)
                              : _errorMessage(l10n, error!),
                          key: const ValueKey('signUpError'),
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ],
                      const SizedBox(height: 16),
                      AuthPrimaryButton(
                        buttonKey: const ValueKey('signUpButton'),
                        label: l10n.signUp,
                        loading: loading,
                        onPressed: loading ? null : _register,
                      ),
                      const SizedBox(height: 18),
                      AuthDivider(label: l10n.orSeparator),
                      const SizedBox(height: 8),
                      AuthSwitchPrompt(
                        actionKey: const ValueKey('goToSignInButton'),
                        prompt: l10n.haveAccountPrompt,
                        action: l10n.login,
                        onPressed: loading ? null : () => context.pop(),
                      ),
                      const SizedBox(height: 8),
                      GoogleAuthButton(
                        enabled: !loading,
                        onIdToken: _registerWithGoogle,
                        onError: (_) {
                          if (mounted) {
                            setState(() {
                              _googleBusy = false;
                              _googleFailed = true;
                            });
                          }
                        },
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

  Future<void> _register() async {
    if (_submitting || _googleBusy) return;
    setState(() => _googleFailed = false);
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _submitting = true);
    await ref
        .read(authControllerProvider.notifier)
        .register(
          name: _nameController.text.trim(),
          email: _emailController.text.trim().toLowerCase(),
          password: _passwordController.text,
          phone: _phoneController.text.trim(),
          locale: Localizations.localeOf(context).languageCode,
        );
    if (mounted) {
      _passwordController.clear();
      setState(() => _submitting = false);
    }
  }

  Future<void> _registerWithGoogle(String idToken) async {
    setState(() {
      _googleFailed = false;
      _googleBusy = true;
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
}

String? _validateEmail(AppLocalizations l10n, String? value) {
  final email = value?.trim() ?? '';
  if (email.isEmpty) return l10n.emailRequired;
  final pattern = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
  return pattern.hasMatch(email) ? null : l10n.emailInvalid;
}

/// The phone is an extra contact detail: only its length is checked.
String? _validatePhone(BuildContext context, String? value) =>
    isValidMobileNumber(value)
    ? null
    : AppLocalizations.of(context).authEnterPhoneNumber7;

String _errorMessage(AppLocalizations l10n, Object error) {
  if (error is! ApiException) return l10n.requestFailed;
  if (error.message == 'email_taken') return l10n.emailAlreadyRegistered;
  if (error.message == 'account_unavailable') return l10n.accountUnavailable;
  if (error.message == 'invalid_password') return l10n.passwordRuleHint;
  if (error.message == 'google_email_unverified' ||
      error.message == 'invalid_google_token') {
    return l10n.googleSignInFailed;
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
