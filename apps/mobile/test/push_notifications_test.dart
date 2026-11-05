import 'dart:async';

import 'package:darb_mobile/core/api/api_client.dart';
import 'package:darb_mobile/core/config/app_config.dart';
import 'package:darb_mobile/features/auth/application/auth_controller.dart';
import 'package:darb_mobile/features/auth/data/token_storage.dart';
import 'package:darb_mobile/features/auth/domain/auth_models.dart';
import 'package:darb_mobile/features/driver_renewal/presentation/driver_renewal_banner.dart';
import 'package:darb_mobile/features/push/application/push_controller.dart';
import 'package:darb_mobile/features/push/application/push_tap_target.dart';
import 'package:darb_mobile/features/push/data/push_messaging.dart';
import 'package:darb_mobile/features/push/data/push_repository.dart';
import 'package:darb_mobile/features/push/presentation/push_settings_tile.dart';
import 'package:darb_mobile/features/push/push_config.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_app_config.dart';

AuthUser _user(String id, UserRole role) =>
    AuthUser(id: id, name: 'Test', role: role, demoAccount: true);

class _FakeAuth extends AuthController {
  _FakeAuth(this.initial);

  final AuthUser? initial;

  @override
  Future<AuthState> build() async {
    final user = initial;
    return user == null
        ? const AuthState.unauthenticated()
        : AuthState.authenticated(user);
  }

  void signIn(AuthUser user) =>
      state = AsyncData(AuthState.authenticated(user));
}

class _FakeMessaging implements PushMessaging {
  bool initializes = true;
  PushPermission permission = PushPermission.granted;
  PushPermission afterRequest = PushPermission.granted;
  int initializeCalls = 0;
  int permissionRequests = 0;
  String? currentToken = 'token-1';
  Map<String, String>? launchData;
  final tokenRefresh = StreamController<String>.broadcast();
  final opened = StreamController<Map<String, String>>.broadcast();
  final foreground = StreamController<Map<String, String>>.broadcast();

  @override
  String get platform => 'android';

  @override
  Future<bool> initialize() async {
    initializeCalls += 1;
    return initializes;
  }

  @override
  Future<PushPermission> permissionStatus() async => permission;

  @override
  Future<PushPermission> requestPermission() async {
    permissionRequests += 1;
    permission = afterRequest;
    return permission;
  }

  @override
  Future<String?> token() async => currentToken;

  @override
  Stream<String> get onTokenRefresh => tokenRefresh.stream;

  @override
  Stream<Map<String, String>> get onOpened => opened.stream;

  @override
  Stream<Map<String, String>> get onForegroundMessage => foreground.stream;

  @override
  Future<Map<String, String>?> initialOpened() async => launchData;
}

class _FakePushRepository implements PushRepository {
  final List<Map<String, String?>> registered = [];
  final List<String> unregistered = [];
  final List<bool> preferenceChanges = [];
  bool enabled = true;

  @override
  // The real client is never touched by this fake.
  get apiClient => throw UnimplementedError();

  @override
  Future<void> register({
    required String token,
    required String platform,
    String? locale,
    String? appVersion,
  }) async {
    registered.add({'token': token, 'platform': platform, 'locale': locale});
  }

  @override
  Future<void> unregister(String token) async => unregistered.add(token);

  @override
  Future<PushPreference> preference() async =>
      PushPreference(enabled: enabled, available: true);

  @override
  Future<PushPreference> setEnabled(bool value) async {
    preferenceChanges.add(value);
    enabled = value;
    return PushPreference(enabled: value, available: true);
  }
}

typedef _Navigation = ({String location, bool push});

class _Harness {
  _Harness({
    required this.container,
    required this.repository,
    required this.navigations,
  });

  final ProviderContainer container;
  final _FakePushRepository repository;
  final List<_Navigation> navigations;

  PushController get controller =>
      container.read(pushControllerProvider.notifier);
  PushState get state => container.read(pushControllerProvider);
  _FakeAuth get auth =>
      container.read(authControllerProvider.notifier) as _FakeAuth;

  Future<void> start() async {
    await container.read(authControllerProvider.future);
    container.listen(pushControllerProvider, (_, _) {});
    await settle();
  }
}

