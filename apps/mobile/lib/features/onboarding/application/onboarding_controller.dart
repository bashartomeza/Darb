import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_error.dart';
import '../../../core/i18n/domain_labels.dart';
import '../data/onboarding_repository.dart';
import '../data/onboarding_storage.dart';
import '../domain/onboarding_models.dart';

final onboardingControllerProvider =
    AsyncNotifierProvider<OnboardingController, OnboardingState>(
      OnboardingController.new,
    );

class OnboardingState {
  const OnboardingState({
    required this.stage,
    this.config,
    this.selectedRole,
    this.attemptId,
    this.maskedPhone,
    this.attemptExpiresAt,
    this.resendAvailableAt,
    this.documents = const [],
    this.requestId,
    this.errorCode,
    this.restored = false,
    this.ambiguousFailure = false,
    this.consentRevision = 0,
    this.applicationSubmitted = true,
    this.submitting = false,
    this.missingDocuments = const [],
  });

  const OnboardingState.checking()
    : this(stage: OnboardingStage.checkingAvailability);

  final OnboardingStage stage;
  final OnboardingConfig? config;
  final OnboardingRole? selectedRole;
  final String? attemptId;
  final String? maskedPhone;
  final DateTime? attemptExpiresAt;
  final DateTime? resendAvailableAt;
  final List<ConsentDocument> documents;
  final String? requestId;
  final String? errorCode;
  final bool restored;
  final bool ambiguousFailure;
  final int consentRevision;

  /// False while a pending applicant still has to upload documents and send the application.
  final bool applicationSubmitted;
  final bool submitting;
  final List<String> missingDocuments;

  bool get enabled => config?.enabled == true;
  bool get busy => switch (stage) {
    OnboardingStage.checkingAvailability ||
    OnboardingStage.starting ||
    OnboardingStage.resending ||
    OnboardingStage.verifyingOtp ||
    OnboardingStage.loadingConsents ||
    OnboardingStage.completingRegistration => true,
    OnboardingStage.pendingReview => submitting,
    _ => false,
  };

  OnboardingState copyWith({
    OnboardingStage? stage,
    OnboardingConfig? config,
    OnboardingRole? selectedRole,
    String? attemptId,
    String? maskedPhone,
    DateTime? attemptExpiresAt,
    DateTime? resendAvailableAt,
    List<ConsentDocument>? documents,
    String? requestId,
    String? errorCode,
    bool? restored,
    bool? ambiguousFailure,
    int? consentRevision,
    bool? applicationSubmitted,
    bool? submitting,
    List<String>? missingDocuments,
    bool clearError = false,
  }) {
    return OnboardingState(
      stage: stage ?? this.stage,
      config: config ?? this.config,
      selectedRole: selectedRole ?? this.selectedRole,
      attemptId: attemptId ?? this.attemptId,
      maskedPhone: maskedPhone ?? this.maskedPhone,
      attemptExpiresAt: attemptExpiresAt ?? this.attemptExpiresAt,
      resendAvailableAt: resendAvailableAt ?? this.resendAvailableAt,
      documents: documents ?? this.documents,
      requestId: requestId ?? this.requestId,
      errorCode: clearError ? null : errorCode ?? this.errorCode,
      restored: restored ?? this.restored,
      ambiguousFailure: ambiguousFailure ?? this.ambiguousFailure,
      consentRevision: consentRevision ?? this.consentRevision,
      applicationSubmitted: applicationSubmitted ?? this.applicationSubmitted,
      submitting: submitting ?? this.submitting,
      missingDocuments: missingDocuments ?? this.missingDocuments,
    );
  }
}

class OnboardingController extends AsyncNotifier<OnboardingState> {
  OnboardingRepository get _repository =>
      ref.read(onboardingRepositoryProvider);
  OnboardingStorage get _storage => ref.read(onboardingStorageProvider);

  OnboardingBundle? _bundle;

