import 'dart:async';
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
import 'package:darb_mobile/features/auth/data/token_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/operating_routes_fixture.dart';
import 'test_app_config.dart';

void main() {
  testWidgets('Arabic driver dashboard is RTL and English remains LTR', (
    tester,
  ) async {
    await _pumpApp(tester, handler: _DriverHandler().call);

    expect(find.byKey(const ValueKey('driverHome')), findsOneWidget);
    expect(find.textContaining('Demo Driver'), findsOneWidget);
    // This driver has an active route, so the main action reads "view".
    expect(find.text('عرض المسار'), findsOneWidget);
    expect(
      Directionality.of(
        tester.element(find.byKey(const ValueKey('driverHome'))),
      ),
      TextDirection.rtl,
    );

    await tester.tap(find.byTooltip('English'));
    await tester.pumpAndSettle();
    expect(find.text('View route'), findsOneWidget);
    expect(
      Directionality.of(
        tester.element(find.byKey(const ValueKey('driverHome'))),
      ),
      TextDirection.ltr,
    );
  });

  testWidgets('route form offers the running routes and sends the chosen one', (
    tester,
  ) async {
    final handler = _DriverHandler(routesEmpty: true);
    await _pumpApp(tester, handler: handler.call);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('driverHome'))),
    ).go('/driver/route');
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('driverRouteField')), findsOneWidget);
    expect(find.byKey(const ValueKey('driverSeatsField')), findsOneWidget);
    expect(find.byKey(const ValueKey('driverParcelField')), findsOneWidget);
    expect(find.byType(TextField), findsNothing);
    // Nothing is sent until a route is chosen.
    VoidCallback? activate() => tester
        .widget<FilledButton>(find.byKey(const ValueKey('activateRouteButton')))
        .onPressed;
    expect(activate(), isNull);

    await tester.tap(find.byKey(const ValueKey('driverRouteField')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('بيت لحم ← الخليل').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('activateRouteButton')));
    await tester.pumpAndSettle();

    expect(handler.createBodies, [
      {
        'service_route_id': 'route-bth-heb',
        'seats_available': 2,
        'parcel_capacity_available': 5,
      },
    ]);
    expect(handler.paths.where((path) => path.contains('corridor')), isEmpty);
    // The new route is shown by name.
    expect(find.byKey(const ValueKey('driverActiveRouteName')), findsOneWidget);
    expect(find.textContaining('الخليل ← بيت لحم'), findsWidgets);
  });

  testWidgets('route form shows a retry when the routes cannot load', (
    tester,
  ) async {
    final handler = _DriverHandler(routesEmpty: true)..routesFail = true;
    await _pumpApp(tester, handler: handler.call);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('driverHome'))),
    ).go('/driver/route');
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('driverRoutesError')), findsOneWidget);
    handler.routesFail = false;
    await tester.tap(find.byKey(const ValueKey('driverRoutesRetry')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('driverRouteField')), findsOneWidget);
  });

  testWidgets('going online without a route asks the driver to choose one', (
    tester,
  ) async {
    final handler = _DriverHandler(routesEmpty: true);
    await _pumpApp(tester, handler: handler.call);
    expect(find.textContaining('لم تختر مساراً بعد'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('driverOnlineSwitch')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('driverRoutePicker')), findsOneWidget);
    expect(handler.onlineBodies, isEmpty);

    await tester.tap(
      find.byKey(const ValueKey('driverRouteOption-route-heb-bth')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('driverRoutePickConfirm')));
    await tester.pumpAndSettle();

    expect(handler.onlineBodies, [
      {'online': true, 'service_route_id': 'route-heb-bth'},
    ]);
    // Home names the chosen route.
    expect(find.textContaining('الخليل ← بيت لحم'), findsWidgets);
  });

  testWidgets('going online sends the driver price chosen inside the range', (
    tester,
  ) async {
    final handler = _DriverHandler(routesEmpty: true)..withFares = true;
    await _pumpApp(tester, handler: handler.call);
    await tester.tap(find.byKey(const ValueKey('driverOnlineSwitch')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('driverRouteOption-route-heb-bth')),
    );
    await tester.pumpAndSettle();

    final seat = find.byKey(const ValueKey('driverPrice-passenger_seat'));
    VoidCallback? confirm() => tester
        .widget<FilledButton>(
          find.byKey(const ValueKey('driverRoutePickConfirm')),
        )
        .onPressed;
    // Outside the admin's ₪12.00–₪20.00: refused in Arabic, nothing sent.
    await tester.enterText(seat, '25');
    await tester.pumpAndSettle();
    expect(confirm(), isNull);
    expect(find.textContaining('أدخل سعرًا بين'), findsOneWidget);

    await tester.enterText(seat, '18');
    await tester.pumpAndSettle();
    await tester.ensureVisible(
      find.byKey(const ValueKey('driverRoutePickConfirm')),
    );
    await tester.tap(find.byKey(const ValueKey('driverRoutePickConfirm')));
    await tester.pumpAndSettle();

    expect(handler.onlineBodies, [
      {
        'online': true,
        'service_route_id': 'route-heb-bth',
        'prices': {'passenger_seat': 1800},
      },
    ]);
  });

  testWidgets('going online with no price set charges the route default', (
    tester,
  ) async {
    final handler = _DriverHandler(routesEmpty: true)..withFares = true;
    await _pumpApp(tester, handler: handler.call);
    await tester.tap(find.byKey(const ValueKey('driverOnlineSwitch')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('driverRouteOption-route-heb-bth')),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(
      find.byKey(const ValueKey('driverRoutePickConfirm')),
    );
    await tester.tap(find.byKey(const ValueKey('driverRoutePickConfirm')));
    await tester.pumpAndSettle();
    expect(handler.onlineBodies, [
      {'online': true, 'service_route_id': 'route-heb-bth'},
    ]);
  });

  testWidgets('the route form sends the driver prices with the route', (
    tester,
  ) async {
    final handler = _DriverHandler(routesEmpty: true)..withFares = true;
    await _pumpApp(tester, handler: handler.call);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('driverHome'))),
    ).go('/driver/route');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('driverRouteField')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('الخليل ← بيت لحم').last);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('driverPrice-parcel_m')),
      '13.5',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('activateRouteButton')));
    await tester.pumpAndSettle();

    expect(handler.createBodies, [
      {
        'service_route_id': 'route-heb-bth',
        'seats_available': 2,
        'parcel_capacity_available': 5,
        'prices': {'parcel_m': 1350},
      },
    ]);
  });

  testWidgets('dismissing the route question keeps the driver offline', (
    tester,
  ) async {
    final handler = _DriverHandler(routesEmpty: true);
    await _pumpApp(tester, handler: handler.call);
    await tester.tap(find.byKey(const ValueKey('driverOnlineSwitch')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('إلغاء'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('driverRoutePicker')), findsNothing);
    expect(handler.onlineBodies, isEmpty);
  });

  testWidgets('match and trip show where to collect and drop each customer', (
    tester,
  ) async {
    final handler = _DriverHandler()..routeBased = true;
    await _pumpApp(tester, handler: handler.call);
    final router = GoRouter.of(
      tester.element(find.byKey(const ValueKey('driverHome'))),
    );

    router.go('/driver/matches');
    await tester.pumpAndSettle();
    expect(find.text('قرب البوابة الرئيسية لجامعة البوليتكنك'), findsWidgets);
    expect(find.text('محطة باصات بيت لحم'), findsWidgets);

    router.go('/driver/match/match_1');
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('driverMatchRoute')), findsOneWidget);
    expect(
      tester
          .widget<Text>(find.byKey(const ValueKey('driverPassengerPickup')))
          .data,
      'قرب البوابة الرئيسية لجامعة البوليتكنك',
    );
    expect(
      tester
          .widget<Text>(find.byKey(const ValueKey('driverPassengerDropoff')))
          .data,
      'محطة باصات بيت لحم',
    );

    router.go('/driver/trip/trip_1');
    await tester.pumpAndSettle();
    final sheet = find.byType(DraggableScrollableSheet);
    await tester.drag(sheet, const Offset(0, -600));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<Text>(find.byKey(const ValueKey('driverTripRouteTitle')))
          .data,
      'الخليل ← بيت لحم',
    );
    expect(find.byKey(const ValueKey('driverPassengerPickup')), findsOneWidget);
    expect(
      tester
          .widget<Text>(find.byKey(const ValueKey('driverMerchantPickup')))
          .data,
      'متجر الأمل، شارع عين سارة',
    );
    final parcel = tester
        .widget<Text>(find.byKey(const ValueKey('driverParcelStop-0')))
        .data!;
    expect(parcel, contains('شارع المهد، البوابة الزرقاء'));
    expect(parcel, contains('سارة'));
    expect(parcel, contains('+970599123456'));
  });

  testWidgets('match inbox and detail display safe summary and scoring', (
    tester,
  ) async {
    await _pumpApp(tester, handler: _DriverHandler().call);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('driverHome'))),
    ).go('/driver/matches');
    await tester.pumpAndSettle();

    expect(find.text('طلب مسافر'), findsOneWidget);
    expect(find.textContaining('بوابة البوليتكنك'), findsOneWidget);
    expect(find.textContaining('93.2%'), findsOneWidget);
    expect(find.textContaining('password'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('openMatch-match_1')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('driverScoringBreakdown')),
      findsOneWidget,
    );
    expect(find.textContaining('95.0%'), findsOneWidget);
  });

  testWidgets('accept and reject actions disable while accept is running', (
    tester,
  ) async {
    final accept = Completer<http.Response>();
    await _pumpApp(
      tester,
      handler: _DriverHandler(acceptResponse: accept).call,
    );
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('driverHome'))),
    ).go('/driver/match/match_1');
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const ValueKey('acceptMatchButton')));
    await tester.tap(find.byKey(const ValueKey('acceptMatchButton')));
    await tester.pump();
    expect(
      tester
          .widget<FilledButton>(find.byKey(const ValueKey('acceptMatchButton')))
          .onPressed,
      isNull,
    );
    expect(
      tester
          .widget<OutlinedButton>(
            find.byKey(const ValueKey('rejectMatchButton')),
          )
          .onPressed,
      isNull,
    );

    accept.complete(
      http.Response(
        '{"trip":{"id":"trip_1","status":"accepted"},"matchId":"match_1"}',
        201,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('driverTrip')), findsOneWidget);
  });

  testWidgets('trip shows only valid next action without simulation', (
    tester,
  ) async {
    final handler = _DriverHandler();
    await _pumpApp(tester, handler: handler.call);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('driverHome'))),
    ).go('/driver/trip/trip_1');
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('tripAction-pickup_started')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('tripAction-picked_up')), findsNothing);
    expect(find.byKey(const ValueKey('driverTrip')), findsOneWidget);
    expect(find.byKey(const ValueKey('driverTrip')), findsOneWidget);

    expect(find.byKey(const ValueKey('simulateStepButton')), findsNothing);
    expect(find.byKey(const ValueKey('resetSimulationButton')), findsNothing);
  });

  testWidgets('production driver trip hides tracking simulation controls', (
    tester,
  ) async {
    await _pumpApp(
      tester,
      handler: _DriverHandler().call,
      config: productionTestAppConfig,
    );
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('driverHome'))),
    ).go('/driver/trip/trip_1');
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('simulateStepButton')), findsNothing);
    expect(find.byKey(const ValueKey('resetSimulationButton')), findsNothing);
    expect(find.byKey(const ValueKey('driverTrip')), findsOneWidget);
  });

  testWidgets('passenger cannot access driver routes', (tester) async {
    await _pumpApp(tester, handler: _roleHandler('passenger'));
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('passengerHome'))),
    ).go('/driver/route');
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('passengerHome')), findsOneWidget);
    expect(find.text('تفاصيل المسار'), findsNothing);
  });

  testWidgets('merchant cannot access driver routes', (tester) async {
    await _pumpApp(tester, handler: _roleHandler('merchant'));
    GoRouter.of(
      tester.element(find.textContaining('Demo Merchant')),
    ).go('/driver/route');
    await tester.pumpAndSettle();
    expect(find.textContaining('Demo Merchant'), findsOneWidget);
    expect(find.text('تفاصيل المسار'), findsNothing);
  });

  testWidgets('unauthenticated driver route redirects to login', (
    tester,
  ) async {
    await _pumpApp(
      tester,
      authenticated: false,
      handler: _roleHandler('driver'),
    );
    GoRouter.of(tester.element(find.text('أهلاً بعودتك'))).go('/driver/route');
    await tester.pumpAndSettle();
    expect(find.text('تسجيل الدخول'), findsWidgets);
    expect(find.text('تفاصيل المسار'), findsNothing);
  });
}

