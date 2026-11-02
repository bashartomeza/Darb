import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:darb_mobile/features/merchant/data/merchant_models.dart';
import 'package:darb_mobile/features/merchant/data/merchant_repository.dart';

import 'support/auth_test_support.dart';

void main() {
  test('order list/detail parse parcels and persisted safe batch', () async {
    final repository = _repository((request) async {
      if (request.url.path.endsWith('/orders/order_1')) {
        return http.Response('{"order":$_orderJson}', 200);
      }
      return http.Response('{"orders":[$_orderJson]}', 200);
    });

    final order = (await repository.listOrders()).single;
    expect(order.parcels, hasLength(3));
    expect(order.latestBatch?.id, 'batch_1');
    expect(order.latestBatch?.route?.parcelCapacity, 5);
    expect((await repository.orderDetail('order_1')).canBatch, isFalse);
  });

  test(
    'create order sends the route, the pickup details and 1-10 parcel DTOs',
    () async {
      Map<String, dynamic>? body;
      final repository = _repository((request) async {
        body = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response('{"order":$_submittedOrderJson}', 201);
      });

      final order = await repository.createOrder(
        serviceRouteId: 'route-heb-bth',
        pickupDetails: 'Al-Amal store, Ein Sarah street',
        parcels: const [
          ParcelDraft(dropoffDetails: 'Near the university gate'),
          ParcelDraft(
            dropoffDetails: 'Manger Street',
            size: 'M',
            priority: 'high',
            receiverName: 'Sara',
            receiverPhone: '+970599123456',
          ),
          ParcelDraft(dropoffDetails: 'Bethlehem centre', size: 'L'),
        ],
      );

      expect(order.parcels, hasLength(3));
      expect(body?['service_route_id'], 'route-heb-bth');
      expect(body?['pickup_details'], 'Al-Amal store, Ein Sarah street');
      // No coordinates or corridor labels: the server fills them.
      expect(body?.keys, {'service_route_id', 'pickup_details', 'parcels'});
      final parcels = body?['parcels'] as List<dynamic>;
      expect(parcels, hasLength(3));
      expect(parcels[1], {
        'dropoff_details': 'Manger Street',
        'size': 'M',
        'priority': 'high',
        'receiver_name': 'Sara',
        'receiver_phone': '+970599123456',
      });
      expect(parcels[0], {
        'dropoff_details': 'Near the university gate',
        'size': 'S',
        'priority': 'normal',
      });
    },
  );

  test('orders read the route and typed details; old rows have none', () {
    final order = MerchantOrder.fromJson(
      jsonDecode(_routeOrderJson) as Map<String, dynamic>,
    );
    expect(order.serviceRouteId, 'route-heb-bth');
    expect(order.routeName(arabic: true), 'الخليل ← بيت لحم');
    expect(order.routeName(arabic: false), 'Hebron → Bethlehem');
    expect(order.pickupDetails, 'Al-Amal store');
    expect(order.parcels.single.dropoffDetails, 'Manger Street');
    expect(order.parcels.single.receiverName, 'Sara');

    final old = MerchantOrder.fromJson(
      jsonDecode(_submittedOrderJson) as Map<String, dynamic>,
    );
    expect(old.routeName(arabic: true), isNull);
    expect(old.pickupDetails, isNull);
    expect(old.parcels.first.dropoffDetails, isNull);
  });

  test(
    'batch, matching, inbox, detail, trip, and location contracts',
    () async {
      Uri? filtered;
      Map<String, dynamic>? matchBody;
      final repository = _repository((request) async {
        final path = request.url.path;
        if (path.endsWith('/orders/order_1/batch')) {
          return http.Response('{"batch":$_batchJson}', 201);
        }
        if (path.endsWith('/matches/run')) {
          matchBody = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response(
            '{"match":$_matchJson,"scoringBreakdown":$_scoringJson}',
            201,
          );
        }
        if (path.endsWith('/matches/match_1')) {
          return http.Response('{"match":$_matchJson}', 200);
        }
        if (path.endsWith('/matches')) {
          filtered = request.url;
          return http.Response('{"matches":[$_matchJson]}', 200);
        }
        if (path.endsWith('/trips/trip_1/location')) {
          return http.Response('{"location":$_locationJson}', 200);
        }
        if (path.endsWith('/trips/trip_1')) {
          return http.Response('{"trip":$_tripJson}', 200);
        }
        return http.Response('{"trips":[$_tripJson]}', 200);
      });

      expect((await repository.createBatch('order_1')).id, 'batch_1');
      expect(
        (await repository.runMatch('order_1')).breakdown.finalScore,
        0.9317,
      );
      expect(matchBody, {'merchantOrderId': 'order_1'});
      expect(
        (await repository.listMatches(status: 'proposed')).single.order.id,
        'order_1',
      );
      expect(filtered?.queryParameters['status'], 'proposed');
      expect(
        (await repository.matchDetail('match_1')).waitingForDriver,
        isTrue,
      );
      expect((await repository.listTrips()).single.order.id, 'order_1');
      expect(
        (await repository.tripDetail('trip_1')).order.parcels,
        hasLength(3),
      );
      expect((await repository.latestLocation('trip_1'))?.sequence, 2);
    },
  );
}

