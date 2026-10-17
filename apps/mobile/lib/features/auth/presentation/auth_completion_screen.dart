import 'package:flutter/material.dart';
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
    'email_verification_required' => authText(
      context,
      'Verify your email using the email verification option below.',
      'تحقق من بريدك باستخدام خيار التحقق أدناه.',
    ),
    'auth_action_invalid' => authText(
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
      if (mounted) {
        setState(() => _error = error);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirm() => _run(() async {
    if (_documents == null || _accepted.length != 3) {
      return;
    }
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
    final email = state?.registrationGrant?['next_action'] == 'verify_email';
    final error = _error ?? state?.error;
    return Scaffold(
      key: const ValueKey('registrationCompletionScreen'),
      appBar: AppBar(
        title: Text(authText(context, 'Complete registration', 'إكمال التسجيل')),
        automaticallyImplyLeading: false,
        actions: const [LanguageSwitch()],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
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
            if (email)
              TextField(
                key: const ValueKey('authProof'),
                controller: _code,
                focusNode: _codeFocus,
                textDirection: TextDirection.ltr,
                autocorrect: false,
                enableSuggestions: false,
                onChanged: (_) => setState(() {}),
                onSubmitted: (_) => _busy ? null : _confirm(),
                decoration: InputDecoration(
                  labelText: authText(
                    context,
                    'Verification token from your email',
                    'رمز التحقق من بريدك الإلكتروني',
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
                      (_documents == null ||
                          _accepted.length != 3 ||
                          (email
                              ? _code.text.trim().isEmpty
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
                  : () => ref
                        .read(authControllerProvider.notifier)
                        .cancelRegistration(),
              child: Text(
                authText(context, 'Cancel registration', 'إلغاء التسجيل'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
