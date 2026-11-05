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
import 'package:darb_mobile/app.dart';
import 'package:darb_mobile/core/api/api_client.dart';
import 'package:darb_mobile/core/config/app_config.dart';
import 'package:darb_mobile/core/fares/fare.dart';
import 'package:darb_mobile/core/i18n/domain_labels.dart';
import 'package:darb_mobile/features/auth/data/token_storage.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/operating_routes_fixture.dart';
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

  testWidgets('order form sends the route, pickup details and each drop-off', (
    tester,
  ) async {
    final handler = _MerchantHandler(hasOrder: false);
    await _pumpMerchant(tester, handler);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/order/new');
    await tester.pumpAndSettle();

    // The helpful Arabic hint and the route list from the server.
    expect(find.text('مثال: اسم المتجر والشارع'), findsOneWidget);
    expect(find.byKey(const ValueKey('merchantRouteField')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('addParcelButton')));
    await tester.pump();
    expect(find.textContaining('(2/10)'), findsOneWidget);

    await _fillOrder(tester);
    await tester.enterText(
      find.byKey(const ValueKey('parcelDropoff-1')),
      'شارع المهد قرب الصيدلية',
    );
    await tester.enterText(
      find.byKey(const ValueKey('parcelReceiverName-1')),
      'سارة',
    );
    await tester.enterText(
      find.byKey(const ValueKey('parcelReceiverPhone-1')),
      '+970599123456',
    );
    await _submit(tester);

    expect(handler.createKey, matches(RegExp(r'^[A-Za-z0-9._:-]{8,128}$')));
    expect(handler.createBody, {
      'service_route_id': 'route-heb-bth',
      'pickup_details': 'متجر الأمل، شارع عين سارة',
      'parcels': [
        {
          'dropoff_details': 'قرب بوابة جامعة بيت لحم',
          'size': 'S',
          'priority': 'normal',
        },
        {
          'dropoff_details': 'شارع المهد قرب الصيدلية',
          'size': 'S',
          'priority': 'normal',
          'receiver_name': 'سارة',
          'receiver_phone': '+970599123456',
        },
      ],
    });
    expect(handler.paths.where((path) => path.contains('corridor')), isEmpty);
    // The new order shows its route and the merchant's own words.
    expect(find.byKey(const ValueKey('merchantOrderId')), findsOneWidget);
    expect(
      tester
          .widget<Text>(find.byKey(const ValueKey('merchantOrderRoute')))
          .data,
      'الخليل ← بيت لحم',
    );
    expect(
      tester
          .widget<Text>(find.byKey(const ValueKey('merchantOrderPickup')))
          .data,
      'متجر الأمل، شارع عين سارة',
    );
    expect(find.text('شارع المهد قرب الصيدلية'), findsOneWidget);

    // The redesigned order list names the route and the typed drop-offs too.
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantOrderId'))),
    ).go('/merchant/shipments');
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<Text>(
            find.byKey(const ValueKey('merchantOrderCardRoute-order_1')),
          )
          .data,
      'الخليل ← بيت لحم',
    );
    expect(find.textContaining('قرب بوابة جامعة بيت لحم'), findsOneWidget);
  });

  testWidgets('order form asks for a route and real details before sending', (
    tester,
  ) async {
    final handler = _MerchantHandler(hasOrder: false);
    await _pumpMerchant(tester, handler);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/order/new');
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const ValueKey('merchantPickupDetailsField')),
      'ab',
    );
    await tester.enterText(
      find.byKey(const ValueKey('parcelReceiverPhone-0')),
      'call me',
    );
    await _submit(tester);
    expect(handler.createCalls, 0);
    expect(find.text('اختر المسار أولاً.'), findsOneWidget);
    expect(
      find.text('اكتب 3 أحرف على الأقل ليجد السائق المكان.'),
      findsNWidgets(2),
    );
    expect(
      find.text('أدخل رقم هاتف صحيحاً، مثل ‎+970599123456.'),
      findsOneWidget,
    );
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
      await _fillOrder(tester);
      await _submit(tester);
      expect(handler.createCalls, 1);
      final persisted = await const FlutterSecureStorage().readAll();
      expect(
        persisted.values.any(
          (value) =>
              value.contains('idempotency_key') &&
              value.contains('route-heb-bth'),
        ),
        isTrue,
      );
      // The saved order is shown exactly as it will be resent.
      expect(
        find.byKey(const ValueKey('merchantPendingOrder')),
        findsOneWidget,
      );
      expect(find.text('متجر الأمل، شارع عين سارة'), findsOneWidget);
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

  testWidgets('an order saved before routes existed is resent as saved', (
    tester,
  ) async {
    final handler = _MerchantHandler(hasOrder: false);
    await _pumpMerchant(
      tester,
      handler,
      secure: {
        'darb_merchant_order_v1:merchant_1': jsonEncode({
          'version': 1,
          'actor_id': 'merchant_1',
          'idempotency_key': 'old-order-key-0001',
          'payload': _corridorPayload,
          'created_at': DateTime.now().toUtc().toIso8601String(),
        }),
      },
    );
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/order/new');
    await tester.pumpAndSettle();

    // Shown as saved, with its corridor places, and not editable.
    expect(find.byKey(const ValueKey('merchantPendingOrder')), findsOneWidget);
    expect(
      tester
          .widget<Text>(find.byKey(const ValueKey('merchantPickupLabel')))
          .data,
      'باب الزاوية',
    );
    expect(find.byKey(const ValueKey('merchantRouteField')), findsNothing);

    await _submit(tester);
    expect(handler.createCalls, 1);
    expect(handler.createKey, 'old-order-key-0001');
    expect(handler.createBody, _corridorPayload);
    expect(find.byKey(const ValueKey('merchantOrderId')), findsOneWidget);
  });

  testWidgets('a saved order refused on resend is removed and the form opens', (
    tester,
  ) async {
    final handler = _MerchantHandler(hasOrder: false)
      ..createRefusal = http.Response('{"error":"route_unavailable"}', 409);
    await _pumpMerchant(tester, handler, secure: _savedRouteOrder());
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/order/new');
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('merchantPendingOrder')), findsOneWidget);
    expect(find.byKey(const ValueKey('merchantRouteField')), findsNothing);

    await _submit(tester);
    expect(handler.createCalls, 1);
    expect(handler.createKey, 'saved-order-key-0001');
    // Removed and unlocked, with a message saying so.
    expect(find.byKey(const ValueKey('merchantPendingOrder')), findsNothing);
    expect(find.byKey(const ValueKey('merchantRouteField')), findsOneWidget);
    expect(find.textContaining('لم يقبل درب الطلب المحفوظ'), findsOneWidget);
    expect(
      (await const FlutterSecureStorage().readAll()).values.any(
        (value) => value.contains('idempotency_key'),
      ),
      isFalse,
    );
  });

  testWidgets('a saved order can be discarded after confirming', (
    tester,
  ) async {
    final handler = _MerchantHandler(hasOrder: false);
    await _pumpMerchant(tester, handler, secure: _savedRouteOrder());
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/order/new');
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('merchantPendingOrder')), findsOneWidget);

    // Cancelling keeps it.
    await tester.ensureVisible(
      find.byKey(const ValueKey('discardSavedRequest')),
    );
    await tester.tap(find.byKey(const ValueKey('discardSavedRequest')));
    await tester.pumpAndSettle();
    expect(find.textContaining('طلب مكرر'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('cancelDiscardSavedRequest')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('merchantPendingOrder')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('discardSavedRequest')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('confirmDiscardSavedRequest')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('merchantPendingOrder')), findsNothing);
    expect(find.byKey(const ValueKey('merchantRouteField')), findsOneWidget);
    expect(find.byKey(const ValueKey('discardSavedRequest')), findsNothing);
    expect(handler.createCalls, 0);
    expect(
      (await const FlutterSecureStorage().readAll()).values.any(
        (value) => value.contains('idempotency_key'),
      ),
      isFalse,
    );
  });

  testWidgets('order form waits for the routes and can retry them', (
    tester,
  ) async {
    final handler = _MerchantHandler(hasOrder: false)..routesFail = true;
    await _pumpMerchant(tester, handler);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/order/new');
    await tester.pumpAndSettle();

    VoidCallback? submit() => tester
        .widget<FilledButton>(find.byKey(const ValueKey('submitMerchantOrder')))
        .onPressed;
    expect(find.byKey(const ValueKey('merchantRoutesError')), findsOneWidget);
    expect(submit(), isNull);

    handler.routesFail = false;
    await tester.tap(find.byKey(const ValueKey('merchantRoutesRetry')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('merchantRoutesError')), findsNothing);
    expect(find.byKey(const ValueKey('merchantRouteField')), findsOneWidget);
    expect(submit(), isNotNull);
  });

  testWidgets('order form cannot be sent while no route is running', (
    tester,
  ) async {
    final handler = _MerchantHandler(hasOrder: false)..routesEmpty = true;
    await _pumpMerchant(tester, handler);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/order/new');
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('merchantRoutesEmpty')), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('submitMerchantOrder')),
          )
          .onPressed,
      isNull,
    );
    expect(handler.createCalls, 0);
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

  testWidgets('order detail shows the fare frozen on the order', (
    tester,
  ) async {
    final handler = _MerchantHandler()
      ..orderFare = {
        'currency': 'ILS',
        'unit_minor': null,
        'total_minor': 2300,
        'estimated': true,
        'paid_directly_to_driver': true,
      };
    await _pumpMerchant(tester, handler);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/order/order_1');
    await tester.pumpAndSettle();
    final box = find.byKey(const ValueKey('fareEstimateBox'));
    await tester.ensureVisible(box);
    // The app's own language decides the wording; read it from the box.
    final context = tester.element(box);
    final l10n = AppLocalizations.of(context);
    final language = Localizations.localeOf(context).languageCode;
    Finder inBox(String text) =>
        find.descendant(of: box, matching: find.text(text));
    expect(inBox(l10n.fareBookedTitle), findsOneWidget);
    expect(inBox(l10n.fareTotal), findsOneWidget);
    expect(inBox(formatFare(2300, 'ILS', language)), findsOneWidget);
  });

  testWidgets('order detail shows no fare when the route had none', (
    tester,
  ) async {
    final handler = _MerchantHandler();
    await _pumpMerchant(tester, handler);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/order/order_1');
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('merchantOrderStatus')), findsOneWidget);
    expect(find.byKey(const ValueKey('fareEstimateBox')), findsNothing);
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
    expect(find.byKey(const ValueKey('merchantTripRoute')), findsOneWidget);
    expect(find.byKey(const ValueKey('merchantTripPickup')), findsOneWidget);
    expect(find.byKey(const ValueKey('merchantDeliveryMap')), findsOneWidget);
    expect(find.byKey(const ValueKey('simulateStepButton')), findsNothing);
    expect(
      find.byKey(const ValueKey('tripAction-pickup_started')),
      findsNothing,
    );
    // No driver phone in the trip, so nothing to call.
    expect(find.byKey(const ValueKey('driverCallCard')), findsNothing);
    expect(find.byKey(const ValueKey('callDriverButton')), findsNothing);
  });

  testWidgets('a batched delivery lists each of the merchant orders on it', (
    tester,
  ) async {
    final handler = _MerchantHandler(withTrip: true, initiallyBatched: true)
      ..batchTrip = true;
    await _pumpMerchant(tester, handler);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/trip/trip_1');
    await tester.pumpAndSettle();

    await tester.ensureVisible(
      find.byKey(const ValueKey('merchantTripOrders')),
    );
    expect(
      find.byKey(const ValueKey('merchantTripOrder-order_1')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('merchantTripOrder-order_2')),
      findsOneWidget,
    );
    expect(
      tester
          .widget<Text>(
            find.byKey(const ValueKey('merchantTripParcel-parcel_9')),
          )
          .data,
      'University gate · Sami',
    );
  });

  testWidgets(
    'match inbox shows the route and the typed pickup and drop-offs',
    (tester) async {
      final handler = _MerchantHandler()..routeMatch = true;
      await _pumpMerchant(tester, handler);
      GoRouter.of(
        tester.element(find.byKey(const ValueKey('merchantHome'))),
      ).go('/merchant/matches');
      await tester.pumpAndSettle();

      expect(find.text('Al Amal shop, Ein Sara Street'), findsOneWidget);
      expect(
        find.text('Manger Street, blue gate · University gate'),
        findsOneWidget,
      );
      expect(find.text('الخليل ← بيت لحم'), findsOneWidget);
    },
  );

  testWidgets('profile parcels show the typed drop-off and the route name', (
    tester,
  ) async {
    final handler = _MerchantHandler()
      ..createBody = {
        'service_route_id': 'route-heb-bth',
        'pickup_details': 'Al Amal shop',
        'parcels': [
          {
            'dropoff_details': 'Manger Street, blue gate',
            'size': 'S',
            'priority': 'normal',
          },
        ],
      };
    await _pumpMerchant(tester, handler);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/account');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('merchantProducts')));
    await tester.pumpAndSettle();

    expect(
      tester
          .widget<Text>(
            find.byKey(const ValueKey('merchantProfileParcel-parcel_0')),
          )
          .data,
      'Manger Street, blue gate',
    );
    expect(find.textContaining('الخليل ← بيت لحم'), findsOneWidget);
  });

  testWidgets('cancelling an order asks first and sends nothing on "keep"', (
    tester,
  ) async {
    final handler = _MerchantHandler(initiallyBatched: true);
    await _pumpMerchant(tester, handler);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/order/order_1');
    await tester.pumpAndSettle();

    final cancel = find.byKey(const ValueKey('cancelMerchantOrderButton'));
    await tester.ensureVisible(cancel);
    await tester.tap(cancel);
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('merchantCancelOrderDialog')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('merchantCancelOrderKeep')));
    await tester.pumpAndSettle();
    expect(handler.cancelCalls, 0);

    await tester.ensureVisible(cancel);
    await tester.tap(cancel);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('merchantCancelOrderConfirm')));
    await tester.pumpAndSettle();
    expect(handler.cancelCalls, 1);
  });

  testWidgets('merchant tracking offers to call the driver when sent', (
    tester,
  ) async {
    final handler = _MerchantHandler(withTrip: true, initiallyBatched: true)
      ..driverPhone = '+970599000111';
    await _pumpMerchant(tester, handler);
    GoRouter.of(
      tester.element(find.byKey(const ValueKey('merchantHome'))),
    ).go('/merchant/trip/trip_1');
    await tester.pumpAndSettle();
    final l10n = AppLocalizations.of(
      tester.element(find.byKey(const ValueKey('merchantTripStatus'))),
    );

    expect(find.byKey(const ValueKey('driverCallCard')), findsOneWidget);
    expect(find.text('+970599000111'), findsOneWidget);
    expect(find.byKey(const ValueKey('callDriverButton')), findsOneWidget);
    expect(find.text(l10n.callDriver), findsOneWidget);

    // The number and the action share one row, even on a narrow phone.
    tester.view.physicalSize = const Size(320, 844);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
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

/// Chooses the first route and types the pickup and the first drop-off.
Future<void> _fillOrder(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('merchantRouteField')));
  await tester.pumpAndSettle();
  await tester.tap(find.text('الخليل ← بيت لحم').last);
  await tester.pumpAndSettle();
  await tester.enterText(
    find.byKey(const ValueKey('merchantPickupDetailsField')),
    'متجر الأمل، شارع عين سارة',
  );
  await tester.enterText(
    find.byKey(const ValueKey('parcelDropoff-0')),
    'قرب بوابة جامعة بيت لحم',
  );
  await tester.pump();
}