  /// The pending-review session token, for features that act on the same application.
  String? get pendingStatusToken => _bundle?.pendingStatusToken;
  final Map<String, _PendingMutation> _pendingMutations = {};
  int _generation = 0;
  bool _inFlight = false;

  @override
  Future<OnboardingState> build() async {
    final generation = ++_generation;
    ref.onDispose(() => _generation += 1);
    return _load(generation);
  }

  Future<void> refreshAvailability() async {
    final generation = ++_generation;
    state = const AsyncData(OnboardingState.checking());
    try {
      final loaded = await _load(generation);
      _ensureCurrent(generation);
      state = AsyncData(loaded);
    } on _StaleOnboardingOperation {
      // A newer workflow owns controller state.
    }
  }

  void chooseRole(OnboardingRole role) {
    final current = state.value;
    if (current == null ||
        current.stage != OnboardingStage.choosingRole ||
        !current.enabled ||
        current.busy ||
        current.config?.registrationRoles.contains(role) != true) {
      return;
    }
    state = AsyncData(
      current.copyWith(
        stage: OnboardingStage.enteringInvitation,
        selectedRole: role,
        clearError: true,
      ),
    );
  }

  void backToRoles() {
    final current = state.value;
    if (current == null ||
        current.stage != OnboardingStage.enteringInvitation ||
        current.attemptId != null ||
        current.busy) {
      return;
    }
    state = AsyncData(current.copyWith(stage: OnboardingStage.choosingRole));
  }

