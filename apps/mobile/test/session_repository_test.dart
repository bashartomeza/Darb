import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:darb_mobile/features/security/data/session_repository.dart';

import 'support/auth_test_support.dart';

void main() {
  test('session list parses the safe backend contract', () async {
    String? authorization;
    final harness = TestAuthenticatedClient(
      handler: (request) async {
        authorization = request.headers[HttpHeaders.authorizationHeader];
        return http.Response(
          '{"sessions":[{"id":"session_1","client_type":"mobile","device_name":"Darb Android","created_at":"2026-07-17T10:00:00.000Z","last_used_at":"2026-07-17T10:05:00.000Z","expires_at":"2026-08-17T10:00:00.000Z","is_current":true,"revoked":false}]}',
          200,
        );
      },
    );
    final repository = SessionRepository(apiClient: harness.client);

    final sessions = await repository.listSessions();

    expect(authorization, 'Bearer test-access-token');
    expect(sessions, hasLength(1));
    expect(sessions.single.isCurrent, isTrue);
    expect(sessions.single.deviceName, 'Darb Android');
  });

  test('revoke, logout, and logout-all use their exact endpoints', () async {
    final calls = <String>[];
    final harness = TestAuthenticatedClient(
      handler: (request) async {
        calls.add('${request.method} ${request.url.path}');
        return http.Response('{"ok":true}', 200);
      },
    );
    final repository = SessionRepository(apiClient: harness.client);

    await repository.revokeSession('session with space');
    await repository.logout();
    await repository.logoutAll();

    expect(calls, [
      'DELETE /api/v1/auth/sessions/session%20with%20space',
      'POST /api/v1/auth/logout',
      'POST /api/v1/auth/logout-all',
    ]);
  });
}
