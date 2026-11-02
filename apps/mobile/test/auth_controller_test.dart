import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:darb_mobile/core/api/api_client.dart';
import 'package:darb_mobile/core/config/app_config.dart';
import 'package:darb_mobile/features/auth/application/auth_controller.dart';
import 'package:darb_mobile/features/auth/application/auth_actor_binding.dart';
import 'package:darb_mobile/features/auth/data/token_storage.dart';
import 'package:darb_mobile/features/auth/domain/auth_models.dart';
import 'package:darb_mobile/features/driver/data/driver_repository.dart';
import 'package:darb_mobile/features/canonical_routes/data/canonical_operation_storage.dart';
import 'package:darb_mobile/features/onboarding/data/onboarding_storage.dart';
import 'package:darb_mobile/features/passenger/application/passenger_history_controller.dart';

import 'test_app_config.dart';

void main() {
  for (final supersede in ['email', 'logout', 'cancel']) {
    test('late Google response cannot replace $supersede', () async {
      FlutterSecureStorage.setMockInitialValues(<String, String>{});
      final delayed = Completer<http.Response>();
      final container = _container((request) async {
        if (request.url.path.endsWith('/mobile/google')) return delayed.future;
        if (request.url.path.endsWith('/mobile/login')) {
          return http.Response(_loginBody('new-user', 'new-session'), 200);
        }
        return http.Response('{"ok":true}', 200);
      });
      addTearDown(container.dispose);
      await container.read(authControllerProvider.future);
      final controller = container.read(authControllerProvider.notifier);
      final pending = controller.loginWithGoogle(idToken: 'ephemeral');
      if (supersede == 'email') {
        await controller.login(
          email: 'new@example.com',
          password: 'long-password',
        );
      } else if (supersede == 'logout') {
        await controller.logout();
      } else {
        controller.cancelRegistration();
      }
      delayed.complete(
        http.Response(_loginBody('old-user', 'old-session'), 200),
      );
      await pending;
      expect(
        (await container.read(tokenStorageProvider).readBundle())?.accessToken,
        supersede == 'email' ? 'new-session' : isNull,
      );
      expect(
        container.read(authControllerProvider).value?.user?.id,
        supersede == 'email' ? 'new-user' : isNull,
      );
    });
  }
  test('no token routes to login state', () async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final container = _container((request) async => http.Response('{}', 500));
    addTearDown(container.dispose);

    final state = await container.read(authControllerProvider.future);

    expect(state.status, AuthStatus.unauthenticated);
  });

  test('valid saved token restores session', () async {
    FlutterSecureStorage.setMockInitialValues({
      TokenStorage.tokenKey: 'saved-token',
      OnboardingStorage.bundleKey: 'stale-onboarding-bundle',
    });
    final container = _container((request) async {
      return http.Response(
        '{"user":{"id":"user_1","name":"Demo Passenger","phone":"+970590000001","role":"passenger","demo_account":true}}',
        200,
      );
    });
    addTearDown(container.dispose);

    final state = await container.read(authControllerProvider.future);

    expect(state.status, AuthStatus.authenticated);
    expect(state.user?.role, UserRole.passenger);
    expect(
      await const FlutterSecureStorage().read(key: OnboardingStorage.bundleKey),
      isNull,
    );
  });

  test('terminal 401 removes token and exposes session-ended state', () async {
    FlutterSecureStorage.setMockInitialValues({
      TokenStorage.tokenKey: 'expired-token',
    });
    final container = _container(
      (request) async => http.Response('{"error":"invalid_token"}', 401),
    );
    addTearDown(container.dispose);

    final state = await container.read(authControllerProvider.future);
    final token = await container.read(tokenStorageProvider).readToken();

    expect(state.status, AuthStatus.sessionEnded);
    expect(state.sessionEndReason, SessionEndReason.ended);
    expect(token, isNull);
  });

  test(
    'new login persists access, refresh, expiries, and session as a bundle',
    () async {
      FlutterSecureStorage.setMockInitialValues(<String, String>{});
      final container = _container((request) async {
        if (request.url.path.endsWith('/auth/mobile/login')) {
          return http.Response(
            '{"token":"access-value","access_token":"access-value","access_token_expires_in":900,"refresh_token":"refresh-value","refresh_token_expires_in":3600,"session":{"id":"session_1","client_type":"mobile","device_name":"Darb Android","created_at":"2026-07-17T10:00:00.000Z","last_used_at":"2026-07-17T10:00:00.000Z","expires_at":"2026-07-17T11:00:00.000Z","is_current":true,"revoked":false},"user":{"id":"user_1","name":"Demo Passenger","phone":"+970590000001","role":"passenger","demo_account":true}}',
            200,
          );
        }
        return http.Response('{"error":"not_found"}', 404);
      });
      addTearDown(container.dispose);
      await container.read(authControllerProvider.future);

      await container
          .read(authControllerProvider.notifier)
          .login(email: 'passenger@example.com', password: 'password-value');
      final bundle = await container.read(tokenStorageProvider).readBundle();

      expect(bundle?.accessToken, 'access-value');
      expect(bundle?.refreshToken, 'refresh-value');
      expect(bundle?.sessionId, 'session_1');
      expect(bundle?.accessTokenExpiresAt, isNotNull);
      expect(bundle?.refreshTokenExpiresAt, isNotNull);
      expect(
        container.read(authControllerProvider).value?.status,
        AuthStatus.authenticated,
      );
    },
  );

  test(
    'registration start retains a grant without installing a session',
    () async {
      FlutterSecureStorage.setMockInitialValues(<String, String>{});
      String? calledPath;
      Map<String, dynamic>? sentBody;
      final container = _container((request) async {
        calledPath = request.url.path;
        sentBody = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          '{"registration_token":"sealed-grant","expires_at":"2099-01-01T00:00:00Z","next_action":"verify_email"}',
          202,
        );
      });
      addTearDown(container.dispose);
      await container.read(authControllerProvider.future);

      await container
          .read(authControllerProvider.notifier)
          .register(
            name: 'Sara',
            email: 'sara@example.com',
            password: 'supersecret1',
            phone: '+970599123456',
          );

      expect(calledPath, endsWith('/auth/mobile/register/start'));
      expect(sentBody?['email'], 'sara@example.com');
      expect(sentBody?['name'], 'Sara');
      expect(
        container.read(authControllerProvider).value?.status,
        isNot(AuthStatus.authenticated),
      );
      expect(container.read(authControllerProvider).hasError, isFalse);
      expect(await container.read(tokenStorageProvider).readBundle(), isNull);
    },
  );

  test('a rejected register settles out of the authenticating state', () async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final container = _container(
      (request) async => http.Response('{"error":"email_taken"}', 409),
    );
    addTearDown(container.dispose);
    await container.read(authControllerProvider.future);

    await container
        .read(authControllerProvider.notifier)
        .register(
          name: 'Sara',
          email: 'taken@example.com',
          password: 'supersecret1',
          phone: '+970599123456',
        );

    final state = container.read(authControllerProvider);
    expect(state.hasError, isTrue);
    // A retained `authenticating` value would leave every screen watching this
    // provider stuck on a disabled spinner.
    expect(state.value?.status, isNot(AuthStatus.authenticating));

    container.read(authControllerProvider.notifier).clearError();
    final cleared = container.read(authControllerProvider);
    expect(cleared.hasError, isFalse);
    expect(cleared.value?.status, AuthStatus.unauthenticated);
  });

  test(
    'loginWithGoogle posts the id token to the mobile Google endpoint',
    () async {
      FlutterSecureStorage.setMockInitialValues(<String, String>{});
      String? calledPath;
      Map<String, dynamic>? sentBody;
      final container = _container((request) async {
        calledPath = request.url.path;
        sentBody = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(_authBody('passenger'), 200);
      });
      addTearDown(container.dispose);
      await container.read(authControllerProvider.future);

      await container
          .read(authControllerProvider.notifier)
          .loginWithGoogle(idToken: 'google-id-token');

      expect(calledPath, endsWith('/auth/mobile/google'));
      expect(sentBody?['id_token'], 'google-id-token');
      expect(
        container.read(authControllerProvider).value?.status,
        AuthStatus.authenticated,
      );
    },
  );

  test('corrupt stored bundle clears safely and routes to login', () async {
    FlutterSecureStorage.setMockInitialValues({
      TokenStorage.bundleKey:
          '{"version":1,"access_token":"partial","refresh_token_expires_at":"not-a-time"}',
      TokenStorage.tokenKey: 'legacy-value',
    });
    final container = _container((request) async => http.Response('{}', 500));
    addTearDown(container.dispose);

    final state = await container.read(authControllerProvider.future);

    expect(state.status, AuthStatus.unauthenticated);
    expect(await container.read(tokenStorageProvider).readBundle(), isNull);
  });

  test(
    'temporary network failure preserves token and shows retry state',
    () async {
      FlutterSecureStorage.setMockInitialValues({
        TokenStorage.tokenKey: 'possibly-valid',
      });
      final container = _container(
        (request) async => throw http.ClientException('offline'),
      );
      addTearDown(container.dispose);

      final state = await container.read(authControllerProvider.future);
      final token = await container.read(tokenStorageProvider).readToken();

      expect(state.status, AuthStatus.restoreFailed);
      expect(token, 'possibly-valid');
    },
  );

  test('logout removes token', () async {
    FlutterSecureStorage.setMockInitialValues({
      TokenStorage.tokenKey: 'saved-token',
    });
    final container = _container((request) async {
      return http.Response(
        '{"user":{"id":"user_1","name":"Demo Passenger","phone":"+970590000001","role":"passenger","demo_account":true}}',
        200,
      );
    });
    addTearDown(container.dispose);

    await container.read(authControllerProvider.future);
    await container.read(authControllerProvider.notifier).logout();
    final token = await container.read(tokenStorageProvider).readToken();

    expect(token, isNull);
    expect(
      container.read(authControllerProvider).value?.status,
      AuthStatus.unauthenticated,
    );
  });

  // The trip history is not autoDispose, so without an explicit invalidation on
  // logout the next account would be served the previous passenger's trips
  // straight from the cache, as settled data, with no request going out.
  //
  // Riverpod keeps the stale value readable while the invalidated provider
  // reloads, so the assertion is on `isLoading`: that is what marks the cached
  // trips as no longer current. Drop the invalidation and this stays false.
  test('logout invalidates the passenger trip history', () async {
    FlutterSecureStorage.setMockInitialValues({
      TokenStorage.tokenKey: 'saved-token',
    });
    final container = _container((request) async {
      if (request.url.path.endsWith('/passenger/requests')) {
        return http.Response(
          '{"requests":[{"id":"request_1","pickup_label":"PPU Main Gate",'
          '"pickup_lat":31.5326,"pickup_lng":35.0998,'
          '"destination_label":"Bethlehem Center","destination_lat":31.7054,'
          '"destination_lng":35.2024,'
          '"preferred_time":"2026-07-17T09:00:00.000Z","passenger_count":1,'
          '"status":"completed","created_at":"2026-07-17T08:00:00.000Z"}]}',
          200,
        );
      }
      if (request.url.path.endsWith('/trips')) {
        return http.Response('{"trips":[]}', 200);
      }
      return http.Response(
        '{"user":{"id":"user_1","name":"Demo Passenger","phone":"+970590000001","role":"passenger","demo_account":true}}',
        200,
      );
    });
    addTearDown(container.dispose);

    await container.read(authControllerProvider.future);
    final loaded = await container.read(passengerHistoryProvider.future);
    expect(loaded.past, hasLength(1));
    expect(container.read(passengerHistoryProvider).isLoading, isFalse);

    await container.read(authControllerProvider.notifier).logout();

    expect(
      container.read(passengerHistoryProvider).isLoading,
      isTrue,
      reason: 'the previous account\'s trips must not survive as settled data',
    );
  });

  test('logout invalidates the actor-private driver trust score', () async {
    FlutterSecureStorage.setMockInitialValues({
      TokenStorage.tokenKey: 'saved-token',
    });
    final container = _container((request) async {
      return http.Response(
        '{"user":{"id":"driver_1","name":"Driver One","phone":"+970590000002","role":"driver","demo_account":true},'
        '"driver_profile":{"trust_score":86}}',
        200,
      );
    });
    addTearDown(container.dispose);

    await container.read(authControllerProvider.future);
    expect(
      await container.read(driverTrustScoreProvider('driver_1').future),
      86,
    );
    expect(
      container.read(driverTrustScoreProvider('driver_1')).isLoading,
      isFalse,
    );

    await container.read(authControllerProvider.notifier).logout();

    expect(
      container.read(driverTrustScoreProvider('driver_1')).isLoading,
      isTrue,
      reason: 'another driver must not inherit the previous actor\'s score',
    );
  });

  for (final termination in _ActorTermination.values) {
    for (final delayedFailure in [false, true]) {
      test(
        '${termination.name} fences a delayed actor-A trust '
        '${delayedFailure ? 'error' : 'value'} after actor B authenticates',
        () async {
          FlutterSecureStorage.setMockInitialValues({
            TokenStorage.tokenKey: 'actor-a-token',
          });
          final delayedA = Completer<http.Response>();
          final actorARequestStarted = Completer<void>();
          var actorARestoreServed = false;
          final container = _container((request) async {
            if (request.url.path.endsWith('/auth/mobile/login')) {
              return http.Response(
                _loginBody('driver_b', 'actor-b-token'),
                200,
              );
            }
            if (request.url.path.endsWith('/auth/logout') ||
                request.url.path.endsWith('/auth/logout-all')) {
              return http.Response('{"ok":true}', 200);
            }
            if (request.url.path.endsWith('/me')) {
              final token = request.headers['authorization'];
              if (token == 'Bearer actor-b-token') {
                return http.Response(_driverBody('driver_b', 22), 200);
              }
              if (token == 'Bearer actor-a-token') {
                if (!actorARestoreServed) {
                  actorARestoreServed = true;
                  return http.Response(_driverBody('driver_a', null), 200);
                }
                if (!actorARequestStarted.isCompleted) {
                  actorARequestStarted.complete();
                }
                return delayedA.future;
              }
            }
            return http.Response('{"error":"not_found"}', 404);
          });
          addTearDown(container.dispose);

          final restored = await container.read(authControllerProvider.future);
          expect(restored.user?.id, 'driver_a');
          final unresolved = CanonicalOperationBundle.create(
            operation: 'driver_availability_create',
            scope: 'driver',
            actorId: 'driver_a',
            payload: const {'route_version_id': 'route-version-a'},
          );
          await container
              .read(canonicalOperationStorageProvider)
              .save(unresolved);

          final actorAValues = <int?>[];
          final actorAErrors = <Object>[];
          final actorASubscription = container.listen(
            driverTrustScoreProvider('driver_a'),
            (_, next) {
              if (next case AsyncData(:final value)) actorAValues.add(value);
              if (next case AsyncError(:final error)) actorAErrors.add(error);
            },
            fireImmediately: true,
          );
          addTearDown(actorASubscription.close);
          await actorARequestStarted.future;
          await _terminate(container, termination);
          await container
              .read(authControllerProvider.notifier)
              .login(
                email: 'passenger@example.com',
                password: 'password-value',
              );

          expect(
            container.read(authenticatedActorBindingProvider).actorId,
            'driver_b',
          );
          expect(
            await container.read(driverTrustScoreProvider('driver_b').future),
            22,
          );

          delayedA.complete(
            delayedFailure
                ? http.Response('{"error":"temporary"}', 503)
                : http.Response(_driverBody('driver_a', 86), 200),
          );
          await Future<void>.delayed(Duration.zero);
          await Future<void>.delayed(Duration.zero);
          expect(actorAValues, isNot(contains(86)));
          expect(actorAErrors, isEmpty);
          expect(
            container.read(driverTrustScoreProvider('driver_b')).value,
            22,
          );
          expect(
            await container.read(canonicalOperationStorageProvider).read(),
            isNotNull,
            reason: 'authentication teardown preserves unresolved work',
          );
        },
      );
    }
  }
}

