import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/auth/data/authenticated_api_client.dart';
import 'package:masari_mobile/features/matching/data/matching_repository.dart';
import 'package:masari_mobile/features/passenger/data/passenger_models.dart';
import 'package:masari_mobile/features/passenger/data/passenger_repository.dart';
import 'package:masari_mobile/features/trips/data/trip_repository.dart';

import 'support/auth_test_support.dart';
import 'support/booking_recovery_test_support.dart';

void main() {
  test(
    'passenger request list, active, detail, create, and cancel parsing',
    () async {
      Map<String, dynamic>? createBody;

      final repo = PassengerRepository(
        apiClient: _client((request) async {
          if (request.url.path.endsWith('/passenger/requests') &&
              request.method == 'POST') {
            createBody = jsonDecode(request.body) as Map<String, dynamic>;

            return http.Response('{"request":${_requestJson('created')}}', 201);
          }

          if (request.url.path.endsWith('/cancel')) {
            return http.Response(
              '{"request":${_requestJson('cancelled')}}',
              200,
            );
          }

          if (request.url.path.endsWith('/active')) {
            return http.Response(
              '{"requests":[${_requestJson('pending')}]}',
              200,
            );
          }

          if (request.url.path.endsWith('/request_1')) {
            return http.Response('{"request":${_requestJson('pending')}}', 200);
          }

          return http.Response(
            '{"requests":[${_requestJson('pending')}]}',
            200,
          );
        }),
      );

      // ------------------------------------------------------------------
      // LIST
      // ------------------------------------------------------------------

      expect((await repo.listRequests()).single.id, 'request_1');

      // ------------------------------------------------------------------
      // ACTIVE
      // ------------------------------------------------------------------

      expect((await repo.activeRequests()).single.status, 'pending');

      // ------------------------------------------------------------------
      // DETAIL
      // ------------------------------------------------------------------

      expect(
        (await repo.requestDetail('request_1')).pickupLabel,
        'PPU Main Gate',
      );

      // ------------------------------------------------------------------
      // CREATE
      // ------------------------------------------------------------------

      await repo.createRequest(
        pickup: const PassengerLocation(
          label: 'PPU Main Gate',
          latitude: 31.550000,
          longitude: 35.100000,
        ),
        destination: const PassengerLocation(
          label: 'Bethlehem Center',
          latitude: 31.705400,
          longitude: 35.202400,
        ),
        preferredTime: DateTime.utc(2026, 7, 2, 10),
        passengerCount: 2,
      );

      expect(createBody?['pickup_label'], 'PPU Main Gate');

      expect(createBody?['pickup_lat'], 31.55);

      expect(createBody?['pickup_lng'], 35.1);

      expect(createBody?['destination_label'], 'Bethlehem Center');

      expect(createBody?['destination_lat'], 31.7054);

      expect(createBody?['destination_lng'], 35.2024);

      expect(createBody?['passenger_count'], 2);

      // ------------------------------------------------------------------
      // CANCEL
      // ------------------------------------------------------------------

      expect((await repo.cancelRequest('request_1')).status, 'cancelled');
    },
  );

  test('match run and scoring breakdown parsing', () async {
    final repo = MatchingRepository(
      mutation: testBookingMutation(),
      apiClient: _client((request) async => http.Response(_matchResponse, 201)),
    );

    final match = await repo.runForPassengerRequest('request_1');

    expect(match.id, 'match_1');

    expect(match.breakdown.corridorOverlap, 0.95);

    expect(match.score, 0.9317);

    expect(match.passengerRequestId, 'request_1');
  });

  test('persisted passenger match can be recovered after reopening', () async {
    final repo = MatchingRepository(
      mutation: testBookingMutation(),
      apiClient: _client(
        (request) async => http.Response(
          '{"matches":[${_matchSummaryJson("accepted")}]}',
          200,
        ),
      ),
    );

    final match = await repo.latestForPassengerRequest('request_1');
    expect(match?.id, 'match_1');
    expect(match?.status, 'accepted');
    expect(match?.passengerRequestId, 'request_1');
  });

  test('trip list, detail, location, and backend error mapping', () async {
    final repo = TripRepository(
      apiClient: _client((request) async {
        if (request.url.path.endsWith('/location')) {
          return http.Response('{"location":$_locationJson}', 200);
        }

        if (request.url.path.endsWith('/missing')) {
          return http.Response('{"error":"trip_not_found"}', 404);
        }

        if (request.url.path.endsWith('/trips')) {
          return http.Response('{"trips":[$_tripJson]}', 200);
        }

        return http.Response('{"trip":$_tripJson}', 200);
      }),
    );

    expect((await repo.listTrips()).single.status, 'accepted');

    expect((await repo.tripDetail('trip_1')).routeLabel, contains('Hebron'));

    expect((await repo.latestLocation('trip_1'))?.sequence, 0);

    await expectLater(repo.tripDetail('missing'), throwsA(isA<ApiException>()));
  });
}

