import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:darb_mobile/core/api/api_client.dart';
import 'package:darb_mobile/core/api/api_error.dart';
import 'package:darb_mobile/core/config/app_config.dart';
import 'package:darb_mobile/features/auth/application/auth_controller.dart';
import 'package:darb_mobile/features/auth/data/token_storage.dart';
import 'package:darb_mobile/features/auth/domain/auth_models.dart';
import 'package:darb_mobile/features/onboarding/data/onboarding_repository.dart';

import 'support/auth_test_support.dart';
import 'test_app_config.dart';

const _gatewayPage =
    '<html><head><title>502 Bad Gateway</title></head>'
    '<body><center><h1>502 Bad Gateway</h1></center><hr>nginx</body></html>';

Matcher _apiError(ApiErrorType type, String message, {int? statusCode}) {
  return isA<ApiException>()
      .having((error) => error.type, 'type', type)
      .having((error) => error.message, 'message', message)
      .having((error) => error.statusCode, 'statusCode', statusCode);
}

void main() {
  group('ApiClient response classification', () {
    test('an HTML 502 page from the proxy is a server error', () async {
      final api = _api((_) async => http.Response(_gatewayPage, 502));

      await expectLater(
        api.getJson('/me'),
        throwsA(
          _apiError(ApiErrorType.server, 'request_failed', statusCode: 502),
        ),
      );
    });

    test('an empty 503 body is a server error', () async {
      final api = _api((_) async => http.Response('', 503));

      await expectLater(
        api.postJson('/auth/refresh', body: const {}),
        throwsA(
          _apiError(ApiErrorType.server, 'request_failed', statusCode: 503),
        ),
      );
    });

    test('a malformed 200 body is an invalid response', () async {
      final api = _api((_) async => http.Response('<html>portal</html>', 200));

      await expectLater(
        api.getJson('/me'),
        throwsA(_apiError(ApiErrorType.validation, 'invalid_response')),
      );
    });

    test('a 200 JSON body that is not an object is an invalid response', () {
      final api = _api((_) async => http.Response('[1,2]', 200));

      expect(
        api.getJson('/me'),
        throwsA(_apiError(ApiErrorType.validation, 'invalid_response')),
      );
    });

    test('a 204 with no body succeeds with an empty object', () async {
      final api = _api((_) async => http.Response('', 204));

      expect(await api.deleteJson('/saved-places/1'), isEmpty);
    });

    test('a 4xx keeps the server error code from a JSON body', () async {
      final api = _api(
        (_) async => http.Response('{"error":"route_unavailable"}', 409),
      );

      await expectLater(
        api.getJson('/routes'),
        throwsA(
          _apiError(
            ApiErrorType.validation,
            'route_unavailable',
            statusCode: 409,
          ),
        ),
      );
    });

    test('a non-JSON 4xx is classified by its status', () async {
      final api = _api((_) async => http.Response('Not Found', 404));

      await expectLater(
        api.getJson('/missing'),
        throwsA(
          _apiError(ApiErrorType.validation, 'request_failed', statusCode: 404),
        ),
      );
    });

    test('auth statuses keep their types without a JSON body', () async {
      final unauthorized = _api((_) async => http.Response('', 401));
      final forbidden = _api((_) async => http.Response('<html/>', 403));

      await expectLater(
        unauthorized.getJson('/me'),
        throwsA(
          _apiError(
            ApiErrorType.unauthorized,
            'request_failed',
            statusCode: 401,
          ),
        ),
      );
      await expectLater(
        forbidden.getJson('/me'),
        throwsA(
          _apiError(ApiErrorType.forbidden, 'request_failed', statusCode: 403),
        ),
      );
    });

    test('408 and 429 are retryable even with HTML bodies', () async {
      final timedOut = _api((_) async => http.Response('<html/>', 408));
      final limited = _api((_) async => http.Response('<html/>', 429));

      await expectLater(
        timedOut.getJson('/me'),
        throwsA(
          _apiError(ApiErrorType.timeout, 'request_timeout', statusCode: 408),
        ),
      );
      await expectLater(
        limited.getJson('/me'),
        throwsA(
          _apiError(ApiErrorType.server, 'rate_limited', statusCode: 429),
        ),
      );
    });
  });

  group('OnboardingRepository response classification', () {
    test('an HTML 502 page is a server error', () async {
      final repository = _onboarding(
        (_) async => http.Response(_gatewayPage, 502),
      );

      await expectLater(
        repository.config(),
        throwsA(
          _apiError(ApiErrorType.server, 'request_failed', statusCode: 502),
        ),
      );
    });

    test('a JSON 4xx keeps the server error code', () async {
      final repository = _onboarding(
        (_) async => http.Response('{"error":"onboarding_disabled"}', 404),
      );

      await expectLater(
        repository.config(),
        throwsA(
          _apiError(
            ApiErrorType.validation,
            'onboarding_disabled',
            statusCode: 404,
          ),
        ),
      );
    });
  });

  group('startup restore', () {
    test('a 502 error page keeps the saved session for a retry', () async {
      FlutterSecureStorage.setMockInitialValues({
        TokenStorage.tokenKey: 'saved-token',
      });
      final container = _container(
        (_) async => http.Response(_gatewayPage, 502),
      );
      addTearDown(container.dispose);

      final state = await container.read(authControllerProvider.future);

      expect(state.status, AuthStatus.restoreFailed);
      expect(state.error?.type, ApiErrorType.server);
      expect(
        await container.read(tokenStorageProvider).readToken(),
        'saved-token',
      );
    });

    test('a malformed 200 keeps the saved session for a retry', () async {
      FlutterSecureStorage.setMockInitialValues({
        TokenStorage.tokenKey: 'saved-token',
      });
      final container = _container(
        (_) async => http.Response('<html>captive portal</html>', 200),
      );
      addTearDown(container.dispose);

      final state = await container.read(authControllerProvider.future);

      expect(state.status, AuthStatus.restoreFailed);
      expect(
        await container.read(tokenStorageProvider).readToken(),
        'saved-token',
      );
    });

    test('a 401 still signs out', () async {
      FlutterSecureStorage.setMockInitialValues({
        TokenStorage.tokenKey: 'saved-token',
      });
      final container = _container(
        (_) async => http.Response('{"error":"unauthorized"}', 401),
      );
      addTearDown(container.dispose);

      final state = await container.read(authControllerProvider.future);

      expect(state.status, AuthStatus.unauthenticated);
      expect(await container.read(tokenStorageProvider).readToken(), isNull);
    });
  });

  group('token refresh', () {
    final now = DateTime.utc(2026, 7, 17, 10);

    for (final (label, response) in [
      ('an empty 503', () => http.Response('', 503)),
      ('an HTML 502 page', () => http.Response(_gatewayPage, 502)),
      ('a Cloudflare 403 challenge page', () => http.Response('<html/>', 403)),
      ('a captive-portal 200 page', () => http.Response('<html/>', 200)),
      ('a 429', () => http.Response('{"error":"rate_limited"}', 429)),
    ]) {
      test('$label keeps the session for a retry', () async {
        final harness = TestAuthenticatedClient(
          now: () => now,
          bundle: _expiringBundle(now),
          handler: (request) async {
            if (request.url.path.endsWith('/auth/refresh')) return response();
            return http.Response('{"ok":true}', 200);
          },
        );

        await expectLater(
          harness.client.getJson('/dashboard'),
          throwsA(isA<ApiException>()),
        );

        expect(harness.storage.bundle?.refreshToken, 'old-refresh');
        expect(harness.storage.clearCount, 0);
        expect(harness.coordinator.lastTerminationReason, isNull);
      });
    }

    test('a revoked refresh token still ends the session', () async {
      final harness = TestAuthenticatedClient(
        now: () => now,
        bundle: _expiringBundle(now),
        handler: (_) async => http.Response('{"error":"session_revoked"}', 401),
      );

      await expectLater(
        harness.client.getJson('/dashboard'),
        throwsA(isA<ApiException>()),
      );

      expect(harness.storage.bundle, isNull);
      expect(harness.coordinator.lastTerminationReason, SessionEndReason.ended);
    });

    test('an unavailable account still ends the session', () async {
      final harness = TestAuthenticatedClient(
        now: () => now,
        bundle: _expiringBundle(now),
        handler: (_) async =>
            http.Response('{"error":"account_unavailable"}', 403),
      );

      await expectLater(
        harness.client.getJson('/dashboard'),
        throwsA(isA<ApiException>()),
      );

      expect(harness.storage.bundle, isNull);
      expect(
        harness.coordinator.lastTerminationReason,
        SessionEndReason.accountUnavailable,
      );
    });
  });
}

ApiClient _api(Future<http.Response> Function(http.Request request) handler) {
  return ApiClient(baseUrl: 'http://api.test', client: MockClient(handler));
}

OnboardingRepository _onboarding(
  Future<http.Response> Function(http.Request request) handler,
) {
  return OnboardingRepository(
    baseUrl: 'http://api.test',
    client: MockClient(handler),
  );
}

ProviderContainer _container(
  Future<http.Response> Function(http.Request request) handler,
) {
  return ProviderContainer(
    overrides: [
      appConfigProvider.overrideWithValue(demoTestAppConfig),
      httpClientProvider.overrideWithValue(MockClient(handler)),
    ],
  );
}

AuthTokenBundle _expiringBundle(DateTime now) {
  return AuthTokenBundle(
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    accessTokenExpiresAt: now.add(const Duration(seconds: 10)),
    refreshTokenExpiresAt: now.add(const Duration(days: 1)),
    sessionId: 'session_1',
  );
}
