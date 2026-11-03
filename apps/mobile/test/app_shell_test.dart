import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:darb_mobile/app.dart';
import 'package:darb_mobile/core/api/api_client.dart';
import 'package:darb_mobile/core/config/app_config.dart';
import 'package:darb_mobile/core/i18n/domain_labels.dart';
import 'package:darb_mobile/core/routing/app_router.dart';
import 'package:darb_mobile/features/auth/application/auth_controller.dart';
import 'package:darb_mobile/features/auth/data/token_storage.dart';
import 'package:darb_mobile/features/auth/domain/auth_models.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_app_config.dart';

void main() {
  // Google sign-up has its own role onboarding (google_onboarding_widget_test).
  for (final method in ['email']) {
    testWidgets(
      '$method registration requires displayed consent before session creation',
      (tester) async {
        final completions = <Map<String, dynamic>>[];
        final starts = <Map<String, dynamic>>[];
        final documents = ['terms', 'privacy', 'adult_self_attestation']
            .map(
              (type) => {
                'id': type,
                'type': type,
                'locale': 'en',
                'version': 'v1',
                'content': 'Required document: $type',
                'content_hash': List.filled(64, 'a').join(),
              },
            )
            .toList();
        await _pumpApp(
          tester,
          localeValues: {DomainLabels.localeStorageKey: 'en'},
          handler: (request) async {
            if (request.url.path.endsWith('/auth/consents')) {
              expect(request.url.queryParameters['locale'], 'en');
              return http.Response(jsonEncode({'documents': documents}), 200);
            }
            if (request.url.path.endsWith('/register/start') ||
                request.url.path.endsWith('/mobile/google')) {
              starts.add(jsonDecode(request.body) as Map<String, dynamic>);
              return http.Response(
                jsonEncode({
                  'registration_token': 'sealed-grant',
                  'expires_at': '2099-01-01T00:00:00Z',
                  'next_action': method == 'email'
                      ? 'verify_email'
                      : 'consent_required',
                }),
                202,
              );
            }
            if (request.url.path.endsWith('/register/complete') ||
                request.url.path.endsWith('/complete-registration')) {
              completions.add(jsonDecode(request.body) as Map<String, dynamic>);
              return http.Response(
                '{"token":"new-darb-session","user":{"id":"new","name":"Passenger","phone":null,"profile_state":"phone_required","role":"passenger","demo_account":false}}',
                201,
              );
            }
            return http.Response('{"error":"not_found"}', 404);
          },
        );
        final container = ProviderScope.containerOf(
          tester.element(find.byType(DarbApp)),
        );
        final controller = container.read(authControllerProvider.notifier);
        if (method == 'email') {
          await controller.register(
            name: 'Passenger',
            email: 'passenger@example.com',
            password: 'long-valid-password',
            phone: '+970599123456',
            locale: 'en',
          );
        } else {
          await controller.loginWithGoogle(idToken: 'ephemeral-google-token');
        }
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('registrationCompletionScreen')),
          findsOneWidget,
        );
        expect(await container.read(tokenStorageProvider).readBundle(), isNull);
        expect(
          tester
              .widget<FilledButton>(find.byKey(const ValueKey('completeAuth')))
              .onPressed,
          isNull,
        );
        if (method == 'email') {
          await tester.enterText(
            find.byKey(const ValueKey('authProof')),
            '123456',
          );
          await tester.testTextInput.receiveAction(TextInputAction.done);
          await tester.pumpAndSettle();
          expect(completions, isEmpty);
        } else {
          await tester.enterText(find.byType(TextField).first, 'Passenger');
        }
        for (var i = 0; i < 3; i++) {
          await tester.ensureVisible(find.byType(CheckboxListTile).at(i));
          await tester.tap(find.byType(CheckboxListTile).at(i));
          await tester.pump();
        }
        await tester.ensureVisible(find.byKey(const ValueKey('completeAuth')));
        await tester.tap(find.byKey(const ValueKey('completeAuth')));
        await tester.pumpAndSettle();
        expect(completions.single, {
          'registration_token': 'sealed-grant',
          'locale': 'en',
          'adult_self_attestation': true,
          'device_name': 'Darb App',
          'consents': documents
              .map(
                (d) => {
                  'id': d['id'],
                  'type': d['type'],
                  'content_hash': d['content_hash'],
                },
              )
              .toList(),
          if (method == 'email')
            'email_verification_code': '123456'
          else
            'name': 'Passenger',
        });
        // The phone typed on the sign-up form travels with the registration, so
        // no separate phone screen follows.
        expect(starts.single['phone'], '+970599123456');
        expect(
          find.byKey(const ValueKey('registrationCompletionScreen')),
          findsNothing,
        );
        expect(
          (await container.read(tokenStorageProvider).readBundle())
              ?.accessToken,
          'new-darb-session',
        );
      },
    );
  }
  testWidgets('login offers recovery but no email verification link', (
    tester,
  ) async {
    await _pumpApp(tester, localeValues: {DomainLabels.localeStorageKey: 'en'});
    expect(find.byKey(const ValueKey('passwordRecovery')), findsOneWidget);
    expect(find.byKey(const ValueKey('emailVerification')), findsNothing);
    await tester.ensureVisible(find.byKey(const ValueKey('passwordRecovery')));
    await tester.tap(find.byKey(const ValueKey('passwordRecovery')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('recoveryEmail')), findsOneWidget);
    expect(
      Directionality.of(
        tester.element(find.byKey(const ValueKey('recoveryEmail'))),
      ),
      TextDirection.ltr,
    );
  });

  test('Android excludes secure authentication storage from backup', () {
    final manifest = File(
      'android/app/src/main/AndroidManifest.xml',
    ).readAsStringSync();
    expect(manifest, contains('android:allowBackup="false"'));
  });

  test('AppConfig validates explicit production values', () {
    final config = AppConfig.fromValues(
      appEnvironment: 'production',
      apiBaseUrl: 'https://api.darb.example',
      enableDemoFeatures: false,
    );
    expect(config.apiBaseUrl, 'https://api.darb.example');
    expect(config.demoFeaturesEnabled, isFalse);
  });

  test('AppConfig rejects missing or insecure production values', () {
    expect(
      () => AppConfig.fromValues(
        appEnvironment: 'production',
        apiBaseUrl: '',
        enableDemoFeatures: false,
      ),
      throwsStateError,
    );
    expect(
      () => AppConfig.fromValues(
        appEnvironment: 'staging',
        apiBaseUrl: 'http://api.darb.example',
        enableDemoFeatures: false,
      ),
      throwsStateError,
    );
  });

  test('routeForRole maps admin safely', () {
    expect(routeForRole(UserRole.passenger), '/passenger');
    expect(routeForRole(UserRole.driver), '/driver');
    expect(routeForRole(UserRole.merchant), '/merchant');
    expect(routeForRole(UserRole.admin), '/unsupported-role');
  });

  test('refreshing preserves the authenticated routing projection', () {
    const user = AuthUser(
      id: 'user_1',
      name: 'Passenger',
      phone: '+970590000001',
      role: UserRole.passenger,
      demoAccount: false,
    );

    expect(
      authRoutingSnapshotFor(const AsyncData(AuthState.refreshing(user))),
      authRoutingSnapshotFor(const AsyncData(AuthState.authenticated(user))),
    );
  });

  testWidgets('Arabic login screen defaults to RTL', (tester) async {
    await _pumpApp(tester);

    expect(find.text('أهلاً بعودتك'), findsOneWidget);
    expect(find.text('تسجيل الدخول'), findsWidgets);
    expect(
      Directionality.of(tester.element(find.text('أهلاً بعودتك'))),
      TextDirection.rtl,
    );
    expect(find.textContaining('counter', findRichText: true), findsNothing);
  });

  testWidgets('English switch uses LTR and persists', (tester) async {
    await _pumpApp(tester);

    await tester.tap(find.byTooltip('English'));
    await tester.pumpAndSettle();

    expect(find.text('Welcome Back'), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.text('Welcome Back'))),
      TextDirection.ltr,
    );
    final preferences = await SharedPreferences.getInstance();
    expect(preferences.getString(DomainLabels.localeStorageKey), 'en');
  });

  testWidgets('saved English is restored', (tester) async {
    await _pumpApp(tester, localeValues: {DomainLabels.localeStorageKey: 'en'});

    expect(find.text('Login'), findsWidgets);
    expect(
      Directionality.of(tester.element(find.text('Welcome Back'))),
      TextDirection.ltr,
    );
  });

  testWidgets('loading disables login button', (tester) async {
    final response = Completer<http.Response>();
    await _pumpApp(tester, handler: (request) => response.future);

    await _fillLogin(tester);
    await tester.ensureVisible(find.byKey(const ValueKey('loginButton')));
    await tester.tap(find.byKey(const ValueKey('loginButton')));
    await tester.pump();
    await tester.drag(find.byType(ListView), const Offset(0, 500));
    await tester.pump();

    final button = tester.widget<FilledButton>(
      find.byKey(const ValueKey('loginButton')),
    );
    expect(button.onPressed, isNull);
    response.complete(http.Response(_loginBody('passenger'), 200));
    await tester.pumpAndSettle();
  });

  testWidgets('invalid credentials display translated error', (tester) async {
    await _pumpApp(
      tester,
      handler: (request) async =>
          http.Response('{"error":"invalid_credentials"}', 401),
    );

    await _fillLogin(tester);
    await tester.ensureVisible(find.byKey(const ValueKey('loginButton')));
    await tester.tap(find.byKey(const ValueKey('loginButton')));
    await tester.pump(const Duration(milliseconds: 100));

    expect(
      find.text('البريد الإلكتروني أو كلمة المرور غير صحيحة.'),
      findsOneWidget,
    );
  });

  testWidgets('a failed login leaves the button usable again', (tester) async {
    await _pumpApp(
      tester,
      handler: (request) async =>
          http.Response('{"error":"invalid_credentials"}', 401),
    );

    await _fillLogin(tester);
    await tester.ensureVisible(find.byKey(const ValueKey('loginButton')));
    await tester.tap(find.byKey(const ValueKey('loginButton')));
    await tester.pumpAndSettle();

    expect(
      find.text('البريد الإلكتروني أو كلمة المرور غير صحيحة.'),
      findsOneWidget,
    );
    final button = tester.widget<FilledButton>(
      find.byKey(const ValueKey('loginButton')),
    );
    expect(
      button.onPressed,
      isNotNull,
      reason: 'the button must not stay disabled after the error is shown',
    );
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('loginButton')),
        matching: find.byType(CircularProgressIndicator),
      ),
      findsNothing,
    );
  });

  testWidgets(
    'editing credentials while login is pending discards that attempt error',
    (tester) async {
      final response = Completer<http.Response>();
      var attempts = 0;
      await _pumpApp(
        tester,
        handler: (request) async {
          if (attempts++ == 0) return response.future;
          return http.Response('{"error":"invalid_credentials"}', 401);
        },
      );
      await _fillLogin(tester);
      await tester.ensureVisible(find.byKey(const ValueKey('loginButton')));
      await tester.tap(find.byKey(const ValueKey('loginButton')));
      await tester.pump();
      await tester.enterText(
        find.byKey(const ValueKey('emailField')),
        'edited@example.invalid',
      );
      response.complete(http.Response('{"error":"invalid_credentials"}', 401));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('loginError')), findsNothing);
      await tester.enterText(
        find.byKey(const ValueKey('emailField')),
        'retry@example.invalid',
      );
      await tester.enterText(
        find.byKey(const ValueKey('passwordField')),
        'fixture-password',
      );
      await tester.ensureVisible(find.byKey(const ValueKey('loginButton')));
      await tester.tap(find.byKey(const ValueKey('loginButton')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('loginError')), findsOneWidget);
    },
  );

  testWidgets('passenger reaches passenger home', (tester) async {
    await _pumpApp(
      tester,
      secureValues: {TokenStorage.tokenKey: 'token'},
      handler: _passengerHandler,
    );

    expect(find.byKey(const ValueKey('passengerHome')), findsOneWidget);
    expect(
      find.byKey(const ValueKey('openPassengerAssistant')),
      findsOneWidget,
    );
  });

  testWidgets(
    'driver reaches driver home and cannot navigate to passenger home',
    (tester) async {
      await _pumpApp(
        tester,
        secureValues: {TokenStorage.tokenKey: 'token'},
        handler: _meHandler('driver'),
      );

      expect(find.textContaining('سائق'), findsWidgets);
      expect(find.textContaining('Demo Driver'), findsOneWidget);

      GoRouter.of(
        tester.element(find.textContaining('Demo Driver')),
      ).go('/passenger');
      await tester.pumpAndSettle();

      expect(find.textContaining('Demo Driver'), findsOneWidget);
      expect(find.text('مسافر'), findsNothing);
    },
  );

  testWidgets('merchant reaches merchant home', (tester) async {
    await _pumpApp(
      tester,
      secureValues: {TokenStorage.tokenKey: 'token'},
      handler: _meHandler('merchant'),
    );

    expect(find.byKey(const ValueKey('merchantHome')), findsOneWidget);
    expect(find.textContaining('Demo Merchant'), findsOneWidget);
  });

  testWidgets('passenger cannot navigate to merchant screens', (tester) async {
    await _pumpApp(
      tester,
      secureValues: {TokenStorage.tokenKey: 'token'},
      handler: _passengerHandler,
    );

    GoRouter.of(
      tester.element(find.byKey(const ValueKey('passengerHome'))),
    ).go('/merchant/order/new');
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('passengerHome')), findsOneWidget);
    // Asserted on the screen key, not its title: `createOrder` and the
    // passenger's own `createRequest` CTA are both "إنشاء طلب" in Arabic.
    expect(find.byKey(const ValueKey('merchantCreateOrder')), findsNothing);
  });

  testWidgets('driver cannot navigate to merchant screens', (tester) async {
    await _pumpApp(
      tester,
      secureValues: {TokenStorage.tokenKey: 'token'},
      handler: _meHandler('driver'),
    );

    GoRouter.of(
      tester.element(find.textContaining('Demo Driver')),
    ).go('/merchant/matches');
    await tester.pumpAndSettle();

    expect(find.textContaining('Demo Driver'), findsOneWidget);
    expect(find.text('صندوق مطابقات التاجر'), findsNothing);
  });

  testWidgets('admin reaches unsupported-role screen', (tester) async {
    await _pumpApp(
      tester,
      secureValues: {TokenStorage.tokenKey: 'token'},
      handler: _meHandler('admin'),
    );

    expect(
      find.text('لوحة تحكم المسؤول متاحة عبر تطبيق الويب.'),
      findsOneWidget,
    );

    GoRouter.of(
      tester.element(find.text('لوحة تحكم المسؤول متاحة عبر تطبيق الويب.')),
    ).go('/security/sessions');
    await tester.pumpAndSettle();
    expect(find.text('الأمان والجلسات'), findsNothing);
    expect(
      find.text('لوحة تحكم المسؤول متاحة عبر تطبيق الويب.'),
      findsOneWidget,
    );
  });

  testWidgets('logout returns to login and preserves selected locale', (
    tester,
  ) async {
    await _pumpApp(
      tester,
      localeValues: {DomainLabels.localeStorageKey: 'en'},
      secureValues: {TokenStorage.tokenKey: 'token'},
      handler: _passengerHandler,
    );

    expect(find.byKey(const ValueKey('passengerHome')), findsOneWidget);
    // Passenger logout lives on the Settings tab of the redesigned shell.
    await tester.tap(find.byKey(const ValueKey('roleNavigation-4')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const ValueKey('logoutButton')));
    await tester.tap(find.byKey(const ValueKey('logoutButton')));
    await tester.pumpAndSettle();
    expect(find.text('Confirm logout'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('confirmSecurityActionButton')));
    await tester.pumpAndSettle();

    expect(find.text('Login'), findsWidgets);
    expect(find.byTooltip('Arabic'), findsOneWidget);
  });

  testWidgets('shared session screen is Arabic RTL and hides sensitive IDs', (
    tester,
  ) async {
    await _pumpApp(
      tester,
      secureValues: {TokenStorage.tokenKey: 'token'},
      handler: _passengerHandler,
    );

    await tester.tap(find.byKey(const ValueKey('roleNavigation-4')));
    await tester.pumpAndSettle();
    // Devices and sessions sit one level below the Settings tab.
    await tester.tap(find.byKey(const ValueKey('settingsSessions')));
    await tester.pumpAndSettle();

    expect(find.text('الأمان والجلسات'), findsWidgets);
    expect(find.text('الجهاز الحالي'), findsOneWidget);
    expect(find.text('Darb Android'), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.text('الجلسات النشطة'))),
      TextDirection.rtl,
    );
    expect(find.textContaining('session_1'), findsNothing);
    expect(find.textContaining('token_hash'), findsNothing);
    expect(find.textContaining('refresh_token'), findsNothing);
  });

  testWidgets('shared session screen uses English LTR', (tester) async {
    await _pumpApp(
      tester,
      localeValues: {DomainLabels.localeStorageKey: 'en'},
      secureValues: {TokenStorage.tokenKey: 'token'},
      handler: _passengerHandler,
    );

    await tester.tap(find.byKey(const ValueKey('roleNavigation-4')));
    await tester.pumpAndSettle();
    // Devices and sessions sit one level below the Settings tab.
    await tester.tap(find.byKey(const ValueKey('settingsSessions')));
    await tester.pumpAndSettle();

    expect(find.text('Security and sessions'), findsWidgets);
    expect(
      Directionality.of(tester.element(find.text('Active sessions'))),
      TextDirection.ltr,
    );
  });

  testWidgets('revoking the current session returns immediately to login', (
    tester,
  ) async {
    await _pumpApp(
      tester,
      secureValues: {TokenStorage.tokenKey: 'token'},
      handler: _passengerHandler,
    );
    await tester.tap(find.byKey(const ValueKey('roleNavigation-4')));
    await tester.pumpAndSettle();
    // Devices and sessions sit one level below the Settings tab.
    await tester.tap(find.byKey(const ValueKey('settingsSessions')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('revokeCurrentSession')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.widgetWithText(FilledButton, 'إلغاء جلسة هذا الجهاز'),
    );
    await tester.pumpAndSettle();

    expect(find.text('تسجيل الدخول'), findsWidgets);
    expect(
      await const FlutterSecureStorage().read(key: TokenStorage.bundleKey),
      isNull,
    );
  });

  testWidgets('revoking another session refreshes the list and stays signed in', (
    tester,
  ) async {
    var listCalls = 0;
    var revokeCalls = 0;
    await _pumpApp(
      tester,
      secureValues: {TokenStorage.tokenKey: 'token'},
      handler: (request) async {
        final path = request.url.path;
        if (path.endsWith('/auth/sessions') && request.method == 'GET') {
          listCalls += 1;
          return http.Response(
            '{"sessions":[{"id":"session_1","client_type":"mobile","device_name":"Darb Android","created_at":"2026-07-17T10:00:00.000Z","last_used_at":"2026-07-17T10:05:00.000Z","expires_at":"2026-08-17T10:00:00.000Z","is_current":true,"revoked":false},{"id":"session_2","client_type":"mobile","device_name":"Other Android","created_at":"2026-07-16T10:00:00.000Z","last_used_at":"2026-07-16T10:05:00.000Z","expires_at":"2026-08-16T10:00:00.000Z","is_current":false,"revoked":false}]}',
            200,
          );
        }
        if (path.contains('/auth/sessions/') && request.method == 'DELETE') {
          revokeCalls += 1;
          return http.Response('{"ok":true}', 200);
        }
        return _passengerHandler(request);
      },
    );
    await tester.tap(find.byKey(const ValueKey('roleNavigation-4')));
    await tester.pumpAndSettle();
    // Devices and sessions sit one level below the Settings tab.
    await tester.tap(find.byKey(const ValueKey('settingsSessions')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('revokeSession')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'إلغاء الجلسة'));
    await tester.pumpAndSettle();

    expect(revokeCalls, 1);
    expect(listCalls, 2);
    expect(find.text('الأمان والجلسات'), findsWidgets);
  });

  testWidgets('logout-all success clears local state and returns to login', (
    tester,
  ) async {
    await _pumpApp(
      tester,
      secureValues: {TokenStorage.tokenKey: 'token'},
      handler: _passengerHandler,
    );
    await tester.tap(find.byKey(const ValueKey('roleNavigation-4')));
    await tester.pumpAndSettle();
    // Devices and sessions sit one level below the Settings tab.
    await tester.tap(find.byKey(const ValueKey('settingsSessions')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('logoutAllSessions')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('confirmSecurityActionButton')));
    await tester.pumpAndSettle();

    expect(find.text('تسجيل الدخول'), findsWidgets);
  });

  testWidgets('logout-all failure is reported and preserves the session', (
    tester,
  ) async {
    await _pumpApp(
      tester,
      secureValues: {TokenStorage.tokenKey: 'token'},
      handler: (request) async {
        if (request.url.path.endsWith('/auth/logout-all')) {
          throw http.ClientException('offline');
        }
        return _passengerHandler(request);
      },
    );
    await tester.tap(find.byKey(const ValueKey('roleNavigation-4')));
    await tester.pumpAndSettle();
    // Devices and sessions sit one level below the Settings tab.
    await tester.tap(find.byKey(const ValueKey('settingsSessions')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('logoutAllSessions')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('confirmSecurityActionButton')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('sessionActionError')), findsOneWidget);
    expect(find.text('الأمان والجلسات'), findsWidgets);
    expect(
      await const FlutterSecureStorage().read(key: TokenStorage.bundleKey),
      isNotNull,
    );
  });

  testWidgets('explicit local logout succeeds during a network outage', (
    tester,
  ) async {
    await _pumpApp(
      tester,
      secureValues: {TokenStorage.tokenKey: 'token'},
      handler: (request) async {
        if (request.url.path.endsWith('/auth/logout')) {
          throw http.ClientException('offline');
        }
        return _passengerHandler(request);
      },
    );

    // Passenger logout lives on the Settings tab of the redesigned shell.
    await tester.tap(find.byKey(const ValueKey('roleNavigation-4')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const ValueKey('logoutButton')));
    await tester.tap(find.byKey(const ValueKey('logoutButton')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('confirmSecurityActionButton')));
    await tester.pumpAndSettle();

    expect(find.text('تسجيل الدخول'), findsWidgets);
    expect(
      await const FlutterSecureStorage().read(key: TokenStorage.bundleKey),
      isNull,
    );
  });

  group('passenger settings', () {
    Future<void> openSettings(
      WidgetTester tester, {
      Future<http.Response> Function(http.Request request)? handler,
    }) async {
      await _pumpApp(
        tester,
        localeValues: {DomainLabels.localeStorageKey: 'en'},
        secureValues: {TokenStorage.tokenKey: 'token'},
        handler: handler ?? _passengerHandler,
      );
      await tester.tap(find.byKey(const ValueKey('roleNavigation-4')));
      await tester.pumpAndSettle();
    }

    Future<void> tapRow(WidgetTester tester, String key) async {
      final row = find.byKey(ValueKey(key));
      await tester.ensureVisible(row);
      await tester.pumpAndSettle();
      await tester.tap(row);
      await tester.pumpAndSettle();
    }

    Future<void> enter(WidgetTester tester, String key, String text) async {
      await tester.enterText(
        find.descendant(
          of: find.byKey(ValueKey(key)),
          matching: find.byType(TextField),
        ),
        text,
      );
      await tester.pump();
    }

    testWidgets('lists every entry with the signed-in name', (tester) async {
      await openSettings(tester);

      expect(find.byKey(const ValueKey('passengerSettings')), findsOneWidget);
      expect(find.text('Demo Passenger'), findsOneWidget);
      for (final key in [
        'settingsProfile',
        'settingsPassword',
        'settingsLanguage',
        'settingsRate',
        'settingsHelp',
        'logoutButton',
      ]) {
        await tester.ensureVisible(find.byKey(ValueKey(key)));
        expect(find.byKey(ValueKey(key)), findsOneWidget, reason: key);
      }
    });

    testWidgets('profile shows details and saves edits', (tester) async {
      Map<String, dynamic>? patched;
      await openSettings(
        tester,
        handler: (request) async {
          if (request.url.path.endsWith('/me') && request.method == 'PATCH') {
            patched = jsonDecode(request.body) as Map<String, dynamic>;
            return http.Response(
              '{"user":{"id":"user_1","name":"${patched!['name']}","phone":"+970590000001","email":"sara@example.com","city":"${patched!['city']}","role":"passenger","demo_account":true}}',
              200,
            );
          }
          return _passengerHandler(request);
        },
      );

      await tapRow(tester, 'settingsProfile');
      expect(find.text('Demo Passenger'), findsOneWidget);
      expect(find.text('+970590000001'), findsOneWidget);
      expect(find.text('Not added'), findsWidgets);

      await tester.tap(find.byKey(const ValueKey('profileEdit')));
      await tester.pumpAndSettle();
      await enter(tester, 'profileCity', 'Hebron');
      await tester.ensureVisible(find.byKey(const ValueKey('profileSave')));
      await tester.tap(find.byKey(const ValueKey('profileSave')));
      await tester.pumpAndSettle();

      expect(patched, {'name': 'Demo Passenger', 'city': 'Hebron'});
      expect(find.text('Hebron'), findsOneWidget);
      expect(find.byKey(const ValueKey('profileEdit')), findsOneWidget);
    });

    testWidgets('profile refuses an empty name', (tester) async {
      var patches = 0;
      await openSettings(
        tester,
        handler: (request) async {
          if (request.method == 'PATCH') patches += 1;
          return _passengerHandler(request);
        },
      );
      await tapRow(tester, 'settingsProfile');
      await tester.tap(find.byKey(const ValueKey('profileEdit')));
      await tester.pumpAndSettle();
      await enter(tester, 'profileName', '');
      await tester.ensureVisible(find.byKey(const ValueKey('profileSave')));
      await tester.tap(find.byKey(const ValueKey('profileSave')));
      await tester.pumpAndSettle();

      expect(find.text('Enter your name.'), findsOneWidget);
      expect(patches, 0);
    });

    testWidgets('change password validates before sending', (tester) async {
      var calls = 0;
      await openSettings(
        tester,
        handler: (request) async {
          if (request.url.path.endsWith('/auth/password/set')) calls += 1;
          return _passengerHandler(request);
        },
      );
      await tapRow(tester, 'settingsPassword');

      await enter(tester, 'passwordCurrent', 'old-password-123');
      await enter(tester, 'passwordNew', 'short');
      await enter(tester, 'passwordConfirm', 'different');
      await tester.tap(find.byKey(const ValueKey('passwordSubmit')));
      await tester.pumpAndSettle();

      expect(find.text('Use 12–72 characters.'), findsOneWidget);
      expect(find.text('Passwords do not match.'), findsOneWidget);
      expect(calls, 0);
    });

    testWidgets('change password signs the passenger out afterwards', (
      tester,
    ) async {
      Map<String, dynamic>? sent;
      await openSettings(
        tester,
        handler: (request) async {
          if (request.url.path.endsWith('/auth/password/set')) {
            sent = jsonDecode(request.body) as Map<String, dynamic>;
            return http.Response('{"ok":true}', 200);
          }
          return _passengerHandler(request);
        },
      );
      await tapRow(tester, 'settingsPassword');

      await enter(tester, 'passwordCurrent', 'old-password-123');
      await enter(tester, 'passwordNew', 'a-brand-new-password');
      await enter(tester, 'passwordConfirm', 'a-brand-new-password');
      await tester.tap(find.byKey(const ValueKey('passwordSubmit')));
      await tester.pumpAndSettle();

      expect(sent, {
        'password': 'a-brand-new-password',
        'current_password': 'old-password-123',
      });
      expect(find.text('Password changed'), findsOneWidget);
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(find.text('Login'), findsWidgets);
    });

    testWidgets('a wrong current password is reported', (tester) async {
      await openSettings(
        tester,
        handler: (request) async {
          if (request.url.path.endsWith('/auth/password/set')) {
            return http.Response('{"error":"reauthentication_required"}', 403);
          }
          return _passengerHandler(request);
        },
      );
      await tapRow(tester, 'settingsPassword');
      await enter(tester, 'passwordCurrent', 'not-my-password');
      await enter(tester, 'passwordNew', 'a-brand-new-password');
      await enter(tester, 'passwordConfirm', 'a-brand-new-password');
      await tester.tap(find.byKey(const ValueKey('passwordSubmit')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('passwordError')), findsOneWidget);
      expect(find.text('Password changed'), findsNothing);
    });

    testWidgets('language row switches to Arabic', (tester) async {
      await openSettings(tester);
      await tapRow(tester, 'settingsLanguage');
      await tester.tap(find.byKey(const ValueKey('language-ar')));
      await tester.pumpAndSettle();

      expect(find.text('اللغة'), findsOneWidget);
      expect(
        Directionality.of(tester.element(find.text('اللغة'))),
        TextDirection.rtl,
      );
    });

    testWidgets('rating needs a star and is saved on the server', (
      tester,
    ) async {
      Map<String, dynamic>? sent;
      SharedPreferences.setMockInitialValues({'passenger_app_rating': 2});
      await openSettings(
        tester,
        handler: (request) async {
          if (request.url.path.endsWith('/me/app-rating')) {
            if (request.method == 'PUT') {
              sent = jsonDecode(request.body) as Map<String, dynamic>;
              return http.Response(
                '{"rating":{"stars":4,"feedback":"Works well","updated_at":"2026-11-03T10:00:00.000Z"}}',
                200,
              );
            }
            return http.Response('{"rating":null}', 200);
          }
          return _passengerHandler(request);
        },
      );
      await tapRow(tester, 'settingsRate');

      FilledButton submit() => tester.widget<FilledButton>(
        find.byKey(const ValueKey('ratingSubmit')),
      );
      expect(submit().onPressed, isNull);

      await tester.tap(find.byKey(const ValueKey('ratingStar-4')));
      await tester.pump();
      await tester.enterText(
        find.byKey(const ValueKey('ratingFeedback')),
        'Works well',
      );
      expect(submit().onPressed, isNotNull);
      await tester.tap(find.byKey(const ValueKey('ratingSubmit')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('ratingThanks')), findsOneWidget);
      expect(sent, {'stars': 4, 'feedback': 'Works well'});
      // Nothing about the rating stays on the phone.
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getInt('passenger_app_rating'), isNull);
    });

    testWidgets('rating sheet shows the saved rating and a failed save', (
      tester,
    ) async {
      await openSettings(
        tester,
        handler: (request) async {
          if (request.url.path.endsWith('/me/app-rating')) {
            return request.method == 'PUT'
                ? http.Response('{"error":"internal_error"}', 500)
                : http.Response(
                    '{"rating":{"stars":3,"feedback":"Okay","updated_at":"2026-11-03T10:00:00.000Z"}}',
                    200,
                  );
          }
          return _passengerHandler(request);
        },
      );
      await tapRow(tester, 'settingsRate');

      expect(find.byIcon(Icons.star_rounded), findsNWidgets(3));
      expect(find.text('Okay'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('ratingSubmit')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('ratingError')), findsOneWidget);
      expect(find.byKey(const ValueKey('ratingThanks')), findsNothing);
    });

    testWidgets('help opens with questions and the assistant', (tester) async {
      await openSettings(tester);
      await tapRow(tester, 'settingsHelp');

      expect(find.byKey(const ValueKey('helpAssistant')), findsOneWidget);
      expect(find.text('How do I request a trip?'), findsOneWidget);
    });

    testWidgets('log out asks first and cancelling keeps the session', (
      tester,
    ) async {
      await openSettings(tester);
      await tapRow(tester, 'logoutButton');

      expect(find.text('Confirm logout'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('passengerSettings')), findsOneWidget);
    });

    testWidgets('the Maps tab no longer shows a back arrow', (tester) async {
      await _pumpApp(
        tester,
        localeValues: {DomainLabels.localeStorageKey: 'en'},
        secureValues: {TokenStorage.tokenKey: 'token'},
        handler: _passengerHandler,
      );
      await tester.tap(find.byKey(const ValueKey('roleNavigation-2')));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.arrow_back_rounded), findsNothing);
      expect(find.byType(BackButton), findsNothing);
    });
  });
}

