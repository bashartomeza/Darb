import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/features/driver/data/driver_models.dart';
import 'package:darb_mobile/features/driver/presentation/driver_ui.dart';
import 'package:darb_mobile/features/merchant/data/merchant_models.dart';
import 'package:darb_mobile/features/merchant/presentation/merchant_ui.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

const _routeJson = {
  'id': 'route_1',
  'origin_label': 'Hebron',
  'destination_label': 'Bethlehem',
  'corridor_key': 'hebron-to-bethlehem',
  'seats_available': 2,
  'parcel_capacity_available': 5,
  'status': 'active',
};

const _breakdown = {
  'corridorOverlap': 1,
  'pickupDistanceScore': 0.8,
  'timingFit': 0.9,
  'trustScore': 0.86,
  'capacityFit': 1,
  'finalScore': 0.93,
};

Map<String, dynamic> _parcel(String id, String dropoff, String receiver) => {
  'id': id,
  'destination_label': 'Bethlehem',
  'dropoff_details': dropoff,
  'receiver_name': receiver,
  'size': 'S',
  'priority': 'normal',
  'status': 'in_transit',
};

final _batchOrders = [
  {
    'id': 'order_1',
    'pickup_label': 'Hebron',
    'pickup_details': 'Al Amal shop',
    'status': 'in_transit',
    'parcels': [_parcel('p1', 'Manger Street', 'Rana')],
  },
  {
    'id': 'order_2',
    'pickup_label': 'Hebron',
    'pickup_details': 'Al Amal shop, back door',
    'status': 'in_transit',
    'parcels': [
      _parcel('p2', 'University gate', 'Sami'),
      _parcel('p3', 'Beit Jala junction', 'Omar'),
    ],
  },
];

Map<String, dynamic> _tripJson({List<Map<String, dynamic>>? orders}) => {
  'id': 'trip_1',
  'status': 'in_transit',
  'created_at': '2026-07-13T08:20:00.000Z',
  'started_at': null,
  'completed_at': null,
  'driver_route': {
    ..._routeJson,
    'origin_lat': '31.5326',
    'origin_lng': '35.0998',
    'destination_lat': '31.7054',
    'destination_lng': '35.2024',
  },
  'passenger_request': null,
  'merchant_order': {
    'id': 'order_1',
    'merchant_id': 'merchant_1',
    'pickup_label': 'Hebron',
    'pickup_details': 'Al Amal shop',
    'status': 'in_transit',
    'parcels': [_parcel('p1', 'Manger Street', 'Rana')],
  },
  'parcel_batch': {
    'id': 'batch_1',
    'status': 'in_transit',
    'estimated_distance_saved': '12.50',
    'explanation': 'Two orders share one route.',
    'order_count': 2,
    'parcel_count': 3,
    'orders': ?orders,
    'order_ids': ['order_1', 'order_2'],
  },
};

