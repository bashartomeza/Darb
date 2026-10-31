import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/features/auth/application/auth_controller.dart';
import 'package:masari_mobile/features/auth/data/authenticated_api_client.dart';
import 'package:masari_mobile/features/auth/domain/auth_models.dart';
import 'package:masari_mobile/features/canonical_routes/data/canonical_operation_storage.dart';
import 'package:masari_mobile/features/shared_trips/presentation/shared_trip_screens.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import 'shared_trips_test.dart';
import 'support/auth_test_support.dart';

void main() {
  testWidgets('Arabic shared inbox is RTL, responsive, and privacy safe', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(720, 1280);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    const sentinel = 'PRIVATE_MEMBER_PHONE_0599999999';

    await tester.pumpWidget(
      testApp(
        locale: const Locale('ar'),
        client: sharedClient((request) async {
          if (request.url.path.endsWith('/capabilities')) {
            return jsonResponse(capabilitiesJson());
          }
          return jsonResponse({
            'offers': [sharedOfferJson()..['private_member'] = sentinel],
            'next_cursor': null,
            'server_now': '2026-08-05T10:00:00.000Z',
          });
        }),
        home: const DriverSharedOfferListScreen(),
        textScale: 2,
      ),
    );
    await pumpUntilFound(tester, find.text('رحلة مختلطة'));

    expect(find.text('عروض الرحلات المشتركة'), findsWidgets);
    expect(find.text('رحلة مختلطة'), findsOneWidget);
    expect(find.textContaining('مقاعد الركاب: 3'), findsOneWidget);
    expect(find.textContaining('طرود: 4'), findsOneWidget);
    expect(find.textContaining(sentinel), findsNothing);
    final offerSemantics = tester
        .getSemantics(
          find.bySemanticsLabel(RegExp('طلبات الركاب: 2.*الطرود: 4')),
        )
        .getSemanticsData();
    expect(offerSemantics.hasAction(SemanticsAction.tap), isTrue);
    expect(
      tester
          .widget<Directionality>(find.byType(Directionality).first)
          .textDirection,
      TextDirection.rtl,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('shared detail presents whole group and safe stop timeline', (
    tester,
  ) async {
    await tester.pumpWidget(
      testApp(
        locale: const Locale('en'),
        client: sharedClient((request) async {
          if (request.url.path.endsWith('/capabilities')) {
            return jsonResponse(capabilitiesJson());
          }
          return jsonResponse({
            'offer': sharedOfferJson(),
            'server_now': '2026-08-05T10:00:00.000Z',
          });
        }),
        home: const DriverSharedOfferDetailScreen(offerId: 'shared_1'),
      ),
    );
    await pumpUntilFound(tester, find.text('Mixed trip'));

    expect(find.text('Shared offer details'), findsOneWidget);
    expect(find.text('Mixed trip'), findsOneWidget);
    expect(find.text('Shared stop events'), findsOneWidget);
    expect(find.textContaining('Passengers board: 3'), findsOneWidget);
    expect(find.textContaining('Parcel destinations: 4'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.textContaining('segment-level reuse is not enabled'),
      150,
      scrollable: find.byType(Scrollable).last,
    );
    expect(
      find.textContaining('segment-level reuse is not enabled'),
      findsOneWidget,
    );
    await tester.scrollUntilVisible(
      find.text('Accept entire shared trip'),
      150,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('Accept entire shared trip'), findsOneWidget);
    expect(find.text('Reject entire shared trip'), findsOneWidget);
    final acceptSemantics = find.bySemanticsLabel('Accept entire shared trip');
    expect(acceptSemantics, findsOneWidget);
    expect(
      tester
          .getSemantics(acceptSemantics)
          .getSemanticsData()
          .hasAction(SemanticsAction.tap),
      isTrue,
    );
    expect(find.textContaining('This screen is not live'), findsOneWidget);
    expect(find.textContaining('Start trip'), findsNothing);
    expect(find.textContaining('ETA'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'shared feature disabled renders unavailable, not empty history',
    (tester) async {
      await tester.pumpWidget(
        testApp(
          locale: const Locale('en'),
          client: sharedClient((request) async {
            return jsonResponse(capabilitiesJson(shared: false));
          }),
          home: const DriverSharedOfferListScreen(),
        ),
      );
      await pumpUntilFound(
        tester,
        find.text('Shared-trip offers are not available in this environment.'),
      );

      expect(
        find.text('Shared-trip offers are not available in this environment.'),
        findsOneWidget,
      );
      expect(find.text('No shared-trip offers are available.'), findsNothing);
    },
  );

  testWidgets('selected rejection reason produces a back warning', (
    tester,
  ) async {
    await tester.pumpWidget(
      testApp(
        locale: const Locale('en'),
        client: sharedClient((request) async {
          if (request.url.path.endsWith('/capabilities')) {
            return jsonResponse(capabilitiesJson());
          }
          return jsonResponse({
            'offer': sharedOfferJson(),
            'server_now': '2026-08-05T10:00:00.000Z',
          });
        }),
        home: const DriverSharedOfferDetailScreen(offerId: 'shared_1'),
      ),
    );
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('sharedRejectReason')),
    );
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('sharedRejectReason')),
      150,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.tap(find.byKey(const ValueKey('sharedRejectReason')));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.text('Schedule conflict').last);
    await tester.pump();

    await tester.binding.handlePopRoute();
    await tester.pump();

    expect(
      find.text(
        'Your selected rejection reason has not been submitted. Leave this screen?',
      ),
      findsOneWidget,
    );
  });
}

Widget testApp({
  required Locale locale,
  required AuthenticatedApiClient client,
  required Widget home,
  double textScale = 1,
}) => ProviderScope(
  overrides: [
    authenticatedApiClientProvider.overrideWithValue(client),
    authControllerProvider.overrideWith(WidgetDriverController.new),
    canonicalOperationStorageProvider.overrideWithValue(
      WidgetOperationStorage(),
    ),
  ],
  child: MaterialApp(
    locale: locale,
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: const [
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    home: Consumer(
      builder: (context, ref, _) => ref
          .watch(authControllerProvider)
          .when(
            data: (_) => home,
            error: (error, _) => Text('$error'),
            loading: () => const Center(child: CircularProgressIndicator()),
          ),
    ),
  ),
);

AuthenticatedApiClient sharedClient(
  Future<http.Response> Function(http.Request request) handler,
) => TestAuthenticatedClient(handler: handler).client;

class WidgetDriverController extends AuthController {
  @override
  Future<AuthState> build() async => const AuthState.authenticated(
    AuthUser(
      id: 'driver_1',
      name: 'Driver',
      phone: '+970590000002',
      role: UserRole.driver,
      demoAccount: false,
    ),
  );
}

class WidgetOperationStorage implements CanonicalOperationStorage {
  @override
  String get namespace => CanonicalOperationStorage.bundleKey;
  CanonicalOperationBundle? bundle;

  @override
  Future<void> clear() async => bundle = null;

  @override
  Future<CanonicalOperationBundle?> read() async => bundle;

  @override
  Future<void> save(CanonicalOperationBundle value) async => bundle = value;
}

Future<void> pumpUntilFound(
  WidgetTester tester,
  Finder finder, {
  int attempts = 20,
}) async {
  for (
    var attempt = 0;
    attempt < attempts && finder.evaluate().isEmpty;
    attempt++
  ) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}
