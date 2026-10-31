import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/i18n/locale_controller.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_card.dart';
import '../application/onboarding_controller.dart';
import '../domain/onboarding_models.dart';
import 'driver_documents_card.dart';

class OnboardingFlowScreen extends ConsumerStatefulWidget {
  const OnboardingFlowScreen({super.key});

  @override
  ConsumerState<OnboardingFlowScreen> createState() =>
      _OnboardingFlowScreenState();
}

class _OnboardingFlowScreenState extends ConsumerState<OnboardingFlowScreen> {
  final _invitation = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _otp = TextEditingController();
  final _displayName = TextEditingController();
  final _password = TextEditingController();
  final _confirmPassword = TextEditingController();
  bool _terms = false;
  bool _privacy = false;
  bool _adult = false;
  bool _showPassword = false;
  bool _showConfirmPassword = false;
  Set<String> _uploadedKinds = const {};
  Timer? _timer;
  DateTime _now = DateTime.now().toUtc();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      // Arriving from the register screen with a role already chosen: keep it.
      final current = ref.read(onboardingControllerProvider).value;
      if (current?.enabled == true &&
          current?.stage == OnboardingStage.enteringInvitation &&
          current?.selectedRole != null) {
        return;
      }
      ref.read(onboardingControllerProvider.notifier).refreshAvailability();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _invitation.dispose();
    _phone.dispose();
    _email.dispose();
    _otp.dispose();
    _displayName.dispose();
    _password.dispose();
    _confirmPassword.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final asyncState = ref.watch(onboardingControllerProvider);
    final l10n = AppLocalizations.of(context);
    ref.listen(onboardingControllerProvider, (previous, next) {
      final before = previous?.value?.consentRevision ?? 0;
      final after = next.value?.consentRevision ?? 0;
      if (after != before && mounted) {
        setState(() {
          _terms = false;
          _privacy = false;
          _adult = false;
        });
      }
    });
    final current = asyncState.value;
    final warnBeforeLeaving =
        current?.attemptId != null &&
        current?.stage != OnboardingStage.passengerCreated &&
        current?.stage != OnboardingStage.approvedSignIn &&
        current?.stage != OnboardingStage.pendingReview;
    return PopScope(
      canPop: !warnBeforeLeaving,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop || !warnBeforeLeaving) return;
        final leave = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: Text(l10n.leaveRegistration),
            content: Text(l10n.leaveRegistrationWarning),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: Text(l10n.cancel),
              ),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: Text(l10n.leaveRegistration),
              ),
            ],
          ),
        );
        if (leave == true) {
          await ref.read(onboardingControllerProvider.notifier).clear();
          _clearSecrets();
          if (context.mounted) context.go('/login');
        }
      },
      child: Scaffold(
        appBar: AppBar(
          leading: warnBeforeLeaving
              ? BackButton(onPressed: () => Navigator.of(context).maybePop())
              : null,
          title: Text(l10n.createAccount),
          actions: const [LanguageSwitch()],
        ),
        body: SafeArea(
          child: asyncState.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (_, _) => _Unavailable(l10n: l10n),
            data: (state) => ListView(
              padding: const EdgeInsets.all(AppTokens.spaceLarge),
              children: [
                if (state.errorCode != null) _ErrorBox(code: state.errorCode!),
                _bodyFor(context, state),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _bodyFor(BuildContext context, OnboardingState state) {
    final l10n = AppLocalizations.of(context);
    if (state.stage != OnboardingStage.otpSent &&
        state.stage != OnboardingStage.resending &&
        state.stage != OnboardingStage.verifyingOtp) {
      _timer?.cancel();
      _timer = null;
    }
    if (state.stage == OnboardingStage.retryableFailure) {
      return _retryStep(context, state);
    }
    if (!state.enabled || state.stage == OnboardingStage.unavailable) {
      return _Unavailable(l10n: l10n);
    }
    return switch (state.stage) {
      OnboardingStage.checkingAvailability => const Center(
        child: CircularProgressIndicator(),
      ),
      OnboardingStage.unavailable => _Unavailable(l10n: l10n),
      OnboardingStage.choosingRole => _roleStep(context, state),
      OnboardingStage.enteringInvitation ||
      OnboardingStage.enteringPhone ||
      OnboardingStage.starting => _startStep(context, state),
      OnboardingStage.otpSent ||
      OnboardingStage.resending ||
      OnboardingStage.verifyingOtp => _otpStep(context, state),
      OnboardingStage.phoneVerified ||
      OnboardingStage.loadingConsents ||
      OnboardingStage.enteringAccountDetails ||
      OnboardingStage.reviewingConsents ||
      OnboardingStage.completingRegistration => _accountStep(context, state),
      OnboardingStage.passengerCreated => _passengerResult(context),
      OnboardingStage.approvedSignIn => _approvedResult(context),
      OnboardingStage.pendingReview => _pendingCard(context, state),
      OnboardingStage.retryableFailure => _retryStep(context, state),
      OnboardingStage.terminalFailure => _terminalStep(context, state),
    };
  }

  Widget _roleStep(BuildContext context, OnboardingState state) {
    final l10n = AppLocalizations.of(context);
    final roles = state.config?.registrationRoles ?? const <OnboardingRole>[];
    // Selection cards rather than plain buttons, matching the role-selection
    // reference. Tapping still commits the role immediately — the underlying
    // flow advances on choose, and that behaviour is left untouched.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.selectAccountType,
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: AppTokens.spaceMedium),
        for (final role in roles)
          Padding(
            padding: const EdgeInsets.only(bottom: AppTokens.gutterMobile),
            child: _RoleOptionCard(
              key: ValueKey('onboarding-role-${role.apiValue}'),
              label: _roleLabel(l10n, role),
              help: _roleHelp(l10n, role),
              icon: _roleIcon(role),
              selected: state.selectedRole == role,
              onTap: state.busy
                  ? null
                  : () => ref
                        .read(onboardingControllerProvider.notifier)
                        .chooseRole(role),
            ),
          ),
      ],
    );
  }

  Widget _startStep(BuildContext context, OnboardingState state) {
    final l10n = AppLocalizations.of(context);
    return MasariCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            _roleLabel(l10n, state.selectedRole ?? OnboardingRole.passenger),
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          Directionality(
            textDirection: TextDirection.ltr,
            child: TextField(
              key: const ValueKey('invitationCodeField'),
              controller: _invitation,
              textInputAction: TextInputAction.next,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText:
                    state.config?.openRegistrationRoles.contains(
                          state.selectedRole,
                        ) ==
                        true
                    ? l10n.invitationCodeOptional
                    : l10n.invitationCode,
              ),
            ),
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          Directionality(
            textDirection: TextDirection.ltr,
            child: TextField(
              key: const ValueKey('onboardingPhoneField'),
              controller: _phone,
              keyboardType: TextInputType.phone,
              textInputAction: TextInputAction.done,
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[+0-9٠-٩۰-۹ ()-]')),
                LengthLimitingTextInputFormatter(32),
              ],
              decoration: InputDecoration(
                labelText: l10n.phoneNumber,
                hintText: '+[country code][number]',
              ),
            ),
          ),
          if (_invitation.text.trim().isEmpty) ...[
            const SizedBox(height: AppTokens.spaceMedium),
            Directionality(
              textDirection: TextDirection.ltr,
              child: TextField(
                key: const ValueKey('onboardingEmailField'),
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.done,
                autocorrect: false,
                enableSuggestions: false,
                inputFormatters: [LengthLimitingTextInputFormatter(191)],
                decoration: InputDecoration(labelText: l10n.emailForCode),
              ),
            ),
          ],
          const SizedBox(height: AppTokens.spaceLarge),
          FilledButton(
            key: const ValueKey('sendVerificationCodeButton'),
            onPressed: state.busy ? null : () => _start(state),
            child: state.busy
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(l10n.sendVerificationCode),
          ),
          TextButton(
            onPressed: state.busy
                ? null
                : () => ref
                      .read(onboardingControllerProvider.notifier)
                      .backToRoles(),
            child: Text(l10n.selectAccountType),
          ),
        ],
      ),
    );
  }

  Widget _otpStep(BuildContext context, OnboardingState state) {
    final l10n = AppLocalizations.of(context);
    _ensureTimer();
    final remaining =
        state.resendAvailableAt?.difference(_now) ?? Duration.zero;
    final canResend = remaining <= Duration.zero && !state.busy;
    return MasariCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.enterVerificationCode,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          Text(l10n.codeSentToEmail, key: const ValueKey('codeSentToEmail')),
          if (state.maskedPhone != null) ...[
            const SizedBox(height: AppTokens.spaceSmall),
            Directionality(
              textDirection: TextDirection.ltr,
              child: Text(
                state.maskedPhone!,
                key: const ValueKey('maskedPhone'),
              ),
            ),
          ],
          const SizedBox(height: AppTokens.spaceMedium),
          Directionality(
            textDirection: TextDirection.ltr,
            child: TextField(
              key: const ValueKey('otpField'),
              controller: _otp,
              obscureText: true,
              enableSuggestions: false,
              autocorrect: false,
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9٠-٩۰-۹]')),
                LengthLimitingTextInputFormatter(6),
              ],
              decoration: InputDecoration(
                labelText: l10n.enterVerificationCode,
              ),
            ),
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          FilledButton(
            key: const ValueKey('verifyOtpButton'),
            onPressed: state.busy
                ? null
                : () async {
                    final otp = _otp.text;
                    await ref
                        .read(onboardingControllerProvider.notifier)
                        .verifyOtp(otp);
                    final result = ref.read(onboardingControllerProvider).value;
                    if (result?.stage ==
                            OnboardingStage.enteringAccountDetails ||
                        result?.ambiguousFailure == false) {
                      _otp.clear();
                    }
                  },
            child: Text(l10n.verify),
          ),
          OutlinedButton(
            key: const ValueKey('resendOtpButton'),
            onPressed: canResend
                ? () => ref.read(onboardingControllerProvider.notifier).resend()
                : null,
            child: Text(
              canResend
                  ? l10n.resendCode
                  : '${l10n.resendAvailableIn} ${remaining.inSeconds.clamp(0, 999)} ${l10n.secondsShort}',
            ),
          ),
        ],
      ),
    );
  }

  Widget _accountStep(BuildContext context, OnboardingState state) {
    final l10n = AppLocalizations.of(context);
    final docs = state.documents;
    if (docs.isEmpty && !state.busy) {
      return MasariCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.accountInformation),
            const SizedBox(height: AppTokens.spaceMedium),
            FilledButton(
              onPressed: () => ref
                  .read(onboardingControllerProvider.notifier)
                  .loadConsents(),
              child: Text(l10n.continueRegistration),
            ),
          ],
        ),
      );
    }
    return MasariCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.accountInformation,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          TextField(
            key: const ValueKey('displayNameField'),
            controller: _displayName,
            decoration: InputDecoration(labelText: l10n.displayName),
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          TextField(
            key: const ValueKey('onboardingPasswordField'),
            controller: _password,
            obscureText: !_showPassword,
            decoration: InputDecoration(
              labelText: l10n.password,
              suffixIcon: IconButton(
                tooltip: _showPassword ? l10n.hidePassword : l10n.showPassword,
                onPressed: () => setState(() => _showPassword = !_showPassword),
                icon: Icon(
                  _showPassword ? Icons.visibility_off : Icons.visibility,
                ),
              ),
            ),
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          TextField(
            key: const ValueKey('confirmPasswordField'),
            controller: _confirmPassword,
            obscureText: !_showConfirmPassword,
            decoration: InputDecoration(
              labelText: l10n.confirmPassword,
              suffixIcon: IconButton(
                tooltip: _showConfirmPassword
                    ? l10n.hidePassword
                    : l10n.showPassword,
                onPressed: () => setState(
                  () => _showConfirmPassword = !_showConfirmPassword,
                ),
                icon: Icon(
                  _showConfirmPassword
                      ? Icons.visibility_off
                      : Icons.visibility,
                ),
              ),
            ),
          ),
          const SizedBox(height: AppTokens.spaceLarge),
          Text(l10n.terms, style: Theme.of(context).textTheme.titleMedium),
          for (final document in docs)
            Padding(
              padding: const EdgeInsets.only(top: AppTokens.spaceSmall),
              child: Semantics(
                label:
                    '${_consentLabel(l10n, document.type)}, ${l10n.consentVersion} ${document.version}',
                child: Text(
                  '${_consentLabel(l10n, document.type)} — ${l10n.consentVersion} ${document.version}\n${_safeConsentText(document.content)}',
                  key: ValueKey('consent-${document.type}'),
                ),
              ),
            ),
          CheckboxListTile(
            value: _terms,
            onChanged: state.busy
                ? null
                : (value) => setState(() => _terms = value ?? false),
            title: Text(l10n.terms),
          ),
          CheckboxListTile(
            value: _privacy,
            onChanged: state.busy
                ? null
                : (value) => setState(() => _privacy = value ?? false),
            title: Text(l10n.privacyNotice),
          ),
          CheckboxListTile(
            value: _adult,
            onChanged: state.busy
                ? null
                : (value) => setState(() => _adult = value ?? false),
            title: Text(l10n.confirmAdult),
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          FilledButton(
            key: const ValueKey('createAccountButton'),
            onPressed: state.busy
                ? null
                : () => ref
                      .read(onboardingControllerProvider.notifier)
                      .complete(
                        displayName: _displayName.text,
                        password: _password.text,
                        confirmPassword: _confirmPassword.text,
                        acceptedTerms: _terms,
                        acceptedPrivacy: _privacy,
                        adult: _adult,
                      ),
            child: Text(l10n.createAccount),
          ),
        ],
      ),
    );
  }

  Widget _passengerResult(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    _clearSecrets();
    return MasariCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.accountCreated,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          Text(l10n.signInToContinue),
          const SizedBox(height: AppTokens.spaceMedium),
          FilledButton(
            onPressed: () => context.go('/login'),
            child: Text(l10n.signIn),
          ),
        ],
      ),
    );
  }

  Widget _approvedResult(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    _clearSecrets();
    return MasariCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.accountApproved,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          Text(l10n.signInAfterApproval),
          const SizedBox(height: AppTokens.spaceMedium),
          FilledButton(
            onPressed: () => context.go('/login'),
            child: Text(l10n.signIn),
          ),
        ],
      ),
    );
  }

  Widget _pendingCard(BuildContext context, OnboardingState state) {
    final l10n = AppLocalizations.of(context);
    _clearSecrets();
    final role = state.selectedRole;
    final isApplicant =
        role == OnboardingRole.driver || role == OnboardingRole.merchant;
    final needsDocuments = isApplicant && !state.applicationSubmitted;
    final required = role == OnboardingRole.merchant
        ? merchantRequiredDocumentKinds
        : driverRequiredDocumentKinds;
    final missing = required
        .where((kind) => !_uploadedKinds.contains(kind))
        .toList(growable: false);
    final card = MasariCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            needsDocuments
                ? l10n.applicationDocumentsRequiredTitle
                : l10n.applicationUnderReview,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          Text(
            needsDocuments
                ? l10n.applicationDocumentsRequiredBody
                : l10n.pendingReviewBody,
          ),
          if (role != null) Text(_roleLabel(l10n, role)),
          if (needsDocuments) ...[
            const SizedBox(height: AppTokens.spaceMedium),
            if (missing.isNotEmpty)
              Text(
                l10n.documentsStillNeeded(
                  missing
                      .map((kind) => documentKindLabel(l10n, kind))
                      .join(', '),
                ),
                key: const ValueKey('documentsStillNeeded'),
              ),
            const SizedBox(height: AppTokens.spaceSmall),
            FilledButton(
              key: const ValueKey('submitApplicationButton'),
              onPressed: state.busy || missing.isNotEmpty
                  ? null
                  : () => ref
                        .read(onboardingControllerProvider.notifier)
                        .submitApplication(),
              child: state.busy
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(l10n.submitApplication),
            ),
          ],
          const SizedBox(height: AppTokens.spaceMedium),
          OutlinedButton(
            onPressed: () => ref
                .read(onboardingControllerProvider.notifier)
                .checkPendingStatus(),
            child: Text(l10n.refresh),
          ),
          TextButton(
            onPressed: () async {
              await ref.read(onboardingControllerProvider.notifier).clear();
              if (context.mounted) context.go('/login');
            },
            child: Text(l10n.localLogout),
          ),
        ],
      ),
    );
    if (!isApplicant) return card;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        card,
        const SizedBox(height: AppTokens.spaceMedium),
        DriverDocumentsCard(
          merchant: role == OnboardingRole.merchant,
          onKindsChanged: (kinds) {
            if (mounted) setState(() => _uploadedKinds = kinds);
          },
        ),
      ],
    );
  }

  Widget _retryStep(BuildContext context, OnboardingState state) {
    final l10n = AppLocalizations.of(context);
    return MasariCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(_safeError(l10n, state.errorCode)),
          if (state.requestId != null)
            Text('${l10n.requestReference}: ${state.requestId}'),
          const SizedBox(height: AppTokens.spaceMedium),
          FilledButton(
            onPressed: () => ref
                .read(onboardingControllerProvider.notifier)
                .refreshAvailability(),
            child: Text(l10n.retry),
          ),
        ],
      ),
    );
  }

  Widget _terminalStep(BuildContext context, OnboardingState state) {
    final l10n = AppLocalizations.of(context);
    return MasariCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(_safeError(l10n, state.errorCode)),
          const SizedBox(height: AppTokens.spaceMedium),
          FilledButton(
            onPressed: () async {
              await ref.read(onboardingControllerProvider.notifier).clear();
              if (context.mounted) context.go('/login');
            },
            child: Text(l10n.signIn),
          ),
        ],
      ),
    );
  }

  Future<void> _start(OnboardingState state) async {
    final locale =
        ref.read(localeControllerProvider).value?.languageCode ?? 'ar';
    await ref
        .read(onboardingControllerProvider.notifier)
        .start(
          invitationCode: _invitation.text,
          phone: _phone.text,
          email: _email.text,
          locale: locale == 'en' ? 'en' : 'ar',
        );
    final result = ref.read(onboardingControllerProvider).value;
    if (result?.stage == OnboardingStage.otpSent) {
      _invitation.clear();
      _phone.clear();
      _email.clear();
    }
  }

  void _ensureTimer() {
    _timer ??= Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now().toUtc());
    });
  }

  void _clearSecrets() {
    _otp.clear();
    _password.clear();
    _confirmPassword.clear();
    _invitation.clear();
    _phone.clear();
    _email.clear();
    _displayName.clear();
    _terms = false;
    _privacy = false;
    _adult = false;
  }
}

