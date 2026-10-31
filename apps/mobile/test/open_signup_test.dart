import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/onboarding/application/onboarding_controller.dart';
import 'package:masari_mobile/features/onboarding/data/onboarding_repository.dart';
import 'package:masari_mobile/features/onboarding/data/onboarding_storage.dart';
import 'package:masari_mobile/features/onboarding/domain/onboarding_models.dart';

const _policy =
    '"phone_policy":{"canonical_format":"E.164","international_prefix_required_without_region":true,"local_numbers_require_region":true},"supported_locales":["ar","en"],"password_policy":{"minimum_characters":15,"maximum_characters":64,"maximum_utf8_bytes":72},"otp_digits":6,"resend_cooldown_seconds":60';

void main() {
  group('open signup config', () {
    test('open roles are parsed and limited to driver and shop owner', () {
      final config = OnboardingConfig.fromJson(
        jsonDecode(
              '{"enabled":true,"registration_roles":["passenger","driver","merchant"],"open_registration_roles":["driver","merchant","passenger","admin"],$_policy}',
            )
            as Map<String, dynamic>,
      );

      expect(config.openRegistrationRoles, [
        OnboardingRole.driver,
        OnboardingRole.merchant,
      ]);
    });

    test('older servers without the field keep invitation-only signup', () {
      final config = OnboardingConfig.fromJson(
        jsonDecode(
              '{"enabled":true,"registration_roles":["passenger","driver","merchant"],$_policy}',
            )
            as Map<String, dynamic>,
      );

      expect(config.openRegistrationRoles, isEmpty);
    });
  });

  group('repository', () {
    test('start omits the invitation code for open signup', () async {
      final repository = _repository((request) async {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body.containsKey('invitation_code'), isFalse);
        expect(body['role'], 'driver');
        expect(body['email'], 'driver@example.com');
        return http.Response(_startBody, 201);
      });

      await repository.start(
        invitationCode: '  ',
        role: OnboardingRole.driver,
        phone: '+970590000001',
        email: 'driver@example.com',
        locale: 'ar',
        idempotencyKey: 'idem-open-start',
      );
    });

    test('submitApplication posts with the pending-status token', () async {
      final repository = _repository((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/api/v1/onboarding/application/submit');
        expect(
          request.headers[HttpHeaders.authorizationHeader],
          'Onboarding pending-token',
        );
        return http.Response(
          '{"onboarding_status":"pending_review","next_action":"await_approval"}',
          200,
        );
      });

      await repository.submitApplication('pending-token');
    });

    test('submitApplication surfaces the server refusal', () async {
      final repository = _repository(
        (_) async => http.Response(
          '{"error":"documents_required","missing_documents":["national_id"]}',
          409,
        ),
      );

      await expectLater(
        repository.submitApplication('pending-token'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.message, 'message', 'documents_required')
              .having((e) => e.statusCode, 'statusCode', 409),
        ),
      );
    });

    test('status parses the documents-required state', () async {
      final repository = _repository(
        (_) async => http.Response(
          '{"role":"driver","onboarding_status":"documents_required","next_action":"upload_documents","missing_documents":["national_id"]}',
          200,
        ),
      );

      final result = await repository.status('pending-token');

      expect(result.status, 'documents_required');
      expect(result.missingDocuments, ['national_id']);
    });
  });

  group('controller', () {
    test('open driver can start without an invitation code', () async {
      final fake = _FakeRepository(openRoles: [OnboardingRole.driver]);
      final container = _container(fake, _MemoryStorage());
      addTearDown(container.dispose);
      await container.read(onboardingControllerProvider.future);
      final controller = container.read(onboardingControllerProvider.notifier)
        ..chooseRole(OnboardingRole.driver);

      await controller.start(
        invitationCode: '',
        phone: '+970590000001',
        email: 'driver@example.com',
        locale: 'ar',
      );

      expect(fake.startCodes, ['']);
      expect(
        container.read(onboardingControllerProvider).value?.stage,
        OnboardingStage.otpSent,
      );
    });

    test('open sign-up needs an email address for the code', () async {
      final fake = _FakeRepository(openRoles: [OnboardingRole.driver]);
      final container = _container(fake, _MemoryStorage());
      addTearDown(container.dispose);
      await container.read(onboardingControllerProvider.future);
      final controller = container.read(onboardingControllerProvider.notifier)
        ..chooseRole(OnboardingRole.driver);

      await controller.start(
        invitationCode: '',
        phone: '+970590000001',
        email: 'not-an-email',
        locale: 'ar',
      );

      final state = container.read(onboardingControllerProvider).value!;
      expect(fake.startCodes, isEmpty);
      expect(state.errorCode, 'validation_error');
    });

    test('a role that is not open still needs an invitation code', () async {
      final fake = _FakeRepository(openRoles: [OnboardingRole.driver]);
      final container = _container(fake, _MemoryStorage());
      addTearDown(container.dispose);
      await container.read(onboardingControllerProvider.future);
      final controller = container.read(onboardingControllerProvider.notifier)
        ..chooseRole(OnboardingRole.passenger);

      await controller.start(
        invitationCode: '   ',
        phone: '+970590000001',
        locale: 'ar',
      );

      final state = container.read(onboardingControllerProvider).value!;
      expect(fake.startCodes, isEmpty);
      expect(state.stage, OnboardingStage.enteringInvitation);
      expect(state.errorCode, 'validation_error');
    });

    test('the sign-up is invitation-only when the switch is off', () async {
      final fake = _FakeRepository();
      final container = _container(fake, _MemoryStorage());
      addTearDown(container.dispose);
      await container.read(onboardingControllerProvider.future);
      final controller = container.read(onboardingControllerProvider.notifier)
        ..chooseRole(OnboardingRole.driver);

      await controller.start(
        invitationCode: '',
        phone: '+970590000001',
        locale: 'ar',
      );

      expect(fake.startCodes, isEmpty);
    });

    test(
      'a restored unsubmitted applicant resumes at the upload step',
      () async {
        final fake = _FakeRepository()
          ..statusResult = const PendingStatusResult(
            role: OnboardingRole.driver,
            status: 'documents_required',
            nextAction: 'upload_documents',
            missingDocuments: ['national_id'],
          );
        final storage = _MemoryStorage()..bundle = _pendingBundle();
        final container = _container(fake, storage);
        addTearDown(container.dispose);

        final state = await container.read(onboardingControllerProvider.future);

        expect(state.stage, OnboardingStage.pendingReview);
        expect(state.applicationSubmitted, isFalse);
        expect(state.missingDocuments, ['national_id']);
      },
    );

    test('submitApplication marks the application as under review', () async {
      final fake = _FakeRepository()
        ..statusResult = const PendingStatusResult(
          role: OnboardingRole.driver,
          status: 'documents_required',
          nextAction: 'upload_documents',
        );
      final container = _container(
        fake,
        _MemoryStorage()..bundle = _pendingBundle(),
      );
      addTearDown(container.dispose);
      await container.read(onboardingControllerProvider.future);

      await container
          .read(onboardingControllerProvider.notifier)
          .submitApplication();

      final state = container.read(onboardingControllerProvider).value!;
      expect(fake.submitted, 1);
      expect(state.applicationSubmitted, isTrue);
      expect(state.submitting, isFalse);
      expect(state.errorCode, isNull);
    });

    test(
      'a refused submission stays unsubmitted and reports the code',
      () async {
        final fake = _FakeRepository()
          ..statusResult = const PendingStatusResult(
            role: OnboardingRole.driver,
            status: 'documents_required',
            nextAction: 'upload_documents',
          )
          ..submitError = const ApiException(
            ApiErrorType.unknown,
            'documents_required',
            statusCode: 409,
          );
        final container = _container(
          fake,
          _MemoryStorage()..bundle = _pendingBundle(),
        );
        addTearDown(container.dispose);
        await container.read(onboardingControllerProvider.future);

        await container
            .read(onboardingControllerProvider.notifier)
            .submitApplication();

        final state = container.read(onboardingControllerProvider).value!;
        expect(state.applicationSubmitted, isFalse);
        expect(state.submitting, isFalse);
        expect(state.errorCode, 'documents_required');
        expect(state.stage, OnboardingStage.pendingReview);
      },
    );

    test('an already submitted application is not submitted twice', () async {
      final fake = _FakeRepository()
        ..statusResult = const PendingStatusResult(
          role: OnboardingRole.driver,
          status: 'pending_review',
          nextAction: 'await_approval',
        );
      final container = _container(
        fake,
        _MemoryStorage()..bundle = _pendingBundle(),
      );
      addTearDown(container.dispose);
      await container.read(onboardingControllerProvider.future);

      await container
          .read(onboardingControllerProvider.notifier)
          .submitApplication();

      expect(fake.submitted, 0);
    });
  });
}

