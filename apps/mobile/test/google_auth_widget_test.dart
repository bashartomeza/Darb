import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/features/auth/data/auth_repository.dart';
import 'package:darb_mobile/features/auth/data/google_sign_in_service.dart';
import 'package:darb_mobile/features/auth/presentation/widgets/google_auth_button.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

class _ConfiguredGoogle extends GoogleSignInService {
  @override
  bool get isConfigured => true;
  @override
  Future<void> ensureInitialized() async {}
  @override
  Future<String?> authenticate() async => 'transient-provider-token';
}

void main() {
  for (final available in [false, true, null]) {
    testWidgets('Google availability $available follows backend capability', (
      tester,
    ) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            googleSignInServiceProvider.overrideWithValue(_ConfiguredGoogle()),
            authCapabilitiesProvider.overrideWith((ref) async {
              if (available == null) throw Exception('unavailable');
              return {'google_mobile_login_available': available};
            }),
          ],
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(
              body: GoogleAuthButton(onIdToken: (_) async {}, onError: (_) {}),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('googleSignInButton')),
        available == true ? findsOneWidget : findsNothing,
      );
    });
  }
  testWidgets('Google callback remains disabled until exchange finishes', (
    tester,
  ) async {
    final pending = Completer<void>();
    final received = <String>[];
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          googleSignInServiceProvider.overrideWithValue(_ConfiguredGoogle()),
          authCapabilitiesProvider.overrideWith(
            (ref) async => {'google_mobile_login_available': true},
          ),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: GoogleAuthButton(
              onIdToken: (token) async {
                received.add(token);
                await pending.future;
              },
              onError: (_) {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('googleSignInButton')));
    await tester.pump();
    expect(
      tester
          .widget<OutlinedButton>(
            find.byKey(const ValueKey('googleSignInButton')),
          )
          .onPressed,
      isNull,
    );
    expect(received, ['transient-provider-token']);
    pending.complete();
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<OutlinedButton>(
            find.byKey(const ValueKey('googleSignInButton')),
          )
          .onPressed,
      isNotNull,
    );
  });
}
