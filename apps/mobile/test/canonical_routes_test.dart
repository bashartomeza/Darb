import 'dart:async';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/canonical_routes/application/canonical_route_controller.dart';
import 'package:masari_mobile/features/canonical_routes/data/canonical_operation_storage.dart';
import 'package:masari_mobile/features/canonical_routes/domain/canonical_route_models.dart';

void main() {
  group('M7C2 typed capability and route contracts', () {
    test('accepts the exact safe capability response', () {
      final value = MobileCapabilities.fromJson({
        'canonical_route_catalog_available': true,
        'canonical_multi_route_entry_available': true,
        'canonical_matching_available': false,
        'canonical_trip_creation_available': false,
        'driver_canonical_offers_available': false,
        'canonical_assignment_status_available': true,
        'maps_available': false,
        'live_tracking_available': false,
      });
      expect(value.routeCatalogAvailable, isTrue);
      expect(value.multiRouteEntryAvailable, isTrue);
      expect(value.matchingAvailable, isFalse);
      expect(value.mapsAvailable, isFalse);
      expect(value.liveTrackingAvailable, isFalse);
    });

    test('rejects unknown capability fields and non-boolean values', () {
      expect(
        () => MobileCapabilities.fromJson({
          'canonical_route_catalog_available': true,
          'canonical_multi_route_entry_available': true,
          'canonical_matching_available': false,
          'canonical_trip_creation_available': false,
          'driver_canonical_offers_available': false,
          'canonical_assignment_status_available': true,
          'maps_available': false,
          'live_tracking_available': false,
          'environment': 'local',
        }),
        throwsFormatException,
      );
      expect(
        () => MobileCapabilities.fromJson({
          'canonical_route_catalog_available': 'true',
          'canonical_multi_route_entry_available': true,
          'canonical_matching_available': false,
          'canonical_trip_creation_available': false,
          'driver_canonical_offers_available': false,
          'canonical_assignment_status_available': true,
          'maps_available': false,
          'live_tracking_available': false,
        }),
        throwsFormatException,
      );
    });

    test('reads coordinates when the catalog supplies them', () {
      final parsed = CanonicalStop.fromMembership({
        ...membership(1, pickup: true),
        'stop': {...stop('one'), 'latitude': 31.5326, 'longitude': 35.0998},
      });
      expect(parsed.position, const GeoPoint(31.5326, 35.0998));
    });

    test(
      'leaves a stop unplaced when maps are off or a coordinate is absent',
      () {
        // Maps disabled: the serializer omits both keys entirely.
        expect(
          CanonicalStop.fromMembership({
            ...membership(1, pickup: true),
            'stop': stop('one'),
          }).position,
          isNull,
        );
        // A half-reported position is not a position.
        expect(
          CanonicalStop.fromMembership({
            ...membership(1, pickup: true),
            'stop': {...stop('one'), 'latitude': 31.5326},
          }).position,
          isNull,
        );
        // Out of range is dropped rather than clamped onto the map.
        expect(
          CanonicalStop.fromMembership({
            ...membership(1, pickup: true),
            'stop': {...stop('one'), 'latitude': 931.5, 'longitude': 35.0998},
          }).position,
          isNull,
        );
      },
    );

    test('parses every approved route direction and rejects another enum', () {
      for (final direction in ['outbound', 'inbound', 'loop']) {
        expect(route(direction: direction).direction.name, direction);
      }
      expect(() => route(direction: 'sideways'), throwsFormatException);
    });

    test('rejects unknown lifecycle values and duplicate stop ordering', () {
      final unknownRoute = routeJson()..['status'] = 'paused';
      expect(
        () => CanonicalRoute.fromJson(unknownRoute),
        throwsFormatException,
      );

      final unknownVersion = routeJson();
      (unknownVersion['current_version'] as Map<String, dynamic>)['status'] =
          'archived';
      expect(
        () => CanonicalRoute.fromJson(unknownVersion),
        throwsFormatException,
      );

      final duplicateSequence = routeJson();
      final version =
          duplicateSequence['current_version'] as Map<String, dynamic>;
      final stops = version['stops'] as List<Map<String, dynamic>>;
      stops[1]['sequence'] = 1;
      expect(
        () => CanonicalRoute.fromJson(duplicateSequence),
        throwsFormatException,
      );
    });
  });

  group('M7C2 ordered stop eligibility', () {
    final value = route();

    test('passenger pickup uses server permission', () {
      expect(passengerPickupStops(value).map((item) => item.id), [
        'one',
        'three',
      ]);
    });

    test('passenger destination is downstream and permission filtered', () {
      expect(
        downstreamPassengerStops(
          value,
          value.stops.first,
        ).map((item) => item.id),
        ['three'],
      );
      expect(downstreamPassengerStops(value, value.stops.last), isEmpty);
    });

    test('parcel pickup and destination use independent permissions', () {
      expect(parcelPickupStops(value).map((item) => item.id), ['one', 'two']);
      expect(
        downstreamParcelStops(value, value.stops.first).map((item) => item.id),
        ['two', 'three'],
      );
      expect(
        downstreamParcelStops(value, value.stops[1]).map((item) => item.id),
        ['three'],
      );
    });
  });

  group('M7C2 secure idempotent mutation recovery', () {
    test('success remains recoverable until explicitly acknowledged', () async {
      final storage = FakeCanonicalStorage();
      final runner = CanonicalMutationRunner(storage: storage);
      final result = await runner.run(
        operation: 'passenger_route_request_create',
        scope: 'passenger',
        actorId: 'passenger-1',
        payload: payload('one'),
        send: (bundle) async => bundle.idempotencyKey,
      );
      expect(result, isNotEmpty);
      expect(storage.bundle, isNotNull);
      expect(storage.saveCount, 1);
      expect(storage.clearCount, 0);
      await runner.acknowledge(
        actorId: 'passenger-1',
        operation: 'passenger_route_request_create',
        idempotencyKey: result,
      );
      expect(storage.bundle, isNull);
      expect(storage.clearCount, 1);
    });

    test('timeout retains the exact key and payload for replay', () async {
      final storage = FakeCanonicalStorage();
      final runner = CanonicalMutationRunner(storage: storage);
      await expectLater(
        runner.run<void>(
          operation: 'merchant_route_order_create',
          scope: 'merchant',
          actorId: 'merchant-1',
          payload: payload('one'),
          send: (_) async =>
              throw const ApiException(ApiErrorType.timeout, 'request_timeout'),
        ),
        throwsA(isA<ApiException>()),
      );
      final retained = storage.bundle!;
      String? replayKey;
      await runner.run(
        operation: 'merchant_route_order_create',
        scope: 'merchant',
        actorId: 'merchant-1',
        payload: payload('one'),
        send: (bundle) async {
          replayKey = bundle.idempotencyKey;
          return true;
        },
      );
      expect(replayKey, retained.idempotencyKey);
      expect(storage.bundle, isNotNull);
    });

    test(
      '502, 503, and retryable transaction conflicts retain bundle',
      () async {
        for (final error in [
          const ApiException(
            ApiErrorType.server,
            'request_failed',
            statusCode: 502,
          ),
          const ApiException(
            ApiErrorType.server,
            'request_failed',
            statusCode: 503,
          ),
          const ApiException(
            ApiErrorType.server,
            'transaction_retry_required',
            statusCode: 409,
          ),
        ]) {
          final storage = FakeCanonicalStorage();
          final runner = CanonicalMutationRunner(storage: storage);
          await expectLater(
            runner.run<void>(
              operation: 'driver_availability_create',
              scope: 'driver',
              actorId: 'driver-1',
              payload: payload('one'),
              send: (_) async => throw error,
            ),
            throwsA(isA<ApiException>()),
          );
          expect(storage.bundle, isNotNull);
        }
      },
    );

    test('terminal validation failure clears the bundle', () async {
      final storage = FakeCanonicalStorage();
      final runner = CanonicalMutationRunner(storage: storage);
      await expectLater(
        runner.run<void>(
          operation: 'passenger_route_request_create',
          scope: 'passenger',
          actorId: 'passenger-1',
          payload: payload('one'),
          send: (_) async => throw const ApiException(
            ApiErrorType.validation,
            'invalid_stop_order',
            statusCode: 400,
          ),
        ),
        throwsA(isA<ApiException>()),
      );
      expect(storage.bundle, isNull);
    });

    test(
      'server and invalid-response failures retain a new mutation bundle',
      () async {
        for (final error in [
          const ApiException(
            ApiErrorType.server,
            'request_failed',
            statusCode: 500,
          ),
          const ApiException(ApiErrorType.validation, 'invalid_response'),
        ]) {
          final storage = FakeCanonicalStorage();
          final runner = CanonicalMutationRunner(storage: storage);
          await expectLater(
            runner.run<void>(
              operation: 'driver_canonical_offer_accept',
              scope: 'driver',
              actorId: 'driver-1',
              payload: payload('one'),
              send: (_) async => throw error,
            ),
            throwsA(isA<ApiException>()),
          );
          expect(storage.bundle, isNotNull);
          expect(storage.clearCount, 0);
        }
      },
    );

    test(
      'authorization denial during exact replay preserves unresolved work',
      () async {
        final storage = FakeCanonicalStorage();
        final runner = CanonicalMutationRunner(storage: storage);
        await expectLater(
          runner.run<void>(
            operation: 'driver_canonical_offer_accept',
            scope: 'driver',
            actorId: 'driver-1',
            payload: payload('one'),
            send: (_) async => throw const ApiException(
              ApiErrorType.network,
              'network_unavailable',
            ),
          ),
          throwsA(isA<ApiException>()),
        );
        final retained = storage.bundle;

        await expectLater(
          runner.run<void>(
            operation: 'driver_canonical_offer_accept',
            scope: 'driver',
            actorId: 'driver-1',
            payload: payload('one'),
            send: (_) async => throw const ApiException(
              ApiErrorType.forbidden,
              'account_unavailable',
              statusCode: 403,
            ),
          ),
          throwsA(isA<ApiException>()),
        );

        expect(storage.bundle?.idempotencyKey, retained?.idempotencyKey);
        expect(storage.clearCount, 0);
      },
    );

    test('changed payload cannot replace an unresolved operation', () async {
      final storage = FakeCanonicalStorage();
      final runner = CanonicalMutationRunner(storage: storage);
      await expectLater(
        runner.run<void>(
          operation: 'passenger_route_request_create',
          scope: 'passenger',
          actorId: 'passenger-1',
          payload: payload('one'),
          send: (_) async => throw const ApiException(
            ApiErrorType.network,
            'network_unavailable',
          ),
        ),
        throwsA(isA<ApiException>()),
      );
      final retained = storage.bundle!;
      var sends = 0;
      await expectLater(
        runner.run<void>(
          operation: 'passenger_route_request_create',
          scope: 'passenger',
          actorId: 'passenger-1',
          payload: payload('two'),
          send: (_) async => sends++,
        ),
        throwsA(
          isA<CanonicalOperationBlocked>().having(
            (error) => error.code,
            'code',
            'canonical_recovery_unresolved',
          ),
        ),
      );
      expect(storage.bundle!.idempotencyKey, retained.idempotencyKey);
      expect(storage.bundle!.payload, retained.payload);
      expect(sends, 0);
    });

    test('rapid second submission is synchronously rejected', () async {
      final storage = FakeCanonicalStorage();
      final runner = CanonicalMutationRunner(storage: storage);
      final completer = Completer<void>();
      final first = runner.run<void>(
        operation: 'passenger_route_request_create',
        scope: 'passenger',
        actorId: 'passenger-1',
        payload: payload('one'),
        send: (_) => completer.future,
      );
      await Future<void>.delayed(Duration.zero);
      await expectLater(
        runner.run<void>(
          operation: 'passenger_route_request_create',
          scope: 'passenger',
          actorId: 'passenger-1',
          payload: payload('one'),
          send: (_) async {},
        ),
        throwsStateError,
      );
      completer.complete();
      await first;
    });

    test(
      'another account or operation cannot consume the pending slot',
      () async {
        final storage = FakeCanonicalStorage();
        storage.bundle = CanonicalOperationBundle.create(
          operation: 'passenger_route_request_create',
          scope: 'passenger',
          actorId: 'passenger-1',
          payload: payload('one'),
        );
        final runner = CanonicalMutationRunner(storage: storage);
        var sends = 0;
        await expectLater(
          runner.run<void>(
            operation: 'passenger_route_request_create',
            scope: 'passenger',
            actorId: 'passenger-2',
            payload: payload('one'),
            send: (_) async => sends++,
          ),
          throwsA(
            isA<CanonicalOperationBlocked>().having(
              (error) => error.code,
              'code',
              'canonical_recovery_other_account',
            ),
          ),
        );
        await expectLater(
          runner.run<void>(
            operation: 'merchant_route_order_create',
            scope: 'merchant',
            actorId: 'passenger-1',
            payload: payload('one'),
            send: (_) async => sends++,
          ),
          throwsA(isA<CanonicalOperationBlocked>()),
        );
        expect(sends, 0);
        expect(storage.clearCount, 0);
      },
    );

    test('expired or clock-anomalous bundle remains quarantined', () async {
      final created = DateTime.utc(2026, 1, 1, 12);
      for (final current in [
        created.add(const Duration(hours: 24)),
        created.subtract(const Duration(minutes: 6)),
      ]) {
        final storage = FakeCanonicalStorage();
        storage.bundle = CanonicalOperationBundle.create(
          operation: 'passenger_route_request_create',
          scope: 'passenger',
          actorId: 'passenger-1',
          payload: payload('one'),
          now: created,
        );
        final runner = CanonicalMutationRunner(
          storage: storage,
          now: () => current,
        );
        await expectLater(
          runner.run<void>(
            operation: 'passenger_route_request_create',
            scope: 'passenger',
            actorId: 'passenger-1',
            payload: payload('one'),
            send: (_) async {},
          ),
          throwsA(
            isA<CanonicalOperationBlocked>().having(
              (error) => error.code,
              'code',
              'canonical_recovery_expired',
            ),
          ),
        );
        expect(storage.bundle, isNotNull);
        expect(storage.clearCount, 0);
      }
    });

    test('ambiguous idempotency responses preserve the exact bundle', () async {
      for (final code in [
        'idempotency_in_progress',
        'idempotency_replay_unavailable',
        'idempotency_conflict',
      ]) {
        final storage = FakeCanonicalStorage();
        final runner = CanonicalMutationRunner(storage: storage);
        await expectLater(
          runner.run<void>(
            operation: 'passenger_route_request_create',
            scope: 'passenger',
            actorId: 'passenger-1',
            payload: payload('one'),
            send: (_) async =>
                throw ApiException(ApiErrorType.unknown, code, statusCode: 409),
          ),
          throwsA(isA<ApiException>()),
        );
        expect(storage.bundle, isNotNull);
        expect(storage.clearCount, 0);
      }
    });

    test('preflight and secure persistence complete before send', () async {
      final events = <String>[];
      final storage = FakeCanonicalStorage(onSave: () => events.add('save'));
      final runner = CanonicalMutationRunner(storage: storage);
      await runner.run<void>(
        operation: 'passenger_route_request_create',
        scope: 'passenger',
        actorId: 'passenger-1',
        payload: payload('one'),
        preflight: () async => events.add('preflight'),
        send: (_) async => events.add('send'),
      );
      expect(events, ['preflight', 'save', 'send']);
    });

    test('bundle JSON rejects a changed fingerprint', () {
      final bundle = CanonicalOperationBundle.create(
        operation: 'passenger_route_request_create',
        scope: 'passenger',
        actorId: 'passenger-1',
        payload: payload('one'),
      );
      final json = bundle.toJson()..['fingerprint'] = 'tampered';
      expect(
        () => CanonicalOperationBundle.fromJson(json),
        throwsFormatException,
      );
    });

    test('bundle JSON rejects a route-version mismatch', () {
      final bundle = CanonicalOperationBundle.create(
        operation: 'passenger_route_request_create',
        scope: 'passenger',
        actorId: 'passenger-1',
        payload: payload('one'),
      );
      final json = bundle.toJson()..['route_version_id'] = 'two';
      expect(
        () => CanonicalOperationBundle.fromJson(json),
        throwsFormatException,
      );
    });

    test('secure save failure prevents the network send', () async {
      var sends = 0;
      final runner = CanonicalMutationRunner(
        storage: FailingSaveCanonicalStorage(),
      );
      await expectLater(
        runner.run<void>(
          operation: 'passenger_route_request_create',
          scope: 'passenger',
          actorId: 'passenger-1',
          payload: payload('one'),
          send: (_) async => sends++,
        ),
        throwsA(isA<StateError>()),
      );
      expect(sends, 0);
    });

    test(
      'driver result reconciliation accepts database millisecond precision',
      () {
        final bundle = CanonicalOperationBundle.create(
          operation: 'driver_availability_create',
          scope: 'driver',
          actorId: 'driver-1',
          payload: {
            'route_version_id': 'route-version-1',
            'departure_at': '2026-07-25T20:01:02.123456Z',
            'availability_window_end': '2026-07-25T20:31:02.987654Z',
            'total_seats': 2,
            'total_parcel_capacity': 3,
          },
        );
        final availability = DriverAvailability(
          id: 'availability-1',
          routeVersionId: 'route-version-1',
          nameAr: 'مسار',
          nameEn: 'Route',
          direction: CanonicalRouteDirection.outbound,
          departureAt: DateTime.parse('2026-07-25T20:01:02.123Z'),
          windowEnd: DateTime.parse('2026-07-25T20:31:02.987Z'),
          totalSeats: 2,
          remainingSeats: 2,
          totalParcelCapacity: 3,
          remainingParcelCapacity: 3,
          status: DriverAvailabilityStatus.draft,
          revision: 1,
        );
        expect(
          canonicalAvailabilityResultMatches(bundle, availability),
          isTrue,
        );
        expect(
          canonicalAvailabilityResultMatches(
            bundle,
            DriverAvailability(
              id: availability.id,
              routeVersionId: availability.routeVersionId,
              nameAr: availability.nameAr,
              nameEn: availability.nameEn,
              direction: availability.direction,
              departureAt: availability.departureAt,
              windowEnd: availability.windowEnd,
              totalSeats: 3,
              remainingSeats: 3,
              totalParcelCapacity: availability.totalParcelCapacity,
              remainingParcelCapacity: availability.remainingParcelCapacity,
              status: availability.status,
              revision: availability.revision,
            ),
          ),
          isFalse,
        );
      },
    );
  });
}