  Future<void> start({
    required String invitationCode,
    required String phone,
    String email = '',
    required String locale,
  }) async {
    final current = state.value;
    final role = current?.selectedRole;
    if (current == null ||
        current.stage != OnboardingStage.enteringInvitation ||
        role == null ||
        current.config?.registrationRoles.contains(role) != true ||
        _inFlight ||
        !current.enabled) {
      return;
    }
    // Without a code only the open driver / shop-owner signup can start.
    if (invitationCode.trim().isEmpty &&
        current.config?.openRegistrationRoles.contains(role) != true) {
      state = AsyncData(current.copyWith(errorCode: 'validation_error'));
      return;
    }
    // Open sign-up emails the code, so it needs a plausible address; invited applicants use the Admin's.
    if (invitationCode.trim().isEmpty &&
        !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email.trim())) {
      state = AsyncData(current.copyWith(errorCode: 'validation_error'));
      return;
    }
    final payload = <String, String>{
      'invitation': invitationCode.trim(),
      'phone': phone.trim(),
      'email': invitationCode.trim().isEmpty ? email.trim().toLowerCase() : '',
      'role': role.apiValue,
      'locale': locale,
    };
    final key = _keyFor('start', payload);
    final generation = _generation;
    await _guarded(
      operation: 'start',
      generation: generation,
      failureStage: OnboardingStage.enteringInvitation,
      action: () async {
        state = AsyncData(current.copyWith(stage: OnboardingStage.starting));
        final result = await _repository.start(
          invitationCode: invitationCode,
          role: role,
          phone: phone,
          email: email,
          locale: locale,
          idempotencyKey: key,
        );
        _ensureCurrent(generation);
        if (!{
              'otp_sent',
              'otp_dispatching',
              'verification_temporarily_unavailable',
            }.contains(result.status) ||
            !{'verify_otp', 'resend_otp'}.contains(result.nextAction)) {
          throw const ApiException(ApiErrorType.validation, 'invalid_response');
        }
        final bundle = OnboardingBundle(
          type: OnboardingBundleType.continuation,
          safeStage: OnboardingStage.otpSent,
          locale: locale,
          selectedRole: role,
          attemptId: result.attemptId,
          continuationToken: result.onboardingToken,
          continuationExpiresAt: result.onboardingTokenExpiresAt,
          maskedPhone: result.maskedPhone,
          resendAvailableAt: result.resendAvailableAt,
        );
        await _persistBeforePublish(bundle, generation);
        _completeMutation('start');
        state = AsyncData(
          current.copyWith(
            stage: OnboardingStage.otpSent,
            attemptId: result.attemptId,
            maskedPhone: result.maskedPhone,
            attemptExpiresAt: result.expiresAt,
            resendAvailableAt: result.resendAvailableAt,
            requestId: result.requestId,
            ambiguousFailure: false,
            clearError: true,
          ),
        );
      },
    );
  }

  Future<void> resend() async {
    final current = state.value;
    final bundle = _bundle;
    if (current == null ||
        current.stage != OnboardingStage.otpSent ||
        bundle?.attemptId == null ||
        _inFlight) {
      return;
    }
    final generation = _generation;
    final key = _keyFor('resend', {'attempt': bundle!.attemptId!});
    await _guarded(
      operation: 'resend',
      generation: generation,
      failureStage: OnboardingStage.otpSent,
      action: () async {
        final prepared = bundle.copyWith(idempotency: {'resend_key': key});
        await _persistBeforePublish(prepared, generation);
        state = AsyncData(current.copyWith(stage: OnboardingStage.resending));
        final resendAt = await _repository.resend(
          attemptId: prepared.attemptId!,
          continuationToken: prepared.continuationToken!,
          idempotencyKey: key,
        );
        _ensureCurrent(generation);
        final updated = prepared.copyWith(
          safeStage: OnboardingStage.otpSent,
          resendAvailableAt: resendAt,
          clearIdempotency: true,
        );
        await _persistBeforePublish(updated, generation);
        _completeMutation('resend');
        state = AsyncData(
          current.copyWith(
            stage: OnboardingStage.otpSent,
            resendAvailableAt: resendAt,
            ambiguousFailure: false,
            clearError: true,
          ),
        );
      },
    );
  }

  Future<void> verifyOtp(String otp) async {
    final current = state.value;
    final bundle = _bundle;
    final normalizedOtp = normalizeOtpDigits(otp);
    if (current == null ||
        bundle?.attemptId == null ||
        current.stage != OnboardingStage.otpSent ||
        normalizedOtp.length != (current.config?.otpDigits ?? 6) ||
        !RegExp(r'^\d{6}$').hasMatch(normalizedOtp) ||
        _inFlight) {
      return;
    }
    final generation = _generation;
    final key = _keyFor('verify', {
      'attempt': bundle!.attemptId!,
      'otp': normalizedOtp,
    });
    await _guarded(
      operation: 'verify',
      generation: generation,
      failureStage: OnboardingStage.otpSent,
      action: () async {
        state = AsyncData(
          current.copyWith(stage: OnboardingStage.verifyingOtp),
        );
        final result = await _repository.verify(
          attemptId: bundle.attemptId!,
          continuationToken: bundle.continuationToken!,
          otp: normalizedOtp,
          idempotencyKey: key,
        );
        _ensureCurrent(generation);
        if (result.nextAction != 'complete_registration') {
          throw const ApiException(ApiErrorType.validation, 'invalid_response');
        }
        final updated = bundle.copyWith(
          safeStage: OnboardingStage.phoneVerified,
          registrationGrant: result.registrationGrant,
          registrationGrantExpiresAt: result.registrationGrantExpiresAt,
          clearIdempotency: true,
        );
        await _persistBeforePublish(updated, generation);
        _completeMutation('verify');
        final documents = await _repository.consents(bundle.locale);
        _ensureCurrent(generation);
        final ready = updated.copyWith(
          safeStage: OnboardingStage.enteringAccountDetails,
        );
        await _persistBeforePublish(ready, generation);
        state = AsyncData(
          current.copyWith(
            stage: OnboardingStage.enteringAccountDetails,
            documents: documents,
            requestId: result.requestId,
            ambiguousFailure: false,
            clearError: true,
          ),
        );
      },
    );
  }

  Future<void> loadConsents() async {
    final current = state.value;
    final bundle = _bundle;
    if (current == null ||
        current.stage != OnboardingStage.enteringAccountDetails ||
        bundle == null ||
        bundle.registrationGrant == null ||
        _inFlight) {
      return;
    }
    final generation = _generation;
    await _guarded(
      generation: generation,
      failureStage: OnboardingStage.enteringAccountDetails,
      action: () async {
        state = AsyncData(
          current.copyWith(stage: OnboardingStage.loadingConsents),
        );
        final documents = await _repository.consents(bundle.locale);
        _ensureCurrent(generation);
        final updated = bundle.copyWith(
          safeStage: OnboardingStage.enteringAccountDetails,
        );
        await _persistBeforePublish(updated, generation);
        state = AsyncData(
          current.copyWith(
            stage: OnboardingStage.enteringAccountDetails,
            documents: documents,
            ambiguousFailure: false,
            clearError: true,
          ),
        );
      },
    );
  }

  Future<void> complete({
    required String displayName,
    required String password,
    required String confirmPassword,
    required bool acceptedTerms,
    required bool acceptedPrivacy,
    required bool adult,
  }) async {
    final current = state.value;
    final bundle = _bundle;
    if (current == null ||
        current.stage != OnboardingStage.enteringAccountDetails ||
        current.documents.length != requiredConsentTypes.length ||
        bundle?.attemptId == null ||
        _inFlight) {
      return;
    }
    if (password != confirmPassword ||
        !acceptedTerms ||
        !acceptedPrivacy ||
        !adult ||
        bundle!.registrationGrant == null) {
      state = AsyncData(current.copyWith(errorCode: 'validation_error'));
      return;
    }
    final config = current.config;
    final normalizedName = displayName.trim().replaceAll(RegExp(r'\s+'), ' ');
    final passwordCharacters = password.runes.length;
    if (config == null ||
        normalizedName.runes.length < 2 ||
        normalizedName.runes.length > 80 ||
        RegExp(r'[\x00-\x1f\x7f<>]').hasMatch(normalizedName) ||
        passwordCharacters < config.minimumPasswordCharacters ||
        passwordCharacters > config.maximumPasswordCharacters ||
        utf8.encode(password).length > config.maximumPasswordUtf8Bytes ||
        password.trim().isEmpty) {
      state = AsyncData(current.copyWith(errorCode: 'validation_error'));
      return;
    }
    final payload = <String, String>{
      'attempt': bundle.attemptId!,
      'display': normalizedName,
      'password': password,
      'confirm_password': confirmPassword,
      'locale': bundle.locale,
      'terms': acceptedTerms.toString(),
      'privacy': acceptedPrivacy.toString(),
      'adult': adult.toString(),
      'consents': current.documents
          .map(
            (document) =>
                '${document.id}:${document.type}:${document.contentHash}',
          )
          .join('|'),
    };
    final key = _keyFor('complete', payload);
    final generation = _generation;
    await _guarded(
      operation: 'complete',
      generation: generation,
      failureStage: OnboardingStage.enteringAccountDetails,
      action: () async {
        state = AsyncData(
          current.copyWith(stage: OnboardingStage.completingRegistration),
        );
        final result = await _repository.complete(
          attemptId: bundle.attemptId!,
          continuationToken: bundle.continuationToken!,
          registrationGrant: bundle.registrationGrant!,
          displayName: normalizedName,
          password: password,
          locale: bundle.locale,
          consents: current.documents,
          idempotencyKey: key,
        );
        _ensureCurrent(generation);
        if (result.role != bundle.selectedRole) {
          throw const ApiException(ApiErrorType.validation, 'invalid_response');
        }
        if (result.role == OnboardingRole.passenger &&
            result.accountStatus == 'active' &&
            result.pendingStatusToken == null &&
            result.nextAction == 'login') {
          _completeMutation('complete');
          await clear();
          state = AsyncData(
            current.copyWith(
              stage: OnboardingStage.passengerCreated,
              requestId: result.requestId,
              ambiguousFailure: false,
              clearError: true,
            ),
          );
          return;
        }
        if ((result.role == OnboardingRole.driver ||
                result.role == OnboardingRole.merchant) &&
            result.accountStatus == 'pending' &&
            result.pendingStatusToken != null &&
            result.pendingStatusExpiresAt != null &&
            (result.nextAction == 'await_approval' ||
                result.nextAction == 'upload_documents')) {
          final pending = OnboardingBundle(
            type: OnboardingBundleType.pendingStatus,
            safeStage: OnboardingStage.pendingReview,
            locale: bundle.locale,
            selectedRole: result.role,
            pendingStatusToken: result.pendingStatusToken,
            pendingStatusExpiresAt: result.pendingStatusExpiresAt,
          );
          await _persistBeforePublish(pending, generation);
          _completeMutation('complete');
          state = AsyncData(
            current.copyWith(
              stage: OnboardingStage.pendingReview,
              selectedRole: result.role,
              requestId: result.requestId,
              applicationSubmitted: result.nextAction == 'await_approval',
              ambiguousFailure: false,
              clearError: true,
            ),
          );
          return;
        }
        throw const ApiException(ApiErrorType.validation, 'invalid_response');
      },
    );
  }

  /// Sends the application for admin review once the documents are uploaded.
  /// The server enforces the same rule and answers `documents_required`.
  Future<void> submitApplication() async {
    final current = state.value;
    final token = _bundle?.pendingStatusToken;
    if (current == null ||
        current.stage != OnboardingStage.pendingReview ||
        current.applicationSubmitted ||
        token == null ||
        _inFlight) {
      return;
    }
    final generation = _generation;
    await _guarded(
      generation: generation,
      failureStage: OnboardingStage.pendingReview,
      action: () async {
        state = AsyncData(current.copyWith(clearError: true, submitting: true));
        await _repository.submitApplication(token);
        _ensureCurrent(generation);
        state = AsyncData(
          current.copyWith(
            applicationSubmitted: true,
            missingDocuments: const [],
            submitting: false,
            ambiguousFailure: false,
            clearError: true,
          ),
        );
      },
    );
  }

  Future<void> checkPendingStatus() async {
    final current = state.value;
    final bundle = _bundle;
    final token = bundle?.pendingStatusToken;
    if (current == null ||
        current.stage != OnboardingStage.pendingReview ||
        token == null ||
        _inFlight) {
      return;
    }
    final generation = _generation;
    await _guarded(
      generation: generation,
      failureStage: OnboardingStage.pendingReview,
      action: () async {
        final result = await _repository.status(token);
        _ensureCurrent(generation);
        if (result.role != null && result.role != bundle!.selectedRole) {
          throw const ApiException(ApiErrorType.validation, 'invalid_response');
        }
        if (result.status == 'approved_sign_in') {
          await clear();
          state = AsyncData(
            current.copyWith(
              stage: OnboardingStage.approvedSignIn,
              requestId: result.requestId,
              ambiguousFailure: false,
            ),
          );
        } else if (_isPendingResult(result)) {
          state = AsyncData(
            current.copyWith(
              stage: OnboardingStage.pendingReview,
              selectedRole: result.role ?? bundle!.selectedRole,
              requestId: result.requestId,
              applicationSubmitted: result.status == 'pending_review',
              missingDocuments: result.missingDocuments,
              ambiguousFailure: false,
            ),
          );
        } else {
          await clear();
          state = AsyncData(
            current.copyWith(stage: OnboardingStage.unavailable),
          );
        }
      },
    );
  }

  Future<void> recoverPending({
    required String phone,
    required String password,
    required String locale,
  }) async {
    final current = state.value ?? const OnboardingState.checking();
    if (_inFlight || !current.enabled) return;
    final generation = _generation;
    await _guarded(
      generation: generation,
      failureStage: OnboardingStage.choosingRole,
      action: () async {
        final freshConfig = await _repository.config();
        _ensureCurrent(generation);
        if (!freshConfig.enabled) {
          throw const ApiException(
            ApiErrorType.forbidden,
            'onboarding_unavailable',
          );
        }
        state = AsyncData(current.copyWith(stage: OnboardingStage.starting));
        final result = await _repository.recoverPendingStatus(
          phone: phone,
          password: password,
        );
        _ensureCurrent(generation);
        if (result.pendingStatusToken == null ||
            result.pendingStatusExpiresAt == null ||
            !_isPendingResult(result) ||
            (result.role != OnboardingRole.driver &&
                result.role != OnboardingRole.merchant)) {
          throw const ApiException(ApiErrorType.validation, 'invalid_response');
        }
        final pending = OnboardingBundle(
          type: OnboardingBundleType.pendingStatus,
          safeStage: OnboardingStage.pendingReview,
          locale: locale,
          selectedRole: result.role,
          pendingStatusToken: result.pendingStatusToken,
          pendingStatusExpiresAt: result.pendingStatusExpiresAt,
        );
        await _persistBeforePublish(pending, generation);
        state = AsyncData(
          current.copyWith(
            stage: OnboardingStage.pendingReview,
            selectedRole: result.role,
            requestId: result.requestId,
            applicationSubmitted: result.status == 'pending_review',
            missingDocuments: result.missingDocuments,
            ambiguousFailure: false,
            clearError: true,
          ),
        );
      },
    );
  }

  Future<void> clear() async {
    _generation += 1;
    _bundle = null;
    _pendingMutations.clear();
    await _storage.clear();
  }

  Future<OnboardingState> _load(int generation) async {
    final restored = await _storage.readBundle();
    _ensureCurrent(generation);
    _bundle = restored;

    late final OnboardingConfig config;
    try {
      config = await _repository.config();
      _ensureCurrent(generation);
    } on ApiException catch (error) {
      if (restored != null) {
        return _stateFromBundle(_disabledConfig, restored).copyWith(
          stage: OnboardingStage.retryableFailure,
          errorCode: error.message,
          ambiguousFailure: _isAmbiguous(error),
        );
      }
      return const OnboardingState(
        stage: OnboardingStage.unavailable,
        config: _disabledConfig,
      );
    }

    if (!config.enabled) {
      await _storage.clear();
      _ensureCurrent(generation);
      _bundle = null;
      _pendingMutations.clear();
      return OnboardingState(
        stage: OnboardingStage.unavailable,
        config: config,
      );
    }
    if (restored == null) {
      return OnboardingState(
        stage: OnboardingStage.choosingRole,
        config: config,
      );
    }

    try {
      final token = restored.type == OnboardingBundleType.pendingStatus
          ? restored.pendingStatusToken!
          : restored.continuationToken!;
      final server = await _repository.status(token);
      _ensureCurrent(generation);
      if (server.role != null && server.role != restored.selectedRole) {
        throw const ApiException(ApiErrorType.validation, 'invalid_response');
      }
      if (restored.type == OnboardingBundleType.pendingStatus) {
        if (_isPendingResult(server)) {
          return _stateFromBundle(config, restored).copyWith(
            applicationSubmitted: server.status == 'pending_review',
            missingDocuments: server.missingDocuments,
          );
        }
        if (server.status == 'approved_sign_in' &&
            server.nextAction == 'login') {
          await _storage.clear();
          _ensureCurrent(generation);
          _bundle = null;
          return OnboardingState(
            stage: OnboardingStage.approvedSignIn,
            config: config,
            selectedRole: restored.selectedRole,
            requestId: server.requestId,
            restored: true,
          );
        }
        throw const ApiException(ApiErrorType.forbidden, 'account_unavailable');
      }

      if (server.status == 'in_progress' && server.nextAction == 'verify_otp') {
        final otpBundle = restored.copyWith(
          safeStage: OnboardingStage.otpSent,
          clearGrant: true,
        );
        await _persistBeforePublish(otpBundle, generation);
        return _stateFromBundle(config, otpBundle);
      }
      if (server.status == 'phone_verified' &&
          server.nextAction == 'complete_registration' &&
          restored.registrationGrant != null) {
        final verified = restored.copyWith(
          safeStage: OnboardingStage.enteringAccountDetails,
        );
        await _persistBeforePublish(verified, generation);
        return _stateFromBundle(config, verified);
      }
      throw const ApiException(ApiErrorType.validation, 'invalid_response');
    } on ApiException catch (error) {
      if (_isAmbiguous(error)) {
        return _stateFromBundle(config, restored).copyWith(
          stage: OnboardingStage.retryableFailure,
          errorCode: error.message,
          ambiguousFailure: true,
        );
      }
      await _storage.clear();
      _ensureCurrent(generation);
      _bundle = null;
      return OnboardingState(
        stage: OnboardingStage.terminalFailure,
        config: config,
        errorCode: error.message,
      );
    }
  }

  OnboardingState _stateFromBundle(
    OnboardingConfig config,
    OnboardingBundle bundle,
  ) {
    if (bundle.type == OnboardingBundleType.pendingStatus) {
      return OnboardingState(
        stage: OnboardingStage.pendingReview,
        config: config,
        selectedRole: bundle.selectedRole,
        restored: true,
      );
    }
    return OnboardingState(
      stage: bundle.registrationGrant == null
          ? OnboardingStage.otpSent
          : OnboardingStage.enteringAccountDetails,
      config: config,
      selectedRole: bundle.selectedRole,
      attemptId: bundle.attemptId,
      maskedPhone: bundle.maskedPhone,
      attemptExpiresAt: bundle.continuationExpiresAt,
      resendAvailableAt: bundle.resendAvailableAt,
      restored: true,
    );
  }

  Future<void> _persistBeforePublish(
    OnboardingBundle bundle,
    int generation,
  ) async {
    _ensureCurrent(generation);
    await _storage.saveBundle(bundle);
    if (generation != _generation) {
      await _storage.clear();
      throw const _StaleOnboardingOperation();
    }
    _bundle = bundle;
  }

  String _keyFor(String operation, Map<String, String> payload) {
    if (operation == 'resend') {
      final persisted = _bundle?.idempotency?['resend_key'];
      if (persisted != null) return persisted;
    }
    final existing = _pendingMutations[operation];
    if (existing != null && existing.matches(payload)) return existing.key;
    final created = _PendingMutation(payload, newIdempotencyKey());
    _pendingMutations[operation] = created;
    return created.key;
  }

  void _completeMutation(String operation) {
    _pendingMutations.remove(operation);
  }

  Future<void> _discardKnownMutation(String? operation, int generation) async {
    if (operation == null) return;
    _pendingMutations.remove(operation);
    if (operation == 'resend' && _bundle?.idempotency != null) {
      final updated = _bundle!.copyWith(clearIdempotency: true);
      await _persistBeforePublish(updated, generation);
    }
  }

  Future<void> _guarded({
    required int generation,
    required OnboardingStage failureStage,
    required Future<void> Function() action,
    String? operation,
  }) async {
    if (_inFlight) return;
    _inFlight = true;
    try {
      await action();
    } on _StaleOnboardingOperation {
      // A clear, restart, or newer workflow owns state and storage now.
    } on ApiException catch (error) {
      if (generation != _generation) return;
      final ambiguous = _isAmbiguous(error);
      if (_bundle?.type == OnboardingBundleType.pendingStatus &&
          (error.type == ApiErrorType.unauthorized ||
              error.type == ApiErrorType.forbidden)) {
        await _storage.clear();
        _ensureCurrent(generation);
        _bundle = null;
      }
      if (!ambiguous) await _discardKnownMutation(operation, generation);
      if (operation == 'complete' &&
          error.message == 'consent_version_changed') {
        final bundle = _bundle;
        final current = state.value;
        if (bundle != null && current != null) {
          try {
            final documents = await _repository.consents(bundle.locale);
            _ensureCurrent(generation);
            state = AsyncData(
              current.copyWith(
                stage: OnboardingStage.enteringAccountDetails,
                documents: documents,
                errorCode: error.message,
                ambiguousFailure: false,
                consentRevision: current.consentRevision + 1,
              ),
            );
            return;
          } on ApiException {
            // Fall through to the controlled retry state below.
          }
        }
      }
      final current = state.value;
      if (current != null && generation == _generation) {
        state = AsyncData(
          current.copyWith(
            stage: _terminalCodes.contains(error.message)
                ? OnboardingStage.terminalFailure
                : failureStage,
            errorCode: error.message,
            ambiguousFailure: ambiguous,
            submitting: false,
          ),
        );
      }
    } catch (_) {
      if (generation == _generation) {
        final current = state.value;
        if (current != null) {
          state = AsyncData(
            current.copyWith(
              stage: failureStage,
              errorCode: 'secure_storage_unavailable',
              submitting: false,
              ambiguousFailure: true,
            ),
          );
        }
      }
    } finally {
      _inFlight = false;
    }
  }

  void _ensureCurrent(int generation) {
    if (generation != _generation) throw const _StaleOnboardingOperation();
  }
}