Future<void> _fillLogin(WidgetTester tester) async {
  await tester.enterText(
    find.byKey(const ValueKey('emailField')),
    'sara@example.com',
  );
  await tester.enterText(
    find.byKey(const ValueKey('passwordField')),
    'correct-horse-battery',
  );
  await tester.pump();
}

Future<void> _pumpApp(
  WidgetTester tester, {
  Map<String, Object> localeValues = const {},
  Map<String, String> secureValues = const {},
  Future<http.Response> Function(http.Request request)? handler,
  AppConfig config = demoTestAppConfig,
}) async {
  tester.view.physicalSize = const Size(900, 2000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  SharedPreferences.setMockInitialValues(localeValues);
  FlutterSecureStorage.setMockInitialValues(
    Map<String, String>.of(secureValues),
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(config),
        httpClientProvider.overrideWithValue(
          MockClient(
            handler ??
                (request) async => http.Response('{"error":"not_found"}', 404),
          ),
        ),
      ],
      child: const DarbApp(),
    ),
  );
  await tester.pumpAndSettle();
}

Future<http.Response> Function(http.Request request) _meHandler(String role) {
  return (request) async => http.Response(_meBody(role), 200);
}

Future<http.Response> _passengerHandler(http.Request request) async {
  final path = request.url.path;
  if (path.endsWith('/me')) return http.Response(_meBody('passenger'), 200);
  if (path.endsWith('/auth/sessions') && request.method == 'GET') {
    return http.Response(
      '{"sessions":[{"id":"session_1","client_type":"mobile","device_name":"Darb Android","created_at":"2026-07-17T10:00:00.000Z","last_used_at":"2026-07-17T10:05:00.000Z","expires_at":"2026-08-17T10:00:00.000Z","is_current":true,"revoked":false}]}',
      200,
    );
  }
  if (path.contains('/auth/sessions/') && request.method == 'DELETE') {
    return http.Response('{"ok":true,"session":{"revoked":true}}', 200);
  }
  if (path.endsWith('/auth/logout') || path.endsWith('/auth/logout-all')) {
    return http.Response('{"ok":true}', 200);
  }
  if (path.endsWith('/passenger/requests/active')) {
    return http.Response('{"requests":[${_requestBody()}]}', 200);
  }
  if (path.endsWith('/trips')) return http.Response('{"trips":[]}', 200);
  return http.Response('{"error":"not_found"}', 404);
}

String _loginBody(String role) =>
    '{"token":"jwt-token","user":${_userBody(role)}}';

String _meBody(String role) => '{"user":${_userBody(role)}}';

String _requestBody() =>
    '{"id":"request_1","pickup_label":"PPU Main Gate","pickup_lat":"31.550000","pickup_lng":"35.100000","destination_label":"Bethlehem Center","destination_lat":"31.705400","destination_lng":"35.202400","preferred_time":"2026-07-02T09:00:00.000Z","passenger_count":1,"status":"pending","created_at":"2026-07-01T09:00:00.000Z"}';

String _userBody(String role) {
  final name = switch (role) {
    'driver' => 'Demo Driver',
    'merchant' => 'Demo Merchant',
    'admin' => 'Demo Admin',
    _ => 'Demo Passenger',
  };
  final phone = switch (role) {
    'driver' => '+970590000002',
    'merchant' => '+970590000004',
    'admin' => '+970590000005',
    _ => '+970590000001',
  };
  return '{"id":"user_1","name":"$name","phone":"$phone","role":"$role","demo_account":true}';
}