class _Unavailable extends StatelessWidget {
  const _Unavailable({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return MasariCard(
      child: Column(
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
    );
  }
}

class _ErrorBox extends StatelessWidget {
  const _ErrorBox({required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.spaceMedium),
      child: MasariCard(
        child: Text(
          _safeError(l10n, code),
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
      ),
    );
  }
}

IconData _roleIcon(OnboardingRole role) => switch (role) {
  OnboardingRole.passenger => Icons.person_outline,
  OnboardingRole.driver => Icons.directions_car_outlined,
  OnboardingRole.merchant => Icons.storefront_outlined,
};

/// A selectable account-type card.
///
/// Under Arabic the icon sits on the right (start) and the selection tick on
/// the left (end); both flip automatically for English because the row is laid
/// out in logical, not physical, order.
class _RoleOptionCard extends StatelessWidget {
  const _RoleOptionCard({
    required this.label,
    required this.help,
    required this.icon,
    required this.selected,
    required this.onTap,
    super.key,
  });

  final String label;
  final String help;
  final IconData icon;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return MasariCard(
      onTap: onTap,
      level: selected ? MasariCardLevel.floating : MasariCardLevel.card,
      background: selected
          ? AppTheme.surfaceContainerLow
          : AppTheme.surfaceContainerLowest,
      border: BorderSide(
        color: selected ? AppTheme.primary : AppTheme.outlineVariant,
        width: selected ? 2 : 1,
      ),
      child: Row(
        children: [
          Container(
            width: AppTokens.minTouchTarget,
            height: AppTokens.minTouchTarget,
            decoration: BoxDecoration(
              color: AppTheme.primaryContainer,
              borderRadius: BorderRadius.circular(AppTokens.radiusFull),
            ),
            child: Icon(icon, color: AppTheme.primary, size: 22),
          ),
          const SizedBox(width: AppTokens.spaceMedium),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: theme.textTheme.titleMedium),
                Text(
                  help,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: AppTheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppTokens.spaceSmall),
          Icon(
            selected
                ? Icons.check_circle_outline
                : Icons.radio_button_unchecked,
            color: selected ? AppTheme.primary : AppTheme.outlineVariant,
            size: 22,
          ),
        ],
      ),
    );
  }
}

