import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/core/api/api_error.dart';
import 'package:darb_mobile/core/config/app_config.dart';
import 'package:darb_mobile/features/auth/application/auth_controller.dart';
import 'package:darb_mobile/features/auth/data/auth_repository.dart';
import 'package:darb_mobile/features/auth/domain/auth_models.dart';
import 'package:darb_mobile/features/auth/presentation/login_screen.dart';
import 'package:darb_mobile/features/onboarding/application/onboarding_controller.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_app_config.dart';

void main() {
  testWidgets(
    'real controller: no error on open, only after submit, edit clears',
    (tester) async {
      final repo = _FailingRepo(
        const ApiException(ApiErrorType.unauthorized, 'invalid_credentials'),
      );
      final container = await _pumpReal(tester, repo);
      expect(find.byKey(const ValueKey('loginError')), findsNothing);

      // Required-field validation stays separate from auth errors.
      await tester.tap(find.byKey(const ValueKey('loginButton')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('loginError')), findsNothing);
      expect(repo.calls, 0);

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
      expect(find.text('Invalid email or password.'), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('passwordField')),
        'other',
      );
      await tester.pump();
      expect(find.byKey(const ValueKey('loginError')), findsNothing);

      // A stale failure left in the controller is cleared when the screen opens.
      repo.failure = const ApiException(
        ApiErrorType.network,
        'network_unavailable',
      );
      await tester.tap(find.byKey(const ValueKey('loginButton')));
      await tester.pumpAndSettle();
      expect(
        find.text('Network unavailable. Check the API connection and retry.'),
        findsOneWidget,
      );
      expect(find.text('Invalid email or password.'), findsNothing);
      expect(container.read(authControllerProvider).hasError, isTrue);

      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(_app(container));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('loginError')), findsNothing);
      expect(container.read(authControllerProvider).hasError, isFalse);
    },
  );

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

class _FailingRepo implements AuthRepository {
  _FailingRepo(this.failure);
  ApiException failure;
  int calls = 0;

  @override
  Future<LoginResult> login({
    required String email,
    required String password,
    String deviceName = 'test',
  }) {
    calls++;
    throw failure;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _RealAuth extends AuthController {
  @override
  Future<AuthState> build() async => const AuthState.unauthenticated();
}

Widget _app(ProviderContainer container) => UncontrolledProviderScope(
  container: container,
  child: const MaterialApp(
    locale: Locale('en'),
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: LoginScreen(),
  ),
);

Future<ProviderContainer> _pumpReal(
  WidgetTester tester,
  AuthRepository repo,
) async {
  tester.view.physicalSize = const Size(1000, 1800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  SharedPreferences.setMockInitialValues({});
  final container = ProviderContainer(
    overrides: [
      appConfigProvider.overrideWithValue(productionTestAppConfig),
      authRepositoryProvider.overrideWithValue(repo),
      authControllerProvider.overrideWith(_RealAuth.new),
      onboardingControllerProvider.overrideWith(_NoOnboarding.new),
    ],
  );
  addTearDown(container.dispose);
  await tester.pumpWidget(_app(container));
  await tester.pumpAndSettle();
  return container;
}
