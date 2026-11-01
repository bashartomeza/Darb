import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/features/auth/data/token_storage.dart';
import 'package:darb_mobile/features/onboarding/data/onboarding_storage.dart';
import 'package:darb_mobile/features/onboarding/domain/onboarding_models.dart';

void main() {
  const secureStorage = FlutterSecureStorage();

  test(
    'continuation bundle persists and keeps auth bundle independent',
    () async {
      FlutterSecureStorage.setMockInitialValues({
        TokenStorage.bundleKey:
            '{"version":1,"access_token":"access","refresh_token":null,"access_token_expires_at":null,"refresh_token_expires_at":null,"session_id":null,"legacy_access_only":false}',
      });
      final storage = OnboardingStorage(secureStorage);
      final bundle = OnboardingBundle(
        type: OnboardingBundleType.continuation,
        safeStage: OnboardingStage.otpSent,
        locale: 'ar',
        selectedRole: OnboardingRole.passenger,
        attemptId: 'attempt_1',
        continuationToken: 'continuation-token',
        continuationExpiresAt: DateTime.now().toUtc().add(
          const Duration(hours: 1),
        ),
        maskedPhone: '+970*****01',
      );

      await storage.saveBundle(bundle);
      final restored = await storage.readBundle();

      expect(restored?.type, OnboardingBundleType.continuation);
      expect(restored?.attemptId, 'attempt_1');
      expect(restored?.continuationToken, 'continuation-token');
      expect(await secureStorage.read(key: TokenStorage.bundleKey), isNotNull);
    },
  );

  test('pending bundle cannot be confused with continuation bundle', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final storage = OnboardingStorage(secureStorage);

    await storage.saveBundle(
      OnboardingBundle(
        type: OnboardingBundleType.pendingStatus,
        safeStage: OnboardingStage.pendingReview,
        locale: 'en',
        selectedRole: OnboardingRole.driver,
        pendingStatusToken: 'pending-token',
        pendingStatusExpiresAt: DateTime.now().toUtc().add(
          const Duration(days: 1),
        ),
      ),
    );

    final restored = await storage.readBundle();
    expect(restored?.type, OnboardingBundleType.pendingStatus);
    expect(restored?.continuationToken, isNull);
    expect(restored?.pendingStatusToken, 'pending-token');
  });

  test(
    'corrupt and expired bundles fail closed and clear only onboarding key',
    () async {
      FlutterSecureStorage.setMockInitialValues({
        OnboardingStorage.bundleKey: '{"version":1,"type":"continuation"}',
        'masari_locale': 'ar',
        TokenStorage.tokenKey: 'legacy-auth',
      });
      final storage = OnboardingStorage(secureStorage);

      expect(await storage.readBundle(), isNull);
      expect(
        await secureStorage.read(key: OnboardingStorage.bundleKey),
        isNull,
      );
      expect(await secureStorage.read(key: 'masari_locale'), 'ar');
      expect(
        await secureStorage.read(key: TokenStorage.tokenKey),
        'legacy-auth',
      );

      final expired = OnboardingBundle(
        type: OnboardingBundleType.continuation,
        safeStage: OnboardingStage.otpSent,
        locale: 'ar',
        selectedRole: OnboardingRole.passenger,
        attemptId: 'attempt_1',
        continuationToken: 'continuation-token',
        continuationExpiresAt: DateTime.now().toUtc().subtract(
          const Duration(seconds: 1),
        ),
      );
      await expectLater(storage.saveBundle(expired), throwsStateError);
      expect(await storage.readBundle(), isNull);
    },
  );

  test('raw invitation OTP password and raw phone are not stored', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final storage = OnboardingStorage(secureStorage);
    await storage.saveBundle(
      OnboardingBundle(
        type: OnboardingBundleType.continuation,
        safeStage: OnboardingStage.phoneVerified,
        locale: 'ar',
        selectedRole: OnboardingRole.passenger,
        attemptId: 'attempt_1',
        continuationToken: 'continuation-token',
        continuationExpiresAt: DateTime.now().toUtc().add(
          const Duration(hours: 1),
        ),
        registrationGrant: 'registration-grant',
        registrationGrantExpiresAt: DateTime.now().toUtc().add(
          const Duration(minutes: 10),
        ),
        maskedPhone: '+970*****01',
      ),
    );

    final encoded = await secureStorage.read(key: OnboardingStorage.bundleKey);
    expect(encoded, isNot(contains('INVITE')));
    expect(encoded, isNot(contains('123456')));
    expect(encoded, isNot(contains('password')));
    expect(encoded, isNot(contains('+970590000001')));
  });

  test('unknown enum and mixed-purpose bundles fail closed', () async {
    FlutterSecureStorage.setMockInitialValues({
      OnboardingStorage.bundleKey:
          '{"version":1,"type":"continuation","safe_stage":"unknown","locale":"ar","selected_role":"passenger","attempt_id":"attempt_1","continuation_token":"token","continuation_expires_at":"2099-01-01T00:00:00.000Z"}',
    });
    final storage = OnboardingStorage(secureStorage);

    expect(await storage.readBundle(), isNull);
    expect(await secureStorage.read(key: OnboardingStorage.bundleKey), isNull);
  });

  test('bundle copy preserves masked phone', () {
    final bundle = OnboardingBundle(
      type: OnboardingBundleType.continuation,
      safeStage: OnboardingStage.otpSent,
      locale: 'ar',
      selectedRole: OnboardingRole.passenger,
      attemptId: 'attempt_1',
      continuationToken: 'token',
      continuationExpiresAt: DateTime.utc(2099),
      maskedPhone: '+970*****01',
    );

    expect(
      bundle.copyWith(resendAvailableAt: DateTime.utc(2099)).maskedPhone,
      '+970*****01',
    );
  });
}
