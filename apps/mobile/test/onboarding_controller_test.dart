import 'dart:async';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/onboarding/application/onboarding_controller.dart';
import 'package:masari_mobile/features/onboarding/data/onboarding_repository.dart';
import 'package:masari_mobile/features/onboarding/data/onboarding_storage.dart';
import 'package:masari_mobile/features/onboarding/domain/onboarding_models.dart';

void main() {
  test('Arabic and Persian OTP digits normalize to ASCII', () {
    expect(normalizeOtpDigits('١٢٣٤٥٦'), '123456');
    expect(normalizeOtpDigits('۱۲۳۴۵۶'), '123456');
    expect(normalizeOtpDigits('1 2-٣٤x۵۶'), '123456');
  });

  test('idempotency keys are random-looking and operation scoped', () {
    final first = newIdempotencyKey();
    final second = newIdempotencyKey();

    expect(first, isNot(second));
    expect(first.length, 32);
    expect(RegExp(r'^[A-Za-z0-9._:-]+$').hasMatch(first), isTrue);
  });

  test('late start response cannot restore a cleared workflow', () async {
    final repository = _FakeOnboardingRepository();
    final storage = _MemoryOnboardingStorage();
    final container = _container(repository, storage);
    addTearDown(container.dispose);
    await container.read(onboardingControllerProvider.future);
    final controller = container.read(onboardingControllerProvider.notifier);
    controller.chooseRole(OnboardingRole.passenger);

    final pending = controller.start(
      invitationCode: 'A' * 20,
      phone: '0590000001',
      locale: 'ar',
    );
    await repository.startEntered.future;
    await controller.clear();
    repository.startResult.complete(_startResult());
    await pending;

    expect(storage.bundle, isNull);
    expect(
      container.read(onboardingControllerProvider).value?.stage,
      isNot(OnboardingStage.otpSent),
    );
  });

  test('ambiguous start reuses key and edited payload rotates it', () async {
    final repository = _FakeOnboardingRepository()
      ..immediateStart = true
      ..startErrors.add(
        const ApiException(ApiErrorType.timeout, 'request_timeout'),
      )
      ..startErrors.add(
        const ApiException(ApiErrorType.timeout, 'request_timeout'),
      );
    final storage = _MemoryOnboardingStorage();
    final container = _container(repository, storage);
    addTearDown(container.dispose);
    await container.read(onboardingControllerProvider.future);
    final controller = container.read(onboardingControllerProvider.notifier);
    controller.chooseRole(OnboardingRole.passenger);

    await controller.start(
      invitationCode: 'A' * 20,
      phone: '0590000001',
      locale: 'ar',
    );
    await controller.start(
      invitationCode: 'A' * 20,
      phone: '0590000001',
      locale: 'ar',
    );
    await controller.start(
      invitationCode: 'A' * 20,
      phone: '0590000002',
      locale: 'ar',
    );

    expect(repository.startKeys[0], repository.startKeys[1]);
    expect(repository.startKeys[2], isNot(repository.startKeys[1]));
  });

  test('secure storage failure never publishes OTP success', () async {
    final repository = _FakeOnboardingRepository()..immediateStart = true;
    final storage = _MemoryOnboardingStorage()..failWrites = true;
    final container = _container(repository, storage);
    addTearDown(container.dispose);
    await container.read(onboardingControllerProvider.future);
    final controller = container.read(onboardingControllerProvider.notifier);
    controller.chooseRole(OnboardingRole.passenger);

    await controller.start(
      invitationCode: 'A' * 20,
      phone: '0590000001',
      locale: 'ar',
    );

    final state = container.read(onboardingControllerProvider).value!;
    expect(state.stage, OnboardingStage.enteringInvitation);
    expect(state.busy, isFalse);
    expect(state.errorCode, 'secure_storage_unavailable');
    expect(storage.bundle, isNull);
  });

  test(
    'completion retry reuses exact key and edited password rotates it',
    () async {
      final repository = _FakeOnboardingRepository()
        ..consentSets.add(_consents('v1'))
        ..completeErrors.add(
          const ApiException(ApiErrorType.timeout, 'request_timeout'),
        )
        ..completeErrors.add(
          const ApiException(ApiErrorType.timeout, 'request_timeout'),
        )
        ..completeErrors.add(
          const ApiException(ApiErrorType.timeout, 'request_timeout'),
        );
      final storage = _MemoryOnboardingStorage()..bundle = _verifiedBundle();
      final container = _container(repository, storage);
      addTearDown(container.dispose);
      await container.read(onboardingControllerProvider.future);
      final controller = container.read(onboardingControllerProvider.notifier);
      await controller.loadConsents();

      await controller.complete(
        displayName: 'Secure User',
        password: 'first secure password',
        confirmPassword: 'first secure password',
        acceptedTerms: true,
        acceptedPrivacy: true,
        adult: true,
      );
      await controller.complete(
        displayName: 'Secure User',
        password: 'first secure password',
        confirmPassword: 'first secure password',
        acceptedTerms: true,
        acceptedPrivacy: true,
        adult: true,
      );
      await controller.complete(
        displayName: 'Secure User',
        password: 'second secure password',
        confirmPassword: 'second secure password',
        acceptedTerms: true,
        acceptedPrivacy: true,
        adult: true,
      );

      expect(repository.completeKeys[0], repository.completeKeys[1]);
      expect(repository.completeKeys[2], isNot(repository.completeKeys[1]));
    },
  );

  test('verify retry reuses exact key and edited OTP rotates it', () async {
    final repository = _FakeOnboardingRepository()
      ..verifyErrors.add(
        const ApiException(ApiErrorType.timeout, 'request_timeout'),
      )
      ..verifyErrors.add(
        const ApiException(ApiErrorType.timeout, 'request_timeout'),
      )
      ..verifyErrors.add(
        const ApiException(ApiErrorType.timeout, 'request_timeout'),
      );
    final storage = _MemoryOnboardingStorage()..bundle = _otpBundle();
    final container = _container(repository, storage);
    addTearDown(container.dispose);
    await container.read(onboardingControllerProvider.future);
    final controller = container.read(onboardingControllerProvider.notifier);

    await controller.verifyOtp('123456');
    await controller.verifyOtp('123456');
    await controller.verifyOtp('654321');

    expect(repository.verifyKeys[0], repository.verifyKeys[1]);
    expect(repository.verifyKeys[2], isNot(repository.verifyKeys[1]));
  });

  test(
    'consent version conflict reloads documents and fences acceptance',
    () async {
      final repository = _FakeOnboardingRepository()
        ..consentSets.add(_consents('v1'))
        ..consentSets.add(_consents('v2'))
        ..completeErrors.add(
          const ApiException(ApiErrorType.unknown, 'consent_version_changed'),
        );
      final storage = _MemoryOnboardingStorage()..bundle = _verifiedBundle();
      final container = _container(repository, storage);
      addTearDown(container.dispose);
      await container.read(onboardingControllerProvider.future);
      final controller = container.read(onboardingControllerProvider.notifier);
      await controller.loadConsents();

      await controller.complete(
        displayName: 'Secure User',
        password: 'first secure password',
        confirmPassword: 'first secure password',
        acceptedTerms: true,
        acceptedPrivacy: true,
        adult: true,
      );

      final state = container.read(onboardingControllerProvider).value!;
      expect(state.stage, OnboardingStage.enteringAccountDetails);
      expect(state.documents.map((document) => document.version).toSet(), {
        'v2',
      });
      expect(state.consentRevision, 1);
      expect(state.errorCode, 'consent_version_changed');
    },
  );

  test('passenger completion uses the account-created result state', () async {
    final repository = _FakeOnboardingRepository()
      ..consentSets.add(_consents('v1'));
    final storage = _MemoryOnboardingStorage()..bundle = _verifiedBundle();
    final container = _container(repository, storage);
    addTearDown(container.dispose);
    await container.read(onboardingControllerProvider.future);
    final controller = container.read(onboardingControllerProvider.notifier);
    await controller.loadConsents();

    await controller.complete(
      displayName: 'Secure User',
      password: 'first secure password',
      confirmPassword: 'first secure password',
      acceptedTerms: true,
      acceptedPrivacy: true,
      adult: true,
    );

    expect(
      container.read(onboardingControllerProvider).value?.stage,
      OnboardingStage.passengerCreated,
    );
    expect(storage.bundle, isNull);
  });

  test('approved pending account uses the approved-sign-in state', () async {
    final repository = _FakeOnboardingRepository()
      ..statusResult = const PendingStatusResult(
        role: OnboardingRole.driver,
        status: 'approved_sign_in',
        nextAction: 'login',
      );
    final storage = _MemoryOnboardingStorage()
      ..bundle = OnboardingBundle(
        type: OnboardingBundleType.pendingStatus,
        safeStage: OnboardingStage.pendingReview,
        locale: 'ar',
        selectedRole: OnboardingRole.driver,
        pendingStatusToken: 'pending-token',
        pendingStatusExpiresAt: DateTime.now().toUtc().add(
          const Duration(hours: 1),
        ),
      );
    final container = _container(repository, storage);
    addTearDown(container.dispose);
    await container.read(onboardingControllerProvider.future);

    await container
        .read(onboardingControllerProvider.notifier)
        .checkPendingStatus();

    expect(
      container.read(onboardingControllerProvider).value?.stage,
      OnboardingStage.approvedSignIn,
    );
    expect(storage.bundle, isNull);
  });
}

