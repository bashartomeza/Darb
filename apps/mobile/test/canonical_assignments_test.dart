import 'dart:convert';
import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/auth/application/auth_controller.dart';
import 'package:masari_mobile/features/auth/domain/auth_models.dart';
import 'package:masari_mobile/features/canonical_assignments/application/canonical_assignment_controller.dart';
import 'package:masari_mobile/features/canonical_assignments/data/canonical_assignment_repository.dart';
import 'package:masari_mobile/features/canonical_assignments/domain/canonical_assignment_models.dart';
import 'package:masari_mobile/features/auth/data/authenticated_api_client.dart';
import 'package:masari_mobile/features/canonical_routes/application/canonical_route_controller.dart';
import 'package:masari_mobile/features/canonical_routes/data/canonical_route_repository.dart';
import 'package:masari_mobile/features/canonical_routes/data/canonical_operation_storage.dart';
import 'package:masari_mobile/features/canonical_routes/domain/canonical_route_models.dart';

import 'support/auth_test_support.dart';

void main() {
  group('M7C3B canonical assignment contracts', () {
    test('driver inbox uses opaque cursor and parses safe summaries', () async {
      Uri? observed;
      final repository = CanonicalAssignmentRepository(
        apiClient: _client((request) async {
          observed = request.url;
          return _jsonResponse({
            'offers': [offerJson()],
            'next_cursor': 'opaque_cursor',
            'server_now': '2026-07-27T10:00:00.000Z',
          });
        }),
      );

      final page = await repository.driverOffers(
        cursor: 'previous_cursor',
        limit: 10,
      );
      expect(observed?.queryParameters, {
        'limit': '10',
        'cursor': 'previous_cursor',
      });
      expect(page.nextCursor, 'opaque_cursor');
      expect(page.offers.single.status, CanonicalOfferStatus.offered);
      expect(page.offers.single.route.stops.map((stop) => stop.id), [
        'stop_1',
        'stop_2',
      ]);
      expect(page.offers.single.demand.passengerCount, 2);
      expect(
        jsonEncode(page.offers.single.route.nameEn),
        isNot(contains('phone')),
      );
    });

    test(
      'accept and categorical reject forward exact idempotency keys',
      () async {
        final observed = <http.Request>[];
        final repository = CanonicalAssignmentRepository(
          apiClient: _client((request) async {
            observed.add(request);
            final rejected = request.url.path.endsWith('/reject');
            return _jsonResponse({
              'offer': offerJson(
                status: rejected ? 'rejected' : 'accepted',
                rejectReason: rejected ? 'schedule_conflict' : null,
              ),
              'server_now': '2026-07-27T10:00:00.000Z',
            });
          }),
        );

        expect(
          (await repository.acceptOffer(
            id: 'offer_1',
            idempotencyKey: 'accept-key',
          )).status,
          CanonicalOfferStatus.accepted,
        );
        expect(
          (await repository.rejectOffer(
            id: 'offer_1',
            reason: CanonicalRejectReason.scheduleConflict,
            idempotencyKey: 'reject-key',
          )).status,
          CanonicalOfferStatus.rejected,
        );
        expect(observed[0].headers['idempotency-key'], 'accept-key');
        expect(observed[1].headers['idempotency-key'], 'reject-key');
        expect(jsonDecode(observed[1].body), {'reason': 'schedule_conflict'});
      },
    );

    test(
      'passenger and merchant status expose trip only after assignment',
      () async {
        final repository = CanonicalAssignmentRepository(
          apiClient: _client((request) async {
            final merchant = request.url.path.contains('/merchant/');
            final detail =
                request.url.path.endsWith('request_1') ||
                request.url.path.endsWith('order_1');
            final value = assignmentJson(
              id: merchant ? 'order_1' : 'request_1',
              merchant: merchant,
            );
            return _jsonResponse({
              if (detail)
                merchant ? 'order' : 'request': value
              else
                merchant ? 'orders' : 'requests': [value],
              'server_now': '2026-07-27T10:00:00.000Z',
            });
          }),
        );

        final passenger = await repository.passengerAssignment('request_1');
        final merchant = await repository.merchantAssignment('order_1');
        expect(passenger.assignment.status, CanonicalAssignmentStatus.assigned);
        expect(
          passenger.assignment.trip?.vehicleType,
          CanonicalVehicleType.sedan,
        );
        expect(merchant.assignment.parcelCount, 2);
        expect(merchant.assignment.destinationStopIds, ['stop_2']);
      },
    );

    test('unknown offer and assignment enums fail closed', () {
      expect(
        () => CanonicalDriverOffer.fromJson(offerJson(status: 'maybe')),
        throwsFormatException,
      );
      final invalid = assignmentJson()..['dispatch_status'] = 'searching';
      expect(
        () => CanonicalAssignment.fromJson(invalid),
        throwsFormatException,
      );
    });

    test('single offers require the exact single-demand version', () {
      final shared = offerJson()
        ..['offer_version'] = 'canonical_shared_trip_match_v1';
      final unknown = offerJson()..['offer_version'] = 'future_match_v2';
      final missing = offerJson()..remove('offer_version');

      expect(
        () => CanonicalDriverOffer.fromJson(shared),
        throwsFormatException,
      );
      expect(
        () => CanonicalDriverOffer.fromJson(unknown),
        throwsFormatException,
      );
      expect(
        () => CanonicalDriverOffer.fromJson(missing),
        throwsFormatException,
      );
    });
  });

  group('M7C3B offer response-loss recovery', () {
    test(
      'bundle is saved before send and cleared only after reconciliation',
      () async {
        final storage = _MemoryCanonicalStorage();
        final runner = CanonicalMutationRunner(storage: storage);
        var persistedBeforeSend = false;

        final receipt = await runner.runWithReceipt<void>(
          operation: 'driver_canonical_offer_accept',
          scope: 'driver',
          actorId: 'driver_1',
          payload: const {
            'route_version_id': 'version_1',
            'offer_id': 'offer_1',
          },
          send: (_) async {
            persistedBeforeSend = storage.bundle != null;
          },
        );
        expect(persistedBeforeSend, isTrue);
        expect(storage.bundle, isNotNull);
        await runner.acknowledge(
          actorId: 'driver_1',
          operation: 'driver_canonical_offer_accept',
          idempotencyKey: receipt.bundle.idempotencyKey,
        );
        expect(storage.bundle, isNull);
      },
    );

    test(
      'accept response loss reuses exact key and blocks another operation',
      () async {
        final storage = _MemoryCanonicalStorage();
        final runner = CanonicalMutationRunner(storage: storage);
        const payload = {
          'route_version_id': 'version_1',
          'offer_id': 'offer_1',
        };
        await expectLater(
          runner.run<void>(
            operation: 'driver_canonical_offer_accept',
            scope: 'driver',
            actorId: 'driver_1',
            payload: payload,
            send: (_) async => throw const ApiException(
              ApiErrorType.network,
              'network_unavailable',
            ),
          ),
          throwsA(isA<ApiException>()),
        );
        final key = storage.bundle!.idempotencyKey;
        String? replayedKey;
        await runner.run<void>(
          operation: 'driver_canonical_offer_accept',
          scope: 'driver',
          actorId: 'driver_1',
          payload: payload,
          send: (bundle) async => replayedKey = bundle.idempotencyKey,
        );
        expect(replayedKey, key);
        await expectLater(
          runner.run<void>(
            operation: 'driver_canonical_offer_reject',
            scope: 'driver',
            actorId: 'driver_1',
            payload: const {...payload, 'reason': 'driver_declined'},
            send: (_) async {},
          ),
          throwsA(isA<CanonicalOperationBlocked>()),
        );
      },
    );

    test(
      'changed reject reason and another actor cannot replay a bundle',
      () async {
        final storage = _MemoryCanonicalStorage()
          ..bundle = CanonicalOperationBundle.create(
            operation: 'driver_canonical_offer_reject',
            scope: 'driver',
            actorId: 'driver_1',
            payload: const {
              'route_version_id': 'version_1',
              'offer_id': 'offer_1',
              'reason': 'schedule_conflict',
            },
          );
        final runner = CanonicalMutationRunner(storage: storage);
        var sends = 0;
        for (final actor in ['driver_1', 'driver_2']) {
          await expectLater(
            runner.run<void>(
              operation: 'driver_canonical_offer_reject',
              scope: 'driver',
              actorId: actor,
              payload: const {
                'route_version_id': 'version_1',
                'offer_id': 'offer_1',
                'reason': 'capacity_unavailable',
              },
              send: (_) async => sends++,
            ),
            throwsA(isA<CanonicalOperationBlocked>()),
          );
        }
        expect(sends, 0);
        expect(storage.bundle, isNotNull);
      },
    );

    test('secure-save failure sends no request', () async {
      final storage = _MemoryCanonicalStorage(saveError: StateError('secure'));
      final runner = CanonicalMutationRunner(storage: storage);
      var sends = 0;
      await expectLater(
        runner.run<void>(
          operation: 'driver_canonical_offer_accept',
          scope: 'driver',
          actorId: 'driver_1',
          payload: const {
            'route_version_id': 'version_1',
            'offer_id': 'offer_1',
          },
          send: (_) async => sends++,
        ),
        throwsStateError,
      );
      expect(sends, 0);
    });

    test('terminal mutation fences an older offered detail response', () async {
      final stale = Completer<CanonicalOfferEnvelope>();
      final repository = _FakeAssignmentRepository(
        detailResponses: [
          Future.value(_offerEnvelope()),
          stale.future,
          Future.value(_offerEnvelope()),
          Future.value(_offerEnvelope(status: 'accepted')),
        ],
      );
      final container = _offerContainer(repository: repository);
      addTearDown(container.dispose);
      await container.read(authControllerProvider.future);
      final provider = driverCanonicalOfferDetailProvider('offer_1');
      await container.read(provider.future);

      final refresh = container.read(provider.notifier).refresh();
      await Future<void>.delayed(Duration.zero);
      await container.read(provider.notifier).accept();
      stale.complete(_offerEnvelope());
      await refresh;

      expect(
        container.read(provider).value?.offer.status,
        CanonicalOfferStatus.accepted,
      );
      expect(container.read(provider).value?.offer.actionable, isFalse);
    });

    test(
      'fresh disabled capability prevents persistence and network send',
      () async {
        final capabilities = _FakeCanonicalRouteRepository();
        final repository = _FakeAssignmentRepository(
          detailResponses: [Future.value(_offerEnvelope())],
        );
        final storage = _MemoryCanonicalStorage();
        final container = _offerContainer(
          repository: repository,
          capabilities: capabilities,
          storage: storage,
        );
        addTearDown(container.dispose);
        await container.read(authControllerProvider.future);
        final provider = driverCanonicalOfferDetailProvider('offer_1');
        await container.read(provider.future);
        capabilities.enabled = false;

        await expectLater(
          container.read(provider.notifier).accept(),
          throwsStateError,
        );

        expect(repository.acceptCalls, 0);
        expect(storage.bundle, isNull);
      },
    );

    test('fresh terminal offer replaces cached actionable detail', () async {
      final repository = _FakeAssignmentRepository(
        detailResponses: [
          Future.value(_offerEnvelope()),
          Future.value(_offerEnvelope(status: 'accepted')),
        ],
      );
      final storage = _MemoryCanonicalStorage();
      final container = _offerContainer(
        repository: repository,
        storage: storage,
      );
      addTearDown(container.dispose);
      await container.read(authControllerProvider.future);
      final provider = driverCanonicalOfferDetailProvider('offer_1');
      await container.read(provider.future);

      await expectLater(
        container.read(provider.notifier).accept(),
        throwsStateError,
      );

      expect(repository.acceptCalls, 0);
      expect(storage.bundle, isNull);
      expect(
        container.read(provider).value?.offer.status,
        CanonicalOfferStatus.accepted,
      );
      expect(container.read(provider).value?.offer.actionable, isFalse);
    });

    test(
      'disabled capability preserves an exact unresolved recovery bundle',
      () async {
        final capabilities = _FakeCanonicalRouteRepository();
        final storage = _MemoryCanonicalStorage()
          ..bundle = CanonicalOperationBundle.create(
            operation: 'driver_canonical_offer_accept',
            scope: 'driver',
            actorId: 'driver_1',
            payload: const {
              'route_version_id': 'version_1',
              'offer_id': 'offer_1',
            },
          );
        final repository = _FakeAssignmentRepository(
          detailResponses: [Future.value(_offerEnvelope())],
        );
        final container = _offerContainer(
          repository: repository,
          capabilities: capabilities,
          storage: storage,
        );
        addTearDown(container.dispose);
        await container.read(authControllerProvider.future);
        final provider = driverCanonicalOfferDetailProvider('offer_1');
        await container.read(provider.future);
        final originalKey = storage.bundle!.idempotencyKey;
        capabilities.enabled = false;

        await expectLater(
          container.read(provider.notifier).recover(),
          throwsStateError,
        );

        expect(repository.acceptCalls, 0);
        expect(storage.bundle?.idempotencyKey, originalKey);
      },
    );
  });
}