enum _ActorTermination { logout, logoutAll, terminalSession }

Future<void> _terminate(
  ProviderContainer container,
  _ActorTermination termination,
) => switch (termination) {
  _ActorTermination.logout =>
    container.read(authControllerProvider.notifier).logout(),
  _ActorTermination.logoutAll =>
    container.read(authControllerProvider.notifier).logoutAll(),
  _ActorTermination.terminalSession =>
    container
        .read(authControllerProvider.notifier)
        .completeCurrentSessionRevocation(),
};

String _authBody(String role) =>
    '{"token":"access-$role","access_token":"access-$role",'
    '"access_token_expires_in":900,"refresh_token":"refresh-$role",'
    '"refresh_token_expires_in":3600,'
    '"session":{"id":"session_1","client_type":"mobile",'
    '"device_name":"test","created_at":"2026-07-17T10:00:00.000Z",'
    '"last_used_at":"2026-07-17T10:00:00.000Z",'
    '"expires_at":"2099-07-17T11:00:00.000Z","is_current":true,'
    '"revoked":false},"user":{"id":"user_1","name":"Sara",'
    '"email":"sara@example.com","role":"$role","demo_account":false}}';

String _driverBody(String id, int? score) =>
    '{"user":{"id":"$id","name":"Driver","phone":"+970590000002",'
    '"role":"driver","demo_account":true},'
    '"driver_profile":${score == null ? 'null' : '{"trust_score":$score}'}}';

String _loginBody(String id, String token) =>
    '{"token":"$token","access_token":"$token",'
    '"access_token_expires_in":3600,"refresh_token":"refresh-$id",'
    '"refresh_token_expires_in":7200,'
    '"session":{"id":"session-$id","client_type":"mobile",'
    '"device_name":"test","created_at":"2026-08-06T00:00:00.000Z",'
    '"last_used_at":"2026-08-06T00:00:00.000Z",'
    '"expires_at":"2099-08-06T00:00:00.000Z","is_current":true,'
    '"revoked":false},"user":{"id":"$id","name":"Driver",'
    '"phone":"+970590000009","role":"driver","demo_account":true}}';

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