ProviderContainer _container(
  _FakeOnboardingRepository repository,
  _MemoryOnboardingStorage storage,
) => ProviderContainer(
  overrides: [
    onboardingRepositoryProvider.overrideWithValue(repository),
    onboardingStorageProvider.overrideWithValue(storage),
  ],
);

StartAttemptResult _startResult() => StartAttemptResult(
  attemptId: 'attempt_1',
  status: 'otp_sent',
  maskedPhone: '+970*****01',
  expiresAt: DateTime.now().toUtc().add(const Duration(hours: 1)),
  resendAvailableAt: DateTime.now().toUtc().add(const Duration(minutes: 1)),
  onboardingToken: 'continuation-token',
  onboardingTokenExpiresAt: DateTime.now().toUtc().add(
    const Duration(hours: 1),
  ),
  nextAction: 'verify_otp',
);

OnboardingBundle _verifiedBundle() => OnboardingBundle(
  type: OnboardingBundleType.continuation,
  safeStage: OnboardingStage.enteringAccountDetails,
  locale: 'ar',
  selectedRole: OnboardingRole.passenger,
  attemptId: 'attempt_1',
  continuationToken: 'continuation-token',
  continuationExpiresAt: DateTime.now().toUtc().add(const Duration(hours: 1)),
  registrationGrant: 'registration-grant',
  registrationGrantExpiresAt: DateTime.now().toUtc().add(
    const Duration(minutes: 15),
  ),
);