String normalizeOtpDigits(String value) {
  const arabicZero = 0x0660;
  const easternZero = 0x06F0;
  final buffer = StringBuffer();
  for (final rune in value.runes) {
    if (rune >= 0x30 && rune <= 0x39) {
      buffer.writeCharCode(rune);
    } else if (rune >= arabicZero && rune <= arabicZero + 9) {
      buffer.writeCharCode(0x30 + rune - arabicZero);
    } else if (rune >= easternZero && rune <= easternZero + 9) {
      buffer.writeCharCode(0x30 + rune - easternZero);
    }
  }
  return buffer.toString();
}

String localeCodeFromObject(Object? locale) {
  final value = locale?.toString();
  if (value == 'en') return 'en';
  return DomainLabels.defaultLocale.languageCode;
}

class _PendingMutation {
  _PendingMutation(Map<String, String> payload, this.key)
    : _payload = Map.unmodifiable(payload);

  final Map<String, String> _payload;
  final String key;

  bool matches(Map<String, String> candidate) {
    if (_payload.length != candidate.length) return false;
    return _payload.entries.every(
      (entry) => candidate[entry.key] == entry.value,
    );
  }
}

class _StaleOnboardingOperation implements Exception {
  const _StaleOnboardingOperation();
}

/// A pending application is either under review or still waiting for documents.
bool _isPendingResult(PendingStatusResult result) =>
    (result.status == 'pending_review' &&
        result.nextAction == 'await_approval') ||
    (result.status == 'documents_required' &&
        result.nextAction == 'upload_documents');

bool _isAmbiguous(ApiException error) =>
    error.type == ApiErrorType.network ||
    error.type == ApiErrorType.timeout ||
    error.type == ApiErrorType.server;

const _disabledConfig = OnboardingConfig(
  enabled: false,
  registrationRoles: [],
  supportedLocales: [],
  minimumPasswordCharacters: 15,
  maximumPasswordCharacters: 64,
  maximumPasswordUtf8Bytes: 72,
  otpDigits: 6,
  resendCooldownSeconds: 60,
);

const _terminalCodes = {
  'verification_expired',
  'verification_locked',
  'registration_grant_invalid',
  'account_unavailable',
};
