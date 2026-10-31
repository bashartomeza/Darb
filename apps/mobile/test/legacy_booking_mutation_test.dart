import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/canonical_routes/application/canonical_route_controller.dart';
import 'package:masari_mobile/features/canonical_routes/data/canonical_operation_storage.dart';
import 'package:masari_mobile/features/passenger/application/legacy_passenger_request_mutation.dart';
import 'package:masari_mobile/features/passenger/data/passenger_repository.dart';
import 'package:masari_mobile/features/assistant/data/passenger_assistant_repository.dart';
import 'package:masari_mobile/features/assistant/domain/passenger_assistant_models.dart';
import 'support/auth_test_support.dart';
import 'support/booking_recovery_test_support.dart';

Map<String, dynamic> payload() => {
  'pickup_label': 'Origin',
  'pickup_lat': 31.8,
  'pickup_lng': 35.3,
  'destination_label': 'Destination',
  'destination_lat': 32.1,
  'destination_lng': 35.4,
  'preferred_time': '2030-01-02T12:00:00.000Z',
  'passenger_count': 1,
};

void main() {
  test(
    'assistant recovers a committed match after its response is lost',
    () async {
      final storage = MemoryBookingStorage();
      var creates = 0;
      var matches = 0;
      final auth = TestAuthenticatedClient(
        handler: (request) async {
          if (request.url.path.endsWith('/passenger/requests')) {
            creates++;
            return http.Response('{"request":{"id":"saved"}}', 201);
          }
          if (request.method == 'POST') {
            matches++;
            throw http.ClientException('match response lost');
          }
          return http.Response(
            '{"matches":[{"id":"existing","status":"proposed","passenger_request":{"id":"saved"},"driver_route":{"id":"route"}}]}',
            200,
          );
        },
      );
      final repo = ApiPassengerAssistantRepository(
        apiClient: auth.client,
        mutation: testBookingMutation(storage: storage),
      );
      final draft = PassengerAssistantTripDraft(
        pickupKey: 'bab_al_zawiya',
        pickupLabel: 'Bab Al-Zawiya',
        destinationKey: 'bethlehem',
        destinationLabel: 'Bethlehem Center',
        preferredTime: DateTime.utc(2030, 1, 2, 12),
        passengerCount: 1,
      );
      const option = PassengerAssistantTripOption(
        id: 'route',
        driverName: 'Driver',
        fromLabel: 'Origin',
        toLabel: 'Destination',
        seatsAvailable: 2,
        score: 0.9,
      );
      expect(await repo.selectTrip(draft: draft, option: option), 'existing');
      expect(creates, 1);
      expect(matches, 1);
      expect(storage.bundle, isNull);
    },
  );
  test(
    'durable retry after restart keeps the exact key and strips storage sentinel',
    () async {
      final storage = MemoryBookingStorage();
      final keys = <String>[];
      final client = TestAuthenticatedClient(
        handler: (request) async {
          keys.add(request.headers['idempotency-key']!);
          expect(
            jsonDecode(request.body).containsKey('route_version_id'),
            isFalse,
          );
          if (keys.length == 1) {
            throw http.ClientException('committed response lost');
          }
          return http.Response('{"request":{"id":"saved"}}', 201);
        },
      );
      final repo = PassengerRepository(apiClient: client.client);
      await expectLater(
        testBookingMutation(
          storage: storage,
        ).create(payload: payload(), send: repo.createPayload),
        throwsA(isA<ApiException>()),
      );
      expect(
        (await testBookingMutation(
          storage: storage,
        ).create(payload: payload(), send: repo.createPayload)).value,
        'saved',
      );
      expect(keys, [keys.first, keys.first]);
      expect(storage.bundle, isNotNull);
    },
  );

  test(
    'other actor cannot inspect, replay, or replace unresolved payload',
    () async {
      final storage = MemoryBookingStorage();
      var actor = 'one';
      final mutation = testBookingMutation(
        storage: storage,
        actor: () => actor,
      );
      await expectLater(
        mutation.create(
          payload: payload(),
          send: (_, _, _) async =>
              throw const ApiException(ApiErrorType.timeout, 'timeout'),
        ),
        throwsA(isA<ApiException>()),
      );
      final original = storage.bundle;
      actor = 'two';
      await expectLater(
        mutation.pending(),
        throwsA(isA<CanonicalOperationBlocked>()),
      );
      await expectLater(
        mutation.create(
          payload: payload(),
          send: (_, _, _) async => fail('must not send'),
        ),
        throwsA(isA<CanonicalOperationBlocked>()),
      );
      expect(storage.bundle, same(original));
    },
  );

  test(
    'changed payload cannot mint a replacement key for an unknown booking',
    () async {
      final storage = MemoryBookingStorage();
      final mutation = testBookingMutation(storage: storage);
      await expectLater(
        mutation.create(
          payload: payload(),
          send: (_, _, _) async =>
              throw const ApiException(ApiErrorType.network, 'offline'),
        ),
        throwsA(isA<ApiException>()),
      );
      final key = storage.bundle!.idempotencyKey;
      await expectLater(
        mutation.create(
          payload: {...payload(), 'passenger_count': 2},
          send: (_, _, _) async => fail('must not send'),
        ),
        throwsA(isA<CanonicalOperationBlocked>()),
      );
      expect(storage.bundle!.idempotencyKey, key);
    },
  );

  test('simultaneous creation has only one network owner', () async {
    final mutation = testBookingMutation();
    final response = Completer<Map<String, dynamic>>();
    final first = mutation.create(
      payload: payload(),
      send: (_, _, _) => response.future,
    );
    await expectLater(
      mutation.create(
        payload: payload(),
        send: (_, _, _) async => fail('duplicate HTTP'),
      ),
      throwsStateError,
    );
    response.complete({
      'request': {'id': 'saved'},
    });
    expect((await first).value, 'saved');
  });

  test('secure storage failure prevents the network send', () async {
    final storage = MemoryBookingStorage()
      ..saveFailure = StateError('storage unavailable');
    await expectLater(
      testBookingMutation(storage: storage).create(
        payload: payload(),
        send: (_, _, _) async => fail('must save before sending'),
      ),
      throwsStateError,
    );
  });

  test(
    'confirmed first validation failure clears operation for correction',
    () async {
      final storage = MemoryBookingStorage();
      await expectLater(
        testBookingMutation(storage: storage).create(
          payload: payload(),
          send: (_, _, _) async => throw const ApiException(
            ApiErrorType.validation,
            'invalid_location',
            statusCode: 400,
          ),
        ),
        throwsA(isA<ApiException>()),
      );
      expect(storage.bundle, isNull);
    },
  );

  test(
    'identity remains the same after the recovery TTL and departure have passed',
    () async {
      final storage = MemoryBookingStorage();
      storage.bundle = CanonicalOperationBundle.create(
        operation: LegacyPassengerRequestMutation.operation,
        scope: 'passenger',
        actorId: 'test-passenger',
        payload: {
          ...payload(),
          'preferred_time': '2026-01-01T12:00:00.000Z',
          'route_version_id': LegacyPassengerRequestMutation.sentinel,
        },
        now: DateTime.utc(2026, 1, 1),
      );
      final old = storage.bundle!;
      expect(
        (await testBookingMutation(storage: storage).create(
          payload: Map.from(old.payload)..remove('route_version_id'),
          send: (_, key, _) async {
            expect(key, old.idempotencyKey);
            return {
              'request': {'id': 'saved'},
            };
          },
        )).value,
        'saved',
      );
    },
  );

  test(
    'actor change during HTTP hides the old result and retains recovery',
    () async {
      final storage = MemoryBookingStorage();
      var actor = 'one';
      final mutation = testBookingMutation(
        storage: storage,
        actor: () => actor,
      );
      await expectLater(
        mutation.create(
          payload: payload(),
          send: (_, _, _) async {
            actor = 'two';
            return {
              'request': {'id': 'private'},
            };
          },
        ),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'reason',
            'session_changed',
          ),
        ),
      );
      expect(storage.bundle?.actorId, 'one');
    },
  );

  test(
    'assistant create response loss replays one durable identity after repository restart',
    () async {
      final storage = MemoryBookingStorage();
      final keys = <String>[];
      final auth = TestAuthenticatedClient(
        handler: (request) async {
          if (request.url.path.endsWith('/passenger/requests')) {
            keys.add(request.headers['idempotency-key']!);
            if (keys.length == 1) {
              throw http.ClientException('committed but lost');
            }
            return http.Response('{"request":{"id":"saved"}}', 201);
          }
          return http.Response('{"match":{"id":"matched"}}', 201);
        },
      );
      ApiPassengerAssistantRepository repo() => ApiPassengerAssistantRepository(
        apiClient: auth.client,
        mutation: testBookingMutation(storage: storage),
      );
      final draft = PassengerAssistantTripDraft(
        pickupKey: 'bab_al_zawiya',
        pickupLabel: 'Bab Al-Zawiya',
        destinationKey: 'bethlehem',
        destinationLabel: 'Bethlehem Center',
        preferredTime: DateTime.utc(2030, 1, 2, 12),
        passengerCount: 1,
      );
      const option = PassengerAssistantTripOption(
        id: 'route',
        driverName: 'Driver',
        fromLabel: 'Origin',
        toLabel: 'Destination',
        seatsAvailable: 2,
        score: 0.9,
      );
      await expectLater(
        repo().selectTrip(draft: draft, option: option),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'uncertain outcome',
            'booking_outcome_unknown',
          ),
        ),
      );
      expect(await repo().selectTrip(draft: draft, option: option), 'matched');
      expect(keys, [keys.first, keys.first]);
      expect(storage.bundle, isNull);
    },
  );
}
