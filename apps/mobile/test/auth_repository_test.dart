import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/auth/data/auth_repository.dart';
import 'package:masari_mobile/features/auth/domain/auth_models.dart';

import 'support/auth_test_support.dart';

void main() {
  test('successful login parsing', () async {
    final repository = _repository((request) async {
      return http.Response(
        '{"token":"jwt-token","access_token":"jwt-token","access_token_expires_in":900,"refresh_token":"refresh-value","refresh_token_expires_in":3600,"session":{"id":"session_1","client_type":"mobile","device_name":"Masari Android","created_at":"2026-07-17T10:00:00.000Z","last_used_at":"2026-07-17T10:00:00.000Z","expires_at":"2026-07-17T11:00:00.000Z","is_current":true,"revoked":false},"user":{"id":"user_1","name":"Demo Passenger","phone":"+970590000001","role":"passenger","demo_account":true}}',
        200,
      );
    });

    final result = await repository.login(
      email: 'passenger@example.com',
      password: 'mobile-test-passenger-secret',
    );

    expect(result.token, 'jwt-token');
    expect(result.bundle.refreshToken, 'refresh-value');
    expect(result.bundle.accessTokenExpiresAt, isNotNull);
    expect(result.bundle.refreshTokenExpiresAt, isNotNull);
    expect(result.bundle.sessionId, 'session_1');
    expect(result.user.role, UserRole.passenger);
    expect(result.user.demoAccount, isTrue);
  });

  test('admin login response without refresh credential parses safely', () async {
    final repository = _repository((request) async {
      return http.Response(
        '{"token":"admin-access","access_token":"admin-access","access_token_expires_in":900,"session":{"id":"admin_session","client_type":"admin","device_name":null,"created_at":"2026-07-17T10:00:00.000Z","last_used_at":"2026-07-17T10:00:00.000Z","expires_at":"2026-07-17T10:15:00.000Z","is_current":true,"revoked":false},"user":{"id":"admin_1","name":"Admin","phone":"+970590000005","role":"admin","demo_account":true}}',
        200,
      );
    });

    final result = await repository.login(
      email: 'admin@example.com',
      password: 'password-value',
    );

    expect(result.user.role, UserRole.admin);
    expect(result.bundle.refreshToken, isNull);
    expect(result.bundle.canRefresh, isFalse);
  });

  test('conflicting token fields are rejected safely', () async {
    final repository = _repository((request) async {
      return http.Response(
        '{"token":"first","access_token":"second","access_token_expires_in":900,"user":{"id":"user_1","name":"Passenger","phone":"+970590000001","role":"passenger","demo_account":false}}',
        200,
      );
    });

    await expectLater(
      repository.login(
        email: 'passenger@example.com',
        password: 'password-value',
      ),
      throwsA(
        isA<ApiException>()
            .having((error) => error.type, 'type', ApiErrorType.validation)
            .having(
              (error) => error.toString(),
              'safe error',
              isNot(contains('first')),
            ),
      ),
    );
  });

  test('malformed authoritative expiry is rejected safely', () async {
    final repository = _repository((request) async {
      return http.Response(
        '{"token":"access","access_token_expires_in":"soon","user":{"id":"user_1","name":"Passenger","phone":"+970590000001","role":"passenger","demo_account":false}}',
        200,
      );
    });

    await expectLater(
      repository.login(
        email: 'passenger@example.com',
        password: 'password-value',
      ),
      throwsA(isA<ApiException>()),
    );
  });

  test('login sends a phone number as phone and an email as email', () async {
    final bodies = <String>[];
    final repository = _repository((request) async {
      bodies.add(request.body);
      return http.Response(
        '{"token":"jwt-token","access_token":"jwt-token","access_token_expires_in":900,"refresh_token":"refresh-value","refresh_token_expires_in":3600,"session":{"id":"session_1","client_type":"mobile","device_name":"Masari Android","created_at":"2026-07-17T10:00:00.000Z","last_used_at":"2026-07-17T10:00:00.000Z","expires_at":"2026-07-17T11:00:00.000Z","is_current":true,"revoked":false},"user":{"id":"user_1","name":"Invited","phone":"+970590003001","role":"passenger","demo_account":false}}',
        200,
      );
    });

    await repository.login(
      email: '+970590003001',
      password: 'a-long-passphrase',
    );
    await repository.login(
      email: 'a@example.com',
      password: 'a-long-passphrase',
    );

    expect(bodies[0], contains('"phone":"+970590003001"'));
    expect(bodies[0], isNot(contains('"email"')));
    expect(bodies[1], contains('"email":"a@example.com"'));
    expect(bodies[1], isNot(contains('"phone"')));
  });

  test('failed login error mapping', () async {
    final repository = _repository((request) async {
      return http.Response('{"error":"invalid_credentials"}', 401);
    });

    await expectLater(
      repository.login(email: 'passenger@example.com', password: 'bad'),
      throwsA(
        isA<ApiException>().having(
          (error) => error.type,
          'type',
          ApiErrorType.unauthorized,
        ),
      ),
    );
  });

  test('/me parsing and authorization header is sent', () async {
    String? authorization;
    final repository = _repository((request) async {
      authorization = request.headers[HttpHeaders.authorizationHeader];
      return http.Response(
        '{"user":{"id":"user_2","name":"Demo Driver","phone":"+970590000002","role":"driver","demo_account":true}}',
        200,
      );
    });

    final user = await repository.me();

    expect(authorization, 'Bearer test-access-token');
    expect(user.role, UserRole.driver);
  });

  test('raw token is not exposed through errors', () async {
    final repository = _repository((request) async {
      return http.Response('{"error":"invalid_token"}', 401);
    });

    Object? caught;
    try {
      await repository.me();
    } catch (error) {
      caught = error;
    }

    expect(caught.toString(), isNot(contains('test-access-token')));
  });
}

AuthRepository _repository(
  Future<http.Response> Function(http.Request request) handler,
) {
  final authenticated = TestAuthenticatedClient(handler: handler);
  return AuthRepository(
    apiClient: authenticated.coordinator.apiClient,
    authenticatedApiClient: authenticated.client,
  );
}
