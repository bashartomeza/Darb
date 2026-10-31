import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/auth/application/auth_controller.dart';
import 'package:masari_mobile/features/auth/domain/auth_models.dart';
import 'package:masari_mobile/features/canonical_assignments/domain/canonical_assignment_models.dart';
import 'package:masari_mobile/features/canonical_routes/application/canonical_route_controller.dart';
import 'package:masari_mobile/features/canonical_routes/data/canonical_operation_storage.dart';
import 'package:masari_mobile/features/canonical_routes/data/canonical_route_repository.dart';
import 'package:masari_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:masari_mobile/features/shared_trips/application/shared_trip_controller.dart';
import 'package:masari_mobile/features/shared_trips/data/shared_trip_repository.dart';
import 'package:masari_mobile/features/shared_trips/domain/shared_trip_models.dart';

import 'support/auth_test_support.dart';

void main() {
  group('M7C3C2 shared mobile contracts', () {
    test('shared model parses aggregate data in canonical stop order', () {
      final offer = SharedDriverOffer.fromJson(sharedOfferJson());

      expect(offer.status, SharedOfferStatus.offered);
      expect(offer.composition, SharedTripComposition.mixed);
      expect(offer.passengerRequestCount, 2);
      expect(offer.passengerSeatCount, 3);
      expect(offer.merchantOrderCount, 1);
      expect(offer.parcelUnitCount, 4);
      expect(offer.stopEvents.map((event) => event.sequence), [1, 2]);
      expect(offer.trip, isNull);
    });

    test('passenger-only, merchant-only, and mixed cardinality is strict', () {
      expect(
        SharedDriverOffer.fromJson(
          sharedOfferJson(
            composition: 'passenger_only',
            merchantOrders: 0,
            parcelUnits: 0,
          ),
        ).composition,
        SharedTripComposition.passengerOnly,
      );
      expect(
        SharedDriverOffer.fromJson(
          sharedOfferJson(
            composition: 'merchant_only',
            passengerRequests: 0,
            passengerSeats: 0,
          ),
        ).composition,
        SharedTripComposition.merchantOnly,
      );
      expect(
        () => SharedDriverOffer.fromJson(
          sharedOfferJson(composition: 'passenger_only'),
        ),
        throwsFormatException,
      );
    });

    test('unknown versions, statuses, and unordered events fail closed', () {
      expect(
        () => SharedDriverOffer.fromJson(
          sharedOfferJson()..['offer_version'] = 'future_match_v2',
        ),
        throwsFormatException,
      );
      expect(
        () => SharedDriverOffer.fromJson(
          sharedOfferJson()..['status'] = 'started',
        ),
        throwsFormatException,
      );
      final unordered = sharedOfferJson();
      unordered['stop_events'] = [
        stopEventJson(sequence: 2),
        stopEventJson(sequence: 1),
      ];
      expect(
        () => SharedDriverOffer.fromJson(unordered),
        throwsFormatException,
      );
    });

    test('accepted offers require exactly a shared Trip discriminator', () {
      expect(
        () => SharedDriverOffer.fromJson(sharedOfferJson(status: 'accepted')),
        throwsFormatException,
      );
      final accepted = SharedDriverOffer.fromJson(
        sharedOfferJson(status: 'accepted', withTrip: true),
      );
      expect(accepted.trip?.status, CanonicalTripStatus.accepted);
      final wrongTrip = sharedOfferJson(status: 'accepted', withTrip: true);
      (wrongTrip['trip'] as Map<String, dynamic>)['trip_version'] =
          'canonical_route_trip_v1';
      expect(
        () => SharedDriverOffer.fromJson(wrongTrip),
        throwsFormatException,
      );
      final wrongRoute = sharedOfferJson(status: 'accepted', withTrip: true);
      (wrongRoute['trip'] as Map<String, dynamic>)['route_version_id'] =
          'version_2';
      expect(
        () => SharedDriverOffer.fromJson(wrongRoute),
        throwsFormatException,
      );
    });

    test('aggregate composition and stop totals must reconcile', () {
      expect(
        () => SharedDriverOffer.fromJson(
          sharedOfferJson(
            composition: 'passenger_only',
            passengerSeats: 0,
            merchantOrders: 0,
            parcelUnits: 0,
          ),
        ),
        throwsFormatException,
      );
      expect(
        () => SharedDriverOffer.fromJson(
          sharedOfferJson(
            composition: 'merchant_only',
            passengerRequests: 0,
            passengerSeats: 0,
            parcelUnits: 0,
          ),
        ),
        throwsFormatException,
      );
      final inconsistent = sharedOfferJson();
      (inconsistent['stop_events'] as List<dynamic>)[1]['parcel_destinations'] =
          3;
      expect(
        () => SharedDriverOffer.fromJson(inconsistent),
        throwsFormatException,
      );
      final emptyEvent = sharedOfferJson();
      (emptyEvent['stop_events'] as List<dynamic>).add(
        stopEventJson(sequence: 3),
      );
      expect(
        () => SharedDriverOffer.fromJson(emptyEvent),
        throwsFormatException,
      );
      final wrongStop = sharedOfferJson();
      (wrongStop['stop_events'] as List<dynamic>)[0]['name_en'] = 'Private';
      expect(
        () => SharedDriverOffer.fromJson(wrongStop),
        throwsFormatException,
      );
    });

    test('missing shared capabilities default false and malformed fails', () {
      final missing = MobileCapabilities.fromJson(
        capabilitiesJson(shared: null),
      );
      expect(missing.canonicalSharedTripPresentationAvailable, isFalse);
      expect(missing.canonicalSharedDriverOffersAvailable, isFalse);
      expect(missing.canonicalSharedAssignmentStatusAvailable, isFalse);

      expect(
        () => MobileCapabilities.fromJson(
          capabilitiesJson(shared: true)
            ..['canonical_shared_driver_offers_available'] = 'true',
        ),
        throwsFormatException,
      );
    });

    test('repository keeps shared pagination and mutations isolated', () async {
      final requests = <http.Request>[];
      final repository = SharedTripRepository(
        apiClient: TestAuthenticatedClient(
          handler: (request) async {
            requests.add(request);
            final rejected = request.url.path.endsWith('/reject');
            if (request.method == 'POST') {
              return jsonResponse({
                'offer': sharedOfferJson(
                  status: rejected ? 'rejected' : 'accepted',
                  withTrip: !rejected,
                  rejectReason: rejected ? 'schedule_conflict' : null,
                ),
                'server_now': '2026-08-05T10:00:00.000Z',
              });
            }
            return jsonResponse({
              'offers': [sharedOfferJson()],
              'next_cursor': 'opaque-next',
              'server_now': '2026-08-05T10:00:00.000Z',
            });
          },
        ).client,
      );

      final page = await repository.driverOffers(
        cursor: 'opaque-before',
        limit: 7,
      );
      expect(page.nextCursor, 'opaque-next');
      expect(
        requests.single.url.path,
        '/api/v1/driver/canonical-shared-offers',
      );
      expect(requests.single.url.queryParameters, {
        'limit': '7',
        'cursor': 'opaque-before',
      });
      await repository.acceptOffer(id: 'shared_1', idempotencyKey: 'stable-a');
      await repository.rejectOffer(
        id: 'shared_1',
        reason: CanonicalRejectReason.scheduleConflict,
        idempotencyKey: 'stable-r',
      );
      expect(requests[1].headers['idempotency-key'], 'stable-a');
      expect(requests[2].headers['idempotency-key'], 'stable-r');
      expect(jsonDecode(requests[2].body), {'reason': 'schedule_conflict'});
      expect(
        requests.every(
          (request) => request.url.path.contains('canonical-shared-offers'),
        ),
        isTrue,
      );
    });
  });

  group('M7C3C2 secure shared recovery', () {
    test(
      'write-before-send and delete-after-reconciliation ordering',
      () async {
        final storage = MemoryOperationStorage();
        final runner = CanonicalMutationRunner(storage: storage);
        var savedBeforeSend = false;
        final receipt = await runner.runWithReceipt<void>(
          operation: 'canonical_shared_offer_accept_v1',
          scope: 'driver',
          actorId: 'driver_1',
          payload: sharedAcceptPayload,
          send: (_) async => savedBeforeSend = storage.bundle != null,
        );
        expect(savedBeforeSend, isTrue);
        expect(storage.bundle, isNotNull);
        await runner.acknowledge(
          actorId: 'driver_1',
          operation: 'canonical_shared_offer_accept_v1',
          idempotencyKey: receipt.bundle.idempotencyKey,
        );
        expect(storage.bundle, isNull);
      },
    );

    test('secure-save failure sends no request', () async {
      final storage = MemoryOperationStorage(saveError: StateError('secure'));
      final runner = CanonicalMutationRunner(storage: storage);
      var sends = 0;
      await expectLater(
        runner.run<void>(
          operation: 'canonical_shared_offer_accept_v1',
          scope: 'driver',
          actorId: 'driver_1',
          payload: sharedAcceptPayload,
          send: (_) async => sends++,
        ),
        throwsStateError,
      );
      expect(sends, 0);
    });

    test(
      'response loss replays exact key and blocks all other operations',
      () async {
        final storage = MemoryOperationStorage();
        final runner = CanonicalMutationRunner(storage: storage);
        await expectLater(
          runner.run<void>(
            operation: 'canonical_shared_offer_accept_v1',
            scope: 'driver',
            actorId: 'driver_1',
            payload: sharedAcceptPayload,
            send: (_) async => throw const ApiException(
              ApiErrorType.network,
              'network_unavailable',
            ),
          ),
          throwsA(isA<ApiException>()),
        );
        final original = storage.bundle!.idempotencyKey;
        String? replayed;
        await runner.run<void>(
          operation: 'canonical_shared_offer_accept_v1',
          scope: 'driver',
          actorId: 'driver_1',
          payload: sharedAcceptPayload,
          send: (bundle) async => replayed = bundle.idempotencyKey,
        );
        expect(replayed, original);

        for (final attempt in [
          (
            'canonical_shared_offer_reject_v1',
            'driver_1',
            {...sharedAcceptPayload, 'reason': 'driver_declined'},
          ),
          ('driver_canonical_offer_accept', 'driver_1', sharedAcceptPayload),
          ('canonical_shared_offer_accept_v1', 'driver_2', sharedAcceptPayload),
        ]) {
          await expectLater(
            runner.run<void>(
              operation: attempt.$1,
              scope: 'driver',
              actorId: attempt.$2,
              payload: attempt.$3,
              send: (_) async {},
            ),
            throwsA(isA<CanonicalOperationBlocked>()),
          );
        }
        expect(storage.bundle?.idempotencyKey, original);
      },
    );

    test('disabled capability sends nothing and preserves ambiguity', () async {
      final capabilities = FakeCapabilityRepository();
      final storage = MemoryOperationStorage()
        ..bundle = CanonicalOperationBundle.create(
          operation: 'canonical_shared_offer_accept_v1',
          scope: 'driver',
          actorId: 'driver_1',
          payload: sharedAcceptPayload,
        );
      final repository = FakeSharedRepository([Future.value(sharedEnvelope())]);
      final container = sharedContainer(
        repository: repository,
        capabilities: capabilities,
        storage: storage,
      );
      addTearDown(container.dispose);
      await container.read(authControllerProvider.future);
      await container.read(sharedDriverOfferDetailProvider('shared_1').future);
      final key = storage.bundle!.idempotencyKey;
      capabilities.enabled = false;

      await expectLater(
        container
            .read(sharedDriverOfferDetailProvider('shared_1').notifier)
            .recover(),
        throwsA(isA<SharedTripFeatureUnavailable>()),
      );
      expect(repository.acceptCalls, 0);
      expect(storage.bundle?.idempotencyKey, key);
    });

    test('terminal accept reconciliation clears the exact bundle', () async {
      final storage = MemoryOperationStorage();
      final repository = FakeSharedRepository([
        Future.value(sharedEnvelope()),
        Future.value(sharedEnvelope()),
        Future.value(sharedEnvelope(status: 'accepted', withTrip: true)),
      ]);
      final container = sharedContainer(
        repository: repository,
        storage: storage,
      );
      addTearDown(container.dispose);
      await container.read(authControllerProvider.future);
      final provider = sharedDriverOfferDetailProvider('shared_1');
      await container.read(provider.future);

      await container.read(provider.notifier).accept();

      expect(repository.acceptCalls, 1);
      expect(
        container.read(provider).value?.offer.status,
        SharedOfferStatus.accepted,
      );
      expect(container.read(provider).value?.offer.trip, isNotNull);
      expect(storage.bundle, isNull);
    });

    test('terminal reject reconciliation retains the exact category', () async {
      final storage = MemoryOperationStorage();
      final repository = FakeSharedRepository([
        Future.value(sharedEnvelope()),
        Future.value(sharedEnvelope()),
        Future.value(
          sharedEnvelope(status: 'rejected', rejectReason: 'schedule_conflict'),
        ),
      ]);
      final container = sharedContainer(
        repository: repository,
        storage: storage,
      );
      addTearDown(container.dispose);
      await container.read(authControllerProvider.future);
      final provider = sharedDriverOfferDetailProvider('shared_1');
      await container.read(provider.future);

      await container
          .read(provider.notifier)
          .reject(CanonicalRejectReason.scheduleConflict);

      expect(repository.rejectCalls, 1);
      expect(
        container.read(provider).value?.offer.rejectReason,
        CanonicalRejectReason.scheduleConflict,
      );
      expect(storage.bundle, isNull);
    });

    test(
      'recovery reconciles an already committed accept without resending',
      () async {
        final storage = MemoryOperationStorage()
          ..bundle = CanonicalOperationBundle.create(
            operation: 'canonical_shared_offer_accept_v1',
            scope: 'driver',
            actorId: 'driver_1',
            payload: sharedAcceptPayload,
          );
        final repository = FakeSharedRepository([
          Future.value(sharedEnvelope()),
          Future.value(sharedEnvelope(status: 'accepted', withTrip: true)),
        ]);
        final container = sharedContainer(
          repository: repository,
          storage: storage,
        );
        addTearDown(container.dispose);
        await container.read(authControllerProvider.future);
        final provider = sharedDriverOfferDetailProvider('shared_1');
        await container.read(provider.future);

        await container.read(provider.notifier).recover();

        expect(repository.acceptCalls, 0);
        expect(storage.bundle, isNull);
        expect(
          container.read(provider).value?.offer.status,
          SharedOfferStatus.accepted,
        );
        expect(container.read(provider).value?.recoveryPending, isFalse);
      },
    );

    test('terminal mutation fences an older offered refresh', () async {
      final stale = Completer<SharedOfferEnvelope>();
      final repository = FakeSharedRepository([
        Future.value(sharedEnvelope()),
        stale.future,
        Future.value(sharedEnvelope()),
        Future.value(sharedEnvelope(status: 'accepted', withTrip: true)),
      ]);
      final container = sharedContainer(repository: repository);
      addTearDown(container.dispose);
      await container.read(authControllerProvider.future);
      final provider = sharedDriverOfferDetailProvider('shared_1');
      await container.read(provider.future);
      final refresh = container.read(provider.notifier).refresh();
      await Future<void>.delayed(Duration.zero);

      await container.read(provider.notifier).accept();
      stale.complete(sharedEnvelope());
      await refresh;

      expect(
        container.read(provider).value?.offer.status,
        SharedOfferStatus.accepted,
      );
    });
  });
}

