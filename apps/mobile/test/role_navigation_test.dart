import 'package:masari_mobile/core/widgets/role_nav_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:masari_mobile/app.dart';
import 'package:masari_mobile/core/api/api_client.dart';
import 'package:masari_mobile/core/config/app_config.dart';
import 'package:masari_mobile/core/i18n/domain_labels.dart';
import 'package:masari_mobile/features/auth/data/token_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_app_config.dart';

/// Covers the shell navigation contract: the bar is owned by one Scaffold per
/// role, survives every tab, and each branch keeps its own stack.
void main() {
  group('driver shell', () {
    testWidgets('bottom navigation survives every tab', (tester) async {
      await _pumpApp(tester, handler: _driverHandler);

      expect(_bar(tester).currentIndex, 0);

      // Every destination, then back down again: the diagram gives the driver
      // five, and each must keep the bar alive.
      for (final index in [1, 2, 3, 4, 0, 4, 3, 2, 1, 0]) {
        await _tapTab(tester, index);
        expect(
          find.byType(RoleShellScaffold),
          findsOneWidget,
          reason: 'bar disappeared on tab $index',
        );
        expect(_bar(tester).currentIndex, index);
      }
    });

    testWidgets('repeated switching keeps exactly one navigation bar', (
      tester,
    ) async {
      await _pumpApp(tester, handler: _driverHandler);

      for (var i = 0; i < 6; i++) {
        await _tapTab(tester, i.isEven ? 1 : 0);
      }

      expect(find.byType(RoleShellScaffold), findsOneWidget);
      expect(_bar(tester).currentIndex, 0);
    });

    testWidgets('a detail keeps the bar, its tab, and the branch stack', (
      tester,
    ) async {
      await _pumpApp(tester, handler: _driverHandler);

      await _tapTab(tester, 1);
      await tester.tap(find.byKey(const ValueKey('openMatch-match_1')));
      await tester.pumpAndSettle();

      // Nested detail: bar stays, and its own tab stays highlighted.
      expect(find.byType(RoleShellScaffold), findsOneWidget);
      expect(_bar(tester).currentIndex, 1);
      expect(
        find.byKey(const ValueKey('driverScoringBreakdown')),
        findsOneWidget,
      );

      // Leaving and returning to the tab restores the pushed page.
      await _tapTab(tester, 0);
      expect(
        find.byKey(const ValueKey('driverScoringBreakdown')),
        findsNothing,
      );
      await _tapTab(tester, 1);
      expect(
        find.byKey(const ValueKey('driverScoringBreakdown')),
        findsOneWidget,
        reason: 'branch stack was not preserved across tab switches',
      );

      // Android back returns through the branch stack to the inbox.
      await _back(tester);
      expect(
        find.byKey(const ValueKey('driverScoringBreakdown')),
        findsNothing,
      );
      expect(find.byKey(const ValueKey('openMatch-match_1')), findsOneWidget);
      expect(_bar(tester).currentIndex, 1);
    });

    testWidgets('re-tapping the active tab pops instead of stacking', (
      tester,
    ) async {
      await _pumpApp(tester, handler: _driverHandler);

      await _tapTab(tester, 1);
      await tester.tap(find.byKey(const ValueKey('openMatch-match_1')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('driverScoringBreakdown')),
        findsOneWidget,
      );

      await _tapTab(tester, 1);
      expect(
        find.byKey(const ValueKey('driverScoringBreakdown')),
        findsNothing,
        reason: 're-tapping the active tab should return to its root',
      );
      expect(find.byKey(const ValueKey('openMatch-match_1')), findsOneWidget);
    });

    testWidgets('a deep link into a branch highlights that branch', (
      tester,
    ) async {
      await _pumpApp(tester, handler: _driverHandler);

      GoRouter.of(
        tester.element(find.byType(RoleShellScaffold)),
      ).go('/driver/match/match_1');
      await tester.pumpAndSettle();

      expect(find.byType(RoleShellScaffold), findsOneWidget);
      expect(_bar(tester).currentIndex, 1);
    });

    testWidgets('a full-screen flow deliberately has no navigation bar', (
      tester,
    ) async {
      await _pumpApp(tester, handler: _driverHandler);

      GoRouter.of(
        tester.element(find.byType(RoleShellScaffold)),
      ).go('/driver/trip/trip_1');
      await tester.pumpAndSettle();

      expect(find.byType(RoleShellScaffold), findsNothing);
    });
  });

  group('passenger shell', () {
    testWidgets('bottom navigation survives every tab', (tester) async {
      await _pumpApp(tester, handler: _passengerHandler);

      for (final index in [1, 2, 3, 4, 0, 1]) {
        await _tapTab(tester, index);
        expect(find.byType(RoleShellScaffold), findsOneWidget);
        expect(_bar(tester).currentIndex, index);
      }
    });

    testWidgets('the trips tab lists the request history', (tester) async {
      await _pumpApp(tester, handler: _passengerHandler);

      await _tapTab(tester, 1);
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('passengerTripsList')), findsOneWidget);
      // The completed request from `GET /passenger/requests` — the endpoint
      // this tab exists to surface — lands in the "past trips" bucket.
      expect(
        find.byKey(const ValueKey('passengerTrip-request_1')),
        findsOneWidget,
      );
      expect(find.byType(NavigationBar), findsNothing);
      expect(find.byType(RoleShellScaffold), findsOneWidget);
    });

    testWidgets('the assistant opens inside the passenger home branch', (
      tester,
    ) async {
      await _pumpApp(tester, handler: _passengerHandler);

      await tester.tap(find.byKey(const ValueKey('openPassengerAssistant')));
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('passengerAssistantScreen')),
        findsOneWidget,
      );
      expect(find.byType(RoleShellScaffold), findsOneWidget);
      expect(_bar(tester).currentIndex, 0);
      expect(
        Directionality.of(
          tester.element(find.byKey(const ValueKey('assistantTextInput'))),
        ),
        TextDirection.rtl,
      );
    });

    testWidgets('the account tab reaches session management', (tester) async {
      await _pumpApp(tester, handler: _passengerHandler);

      await _tapTab(tester, _accountTab(tester));
      expect(find.text('الأمان والجلسات'), findsWidgets);
      expect(find.byType(RoleShellScaffold), findsOneWidget);
    });

    testWidgets('the legacy security link lands on the account tab', (
      tester,
    ) async {
      await _pumpApp(tester, handler: _passengerHandler);
      final account = _accountTab(tester);

      await tester.tap(find.byKey(const ValueKey('securitySessionsButton')));
      await tester.pumpAndSettle();

      expect(find.text('الأمان والجلسات'), findsWidgets);
      expect(find.byType(RoleShellScaffold), findsOneWidget);
      expect(_bar(tester).currentIndex, account);
    });
  });

  group('merchant shell', () {
    testWidgets('bottom navigation survives every tab', (tester) async {
      await _pumpApp(tester, handler: _merchantHandler);

      for (final index in [1, 2, 3, 4, 0, 1]) {
        await _tapTab(tester, index);
        expect(find.byType(RoleShellScaffold), findsOneWidget);
        expect(_bar(tester).currentIndex, index);
      }
    });

    testWidgets('the shipments tab lists the merchant orders', (tester) async {
      await _pumpApp(tester, handler: _merchantHandler);

      await _tapTab(tester, 1);
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('merchantShipmentsList')),
        findsOneWidget,
      );
      expect(find.byType(RoleShellScaffold), findsOneWidget);
    });
  });

  testWidgets('Arabic lays the bar out right-to-left', (tester) async {
    await _pumpApp(tester, handler: _driverHandler);

    final bar = find.byType(RoleShellScaffold);
    expect(Directionality.of(tester.element(bar)), TextDirection.rtl);

    // Under RTL the first destination sits on the trailing (right) edge.
    final home = tester.getCenter(_tabIcon(0));
    final account = tester.getCenter(_tabIcon(_accountTab(tester)));
    expect(
      home.dy,
      lessThan(account.dy),
      reason: 'home should precede account in the sidebar',
    );
  });

  testWidgets('English lays the bar out left-to-right', (tester) async {
    await _pumpApp(
      tester,
      handler: _driverHandler,
      localeValues: {DomainLabels.localeStorageKey: 'en'},
    );

    expect(
      Directionality.of(tester.element(find.byType(RoleShellScaffold))),
      TextDirection.ltr,
    );
    expect(
      tester.getCenter(_tabIcon(0)).dy,
      lessThan(tester.getCenter(_tabIcon(_accountTab(tester))).dy),
    );
  });
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

