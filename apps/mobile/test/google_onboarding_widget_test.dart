import 'dart:convert';

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
import 'package:darb_mobile/features/auth/application/auth_controller.dart';
import 'package:darb_mobile/features/auth/data/token_storage.dart';
import 'package:darb_mobile/features/onboarding/data/onboarding_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_app_config.dart';

// A Google ID token whose payload carries `"name":"Rana Haddad"`.
final _idToken =
    'h.${base64Url.encode(utf8.encode('{"name":"Rana Haddad"}')).replaceAll('=', '')}.s';

final _documents = [
  for (final type in ['terms', 'privacy', 'adult_self_attestation'])
    {
      'id': type,
      'type': type,
      'locale': 'en',
      'version': 'v1',
      'content': 'Required document: $type',
      'content_hash': 'a' * 64,
    },
];

void main() {
  testWidgets(
    'a Google passenger picks a role, fills short steps and enters the app',
    (tester) async {
      final completions = <Map<String, dynamic>>[];
      final container = await _pumpApp(
        tester,
        handler: (request) async {
          final path = request.url.path;
          if (path.endsWith('/auth/complete-registration') ||
              path.endsWith('/google/complete-registration')) {
            completions.add(jsonDecode(request.body) as Map<String, dynamic>);
            return http.Response(
              jsonEncode({
                'token': 'new-darb-session',
                'user': {
                  'id': 'new',
                  'name': 'Rana H',
                  'phone': '+970599111222',
                  'profile_state': 'complete',
                  'role': 'passenger',
                  'demo_account': false,
                },
              }),
              201,
            );
          }
          return _common(request);
        },
      );
      await container
          .read(authControllerProvider.notifier)
          .loginWithGoogle(idToken: _idToken, locale: 'en');
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('googleOnboardingScreen')), findsOne);
      expect(find.text('Get started'), findsOneWidget);
      expect(_continueButton(tester).onPressed, isNull);

      await tester.tap(find.byKey(const ValueKey('googleRole-passenger')));
      await tester.pump();
      await _tapContinue(tester);
      expect(find.text('Step 2 of 4'), findsOneWidget);
      // The name comes pre-filled from Google and stays editable.
      expect(find.text('Rana Haddad'), findsOneWidget);

      // Continue validates the step before moving on.
      await _tapContinue(tester);
      expect(find.text('Step 2 of 4'), findsOneWidget);
      await tester.enterText(
        find.byKey(const ValueKey('googleName')),
        'Rana H',
      );
      await tester.enterText(
        find.byKey(const ValueKey('googlePhone')),
        '+970599111222',
      );
      await _tapContinue(tester);
      expect(find.text('Step 3 of 4'), findsOneWidget);

      // Back keeps what was typed.
      await tester.tap(find.byKey(const ValueKey('googleOnboardingBack')));
      await tester.pumpAndSettle();
      expect(find.text('+970599111222'), findsOneWidget);
      await _tapContinue(tester);

      await tester.enterText(
        find.byKey(const ValueKey('googleCity')),
        'Ramallah',
      );
      await _tapContinue(tester);
      expect(find.text('Step 4 of 4'), findsOneWidget);
      expect(_continueButton(tester).onPressed, isNull);
      for (final type in ['terms', 'privacy', 'adult_self_attestation']) {
        final box = find.byKey(ValueKey('googleConsent-$type'));
        await tester.ensureVisible(box);
        await tester.tap(box);
        await tester.pump();
      }
      await _tapContinue(tester);

      expect(completions.single, {
        'registration_token': 'sealed-grant',
        'locale': 'en',
        'consents': [
          for (final d in _documents)
            {
              'id': d['id'],
              'type': d['type'],
              'content_hash': d['content_hash'],
            },
        ],
        'adult_self_attestation': true,
        'device_name': 'Darb App',
        'name': 'Rana H',
        'role': 'passenger',
        'profile': {'phone': '+970599111222', 'city': 'Ramallah'},
      });
      expect(
        (await container.read(tokenStorageProvider).readBundle())?.accessToken,
        'new-darb-session',
      );
      expect(
        GoRouter.of(
          tester.element(find.byType(Scaffold).first),
        ).routeInformationProvider.value.uri.path,
        startsWith('/passenger'),
      );
    },
  );

  testWidgets(
    'a Google driver sends vehicle details and lands on the pending application',
    (tester) async {
      Map<String, dynamic>? completion;
      final container = await _pumpApp(
        tester,
        handler: (request) async {
          final path = request.url.path;
          if (path.endsWith('/google/complete-registration')) {
            completion = jsonDecode(request.body) as Map<String, dynamic>;
            return http.Response(
              jsonEncode({
                'result': 'account_created',
                'role': 'driver',
                'account_status': 'pending',
                'onboarding_status': 'documents_required',
                'next_action': 'upload_documents',
                'onboarding_status_token': 'p' * 43,
                'onboarding_status_expires_at': '2099-01-01T00:00:00.000Z',
                'request_id': 'req',
              }),
              201,
            );
          }
          if (path.endsWith('/onboarding/config')) {
            return http.Response(_enabledConfigBody, 200);
          }
          if (path.endsWith('/onboarding/status')) {
            expect(request.headers['authorization'], 'Onboarding ${'p' * 43}');
            return http.Response(
              '{"role":"driver","onboarding_status":"documents_required","next_action":"upload_documents","missing_documents":["driver_licence","vehicle_registration","national_id"],"request_id":"req"}',
              200,
            );
          }
          if (path.endsWith('/onboarding/driver-documents')) {
            return http.Response('{"documents":[]}', 200);
          }
          return _common(request);
        },
      );
      await container
          .read(authControllerProvider.notifier)
          .loginWithGoogle(idToken: _idToken, locale: 'en');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('googleRole-driver')));
      await tester.pump();
      await _tapContinue(tester);
      expect(find.text('Step 2 of 5'), findsOneWidget);
      await tester.enterText(
        find.byKey(const ValueKey('googlePhone')),
        '+970599123456',
      );
      await tester.enterText(
        find.byKey(const ValueKey('googleCity')),
        'Nablus',
      );
      await _tapContinue(tester);

      expect(find.text('Step 3 of 5'), findsOneWidget);
      await tester.enterText(
        find.byKey(const ValueKey('googleNationalId')),
        '401234567',
      );
      await tester.enterText(
        find.byKey(const ValueKey('googleLicenceNumber')),
        'DL-12345',
      );
      // The expiry date is required.
      await _tapContinue(tester);
      expect(find.text('Step 3 of 5'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('googleLicenceExpiry')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await _tapContinue(tester);

      expect(find.text('Step 4 of 5'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('googleChip-van')));
      await tester.enterText(
        find.byKey(const ValueKey('googleMakeModel')),
        'Hyundai H1',
      );
      await tester.enterText(
        find.byKey(const ValueKey('googleVehicleColor')),
        'Silver',
      );
      await tester.enterText(
        find.byKey(const ValueKey('googlePlate')),
        'ab-1234',
      );
      await _tapContinue(tester);

      expect(find.text('Step 5 of 5'), findsOneWidget);
      for (final type in ['terms', 'privacy', 'adult_self_attestation']) {
        final box = find.byKey(ValueKey('googleConsent-$type'));
        await tester.ensureVisible(box);
        await tester.tap(box);
        await tester.pump();
      }
      expect(find.text('Submit application'), findsOneWidget);
      await _tapContinue(tester);

      expect(completion!['role'], 'driver');
      final profile = completion!['profile'] as Map<String, dynamic>;
      expect(profile, containsPair('vehicle_type', 'van'));
      expect(profile, containsPair('plate_number', 'AB-1234'));
      expect(profile, containsPair('seats_total', 4));
      expect(profile['licence_expires_at'], matches(r'^\d{4}-\d{2}-\d{2}$'));
      // No app session: the driver waits for Admin approval.
      expect(await container.read(tokenStorageProvider).readBundle(), isNull);
      expect(
        await container.read(onboardingStorageProvider).readBundle(),
        isNotNull,
      );
      expect(
        find.byKey(const ValueKey('submitApplicationButton')),
        findsOneWidget,
      );
    },
  );

  testWidgets('a pending Google driver signing in sees their application', (
    tester,
  ) async {
    final container = await _pumpApp(
      tester,
      handler: (request) async {
        final path = request.url.path;
        if (path.endsWith('/mobile/google')) {
          return http.Response(
            '{"role":"driver","onboarding_status":"pending_review","next_action":"await_approval","onboarding_status_token":"${'q' * 43}","onboarding_status_expires_at":"2099-01-01T00:00:00.000Z","request_id":"req"}',
            202,
          );
        }
        if (path.endsWith('/onboarding/config')) {
          return http.Response(_enabledConfigBody, 200);
        }
        if (path.endsWith('/onboarding/status')) {
          return http.Response(
            '{"role":"driver","onboarding_status":"pending_review","next_action":"await_approval","request_id":"req"}',
            200,
          );
        }
        if (path.endsWith('/onboarding/driver-documents')) {
          return http.Response('{"documents":[]}', 200);
        }
        return _common(request);
      },
    );
    final pending = await container
        .read(authControllerProvider.notifier)
        .loginWithGoogle(idToken: _idToken, locale: 'en');
    expect(pending, isTrue);
    expect(await container.read(tokenStorageProvider).readBundle(), isNull);
    expect(
      (await container.read(onboardingStorageProvider).readBundle())
          ?.pendingStatusToken,
      'q' * 43,
    );
  });
}

