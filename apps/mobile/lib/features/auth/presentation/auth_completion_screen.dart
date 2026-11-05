import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api/api_error.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/validation/password_rule.dart';
import '../../../core/widgets/darb_page.dart';
import '../../../core/widgets/language_switch.dart';
import '../application/auth_controller.dart';
import '../data/auth_repository.dart';
import '../../../l10n/app_localizations.dart';

String authFailure(BuildContext context, Object? error) {
  final code = error is ApiException ? error.message : '';
  return switch (code) {
    'explicit_link_required' ||
    'email_taken' => AppLocalizations.of(context).authSignExistingAccountThen,
    'phone_already_in_use' => AppLocalizations.of(
      context,
    ).authPhoneBelongsAnotherAccount,
    'email_verification_required' => AppLocalizations.of(
      context,
    ).authVerifyEmailUsingEmail,
    'auth_action_invalid' || 'phone_verification_invalid' =>
      AppLocalizations.of(context).authProofIncorrectExpiredRequest,
    'invalid_password' => passwordRuleHint(context),
    'consent_version_changed' => AppLocalizations.of(
      context,
    ).authDocumentsChangedReadAccept,
    'reauthentication_required' => AppLocalizations.of(
      context,
    ).authConfirmCurrentPasswordRequest,
    'google_identity_conflict' => AppLocalizations.of(
      context,
    ).authGoogleIdentityAlreadyLinked,
    'invalid_phone' => AppLocalizations.of(
      context,
    ).authEnterValidInternationalPhone,
    'google_signup_unavailable' => AppLocalizations.of(
      context,
    ).authGooglePassengerRegistrationNot,
    _ => AppLocalizations.of(context).authUnableCompleteRequestCheck,
  };
}

class AuthCompletionScreen extends ConsumerStatefulWidget {
  const AuthCompletionScreen({super.key});
  @override
  ConsumerState<AuthCompletionScreen> createState() =>
      _AuthCompletionScreenState();
}

