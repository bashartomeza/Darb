import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
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
  testWidgets(
    'merchant screens fit narrow phones and keep order filters usable',
    (tester) async {
      const pathProvider = MethodChannel('plugins.flutter.io/path_provider');
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        pathProvider,
        (_) async => Directory('build/merchant-design/cache').absolute.path,
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          pathProvider,
          null,
        ),
      );
      final shadowsWereDisabled = debugDisableShadows;
      debugDisableShadows = false;
      addTearDown(() => debugDisableShadows = shadowsWereDisabled);
      if (const bool.fromEnvironment('MERCHANT_SCREENSHOTS')) {
        final loader = FontLoader('IBMPlexSansArabic');
        for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
          loader.addFont(
            rootBundle.load('assets/fonts/IBMPlexSansArabic-$weight.ttf'),
          );
        }
        await loader.load();
        final icons = FontLoader('MaterialIcons')
          ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
        await icons.load();
      }
      await _pumpMerchant(
        tester,
        _MerchantHandler(withTrip: true, designPreview: true),
      );
      final router = GoRouter.of(
        tester.element(find.byKey(const ValueKey('merchantHome'))),
      );
      for (final width in [390.0, 320.0]) {
        tester.view.physicalSize = Size(width, 844);
        await tester.pumpAndSettle();
        for (final screen in [
          ('home', '/merchant'),
          ('orders', '/merchant/shipments'),
          ('detail', '/merchant/order/order_1'),
          ('tracking', '/merchant/trip/trip_1'),
          ('profile', '/merchant/account'),
          ('notifications', '/merchant/notifications'),
        ]) {
          router.go(screen.$2);
          await tester.pumpAndSettle();
          expect(
            tester.takeException(),
            isNull,
            reason: '${screen.$1} at $width',
          );
          if (width == 390 &&
              const bool.fromEnvironment('MERCHANT_SCREENSHOTS')) {
            final boundary = tester.renderObject<RenderRepaintBoundary>(
              find.byKey(const ValueKey('merchantCapture')),
            );
            await tester.runAsync(() async {
              final image = await boundary.toImage(pixelRatio: 2);
              final bytes = await image.toByteData(
                format: ui.ImageByteFormat.png,
              );
              await Directory('build/merchant-design').create(recursive: true);
              await File(
                'build/merchant-design/${screen.$1}.png',
              ).writeAsBytes(bytes!.buffer.asUint8List());
              image.dispose();
            });
          }
        }
      }
      router.go('/merchant/shipments');
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('merchantOrderFilter-completed')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('merchantShipment-order_1')),
        findsNothing,
      );
      await tester.tap(
        find.byKey(const ValueKey('merchantOrderFilter-newOrders')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('merchantShipment-order_1')),
        findsOneWidget,
      );
      router.go('/merchant/account');
      await tester.pumpAndSettle();
      await tester.ensureVisible(
        find.byKey(const ValueKey('securitySessionsButton')),
      );
      await tester.tap(find.byKey(const ValueKey('securitySessionsButton')));
      await tester.pumpAndSettle();
      expect(find.text('الأمان والجلسات'), findsWidgets);
      debugDisableShadows = shadowsWereDisabled;
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );
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
    expect(handler.createKey, matches(RegExp(r'^[A-Za-z0-9._:-]{8,128}$')));
    expect(handler.createBody?['pickup_lat'], 31.5326);
    expect(handler.createBody?['pickup_lng'], 35.0998);
    expect(handler.createBody?['parcels'], hasLength(3));
    expect(find.byKey(const ValueKey('merchantOrderId')), findsOneWidget);
  });

  testWidgets(
    'lost order response recovers after app restart without another POST',
    (tester) async {
      final handler = _MerchantHandler(hasOrder: false)
        ..loseNextResponse = true;
      await _pumpMerchant(tester, handler);
      GoRouter.of(
        tester.element(find.byKey(const ValueKey('merchantHome'))),
      ).go('/merchant/order/new');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('addParcelButton')));
      await tester.pump();
      await tester.ensureVisible(
        find.byKey(const ValueKey('submitMerchantOrder')),
      );
      await tester.tap(find.byKey(const ValueKey('submitMerchantOrder')));
      await tester.pumpAndSettle();
      expect(handler.createCalls, 1);
      final persisted = await const FlutterSecureStorage().readAll();
      expect(
        persisted.values.any(
          (value) =>
              value.contains('idempotency_key') &&
              value.contains('Bethlehem Market'),
        ),
        isTrue,
      );
      final originalKey = handler.createKey;
      GoRouter.of(
        tester.element(find.byKey(const ValueKey('merchantCreateOrder'))),
      ).go('/merchant');
      await tester.pumpAndSettle();
      expect(handler.createCalls, 1);
      expect(
        (await const FlutterSecureStorage().readAll()).values.any(
          (value) => value.contains('idempotency_key'),
        ),
        isTrue,
      );
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await _pumpMerchant(tester, handler, resetStorage: false);
      GoRouter.of(
        tester.element(find.byKey(const ValueKey('merchantHome'))),
      ).go('/merchant/order/new');
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('merchantOrderId')), findsOneWidget);
      expect(handler.createCalls, 1);
      expect(handler.lookupKeys, [originalKey]);
      expect(
        (await const FlutterSecureStorage().readAll()).values.any(
          (value) => value.contains('idempotency_key'),
        ),
        isFalse,
      );
    },
  );

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
      find.byKey(const ValueKey('merchantScoringBreakdown')),
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
    GoRouter.of(
      tester.element(find.text('أهلاً بعودتك')),
    ).go('/merchant/order/new');
    await tester.pumpAndSettle();
    expect(find.text('تسجيل الدخول'), findsWidgets);
    expect(find.text('إنشاء طلب'), findsNothing);
  });
  testWidgets(
    'waiting merchant match reconciles driver decision without refresh',
    (tester) async {
      final handler = _MerchantHandler()..matched = true;
      await _pumpMerchant(tester, handler);
      GoRouter.of(
        tester.element(find.byKey(const ValueKey('merchantHome'))),
      ).go('/merchant/match/match_1');
      await tester.pumpAndSettle();
      handler.matchStatus = 'accepted';
      await tester.pump(const Duration(seconds: 6));
      await tester.pumpAndSettle();
      expect(find.text('مقبول'), findsWidgets);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('rejected merchant order exposes existing manual match action', (
    tester,
  ) async {
    final handler = _MerchantHandler(initiallyBatched: true)
      ..matched = true
      ..matchStatus = 'rejected';
    await _pumpMerchant(tester, handler);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/order/order_1');
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('runMerchantMatchButton')),
      findsOneWidget,
    );
    await tester.pumpWidget(const SizedBox.shrink());
  });
}