ProviderContainer _offerContainer({
  required _FakeAssignmentRepository repository,
  _FakeCanonicalRouteRepository? capabilities,
  _MemoryCanonicalStorage? storage,
}) {
  return ProviderContainer(
    overrides: [
      authControllerProvider.overrideWith(_AuthenticatedDriverController.new),
      canonicalAssignmentRepositoryProvider.overrideWithValue(repository),
      canonicalRouteRepositoryProvider.overrideWithValue(
        capabilities ?? _FakeCanonicalRouteRepository(),
      ),
      canonicalOperationStorageProvider.overrideWithValue(
        storage ?? _MemoryCanonicalStorage(),
      ),
    ],
  );
}

CanonicalOfferEnvelope _offerEnvelope({String status = 'offered'}) {
  return CanonicalOfferEnvelope(
    offer: CanonicalDriverOffer.fromJson(offerJson(status: status)),
    serverNow: DateTime.parse('2026-07-27T10:00:00.000Z'),
  );
}

Map<String, dynamic> offerJson({
  String status = 'offered',
  String? rejectReason,
}) => {
  'id': 'offer_1',
  'offer_version': canonicalRouteMatchVersion,
  'status': status,
  'demand_type': 'passenger',
  'route_version_id': 'version_1',
  'attempt_number': 1,
  'offered_at': '2026-07-27T09:55:00.000Z',
  'expires_at': '2026-07-27T10:05:00.000Z',
  'accepted_at': status == 'accepted' ? '2026-07-27T10:00:00.000Z' : null,
  'rejected_at': status == 'rejected' ? '2026-07-27T10:00:00.000Z' : null,
  'expired_at': null,
  'reject_reason': rejectReason,
  'created_at': '2026-07-27T09:55:00.000Z',
  'departure_at': '2026-07-27T11:00:00.000Z',
  'route': routeSummaryJson(),
  'demand': {
    'passenger_count': 2,
    'pickup_stop_id': 'stop_1',
    'dropoff_stop_id': 'stop_2',
    'requested_departure_from': '2026-07-27T10:30:00.000Z',
    'requested_departure_until': '2026-07-27T11:30:00.000Z',
  },
  'trip': status == 'accepted' ? tripJson() : null,
};

