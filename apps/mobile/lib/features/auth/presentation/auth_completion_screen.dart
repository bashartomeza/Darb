import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api/api_error.dart';
import '../../../core/widgets/language_switch.dart';
import '../application/auth_controller.dart';
import '../data/auth_repository.dart';

String authText(BuildContext context, String en, String ar) =>
    Localizations.localeOf(context).languageCode == 'ar' ? ar : en;

String authFailure(BuildContext context, Object? error) {
  final code = error is ApiException ? error.message : '';
  return switch (code) {
    'explicit_link_required' || 'email_taken' => authText(
      context,
      'Sign in to your existing account, then link Google in account security.',
      'سجل الدخول إلى حسابك الحالي ثم اربط Google من إعدادات أمان الحساب.',
    ),
    'phone_already_in_use' => authText(
      context,
      'This phone belongs to another account. Recover that account or contact support.',
      'هذا الرقم مرتبط بحساب آخر. استعد ذلك الحساب أو تواصل مع الدعم.',
    ),
    'email_verification_required' => authText(
      context,
      'Verify your email using the email verification option below.',
      'تحقق من بريدك باستخدام خيار التحقق أدناه.',
    ),
    'auth_action_invalid' || 'phone_verification_invalid' => authText(
      context,
      'The proof is incorrect or expired. Request a new code, or restart email registration.',
      'الإثبات غير صحيح أو منتهي. اطلب رمزاً جديداً أو أعد بدء التسجيل بالبريد.',
    ),
    'invalid_password' => authText(
      context,
      'Use 12–72 characters, with no more than 72 UTF-8 bytes.',
      'استخدم 12–72 حرفاً، وبحد أقصى 72 بايت UTF-8.',
    ),
    'consent_version_changed' => authText(
      context,
      'The documents changed. Read and accept the latest versions.',
      'تغيرت المستندات. اقرأ أحدث الإصدارات ووافق عليها.',
    ),
    'reauthentication_required' => authText(
      context,
      'Confirm your current password or request a fresh email proof.',
      'أكد كلمة المرور الحالية أو اطلب إثبات بريد جديداً.',
    ),
    'google_identity_conflict' => authText(
      context,
      'This Google identity is already linked. Use account recovery or contact support.',
      'هوية Google مرتبطة بالفعل. استخدم استعادة الحساب أو تواصل مع الدعم.',
    ),
    'invalid_phone' => authText(
      context,
      'Enter a valid international phone number beginning with +.',
      'أدخل رقم هاتف دولياً صحيحاً يبدأ بعلامة +.',
    ),
    'google_signup_unavailable' => authText(
      context,
      'Google passenger registration is not available for this account yet.',
      'التسجيل كراكب باستخدام Google غير متاح لهذا الحساب بعد.',
    ),
    _ => authText(
      context,
      'Unable to complete the request. Check your connection and try again.',
      'تعذر إكمال الطلب. تحقق من الاتصال وحاول مجدداً.',
    ),
  };
}

class AuthCompletionScreen extends ConsumerStatefulWidget {
  const AuthCompletionScreen({super.key, required this.phone});
  final bool phone;
  @override
  ConsumerState<AuthCompletionScreen> createState() =>
      _AuthCompletionScreenState();
}