const sharedAcceptPayload = {
  'route_version_id': 'version_1',
  'offer_id': 'shared_1',
  'match_version': canonicalSharedMatchVersion,
};

Map<String, dynamic> capabilitiesJson({bool? shared = true}) => {
  'canonical_route_catalog_available': true,
  'canonical_multi_route_entry_available': true,
  'canonical_matching_available': true,
  'canonical_trip_creation_available': true,
  'driver_canonical_offers_available': true,
  'canonical_assignment_status_available': true,
  if (shared != null) ...{
    'canonical_shared_trip_presentation_available': shared,
    'canonical_shared_driver_offers_available': shared,
    'canonical_shared_assignment_status_available': shared,
  },
  'maps_available': false,
  'live_tracking_available': false,
};

Map<String, dynamic> sharedOfferJson({
  String status = 'offered',
  String composition = 'mixed',
  int passengerRequests = 2,
  int passengerSeats = 3,
  int merchantOrders = 1,
  int parcelUnits = 4,
  bool withTrip = false,
  String? rejectReason,
}) => {
  'id': 'shared_1',
  'offer_version': canonicalSharedMatchVersion,
  'status': status,
  'composition': composition,
  'route_version_id': 'version_1',
  'offered_at': '2026-08-05T09:55:00.000Z',
  'expires_at': '2026-08-05T10:30:00.000Z',
  'departure_at': '2026-08-05T11:00:00.000Z',
  'passenger_request_count': passengerRequests,
  'passenger_seat_count': passengerSeats,
  'merchant_order_count': merchantOrders,
  'parcel_unit_count': parcelUnits,
  'route': routeJson(),
  'stop_events': [
    stopEventJson(
      sequence: 1,
      passengerPickups: passengerSeats,
      parcelPickups: parcelUnits,
    ),
    stopEventJson(
      sequence: 2,
      passengerDropoffs: passengerSeats,
      parcelDestinations: parcelUnits,
    ),
  ],
  'trip': withTrip
      ? {
          'id': 'trip_shared_1',
          'trip_version': canonicalSharedTripVersion,
          'status': 'accepted',
          'route_version_id': 'version_1',
          'departure_at': '2026-08-05T11:00:00.000Z',
          'vehicle_type': 'van',
          'created_at': '2026-08-05T10:01:00.000Z',
        }
      : null,
  'reject_reason': rejectReason,
  'created_at': '2026-08-05T09:55:00.000Z',
};