String _roleLabel(AppLocalizations l10n, OnboardingRole role) => switch (role) {
  OnboardingRole.passenger => l10n.passenger,
  OnboardingRole.driver => l10n.driver,
  OnboardingRole.merchant => l10n.merchant,
};

String _roleHelp(AppLocalizations l10n, OnboardingRole role) => switch (role) {
  OnboardingRole.passenger => l10n.passengerActiveAfterRegistration,
  OnboardingRole.driver ||
  OnboardingRole.merchant => l10n.pendingAfterRegistration,
};

String _consentLabel(AppLocalizations l10n, String type) => switch (type) {
  'terms' => l10n.terms,
  'privacy' => l10n.privacyNotice,
  'adult_self_attestation' => l10n.confirmAdult,
  _ => l10n.terms,
};

String _safeError(AppLocalizations l10n, String? code) => switch (code) {
  'onboarding_unavailable' => l10n.unableToStartRegistration,
  'verification_failed' => l10n.incorrectVerificationCode,
  'verification_expired' => l10n.codeExpired,
  'verification_locked' => l10n.tooManyAttempts,
  'rate_limited' => l10n.tooManyAttempts,
  'consent_version_changed' => l10n.consentDocumentsChanged,
  'invalid_credentials' => l10n.invalidCredentials,
  'validation_error' => l10n.validationError,
  'network_unavailable' => l10n.networkUnavailable,
  'request_timeout' => l10n.requestTimedOut,
  'account_unavailable' => l10n.accountUnavailable,
  'verification_temporarily_unavailable' => l10n.requestFailed,
  'registration_grant_invalid' => l10n.requestFailed,
  'registration_conflict' => l10n.requestFailed,
  'documents_required' => l10n.documentsRequiredError,
  _ => l10n.requestFailed,
};

String _safeConsentText(String value) {
  // Consent releases are canonical plain text. Flutter's Text widget renders
  // the exact value without interpreting HTML, Markdown, JSON, or scripts.
  return value;
}
