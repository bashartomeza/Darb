import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/fares/fare.dart';
import 'package:masari_mobile/core/widgets/fare_estimate.dart';
import 'package:masari_mobile/features/canonical_assignments/domain/canonical_assignment_models.dart';
import 'package:masari_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:masari_mobile/features/passenger/data/passenger_models.dart';
import 'package:masari_mobile/features/passenger/domain/trip_offer.dart';
import 'package:masari_mobile/features/passenger/presentation/widgets/trip_offer_card.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

Widget _host(Locale locale, Widget child) => MaterialApp(
  locale: locale,
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

const _fareJson = {
  'currency': 'ILS',
  'estimated': true,
  'paid_directly_to_driver': true,
  'passenger_seat_minor': 1010,
  'parcel_minor': {'S': 500, 'M': null, 'L': 1250},
};

void main() {
  group('RouteFares parsing', () {
    test('reads seat and per-size parcel fares, dropping missing sizes', () {
      final fares = RouteFares.tryParse(_fareJson)!;
      expect(fares.currency, 'ILS');
      expect(fares.passengerSeatMinor, 1010);
      expect(fares.parcelFor('S'), 500);
      expect(fares.parcelFor('M'), isNull);
      expect(fares.parcelFor('L'), 1250);
    });

    test(
      'a missing, empty or malformed tariff disappears instead of lying',
      () {
        expect(RouteFares.tryParse(null), isNull);
        expect(RouteFares.tryParse('12.50'), isNull);
        expect(
          RouteFares.tryParse({
            'currency': 'ILS',
            'passenger_seat_minor': null,
            'parcel_minor': {'S': null, 'M': null, 'L': null},
          }),
          isNull,
        );
        // Floats, zero and negatives are not valid minor units.
        expect(
          RouteFares.tryParse({
            'currency': 'ILS',
            'passenger_seat_minor': 12.5,
            'parcel_minor': {'S': 0, 'M': -3},
          }),
          isNull,
        );
      },
    );

    test('seat totals are exact integers (no float drift)', () {
      final fares = RouteFares.tryParse(_fareJson)!;
      expect(fares.seatTotal(3), 3030); // 10.10 x 3
      expect(fares.seatTotal(0), isNull);
    });

    test('parcel totals need every size priced', () {
      final fares = RouteFares.tryParse(_fareJson)!;
      expect(fares.parcelTotal(['S', 'S', 'L']), 2250);
      expect(fares.parcelTotal(['S', 'M']), isNull);
      expect(fares.parcelTotal(const []), isNull);
    });
  });

  group('formatFare', () {
    test('formats English with the shekel sign and two decimals', () {
      expect(formatFare(1250, 'ILS', 'en'), '₪12.50');
      expect(formatFare(5, 'ILS', 'en'), '₪0.05');
      expect(formatFare(1005, 'ILS', 'en'), '₪10.05');
      expect(formatFare(10000000, 'ILS', 'en'), '₪100,000.00');
    });

    test(
      'formats Arabic with the app digits and the sign after the amount',
      () {
        // The rest of the app renders Latin digits in Arabic, so fares do too;
        // intl adds a right-to-left mark so the sign stays on the amount's end.
        final text = formatFare(1250, 'ILS', 'ar');
        expect(text, contains('12.50'));
        expect(text, contains('₪'));
        expect(text.indexOf('12.50'), lessThan(text.indexOf('₪')));
        expect(formatFare(1005, 'ILS', 'ar'), contains('10.05'));
      },
    );

    test('unknown currencies keep their ISO code rather than a wrong sign', () {
      expect(formatFare(100, 'USD', 'en'), contains('USD'));
    });
  });

  group('response models carry fares', () {
    Map<String, dynamic> routeWith(Object? fares) {
      final json = routeJson();
      if (fares != null) json['fares'] = fares;
      return json;
    }

    test('the strict route parser accepts the new fares field', () {
      final route = CanonicalRoute.fromJson(routeWith(_fareJson));
      expect(route.fares?.passengerSeatMinor, 1010);
      expect(route.withStops(route.stops).fares?.passengerSeatMinor, 1010);
      expect(CanonicalRoute.fromJson(routeWith(null)).fares, isNull);
      expect(
        CanonicalRoute.fromJson(routeWith(null)..['fares'] = null).fares,
        isNull,
      );
    });

    test('request and order snapshots parse; absent snapshot is null', () {
      final request = CanonicalPassengerRequest.fromEnvelope({
        'request': {
          'id': 'r',
          'route_version_id': 'v',
          'pickup_stop_id': 'a',
          'dropoff_stop_id': 'b',
          'requested_departure_from': '2026-11-01T10:00:00Z',
          'requested_departure_until': '2026-11-01T11:00:00Z',
          'passenger_count': 3,
          'fare': {
            'currency': 'ILS',
            'unit_minor': 1010,
            'total_minor': 3030,
            'estimated': true,
            'paid_directly_to_driver': true,
          },
        },
      });
      expect(request.fare?.totalMinor, 3030);
      expect(request.fare?.unitMinor, 1010);
      final order = CanonicalMerchantOrder.fromEnvelope({
        'order': {'id': 'o', 'parcels': [], 'fare': null},
      });
      expect(order.fare, isNull);
    });

    test('driver offer demand exposes the frozen fare and parcel sizes', () {
      final demand = CanonicalOfferDemand.fromJson({
        'pickup_stop_id': 'a',
        'destination_stop_ids': ['b', 'c'],
        'requested_departure_from': '2026-11-01T10:00:00Z',
        'requested_departure_until': '2026-11-01T11:00:00Z',
        'parcel_count': 2,
        'parcels': [
          {'destination_stop_id': 'b', 'size': 'S', 'fare': null},
          {'destination_stop_id': 'c', 'size': 'L', 'fare': null},
        ],
        'fare': {'currency': 'ILS', 'total_minor': 1750},
      }, CanonicalDemandType.merchantOrder);
      expect(demand.fare?.totalMinor, 1750);
      expect(demand.parcelSizes, ['S', 'L']);
    });

    test('available departures read the route tariff', () {
      final departure = AvailableDeparture.fromJson({
        'id': 'a1',
        'route_version_id': 'v1',
        'origin_label': 'A',
        'destination_label': 'B',
        'departure_at': '2026-11-01T10:00:00Z',
        'remaining_seats': 2,
        'route': {'id': 'v1', 'fares': _fareJson},
        'driver': {'name': 'D'},
      });
      expect(departure.fares?.passengerSeatMinor, 1010);
    });
  });

  group('fare widgets', () {
    final l10nCases = {
      'en': 'No payments are processed in the app',
      'ar': 'لا تتم معالجة أي مدفوعات',
    };

    for (final entry in l10nCases.entries) {
      testWidgets('estimate box discloses "paid to driver" in ${entry.key}', (
        tester,
      ) async {
        await tester.pumpWidget(
          _host(
            Locale(entry.key),
            const FareEstimateBox(
              currency: 'ILS',
              lines: [FareLine(label: 'x', minor: 3030, emphasis: true)],
            ),
          ),
        );
        expect(find.byKey(const ValueKey('fareEstimateBox')), findsOneWidget);
        expect(find.textContaining(entry.value), findsOneWidget);
        final direction = Directionality.of(
          tester.element(find.byKey(const ValueKey('fareEstimateBox'))),
        );
        expect(
          direction,
          entry.key == 'ar' ? TextDirection.rtl : TextDirection.ltr,
        );
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('seat lines show per-seat and group total, in order', (
      tester,
    ) async {
      late AppLocalizations l10n;
      await tester.pumpWidget(
        _host(
          const Locale('en'),
          Builder(
            builder: (context) {
              l10n = AppLocalizations.of(context);
              return FareEstimateBox(
                currency: 'ILS',
                lines: seatFareLines(l10n, RouteFares.tryParse(_fareJson)!, 3),
              );
            },
          ),
        ),
      );
      expect(find.text('₪10.10'), findsOneWidget);
      expect(find.text('₪30.30'), findsOneWidget);
    });

    test(
      'parcel lines price only known sizes and total only when complete',
      () {
        // Built without a widget tree: labels are irrelevant to the maths.
        final fares = RouteFares.tryParse(_fareJson)!;
        expect(fares.parcelTotal(['S', 'L']), 1750);
        expect(fares.parcelTotal(['M']), isNull);
      },
    );

    testWidgets('trip offer card shows the seat fare with the disclosure', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(
          const Locale('en'),
          const TripOfferCard(
            offer: TripOffer(
              id: 'a',
              driverName: 'Driver',
              fromLabel: 'A',
              toLabel: 'B',
              fareSeatMinor: 1250,
              fareCurrency: 'ILS',
            ),
          ),
        ),
      );
      expect(find.byKey(const ValueKey('tripOfferFare')), findsOneWidget);
      expect(find.text('₪12.50'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('tripOfferFareDisclaimer')),
        findsOneWidget,
      );
    });

    testWidgets('trip offer card shows no price row without a tariff', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(
          const Locale('ar'),
          const TripOfferCard(
            offer: TripOffer(
              id: 'a',
              driverName: 'Driver',
              fromLabel: 'A',
              toLabel: 'B',
            ),
          ),
        ),
      );
      expect(find.byKey(const ValueKey('tripOfferFare')), findsNothing);
      expect(
        find.byKey(const ValueKey('tripOfferFareDisclaimer')),
        findsNothing,
      );
    });
  });
}

Map<String, dynamic> routeJson() => {
  'id': 'route',
  'direction': 'outbound',
  'status': 'active',
  'current_version': {
    'id': 'version',
    'version_number': 1,
    'status': 'published',
    'name_ar': 'مسار',
    'name_en': 'Route',
    'active_from': null,
    'active_until': null,
    'stops': [_stop(1, 'one'), _stop(2, 'two')],
    'geometry': {'status': 'pending', 'ready': false},
  },
};

Map<String, dynamic> _stop(int sequence, String id) => {
  'sequence': sequence,
  'passenger_pickup_allowed': true,
  'passenger_dropoff_allowed': true,
  'parcel_pickup_allowed': true,
  'parcel_dropoff_allowed': true,
  'stop': {'id': id, 'name_ar': 'محطة', 'name_en': 'Stop $id'},
};
