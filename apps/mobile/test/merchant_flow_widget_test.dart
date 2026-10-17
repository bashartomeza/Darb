import 'dart:convert';

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

void main() {
  testWidgets('merchant dashboard is Arabic RTL and language persists', (
    tester,
  ) async {
    await _pumpMerchant(tester, _MerchantHandler());

    expect(
      find.byKey(const ValueKey('merchantDashboardTitle')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('merchantHome')), findsOneWidget);
    expect(
      Directionality.of(
        tester.element(find.byKey(const ValueKey('merchantHome'))),
      ),
      TextDirection.rtl,
    );

    await tester.tap(find.byTooltip('English'));
    await tester.pumpAndSettle();
    expect(find.text('Create a new shipment'), findsOneWidget);
    expect(
      Directionality.of(
        tester.element(find.byKey(const ValueKey('merchantHome'))),
      ),
      TextDirection.ltr,
    );
    final preferences = await SharedPreferences.getInstance();
    expect(preferences.getString(DomainLabels.localeStorageKey), 'en');
  });

  testWidgets('locked order form has parcels but no editable coordinates', (
    tester,
  ) async {
    final handler = _MerchantHandler(hasOrder: false);
    await _pumpMerchant(tester, handler);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/order/new');
    await tester.pumpAndSettle();

    expect(find.text('نقطة الاستلام الثابتة'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);
    await tester.tap(find.byKey(const ValueKey('addParcelButton')));
    await tester.tap(find.byKey(const ValueKey('addParcelButton')));
    await tester.pump();
    expect(find.textContaining('(3/10)'), findsOneWidget);

    await tester.ensureVisible(
      find.byKey(const ValueKey('submitMerchantOrder')),
    );
    await tester.tap(find.byKey(const ValueKey('submitMerchantOrder')));
    await tester.pumpAndSettle();
    expect(handler.createBody?['pickup_lat'], 31.5326);
    expect(handler.createBody?['pickup_lng'], 35.0998);
    expect(handler.createBody?['parcels'], hasLength(3));
    expect(find.byKey(const ValueKey('merchantOrderId')), findsOneWidget);
  });

  testWidgets('merchant batches, matches, and sees read-only scoring', (
    tester,
  ) async {
    final handler = _MerchantHandler();
    await _pumpMerchant(tester, handler);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/order/order_1');
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const ValueKey('createBatchButton')));
    await tester.tap(find.byKey(const ValueKey('createBatchButton')));
    await tester.pumpAndSettle();
    expect(handler.batchCalls, 1);
    expect(find.textContaining('43.06'), findsOneWidget);

    await tester.ensureVisible(
      find.byKey(const ValueKey('runMerchantMatchButton')),
    );
    await tester.tap(find.byKey(const ValueKey('runMerchantMatchButton')));
    await tester.pumpAndSettle();
    expect(handler.matchCalls, 1);
    expect(
      find.byKey(const ValueKey('merchantMatchDetail')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('merchantReadOnlyNotice')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('acceptMatchButton')), findsNothing);
    expect(find.byKey(const ValueKey('rejectMatchButton')), findsNothing);
  });

  testWidgets('merchant trip is read-only and shows order and location', (
    tester,
  ) async {
    final handler = _MerchantHandler(withTrip: true, initiallyBatched: true);
    await _pumpMerchant(tester, handler);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/trip/trip_1');
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('merchantTripStatus')), findsOneWidget);
    expect(
      find.byKey(const ValueKey('merchantTripOrderStatus')),
      findsOneWidget,
    );
    expect(find.textContaining('31.65'), findsWidgets);
    expect(find.textContaining('سوق بيت لحم'), findsWidgets);
    expect(find.byKey(const ValueKey('simulateStepButton')), findsNothing);
    expect(
      find.byKey(const ValueKey('tripAction-pickup_started')),
      findsNothing,
    );
  });

  testWidgets('merchant route guards block passenger and driver screens', (
    tester,
  ) async {
    await _pumpMerchant(tester, _MerchantHandler());
    final router = GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    );
    router.go('/driver/route');
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('merchantHome')), findsOneWidget);
    expect(find.text('تفاصيل المسار'), findsNothing);

    router.go('/passenger/request/new');
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('merchantHome')), findsOneWidget);
    expect(find.text('إنشاء طلب رحلة'), findsNothing);
  });

  testWidgets('unauthenticated merchant route redirects to login', (
    tester,
  ) async {
    await _pumpMerchant(tester, _MerchantHandler(), authenticated: false);
    GoRouter.of(tester.element(find.text('مساري'))).go('/merchant/order/new');
    await tester.pumpAndSettle();
    expect(find.text('تسجيل الدخول'), findsWidgets);
    expect(find.text('إنشاء طلب'), findsNothing);
  });
}

Future<void> _pumpMerchant(
  WidgetTester tester,
  _MerchantHandler handler, {
  bool authenticated = true,
}) async {
  tester.view.physicalSize = const Size(900, 2200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  SharedPreferences.setMockInitialValues({});
  FlutterSecureStorage.setMockInitialValues(
    authenticated ? {TokenStorage.tokenKey: 'merchant-token'} : {},
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(demoTestAppConfig),
        httpClientProvider.overrideWithValue(MockClient(handler.call)),
      ],
      child: const MasariApp(),
    ),
  );
  await tester.pumpAndSettle();
}