FilledButton _continueButton(WidgetTester tester) =>
    tester.widget<FilledButton>(
      find.byKey(const ValueKey('googleOnboardingContinue')),
    );

Future<void> _tapContinue(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('googleOnboardingContinue')));
  await tester.pumpAndSettle();
}

Future<http.Response> _common(http.Request request) async {
  final path = request.url.path;
  if (path.endsWith('/mobile/google')) {
    return http.Response(
      jsonEncode({
        'registration_token': 'sealed-grant',
        'expires_at': '2099-01-01T00:00:00Z',
        'next_action': 'consent_required',
      }),
      202,
    );
  }
  if (path.endsWith('/auth/consents')) {
    return http.Response(jsonEncode({'documents': _documents}), 200);
  }
  if (path.endsWith('/auth/capabilities')) {
    return http.Response('{"google_driver_signup_available":true}', 200);
  }
  if (path.endsWith('/me')) {
    return http.Response(
      '{"user":{"id":"new","name":"Rana H","phone":"+970599111222","profile_state":"complete","role":"passenger","demo_account":false}}',
      200,
    );
  }
  return http.Response('{"error":"not_found"}', 404);
}

const _enabledConfigBody =
    '{"enabled":true,"registration_roles":["passenger","driver","merchant"],"phone_policy":{"canonical_format":"E.164","international_prefix_required_without_region":true,"local_numbers_require_region":true},"supported_locales":["ar","en"],"password_policy":{"minimum_characters":8,"maximum_characters":72,"maximum_utf8_bytes":72,"requires_letter":true,"requires_digit":true},"otp_digits":6,"resend_cooldown_seconds":60,"request_id":"req"}';

Future<ProviderContainer> _pumpApp(
  WidgetTester tester, {
  required Future<http.Response> Function(http.Request request) handler,
  AppConfig config = demoTestAppConfig,
}) async {
  tester.view.physicalSize = const Size(900, 2000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  SharedPreferences.setMockInitialValues({DomainLabels.localeStorageKey: 'en'});
  FlutterSecureStorage.setMockInitialValues({});
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(config),
        httpClientProvider.overrideWithValue(MockClient(handler)),
      ],
      child: const DarbApp(),
    ),
  );
  await tester.pumpAndSettle();
  return ProviderScope.containerOf(tester.element(find.byType(DarbApp)));
}
