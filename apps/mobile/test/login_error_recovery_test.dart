import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/core/config/app_config.dart';
import 'package:masari_mobile/features/auth/application/auth_controller.dart';
import 'package:masari_mobile/features/auth/presentation/login_screen.dart';
import 'package:masari_mobile/features/onboarding/application/onboarding_controller.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_app_config.dart';

void main() {
  testWidgets(
    'opening login does not display another screen stale authentication error',
    (tester) async {
      await _pump(tester, _AuthFixture(stale: true));
      expect(find.byKey(const ValueKey('loginError')), findsNothing);
    },
  );

  testWidgets(
    'editing credentials clears a failed attempt and later genuine failures still display',
    (tester) async {
      final auth = _AuthFixture();
      await _pump(tester, auth);
      await tester.enterText(
        find.byKey(const ValueKey('emailField')),
        'fixture@example.invalid',
      );
      await tester.enterText(
        find.byKey(const ValueKey('passwordField')),
        'fixture-password',
      );
      await tester.tap(find.byKey(const ValueKey('loginButton')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('loginError')), findsOneWidget);
      await tester.enterText(
        find.byKey(const ValueKey('emailField')),
        'corrected@example.invalid',
      );
      await tester.pump();
      expect(find.byKey(const ValueKey('loginError')), findsNothing);
      auth.failure = const ApiException(
        ApiErrorType.network,
        'network_unavailable',
      );
      await tester.tap(find.byKey(const ValueKey('loginButton')));
      await tester.pumpAndSettle();
      expect(
        find.text('Network unavailable. Check the API connection and retry.'),
        findsOneWidget,
      );
    },
  );
}

Future<void> _pump(WidgetTester tester, _AuthFixture auth) async {
  tester.view.physicalSize = const Size(1000, 1800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  SharedPreferences.setMockInitialValues({});
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(productionTestAppConfig),
        authControllerProvider.overrideWith(() => auth),
        onboardingControllerProvider.overrideWith(_NoOnboarding.new),
      ],
      child: const MaterialApp(
        locale: Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: LoginScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _AuthFixture extends AuthController {
  _AuthFixture({this.stale = false});
  final bool stale;
  ApiException failure = const ApiException(
    ApiErrorType.unauthorized,
    'invalid_credentials',
  );
  @override
  Future<AuthState> build() async {
    if (stale) throw failure;
    return const AuthState.unauthenticated();
  }

  @override
  Future<void> login({required String email, required String password}) async {
    state = AsyncError(failure, StackTrace.current);
  }
}

class _NoOnboarding extends OnboardingController {
  @override
  Future<OnboardingState> build() async => const OnboardingState.checking();
}
