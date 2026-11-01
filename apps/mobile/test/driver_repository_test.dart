import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:darb_mobile/features/auth/data/authenticated_api_client.dart';
import 'package:darb_mobile/features/auth/domain/auth_models.dart';
import 'package:darb_mobile/features/driver/data/driver_repository.dart';

import 'support/auth_test_support.dart';

void main() {
  test(
    'route list, active, create payload, and deactivation parsing',
    () async {
      Map<String, dynamic>? createBody;
      var deactivated = false;
      final paths = <String>[];
      final repository = DriverRepository(
        apiClient: _client((request) async {
          final path = request.url.path;
          paths.add(path);
          if (path.endsWith('/driver/routes/active')) {
            return http.Response('{"routes":[$_routeJson]}', 200);
          }
          if (path.endsWith('/driver/routes') && request.method == 'POST') {
            createBody = jsonDecode(request.body) as Map<String, dynamic>;
            return http.Response('{"route":$_routeJson}', 201);
          }
          if (path.endsWith('/deactivate')) {
            deactivated = true;
            return http.Response(
              '{"route":${_routeJsonWithStatus('inactive')}}',
              200,
            );
          }
          return http.Response('{"routes":[$_routeJson]}', 200);
        }),
      );

      expect((await repository.listRoutes()).single.originLat, 31.5326);
      expect((await repository.activeRoutes()).single.status, 'active');
      final created = await repository.createRoute(
        serviceRouteId: 'route-heb-bth',
        seatsAvailable: 3,
        parcelCapacityAvailable: 8,
      );
      expect(created.destinationLng, 35.2024);
      // The chosen route only: the server fills the ends from its cities.
      expect(createBody, {
        'service_route_id': 'route-heb-bth',
        'seats_available': 3,
        'parcel_capacity_available': 8,
      });
      expect(paths.where((path) => path.contains('corridor')), isEmpty);
      // A route saved before routes existed is replayed without one.
      await repository.createRoute(
        serviceRouteId: null,
        seatsAvailable: 3,
        parcelCapacityAvailable: 8,
      );
      expect(createBody, {
        'seats_available': 3,
        'parcel_capacity_available': 8,
      });
      expect((await repository.deactivateRoute('route_1')).status, 'inactive');
      expect(deactivated, isTrue);
    },
  );

  test(
    'explicit online state preserves the key and payload through refresh',
    () async {
      final now = DateTime.utc(2026, 8, 6, 10);
      final observedKeys = <String?>[];
      final observedBodies = <String>[];
      var onlineCalls = 0;
      var beforeRetryCalls = 0;
      final harness = TestAuthenticatedClient(
        now: () => now,
        bundle: AuthTokenBundle(
          accessToken: 'old-access',
          refreshToken: 'old-refresh',
          accessTokenExpiresAt: now.add(const Duration(minutes: 10)),
          refreshTokenExpiresAt: now.add(const Duration(days: 1)),
          sessionId: 'session_1',
        ),
        handler: (request) async {
          if (request.url.path.endsWith('/auth/refresh')) {
            return http.Response(_refreshResponse, 200);
          }
          onlineCalls += 1;
          observedKeys.add(request.headers['idempotency-key']);
          observedBodies.add(request.body);
          if (onlineCalls == 1) {
            expect(
              request.headers[HttpHeaders.authorizationHeader],
              'Bearer old-access',
            );
            return http.Response('{"error":"access_token_expired"}', 401);
          }
          expect(
            request.headers[HttpHeaders.authorizationHeader],
            'Bearer new-access',
          );
          return http.Response(
            '{"online":true,"route_id":"route_1","replayed":true}',
            200,
          );
        },
      );
      final repository = DriverRepository(apiClient: harness.client);

      final result = await repository.setLegacyOnlineState(
        online: true,
        idempotencyKey: 'stable-online-key',
        beforeRetry: () async => beforeRetryCalls += 1,
      );

      expect(result.online, isTrue);
      expect(observedKeys, ['stable-online-key', 'stable-online-key']);
      expect(observedBodies.toSet(), hasLength(1));
      expect(jsonDecode(observedBodies.toSet().single), {'online': true});
      expect(beforeRetryCalls, 1);
    },
  );

  test('going online can name the route the driver chose', () async {
    String? body;
    final repository = DriverRepository(
      apiClient: _client((request) async {
        body = request.body;
        return http.Response(
          '{"online":true,"route_id":"route_1","replayed":false}',
          200,
        );
      }),
    );
    await repository.setLegacyOnlineState(
      online: true,
      idempotencyKey: 'online-key-0001',
      serviceRouteId: 'route-heb-bth',
    );
    expect(jsonDecode(body!), {
      'online': true,
      'service_route_id': 'route-heb-bth',
    });
  });

  test('match and trip payloads carry the typed pickup and drop-off', () async {
    final repository = DriverRepository(
      apiClient: _client((request) async {
        if (request.url.path.endsWith('/matches/match_2')) {
          return http.Response(
            '{"match":$_routeMatchJson}',
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        return http.Response(
          '{"trip":$_routeTripJson}',
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    final match = await repository.matchDetail('match_2');
    expect(match.route.routeName(arabic: true), 'الخليل ← بيت لحم');
    expect(match.passengerRequest?.pickupDetails, 'Near the PPU main gate');
    expect(match.passengerRequest?.dropoffDetails, 'Bethlehem bus station');
    expect(match.merchantOrder?.pickupDetails, 'Al-Amal store');

    final trip = await repository.tripDetail('trip_2');
    expect(trip.route.serviceRouteId, 'route-heb-bth');
    expect(trip.route.routeName(arabic: false), 'Hebron → Bethlehem');
    final parcels = trip.merchantOrder!.parcels;
    expect(parcels, hasLength(2));
    expect(parcels.first.dropoffDetails, 'Manger Street, blue gate');
    expect(parcels.first.receiverName, 'Sara');
    expect(parcels.first.receiverPhone, '+970599123456');
    expect(parcels.last.dropoffDetails, isNull);
    expect(parcels.last.destinationLabel, 'Bethlehem Center');
  });

  test(
    'match inbox, status filter, detail, accept, and reject parsing',
    () async {
      Uri? filteredUri;
      var rejected = false;
      final repository = DriverRepository(
        apiClient: _client((request) async {
          final path = request.url.path;
          if (path.endsWith('/accept')) {
            return http.Response(
              '{"trip":{"id":"trip_1","status":"accepted"},"matchId":"match_1"}',
              201,
            );
          }
          if (path.endsWith('/reject')) {
            rejected = true;
            return http.Response('{"match":{"status":"rejected"}}', 200);
          }
          if (path.endsWith('/matches/match_1')) {
            return http.Response('{"match":$_matchJson}', 200);
          }
          filteredUri = request.url;
          return http.Response('{"matches":[$_matchJson]}', 200);
        }),
      );

      final inbox = await repository.listMatches(status: 'proposed');
      expect(filteredUri?.queryParameters['status'], 'proposed');
      expect(inbox.single.breakdown.finalScore, 0.9317);
      expect(inbox.single.passengerRequest?.passengerCount, 1);
      expect(inbox.single.merchantOrder?.parcelCount, 5);
      expect(inbox.single.parcelBatch?.estimatedDistanceSaved, 86.12);
      expect((await repository.matchDetail('match_1')).id, 'match_1');
      expect((await repository.acceptMatch('match_1')).id, 'trip_1');
      await repository.rejectMatch('match_1');
      expect(rejected, isTrue);
    },
  );

  test(
    'trip list/detail, status, simulation, and location contracts',
    () async {
      Map<String, dynamic>? statusBody;
      var resetCalled = false;
      final repository = DriverRepository(
        apiClient: _client((request) async {
          final path = request.url.path;
          if (path.endsWith('/status')) {
            statusBody = jsonDecode(request.body) as Map<String, dynamic>;
            return http.Response('{"trip":{"status":"pickup_started"}}', 200);
          }
          if (path.endsWith('/simulate/step')) {
            return http.Response('{"location":$_locationJson}', 201);
          }
          if (path.endsWith('/simulate/reset')) {
            resetCalled = true;
            return http.Response('{"ok":true}', 200);
          }
          if (path.endsWith('/location')) {
            return http.Response('{"location":$_locationJson}', 200);
          }
          if (path.endsWith('/trips')) {
            return http.Response('{"trips":[$_tripJson]}', 200);
          }
          return http.Response('{"trip":$_tripJson}', 200);
        }),
      );

      expect(
        (await repository.listTrips()).single.nextStatus,
        'pickup_started',
      );
      expect((await repository.tripDetail('trip_1')).route.status, 'assigned');
      await repository.updateTripStatus('trip_1', 'pickup_started');
      expect(statusBody, {'status': 'pickup_started'});
      expect((await repository.simulateStep('trip_1')).sequence, 0);
      await repository.resetSimulation('trip_1');
      expect(resetCalled, isTrue);
      expect((await repository.latestLocation('trip_1'))?.lat, 31.5326);
    },
  );
}

AuthenticatedApiClient _client(
  Future<http.Response> Function(http.Request request) handler,
) => TestAuthenticatedClient(handler: handler).client;

const _routeJson =
    '{"id":"route_1","origin_label":"Hebron / PPU / Bab Al-Zawiya","origin_lat":"31.532600","origin_lng":"35.099800","destination_label":"Bethlehem","destination_lat":"31.705400","destination_lng":"35.202400","corridor_key":"hebron-ppu-bab-al-zawiya-to-bethlehem","seats_available":2,"parcel_capacity_available":5,"status":"active","activated_at":"2026-07-13T08:00:00.000Z","completed_at":null}';

String _routeJsonWithStatus(String status) =>
    _routeJson.replaceFirst('"status":"active"', '"status":"$status"');

const _matchJson =
    '{"id":"match_1","status":"proposed","score":"0.9317","method":"darb_route_score","explanation":"Safe explanation","scoring_breakdown":{"corridorOverlap":0.95,"pickupDistanceScore":0.82,"timingFit":0.9,"trustScore":0.86,"capacityFit":1,"finalScore":0.9317},"created_at":"2026-07-13T08:10:00.000Z","driver_route":{"id":"route_1","origin_label":"Hebron / PPU / Bab Al-Zawiya","destination_label":"Bethlehem","corridor_key":"hebron-ppu-bab-al-zawiya-to-bethlehem","seats_available":2,"parcel_capacity_available":5,"status":"active","driver":{"vehicle_type":"sedan","verified":true,"trust_score":86}},"passenger_request":{"id":"request_1","pickup_label":"PPU Main Gate","destination_label":"Bethlehem Center","preferred_time":"2026-07-13T09:00:00.000Z","passenger_count":1,"status":"pending","created_at":"2026-07-13T08:00:00.000Z"},"merchant_order":{"id":"order_1","pickup_label":"Hebron Merchant","status":"submitted","parcel_count":5,"created_at":"2026-07-13T08:00:00.000Z"},"parcel_batch":{"id":"batch_1","status":"created","estimated_distance_saved":"86.12","explanation":"Shared route","created_at":"2026-07-13T08:05:00.000Z"}}';

const _tripJson =
    '{"id":"trip_1","status":"accepted","created_at":"2026-07-13T08:20:00.000Z","started_at":"2026-07-13T08:20:00.000Z","completed_at":null,"driver_route":$_routeJsonAssigned,"passenger_request":{"id":"request_1","pickup_label":"PPU Main Gate","destination_label":"Bethlehem Center","passenger_count":1,"status":"accepted"},"merchant_order":{"id":"order_1","pickup_label":"Hebron Merchant","status":"assigned","parcels":[{},{}]},"parcel_batch":{"id":"batch_1","status":"assigned","estimated_distance_saved":"86.12","explanation":"Shared route"}}';

const _routeJsonAssigned =
    '{"id":"route_1","origin_label":"Hebron / PPU / Bab Al-Zawiya","origin_lat":"31.532600","origin_lng":"35.099800","destination_label":"Bethlehem","destination_lat":"31.705400","destination_lng":"35.202400","corridor_key":"hebron-ppu-bab-al-zawiya-to-bethlehem","seats_available":2,"parcel_capacity_available":5,"status":"assigned","activated_at":"2026-07-13T08:00:00.000Z","completed_at":null}';

const _routeFields =
    '"service_route_id":"route-heb-bth","route_name_ar":"الخليل ← بيت لحم","route_name_en":"Hebron → Bethlehem"';

const _routeMatchJson =
    '{"id":"match_2","status":"proposed","score":"0.9","method":"darb_route_score","explanation":"Same route","scoring_breakdown":{"corridorOverlap":1,"pickupDistanceScore":0.8,"timingFit":0.9,"trustScore":0.86,"capacityFit":1,"finalScore":0.9},"created_at":"2026-07-13T08:10:00.000Z","driver_route":{"id":"route_1","origin_label":"Hebron","destination_label":"Bethlehem","corridor_key":"hebron-to-bethlehem",$_routeFields,"seats_available":2,"parcel_capacity_available":5,"status":"active"},"passenger_request":{"id":"request_2","pickup_label":"Hebron","destination_label":"Bethlehem",$_routeFields,"pickup_details":"Near the PPU main gate","dropoff_details":"Bethlehem bus station","passenger_count":1,"status":"pending"},"merchant_order":{"id":"order_2","pickup_label":"Hebron",$_routeFields,"pickup_details":"Al-Amal store","status":"submitted","parcel_count":2},"parcel_batch":null}';

const _routeTripJson =
    '{"id":"trip_2","status":"accepted","created_at":"2026-07-13T08:20:00.000Z","started_at":null,"completed_at":null,"driver_route":{"id":"route_1","origin_label":"Hebron","origin_lat":31.5326,"origin_lng":35.0998,"destination_label":"Bethlehem","destination_lat":31.7054,"destination_lng":35.2024,"corridor_key":"hebron-to-bethlehem",$_routeFields,"seats_available":2,"parcel_capacity_available":5,"status":"assigned","activated_at":null,"completed_at":null},"passenger_request":null,"merchant_order":{"id":"order_2","pickup_label":"Hebron",$_routeFields,"pickup_details":"Al-Amal store","status":"assigned","parcels":[{"id":"p1","destination_label":"Bethlehem","dropoff_details":"Manger Street, blue gate","receiver_name":"Sara","receiver_phone":"+970599123456","size":"S"},{"id":"p2","destination_label":"Bethlehem Center","size":"M"}]},"parcel_batch":null}';

const _locationJson =
    '{"lat":"31.532600","lng":"35.099800","source":"simulated","sequence":0,"recorded_at":"2026-07-13T08:21:00.000Z"}';

const _refreshResponse =
    '{"token":"new-access","access_token":"new-access","access_token_expires_in":120,"refresh_token":"new-refresh","refresh_token_expires_in":3600,"session":{"id":"session_1","client_type":"mobile","device_name":"Darb Android","created_at":"2026-08-06T10:00:00.000Z","last_used_at":"2026-08-06T10:00:00.000Z","expires_at":"2026-08-06T11:00:00.000Z","is_current":true,"revoked":false},"user":{"id":"driver_1","name":"Driver","phone":"+970590000002","role":"driver","demo_account":false}}';