Map<String, dynamic> assignmentJson({
  String id = 'request_1',
  bool merchant = false,
  bool shared = false,
}) => {
  'id': id,
  'status': 'matched',
  'route_version_id': 'version_1',
  'route': routeSummaryJson(),
  'pickup_stop_id': 'stop_1',
  'dropoff_stop_id': merchant ? null : 'stop_2',
  'requested_departure_from': '2026-07-27T10:30:00.000Z',
  'requested_departure_until': '2026-07-27T11:30:00.000Z',
  'dispatch_status': 'assigned',
  'offer_pending': false,
  'assigned': true,
  'assignment_trip_version': shared
      ? 'canonical_shared_trip_v1'
      : 'canonical_route_trip_v1',
  'passenger_count': merchant ? null : 2,
  'trip': tripJson(shared: shared),
  'created_at': '2026-07-27T09:50:00.000Z',
  'updated_at': '2026-07-27T10:00:00.000Z',
  if (merchant) ...{
    'parcel_count': 2,
    'destination_stop_ids': ['stop_2'],
    'parcels': [
      {'id': 'parcel_1', 'status': 'assigned', 'destination_stop_id': 'stop_2'},
      {'id': 'parcel_2', 'status': 'assigned', 'destination_stop_id': 'stop_2'},
    ],
  },
};

