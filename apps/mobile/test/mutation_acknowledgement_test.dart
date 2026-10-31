import 'dart:async';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/canonical_routes/application/canonical_route_controller.dart';
import 'package:masari_mobile/features/canonical_routes/data/canonical_operation_storage.dart';
import 'package:masari_mobile/features/passenger/application/legacy_passenger_request_mutation.dart';

Future<void> acknowledge(
  CanonicalMutationRunner runner,
  CanonicalOperationBundle receipt,
) => runner.acknowledge(
  actorId: receipt.actorId,
  operation: receipt.operation,
  idempotencyKey: receipt.idempotencyKey,
);

Future<CanonicalOperationBundle> create(
  CanonicalMutationRunner runner,
  String route, {
  Future<CanonicalOperationBundle> Function(CanonicalOperationBundle)? send,
}) => runner.run<CanonicalOperationBundle>(
  operation: 'passenger_create',
  scope: 'passenger',
  actorId: 'owner',
  payload: {'route_version_id': route},
  send: send ?? (bundle) async => bundle,
);

void main() {
  test(
    'old validation cleanup cannot acknowledge a newer helper operation',
    () async {
      final storage = MemoryStorage();
      final firstHelper = LegacyPassengerRequestMutation(
        storage: storage,
        currentActor: () => 'owner',
      );
      final otherHelper = LegacyPassengerRequestMutation(
        storage: storage,
        currentActor: () => 'owner',
      );
      final payload = {
        'preferred_time': DateTime.now()
            .add(const Duration(hours: 1))
            .toIso8601String(),
        'passenger_count': 1,
      };
      final firstStarted = Completer<void>();
      final firstResponse = Completer<Map<String, dynamic>>();
      final first = firstHelper.create(
        payload: payload,
        send: (_, _, _) {
          firstStarted.complete();
          return firstResponse.future;
        },
      );
      final firstResult = expectLater(
        first,
        throwsA(
          isA<ApiException>().having(
            (error) => error.statusCode,
            'original validation status',
            400,
          ),
        ),
      );
      await firstStarted.future;
      final secondStarted = Completer<String>();
      final secondResponse = Completer<Map<String, dynamic>>();
      final secondPayload = {...payload, 'passenger_count': 2};
      final second = otherHelper.create(
        payload: secondPayload,
        send: (_, key, _) {
          secondStarted.complete(key);
          return secondResponse.future;
        },
      );
      final secondResult = expectLater(second, throwsA(isA<ApiException>()));
      firstResponse.completeError(
        const ApiException(
          ApiErrorType.validation,
          'invalid_location',
          statusCode: 400,
        ),
      );
      final secondKey = await secondStarted.future;
      expect(storage.bundle?.idempotencyKey, secondKey);
      secondResponse.completeError(
        const ApiException(ApiErrorType.timeout, 'response_lost'),
      );
      await secondResult;
      await firstResult;
      expect(storage.bundle?.idempotencyKey, secondKey);
      final replay = await otherHelper.create(
        payload: secondPayload,
        send: (_, key, _) async {
          expect(key, secondKey);
          return {
            'request': {'id': 'original-second-request'},
          };
        },
      );
      expect(replay.value, 'original-second-request');
      await otherHelper.acknowledge(replay);
      expect(storage.bundle, isNull);
    },
  );

  test(
    'delayed K1 acknowledgement preserves in-flight K2 and its lost-response replay',
    () async {
      final storage = MemoryStorage();
      final runner = CanonicalMutationRunner(storage: storage);
      final first = await create(runner, 'one');
      await acknowledge(runner, first);
      expect(storage.bundle, isNull);
      final started = Completer<CanonicalOperationBundle>();
      final response = Completer<CanonicalOperationBundle>();
      final second = create(
        runner,
        'two',
        send: (bundle) {
          started.complete(bundle);
          return response.future;
        },
      );
      final secondResult = expectLater(second, throwsA(isA<ApiException>()));
      final secondBundle = await started.future;
      final staleAck = acknowledge(
        runner,
        first,
      ).then<Object?>((_) => null, onError: (Object error) => error);
      await Future<void>.delayed(Duration.zero);
      try {
        expect(storage.bundle?.idempotencyKey, secondBundle.idempotencyKey);
      } finally {
        response.completeError(
          const ApiException(ApiErrorType.timeout, 'response_lost'),
        );
        await secondResult;
        await staleAck;
      }
      expect(storage.bundle?.idempotencyKey, secondBundle.idempotencyKey);
      final replay = await create(runner, 'two');
      expect(replay.idempotencyKey, secondBundle.idempotencyKey);
      await acknowledge(runner, replay);
      expect(storage.bundle, isNull);
    },
  );

  test(
    'acknowledgement read and clear serialize against another runner sharing storage',
    () async {
      final storage = MemoryStorage();
      final firstRunner = CanonicalMutationRunner(storage: storage);
      final otherRunner = CanonicalMutationRunner(storage: storage);
      final first = await create(firstRunner, 'one');
      storage.pauseRead = true;
      final firstAck = acknowledge(firstRunner, first);
      await storage.readStarted.future;
      final duplicateAck = acknowledge(otherRunner, first);
      final started = Completer<CanonicalOperationBundle>();
      final response = Completer<CanonicalOperationBundle>();
      final second = duplicateAck.then(
        (_) => create(
          otherRunner,
          'two',
          send: (bundle) {
            started.complete(bundle);
            return response.future;
          },
        ),
      );
      final secondResult = expectLater(second, throwsA(isA<ApiException>()));
      await Future<void>.delayed(Duration.zero);
      final sentBeforeAcknowledgementReleased = started.isCompleted;
      storage.releaseRead.complete();
      await firstAck;
      final secondBundle = await started.future;
      try {
        expect(sentBeforeAcknowledgementReleased, isFalse);
        expect(storage.bundle?.idempotencyKey, secondBundle.idempotencyKey);
      } finally {
        response.completeError(
          const ApiException(ApiErrorType.timeout, 'response_lost'),
        );
        await secondResult;
      }
      expect(storage.bundle?.idempotencyKey, secondBundle.idempotencyKey);
    },
  );
}

class MemoryStorage extends CanonicalOperationStorage {
  MemoryStorage()
    : super(
        const FlutterSecureStorage(),
        storageKey: 'acknowledgement_race_test',
      );
  CanonicalOperationBundle? bundle;
  bool pauseRead = false;
  final readStarted = Completer<void>();
  final releaseRead = Completer<void>();
  @override
  Future<CanonicalOperationBundle?> read() async {
    final snapshot = bundle;
    if (pauseRead) {
      pauseRead = false;
      readStarted.complete();
      await releaseRead.future;
    }
    return snapshot;
  }

  @override
  Future<void> save(CanonicalOperationBundle value) async {
    bundle = value;
  }

  @override
  Future<void> clear() async {
    bundle = null;
  }
}
