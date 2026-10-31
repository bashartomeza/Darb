import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/matching/data/matching_repository.dart';
import 'package:masari_mobile/features/passenger/data/passenger_request_selection_storage.dart';

import 'support/auth_test_support.dart';
import 'support/booking_recovery_test_support.dart';

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
    'unresolved selected create blocks unknown identities while preserving an established request pin',
    () async {
      final pending = MemoryBookingStorage();
      final mutation = testBookingMutation(storage: pending);
      final old = await mutation.create(
        payload: _payload,
        recoveryContext: _context,
        send: (_, _, _) async => {
          'request': {'id': 'old-request'},
        },
      );
      await mutation.acknowledge(old);
      pending.selections.saveFailure = StateError(
        'pin not persisted after commit',
      );
      await expectLater(
        mutation.create(
          payload: {..._payload, 'passenger_count': 2},
          recoveryContext: const {
            'option': {'id': 'new-route'},
          },
          send: (_, _, _) async => {
            'request': {'id': 'new-request'},
          },
        ),
        throwsStateError,
      );
      var calls = 0;
      final auth = TestAuthenticatedClient(
        handler: (request) async {
          calls++;
          expect(jsonDecode(request.body)['driverRouteId'], 'selected-route');
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
        mutation: mutation,
      );
      await repository.runForPassengerRequest('old-request');
      for (final requestId in ['new-request', 'unrelated-old-request']) {
        await expectLater(
          repository.runForPassengerRequest(requestId),
          throwsA(
            isA<ApiException>().having(
              (e) => e.message,
              'unresolved request identity',
              'booking_outcome_unknown',
            ),
          ),
        );
        await expectLater(
          repository.latestForPassengerRequest(requestId),
          throwsA(isA<ApiException>()),
        );
      }
      expect(calls, 1);
      expect(await mutation.pending(), isNotNull);
    },
  );

  test(
    'actor change during pin persistence cannot acknowledge the original pending create',
    () async {
      final pending = MemoryBookingStorage();
      var actor = 'A';
      final mutation = testBookingMutation(
        storage: pending,
        actor: () => actor,
      );
      pending.selections.beforeSave = () async {
        actor = 'B';
      };
      await expectLater(
        mutation.create(
          payload: _payload,
          recoveryContext: _context,
          send: (_, _, _) async => {
            'request': {'id': 'saved-request'},
          },
        ),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'actor fence',
            'session_changed',
          ),
        ),
      );
      expect(pending.selections.values[('B', 'saved-request')], isNull);
      actor = 'A';
      expect(await mutation.pending(), isNotNull);
      expect(
        await mutation.selectedDriverRouteForRequest('saved-request'),
        'selected-route',
      );
    },
  );
  test(
    'concurrent selection writers cannot replace an established immutable pin',
    () async {
      FlutterSecureStorage.setMockInitialValues({});
      const first = PassengerRequestSelectionStorage(FlutterSecureStorage());
      const second = PassengerRequestSelectionStorage(FlutterSecureStorage());
      await expectLater(
        Future.wait([
          first.save('actor', 'saved-request', 'selected-route'),
          second.save('actor', 'saved-request', 'alternative-route'),
        ]),
        throwsFormatException,
      );
      expect(await first.read('actor', 'saved-request'), 'selected-route');
    },
  );
  test(
    'acknowledged request retains its pin for run and reconciliation after restart',
    () async {
      final pending = MemoryBookingStorage();
      final first = testBookingMutation(storage: pending);
      final receipt = await first.create(
        payload: _payload,
        recoveryContext: _context,
        send: (_, _, _) async => {
          'request': {'id': 'saved-request'},
        },
      );
      await first.acknowledge(receipt);
      expect(await first.pending(), isNull);
      final restarted = testBookingMutation(storage: pending);
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
        mutation: restarted,
      );
      expect(
        (await repository.runForPassengerRequest('saved-request')).id,
        'match-selected-route',
      );
      expect(sent.single['driverRouteId'], 'selected-route');
      expect(
        await repository.latestForPassengerRequest('saved-request'),
        isNull,
      );
      await expectLater(
        repository.runForPassengerRequest(
          'saved-request',
          driverRouteId: 'alternative-route',
        ),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'route conflict',
            'selected_driver_route_unavailable',
          ),
        ),
      );
      await expectLater(
        repository.latestForPassengerRequest(
          'saved-request',
          driverRouteId: 'alternative-route',
        ),
        throwsA(isA<ApiException>()),
      );
      expect(sent, hasLength(1));
    },
  );

  test(
    'unreadable pin fails closed even with an explicitly supplied route',
    () async {
      final pending = MemoryBookingStorage();
      pending.selections.readFailure = const FormatException(
        'corrupt secure selection',
      );
      var calls = 0;
      final auth = TestAuthenticatedClient(
        handler: (_) async {
          calls++;
          return http.Response('{}', 500);
        },
      );
      final repository = MatchingRepository(
        apiClient: auth.client,
        mutation: testBookingMutation(storage: pending),
      );
      await expectLater(
        repository.runForPassengerRequest(
          'saved-request',
          driverRouteId: 'alternative-route',
        ),
        throwsFormatException,
      );
      await expectLater(
        repository.latestForPassengerRequest('saved-request'),
        throwsFormatException,
      );
      expect(calls, 0);
    },
  );

  test(
    'the same saved request id cannot expose actor A selection to actor B',
    () async {
      final pending = MemoryBookingStorage();
      var actor = 'A';
      final mutation = testBookingMutation(
        storage: pending,
        actor: () => actor,
      );
      final receipt = await mutation.create(
        payload: _payload,
        recoveryContext: _context,
        send: (_, _, _) async => {
          'request': {'id': 'saved-request'},
        },
      );
      await mutation.acknowledge(receipt);
      actor = 'B';
      expect(
        await mutation.selectedDriverRouteForRequest('saved-request'),
        isNull,
      );
      actor = 'A';
      expect(
        await mutation.selectedDriverRouteForRequest('saved-request'),
        'selected-route',
      );
    },
  );

  test('actor change during pin read cannot send a matching request', () async {
    final pending = MemoryBookingStorage();
    var actor = 'A';
    pending.selections.beforeRead = () async {
      actor = 'B';
    };
    var calls = 0;
    final auth = TestAuthenticatedClient(
      handler: (_) async {
        calls++;
        return http.Response('{}', 500);
      },
    );
    final repository = MatchingRepository(
      apiClient: auth.client,
      mutation: testBookingMutation(storage: pending, actor: () => actor),
    );
    await expectLater(
      repository.runForPassengerRequest('saved-request'),
      throwsA(
        isA<ApiException>().having(
          (e) => e.message,
          'actor fence',
          'session_changed',
        ),
      ),
    );
    expect(calls, 0);
  });

  test(
    'failed pin persistence preserves the exact create identity for replay',
    () async {
      final pending = MemoryBookingStorage();
      pending.selections.saveFailure = StateError('secure store unavailable');
      final mutation = testBookingMutation(storage: pending);
      final keys = <String>[];
      Future<Map<String, dynamic>> send(
        Map<String, dynamic> body,
        String key,
        Future<void> Function() beforeRetry,
      ) async {
        keys.add(key);
        return {
          'request': {'id': 'saved-request'},
        };
      }

      await expectLater(
        mutation.create(
          payload: _payload,
          recoveryContext: _context,
          send: send,
        ),
        throwsStateError,
      );
      final unresolved = await mutation.pending();
      expect(unresolved, isNotNull);
      pending.selections.saveFailure = null;
      final restarted = testBookingMutation(storage: pending);
      final receipt = await restarted.create(
        payload: _payload,
        recoveryContext: _context,
        send: send,
      );
      await restarted.acknowledge(receipt);
      expect(keys, [unresolved!.idempotencyKey, unresolved.idempotencyKey]);
      expect(
        await restarted.selectedDriverRouteForRequest('saved-request'),
        'selected-route',
      );
      expect(await restarted.pending(), isNull);
    },
  );
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