Future<void> _submit(WidgetTester tester) async {
  await tester.ensureVisible(find.byKey(const ValueKey('submitMerchantOrder')));
  await tester.tap(find.byKey(const ValueKey('submitMerchantOrder')));
  await tester.pumpAndSettle();
}

/// A route order kept on the device because its response was lost.
Map<String, String> _savedRouteOrder() => {
  'darb_merchant_order_v1:merchant_1': jsonEncode({
    'version': 1,
    'actor_id': 'merchant_1',
    'idempotency_key': 'saved-order-key-0001',
    'payload': {
      'service_route_id': 'route-heb-bth',
      'pickup_details': 'متجر الأمل، شارع عين سارة',
      'parcels': [
        {
          'dropoff_details': 'قرب بوابة جامعة بيت لحم',
          'size': 'S',
          'priority': 'normal',
        },
      ],
    },
    'created_at': DateTime.now().toUtc().toIso8601String(),
  }),
};

/// An order saved by a build before routes existed.
const _corridorPayload = {
  'pickup_label': 'Bab Al-Zawiya',
  'pickup_lat': 31.5326,
  'pickup_lng': 35.0998,
  'parcels': [
    {
      'destination_label': 'Bethlehem Center',
      'destination_lat': 31.7054,
      'destination_lng': 35.2024,
      'size': 'S',
      'priority': 'normal',
    },
  ],
};

