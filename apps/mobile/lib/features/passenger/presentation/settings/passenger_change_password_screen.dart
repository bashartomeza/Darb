import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/api/api_error.dart';
import '../../../../core/validation/password_rule.dart';
import '../../../../core/widgets/darb_text_field.dart';
import '../../../auth/application/auth_controller.dart';
import '../../../auth/data/auth_repository.dart';
import '../../../auth/presentation/auth_completion_screen.dart'
    show authFailure;
import '../../../auth/presentation/credential_actions.dart';
import 'settings_widgets.dart';
import '../../../../l10n/app_localizations.dart';

/// Current password, new password and confirmation.
///
/// Uses the same `/auth/password/set` call as the older credential dialog, so
/// the server rules are unchanged. Changing the password ends every session, so
/// on success the passenger is told and then signed out.
class PassengerChangePasswordScreen extends ConsumerStatefulWidget {
  const PassengerChangePasswordScreen({super.key});

  @override
  ConsumerState<PassengerChangePasswordScreen> createState() =>
      _PassengerChangePasswordScreenState();
}

class _PassengerChangePasswordScreenState
    extends ConsumerState<PassengerChangePasswordScreen> {
  final _current = TextEditingController();
  final _new = TextEditingController();
  final _confirm = TextEditingController();
  bool _showCurrent = false;
  bool _showNew = false;
  bool _submitted = false;
  bool _busy = false;
  Object? _error;

  @override
  void dispose() {
    _current.dispose();
    _new.dispose();
    _confirm.dispose();
    super.dispose();
  }

  String? _currentError(BuildContext context) =>
      _submitted && _current.text.isEmpty
      ? AppLocalizations.of(context).changePasswordEnterCurrentPassword
      : null;

  String? _newError(BuildContext context) {
    if (!_submitted) return null;
    if (!validNewPassword(_new.text)) return passwordRuleHint(context);
    if (_new.text == _current.text) {
      return AppLocalizations.of(
        context,
      ).changePasswordChoosePasswordDifferentFrom;
    }
    return null;
  }

  String? _confirmError(BuildContext context) =>
      _submitted && _confirm.text != _new.text
      ? AppLocalizations.of(context).changePasswordPasswordsDoNotMatch
      : null;

  Future<void> _submit() async {
    setState(() => _submitted = true);
    if (_currentError(context) != null ||
        _newError(context) != null ||
        _confirmError(context) != null) {
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(authRepositoryProvider)
          .setPassword(_new.text, _current.text, '');
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error;
          _busy = false;
        });
      }
      return;
    }
    if (!mounted) return;
    setState(() => _busy = false);
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => AlertDialog(
        title: Text(
          AppLocalizations.of(dialogContext).changePasswordPasswordChanged,
        ),
        content: Text(
          AppLocalizations.of(
            dialogContext,
          ).changePasswordSecurityPleaseSignAgain,
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(AppLocalizations.of(dialogContext).changePasswordOk),
          ),
        ],
      ),
    );
    await ref.read(authControllerProvider.notifier).logout();
  }

  /// A wrong current password comes back as a 403 `reauthentication_required`,
  /// which the shared message words for the email-proof flow; here it just means
  /// "that isn't your password".
  String _failure(BuildContext context) {
    final error = _error;
    if (error is ApiException && error.message == 'reauthentication_required') {
      return AppLocalizations.of(
        context,
      ).changePasswordCurrentPasswordIncorrect;
    }
    return authFailure(context, error);
  }

  Widget _visibilityToggle(bool shown, VoidCallback onPressed) => IconButton(
    onPressed: onPressed,
    icon: Icon(
      shown ? Icons.visibility_off_outlined : Icons.visibility_outlined,
    ),
  );

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: AppLocalizations.of(context).settingsChangePassword,
      children: [
        DarbTextField(
          key: const ValueKey('passwordCurrent'),
          controller: _current,
          label: AppLocalizations.of(context).authCurrentPassword,
          prefixIcon: Icons.lock_outline_rounded,
          obscureText: !_showCurrent,
          textInputAction: TextInputAction.next,
          autofillHints: const [AutofillHints.password],
          errorText: _currentError(context),
          onChanged: (_) => setState(() {}),
          suffixIcon: _visibilityToggle(
            _showCurrent,
            () => setState(() => _showCurrent = !_showCurrent),
          ),
        ),
        const SizedBox(height: 16),
        DarbTextField(
          key: const ValueKey('passwordNew'),
          controller: _new,
          label: AppLocalizations.of(context).authNewPassword,
          prefixIcon: Icons.lock_reset_rounded,
          obscureText: !_showNew,
          textInputAction: TextInputAction.next,
          autofillHints: const [AutofillHints.newPassword],
          helper: passwordRuleHint(context),
          errorText: _newError(context),
          onChanged: (_) => setState(() {}),
          suffixIcon: _visibilityToggle(
            _showNew,
            () => setState(() => _showNew = !_showNew),
          ),
        ),
        const SizedBox(height: 16),
        DarbTextField(
          key: const ValueKey('passwordConfirm'),
          controller: _confirm,
          label: AppLocalizations.of(context).changePasswordConfirmNewPassword,
          prefixIcon: Icons.verified_user_outlined,
          obscureText: !_showNew,
          textInputAction: TextInputAction.done,
          errorText: _confirmError(context),
          onChanged: (_) => setState(() {}),
          onSubmitted: (_) => _busy ? null : _submit(),
        ),
        if (_error != null) ...[
          const SizedBox(height: 16),
          Semantics(
            liveRegion: true,
            child: Text(
              _failure(context),
              key: const ValueKey('passwordError'),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        ],
        const SizedBox(height: 24),
        FilledButton(
          key: const ValueKey('passwordSubmit'),
          onPressed: _busy ? null : _submit,
          child: _busy
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.5,
                    color: Colors.white,
                  ),
                )
              : Text(AppLocalizations.of(context).changePasswordUpdatePassword),
        ),
        const SizedBox(height: 8),
        // Google-only accounts have no password to type in; the existing
        // dialog lets them prove ownership by email instead.
        TextButton(
          key: const ValueKey('passwordNoPassword'),
          onPressed: _busy ? null : () => openCredentialAction(context, 'set'),
          child: Text(AppLocalizations.of(context).changePasswordIDonTHave),
        ),
      ],
    );
  }
}