class _AuthCompletionScreenState extends ConsumerState<AuthCompletionScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _name = TextEditingController();
  final _codeFocus = FocusNode();
  List<Map<String, dynamic>>? _documents;
  String? _locale;
  String? _phoneToken;
  String? _verifiedPhone;
  bool _phoneConfirmed = false;
  final Set<String> _accepted = {};
  bool _busy = false;
  Object? _error;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final locale = Localizations.localeOf(context).languageCode;
    if (widget.phone && _locale == null) {
      _locale = locale;
      _phone.text = ref.read(authControllerProvider).value?.user?.phone ?? '';
    }
    if (!widget.phone && locale != _locale) {
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
    _phone.dispose();
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
      if (mounted) {
        setState(() {
          _error = error;
          if (widget.phone &&
              error is ApiException &&
              error.message == 'auth_action_invalid') {
            _phoneToken = null;
            _verifiedPhone = null;
            _code.clear();
          }
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendPhone() => _run(() async {
    if (_phoneConfirmed) return;
    final value = _phone.text.trim();
    if (!RegExp(r'^\+[1-9]\d{6,14}$').hasMatch(value)) {
      throw const ApiException(ApiErrorType.validation, 'invalid_phone');
    }
    final response = await ref
        .read(authRepositoryProvider)
        .startPhone(value, Localizations.localeOf(context).languageCode);
    if (response['action_token'] is! String) {
      throw const ApiException(ApiErrorType.validation, 'invalid_response');
    }
    _phoneToken = response['action_token'] as String;
    _verifiedPhone = value;
    _code.clear();
    _codeFocus.requestFocus();
  });
  Future<void> _confirm() => _run(() async {
    if (widget.phone
        ? !_phoneConfirmed &&
              (_phoneToken == null ||
                  !RegExp(r'^\d{6}$').hasMatch(_code.text.trim()))
        : _documents == null || _accepted.length != 3) {
      return;
    }
    if (widget.phone) {
      if (!_phoneConfirmed) {
        await ref
            .read(authRepositoryProvider)
            .confirmPhone(_verifiedPhone!, _phoneToken!, _code.text.trim());
        // The server consumed the challenge. A failed profile reload must
        // retry only the read, never submit the same proof a second time.
        _phoneConfirmed = true;
        _phoneToken = null;
        _code.clear();
      }
      await ref.read(authControllerProvider.notifier).reloadProfile();
    } else {
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
    }
  });

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(authControllerProvider).value;
    final email = state?.registrationGrant?['next_action'] == 'verify_email';
    final error = _error ?? state?.error;
    final title = widget.phone
        ? authText(context, 'Verify your phone', 'تحقق من رقم هاتفك')
        : authText(context, 'Complete registration', 'إكمال التسجيل');
    return Scaffold(
      key: ValueKey(
        widget.phone ? 'phoneCompletionScreen' : 'registrationCompletionScreen',
      ),
      appBar: AppBar(
        title: Text(title),
        automaticallyImplyLeading: false,
        actions: const [LanguageSwitch()],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            if (widget.phone) ...[
              Text(
                authText(
                  context,
                  'Add a real contact number before using Masari services. We email the verification code to the email address on your account.',
                  'أضف رقم تواصل حقيقياً قبل استخدام خدمات مساري. نرسل رمز التحقق إلى البريد الإلكتروني المسجل في حسابك.',
                ),
              ),
              TextField(
                key: const ValueKey('profilePhone'),
                controller: _phone,
                enabled: !_busy && !_phoneConfirmed && _phoneToken == null,
                textDirection: TextDirection.ltr,
                keyboardType: TextInputType.phone,
                autofillHints: const [AutofillHints.telephoneNumber],
                decoration: InputDecoration(
                  labelText: authText(
                    context,
                    'Phone in international format (+country code)',
                    'الهاتف بالصيغة الدولية (+رمز الدولة)',
                  ),
                ),
              ),
              FilledButton(
                onPressed: _busy || _phoneConfirmed ? null : _sendPhone,
                child: Text(
                  authText(
                    context,
                    _phoneToken == null ? 'Send code' : 'Resend code',
                    _phoneToken == null ? 'إرسال الرمز' : 'إعادة إرسال الرمز',
                  ),
                ),
              ),
              if (_phoneToken != null)
                TextButton(
                  onPressed: _busy
                      ? null
                      : () => setState(() {
                          _phoneToken = null;
                          _verifiedPhone = null;
                          _code.clear();
                        }),
                  child: Text(
                    authText(
                      context,
                      'Change phone number',
                      'تغيير رقم الهاتف',
                    ),
                  ),
                ),
            ] else ...[
              Text(
                authText(
                  context,
                  'Read and accept all required documents to create your passenger account.',
                  'اقرأ ووافق على المستندات المطلوبة لإنشاء حساب الراكب.',
                ),
              ),
              if (!email)
                TextField(
                  controller: _name,
                  textInputAction: TextInputAction.next,
                  decoration: InputDecoration(
                    labelText: authText(context, 'Full name', 'الاسم الكامل'),
                  ),
                  onChanged: (_) => setState(() {}),
                ),
              if (_documents == null && _error == null)
                const Center(child: CircularProgressIndicator()),
              for (final document
                  in _documents ?? <Map<String, dynamic>>[]) ...[
                ExpansionTile(
                  title: Text(
                    authText(
                      context,
                      switch (document['type']) {
                        'terms' => 'Terms of service',
                        'privacy' => 'Privacy policy',
                        _ => 'Adult self-attestation',
                      },
                      switch (document['type']) {
                        'terms' => 'شروط الخدمة',
                        'privacy' => 'سياسة الخصوصية',
                        _ => 'الإقرار ببلوغ السن القانوني',
                      },
                    ),
                  ),
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
                    authText(
                      context,
                      'I have read and accept this document',
                      'قرأت هذا المستند وأوافق عليه',
                    ),
                  ),
                ),
              ],
              if (_error != null && _documents == null)
                TextButton(
                  onPressed: () => _loadConsents(_locale!),
                  child: Text(authText(context, 'Retry', 'إعادة المحاولة')),
                ),
            ],
            if ((widget.phone && _phoneToken != null) ||
                (!widget.phone && email))
              TextField(
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
                  labelText: authText(
                    context,
                    'Six-digit code from your email',
                    'الرمز المكون من ستة أرقام من بريدك الإلكتروني',
                  ),
                ),
              ),
            if (error != null)
              Semantics(
                liveRegion: true,
                child: Text(
                  authFailure(context, error),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            const SizedBox(height: 16),
            FilledButton(
              key: const ValueKey('completeAuth'),
              onPressed:
                  _busy ||
                      (widget.phone
                          ? !_phoneConfirmed &&
                                (_phoneToken == null ||
                                    !RegExp(
                                      r'^\d{6}$',
                                    ).hasMatch(_code.text.trim()))
                          : _documents == null ||
                                _accepted.length != 3 ||
                                (email
                                    ? !RegExp(
                                        r'^\d{6}$',
                                      ).hasMatch(_code.text.trim())
                                    : _name.text.trim().isEmpty))
                  ? null
                  : _confirm,
              child: _busy
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(authText(context, 'Continue', 'متابعة')),
            ),
            TextButton(
              onPressed: _busy
                  ? null
                  : () => widget.phone
                        ? ref.read(authControllerProvider.notifier).logout()
                        : ref
                              .read(authControllerProvider.notifier)
                              .cancelRegistration(),
              child: Text(
                authText(
                  context,
                  widget.phone ? 'Sign out' : 'Cancel registration',
                  widget.phone ? 'تسجيل الخروج' : 'إلغاء التسجيل',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
