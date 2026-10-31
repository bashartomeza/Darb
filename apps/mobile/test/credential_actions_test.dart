import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/features/auth/data/auth_repository.dart';
import 'package:masari_mobile/features/auth/presentation/credential_actions.dart';

import 'support/auth_test_support.dart';

Future<List<http.Request>> _pump(
  WidgetTester tester, {
  required String action,
  Locale locale = const Locale('en'),
}) async {
  final requests = <http.Request>[];
  final client = TestAuthenticatedClient(
    handler: (request) async {
      requests.add(request);
      return http.Response('{"ok":true}', 200);
    },
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authRepositoryProvider.overrideWithValue(
          AuthRepository(
            apiClient: client.coordinator.apiClient,
            authenticatedApiClient: client.client,
          ),
        ),
      ],
      child: MaterialApp(
        locale: locale,
        supportedLocales: const [Locale('en'), Locale('ar')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: Scaffold(body: CredentialActionDialog(action: action)),
      ),
    ),
  );
  return requests;
}

FilledButton _confirm(WidgetTester tester) => tester.widget<FilledButton>(
  find.byKey(const ValueKey('credentialConfirm')),
);

void main() {
  testWidgets(
    'reset takes a digits-only six-digit code and enables Confirm only when complete',
    (tester) async {
      final requests = await _pump(tester, action: 'reset');
      expect(find.text('Six-digit code from your email'), findsOneWidget);
      final field = tester.widget<TextField>(
        find.byKey(const ValueKey('credentialCode')),
      );
      expect(field.keyboardType, TextInputType.number);
      await tester.enterText(
        find.byKey(const ValueKey('recoveryEmail')),
        'A@Example.com',
      );
      await tester.enterText(
        find.byKey(const ValueKey('credentialCode')),
        '12ab34567890',
      );
      await tester.pump();
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('credentialCode')))
            .controller!
            .text,
        '123456',
      );
      await tester.enterText(
        find.byKey(const ValueKey('credentialCode')),
        '12345',
      );
      await tester.pump();
      expect(_confirm(tester).onPressed, isNull);
      await tester.enterText(
        find.byKey(const ValueKey('credentialCode')),
        '123456',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'New password'),
        'a-long-enough-password',
      );
      await tester.pump();
      expect(_confirm(tester).onPressed, isNotNull);
      await tester.tap(find.byKey(const ValueKey('credentialConfirm')));
      await tester.pumpAndSettle();
      expect(jsonDecode(requests.single.body), {
        'email': 'a@example.com',
        'code': '123456',
        'password': 'a-long-enough-password',
      });
    },
  );

  testWidgets('the code label is shown in Arabic', (tester) async {
    await _pump(tester, action: 'reset', locale: const Locale('ar'));
    expect(
      find.text('الرمز المكون من ستة أرقام من بريدك الإلكتروني'),
      findsOneWidget,
    );
  });
}