Future<void> _pumpApp(
  WidgetTester tester, {
  required Future<http.Response> Function(http.Request request) handler,
  bool authenticated = true,
  AppConfig config = demoTestAppConfig,
}) async {
  tester.view.physicalSize = const Size(900, 2200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  SharedPreferences.setMockInitialValues({});
  FlutterSecureStorage.setMockInitialValues(
    authenticated ? {TokenStorage.tokenKey: 'driver-token'} : {},
  );
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
}

class _DriverHandler {
  _DriverHandler({this.routesEmpty = false, this.acceptResponse});
  bool routesEmpty;
  final Completer<http.Response>? acceptResponse;
  int locationSequence = 0;
  bool routesFail = false;

  /// Serve Hebron → Bethlehem with prices and a driver range.
  bool withFares = false;

  /// Serve route-based match and trip payloads with typed details.
  bool routeBased = false;
  final paths = <String>[];
  final createBodies = <Map<String, dynamic>>[];
  final onlineBodies = <Map<String, dynamic>>[];

  http.Response _utf8(String body, int status) => http.Response(
    body,
    status,
    headers: const {'content-type': 'application/json; charset=utf-8'},
  );

  Future<http.Response> call(http.Request request) async {
    final path = request.url.path;
    paths.add(path);
    if (path.endsWith('/me')) return http.Response(_meBody('driver'), 200);
    if (path.endsWith('/operating-routes')) {
      return routesFail
          ? http.Response('{"error":"internal_error"}', 500)
          : _utf8(
              jsonEncode(
                withFares
                    ? operatingRoutesWithFaresJson()
                    : operatingRoutesJson(),
              ),
              200,
            );
    }
    if (path.endsWith('/driver/online-state') && request.method == 'PUT') {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      onlineBodies.add(body);
      routesEmpty = body['online'] != true;
      return http.Response(
        '{"online":${body['online']},"route_id":"route_1","replayed":false}',
        200,
      );
    }
    if (path.endsWith('/driver/routes') && request.method == 'POST') {
      createBodies.add(jsonDecode(request.body) as Map<String, dynamic>);
      routesEmpty = false;
      return _utf8('{"route":$_namedRouteJson}', 201);
    }
    if (path.endsWith('/driver/routes/active') ||
        path.endsWith('/driver/routes')) {
      if (routesEmpty) return http.Response('{"routes":[]}', 200);
      return createBodies.isEmpty && onlineBodies.isEmpty
          ? http.Response('{"routes":[$_routeJson]}', 200)
          : _utf8('{"routes":[$_namedRouteJson]}', 200);
    }
    if (routeBased && path.endsWith('/matches/match_1')) {
      return _utf8('{"match":$_routeMatchJson}', 200);
    }
    if (routeBased && path.endsWith('/matches')) {
      return _utf8('{"matches":[$_routeMatchJson]}', 200);
    }
    if (routeBased && path.endsWith('/trips/trip_1')) {
      return _utf8('{"trip":$_routeTripJson}', 200);
    }
    if (path.endsWith('/matches/match_1/accept')) {
      return acceptResponse?.future ??
          http.Response(
            '{"trip":{"id":"trip_1","status":"accepted"},"matchId":"match_1"}',
            201,
          );
    }
    if (path.endsWith('/matches/match_1/reject')) {
      return http.Response('{"match":{"status":"rejected"}}', 200);
    }
    if (path.endsWith('/matches/match_1')) {
      return http.Response('{"match":$_matchJson}', 200);
    }
    if (path.endsWith('/matches')) {
      return http.Response('{"matches":[$_matchJson]}', 200);
    }
    if (path.endsWith('/trips/trip_1/simulate/step')) {
      locationSequence += 1;
      return http.Response(
        '{"location":${_locationJson(locationSequence)}}',
        201,
      );
    }
    if (path.endsWith('/trips/trip_1/simulate/reset')) {
      locationSequence = 0;
      return http.Response('{"ok":true}', 200);
    }
    if (path.endsWith('/trips/trip_1/location')) {
      return http.Response(
        '{"location":${_locationJson(locationSequence)}}',
        200,
      );
    }
    if (path.endsWith('/trips/trip_1/status')) {
      return http.Response('{"trip":{"status":"pickup_started"}}', 200);
    }
    if (path.endsWith('/trips/trip_1')) {
      return http.Response('{"trip":$_tripJson}', 200);
    }
    if (path.endsWith('/trips')) {
      return http.Response('{"trips":[$_tripJson]}', 200);
    }
    return http.Response('{"error":"not_found"}', 404);
  }
}

Future<http.Response> Function(http.Request request) _roleHandler(String role) {
  return (request) async {
    final path = request.url.path;
    if (path.endsWith('/me')) return http.Response(_meBody(role), 200);
    if (path.endsWith('/passenger/requests/active')) {
      return http.Response('{"requests":[]}', 200);
    }
    if (path.endsWith('/trips')) return http.Response('{"trips":[]}', 200);
    return http.Response('{"error":"not_found"}', 404);
  };
}

String _meBody(String role) => '{"user":${_userBody(role)}}';

String _userBody(String role) {
  final name = switch (role) {
    'driver' => 'Demo Driver',
    'merchant' => 'Demo Merchant',
    _ => 'Demo Passenger',
  };
  return '{"id":"user_1","name":"$name","phone":"+970590000002","role":"$role","demo_account":true}';
}

const _routeJson =
    '{"id":"route_1","origin_label":"Hebron / PPU / Bab Al-Zawiya","origin_lat":"31.532600","origin_lng":"35.099800","destination_label":"Bethlehem","destination_lat":"31.705400","destination_lng":"35.202400","corridor_key":"hebron-ppu-bab-al-zawiya-to-bethlehem","seats_available":2,"parcel_capacity_available":5,"status":"active","activated_at":"2026-07-13T08:00:00.000Z","completed_at":null}';

const _assignedRouteJson =
    '{"id":"route_1","origin_label":"Hebron / PPU / Bab Al-Zawiya","origin_lat":"31.532600","origin_lng":"35.099800","destination_label":"Bethlehem","destination_lat":"31.705400","destination_lng":"35.202400","corridor_key":"hebron-ppu-bab-al-zawiya-to-bethlehem","seats_available":2,"parcel_capacity_available":5,"status":"assigned","activated_at":"2026-07-13T08:00:00.000Z","completed_at":null}';

const _matchJson =
    '{"id":"match_1","status":"proposed","score":"0.9317","method":"darb_route_score","explanation":"Safe explanation","scoring_breakdown":{"corridorOverlap":0.95,"pickupDistanceScore":0.82,"timingFit":0.9,"trustScore":0.86,"capacityFit":1,"finalScore":0.9317},"created_at":"2026-07-13T08:10:00.000Z","driver_route":{"id":"route_1","origin_label":"Hebron / PPU / Bab Al-Zawiya","destination_label":"Bethlehem","corridor_key":"hebron-ppu-bab-al-zawiya-to-bethlehem","seats_available":2,"parcel_capacity_available":5,"status":"active","driver":{"vehicle_type":"sedan","verified":true,"trust_score":86}},"passenger_request":{"id":"request_1","pickup_label":"PPU Main Gate","destination_label":"Bethlehem Center","preferred_time":"2026-07-13T09:00:00.000Z","passenger_count":1,"status":"pending","created_at":"2026-07-13T08:00:00.000Z"},"merchant_order":null,"parcel_batch":null}';

const _tripJson =
    '{"id":"trip_1","status":"accepted","created_at":"2026-07-13T08:20:00.000Z","started_at":"2026-07-13T08:20:00.000Z","completed_at":null,"driver_route":$_assignedRouteJson,"passenger_request":{"id":"request_1","pickup_label":"PPU Main Gate","destination_label":"Bethlehem Center","passenger_count":1,"status":"accepted"},"merchant_order":null,"parcel_batch":null}';

const _routeFields =
    '"service_route_id":"route-heb-bth","route_name_ar":"الخليل ← بيت لحم","route_name_en":"Hebron → Bethlehem"';

const _namedRouteJson =
    '{"id":"route_1","origin_label":"Hebron","origin_lat":31.5326,"origin_lng":35.0998,"destination_label":"Bethlehem","destination_lat":31.7054,"destination_lng":35.2024,"corridor_key":"hebron-to-bethlehem",$_routeFields,"seats_available":2,"parcel_capacity_available":5,"status":"active","activated_at":"2026-07-13T08:00:00.000Z","completed_at":null}';

const _routePassengerJson =
    '{"id":"request_1","pickup_label":"Hebron","destination_label":"Bethlehem",$_routeFields,"pickup_details":"قرب البوابة الرئيسية لجامعة البوليتكنك","dropoff_details":"محطة باصات بيت لحم","pickup_lat":31.5326,"pickup_lng":35.0998,"destination_lat":31.7054,"destination_lng":35.2024,"passenger_count":1,"status":"accepted"}';

const _routeMatchJson =
    '{"id":"match_1","status":"proposed","score":"0.9317","method":"darb_route_score","explanation":"Same route","scoring_breakdown":{"corridorOverlap":1,"pickupDistanceScore":0.82,"timingFit":0.9,"trustScore":0.86,"capacityFit":1,"finalScore":0.9317},"created_at":"2026-07-13T08:10:00.000Z","driver_route":{"id":"route_1","origin_label":"Hebron","destination_label":"Bethlehem","corridor_key":"hebron-to-bethlehem",$_routeFields,"seats_available":2,"parcel_capacity_available":5,"status":"active"},"passenger_request":$_routePassengerJson,"merchant_order":null,"parcel_batch":null}';

const _routeTripJson =
    '{"id":"trip_1","status":"accepted","created_at":"2026-07-13T08:20:00.000Z","started_at":"2026-07-13T08:20:00.000Z","completed_at":null,"driver_route":$_namedRouteJson,"passenger_request":$_routePassengerJson,"merchant_order":{"id":"order_1","pickup_label":"Hebron",$_routeFields,"pickup_details":"متجر الأمل، شارع عين سارة","status":"assigned","parcels":[{"id":"p1","destination_label":"Bethlehem","dropoff_details":"شارع المهد، البوابة الزرقاء","receiver_name":"سارة","receiver_phone":"+970599123456","size":"S","priority":"normal","status":"pending"}]},"parcel_batch":null}';

String _locationJson(int sequence) =>
    '{"lat":"31.532600","lng":"35.099800","source":"simulated","sequence":$sequence,"recorded_at":"2026-07-13T08:21:00.000Z"}';