class FakeCanonicalStorage extends CanonicalOperationStorage {
  FakeCanonicalStorage({this.onSave}) : super(const FlutterSecureStorage());

  CanonicalOperationBundle? bundle;
  final void Function()? onSave;
  int saveCount = 0;
  int clearCount = 0;

  @override
  Future<CanonicalOperationBundle?> read() async => bundle;

  @override
  Future<void> save(CanonicalOperationBundle value) async {
    onSave?.call();
    saveCount++;
    bundle = value;
  }

  @override
  Future<void> clear() async {
    clearCount++;
    bundle = null;
  }
}

class FailingSaveCanonicalStorage extends FakeCanonicalStorage {
  @override
  Future<void> save(CanonicalOperationBundle value) async {
    throw StateError('secure_storage_unavailable');
  }
}

Map<String, dynamic> payload(String routeId) => {
  'route_version_id': routeId,
  'pickup_stop_id': 'one',
};

CanonicalRoute route({String direction = 'outbound'}) {
  final json = routeJson(direction: direction);
  return CanonicalRoute.fromJson(json);
}

Map<String, dynamic> routeJson({String direction = 'outbound'}) {
  return {
    'id': 'route',
    'direction': direction,
    'status': 'active',
    'current_version': {
      'id': 'version',
      'version_number': 1,
      'status': 'published',
      'name_ar': 'مسار',
      'name_en': 'Route',
      'active_from': null,
      'active_until': null,
      'stops': [
        membership(1, pickup: true, parcelPickup: true, id: 'one'),
        membership(2, parcelPickup: true, parcelDropoff: true, id: 'two'),
        membership(
          3,
          pickup: true,
          dropoff: true,
          parcelDropoff: true,
          id: 'three',
        ),
      ],
    },
  };
}

Map<String, dynamic> membership(
  int sequence, {
  bool pickup = false,
  bool dropoff = false,
  bool parcelPickup = false,
  bool parcelDropoff = false,
  String id = 'one',
}) => {
  'sequence': sequence,
  'passenger_pickup_allowed': pickup,
  'passenger_dropoff_allowed': dropoff,
  'parcel_pickup_allowed': parcelPickup,
  'parcel_dropoff_allowed': parcelDropoff,
  'stop': stop(id),
};

Map<String, dynamic> stop(String id) => {
  'id': id,
  'name_ar': 'محطة',
  'name_en': 'Stop',
};