MerchantRepository _repository(
  Future<http.Response> Function(http.Request) handler,
) => MerchantRepository(
  apiClient: TestAuthenticatedClient(handler: handler).client,
);

const _routeJson =
    '{"id":"route_1","origin_label":"Hebron / PPU / Bab Al-Zawiya","destination_label":"Bethlehem","corridor_key":"hebron-ppu-bab-al-zawiya-to-bethlehem","parcel_capacity_available":5,"status":"active"}';
const _batchJson =
    '{"id":"batch_1","status":"created","estimated_distance_saved":"43.06","explanation":"Three parcels share one corridor trip.","created_at":"2026-07-13T08:05:00.000Z","driver_route":$_routeJson}';
const _parcelsJson =
    '[{"id":"parcel_1","destination_label":"Bethlehem Market","size":"S","priority":"normal","status":"pending"},{"id":"parcel_2","destination_label":"Manger Street","size":"M","priority":"high","status":"pending"},{"id":"parcel_3","destination_label":"Bethlehem Center","size":"L","priority":"low","status":"pending"}]';
const _submittedOrderJson =
    '{"id":"order_1","pickup_label":"Hebron Merchant Pickup","status":"submitted","created_at":"2026-07-13T08:00:00.000Z","parcels":$_parcelsJson}';
const _routeOrderJson =
    '{"id":"order_2","pickup_label":"Hebron","service_route_id":"route-heb-bth","route_name_ar":"الخليل ← بيت لحم","route_name_en":"Hebron → Bethlehem","pickup_details":"Al-Amal store","status":"submitted","created_at":"2026-07-13T08:00:00.000Z","parcels":[{"id":"parcel_9","destination_label":"Bethlehem","dropoff_details":"Manger Street","receiver_name":"Sara","size":"S","priority":"normal","status":"pending"}]}';
const _orderJson =
    '{"id":"order_1","pickup_label":"Hebron Merchant Pickup","status":"batched","created_at":"2026-07-13T08:00:00.000Z","parcels":$_parcelsJson,"parcel_batches":[$_batchJson]}';
const _scoringJson =
    '{"corridorOverlap":0.95,"pickupDistanceScore":0.82,"timingFit":0.9,"trustScore":0.86,"capacityFit":1,"finalScore":0.9317}';
const _matchJson =
    '{"id":"match_1","status":"proposed","score":"0.9317","method":"darb_route_score","explanation":"Safe route explanation","scoring_breakdown":$_scoringJson,"created_at":"2026-07-13T08:10:00.000Z","driver_route":$_routeJson,"passenger_request":null,"merchant_order":{"id":"order_1","pickup_label":"Hebron Merchant Pickup","status":"batched","parcel_count":3,"created_at":"2026-07-13T08:00:00.000Z"},"parcel_batch":null}';
const _tripJson =
    '{"id":"trip_1","status":"accepted","created_at":"2026-07-13T08:20:00.000Z","driver_route":$_routeJson,"merchant_order":{"id":"order_1","pickup_label":"Hebron Merchant Pickup","status":"assigned","created_at":"2026-07-13T08:00:00.000Z","parcels":$_parcelsJson},"parcel_batch":null}';
const _locationJson =
    '{"lat":"31.650000","lng":"35.150000","source":"simulated","sequence":2,"recorded_at":"2026-07-13T08:21:00.000Z"}';