Map<String, dynamic> routeSummaryJson() => {
  'id': 'version_1',
  'name_ar': 'الخليل إلى بيت لحم',
  'name_en': 'Hebron to Bethlehem',
  'direction': 'outbound',
  'stops': [
    {'id': 'stop_1', 'name_ar': 'الخليل', 'name_en': 'Hebron', 'sequence': 1},
    {
      'id': 'stop_2',
      'name_ar': 'بيت لحم',
      'name_en': 'Bethlehem',
      'sequence': 2,
    },
  ],
};

Map<String, dynamic> tripJson({bool shared = false}) => {
  'id': 'trip_1',
  'trip_version': shared
      ? 'canonical_shared_trip_v1'
      : 'canonical_route_trip_v1',
  'shared_trip': shared,
  'status': 'accepted',
  'route_version_id': 'version_1',
  'departure_at': '2026-07-27T11:00:00.000Z',
  'vehicle_type': 'sedan',
  'created_at': '2026-07-27T10:00:00.000Z',
};

AuthenticatedApiClient _client(
  Future<http.Response> Function(http.Request request) handler,
) => TestAuthenticatedClient(handler: handler).client;

http.Response _jsonResponse(Map<String, dynamic> body) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  200,
  headers: const {'content-type': 'application/json; charset=utf-8'},
);