class _AuthCompletionScreenState extends ConsumerState<AuthCompletionScreen> {
  final _code = TextEditingController();
  final _name = TextEditingController();
  final _codeFocus = FocusNode();
  List<Map<String, dynamic>>? _documents;
  String? _locale;
  final Set<String> _accepted = {};
  bool _busy = false;
  Object? _error;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final locale = Localizations.localeOf(context).languageCode;
    if (locale != _locale) {
      _locale = locale;
      _documents = null;
      _accepted.clear();
      _loadConsents(locale);
    }
  }

  Future<void> _loadConsents(String locale) async {
    try {
      final documents = await ref.read(authRepositoryProvider).consents(locale);
      if (mounted && _locale == locale) {
        setState(() {
          _documents = documents;
          _error = null;
        });
      }
    } catch (error) {
      if (mounted && _locale == locale) setState(() => _error = error);
    }
  }

  @override
  void dispose() {
    _code.dispose();
    _name.dispose();
    _codeFocus.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirm() => _run(() async {
    if (_documents == null || _accepted.length != 3) return;
    await ref
        .read(authControllerProvider.notifier)
        .completeRegistration(
          locale: _locale!,
          documents: _documents!,
          emailToken: _code.text.trim(),
          name: _name.text.trim(),
        );
    if (ref.read(authControllerProvider).value?.error?.message ==
        'consent_version_changed') {
      _accepted.clear();
      await _loadConsents(_locale!);
    }
  });

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(authControllerProvider).value;
    final nextAction = state?.registrationGrant?['next_action'];
    final email =
        nextAction == 'verify_email' || nextAction == 'accept_consents';
    // No emailed code when the API skips verification (local development).
    final needsCode = nextAction == 'verify_email';
    final error = _error ?? state?.error;
    final title = AppLocalizations.of(context).authCompleteRegistration;
    return Scaffold(
      key: const ValueKey('registrationCompletionScreen'),
      appBar: AppBar(
        title: Text(title),
        automaticallyImplyLeading: false,
        actions: const [LanguageSwitch()],
      ),
      body: DarbFormPage(
        icon: Icons.verified_user_outlined,
        title: title,
        subtitle: AppLocalizations.of(context).authReadAcceptAllRequired,
        children: [
          if (!email) ...[
            TextField(
              controller: _name,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(
                labelText: AppLocalizations.of(context).fullName,
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: AppTokens.spaceMedium),
          ],
          if (_documents == null && _error == null)
            const Center(child: CircularProgressIndicator()),
          for (final document in _documents ?? <Map<String, dynamic>>[]) ...[
            Padding(
              padding: const EdgeInsets.only(bottom: AppTokens.spaceSmall),
              child: Material(
                color: AppTheme.surfaceContainerLow,
                clipBehavior: Clip.antiAlias,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
                  side: const BorderSide(color: AppTheme.outlineVariant),
                ),
                child: Column(
                  children: [
                    ExpansionTile(
                      shape: const Border(),
                      collapsedShape: const Border(),
                      title: Text(switch (document['type']) {
                        'terms' => AppLocalizations.of(
                          context,
                        ).onboardingTermsService,
                        'privacy' => AppLocalizations.of(
                          context,
                        ).onboardingPrivacyPolicy,
                        _ => AppLocalizations.of(
                          context,
                        ).authAdultSelfAttestation,
                      }),
                      children: [
                        Padding(
                          padding: const EdgeInsets.all(12),
                          child: SelectableText(document['content'] as String),
                        ),
                      ],
                    ),
                    CheckboxListTile(
                      value: _accepted.contains(document['id']),
                      onChanged: _busy
                          ? null
                          : (checked) => setState(() {
                              checked == true
                                  ? _accepted.add(document['id'] as String)
                                  : _accepted.remove(document['id']);
                            }),
                      title: Text(
                        AppLocalizations.of(context).authIHaveReadAccept,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
          if (_error != null && _documents == null)
            TextButton(
              onPressed: () => _loadConsents(_locale!),
              child: Text(AppLocalizations.of(context).retry),
            ),
          if (needsCode) ...[
            const SizedBox(height: AppTokens.spaceSmall),
            _codeField(context),
          ],
          if (error != null) ...[
            const SizedBox(height: AppTokens.spaceMedium),
            Semantics(
              liveRegion: true,
              child: Text(
                authFailure(context, error),
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          ],
          const SizedBox(height: AppTokens.spaceMedium),
          FilledButton(
            key: const ValueKey('completeAuth'),
            onPressed:
                _busy ||
                    _documents == null ||
                    _accepted.length != 3 ||
                    (needsCode
                        ? !RegExp(r'^\d{6}$').hasMatch(_code.text.trim())
                        : !email && _name.text.trim().isEmpty)
                ? null
                : _confirm,
            child: _busy
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(AppLocalizations.of(context).continueAction),
          ),
          TextButton(
            onPressed: _busy
                ? null
                : () => ref
                      .read(authControllerProvider.notifier)
                      .cancelRegistration(),
            child: Text(AppLocalizations.of(context).authCancelRegistration),
          ),
        ],
      ),
    );
  }

  Widget _codeField(BuildContext context) => TextField(
    key: const ValueKey('authProof'),
    controller: _code,
    focusNode: _codeFocus,
    textDirection: TextDirection.ltr,
    autocorrect: false,
    enableSuggestions: false,
    keyboardType: TextInputType.number,
    inputFormatters: [
      FilteringTextInputFormatter.digitsOnly,
      LengthLimitingTextInputFormatter(6),
    ],
    autofillHints: const [AutofillHints.oneTimeCode],
    onChanged: (_) => setState(() {}),
    onSubmitted: (_) => _busy ? null : _confirm(),
    decoration: InputDecoration(
      prefixIcon: const Icon(Icons.pin_outlined),
      labelText: AppLocalizations.of(context).authSixDigitCodeFrom,
    ),
  );
}
