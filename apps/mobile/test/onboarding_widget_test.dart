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
import 'package:darb_mobile/features/onboarding/data/onboarding_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_app_config.dart';

void main() {
  testWidgets('registration asks who is signing up first', (tester) async {
    await _pumpApp(tester, onboardingEnabled: true);

    await tester.tap(find.byKey(const ValueKey('goToSignUpButton')));
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('register-role-passenger')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('register-role-driver')), findsOneWidget);
    expect(
      find.byKey(const ValueKey('register-role-merchant')),
      findsOneWidget,
    );
    expect(find.text('سائق'), findsWidgets);
    expect(find.text('صاحب متجر'), findsOneWidget);
  });

  testWidgets('normal user continues to the email sign-up', (tester) async {
    await _pumpApp(tester, onboardingEnabled: true);

    await tester.tap(find.byKey(const ValueKey('goToSignUpButton')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('register-role-passenger')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('emailField')), findsOneWidget);
    expect(find.byKey(const ValueKey('invitationCodeField')), findsNothing);
    // The one password rule is shown under the sign-up password field.
    expect(find.text(_passwordRuleAr), findsOneWidget);
    expect(find.textContaining('12–72'), findsNothing);
  });

  testWidgets('driver registers without an invitation', (tester) async {
    await _pumpApp(tester, onboardingEnabled: true);

    await tester.tap(find.byKey(const ValueKey('goToSignUpButton')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('register-role-driver')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('invitationCodeField')), findsNothing);
    expect(find.byKey(const ValueKey('onboardingPhoneField')), findsOneWidget);
    expect(find.byKey(const ValueKey('onboardingEmailField')), findsOneWidget);
  });

  testWidgets('shop owner registers without an invitation', (tester) async {
    await _pumpApp(tester, onboardingEnabled: true);

    await tester.tap(find.byKey(const ValueKey('goToSignUpButton')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('register-role-merchant')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('invitationCodeField')), findsNothing);
    expect(find.byKey(const ValueKey('onboardingPhoneField')), findsOneWidget);
    expect(find.byKey(const ValueKey('onboardingEmailField')), findsOneWidget);
  });

  testWidgets('disabled config hides the application status link', (
    tester,
  ) async {
    await _pumpApp(tester);

    expect(
      find.byKey(const ValueKey('checkApplicationStatusButton')),
      findsNothing,
    );
  });

  testWidgets(
    'driver sign-up while registration is unavailable stays on the chooser',
    (tester) async {
      await _pumpApp(
        tester,
        onboardingEnabled: true,
        disableAfterFirstConfig: true,
      );

      await tester.tap(find.byKey(const ValueKey('goToSignUpButton')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('register-role-driver')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('invitationCodeField')), findsNothing);
      expect(
        find.byKey(const ValueKey('register-role-driver')),
        findsOneWidget,
      );
      expect(find.text('التسجيل غير متاح مؤقتاً.'), findsOneWidget);
    },
  );

  testWidgets('direct onboarding route while disabled returns safely', (
    tester,
  ) async {
    await _pumpApp(tester);

    GoRouter.of(tester.element(find.text('أهلاً بعودتك'))).go('/onboarding');
    await tester.pumpAndSettle();

    expect(find.text('التسجيل غير متاح مؤقتاً.'), findsOneWidget);
    expect(find.text('تسجيل الدخول'), findsWidgets);
  });

  testWidgets('registration entry preserves normal back navigation', (
    tester,
  ) async {
    await _pumpApp(tester, onboardingEnabled: true);

    await tester.tap(find.byKey(const ValueKey('goToSignUpButton')));
    await tester.pumpAndSettle();

    expect(find.byTooltip('رجوع'), findsOneWidget);
    await tester.tap(find.byTooltip('رجوع'));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('loginButton')), findsOneWidget);
  });

  testWidgets('status recovery entry preserves normal back navigation', (
    tester,
  ) async {
    await _pumpApp(tester, onboardingEnabled: true);

    await tester.tap(
      find.byKey(const ValueKey('checkApplicationStatusButton')),
    );
    await tester.pumpAndSettle();

    expect(find.byTooltip('رجوع'), findsOneWidget);
    await tester.tap(find.byTooltip('رجوع'));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('loginButton')), findsOneWidget);
  });

  testWidgets('a failed sign-in still lets the user check an application', (
    tester,
  ) async {
    await _pumpApp(tester, onboardingEnabled: true);

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

    await tester.tap(
      find.byKey(const ValueKey('checkApplicationStatusButton')),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('loginButton')), findsNothing);
    expect(find.byTooltip('رجوع'), findsOneWidget);
  });

  testWidgets('consent version change clears all prior acceptance', (
    tester,
  ) async {
    var consentVersion = 0;
    final future = DateTime.now().toUtc().add(const Duration(hours: 1));
    final bundle = {
      'version': 1,
      'type': 'continuation',
      'safe_stage': 'enteringAccountDetails',
      'locale': 'ar',
      'selected_role': 'passenger',
      'attempt_id': 'attempt_1',
      'continuation_token': 'continuation-token',
      'continuation_expires_at': future.toIso8601String(),
      'registration_grant': 'registration-grant',
      'registration_grant_expires_at': future.toIso8601String(),
    };
    await _pumpApp(
      tester,
      onboardingEnabled: true,
      secureInitialValues: {OnboardingStorage.bundleKey: jsonEncode(bundle)},
      handler: (request) async {
        if (request.url.path.endsWith('/onboarding/config')) {
          return http.Response(_enabledConfigBody, 200);
        }
        if (request.url.path.endsWith('/onboarding/status')) {
          return http.Response(
            '{"role":"passenger","onboarding_status":"phone_verified","next_action":"complete_registration","request_id":"req"}',
            200,
          );
        }
        if (request.url.path.endsWith('/onboarding/consents')) {
          consentVersion += 1;
          return http.Response(_consentBody('v$consentVersion'), 200);
        }
        if (request.url.path.endsWith('/complete')) {
          return http.Response('{"error":"consent_version_changed"}', 409);
        }
        return http.Response('{"error":"not_found"}', 404);
      },
    );

    await tester.tap(find.text('متابعة التسجيل'));
    await tester.pumpAndSettle();

    expect(find.byTooltip('رجوع'), findsOneWidget);
    await tester.tap(find.byTooltip('رجوع'));
    await tester.pumpAndSettle();
    expect(find.text('مغادرة التسجيل'), findsWidgets);
    await tester.tap(find.text('إلغاء'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('displayNameField')), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('displayNameField')),
      'Secure User',
    );
    await tester.enterText(
      find.byKey(const ValueKey('onboardingPasswordField')),
      'first secure password 1',
    );
    await tester.enterText(
      find.byKey(const ValueKey('confirmPasswordField')),
      'first secure password 1',
    );
    for (var index = 0; index < 3; index += 1) {
      await tester.tap(find.byType(CheckboxListTile).at(index));
    }
    await tester.tap(find.byKey(const ValueKey('createAccountButton')));
    await tester.pumpAndSettle();

    final checkboxes = tester
        .widgetList<CheckboxListTile>(find.byType(CheckboxListTile))
        .toList();
    expect(checkboxes.map((checkbox) => checkbox.value), everyElement(isFalse));
    expect(find.textContaining('v2'), findsWidgets);
  });

  testWidgets(
    'account details show the password rule and refuse a password without a number',
    (tester) async {
      var completeRequests = 0;
      final future = DateTime.now().toUtc().add(const Duration(hours: 1));
      final bundle = {
        'version': 1,
        'type': 'continuation',
        'safe_stage': 'enteringAccountDetails',
        'locale': 'ar',
        'selected_role': 'driver',
        'attempt_id': 'attempt_1',
        'continuation_token': 'continuation-token',
        'continuation_expires_at': future.toIso8601String(),
        'registration_grant': 'registration-grant',
        'registration_grant_expires_at': future.toIso8601String(),
      };
      await _pumpApp(
        tester,
        onboardingEnabled: true,
        secureInitialValues: {OnboardingStorage.bundleKey: jsonEncode(bundle)},
        handler: (request) async {
          if (request.url.path.endsWith('/onboarding/config')) {
            return http.Response(_enabledConfigBody, 200);
          }
          if (request.url.path.endsWith('/onboarding/status')) {
            return http.Response(
              '{"role":"driver","onboarding_status":"phone_verified","next_action":"complete_registration","request_id":"req"}',
              200,
            );
          }
          if (request.url.path.endsWith('/onboarding/consents')) {
            return http.Response(_consentBody('v1'), 200);
          }
          if (request.url.path.endsWith('/complete')) completeRequests += 1;
          return http.Response('{"error":"not_found"}', 404);
        },
      );

      await tester.tap(find.text('متابعة التسجيل'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('displayNameField')), findsOneWidget);
      expect(find.text(_passwordRuleAr), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('displayNameField')),
        'Secure User',
      );
      for (final key in ['onboardingPasswordField', 'confirmPasswordField']) {
        await tester.enterText(find.byKey(ValueKey(key)), 'onlyletters');
      }
      for (var index = 0; index < 3; index += 1) {
        await tester.tap(find.byType(CheckboxListTile).at(index));
      }
      await tester.tap(find.byKey(const ValueKey('createAccountButton')));
      await tester.pumpAndSettle();

      expect(completeRequests, 0);
      // Once under the field, once as the error explaining the refusal.
      expect(find.text(_passwordRuleAr), findsNWidgets(2));
    },
  );

  testWidgets('server-valid pending bundle restores to the pending screen', (
    tester,
  ) async {
    final future = DateTime.now().toUtc().add(const Duration(hours: 1));
    final bundle = {
      'version': 1,
      'type': 'pendingStatus',
      'safe_stage': 'pendingReview',
      'locale': 'ar',
      'selected_role': 'driver',
      'pending_status_token': 'pending-token',
      'pending_status_expires_at': future.toIso8601String(),
    };
    await _pumpApp(
      tester,
      onboardingEnabled: true,
      secureInitialValues: {OnboardingStorage.bundleKey: jsonEncode(bundle)},
      handler: (request) async {
        if (request.url.path.endsWith('/onboarding/config')) {
          return http.Response(_enabledConfigBody, 200);
        }
        if (request.url.path.endsWith('/onboarding/status')) {
          return http.Response(
            '{"role":"driver","onboarding_status":"pending_review","next_action":"await_approval","request_id":"req"}',
            200,
          );
        }
        return http.Response('{"error":"not_found"}', 404);
      },
    );

    expect(find.text('الطلب قيد المراجعة'), findsOneWidget);
    expect(find.text('سائق'), findsOneWidget);
    expect(find.byKey(const ValueKey('loginButton')), findsNothing);
  });

  testWidgets(
    'registration asks for phone and email, never an invitation code',
    (tester) async {
      await _pumpApp(
        tester,
        handler: (request) async {
          if (request.url.path.endsWith('/onboarding/config')) {
            return http.Response(_openConfigBody, 200);
          }
          return http.Response('{"error":"not_found"}', 404);
        },
      );

      await tester.tap(find.byKey(const ValueKey('goToSignUpButton')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('register-role-driver')));
      await tester.pumpAndSettle();

      expect(find.textContaining('رمز الدعوة'), findsNothing);
      expect(
        find.byKey(const ValueKey('onboardingPhoneField')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('onboardingEmailField')),
        findsOneWidget,
      );
    },
  );

  testWidgets('submit stays locked until every required document is on file', (
    tester,
  ) async {
    final harness = await _pumpUnsubmittedDriver(tester, [
      'driver_licence',
      'national_id',
    ]);

    expect(find.text('ارفع مستنداتك'), findsOneWidget);
    expect(find.text('الطلب قيد المراجعة'), findsNothing);
    expect(find.byKey(const ValueKey('documentsStillNeeded')), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('submitApplicationButton')),
          )
          .onPressed,
      isNull,
    );
    expect(harness.submitCalls, 0);
  });

  testWidgets('a complete application is sent for review', (tester) async {
    final harness = await _pumpUnsubmittedDriver(tester, [
      'driver_licence',
      'vehicle_registration',
      'vehicle_photo',
      'national_id',
    ]);

    expect(find.byKey(const ValueKey('documentsStillNeeded')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('submitApplicationButton')));
    await tester.pumpAndSettle();

    expect(harness.submitCalls, 1);
    expect(find.text('الطلب قيد المراجعة'), findsOneWidget);
    expect(find.byKey(const ValueKey('submitApplicationButton')), findsNothing);
  });

  testWidgets('a server refusal keeps the applicant on the upload step', (
    tester,
  ) async {
    final harness = await _pumpUnsubmittedDriver(tester, [
      'driver_licence',
      'vehicle_registration',
      'vehicle_photo',
      'national_id',
    ], refuseSubmit: true);

    await tester.tap(find.byKey(const ValueKey('submitApplicationButton')));
    await tester.pumpAndSettle();

    expect(harness.submitCalls, 1);
    expect(find.text('ارفع مستنداتك'), findsOneWidget);
    expect(find.text('الطلب قيد المراجعة'), findsNothing);
  });
}

