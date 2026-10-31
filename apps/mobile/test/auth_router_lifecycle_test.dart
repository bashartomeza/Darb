import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:masari_mobile/app.dart';
import 'package:masari_mobile/core/api/api_client.dart';
import 'package:masari_mobile/core/config/app_config.dart';
import 'package:masari_mobile/core/i18n/domain_labels.dart';
import 'package:masari_mobile/core/routing/app_router.dart';
import 'package:masari_mobile/features/auth/application/auth_controller.dart';
import 'package:masari_mobile/features/auth/data/google_sign_in_service.dart';
import 'package:masari_mobile/features/auth/presentation/login_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_app_config.dart';

void main() {
  for (final locale in ['en', 'ar']) {
    for (final failure in ['401', 'network', 'google401']) {
      testWidgets(
        '$locale $failure keeps first retry edit and mounted form with real router',
        (tester) async {
          var failed = false;
          final attempts = <Map<String, dynamic>>[];
          final container = await _pump(tester, locale, (request) async {
            if (request.url.path.endsWith('/auth/capabilities')) {
              return http.Response(
                '{"google_mobile_login_available":true}',
                200,
              );
            }
            if (request.url.path.endsWith('/auth/mobile/login') ||
                request.url.path.endsWith('/auth/mobile/google')) {
              attempts.add(jsonDecode(request.body) as Map<String, dynamic>);
              if (!failed) {
                failed = true;
                if (failure == 'network') {
                  throw http.ClientException('synthetic offline');
                }
                return http.Response('{"error":"invalid_credentials"}', 401);
              }
              return http.Response(_login('passenger'), 200);
            }
            return _read(request);
          });
          final router = container.read(appRouterProvider);
          final originalForm = tester.state(find.byType(LoginScreen));
          await tester.enterText(_field('email'), 'wrong@example.invalid');
          await tester.enterText(_field('password'), 'wrong-password');
          final submit = find.byKey(
            ValueKey(
              failure == 'google401' ? 'googleSignInButton' : 'loginButton',
            ),
          );
          await tester.ensureVisible(submit);
          await tester.tap(submit);
          await tester.pumpAndSettle();
          expect(find.byKey(const ValueKey('loginError')), findsOneWidget);
          final failedForm = tester.state(find.byType(LoginScreen));

          // A single edit must survive clearError's auth-provider transition.
          await tester.enterText(_field('email'), 'r');
          await tester.pumpAndSettle();
          expect(_text(tester, 'email'), 'r');
          expect(_text(tester, 'password'), 'wrong-password');
          expect(tester.state(find.byType(LoginScreen)), same(failedForm));
          expect(failedForm, same(originalForm));
          expect(container.read(appRouterProvider), same(router));
          expect(find.byKey(const ValueKey('loginError')), findsNothing);
          expect(
            Directionality.of(tester.element(find.byType(LoginScreen))),
            locale == 'ar' ? TextDirection.rtl : TextDirection.ltr,
          );

          await tester.enterText(_field('email'), 'retry@example.invalid');
          await tester.enterText(_field('password'), 'correct-password');
          await tester.ensureVisible(find.byKey(const ValueKey('loginButton')));
          await tester.tap(find.byKey(const ValueKey('loginButton')));
          await tester.pumpAndSettle();
          expect(find.byKey(const ValueKey('passengerHome')), findsOneWidget);
          expect(router.routeInformationProvider.value.uri.path, '/passenger');
          expect(container.read(appRouterProvider), same(router));
          expect(attempts, hasLength(2));
          expect(attempts.last['email'], 'retry@example.invalid');
          expect(attempts.last['password'], 'correct-password');
        },
      );
    }
  }

  testWidgets('stable router reacts to role changes and logout protections', (
    tester,
  ) async {
    var role = 'passenger';
    final container = await _pump(tester, 'en', (request) async {
      if (request.url.path.endsWith('/auth/mobile/login')) {
        return http.Response(_login(role), 200);
      }
      return _read(request);
    });
    final router = container.read(appRouterProvider);
    final auth = container.read(authControllerProvider.notifier);
    router.go('/driver/trip/private');
    await tester.pumpAndSettle();
    expect(router.routeInformationProvider.value.uri.path, '/login');

    for (final next in ['passenger', 'driver', 'merchant', 'admin']) {
      role = next;
      await auth.login(email: '$next@example.invalid', password: 'test-only');
      await tester.pumpAndSettle();
      final target = next == 'admin' ? '/unsupported-role' : '/$next';
      expect(router.routeInformationProvider.value.uri.path, target);
      expect(container.read(appRouterProvider), same(router));
      router.go(next == 'passenger' ? '/merchant/order/new' : '/passenger');
      await tester.pumpAndSettle();
      expect(router.routeInformationProvider.value.uri.path, target);
    }
    await auth.logout();
    await tester.pumpAndSettle();
    expect(router.routeInformationProvider.value.uri.path, '/login');
    expect(container.read(appRouterProvider), same(router));
    router.go('/security/sessions');
    await tester.pumpAndSettle();
    expect(router.routeInformationProvider.value.uri.path, '/login');
  });
}

Finder _field(String name) => find.byKey(ValueKey('${name}Field'));

String _text(WidgetTester tester, String name) => tester
    .widget<EditableText>(
      find.descendant(of: _field(name), matching: find.byType(EditableText)),
    )
    .controller
    .text;

Future<ProviderContainer> _pump(
  WidgetTester tester,
  String locale,
  Future<http.Response> Function(http.Request) handler,
) async {
  tester.view.physicalSize = const Size(900, 2000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  SharedPreferences.setMockInitialValues({
    DomainLabels.localeStorageKey: locale,
  });
  FlutterSecureStorage.setMockInitialValues({});
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(productionTestAppConfig),
        httpClientProvider.overrideWithValue(MockClient(handler)),
        googleSignInServiceProvider.overrideWithValue(_GoogleFixture()),
      ],
      child: const MasariApp(),
    ),
  );
  await tester.pumpAndSettle();
  return ProviderScope.containerOf(tester.element(find.byType(MasariApp)));
}

http.Response _read(http.Request request) {
  if (request.url.path.endsWith('/auth/logout')) {
    return http.Response('{"ok":true}', 200);
  }
  if (request.url.path.endsWith('/passenger/requests/active')) {
    return http.Response('{"requests":[]}', 200);
  }
  if (request.url.path.endsWith('/trips')) {
    return http.Response('{"trips":[]}', 200);
  }
  return http.Response('{"error":"not_found"}', 404);
}

String _login(String role) => jsonEncode({
  'token': 'synthetic-session-$role',
  'user': {
    'id': 'synthetic-$role',
    'name': 'Synthetic $role',
    'phone': '+970590000001',
    'role': role,
    'demo_account': false,
  },
});

class _GoogleFixture extends GoogleSignInService {
  @override
  bool get isConfigured => true;
  @override
  Future<void> ensureInitialized() async {}
  @override
  Future<String?> authenticate() async => 'synthetic-google-proof';
}