StatefulNavigationShell _bar(WidgetTester tester) => tester
    .widget<RoleShellScaffold>(find.byType(RoleShellScaffold))
    .navigationShell;

/// The account tab's index: always the last destination, in every role.
///
/// Derived rather than hardcoded so adding a destination to a shell does not
/// silently point these assertions at the wrong tab.
int _accountTab(WidgetTester tester) =>
    tester
        .widget<RoleShellScaffold>(find.byType(RoleShellScaffold))
        .destinations
        .length -
    1;

/// The destination at [index], scoped to the bar so it never collides with the
/// same icon used inside a screen's content. Indexing destinations rather than
/// icons keeps this tied to branch order.
Finder _tabIcon(int index) => find.byKey(ValueKey('roleNavigation-$index'));

Future<void> _tapTab(WidgetTester tester, int index) async {
  await tester.tap(_tabIcon(index));
  await tester.pumpAndSettle();
}

Future<void> _back(WidgetTester tester) async {
  await tester.binding.handlePopRoute();
  await tester.pumpAndSettle();
}

Future<void> _pumpApp(
  WidgetTester tester, {
  required Future<http.Response> Function(http.Request request) handler,
  Map<String, Object> localeValues = const {},
  AppConfig config = demoTestAppConfig,
}) async {
  tester.view.physicalSize = const Size(1200, 2000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  SharedPreferences.setMockInitialValues(localeValues);
  FlutterSecureStorage.setMockInitialValues({TokenStorage.tokenKey: 'token'});
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(config),
        httpClientProvider.overrideWithValue(MockClient(handler)),
      ],
      child: const MasariApp(),
    ),
  );
  await tester.pumpAndSettle();
}