void main() {
  final en = lookupAppLocalizations(const Locale('en'));

  group('driver', () {
    test('a trip lists every order of its batch, not only the first', () {
      final trip = DriverTrip.fromJson(_tripJson(orders: _batchOrders));
      expect(trip.parcelOrders.map((order) => order.id), [
        'order_1',
        'order_2',
      ]);
      expect(trip.parcelCount, 3);
      expect(trip.parcelOrders[1].parcels.map((p) => p.receiverName), [
        'Sami',
        'Omar',
      ]);
    });

    test('a trip without listed batch orders keeps its single order', () {
      final trip = DriverTrip.fromJson({..._tripJson(), 'parcel_batch': null});
      expect(trip.parcelOrders.single.id, 'order_1');
      expect(trip.parcelCount, 1);
    });

    test('a passenger parcel is not labelled as a merchant order', () {
      Map<String, dynamic> match(bool passengerParcel) => {
        'id': 'match_1',
        'status': 'proposed',
        'score': '0.93',
        'method': 'darb_route_score',
        'explanation': 'Same route',
        'scoring_breakdown': _breakdown,
        'created_at': '2026-07-13T08:10:00.000Z',
        'driver_route': _routeJson,
        'passenger_request': null,
        'merchant_order': {
          'id': 'order_1',
          'pickup_label': 'Hebron',
          'status': 'matched',
          'parcel_count': 1,
          'is_passenger_parcel': passengerParcel,
        },
        'parcel_batch': null,
      };
      expect(
        matchTypeLabel(en, DriverMatch.fromJson(match(true))),
        'Passenger parcel',
      );
      expect(
        matchTypeLabel(en, DriverMatch.fromJson(match(false))),
        en.merchantOrder,
      );
    });

    testWidgets('each hand-over stop is named by its receivers and drop-offs', (
      tester,
    ) async {
      final trip = DriverTrip.fromJson(_tripJson(orders: _batchOrders));
      late Map<String, String> labels;
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Builder(
            builder: (context) {
              labels = driverHandoverStopLabels(context, trip);
              return const SizedBox();
            },
          ),
        ),
      );
      expect(labels, {
        'order_1': 'Stop 1 · Rana · Manger Street',
        'order_2':
            'Stop 2 · Sami · University gate · Omar · Beit Jala junction',
      });
    });

    test('a failing re-read does not escape quietRefresh', () async {
      var calls = 0;
      await quietRefresh(() async {
        calls += 1;
        throw StateError('network down');
      });
      expect(calls, 1);
    });
  });

  group('merchant', () {
    test('every order of a batch finds its trip, not only the lead', () {
      final trip = MerchantTrip.fromJson(_tripJson(orders: _batchOrders));
      expect(trip.carriesOrder('order_1'), isTrue);
      expect(trip.carriesOrder('order_2'), isTrue);
      expect(trip.carriesOrder('order_9'), isFalse);
      expect(trip.batchOrders.map((order) => order.id), ['order_1', 'order_2']);
      expect(trip.batch!.orderCount, 2);

      // The trip list carries only the batch's order ids.
      final listed = MerchantTrip.fromJson(_tripJson());
      expect(listed.batchOrders, isEmpty);
      expect(listed.carriesOrder('order_2'), isTrue);
    });

    test('a match names its typed drop-offs', () {
      final summary = MerchantOrderSummary.fromJson({
        'id': 'order_1',
        'pickup_label': 'Hebron',
        'pickup_details': 'Al Amal shop',
        'status': 'matched',
        'parcel_count': 3,
        'parcels': [
          {'destination_label': 'Bethlehem', 'dropoff_details': 'Manger St'},
          {'destination_label': 'Bethlehem', 'dropoff_details': 'Manger St'},
          {'destination_label': 'Beit Jala'},
        ],
      });
      expect(summary.dropoffs, ['Manger St', 'Beit Jala']);
    });

    Future<bool?> openCancel(WidgetTester tester, MerchantOrder order) async {
      bool? answer;
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () async => answer =
                    await showMerchantCancelOrderDialog(context, order),
                child: const Text('cancel'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('cancel'));
      await tester.pumpAndSettle();
      return answer;
    }

    MerchantOrder order({required String status, MerchantBatch? batch}) =>
        MerchantOrder(
          id: 'order_abc123',
          pickupLabel: 'Hebron',
          status: status,
          createdAt: DateTime(2026, 7, 13),
          parcels: const [
            MerchantParcel(
              id: 'p1',
              destinationLabel: 'Bethlehem',
              size: 'S',
              priority: 'normal',
              status: 'batched',
            ),
            MerchantParcel(
              id: 'p2',
              destinationLabel: 'Bethlehem',
              size: 'M',
              priority: 'normal',
              status: 'batched',
            ),
          ],
          batches: [?batch],
        );

    MerchantBatch batch(int orders) => MerchantBatch(
      id: 'batch_1',
      status: 'proposed',
      estimatedDistanceSaved: 10,
      explanation: 'Grouped',
      createdAt: null,
      route: null,
      orderCount: orders,
    );

    testWidgets('cancelling asks first and says only this order is cancelled', (
      tester,
    ) async {
      await openCancel(tester, order(status: 'matched', batch: batch(3)));
      expect(
        tester
            .widget<Text>(find.byKey(const ValueKey('merchantCancelOrderBody')))
            .data,
        contains('with 2 parcels will be cancelled'),
      );
      expect(
        tester
            .widget<Text>(find.byKey(const ValueKey('merchantCancelBatchNote')))
            .data,
        contains('grouped with 2 other orders'),
      );
      expect(
        find.byKey(const ValueKey('merchantCancelOfferNote')),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const ValueKey('merchantCancelOrderKeep')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('merchantCancelOrderDialog')),
        findsNothing,
      );
    });

    testWidgets('a lone order has no batch note and confirms with yes', (
      tester,
    ) async {
      bool? answer;
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () async =>
                    answer = await showMerchantCancelOrderDialog(
                      context,
                      order(status: 'submitted'),
                    ),
                child: const Text('cancel'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('cancel'));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('merchantCancelBatchNote')),
        findsNothing,
      );
      await tester.tap(
        find.byKey(const ValueKey('merchantCancelOrderConfirm')),
      );
      await tester.pumpAndSettle();
      expect(answer, isTrue);
    });
  });
}