Map<String, dynamic> routeJson() => {
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

Map<String, dynamic> stopEventJson({
  required int sequence,
  int passengerPickups = 0,
  int passengerDropoffs = 0,
  int parcelPickups = 0,
  int parcelDestinations = 0,
}) => {
  'name_ar': sequence == 1 ? 'الخليل' : 'بيت لحم',
  'name_en': sequence == 1 ? 'Hebron' : 'Bethlehem',
  'sequence': sequence,
  'passenger_pickups': passengerPickups,
  'passenger_drop_offs': passengerDropoffs,
  'parcel_pickups': parcelPickups,
  'parcel_destinations': parcelDestinations,
};

SharedOfferEnvelope sharedEnvelope({
  String status = 'offered',
  bool withTrip = false,
  String? rejectReason,
}) => SharedOfferEnvelope(
  offer: SharedDriverOffer.fromJson(
    sharedOfferJson(
      status: status,
      withTrip: withTrip,
      rejectReason: rejectReason,
    ),
  ),
  serverNow: DateTime.parse('2026-08-05T10:00:00.000Z'),
);

http.Response jsonResponse(Map<String, dynamic> body) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  200,
  headers: const {'content-type': 'application/json; charset=utf-8'},
);

class MemoryOperationStorage implements CanonicalOperationStorage {
  @override
  String get namespace => CanonicalOperationStorage.bundleKey;
  MemoryOperationStorage({this.saveError});

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

class AuthenticatedDriverController extends AuthController {
  @override
  Future<AuthState> build() async => const AuthState.authenticated(
    AuthUser(
      id: 'driver_1',
      name: 'Driver',
      phone: '+970590000002',
      role: UserRole.driver,
      demoAccount: false,
    ),
  );
}

class FakeCapabilityRepository extends CanonicalRouteRepository {
  FakeCapabilityRepository()
    : super(
        apiClient: TestAuthenticatedClient(
          handler: (_) async => http.Response('{}', 500),
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
    canonicalSharedTripPresentationAvailable: enabled,
    canonicalSharedDriverOffersAvailable: enabled,
    canonicalSharedAssignmentStatusAvailable: enabled,
    mapsAvailable: false,
    liveTrackingAvailable: false,
  );
}

class FakeSharedRepository extends SharedTripRepository {
  FakeSharedRepository(this.details)
    : super(
        apiClient: TestAuthenticatedClient(
          handler: (_) async => http.Response('{}', 500),
        ).client,
      );