OnboardingBundle _otpBundle() => OnboardingBundle(
  type: OnboardingBundleType.continuation,
  safeStage: OnboardingStage.otpSent,
  locale: 'ar',
  selectedRole: OnboardingRole.passenger,
  attemptId: 'attempt_1',
  continuationToken: 'continuation-token',
  continuationExpiresAt: DateTime.now().toUtc().add(const Duration(hours: 1)),
  maskedPhone: '+970*****01',
);

List<ConsentDocument> _consents(String version) => requiredConsentTypes
    .map(
      (type) => ConsentDocument(
        id: '${type}_$version',
        type: type,
        version: version,
        locale: 'ar',
        content: '$type content',
        contentHash: 'a' * 64,
        effectiveAt: DateTime.utc(2026, 7, 20),
      ),
    )
    .toList(growable: false);

class _FakeOnboardingRepository extends OnboardingRepository {
  _FakeOnboardingRepository()
    : super(
        baseUrl: 'http://api.test',
        client: MockClient((_) async => http.Response('{}', 200)),
      );

  final startEntered = Completer<void>();
  final startResult = Completer<StartAttemptResult>();
  final List<ApiException> startErrors = [];
  final List<String> startKeys = [];
  final List<ApiException> completeErrors = [];
  final List<String> completeKeys = [];
  final List<ApiException> verifyErrors = [];
  final List<String> verifyKeys = [];
  final List<List<ConsentDocument>> consentSets = [];
  PendingStatusResult? statusResult;
  bool immediateStart = false;

