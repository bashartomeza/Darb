import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/features/auth/data/auth_repository.dart';
import 'package:masari_mobile/features/auth/domain/auth_models.dart';
import 'support/auth_test_support.dart';

void main() {
  test('a contradictory complete profile without a phone stays restricted', () {
    final user = AuthUser.fromJson({
      'id': 'u',
      'name': 'Passenger',
      'role': 'passenger',
      'phone': null,
      'profile_state': 'complete',
    });
    expect(user.requiresPhone, isTrue);
  });

  test(
    'credential actions send purpose-specific proofs with session authorization',
    () async {
      final sent = <String, Map<String, dynamic>>{};
      final client = TestAuthenticatedClient(
        handler: (request) async {
          if (request.url.path.contains('/identities/') ||
              request.url.path.endsWith('/password/set')) {
            expect(
              request.headers['authorization'],
              'Bearer test-access-token',
            );
          }
          sent[request.url.path] =
              jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response('{"ok":true}', 200);
        },
      );
      final repository = AuthRepository(
        apiClient: client.coordinator.apiClient,
        authenticatedApiClient: client.client,
      );
      await repository.emailActionStart('a@example.com', 'en', reset: true);
      await repository.emailActionConfirm(
        'a@example.com',
        '123456',
        'new-long-password',
        reset: true,
      );
      await repository.emailActionConfirm(
        'a@example.com',
        '654321',
        '',
        reset: false,
      );
      await repository.setPassword('new-long-password', 'current-password', '');
      await repository.linkGoogle('ephemeral-google', '', 'reauth-proof');
      expect(sent['/api/v1/auth/password/reset/start'], {
        'email': 'a@example.com',
        'locale': 'en',
      });
      expect(sent['/api/v1/auth/password/reset/confirm'], {
        'email': 'a@example.com',
        'code': '123456',
        'password': 'new-long-password',
      });
      expect(sent['/api/v1/auth/email/verify/confirm'], {
        'email': 'a@example.com',
        'code': '654321',
      });
      expect(sent['/api/v1/auth/password/set'], {
        'password': 'new-long-password',
        'current_password': 'current-password',
      });
      await repository.setPassword('new-long-password', '', '246810');
      expect(sent['/api/v1/auth/password/set'], {
        'password': 'new-long-password',
        'reauthentication_code': '246810',
      });
      expect(sent['/api/v1/auth/identities/google/link'], {
        'id_token': 'ephemeral-google',
        'reauthentication_token': 'reauth-proof',
      });
    },
  );
  test(
    'mobile login uses the endpoint that rejects administrator sessions',
    () async {
      String? path;
      final client = TestAuthenticatedClient(
        handler: (request) async {
          path = request.url.path;
          return http.Response(
            jsonEncode({
              'token': 'masari',
              'user': {
                'id': 'passenger',
                'name': 'Passenger',
                'role': 'passenger',
                'phone': null,
                'profile_state': 'phone_required',
                'demo_account': false,
              },
            }),
            200,
          );
        },
      );
      final repository = AuthRepository(
        apiClient: client.coordinator.apiClient,
        authenticatedApiClient: client.client,
      );
      await repository.login(
        email: 'passenger@example.com',
        password: 'a-valid-password',
      );
      expect(path, '/api/v1/auth/mobile/login');
    },
  );
}
