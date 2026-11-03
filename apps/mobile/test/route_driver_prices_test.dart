import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/core/api/api_error.dart';
import 'package:darb_mobile/core/fares/fare.dart';
import 'package:darb_mobile/features/driver/data/driver_models.dart';
import 'package:darb_mobile/features/driver/domain/driver_prices.dart';
import 'package:darb_mobile/features/driver/presentation/driver_ui.dart';
import 'package:darb_mobile/features/driver/presentation/widgets/driver_price_fields.dart';
import 'package:darb_mobile/features/matching/data/matching_models.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import 'support/operating_routes_fixture.dart';

void main() {
  group('route prices from the server', () {
    test('an operating route reads its default prices and driver ranges', () {
      final route = testOperatingRoutesWithFares().first;
      final fares = route.fares!;
      expect(fares.passengerSeatMinor, 1500);
      expect(fares.seatRange!.minMinor, 1200);
      expect(fares.seatRange!.maxMinor, 2000);
      expect(fares.parcelFor('S'), 800);
      expect(fares.parcelRanges['S'], isNull);
      expect(fares.parcelRanges['M']!.contains(1400), isTrue);
      expect(fares.parcelRanges['M']!.contains(1401), isFalse);
      // A route without prices has none, rather than a zero.
      expect(testOperatingRoutesWithFares().last.fares, isNull);
    });

    test('a range that does not hold its default is ignored', () {
      final fares = RouteFares.tryParse({
        'currency': 'ILS',
        'passenger_seat_minor': 1500,
        'parcel_minor': const {},
        'driver_price_range': {
          'passenger_seat': {'min_minor': 1600, 'max_minor': 2000},
        },
      })!;
      expect(fares.seatRange, isNull);
    });

    test('typed prices become integer agorot without rounding', () {
      expect(parseFareInput('18'), 1800);
      expect(parseFareInput('18.5'), 1850);
      expect(parseFareInput('١٨٫٥٠'), 1850);
      expect(parseFareInput('18.505'), isNull);
      expect(parseFareInput('0'), isNull);
      expect(parseFareInput('abc'), isNull);
      expect(fareInputText(1205), '12.05');
    });
  });

  group('driver prices', () {
    test('only the prices the driver set are sent', () {
      expect(DriverPrices.none.toJson(), isNull);
      const prices = DriverPrices({'passenger_seat': 1800});
      expect(prices.toJson(), {'passenger_seat': 1800});
      expect(DriverPrices.fromJson({'passenger_seat': 1800, 'x': 5}).toJson(), {
        'passenger_seat': 1800,
      });
    });

    test('a driver route reads the prices it was opened with', () {
      final route = DriverRoute.fromJson({
        'id': 'route_1',
        'origin_label': 'Hebron',
        'origin_lat': '31.5',
        'origin_lng': '35.1',
        'destination_label': 'Bethlehem',
        'destination_lat': '31.7',
        'destination_lng': '35.2',
        'corridor_key': 'hebron-to-bethlehem',
        'seats_available': 3,
        'parcel_capacity_available': 4,
        'status': 'active',
        'prices': {
          'currency': 'ILS',
          'passenger_seat_minor': 1800,
          'parcel_minor': {'S': null, 'M': 1200, 'L': null},
        },
      });
      expect(route.prices['passenger_seat'], 1800);
      expect(route.prices['parcel_m'], 1200);
      expect(route.prices['parcel_s'], isNull);
    });

    test('an out-of-range price from the server reads clearly in both '
        'languages', () async {
      for (final locale in const [Locale('en'), Locale('ar')]) {
        final l10n = await AppLocalizations.delegate.load(locale);
        const outOfRange = ApiException(
          ApiErrorType.validation,
          'driver_price_out_of_range',
          statusCode: 422,
        );
        const fixed = ApiException(
          ApiErrorType.validation,
          'driver_price_fixed',
          statusCode: 422,
        );
        expect(driverErrorLabel(l10n, outOfRange), l10n.driverPriceOutOfRange);
        expect(driverErrorLabel(l10n, fixed), l10n.driverPriceFixedError);
        expect(l10n.driverPriceOutOfRange, isNot(l10n.requestFailed));
      }
    });
  });

  group('price fields', () {
    Future<List<DriverPrices?>> pump(
      WidgetTester tester, {
      Locale locale = const Locale('en'),
    }) async {
      final reported = <DriverPrices?>[];
      await tester.pumpWidget(
        MaterialApp(
          locale: locale,
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: Scaffold(
            body: SingleChildScrollView(
              child: DriverPriceFields(
                fares: testOperatingRoutesWithFares().first.fares,
                onChanged: reported.add,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      return reported;
    }

    testWidgets('offers a field per item with a range and shows fixed ones', (
      tester,
    ) async {
      await pump(tester);
      expect(
        find.byKey(const ValueKey('driverPrice-passenger_seat')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('driverPrice-parcel_m')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('driverPrice-parcel_s')), findsNothing);
      expect(
        find.byKey(const ValueKey('driverPriceFixed-parcel_s')),
        findsOneWidget,
      );
      expect(find.textContaining('Between ₪12.00 and ₪20.00'), findsOneWidget);
    });

    testWidgets('reports a price inside the range and refuses one outside', (
      tester,
    ) async {
      final reported = await pump(tester);
      await tester.enterText(
        find.byKey(const ValueKey('driverPrice-passenger_seat')),
        '18',
      );
      await tester.pump();
      expect(reported.last!.toJson(), {'passenger_seat': 1800});

      await tester.enterText(
        find.byKey(const ValueKey('driverPrice-passenger_seat')),
        '25',
      );
      await tester.pump();
      expect(reported.last, isNull);
      expect(
        find.text('Enter a price between ₪12.00 and ₪20.00.'),
        findsOneWidget,
      );

      // Emptying the field goes back to the route's default.
      await tester.enterText(
        find.byKey(const ValueKey('driverPrice-passenger_seat')),
        '',
      );
      await tester.pump();
      expect(reported.last!.isEmpty, isTrue);
    });

    testWidgets('speaks Arabic', (tester) async {
      await pump(tester, locale: const Locale('ar'));
      expect(find.text('أسعارك على هذا المسار'), findsOneWidget);
      expect(find.text('سعر المقعد'), findsOneWidget);
    });
  });

  test('a match reads the saved fare of the offered driver', () {
    final match = MatchResult.fromJson(
      {
        'id': 'match-1',
        'status': 'proposed',
        'score': 0.8,
        'explanation': 'x',
        'passenger_request': {
          'id': 'request-1',
          'passenger_count': 2,
          'fare': {
            'currency': 'ILS',
            'unit_minor': 1800,
            'total_minor': 3600,
            'estimated': true,
            'paid_directly_to_driver': true,
          },
        },
        'driver_route': {
          'id': 'driver-route',
          'origin_label': 'Hebron',
          'destination_label': 'Bethlehem',
          'seats_available': 2,
        },
      },
      {
        for (final key in [
          'corridorOverlap',
          'pickupDistanceScore',
          'timingFit',
          'trustScore',
          'capacityFit',
          'finalScore',
        ])
          key: 0.5,
      },
    );
    expect(match.fare!.unitMinor, 1800);
    expect(match.fare!.totalMinor, 3600);
    expect(match.passengerCount, 2);
  });
}