  @override
  Future<OnboardingConfig> config() async => const OnboardingConfig(
    enabled: true,
    registrationRoles: OnboardingRole.values,
    supportedLocales: ['ar', 'en'],
    minimumPasswordCharacters: 15,
    maximumPasswordCharacters: 64,
    maximumPasswordUtf8Bytes: 72,
    otpDigits: 6,
    resendCooldownSeconds: 60,
  );

  @override
  Future<StartAttemptResult> start({
    required String invitationCode,
    required OnboardingRole role,
    required String phone,
    String email = '',
    required String locale,
    required String idempotencyKey,
  }) async {
    startKeys.add(idempotencyKey);
    if (startErrors.isNotEmpty) throw startErrors.removeAt(0);
    if (immediateStart) return _startResult();
    if (!startEntered.isCompleted) startEntered.complete();
    return startResult.future;
  }

  @override
  Future<PendingStatusResult> status(String onboardingToken) async =>
      statusResult ??
      PendingStatusResult(
        role: OnboardingRole.passenger,
        status: bundleStatus,
        nextAction: bundleStatus == 'phone_verified'
            ? 'complete_registration'
            : 'verify_otp',
      );

  String get bundleStatus =>
      verifyErrors.isNotEmpty ? 'in_progress' : 'phone_verified';

  @override
  Future<VerifyOtpResult> verify({
    required String attemptId,
    required String continuationToken,
    required String otp,
    required String idempotencyKey,
  }) async {
    verifyKeys.add(idempotencyKey);
    if (verifyErrors.isNotEmpty) throw verifyErrors.removeAt(0);
    return VerifyOtpResult(
      registrationGrant: 'registration-grant',
      registrationGrantExpiresAt: DateTime.now().toUtc().add(
        const Duration(minutes: 15),
      ),
      nextAction: 'complete_registration',
    );
  }

  @override
  Future<List<ConsentDocument>> consents(String locale) async {
    if (consentSets.isEmpty) throw StateError('Missing consent fixture');
    return consentSets.removeAt(0);
  }

  @override
  Future<CompleteRegistrationResult> complete({
    required String attemptId,
    required String continuationToken,
    required String registrationGrant,
    required String displayName,
    required String password,
    required String locale,
    required List<ConsentDocument> consents,
    required String idempotencyKey,
  }) async {
    completeKeys.add(idempotencyKey);
    if (completeErrors.isNotEmpty) throw completeErrors.removeAt(0);
    return const CompleteRegistrationResult(
      role: OnboardingRole.passenger,
      accountStatus: 'active',
      nextAction: 'login',
    );
  }
}

class _MemoryOnboardingStorage extends OnboardingStorage {
  _MemoryOnboardingStorage() : super(const FlutterSecureStorage());

  OnboardingBundle? bundle;
  bool failWrites = false;

  @override
  Future<OnboardingBundle?> readBundle() async => bundle;

  @override
  Future<void> saveBundle(OnboardingBundle value) async {
    if (failWrites) throw StateError('secure storage unavailable');
    bundle = value;
  }

  @override
  Future<void> clear() async => bundle = null;
}
