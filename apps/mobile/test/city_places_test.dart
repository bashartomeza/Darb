import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/features/driver/data/driver_models.dart';
import 'package:darb_mobile/features/driver/presentation/driver_ui.dart';
import 'package:darb_mobile/features/merchant/data/merchant_models.dart';
import 'package:darb_mobile/features/merchant/data/merchant_order_operation_storage.dart';
import 'package:darb_mobile/features/merchant/data/merchant_repository.dart';
import 'package:darb_mobile/features/operating_routes/data/city_place_models.dart';
import 'package:darb_mobile/features/passenger/data/passenger_models.dart';
import 'package:darb_mobile/features/passenger_parcels/data/passenger_parcel_draft.dart';
import 'package:darb_mobile/features/passenger_parcels/data/passenger_parcel_models.dart';
import 'package:darb_mobile/features/trips/data/trip_models.dart';

import 'support/route_places_fixture.dart';

/// Villages and towns picked per route end (docs/routes/city-places.md).
void main() {
  group('places of a route', () {
    test('reads the pickup and drop-off lists', () {
      final places = testRoutePlaces('route-heb-bth');
      expect(places.routeId, 'route-heb-bth');
      expect(places.pickup.map((place) => place.nameEn), [
        'Hebron city centre',
        'Halhul',
        'Yatta',
      ]);
      expect(places.dropoff.map((place) => place.id), [
        'place-bth-centre',
        'place-bth-beitjala',
        'place-bth-beitsahur',
      ]);
      expect(places.pickup.first.approximate, isTrue);
    });

    test('the reverse route swaps the cities', () {
      final reverse = testRoutePlaces('route-bth-heb');
      expect(
        reverse.pickup.map((place) => place.nameEn).first,
        contains('Bethlehem'),
      );
      expect(
        reverse.dropoff.map((place) => place.nameEn).first,
        contains('Hebron'),
      );
    });

    test('a malformed list is an error, not skipped', () {
      expect(
        () => RoutePlaces.fromJson({
          'route_id': 'r',
          'pickup_places': [
            {'id': 'p'},
          ],
          'dropoff_places': const [],
        }),
        throwsFormatException,
      );
      expect(
        () => RoutePlaces.fromJson({'route_id': 'r'}),
        throwsFormatException,
      );
    });

    test('searches both names, ignoring case', () {
      final halhul = testRoutePlaces('route-heb-bth').pickup[1];
      expect(halhul.matches('hal'), isTrue);
      expect(halhul.matches('  HALHUL '), isTrue);
      expect(halhul.matches('حلح'), isTrue);
      expect(halhul.matches('yatta'), isFalse);
      expect(halhul.matches(''), isTrue);
    });

    test('names the place and details in the reading language', () {
      expect(
        placeWithDetails(
          arabic: false,
          nameAr: 'حلحول',
          nameEn: 'Halhul',
          details: ' by the mosque ',
        ),
        'Halhul · by the mosque',
      );
      expect(
        placeWithDetails(arabic: true, nameAr: 'حلحول', nameEn: 'Halhul'),
        'حلحول',
      );
      expect(
        placeWithDetails(arabic: true, nameAr: null, nameEn: 'Halhul'),
        'Halhul',
      );
      expect(
        placeWithDetails(arabic: false, details: 'near the gate'),
        'near the gate',
      );
      expect(
        placeWithDetails(arabic: false, nameEn: '  ', details: ' '),
        isNull,
      );
    });
  });

  group('request body', () {
    test('sends the place ids and leaves out empty details', () {
      final body = passengerRouteRequestBody(
        serviceRouteId: 'route-heb-bth',
        pickupPlaceId: 'place-heb-halhul',
        dropoffPlaceId: 'place-bth-beitjala',
        pickupDetails: '   ',
        preferredTime: DateTime.utc(2030, 1, 2, 12),
        passengerCount: 2,
      );
      expect(body, {
        'service_route_id': 'route-heb-bth',
        'pickup_place_id': 'place-heb-halhul',
        'dropoff_place_id': 'place-bth-beitjala',
        'preferred_time': '2030-01-02T12:00:00.000Z',
        'passenger_count': 2,
      });
    });

    test('keeps the details when written', () {
      final body = passengerRouteRequestBody(
        serviceRouteId: 'route-heb-bth',
        pickupPlaceId: 'place-heb-halhul',
        dropoffPlaceId: 'place-bth-beitjala',
        pickupDetails: ' near the mosque ',
        dropoffDetails: 'bus station',
        preferredTime: DateTime.utc(2030, 1, 2, 12),
        passengerCount: 1,
      );
      expect(body['pickup_details'], 'near the mosque');
      expect(body['dropoff_details'], 'bus station');
    });
  });

  group('places shown to riders, drivers and senders', () {
    final request = {
      'id': 'r1',
      'status': 'pending',
      'pickup_label': 'Hebron',
      'pickup_lat': 31.5,
      'pickup_lng': 35.1,
      'destination_label': 'Bethlehem',
      'destination_lat': 31.7,
      'destination_lng': 35.2,
      'preferred_time': '2030-01-02T12:00:00.000Z',
      'passenger_count': 1,
      'created_at': '2030-01-01T12:00:00.000Z',
      'pickup_place_name_ar': 'حلحول',
      'pickup_place_name_en': 'Halhul',
      'pickup_details': 'by the mosque',
      'dropoff_place_name_ar': 'بيت جالا',
      'dropoff_place_name_en': 'Beit Jala',
    };

    test('a passenger request', () {
      final parsed = PassengerRequest.fromJson(request);
      expect(parsed.pickupSummary(arabic: false), 'Halhul · by the mosque');
      expect(parsed.pickupSummary(arabic: true), 'حلحول · by the mosque');
      expect(parsed.dropoffSummary(arabic: true), 'بيت جالا');
      final old = PassengerRequest.fromJson({
        ...request,
        'pickup_place_name_ar': null,
        'pickup_place_name_en': null,
        'dropoff_place_name_ar': null,
        'dropoff_place_name_en': null,
        'pickup_details': null,
      });
      expect(old.pickupSummary(arabic: false), isNull);
    });

    test('what the driver reads', () {
      final passenger = DriverPassengerSummary.fromJson({
        'id': 'p',
        'pickup_label': 'Hebron',
        'destination_label': 'Bethlehem',
        'passenger_count': 2,
        'status': 'matched',
        ...{
          'pickup_place_name_ar': 'حلحول',
          'pickup_place_name_en': 'Halhul',
          'dropoff_place_name_en': 'Beit Jala',
          'dropoff_details': 'bus station',
        },
      });
      expect(passenger.pickupSummary(arabic: true), 'حلحول');
      expect(
        passenger.dropoffSummary(arabic: false),
        'Beit Jala · bus station',
      );

      final order = DriverMerchantSummary.fromJson({
        'id': 'o',
        'pickup_label': 'Hebron',
        'status': 'matched',
        'pickup_place_name_ar': 'يطا',
        'pickup_place_name_en': 'Yatta',
        'pickup_details': 'Al Amal shop',
        'parcels': [
          {'dropoff_place_name_en': 'Beit Sahur', 'size': 'S'},
        ],
      });
      expect(order.pickupSummary(arabic: false), 'Yatta · Al Amal shop');
      expect(order.parcels.single.dropoffSummary(arabic: false), 'Beit Sahur');
    });

    testWidgets('driver screens print the place with the details', (
      tester,
    ) async {
      final passenger = DriverPassengerSummary.fromJson({
        'id': 'p',
        'pickup_label': 'Hebron',
        'destination_label': 'Bethlehem',
        'passenger_count': 1,
        'status': 'matched',
        'pickup_place_name_ar': 'حلحول',
        'pickup_place_name_en': 'Halhul',
        'pickup_details': 'by the mosque',
      });
      late String english;
      late String arabic;
      for (final locale in const [Locale('en'), Locale('ar')]) {
        await tester.pumpWidget(
          Localizations(
            locale: locale,
            delegates: const [DefaultWidgetsLocalizations.delegate],
            child: Builder(
              builder: (context) {
                final text = driverPassengerPickupText(context, passenger);
                if (locale.languageCode == 'en') {
                  english = text;
                } else {
                  arabic = text;
                }
                return const SizedBox();
              },
            ),
          ),
        );
      }
      expect(english, 'Halhul · by the mosque');
      expect(arabic, 'حلحول · by the mosque');
    });

    test('a trip', () {
      final trip = PassengerTrip.fromJson({
        'id': 't',
        'status': 'accepted',
        'created_at': '2030-01-01T10:00:00.000Z',
        'driver_route': {
          'origin_label': 'Hebron',
          'destination_label': 'Bethlehem',
        },
        'passenger_request': {
          'id': 'r1',
          'pickup_place_name_en': 'Halhul',
          'dropoff_place_name_ar': 'بيت جالا',
          'dropoff_place_name_en': 'Beit Jala',
          'dropoff_details': 'bus station',
        },
      });
      expect(trip.pickupSummary(arabic: false), 'Halhul');
      expect(trip.dropoffSummary(arabic: true), 'بيت جالا · bus station');
    });

    test('a merchant order and its parcels', () {
      final order = MerchantOrder.fromJson({
        'id': 'o1',
        'pickup_label': 'Hebron',
        'status': 'submitted',
        'created_at': '2030-01-01T10:00:00.000Z',
        'pickup_place_id': 'place-heb-halhul',
        'pickup_place_name_ar': 'حلحول',
        'pickup_place_name_en': 'Halhul',
        'parcels': [
          {
            'id': 'p1',
            'destination_label': 'Bethlehem',
            'size': 'S',
            'priority': 'normal',
            'status': 'pending',
            'dropoff_place_id': 'place-bth-beitjala',
            'dropoff_place_name_ar': 'بيت جالا',
            'dropoff_place_name_en': 'Beit Jala',
            'dropoff_details': 'bus station',
          },
        ],
      });
      expect(order.pickupSummary(arabic: true), 'حلحول');
      expect(
        order.parcels.single.dropoffSummary(arabic: false),
        'Beit Jala · bus station',
      );

      final summary = MerchantOrderSummary.fromJson({
        'id': 'o1',
        'pickup_label': 'Hebron',
        'status': 'matched',
        'parcel_count': 2,
        'pickup_place_name_en': 'Halhul',
        'parcels': [
          {
            'dropoff_place_name_en': 'Beit Jala',
            'destination_label': 'Bethlehem',
          },
          {
            'dropoff_place_name_en': 'Beit Jala',
            'destination_label': 'Bethlehem',
          },
          {'destination_label': 'Bethlehem', 'dropoff_details': 'old text'},
        ],
      });
      expect(summary.pickupSummary(arabic: false), 'Halhul');
      expect(summary.dropoffTexts(arabic: false), ['Beit Jala', 'old text']);
    });

    test('a passenger parcel', () {
      final parcel = PassengerParcel.fromJson({
        'id': 'pp1',
        'tracking_state': 'searching',
        'size': 'S',
        'pickup_label': 'Hebron',
        'dropoff_label': 'Bethlehem',
        'created_at': '2030-01-01T10:00:00.000Z',
        'pickup_place_name_en': 'Halhul',
        'dropoff_place_name_ar': 'بيت جالا',
        'dropoff_details': 'receiver house',
      });
      expect(parcel.pickupSummary(arabic: false), 'Halhul');
      expect(parcel.dropoffSummary(arabic: true), 'بيت جالا · receiver house');
    });
  });

  group('parcel form', () {
    const filled = PassengerParcelDraft(
      serviceRouteId: 'route-heb-bth',
      size: 'S',
      receiverName: 'Sami',
      receiverPhone: '+970591234567',
      acknowledged: true,
    );

    test('needs a place at each end; details are optional', () {
      expect(filled.firstIssue, ParcelFormIssue.pickup);
      final pickup = filled.copyWith(pickupPlaceId: 'place-heb-halhul');
      expect(pickup.firstIssue, ParcelFormIssue.dropoff);
      final both = pickup.copyWith(dropoffPlaceId: 'place-bth-beitjala');
      expect(both.firstIssue, isNull);
      // Text alone no longer completes a new form.
      expect(
        filled
            .copyWith(
              pickupDetails: 'near the gate',
              dropoffDetails: 'bus station',
            )
            .firstIssue,
        ParcelFormIssue.pickup,
      );
      expect(
        both.copyWith(pickupDetails: 'x' * 301).firstIssue,
        ParcelFormIssue.pickup,
      );
    });

    test('changing the route clears the places', () {
      final both = filled.copyWith(
        pickupPlaceId: 'a',
        dropoffPlaceId: 'b',
        pickupDetails: 'gate',
      );
      final same = both.withRoute('route-heb-bth');
      expect(same.pickupPlaceId, 'a');
      final other = both.withRoute('route-bth-heb');
      expect(other.pickupPlaceId, isNull);
      expect(other.dropoffPlaceId, isNull);
      expect(other.pickupDetails, 'gate');
    });

    test('the payload carries the places and only written details', () {
      final payload = filled
          .copyWith(
            pickupPlaceId: 'a',
            dropoffPlaceId: 'b',
            dropoffDetails: ' bus station ',
          )
          .toPayload(preferredTime: DateTime.utc(2030, 1, 2));
      expect(payload['pickup_place_id'], 'a');
      expect(payload['dropoff_place_id'], 'b');
      expect(payload.containsKey('pickup_details'), isFalse);
      expect(payload['dropoff_details'], 'bus station');
    });

    test('a create an older build left pending is still replayed', () {
      final restored = PassengerParcelDraft.fromPayload({
        'service_route_id': 'route-heb-bth',
        'pickup_details': 'The shop next to Ibn Rushd roundabout',
        'dropoff_details': 'Receiver house',
        'size': 'S',
        'receiver_name': 'Sami',
        'receiver_phone': '+970591234567',
        'forbidden_items_acknowledged': true,
      });
      expect(restored.firstIssue, isNull);
    });
  });

  group('merchant order', () {
    test('the body carries the places and omits blank details', () {
      final body = MerchantRepository.createOrderBody(
        serviceRouteId: 'route-heb-bth',
        pickupPlaceId: 'place-heb-halhul',
        parcels: const [ParcelDraft(dropoffPlaceId: 'place-bth-beitjala')],
      );
      expect(body, {
        'service_route_id': 'route-heb-bth',
        'pickup_place_id': 'place-heb-halhul',
        'parcels': [
          {
            'dropoff_place_id': 'place-bth-beitjala',
            'size': 'S',
            'priority': 'normal',
          },
        ],
      });
    });

    test('a saved order with places and one with text only both read back', () {
      final placed = MerchantPendingOrder.create(
        actorId: 'm1',
        payload: {
          'service_route_id': 'route-heb-bth',
          'pickup_place_id': 'place-heb-halhul',
          'parcels': [
            {
              'dropoff_place_id': 'place-bth-beitjala',
              'size': 'S',
              'priority': 'normal',
            },
          ],
        },
      );
      expect(placed.payload['pickup_place_id'], 'place-heb-halhul');
      final preview = PendingOrderPreview.fromPayload(placed.payload);
      expect(preview.pickupPlaceChosen, isTrue);
      expect(preview.parcels.single.placeChosen, isTrue);

      final text = MerchantPendingOrder.create(
        actorId: 'm1',
        payload: {
          'service_route_id': 'route-heb-bth',
          'pickup_details': 'Al Amal shop',
          'parcels': [
            {
              'dropoff_details': 'Manger Street',
              'size': 'S',
              'priority': 'normal',
            },
          ],
        },
      );
      expect(
        PendingOrderPreview.fromPayload(text.payload).pickup,
        'Al Amal shop',
      );
    });

    test('a saved order with neither a place nor details is unreadable', () {
      expect(
        () => MerchantPendingOrder.create(
          actorId: 'm1',
          payload: {
            'service_route_id': 'route-heb-bth',
            'parcels': [
              {'size': 'S', 'priority': 'normal'},
            ],
          },
        ),
        throwsA(anything),
      );
    });
  });
}