Future<void> _pumpMerchant(
  WidgetTester tester,
  _MerchantHandler handler, {
  bool authenticated = true,
  bool resetStorage = true,
}) async {
  tester.view.physicalSize = const Size(900, 2200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  if (resetStorage) {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues(
      authenticated ? {TokenStorage.tokenKey: 'merchant-token'} : {},
    );
  }
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(demoTestAppConfig),
        httpClientProvider.overrideWithValue(MockClient(handler.call)),
      ],
      child: const RepaintBoundary(
        key: ValueKey('merchantCapture'),
        child: MasariApp(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _MerchantHandler {
  _MerchantHandler({
    this.hasOrder = true,
    this.withTrip = false,
    this.initiallyBatched = false,
    this.designPreview = false,
  }) : batched = initiallyBatched;

  bool hasOrder;
  final bool withTrip;
  final bool initiallyBatched;
  final bool designPreview;
  bool batched;
  bool matched = false;
  String matchStatus = 'proposed';
  int batchCalls = 0;
  int matchCalls = 0;
  Map<String, dynamic>? createBody;
  String? createKey;
  bool loseNextResponse = false;
  int createCalls = 0;
  final lookupKeys = <String?>[];

  String _createdOrderJson() => jsonEncode({
    ...jsonDecode(_orderJson(false)) as Map<String, dynamic>,
    'parcels': [
      for (final entry in (createBody!['parcels'] as List).indexed)
        {
          'id': 'parcel_${entry.$1}',
          ...entry.$2 as Map<String, dynamic>,
          'status': 'pending',
        },
    ],
  });

  Future<http.Response> call(http.Request request) async {
    final path = request.url.path;
    if (path.endsWith('/me')) {
      return http.Response(
        designPreview
            ? _meJson.replaceFirst('Demo Merchant', 'متجر ذكريات')
            : _meJson,
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    }
    if (designPreview && path.endsWith('/notifications')) {
      return http.Response(
        jsonEncode({
          'notifications': [
            for (final (index, type) in [
              'match_offered',
              'match_accepted',
              'trip_status',
              'trip_status',
              'driver_approaching',
            ].indexed)
              {
                'id': 'notification_$index',
                'type': type,
                'entity_type': type.startsWith('match') ? 'Match' : 'Trip',
                'entity_id': type.startsWith('match') ? 'match_1' : 'trip_1',
                'params': {'status': index == 2 ? 'delivered' : 'in_transit'},
                'created_at': '2026-11-03T08:20:00.000Z',
              },
          ],
          'unread_count': 5,
        }),
        200,
      );
    }
    if (designPreview &&
        path.contains('/notifications/') &&
        request.method == 'POST') {
      return http.Response('{}', 200);
    }
    if (path.endsWith('/merchant/order-operation')) {
      lookupKeys.add(request.headers['idempotency-key']);
      return hasOrder
          ? http.Response('{"order":${_createdOrderJson()}}', 200)
          : http.Response(
              '{"error":"merchant_order_operation_not_found"}',
              404,
            );
    }
    if (path.endsWith('/merchant/orders') && request.method == 'POST') {
      createCalls++;
      createKey = request.headers['idempotency-key'];
      createBody = jsonDecode(request.body) as Map<String, dynamic>;
      hasOrder = true;
      if (loseNextResponse) {
        loseNextResponse = false;
        throw http.ClientException('synthetic response loss after commit');
      }
      return http.Response('{"order":${_createdOrderJson()}}', 201);
    }
    if (path.endsWith('/merchant/orders')) {
      if (designPreview) {
        return http.Response(
          jsonEncode({
            'orders': [
              jsonDecode(_orderJson(batched)),
              for (final (index, status) in [
                'in_transit',
                'completed',
                'completed',
              ].indexed)
                {
                  ...jsonDecode(_orderJson(false)) as Map<String, dynamic>,
                  'id': 'order_${index + 2}',
                  'status': status,
                },
            ],
          }),
          200,
        );
      }
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
      return http.Response(
        '{"order":${createBody == null ? _orderJson(batched) : _createdOrderJson()}}',
        200,
      );
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
      return http.Response(
        '{"match":${_matchJson.replaceFirst('"proposed"', '"$matchStatus"')}}',
        200,
      );
    }
    if (path.endsWith('/matches')) {
      return http.Response(
        matched
            ? '{"matches":[${_matchJson.replaceFirst('"proposed"', '"$matchStatus"')}]}'
            : '{"matches":[]}',
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
