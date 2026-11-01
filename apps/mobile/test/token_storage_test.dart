import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/features/auth/data/token_storage.dart';
import 'package:darb_mobile/features/auth/domain/auth_models.dart';

void main() {
  const secureStorage = FlutterSecureStorage();

  test('secure bundle persists as one versioned credential record', () async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final storage = TokenStorage(secureStorage);
    final bundle = AuthTokenBundle(
      accessToken: 'access-one',
      refreshToken: 'refresh-one',
      accessTokenExpiresAt: DateTime.utc(2026, 7, 17, 10),
      refreshTokenExpiresAt: DateTime.utc(2026, 8, 17, 10),
      sessionId: 'session-one',
    );

    await storage.saveBundle(bundle);
    final restored = await storage.readBundle();

    expect(restored?.accessToken, 'access-one');
    expect(restored?.refreshToken, 'refresh-one');
    expect(restored?.sessionId, 'session-one');
    expect(await secureStorage.read(key: TokenStorage.tokenKey), isNull);
    expect(await secureStorage.read(key: TokenStorage.bundleKey), isNotNull);
  });

  test('rotated bundle replaces both credentials together', () async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final storage = TokenStorage(secureStorage);
    await storage.saveBundle(
      const AuthTokenBundle(
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
      ),
    );

    await storage.saveBundle(
      const AuthTokenBundle(
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      ),
    );
    final restored = await storage.readBundle();
    final encoded = await secureStorage.read(key: TokenStorage.bundleKey);

    expect(restored?.accessToken, 'new-access');
    expect(restored?.refreshToken, 'new-refresh');
    expect(encoded, isNot(contains('old-access')));
    expect(encoded, isNot(contains('old-refresh')));
  });

  test('legacy access-only credential restores and migrates safely', () async {
    FlutterSecureStorage.setMockInitialValues({
      TokenStorage.tokenKey: 'legacy-access',
    });
    final storage = TokenStorage(secureStorage);

    final legacy = await storage.readBundle();
    expect(legacy?.legacyAccessOnly, isTrue);
    expect(legacy?.refreshToken, isNull);

    await storage.promoteLegacy(legacy!);
    expect(await secureStorage.read(key: TokenStorage.tokenKey), isNull);
    expect((await storage.readBundle())?.accessToken, 'legacy-access');
  });

  test('corrupt or partial bundle clears all authentication keys', () async {
    FlutterSecureStorage.setMockInitialValues({
      TokenStorage.bundleKey:
          '{"version":1,"access_token":"partial","refresh_token_expires_at":"2026-08-17T10:00:00.000Z"}',
      TokenStorage.tokenKey: 'stale-legacy',
      'unrelated_secure_value': 'keep-me',
    });
    final storage = TokenStorage(secureStorage);

    expect(await storage.readBundle(), isNull);
    expect(await secureStorage.read(key: TokenStorage.bundleKey), isNull);
    expect(await secureStorage.read(key: TokenStorage.tokenKey), isNull);
    expect(await secureStorage.read(key: 'unrelated_secure_value'), 'keep-me');
  });

  test('logout clears current and legacy auth keys only', () async {
    FlutterSecureStorage.setMockInitialValues({
      TokenStorage.bundleKey:
          '{"version":1,"access_token":"access","refresh_token":null,"access_token_expires_at":null,"refresh_token_expires_at":null,"session_id":null,"legacy_access_only":false}',
      TokenStorage.tokenKey: 'legacy',
      'darb_locale': 'en',
    });
    final storage = TokenStorage(secureStorage);

    await storage.clearAuth();

    expect(await secureStorage.read(key: TokenStorage.bundleKey), isNull);
    expect(await secureStorage.read(key: TokenStorage.tokenKey), isNull);
    expect(await secureStorage.read(key: 'darb_locale'), 'en');
  });
}