Future<void> settle() async {
  for (var i = 0; i < 20; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

_Harness _harness({
  PushMessaging? messaging,
  AuthUser? user,
  bool buildEnabled = true,
}) {
  final repository = _FakePushRepository();
  final navigations = <_Navigation>[];
  final container = ProviderContainer(
    overrides: [
      authControllerProvider.overrideWith(() => _FakeAuth(user)),
      pushRepositoryProvider.overrideWithValue(repository),
      pushNavigatorProvider.overrideWithValue(
        (location, {required push}) =>
            navigations.add((location: location, push: push)),
      ),
      if (buildEnabled)
        pushMessagingProvider.overrideWithValue(messaging)
      else
        pushBuildConfigProvider.overrideWithValue(PushBuildConfig.disabled),
    ],
  );
  addTearDown(container.dispose);
  return _Harness(
    container: container,
    repository: repository,
    navigations: navigations,
  );
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('push disabled (default build)', () {
    test('the default build config is off and creates no messaging', () {
      expect(PushBuildConfig.fromEnvironment().enabled, isFalse);
      final h = _harness(
        buildEnabled: false,
        user: _user('p1', UserRole.passenger),
      );
      expect(h.container.read(pushMessagingProvider), isNull);
    });

    test(
      'does nothing: no registration, no prompt, logout is a no-op',
      () async {
        final h = _harness(
          buildEnabled: false,
          user: _user('p1', UserRole.passenger),
        );
        await h.start();
        expect(h.state.available, isFalse);
        await h.controller.promptAfterSignIn();
        await h.controller.unregisterBeforeSignOut();
        expect(h.repository.registered, isEmpty);
        expect(h.repository.unregistered, isEmpty);
      },
    );

    test('a build whose Firebase cannot start stays off', () async {
      final messaging = _FakeMessaging()..initializes = false;
      final h = _harness(
        messaging: messaging,
        user: _user('p1', UserRole.passenger),
      );
      await h.start();
      expect(messaging.initializeCalls, 1);
      expect(h.state.available, isFalse);
      expect(h.repository.registered, isEmpty);
    });

    testWidgets('the settings toggle renders nothing', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            pushBuildConfigProvider.overrideWithValue(PushBuildConfig.disabled),
          ],
          child: const MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(
              body: Column(
                children: [PushSettingsTile(), PushSettingsTile.passenger()],
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(
        find.byKey(const ValueKey('pushNotificationsToggle')),
        findsNothing,
      );
    });
  });

  group('push enabled', () {
    test(
      'registers the token with platform and language when allowed',
      () async {
        final messaging = _FakeMessaging();
        final h = _harness(
          messaging: messaging,
          user: _user('p1', UserRole.passenger),
        );
        await h.start();

        expect(h.state.available, isTrue);
        expect(h.state.registered, isTrue);
        expect(h.repository.registered, [
          {'token': 'token-1', 'platform': 'android', 'locale': 'ar'},
        ]);

        // A rotated token is registered again.
        messaging.tokenRefresh.add('token-2');
        await settle();
        expect(h.repository.registered.last['token'], 'token-2');
      },
    );

    test('unregisters the registered token before sign-out', () async {
      final h = _harness(
        messaging: _FakeMessaging(),
        user: _user('d1', UserRole.driver),
      );
      await h.start();
      await h.controller.unregisterBeforeSignOut();
      expect(h.repository.unregistered, ['token-1']);
      expect(h.state.registered, isFalse);

      // Nothing left to unregister the second time.
      await h.controller.unregisterBeforeSignOut();
      expect(h.repository.unregistered, ['token-1']);
    });

    test(
      'waits for permission, then asks once per install after sign-in',
      () async {
        final messaging = _FakeMessaging()
          ..permission = PushPermission.notDetermined;
        final h = _harness(
          messaging: messaging,
          user: _user('p1', UserRole.passenger),
        );
        await h.start();
        expect(h.repository.registered, isEmpty);
        expect(messaging.permissionRequests, 0);

        await h.controller.promptAfterSignIn();
        expect(messaging.permissionRequests, 1);
        expect(h.repository.registered, hasLength(1));

        messaging.permission = PushPermission.denied;
        await h.controller.promptAfterSignIn();
        expect(messaging.permissionRequests, 1);
      },
    );

    test('does not register before anyone signs in', () async {
      final h = _harness(messaging: _FakeMessaging());
      await h.start();
      expect(h.state.available, isTrue);
      expect(h.repository.registered, isEmpty);

      h.auth.signIn(_user('m1', UserRole.merchant));
      await settle();
      expect(h.repository.registered, hasLength(1));
    });
  });

  group('tapping a push', () {
    test('opens the same places as the inbox', () {
      expect(pushTapTarget(_role('passenger'), {'type': 'trip_status'}), (
        location: '/passenger/notifications',
        push: false,
      ));
      expect(pushTapTarget(_role('merchant'), {'type': 'trip_status'}), (
        location: '/merchant/notifications',
        push: false,
      ));
      expect(
        pushTapTarget(_role('driver'), {'type': 'driver_documents_expiring'}),
        (location: driverRenewalPath, push: true),
      );
      expect(pushTapTarget(_role('driver'), {'type': 'match_offered'}), (
        location: '/driver/matches',
        push: false,
      ));
      expect(
        pushTapTarget(_role('driver'), {
          'type': 'driver_verification_approved',
        }),
        (location: driverNotificationsPath, push: true),
      );
      expect(pushTapTarget(UserRole.admin, const {}), isNull);
    });

    test('navigates when tapped while running', () async {
      final messaging = _FakeMessaging();
      final h = _harness(
        messaging: messaging,
        user: _user('d1', UserRole.driver),
      );
      await h.start();
      messaging.opened.add({
        'notification_id': 'n1',
        'type': 'driver_documents_expired',
      });
      await settle();
      expect(h.navigations, [(location: driverRenewalPath, push: true)]);
    });

    test(
      'a push that launched the app opens once the session is back',
      () async {
        final messaging = _FakeMessaging()
          ..launchData = {'notification_id': 'n1', 'type': 'match_accepted'};
        final h = _harness(messaging: messaging);
        await h.start();
        expect(h.navigations, isEmpty);

        h.auth.signIn(_user('p1', UserRole.passenger));
        await settle();
        expect(h.navigations, [
          (location: '/passenger/notifications', push: false),
        ]);
      },
    );
  });

  test('logout unregisters the phone before the session is revoked', () async {
    FlutterSecureStorage.setMockInitialValues({
      TokenStorage.tokenKey: 'saved-token',
    });
    final requests = <String>[];
    final container = ProviderContainer(
      overrides: [
        appConfigProvider.overrideWithValue(demoTestAppConfig),
        pushMessagingProvider.overrideWithValue(_FakeMessaging()),
        httpClientProvider.overrideWithValue(
          MockClient((request) async {
            requests.add('${request.method} ${request.url.path}');
            if (request.url.path.endsWith('/me')) {
              return http.Response(
                '{"user":{"id":"user_1","name":"Demo Passenger","phone":"+970590000001","role":"passenger","demo_account":true}}',
                200,
              );
            }
            return http.Response('{"ok":true}', 200);
          }),
        ),
      ],
    );
    addTearDown(container.dispose);
    await container.read(authControllerProvider.future);
    container.listen(pushControllerProvider, (_, _) {});
    await settle();
    expect(requests, contains('PUT /api/v1/push/devices'));

    await container.read(authControllerProvider.notifier).logout();
    final unregister = requests.indexOf('POST /api/v1/push/devices/unregister');
    final logout = requests.indexOf('POST /api/v1/auth/logout');
    expect(unregister, isNonNegative);
    expect(unregister, lessThan(logout));
  });

  testWidgets('the settings toggle stores the choice on the server', (
    tester,
  ) async {
    final messaging = _FakeMessaging();
    final repository = _FakePushRepository();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(
            () => _FakeAuth(_user('p1', UserRole.passenger)),
          ),
          pushRepositoryProvider.overrideWithValue(repository),
          pushMessagingProvider.overrideWithValue(messaging),
        ],
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          locale: Locale('en'),
          home: Scaffold(body: PushSettingsTile()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final toggle = find.byKey(const ValueKey('pushNotificationsToggle'));
    expect(toggle, findsOneWidget);
    expect(tester.widget<SwitchListTile>(toggle).value, isTrue);

    await tester.tap(toggle);
    await tester.pumpAndSettle();
    expect(repository.preferenceChanges, [false]);
    expect(tester.widget<SwitchListTile>(toggle).value, isFalse);
  });
}

UserRole _role(String name) =>
    UserRole.values.firstWhere((role) => role.name == name);