class _MerchantHandler {
  _MerchantHandler({
    this.hasOrder = true,
    this.withTrip = false,
    this.initiallyBatched = false,
  }) : batched = initiallyBatched;

  bool hasOrder;
  final bool withTrip;
  final bool initiallyBatched;
  bool batched;
  bool matched = false;
  int batchCalls = 0;
  int matchCalls = 0;
  Map<String, dynamic>? createBody;

  Future<http.Response> call(http.Request request) async {
    final path = request.url.path;
    if (path.endsWith('/me')) return http.Response(_meJson, 200);
    if (path.endsWith('/merchant/orders') && request.method == 'POST') {
      createBody = jsonDecode(request.body) as Map<String, dynamic>;
      hasOrder = true;
      return http.Response('{"order":${_orderJson(false)}}', 201);
    }
    if (path.endsWith('/merchant/orders')) {
      return http.Response(
        hasOrder ? '{"orders":[${_orderJson(batched)}]}' : '{"orders":[]}',
        200,
      );
    }
    if (path.endsWith('/merchant/orders/order_1/batch')) {
      batchCalls += 1;
      batched = true;
      return http.Response('{"batch":$_batchJson}', 201);
    }
    if (path.endsWith('/merchant/orders/order_1')) {
      return http.Response('{"order":${_orderJson(batched)}}', 200);
    }
    if (path.endsWith('/matches/run')) {
      matchCalls += 1;
      matched = true;
      return http.Response(
        '{"match":$_matchJson,"scoringBreakdown":$_scoringJson}',
        201,
      );
    }
    if (path.endsWith('/matches/match_1')) {
      return http.Response('{"match":$_matchJson}', 200);
    }
    if (path.endsWith('/matches')) {
      return http.Response(
        matched ? '{"matches":[$_matchJson]}' : '{"matches":[]}',
        200,
      );
    }
    if (path.endsWith('/trips/trip_1/location')) {
      return http.Response('{"location":$_locationJson}', 200);
    }
    if (path.endsWith('/trips/trip_1')) {
      return http.Response('{"trip":$_tripJson}', 200);
    }
    if (path.endsWith('/trips')) {
      return http.Response(
        withTrip ? '{"trips":[$_tripJson]}' : '{"trips":[]}',
        200,
      );
    }
    return http.Response('{"error":"not_found"}', 404);
  }
}

const _meJson =
    '{"user":{"id":"merchant_1","name":"Demo Merchant","phone":"+970590000004","role":"merchant","demo_account":true}}';
const _routeJson =
    '{"id":"route_1","origin_label":"Hebron / PPU / Bab Al-Zawiya","destination_label":"Bethlehem","corridor_key":"hebron-ppu-bab-al-zawiya-to-bethlehem","parcel_capacity_available":5,"status":"active"}';
const _batchJson =
    '{"id":"batch_1","status":"created","estimated_distance_saved":"43.06","explanation":"Three parcels share one corridor trip.","created_at":"2026-07-13T08:05:00.000Z","driver_route":$_routeJson}';
const _parcelsJson =
    '[{"id":"parcel_1","destination_label":"Bethlehem Market","size":"S","priority":"normal","status":"pending"},{"id":"parcel_2","destination_label":"Manger Street","size":"M","priority":"high","status":"pending"},{"id":"parcel_3","destination_label":"Bethlehem Center","size":"L","priority":"low","status":"pending"}]';
String _orderJson(bool batched) =>
    '{"id":"order_1","pickup_label":"Hebron Merchant Pickup","status":"${batched ? 'batched' : 'submitted'}","created_at":"2026-07-13T08:00:00.000Z","parcels":$_parcelsJson,"parcel_batches":${batched ? '[$_batchJson]' : '[]'}}';
const _scoringJson =
    '{"corridorOverlap":0.95,"pickupDistanceScore":0.82,"timingFit":0.9,"trustScore":0.86,"capacityFit":1,"finalScore":0.9317}';
const _matchJson =
    '{"id":"match_1","status":"proposed","score":"0.9317","method":"masari_route_score","explanation":"Safe explanation","scoring_breakdown":$_scoringJson,"created_at":"2026-07-13T08:10:00.000Z","driver_route":$_routeJson,"merchant_order":{"id":"order_1","pickup_label":"Hebron Merchant Pickup","status":"batched","parcel_count":3,"created_at":"2026-07-13T08:00:00.000Z"},"parcel_batch":null}';
const _tripJson =
    '{"id":"trip_1","status":"in_transit","created_at":"2026-07-13T08:20:00.000Z","driver_route":$_routeJson,"merchant_order":{"id":"order_1","pickup_label":"Hebron Merchant Pickup","status":"in_transit","created_at":"2026-07-13T08:00:00.000Z","parcels":$_parcelsJson},"parcel_batch":null}';
const _locationJson =
    '{"lat":"31.650000","lng":"35.150000","source":"simulated","sequence":2,"recorded_at":"2026-07-13T08:21:00.000Z"}';
