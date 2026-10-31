import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/onboarding/data/onboarding_repository.dart';
import 'package:masari_mobile/features/onboarding/domain/onboarding_models.dart';

void main() {
  test('disabled config parses and exposes no registration roles', () async {
    final repository = _repository((request) async {
      expect(request.headers[HttpHeaders.authorizationHeader], isNull);
      return http.Response(
        '{"enabled":false,"registration_roles":[],"request_id":"req"}',
        200,
      );
    });

    final config = await repository.config();

    expect(config.enabled, isFalse);
    expect(config.registrationRoles, isEmpty);
  });

  test(
    'enabled config fails closed when the global phone policy is malformed',
    () async {
      final repository = _repository((_) async {
        return http.Response(
          '{"enabled":true,"registration_roles":["passenger","admin"],"phone_policy":{"canonical_format":"regional"},"supported_locales":["ar","en"],"otp_digits":6,"resend_cooldown_seconds":60}',
          200,
        );
      });

      await expectLater(repository.config(), throwsA(isA<ApiException>()));
    },
  );

  test(
    'start sends public request with idempotency and no bearer token',
    () async {
      final repository = _repository((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/api/v1/onboarding/attempts');
        expect(request.headers['Idempotency-Key'], 'idem-start');
        expect(request.headers[HttpHeaders.authorizationHeader], isNull);
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['invitation_code'], isNotNull);
        expect(body['phone'], '+972569523636');
        expect(body, isNot(contains('region')));
        return http.Response(
          '{"attempt":{"id":"attempt_1","status":"otp_sent","phone":"+970*****01","expires_at":"2026-07-20T10:00:00.000Z","resend_available_at":"2026-07-20T09:01:00.000Z"},"onboarding_token":"continuation","onboarding_token_expires_at":"2026-07-20T09:30:00.000Z","next_action":"verify_otp","request_id":"req"}',
          201,
        );
      });

      final result = await repository.start(
        invitationCode: 'INVITE-CODE-1234567890',
        role: OnboardingRole.passenger,
        phone: '+972569523636',
        locale: 'ar',
        idempotencyKey: 'idem-start',
      );

      expect(result.attemptId, 'attempt_1');
      expect(result.onboardingToken, 'continuation');
    },
  );

  test(
    'open sign-up sends the email the code goes to, invited sign-up never does',
    () async {
      var seen = <String, dynamic>{};
      final repository = _repository((request) async {
        seen = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          '{"attempt":{"id":"attempt_1","status":"otp_sent","phone":"+970*****01","expires_at":"2026-07-20T10:00:00.000Z","resend_available_at":"2026-07-20T09:01:00.000Z"},"onboarding_token":"continuation","onboarding_token_expires_at":"2026-07-20T09:30:00.000Z","next_action":"verify_otp","request_id":"req"}',
          201,
        );
      });
      await repository.start(
        invitationCode: '',
        role: OnboardingRole.driver,
        phone: '+970590000001',
        email: ' Driver@Example.com ',
        locale: 'en',
        idempotencyKey: 'idem-open',
      );
      expect(seen['email'], 'Driver@Example.com');
      expect(seen, isNot(contains('invitation_code')));
      await repository.start(
        invitationCode: 'INVITE-CODE-1234567890',
        role: OnboardingRole.driver,
        phone: '+970590000001',
        email: 'ignored@example.com',
        locale: 'en',
        idempotencyKey: 'idem-invited',
      );
      expect(seen, isNot(contains('email')));
    },
  );

  test('continuation requests use Onboarding authorization only', () async {
    final repository = _repository((request) async {
      expect(
        request.headers[HttpHeaders.authorizationHeader],
        'Onboarding continuation',
      );
      expect(request.headers['Idempotency-Key'], 'idem-verify');
      return http.Response(
        '{"status":"phone_verified","registration_grant":"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12","registration_grant_expires_at":"2026-07-20T09:15:00.000Z","next_action":"complete_registration","request_id":"req"}',
        200,
      );
    });

    final result = await repository.verify(
      attemptId: 'attempt_1',
      continuationToken: 'continuation',
      otp: '123456',
      idempotencyKey: 'idem-verify',
    );

    expect(result.registrationGrant, isNotEmpty);
  });

  test(
    'resend rejects a provider failure outcome as retryable UI error',
    () async {
      final repository = _repository((request) async {
        expect(
          request.url.path,
          '/api/v1/onboarding/attempts/attempt_1/resend',
        );
        expect(request.headers['Idempotency-Key'], 'idem-resend');
        return http.Response(
          '{"status":"verification_temporarily_unavailable","resend_available_at":"2026-07-20T09:01:00.000Z","request_id":"req"}',
          200,
        );
      });

      await expectLater(
        repository.resend(
          attemptId: 'attempt_1',
          continuationToken: 'continuation',
          idempotencyKey: 'idem-resend',
        ),
        throwsA(
          isA<ApiException>().having(
            (error) => error.message,
            'message',
            'verification_temporarily_unavailable',
          ),
        ),
      );
    },
  );

  test(
    'resend requires an accepted status and a valid cooldown timestamp',
    () async {
      final repository = _repository((_) async {
        return http.Response('{"status":"otp_sent","request_id":"req"}', 200);
      });

      await expectLater(
        repository.resend(
          attemptId: 'attempt_1',
          continuationToken: 'continuation',
          idempotencyKey: 'idem-resend',
        ),
        throwsA(isA<ApiException>()),
      );
    },
  );

  test(
    'completion rejects operational token fields as contract violation',
    () async {
      final repository = _repository((request) async {
        return http.Response(
          '{"result":"account_created","role":"passenger","account_status":"active","next_action":"login","access_token":"bad","request_id":"req"}',
          201,
        );
      });

      await expectLater(
        repository.complete(
          attemptId: 'attempt_1',
          continuationToken: 'continuation',
          registrationGrant: 'grant',
          displayName: 'Name',
          password: 'long-password-value',
          locale: 'ar',
          consents: [
            _doc('terms'),
            _doc('privacy'),
            _doc('adult_self_attestation'),
          ],
          idempotencyKey: 'idem-complete',
        ),
        throwsA(isA<ApiException>()),
      );
    },
  );

  test('completion rejects nested session contract fields', () async {
    final repository = _repository((_) async {
      return http.Response(
        '{"result":"account_created","role":"passenger","account_status":"active","next_action":"login","session":{},"request_id":"req"}',
        201,
      );
    });

    await expectLater(
      repository.complete(
        attemptId: 'attempt_1',
        continuationToken: 'continuation',
        registrationGrant: 'grant',
        displayName: 'Name',
        password: 'long-password-value',
        locale: 'ar',
        consents: [
          _doc('terms'),
          _doc('privacy'),
          _doc('adult_self_attestation'),
        ],
        idempotencyKey: 'idem-complete',
      ),
      throwsA(isA<ApiException>()),
    );
  });

  test('pending recovery maps generic invalid credentials safely', () async {
    final repository = _repository((request) async {
      expect(request.headers[HttpHeaders.authorizationHeader], isNull);
      expect(jsonDecode(request.body), {
        'phone': '+962790000000',
        'password': 'bad',
      });
      return http.Response('{"error":"invalid_credentials"}', 401);
    });

    await expectLater(
      repository.recoverPendingStatus(phone: '+962790000000', password: 'bad'),
      throwsA(
        isA<ApiException>().having(
          (error) => error.message,
          'message',
          'invalid_credentials',
        ),
      ),
    );
  });
}

OnboardingRepository _repository(
  Future<http.Response> Function(http.Request request) handler,
) {
  return OnboardingRepository(
    baseUrl: 'http://api.test',
    client: MockClient(handler),
  );
}

ConsentDocument _doc(String type) => ConsentDocument(
  id: 'doc_$type',
  type: type,
  version: 'v1',
  locale: 'ar',
  content: '$type content',
  contentHash: 'a' * 64,
  effectiveAt: DateTime.utc(2026, 7, 20),
);