class _SubmitHarness {
  int submitCalls = 0;
}

Future<_SubmitHarness> _pumpUnsubmittedDriver(
  WidgetTester tester,
  List<String> kinds, {
  bool refuseSubmit = false,
}) async {
  final harness = _SubmitHarness();
  var submitted = false;
  final future = DateTime.now().toUtc().add(const Duration(hours: 1));
  final bundle = {
    'version': 1,
    'type': 'pendingStatus',
    'safe_stage': 'pendingReview',
    'locale': 'ar',
    'selected_role': 'driver',
    'pending_status_token': 'pending-token',
    'pending_status_expires_at': future.toIso8601String(),
  };
  await _pumpApp(
    tester,
    onboardingEnabled: true,
    secureInitialValues: {OnboardingStorage.bundleKey: jsonEncode(bundle)},
    handler: (request) async {
      final path = request.url.path;
      if (path.endsWith('/onboarding/config')) {
        return http.Response(_enabledConfigBody, 200);
      }
      if (path.endsWith('/onboarding/status')) {
        return http.Response(
          submitted
              ? '{"role":"driver","onboarding_status":"pending_review","next_action":"await_approval","request_id":"req"}'
              : '{"role":"driver","onboarding_status":"documents_required","next_action":"upload_documents","request_id":"req"}',
          200,
        );
      }
      if (path.endsWith('/onboarding/driver-documents')) {
        return http.Response(
          jsonEncode({
            'documents': [
              for (final kind in kinds)
                {
                  'id': 'doc_$kind',
                  'kind': kind,
                  'mime_type': 'image/jpeg',
                  'size_bytes': 2048,
                },
            ],
            'limits': {'max_documents': 6, 'max_bytes': 5242880},
            'request_id': 'req',
          }),
          200,
        );
      }
      if (path.endsWith('/onboarding/application/submit')) {
        harness.submitCalls += 1;
        if (refuseSubmit) {
          return http.Response('{"error":"documents_required"}', 409);
        }
        submitted = true;
        return http.Response(
          '{"onboarding_status":"pending_review","next_action":"await_approval","request_id":"req"}',
          200,
        );
      }
      return http.Response('{"error":"not_found"}', 404);
    },
  );
  return harness;
}