// ==========================================================================
// TEST CLIENT
// ==========================================================================

AuthenticatedApiClient _client(
  Future<http.Response> Function(http.Request request) handler,
) {
  return TestAuthenticatedClient(handler: handler).client;
}

// ==========================================================================
// PASSENGER REQUEST JSON
// ==========================================================================

String _requestJson(String status) =>
    '{"id":"request_1",'
    '"pickup_label":"PPU Main Gate",'
    '"pickup_lat":"31.550000",'
    '"pickup_lng":"35.100000",'
    '"destination_label":"Bethlehem Center",'
    '"destination_lat":"31.705400",'
    '"destination_lng":"35.202400",'
    '"preferred_time":"2026-07-02T09:00:00.000Z",'
    '"passenger_count":1,'
    '"status":"$status",'
    '"created_at":"2026-07-01T09:00:00.000Z"}';

// ==========================================================================
// MATCHING
// ==========================================================================

const _matchResponse =
    '{"match":{'
    '"id":"match_1",'
    '"status":"proposed",'
    '"score":"0.9317",'
    '"explanation":"Driver selected.",'
    '"driver_route":{'
    '"origin_label":"Hebron / PPU / Bab Al-Zawiya",'
    '"destination_label":"Bethlehem",'
    '"driver":{"vehicle_type":"sedan"}'
    '},'
    '"passenger_request":{"id":"request_1"}'
    '},'
    '"scoringBreakdown":{'
    '"corridorOverlap":0.95,'
    '"pickupDistanceScore":0.827,'
    '"timingFit":0.9,'
    '"trustScore":0.86,'
    '"capacityFit":1,'
    '"finalScore":0.9317'
    '}}';

String _matchSummaryJson(String status) =>
    '{"id":"match_1",'
    '"status":"$status",'
    '"score":"0.9317",'
    '"explanation":"Driver selected.",'
    '"scoring_breakdown":{'
    '"corridorOverlap":0.95,'
    '"pickupDistanceScore":0.827,'
    '"timingFit":0.9,'
    '"trustScore":0.86,'
    '"capacityFit":1,'
    '"finalScore":0.9317},'
    '"driver_route":{'
    '"origin_label":"Hebron / PPU / Bab Al-Zawiya",'
    '"destination_label":"Bethlehem",'
    '"driver":{"vehicle_type":"sedan"}},'
    '"passenger_request":{"id":"request_1"}}';

// ==========================================================================
// TRIP
// ==========================================================================

const _tripJson =
    '{"id":"trip_1",'
    '"status":"accepted",'
    '"created_at":"2026-07-01T09:00:00.000Z",'
    '"driver_route":{'
    '"origin_label":"Hebron / PPU / Bab Al-Zawiya",'
    '"destination_label":"Bethlehem"'
    '}}';

// ==========================================================================
// LOCATION
// ==========================================================================

const _locationJson =
    '{"lat":"31.550000",'
    '"lng":"35.100000",'
    '"source":"simulated",'
    '"sequence":0,'
    '"recorded_at":"2026-07-01T09:01:00.000Z"}';