Future<http.Response> _driverHandler(http.Request request) async {
  final path = request.url.path;
  if (path.endsWith('/me')) return http.Response(_meBody('driver'), 200);
  if (path.endsWith('/driver/routes/active') ||
      path.endsWith('/driver/routes')) {
    return http.Response('{"routes":[$_routeJson]}', 200);
  }
  if (path.endsWith('/matches/match_1')) {
    return http.Response('{"match":$_matchJson}', 200);
  }
  if (path.endsWith('/matches')) {
    return http.Response('{"matches":[$_matchJson]}', 200);
  }
  if (path.endsWith('/trips/trip_1/location')) {
    return http.Response('{"location":$_locationJson}', 200);
  }
  if (path.endsWith('/trips/trip_1')) {
    return http.Response('{"trip":$_tripJson}', 200);
  }
  if (path.endsWith('/trips')) return http.Response('{"trips":[]}', 200);
  return _sessionsOr404(request);
}

Future<http.Response> _passengerHandler(http.Request request) async {
  final path = request.url.path;
  if (path.endsWith('/me')) return http.Response(_meBody('passenger'), 200);
  if (path.endsWith('/passenger/requests/active')) {
    return http.Response('{"requests":[]}', 200);
  }
  // The whole history, which is what the "My trips" tab reads. Distinct from
  // the `/active` list above, which only ever holds the open request.
  if (path.endsWith('/passenger/requests')) {
    return http.Response('{"requests":[$_passengerRequestJson]}', 200);
  }
  if (path.endsWith('/trips')) return http.Response('{"trips":[]}', 200);
  return _sessionsOr404(request);
}