const _startBody =
    '{"attempt":{"id":"attempt_1","status":"otp_sent","phone":"+970*****01","expires_at":"2026-07-20T10:00:00.000Z","resend_available_at":"2026-07-20T09:01:00.000Z"},"onboarding_token":"continuation","onboarding_token_expires_at":"2026-07-20T09:30:00.000Z","next_action":"verify_otp","request_id":"req"}';

OnboardingRepository _repository(
  Future<http.Response> Function(http.Request request) handler,
) => OnboardingRepository(
  baseUrl: 'http://api.test',
  client: MockClient(handler),
);

ProviderContainer _container(
  OnboardingRepository repository,
  OnboardingStorage storage,
) => ProviderContainer(
  overrides: [
    onboardingRepositoryProvider.overrideWithValue(repository),
    onboardingStorageProvider.overrideWithValue(storage),
  ],
);

OnboardingBundle _pendingBundle() => OnboardingBundle(
  type: OnboardingBundleType.pendingStatus,
  safeStage: OnboardingStage.pendingReview,
  locale: 'ar',
  selectedRole: OnboardingRole.driver,
  pendingStatusToken: 'pending-token',
  pendingStatusExpiresAt: DateTime.now().toUtc().add(const Duration(hours: 1)),
);

class _FakeRepository extends OnboardingRepository {
  _FakeRepository({this.openRoles = const []})
    : super(
        baseUrl: 'http://api.test',
        client: MockClient((_) async => http.Response('{}', 200)),
      );

  final List<OnboardingRole> openRoles;
  final List<String> startCodes = [];
  PendingStatusResult? statusResult;
  ApiException? submitError;
  int submitted = 0;

  @override
  Future<OnboardingConfig> config() async => OnboardingConfig(
    enabled: true,
    registrationRoles: OnboardingRole.values,
    openRegistrationRoles: openRoles,
    supportedLocales: const ['ar', 'en'],
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
    startCodes.add(invitationCode);
    return StartAttemptResult(
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
  }

  @override
  Future<PendingStatusResult> status(String onboardingToken) async =>
      statusResult ??
      const PendingStatusResult(
        role: null,
        status: 'in_progress',
        nextAction: 'verify_otp',
      );

  @override
  Future<void> submitApplication(String onboardingToken) async {
    submitted += 1;
    final error = submitError;
    if (error != null) throw error;
  }
}

class _MemoryStorage extends OnboardingStorage {
  _MemoryStorage() : super(const FlutterSecureStorage());

  OnboardingBundle? bundle;

  @override
  Future<OnboardingBundle?> readBundle() async => bundle;

  @override
  Future<void> saveBundle(OnboardingBundle value) async => bundle = value;

  @override
  Future<void> clear() async => bundle = null;
}