Future<void> _pumpMerchant(
  WidgetTester tester,
  _MerchantHandler handler, {
  bool authenticated = true,
  bool resetStorage = true,
  Map<String, String> secure = const {},
}) async {
  tester.view.physicalSize = const Size(900, 2200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  if (resetStorage) {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({
      if (authenticated) TokenStorage.tokenKey: 'merchant-token',
      ...secure,
    });
  }
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(demoTestAppConfig),
        httpClientProvider.overrideWithValue(MockClient(handler.call)),
      ],
      child: const RepaintBoundary(
        key: ValueKey('merchantCapture'),
        child: DarbApp(),
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

  /// The server's final refusal of the next order sent; nothing is saved.
  http.Response? createRefusal;
  bool routesFail = false;
  bool routesEmpty = false;
  int createCalls = 0;

  /// The order fare the detail read returns; none when null.
  Map<String, dynamic>? orderFare;

  /// The driver's phone the trip detail carries; none when null.
  String? driverPhone;

  /// Serve a route-based match (route name, typed pickup and drop-offs).
  bool routeMatch = false;

  /// Serve a trip that carries two of the merchant's orders in one batch.
  bool batchTrip = false;
  int cancelCalls = 0;
  final lookupKeys = <String?>[];
  final paths = <String>[];

  /// The created order as the server returns it: a route order gets the
  /// route's city labels and echoes its typed details; an older corridor
  /// order echoes its places.
  String _createdOrderJson() {
    final body = createBody!;
    final route = body['service_route_id'] != null;
    return jsonEncode({
      ...jsonDecode(_orderJson(false)) as Map<String, dynamic>,
      'pickup_label': body['pickup_label'] ?? 'Hebron',
      if (route) ...{
        'service_route_id': body['service_route_id'],
        'route_name_ar': 'الخليل ← بيت لحم',
        'route_name_en': 'Hebron → Bethlehem',
        'pickup_details': body['pickup_details'],
      },
      'parcels': [
        for (final entry in (body['parcels'] as List).indexed)
          {
            'id': 'parcel_${entry.$1}',
            if (route) 'destination_label': 'Bethlehem',
            ...entry.$2 as Map<String, dynamic>,
            'status': 'pending',
          },
      ],
    });
  }

  http.Response _utf8(String body, int status) => http.Response(
    body,
    status,
    headers: const {'content-type': 'application/json; charset=utf-8'},
  );

  Future<http.Response> call(http.Request request) async {
    final path = request.url.path;
    paths.add(path);
    if (path.endsWith('/me')) {
      return http.Response(
        designPreview
            ? _meJson.replaceFirst('Demo Merchant', 'متجر ذكريات')
            : _meJson,
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    }
    if (path.endsWith('/operating-routes')) {
      if (routesFail) {
        return http.Response('{"error":"internal_error"}', 500);
      }
      return _utf8(
        routesEmpty ? '{"routes":[]}' : jsonEncode(operatingRoutesJson()),
        200,
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
          ? _utf8('{"order":${_createdOrderJson()}}', 200)
          : http.Response(
              '{"error":"merchant_order_operation_not_found"}',
              404,
            );
    }
    if (path.endsWith('/merchant/orders') && request.method == 'POST') {
      createCalls++;
      createKey = request.headers['idempotency-key'];
      createBody = jsonDecode(request.body) as Map<String, dynamic>;
      final refusal = createRefusal;
      if (refusal != null) return refusal;
      hasOrder = true;
      if (loseNextResponse) {
        loseNextResponse = false;
        throw http.ClientException('synthetic response loss after commit');
      }
      return _utf8('{"order":${_createdOrderJson()}}', 201);
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
      return _utf8(
        !hasOrder
            ? '{"orders":[]}'
            : createBody == null
            ? '{"orders":[${_orderJson(batched)}]}'
            : '{"orders":[${_createdOrderJson()}]}',
        200,
      );
    }
    if (path.endsWith('/merchant/orders/order_1/batch')) {
      batchCalls += 1;
      batched = true;
      return http.Response('{"batch":$_batchJson}', 201);
    }
    if (path.endsWith('/merchant/orders/order_1')) {
      final order = createBody == null
          ? _orderJson(batched)
          : _createdOrderJson();
      return _utf8(
        '{"order":${orderFare == null ? order : jsonEncode({...jsonDecode(order) as Map<String, dynamic>, 'fare': orderFare})}}',
        200,
      );
    }
    if (path.endsWith('/merchant/orders/order_1/cancel')) {
      cancelCalls += 1;
      return http.Response(
        '{"order":${_orderJson(batched).replaceFirst(RegExp('"status":"(batched|submitted)"'), '"status":"cancelled"')},"batch_orders_remaining":[]}',
        200,
      );
    }
    if (routeMatch && path.endsWith('/matches')) {
      return _utf8('{"matches":[$_routeMatchJson]}', 200);
    }
    if (batchTrip && path.endsWith('/trips/trip_1')) {
      return _utf8('{"trip":$_batchTripJson}', 200);
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
      final phone = driverPhone;
      if (phone == null) return http.Response('{"trip":$_tripJson}', 200);
      final trip = jsonDecode(_tripJson) as Map<String, dynamic>;
      final route = trip['driver_route'] as Map<String, dynamic>;
      route['driver'] = {
        'name': 'Driver One',
        'vehicle_type': 'sedan',
        'verified': true,
        'trust_score': 86,
        'phone': phone,
      };
      return http.Response(jsonEncode({'trip': trip}), 200);
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
    '{"id":"match_1","status":"proposed","score":"0.9317","method":"darb_route_score","explanation":"Safe explanation","scoring_breakdown":$_scoringJson,"created_at":"2026-07-13T08:10:00.000Z","driver_route":$_routeJson,"merchant_order":{"id":"order_1","pickup_label":"Hebron Merchant Pickup","status":"batched","parcel_count":3,"created_at":"2026-07-13T08:00:00.000Z"},"parcel_batch":null}';
const _tripJson =
    '{"id":"trip_1","status":"in_transit","created_at":"2026-07-13T08:20:00.000Z","driver_route":$_routeJson,"merchant_order":{"id":"order_1","pickup_label":"Hebron Merchant Pickup","status":"in_transit","created_at":"2026-07-13T08:00:00.000Z","parcels":$_parcelsJson},"parcel_batch":null}';
const _locationJson =
    '{"lat":"31.650000","lng":"35.150000","source":"simulated","sequence":2,"recorded_at":"2026-07-13T08:21:00.000Z"}';
const _routeNames =
    '"service_route_id":"route-heb-bth","route_name_ar":"الخليل ← بيت لحم","route_name_en":"Hebron → Bethlehem"';
const _routeMatchJson =
    '{"id":"match_1","status":"proposed","score":"0.9317","method":"darb_route_score","explanation":"Safe explanation","scoring_breakdown":$_scoringJson,"created_at":"2026-07-13T08:10:00.000Z","driver_route":$_routeJson,"merchant_order":{"id":"order_1","pickup_label":"Hebron",$_routeNames,"pickup_details":"Al Amal shop, Ein Sara Street","status":"matched","parcel_count":2,"created_at":"2026-07-13T08:00:00.000Z","parcels":[{"id":"p1","destination_label":"Bethlehem","dropoff_details":"Manger Street, blue gate"},{"id":"p2","destination_label":"Bethlehem","dropoff_details":"University gate"}]},"parcel_batch":null}';
const _batchTripJson =
    '{"id":"trip_1","status":"in_transit","created_at":"2026-07-13T08:20:00.000Z","driver_route":$_routeJson,"merchant_order":{"id":"order_1","pickup_label":"Hebron Merchant Pickup","status":"in_transit","created_at":"2026-07-13T08:00:00.000Z","parcels":$_parcelsJson},"parcel_batch":{"id":"batch_1","status":"in_transit","estimated_distance_saved":"43.06","explanation":"Two orders share one route.","order_count":2,"parcel_count":4,"orders":[{"id":"order_1","pickup_label":"Hebron Merchant Pickup","status":"in_transit","parcels":$_parcelsJson},{"id":"order_2","pickup_label":"Hebron","pickup_details":"Al Amal shop, back door","status":"in_transit","parcels":[{"id":"parcel_9","destination_label":"Bethlehem","dropoff_details":"University gate","receiver_name":"Sami","size":"S","priority":"normal","status":"in_transit"}]}]}}';