Future<void> _pumpApp(
  WidgetTester tester, {
  bool onboardingEnabled = false,
  bool failConfig = false,
  bool disableAfterFirstConfig = false,
  AppConfig config = demoTestAppConfig,
  Map<String, String> secureInitialValues = const {},
  Future<http.Response> Function(http.Request request)? handler,
}) async {
  var configRequests = 0;
  tester.view.physicalSize = const Size(900, 2000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  SharedPreferences.setMockInitialValues({});
  FlutterSecureStorage.setMockInitialValues(Map.of(secureInitialValues));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(config),
        httpClientProvider.overrideWithValue(
          MockClient(
            handler ??
                (request) async {
                  if (request.url.path.endsWith('/onboarding/config')) {
                    configRequests += 1;
                    if (failConfig) throw http.ClientException('offline');
                    if (!onboardingEnabled ||
                        (disableAfterFirstConfig && configRequests > 1)) {
                      return http.Response(
                        '{"enabled":false,"registration_roles":[],"request_id":"req"}',
                        200,
                      );
                    }
                    return http.Response(_enabledConfigBody, 200);
                  }
                  return http.Response('{"error":"not_found"}', 404);
                },
          ),
        ),
      ],
      child: const DarbApp(),
    ),
  );
  await tester.pumpAndSettle();
}

