import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:darb_mobile/core/api/api_error.dart';
import 'package:darb_mobile/features/matching/data/matching_repository.dart';
import 'package:darb_mobile/features/passenger/data/passenger_models.dart';

import 'support/auth_test_support.dart';
import 'support/booking_recovery_test_support.dart';

// The driver route a passenger picks is saved on the request by the server.
// The device only carries it inside the pending create until that write is
// confirmed; matching and reconciliation read it back from the request JSON.

final _payload = {
  'pickup_label': 'Origin',
  'pickup_lat': 31.8,
  'pickup_lng': 35.3,
  'destination_label': 'Destination',
  'destination_lat': 32.1,
  'destination_lng': 35.4,
  'preferred_time': '2030-01-02T12:00:00.000Z',
  'passenger_count': 1,
};
const _context = {
  'option': {'id': 'selected-route'},
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'the picked route travels in the create body, not on the device',
    () async {
      final pending = MemoryBookingStorage();
      final mutation = testBookingMutation(storage: pending);
      final sent = <Map<String, dynamic>>[];
      final receipt = await mutation.create(
        payload: _payload,
        recoveryContext: _context,
        send: (body, _, _) async {
          sent.add(body);
          return {
            'request': {'id': 'saved-request'},
          };
        },
      );
      expect(sent.single['selected_driver_route_id'], 'selected-route');
      expect(sent.single.containsKey('client_recovery'), isFalse);
      expect(sent.single.containsKey('route_version_id'), isFalse);
      expect(receipt.value, 'saved-request');
      await mutation.acknowledge(receipt);
      // Once the server confirmed the request, nothing about it stays on the device.
      expect(await mutation.pending(), isNull);
    },
  );

  test(
    'a lost create response replays the identical pinned body under the same key',
    () async {
      final pending = MemoryBookingStorage();
      final calls = <(String, Map<String, dynamic>)>[];
      var lose = true;
      Future<Map<String, dynamic>> send(
        Map<String, dynamic> body,
        String key,
        Future<void> Function() beforeRetry,
      ) async {
        calls.add((key, body));
        if (lose) {
          lose = false;
          throw const ApiException(ApiErrorType.network, 'network');
        }
        return {
          'request': {'id': 'saved-request'},
        };
      }

      await expectLater(
        testBookingMutation(
          storage: pending,
        ).create(payload: _payload, recoveryContext: _context, send: send),
        throwsA(isA<ApiException>()),
      );
      expect(await testBookingMutation(storage: pending).pending(), isNotNull);
      final restarted = testBookingMutation(storage: pending);
      final receipt = await restarted.create(
        payload: _payload,
        recoveryContext: _context,
        send: send,
      );
      await restarted.acknowledge(receipt);
      expect(calls, hasLength(2));
      expect(calls[1].$1, calls[0].$1);
      expect(jsonEncode(calls[1].$2), jsonEncode(calls[0].$2));
      expect(calls[1].$2['selected_driver_route_id'], 'selected-route');
      expect(await restarted.pending(), isNull);
    },
  );

  test(
    'an unavailable picked route on replay is a definitive rejection',
    () async {
      final pending = MemoryBookingStorage();
      var attempt = 0;
      Future<Map<String, dynamic>> send(
        Map<String, dynamic> body,
        String key,
        Future<void> Function() beforeRetry,
      ) async {
        attempt++;
        if (attempt == 1) {
          throw const ApiException(ApiErrorType.network, 'network');
        }
        // The server rolls the whole create back; no request exists.
        throw const ApiException(
          ApiErrorType.validation,
          'selected_driver_route_unavailable',
          statusCode: 409,
        );
      }

      final mutation = testBookingMutation(storage: pending);
      await expectLater(
        mutation.create(
          payload: _payload,
          recoveryContext: _context,
          send: send,
        ),
        throwsA(isA<ApiException>()),
      );
      expect(await mutation.pending(), isNotNull);
      await expectLater(
        mutation.create(
          payload: _payload,
          recoveryContext: _context,
          send: send,
        ),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            'selected_driver_route_unavailable',
          ),
        ),
      );
      expect(await mutation.pending(), isNull);
    },
  );

  test('a recovery context without a picked route sends nothing', () async {
    final mutation = testBookingMutation();
    var calls = 0;
    await expectLater(
      mutation.create(
        payload: _payload,
        recoveryContext: const {'option': <String, dynamic>{}},
        send: (_, _, _) async {
          calls++;
          return {
            'request': {'id': 'saved-request'},
          };
        },
      ),
      throwsFormatException,
    );
    expect(calls, 0);
    expect(await mutation.pending(), isNull);
  });

  test('the request JSON carries the saved pick', () {
    final json = {
      'id': 'saved-request',
      'pickup_label': 'Origin',
      'pickup_lat': '31.800000',
      'pickup_lng': '35.300000',
      'destination_label': 'Destination',
      'destination_lat': '32.100000',
      'destination_lng': '35.400000',
      'preferred_time': '2030-01-02T12:00:00.000Z',
      'passenger_count': 1,
      'status': 'pending',
      'created_at': '2030-01-01T12:00:00.000Z',
    };
    expect(
      PassengerRequest.fromJson({
        ...json,
        'selected_driver_route_id': 'selected-route',
      }).selectedDriverRouteId,
      'selected-route',
    );
    expect(
      PassengerRequest.fromJson({
        ...json,
        'selected_driver_route_id': null,
      }).selectedDriverRouteId,
      isNull,
    );
    expect(PassengerRequest.fromJson(json).selectedDriverRouteId, isNull);
  });

  test(
    'matching sends the saved pick and reconciliation ignores other routes',
    () async {
      final sent = <Map<String, dynamic>>[];
      final auth = TestAuthenticatedClient(
        handler: (request) async {
          if (request.method == 'POST') {
            sent.add(jsonDecode(request.body) as Map<String, dynamic>);
            return http.Response(
              jsonEncode({
                'match': _match('selected-route'),
                'scoringBreakdown': _scoring,
              }),
              201,
            );
          }
          return http.Response(
            jsonEncode({
              'matches': [_match('alternative-route')],
            }),
            200,
          );
        },
      );
      final repository = MatchingRepository(
        apiClient: auth.client,
        mutation: testBookingMutation(),
      );
      expect(
        (await repository.runForPassengerRequest(
          'saved-request',
          driverRouteId: 'selected-route',
        )).id,
        'match-selected-route',
      );
      expect(sent.single, {
        'passengerRequestId': 'saved-request',
        'driverRouteId': 'selected-route',
      });
      expect(
        await repository.latestForPassengerRequest(
          'saved-request',
          driverRouteId: 'selected-route',
        ),
        isNull,
      );
      // An unpinned request accepts whichever route the server matched.
      expect(
        (await repository.latestForPassengerRequest('saved-request'))?.id,
        'match-alternative-route',
      );
    },
  );

  test('an unpinned request lets the server pick the route', () async {
    final sent = <Map<String, dynamic>>[];
    final auth = TestAuthenticatedClient(
      handler: (request) async {
        sent.add(jsonDecode(request.body) as Map<String, dynamic>);
        return http.Response(
          jsonEncode({
            'match': _match('best-route'),
            'scoringBreakdown': _scoring,
          }),
          201,
        );
      },
    );
    final repository = MatchingRepository(
      apiClient: auth.client,
      mutation: testBookingMutation(),
    );
    await repository.runForPassengerRequest('saved-request');
    expect(sent.single, {'passengerRequestId': 'saved-request'});
  });

  test('an actor change during matching cannot surface the result', () async {
    var actor = 'A';
    final auth = TestAuthenticatedClient(
      handler: (_) async {
        actor = 'B';
        return http.Response(
          jsonEncode({
            'match': _match('selected-route'),
            'scoringBreakdown': _scoring,
          }),
          201,
        );
      },
    );
    final repository = MatchingRepository(
      apiClient: auth.client,
      mutation: testBookingMutation(actor: () => actor),
    );
    await expectLater(
      repository.runForPassengerRequest(
        'saved-request',
        driverRouteId: 'selected-route',
      ),
      throwsA(
        isA<ApiException>().having(
          (e) => e.message,
          'actor fence',
          'session_changed',
        ),
      ),
    );
  });
}

const _scoring = {
  'corridorOverlap': 1,
  'pickupDistanceScore': 1,
  'timingFit': 1,
  'trustScore': 1,
  'capacityFit': 1,
  'finalScore': 1,
};
Map<String, dynamic> _match(String routeId) => {
  'id': 'match-$routeId',
  'status': 'sent_to_driver',
  'score': 1,
  'explanation': 'Synthetic fixture',
  'passenger_request': {'id': 'saved-request'},
  'driver_route': {
    'id': routeId,
    'origin_label': 'Origin',
    'destination_label': 'Destination',
    'seats_available': 1,
  },
  'scoring_breakdown': _scoring,
};
