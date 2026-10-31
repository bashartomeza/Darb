import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api/api_error.dart';
import '../application/auth_controller.dart';
import '../data/auth_repository.dart';
import 'auth_completion_screen.dart';
import 'widgets/google_auth_button.dart';

bool validNewPassword(String value) =>
    value.length >= 12 && value.length <= 72 && utf8.encode(value).length <= 72;

/// Action proofs stay in this dialog's memory and are cleared on disposal.
class CredentialActionDialog extends ConsumerStatefulWidget {
  const CredentialActionDialog({super.key, required this.action});
  final String action; // reset, verify, set, link
  @override
  ConsumerState<CredentialActionDialog> createState() =>
      _CredentialActionDialogState();
}

class _CredentialActionDialogState
    extends ConsumerState<CredentialActionDialog> {
  final _email = TextEditingController();
  final _proof = TextEditingController();
  final _password = TextEditingController();
  final _current = TextEditingController();
  final _proofFocus = FocusNode();
  bool _busy = false;
  bool _sent = false;
  bool _done = false;
  Object? _error;
  bool get _authenticated => ['set', 'link'].contains(widget.action);
  bool get _passwordAction => ['set', 'reset'].contains(widget.action);
  bool get _codeComplete => RegExp(r'^\d{6}$').hasMatch(_proof.text.trim());
  // Resetting or verifying always needs the emailed code; changing a password
  // can instead be proven with the current password.
  bool get _canConfirm => widget.action == 'set'
      ? _codeComplete || _current.text.isNotEmpty
      : _codeComplete;
  @override
  void dispose() {
    _email.dispose();
    _proof.dispose();
    _password.dispose();
    _current.dispose();
    _proofFocus.dispose();
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

  Future<void> _start() => _run(() async {
    final repo = ref.read(authRepositoryProvider);
    final locale = Localizations.localeOf(context).languageCode;
    if (widget.action == 'set') {
      await repo.passwordSetStart(locale);
    } else if (widget.action == 'link') {
      await repo.googleLinkStart(locale);
    } else {
      await repo.emailActionStart(
        _email.text.trim().toLowerCase(),
        locale,
        reset: widget.action == 'reset',
      );
    }
    _sent = true;
    _proofFocus.requestFocus();
  });
  Future<void> _confirm({String? googleToken}) => _run(() async {
    final repo = ref.read(authRepositoryProvider);
    if (_passwordAction && !validNewPassword(_password.text)) {
      throw const ApiException(ApiErrorType.validation, 'invalid_password');
    }
    if (widget.action == 'set') {
      await repo.setPassword(_password.text, _current.text, _proof.text.trim());
    } else if (widget.action == 'link') {
      if (googleToken == null) return;
      await repo.linkGoogle(googleToken, _current.text, _proof.text.trim());
    } else {
      await repo.emailActionConfirm(
        _email.text.trim().toLowerCase(),
        _proof.text.trim(),
        _password.text,
        reset: widget.action == 'reset',
      );
    }
    _done = true;
    _proof.clear();
    _password.clear();
    _current.clear();
    if (widget.action == 'set') {
      await ref.read(authControllerProvider.notifier).logout();
    }
  });
  @override
  Widget build(BuildContext context) {
    final title = switch (widget.action) {
      'set' => authText(
        context,
        'Set or change password',
        'تعيين أو تغيير كلمة المرور',
      ),
      'link' => authText(context, 'Link Google explicitly', 'ربط حساب Google'),
      'verify' => authText(
        context,
        'Verify email',
        'التحقق من البريد الإلكتروني',
      ),
      _ => authText(context, 'Reset password', 'إعادة تعيين كلمة المرور'),
    };
    return PopScope(
      canPop: !_busy,
      child: AlertDialog(
        title: Text(title),
        content: SizedBox(
          width: 420,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_done)
                  Semantics(
                    liveRegion: true,
                    child: Text(
                      authText(
                        context,
                        'Completed. Sign in again if needed.',
                        'اكتمل الطلب. سجل الدخول مجدداً عند الحاجة.',
                      ),
                    ),
                  )
                else ...[
                  if (!_authenticated)
                    TextField(
                      key: const ValueKey('recoveryEmail'),
                      controller: _email,
                      textDirection: TextDirection.ltr,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      textInputAction: TextInputAction.next,
                      decoration: InputDecoration(
                        labelText: authText(
                          context,
                          'Email',
                          'البريد الإلكتروني',
                        ),
                      ),
                    ),
                  if (_authenticated) ...[
                    Text(
                      authText(
                        context,
                        'Enter your current password. If you have no password, request an email proof.',
                        'أدخل كلمة المرور الحالية. إذا لم تكن لديك كلمة مرور، اطلب إثباتاً عبر البريد الإلكتروني.',
                      ),
                    ),
                    TextField(
                      controller: _current,
                      onChanged: (_) => setState(() {}),
                      obscureText: true,
                      autofillHints: const [AutofillHints.password],
                      decoration: InputDecoration(
                        labelText: authText(
                          context,
                          'Current password',
                          'كلمة المرور الحالية',
                        ),
                      ),
                    ),
                  ],
                  TextButton(
                    onPressed: _busy ? null : _start,
                    child: Text(
                      authText(
                        context,
                        'Send email proof',
                        'إرسال إثبات البريد',
                      ),
                    ),
                  ),
                  if (_sent)
                    Semantics(
                      liveRegion: true,
                      child: Text(
                        authText(
                          context,
                          'If eligible, an email has been sent. Check your inbox and spam folder.',
                          'إذا كان الحساب مؤهلاً، أُرسلت رسالة. تحقق من الوارد والبريد غير المرغوب.',
                        ),
                      ),
                    ),
                  TextField(
                    key: const ValueKey('credentialCode'),
                    controller: _proof,
                    focusNode: _proofFocus,
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
                    decoration: InputDecoration(
                      labelText: authText(
                        context,
                        'Six-digit code from your email',
                        'الرمز المكون من ستة أرقام من بريدك الإلكتروني',
                      ),
                    ),
                  ),
                  if (_passwordAction)
                    TextField(
                      controller: _password,
                      obscureText: true,
                      autofillHints: const [AutofillHints.newPassword],
                      decoration: InputDecoration(
                        labelText: authText(
                          context,
                          'New password',
                          'كلمة المرور الجديدة',
                        ),
                        helperText: authText(
                          context,
                          '12–72 characters; maximum 72 UTF-8 bytes.',
                          '12–72 حرفاً؛ بحد أقصى 72 بايت UTF-8.',
                        ),
                      ),
                    ),
                  if (widget.action == 'link') ...[
                    Text(
                      authText(
                        context,
                        'Selecting Google confirms linking that identity to this signed-in account.',
                        'اختيار Google يؤكد ربط تلك الهوية بهذا الحساب المسجل دخوله.',
                      ),
                    ),
                    GoogleAuthButton(
                      enabled: !_busy,
                      onIdToken: (token) => _confirm(googleToken: token),
                      onError: (error) {
                        if (mounted) setState(() => _error = error);
                      },
                    ),
                  ],
                  if (_error != null)
                    Semantics(
                      liveRegion: true,
                      child: Text(
                        authFailure(context, _error),
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                  if (_busy) const CircularProgressIndicator(),
                ],
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: _busy ? null : () => Navigator.of(context).pop(),
            child: Text(authText(context, 'Close', 'إغلاق')),
          ),
          if (!_done && widget.action != 'link')
            FilledButton(
              key: const ValueKey('credentialConfirm'),
              onPressed: _busy || !_canConfirm ? null : _confirm,
              child: Text(authText(context, 'Confirm', 'تأكيد')),
            ),
        ],
      ),
    );
  }
}

Future<void> openCredentialAction(BuildContext context, String action) =>
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => CredentialActionDialog(action: action),
    );

class CredentialSettings extends StatelessWidget {
  const CredentialSettings({super.key});
  @override
  Widget build(BuildContext context) => Column(
    children: [
      ListTile(
        leading: const Icon(Icons.password),
        title: Text(
          authText(
            context,
            'Set or change password',
            'تعيين أو تغيير كلمة المرور',
          ),
        ),
        onTap: () => openCredentialAction(context, 'set'),
      ),
      ListTile(
        leading: const Icon(Icons.link),
        title: Text(
          authText(context, 'Link Google account', 'ربط حساب Google'),
        ),
        onTap: () => openCredentialAction(context, 'link'),
      ),
    ],
  );
}