const _passwordRuleAr = '8 أحرف أو أكثر، تتضمن حرفاً ورقماً';

const _openConfigBody =
    '{"enabled":true,"registration_roles":["driver","merchant"],"phone_policy":{"canonical_format":"E.164","international_prefix_required_without_region":true,"local_numbers_require_region":true},"supported_locales":["ar","en"],"password_policy":{"minimum_characters":8,"maximum_characters":72,"maximum_utf8_bytes":72,"requires_letter":true,"requires_digit":true},"otp_digits":6,"resend_cooldown_seconds":60,"request_id":"req"}';

const _enabledConfigBody =
    '{"enabled":true,"registration_roles":["driver","merchant"],"phone_policy":{"canonical_format":"E.164","international_prefix_required_without_region":true,"local_numbers_require_region":true},"supported_locales":["ar","en"],"password_policy":{"minimum_characters":8,"maximum_characters":72,"maximum_utf8_bytes":72,"requires_letter":true,"requires_digit":true},"otp_digits":6,"resend_cooldown_seconds":60,"request_id":"req"}';

String _consentBody(String version) => jsonEncode({
  'documents': [
    for (final type in ['terms', 'privacy', 'adult_self_attestation'])
      {
        'id': '${type}_$version',
        'type': type,
        'version': version,
        'locale': 'ar',
        'content': '$type content',
        'content_hash': 'a' * 64,
        'effective_at': '2026-07-20T00:00:00.000Z',
      },
  ],
  'request_id': 'req',
});