class _MemoryCanonicalStorage implements CanonicalOperationStorage {
  @override
  String get namespace => CanonicalOperationStorage.bundleKey;
  _MemoryCanonicalStorage({this.saveError});

  CanonicalOperationBundle? bundle;
  final Object? saveError;

  @override
  Future<void> clear() async => bundle = null;

  @override
  Future<CanonicalOperationBundle?> read() async => bundle;

  @override
  Future<void> save(CanonicalOperationBundle value) async {
    if (saveError case final error?) throw error;
    bundle = value;
  }
}

class _AuthenticatedDriverController extends AuthController {
  @override
  Future<AuthState> build() async => const AuthState.authenticated(
    AuthUser(
      id: 'driver_1',
      name: 'Driver',
      phone: '+970590000002',
      role: UserRole.driver,
      demoAccount: true,
    ),
  );
}

class _FakeCanonicalRouteRepository extends CanonicalRouteRepository {
  _FakeCanonicalRouteRepository()
    : super(
        apiClient: TestAuthenticatedClient(
          handler: (_) async => http.Response('{"error":"unused"}', 500),
        ).client,
      );

  bool enabled = true;

  @override
  Future<MobileCapabilities> capabilities() async => MobileCapabilities(
    routeCatalogAvailable: enabled,
    multiRouteEntryAvailable: enabled,
    matchingAvailable: enabled,
    canonicalTripCreationAvailable: enabled,
    driverCanonicalOffersAvailable: enabled,
    canonicalAssignmentStatusAvailable: enabled,
    mapsAvailable: false,
    liveTrackingAvailable: false,
  );
}

class _FakeAssignmentRepository extends CanonicalAssignmentRepository {
  _FakeAssignmentRepository({required this.detailResponses})
    : super(
        apiClient: TestAuthenticatedClient(
          handler: (_) async => http.Response('{"error":"unused"}', 500),
        ).client,
      );

  final List<Future<CanonicalOfferEnvelope>> detailResponses;
  var detailIndex = 0;
  var acceptCalls = 0;

  @override
  Future<CanonicalOfferEnvelope> driverOffer(String id) {
    return detailResponses[detailIndex++];
  }

  @override
  Future<CanonicalDriverOffer> acceptOffer({
    required String id,
    required String idempotencyKey,
  }) async {
    acceptCalls += 1;
    return CanonicalDriverOffer.fromJson(offerJson(status: 'accepted'));
  }
}