const _passengerRequestJson = '''
{"id":"request_1","pickup_label":"PPU Main Gate","pickup_lat":31.5326,
 "pickup_lng":35.0998,"destination_label":"Bethlehem Center",
 "destination_lat":31.7054,"destination_lng":35.2024,
 "preferred_time":"2026-07-17T09:00:00.000Z","passenger_count":1,
 "status":"completed","created_at":"2026-07-17T08:00:00.000Z"}''';

Future<http.Response> _merchantHandler(http.Request request) async {
  final path = request.url.path;
  if (path.endsWith('/me')) return http.Response(_meBody('merchant'), 200);
  if (path.endsWith('/merchant/orders')) {
    return http.Response('{"orders":[]}', 200);
  }
  if (path.endsWith('/matches')) return http.Response('{"matches":[]}', 200);
  if (path.endsWith('/trips')) return http.Response('{"trips":[]}', 200);
  return _sessionsOr404(request);
}

Future<http.Response> _sessionsOr404(http.Request request) async {
  if (request.url.path.endsWith('/auth/sessions') && request.method == 'GET') {
    return http.Response(
      '{"sessions":[{"id":"session_1","client_type":"mobile","device_name":"Masari Android","created_at":"2026-07-17T10:00:00.000Z","last_used_at":"2026-07-17T10:05:00.000Z","expires_at":"2026-08-17T10:00:00.000Z","is_current":true,"revoked":false}]}',
      200,
    );
  }
  return http.Response('{"error":"not_found"}', 404);
}

String _meBody(String role) {
  final name = switch (role) {
    'driver' => 'Demo Driver',
    'merchant' => 'Demo Merchant',
    _ => 'Demo Passenger',
  };
  return '{"user":{"id":"user_1","name":"$name","phone":"+970590000002","role":"$role","demo_account":true}}';
}

const _routeJson =
    '{"id":"route_1","origin_label":"Hebron / PPU / Bab Al-Zawiya","origin_lat":"31.532600","origin_lng":"35.099800","destination_label":"Bethlehem","destination_lat":"31.705400","destination_lng":"35.202400","corridor_key":"hebron-ppu-bab-al-zawiya-to-bethlehem","seats_available":2,"parcel_capacity_available":5,"status":"active","activated_at":"2026-07-13T08:00:00.000Z","completed_at":null}';

const _matchJson =
    '{"id":"match_1","status":"proposed","score":"0.9317","method":"masari_route_score","explanation":"Safe explanation","scoring_breakdown":{"corridorOverlap":0.95,"pickupDistanceScore":0.82,"timingFit":0.9,"trustScore":0.86,"capacityFit":1,"finalScore":0.9317},"created_at":"2026-07-13T08:10:00.000Z","driver_route":{"id":"route_1","origin_label":"Hebron / PPU / Bab Al-Zawiya","destination_label":"Bethlehem","corridor_key":"hebron-ppu-bab-al-zawiya-to-bethlehem","seats_available":2,"parcel_capacity_available":5,"status":"active","driver":{"vehicle_type":"sedan","verified":true,"trust_score":86}},"passenger_request":{"id":"request_1","pickup_label":"PPU Main Gate","destination_label":"Bethlehem Center","preferred_time":"2026-07-13T09:00:00.000Z","passenger_count":1,"status":"pending","created_at":"2026-07-13T08:00:00.000Z"},"merchant_order":null,"parcel_batch":null}';

const _tripJson =
    '{"id":"trip_1","status":"accepted","created_at":"2026-07-13T08:20:00.000Z","started_at":"2026-07-13T08:20:00.000Z","completed_at":null,"driver_route":$_routeJson,"passenger_request":{"id":"request_1","pickup_label":"PPU Main Gate","destination_label":"Bethlehem Center","passenger_count":1,"status":"accepted"},"merchant_order":null,"parcel_batch":null}';

const _locationJson =
    '{"lat":"31.532600","lng":"35.099800","source":"simulated","sequence":1,"recorded_at":"2026-07-13T08:21:00.000Z"}';