  final List<Future<SharedOfferEnvelope>> details;
  var detailIndex = 0;
  var acceptCalls = 0;
  var rejectCalls = 0;

  @override
  Future<SharedOfferEnvelope> driverOffer(String id) => details[detailIndex++];

  @override
  Future<SharedOfferEnvelope> acceptOffer({
    required String id,
    required String idempotencyKey,
    Future<void> Function()? beforeAuthRetry,
  }) async {
    acceptCalls += 1;
    return sharedEnvelope(status: 'accepted', withTrip: true);
  }

  @override
  Future<SharedOfferEnvelope> rejectOffer({
    required String id,
    required CanonicalRejectReason reason,
    required String idempotencyKey,
    Future<void> Function()? beforeAuthRetry,
  }) async {
    rejectCalls += 1;
    return sharedEnvelope(status: 'rejected', rejectReason: reason.apiValue);
  }
}

ProviderContainer sharedContainer({
  required FakeSharedRepository repository,
  FakeCapabilityRepository? capabilities,
  MemoryOperationStorage? storage,
}) => ProviderContainer(
  overrides: [
    authControllerProvider.overrideWith(AuthenticatedDriverController.new),
    sharedTripRepositoryProvider.overrideWithValue(repository),
    canonicalRouteRepositoryProvider.overrideWithValue(
      capabilities ?? FakeCapabilityRepository(),
    ),
    canonicalOperationStorageProvider.overrideWithValue(
      storage ?? MemoryOperationStorage(),
    ),
  ],
);
