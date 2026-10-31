import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:masari_mobile/core/api/api_client.dart';
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/core/config/app_config.dart';
import 'package:masari_mobile/features/auth/application/auth_controller.dart';
import 'package:masari_mobile/features/auth/application/auth_actor_binding.dart';
import 'package:masari_mobile/features/auth/data/session_coordinator.dart';
import 'package:masari_mobile/features/auth/data/token_storage.dart';
import 'package:masari_mobile/features/auth/domain/auth_models.dart';
import 'package:masari_mobile/features/canonical_routes/application/canonical_route_controller.dart';
import 'package:masari_mobile/features/canonical_routes/data/canonical_operation_storage.dart';
import 'package:masari_mobile/features/driver/application/driver_controller.dart';
import 'package:masari_mobile/features/driver/data/driver_models.dart';
import 'package:masari_mobile/features/driver/data/driver_repository.dart';
import 'package:masari_mobile/features/matching/data/matching_models.dart';
import 'package:masari_mobile/features/trips/data/trip_models.dart';

import 'support/auth_test_support.dart';
import 'test_app_config.dart';
import 'support/booking_recovery_test_support.dart';
import 'package:masari_mobile/features/driver/application/legacy_driver_route_mutation.dart';

void main() {
  test(
    'dashboard loads success, empty, and error states without fake data',
    () async {
      final fake = _FakeDriverRepository();
      final container = _container(fake);
      addTearDown(container.dispose);

      expect(container.read(driverDashboardProvider).isLoading, isTrue);
      final empty = await container.read(driverDashboardProvider.future);
      expect(empty.currentRoute, isNull);
      expect(empty.proposedMatchCount, 0);
      expect(empty.activeTrip, isNull);

      fake.failLists = true;
      await expectLater(
        container.read(driverDashboardProvider.notifier).refresh(),
        throwsStateError,
      );
      expect(container.read(driverDashboardProvider).hasError, isTrue);
    },
  );

  test('dashboard exposes route, proposed count, and active trip', () async {
    final fake = _FakeDriverRepository(
      routes: [_route()],
      matches: [
        _match('proposed', DateTime(2026, 7, 13, 10)),
        _match('rejected', DateTime(2026, 7, 13, 9)),
      ],
      trips: [_trip()],
    );
    final container = _container(fake);
    addTearDown(container.dispose);

    final state = await container.read(driverDashboardProvider.future);
    expect(state.currentRoute?.id, 'route_1');
    expect(state.proposedMatchCount, 1);
    expect(state.activeTrip?.id, 'trip_1');
  });

  test('route controller creates only without an operational route', () async {
    final fake = _FakeDriverRepository();
    final container = _container(fake);
    addTearDown(container.dispose);
    await container.read(driverRouteControllerProvider.future);

    await container
        .read(driverRouteControllerProvider.notifier)
        .create(seatsAvailable: 3, parcelCapacityAvailable: 7);
    expect(fake.createCalls, 1);
    expect(fake.lastSeats, 3);
    expect(fake.lastParcels, 7);

    await expectLater(
      container
          .read(driverRouteControllerProvider.notifier)
          .create(seatsAvailable: 4, parcelCapacityAvailable: 8),
      throwsA(isA<ApiException>()),
    );
    expect(fake.createCalls, 1);
  });

  test(
    'driver can cancel an active trip through the persisted lifecycle',
    () async {
      final fake = _FakeDriverRepository(trips: [_trip(status: 'in_transit')]);
      final container = _container(fake);
      addTearDown(container.dispose);

      await container.read(driverTripControllerProvider('trip_1').future);
      await container
          .read(driverTripControllerProvider('trip_1').notifier)
          .cancelTrip();

      expect(fake.statusUpdates, [('trip_1', 'cancelled')]);
      expect(
        container
            .read(driverTripControllerProvider('trip_1'))
            .value
            ?.trip
            .status,
        'cancelled',
      );
    },
  );

  test('driver can mark an in-transit delivery failed', () async {
    final fake = _FakeDriverRepository(trips: [_trip(status: 'in_transit')]);
    final container = _container(fake);
    addTearDown(container.dispose);

    await container.read(driverTripControllerProvider('trip_1').future);
    await container
        .read(driverTripControllerProvider('trip_1').notifier)
        .failDelivery();

    expect(fake.statusUpdates, [('trip_1', 'failed')]);
    expect(
      container.read(driverTripControllerProvider('trip_1')).value?.trip.status,
      'failed',
    );
  });

  test('route deactivation refreshes success and surfaces failure', () async {
    final fake = _FakeDriverRepository(routes: [_route()]);
    final container = _container(fake);
    addTearDown(container.dispose);
    await container.read(driverRouteControllerProvider.future);

    await container
        .read(driverRouteControllerProvider.notifier)
        .deactivate('route_1');
    expect(
      container.read(driverRouteControllerProvider).value?.currentRoute,
      isNull,
    );

    fake.routes = [_route()];
    fake.failDeactivate = true;
    await expectLater(
      container
          .read(driverRouteControllerProvider.notifier)
          .deactivate('route_1'),
      throwsStateError,
    );
  });

  group('legacy online-state secure recovery', () {
    test(
      'persists before send, reconciles authoritative state, then clears',
      () async {
        final fake = _FakeDriverRepository();
        final storage = _MemoryCanonicalStorage();
        fake.onOnlineSend = () => expect(storage.bundle, isNotNull);
        final container = await _onlineContainer(fake, storage);
        addTearDown(container.dispose);

        final state = await container
            .read(legacyDriverOnlineControllerProvider)
            .setOnline(true);

        expect(state.currentRoute?.isOperational, isTrue);
        expect(fake.onlineCalls, 1);
        expect(storage.saveCount, 1);
        expect(storage.clearCount, 1);
        expect(storage.bundle, isNull);
      },
    );

    test('rapid taps are fenced and cannot create a second key', () async {
      final fake = _FakeDriverRepository()..onlineBarrier = Completer<void>();
      final storage = _MemoryCanonicalStorage();
      final container = await _onlineContainer(fake, storage);
      addTearDown(container.dispose);
      final controller = container.read(legacyDriverOnlineControllerProvider);

      final first = controller.setOnline(true);
      while (fake.onlineCalls == 0) {
        await Future<void>.delayed(Duration.zero);
      }
      await expectLater(controller.setOnline(true), throwsStateError);
      fake.onlineBarrier!.complete();
      await first;

      expect(fake.onlineCalls, 1);
      expect(fake.observedKeys.toSet(), hasLength(1));
    });

    test(
      'timeout retains the same desired state and key for recovery',
      () async {
        final fake = _FakeDriverRepository()..timeoutOnlineOnce = true;
        final storage = _MemoryCanonicalStorage();
        final container = await _onlineContainer(fake, storage);
        addTearDown(container.dispose);
        final controller = container.read(legacyDriverOnlineControllerProvider);

        await expectLater(
          controller.setOnline(true),
          throwsA(isA<ApiException>()),
        );
        final retained = storage.bundle!;
        expect(retained.operation, legacyDriverOnlineOperation);
        expect(retained.payload['online'], isTrue);
        await controller.setOnline(true);

        expect(fake.observedKeys, [
          retained.idempotencyKey,
          retained.idempotencyKey,
        ]);
        expect(storage.bundle, isNull);
      },
    );

    test('secure-save failure sends no request', () async {
      final fake = _FakeDriverRepository();
      final storage = _MemoryCanonicalStorage(
        saveError: StateError('secure save failed'),
      );
      final container = await _onlineContainer(fake, storage);
      addTearDown(container.dispose);

      await expectLater(
        container.read(legacyDriverOnlineControllerProvider).setOnline(true),
        throwsStateError,
      );
      expect(fake.onlineCalls, 0);
    });

    test('global unresolved-operation slot cannot be overwritten', () async {
      final fake = _FakeDriverRepository();
      final existing = CanonicalOperationBundle.create(
        operation: 'passenger_route_request_create',
        scope: 'passenger',
        actorId: 'driver_1',
        payload: const {'route_version_id': 'version_1'},
      );
      final storage = _MemoryCanonicalStorage()..bundle = existing;
      final container = await _onlineContainer(fake, storage);
      addTearDown(container.dispose);

      await expectLater(
        container.read(legacyDriverOnlineControllerProvider).setOnline(true),
        throwsA(
          isA<CanonicalOperationBlocked>().having(
            (error) => error.code,
            'code',
            'canonical_recovery_unresolved',
          ),
        ),
      );
      expect(fake.onlineCalls, 0);
      expect(storage.bundle?.idempotencyKey, existing.idempotencyKey);
    });

    test(
      'another actor cannot inspect or replay the retained bundle',
      () async {
        final fake = _FakeDriverRepository();
        final existing = CanonicalOperationBundle.create(
          operation: legacyDriverOnlineOperation,
          scope: 'legacy_driver_online_state',
          actorId: 'driver_2',
          payload: const {
            'route_version_id': 'legacy_driver_online_state',
            'online': true,
            'expected_route_id': null,
          },
        );
        final storage = _MemoryCanonicalStorage()..bundle = existing;
        final container = await _onlineContainer(fake, storage);
        addTearDown(container.dispose);

        await expectLater(
          container.read(legacyDriverOnlineControllerProvider).setOnline(true),
          throwsA(
            isA<CanonicalOperationBlocked>().having(
              (error) => error.code,
              'code',
              'canonical_recovery_other_account',
            ),
          ),
        );
        expect(fake.onlineCalls, 0);
        expect(storage.bundle?.actorId, 'driver_2');
      },
    );

    test(
      'actor change after server commit preserves the recovery bundle',
      () async {
        final fake = _FakeDriverRepository();
        final storage = _MemoryCanonicalStorage();
        final container = await _onlineContainer(fake, storage);
        addTearDown(container.dispose);
        fake.afterOnlineCommit = () {
          container.read(authenticatedActorBindingProvider).clear();
        };

        await expectLater(
          container.read(legacyDriverOnlineControllerProvider).setOnline(true),
          throwsA(
            isA<ApiException>().having(
              (error) => error.message,
              'message',
              'session_changed',
            ),
          ),
        );

        expect(fake.onlineCalls, 1);
        expect(fake.routes.single.isOperational, isTrue);
        expect(storage.clearCount, 0);
        expect(storage.bundle?.operation, legacyDriverOnlineOperation);
        expect(storage.bundle?.actorId, 'driver_1');
      },
    );
  });

  test('match inbox handles empty, ordering, filter, and error', () async {
    final fake = _FakeDriverRepository();
    final container = _container(fake);
    addTearDown(container.dispose);
    expect(await container.read(driverMatchInboxProvider.future), isEmpty);

    fake.matches = [
      _match('accepted', DateTime(2026, 7, 13, 12)),
      _match('proposed', DateTime(2026, 7, 13, 10)),
      _match('sent_to_driver', DateTime(2026, 7, 13, 11)),
    ];
    final ordered = await container
        .read(driverMatchInboxProvider.notifier)
        .refresh(status: 'proposed');
    expect(fake.lastMatchStatus, 'proposed');
    expect(ordered.map((match) => match.status), [
      'sent_to_driver',
      'proposed',
      'accepted',
    ]);

    fake.failLists = true;
    await expectLater(
      container.read(driverMatchInboxProvider.notifier).refresh(),
      throwsStateError,
    );
  });

  test('accept returns trip and reject refreshes match state', () async {
    final fake = _FakeDriverRepository(
      matches: [_match('proposed', DateTime(2026, 7, 13, 10))],
    );
    final container = _container(fake);
    addTearDown(container.dispose);
    const matchId = 'match_proposed';
    await container.read(driverMatchDetailProvider(matchId).future);

    final trip = await container
        .read(driverMatchDetailProvider(matchId).notifier)
        .accept();
    expect(trip.id, 'trip_1');
    expect(fake.acceptCalls, 1);

    await container.read(driverMatchDetailProvider(matchId).notifier).reject();
    expect(fake.rejectCalls, 1);
    expect(
      container.read(driverMatchDetailProvider(matchId)).value?.status,
      'rejected',
    );
  });

  test('trip exposes only the valid next status', () {
    expect(_trip(status: 'accepted').nextStatus, 'pickup_started');
    expect(_trip(status: 'pickup_started').nextStatus, 'picked_up');
    expect(_trip(status: 'picked_up').nextStatus, 'in_transit');
    expect(_trip(status: 'in_transit').nextStatus, 'delivered');
    expect(_trip(status: 'delivered').nextStatus, 'completed');
    expect(_trip(status: 'completed').nextStatus, isNull);
    expect(_trip(status: 'cancelled').nextStatus, isNull);
  });

  test(
    'trip refresh reads authoritative changes without replaying actions',
    () async {
      final fake = _FakeDriverRepository(trips: [_trip()]);
      final container = _container(fake);
      addTearDown(container.dispose);
      await container.read(driverTripControllerProvider('trip_1').future);
      fake.trips = [_trip(status: 'completed')];
      await container
          .read(driverTripControllerProvider('trip_1').notifier)
          .refresh();
      expect(
        container
            .read(driverTripControllerProvider('trip_1'))
            .value
            ?.trip
            .status,
        'completed',
      );
      expect(fake.statusUpdates, isEmpty);
    },
  );

  test('terminal session invalidates the existing trip controller', () async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final fake = _FakeDriverRepository(trips: [_trip()]);
    final storage = MemoryTokenStorage(
      storedBundle: AuthTokenBundle(
        accessToken: 'driver-access',
        accessTokenExpiresAt: DateTime.now().toUtc().add(
          const Duration(hours: 1),
        ),
      ),
    );
    final container = ProviderContainer(
      overrides: [
        driverRepositoryProvider.overrideWithValue(fake),
        appConfigProvider.overrideWithValue(demoTestAppConfig),
        tokenStorageProvider.overrideWithValue(storage),
        httpClientProvider.overrideWithValue(
          MockClient(
            (_) async => http.Response(
              '{"user":{"id":"user_2","name":"Driver","phone":"+970590000002","role":"driver","demo_account":true}}',
              200,
            ),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);
    await container.read(authControllerProvider.future);
    await container.read(driverTripControllerProvider('trip_1').future);
    final polling = container.read(
      driverTripControllerProvider('trip_1').notifier,
    );

    await expectLater(
      container
          .read(authSessionCoordinatorProvider)
          .sendAuthenticated(
            (_) async => throw const ApiException(
              ApiErrorType.unauthorized,
              'session_revoked',
              statusCode: 401,
            ),
          ),
      throwsA(isA<ApiException>()),
    );
    await Future<void>.delayed(Duration.zero);

    await expectLater(polling.refresh(), throwsStateError);
    expect(
      container.read(authControllerProvider).value?.status,
      AuthStatus.sessionEnded,
    );
  });
}

ProviderContainer _container(_FakeDriverRepository fake) {
  final container = ProviderContainer(
    overrides: [
      driverRepositoryProvider.overrideWithValue(fake),
      legacyDriverRouteMutationProvider.overrideWithValue(
        LegacyDriverRouteMutation(
          storage: MemoryBookingStorage(),
          currentActor: () => 'test-driver',
        ),
      ),
    ],
  );
  container.read(authenticatedActorBindingProvider).bind('driver_1');
  return container;
}

class _FakeDriverRepository extends DriverRepository {
  _FakeDriverRepository({
    List<DriverRoute>? routes,
    List<DriverMatch>? matches,
    List<DriverTrip>? trips,
  }) : routes = routes ?? [],
       matches = matches ?? [],
       trips = trips ?? [],
       super(
         apiClient: TestAuthenticatedClient(
           handler: (_) async => http.Response('{"error":"unused"}', 500),
         ).client,
       );

  List<DriverRoute> routes;
  List<DriverMatch> matches;
  List<DriverTrip> trips;
  bool failLists = false;
  bool failDeactivate = false;
  int createCalls = 0;
  int acceptCalls = 0;
  int rejectCalls = 0;
  int? lastSeats;
  int? lastParcels;
  String? lastMatchStatus;
  int onlineCalls = 0;
  bool timeoutOnlineOnce = false;
  Completer<void>? onlineBarrier;
  void Function()? onOnlineSend;
  void Function()? afterOnlineCommit;
  final List<String> observedKeys = [];
  final List<(String, String)> statusUpdates = [];
  @override
  Future<List<DriverRoute>> listRoutes() async {
    if (failLists) throw StateError('route failure');
    return routes;
  }

  @override
  Future<List<DriverRoute>> activeRoutes() async {
    if (failLists) throw StateError('active route failure');
    return routes.where((route) => route.status == 'active').toList();
  }

  @override
  Future<List<DriverMatch>> listMatches({String? status}) async {
    if (failLists) throw StateError('match failure');
    lastMatchStatus = status;
    return matches;
  }

  @override
  Future<List<DriverTrip>> listTrips() async {
    if (failLists) throw StateError('trip failure');
    return trips;
  }

  @override
  Future<DriverRoute> createRoute({
    required int seatsAvailable,
    required int parcelCapacityAvailable,
    String? idempotencyKey,
    Future<void> Function()? beforeRetry,
  }) async {
    createCalls += 1;
    lastSeats = seatsAvailable;
    lastParcels = parcelCapacityAvailable;
    final route = _route(
      seats: seatsAvailable,
      parcels: parcelCapacityAvailable,
    );
    routes = [route, ...routes];
    return route;
  }

  @override
  Future<DriverRoute> deactivateRoute(String id) async {
    if (failDeactivate) throw StateError('deactivate failure');
    routes = routes
        .map(
          (route) => route.id == id
              ? _route(status: 'inactive', seats: route.seatsAvailable)
              : route,
        )
        .toList();
    return routes.first;
  }

  @override
  Future<LegacyDriverOnlineResult> setLegacyOnlineState({
    required bool online,
    required String idempotencyKey,
    String? expectedRouteId,
    Future<void> Function()? beforeRetry,
  }) async {
    onlineCalls += 1;
    observedKeys.add(idempotencyKey);
    onOnlineSend?.call();
    await onlineBarrier?.future;
    if (timeoutOnlineOnce) {
      timeoutOnlineOnce = false;
      throw const ApiException(ApiErrorType.timeout, 'request_timeout');
    }
    await beforeRetry?.call();
    if (online) {
      routes = [_route(), ...routes.where((route) => route.id != 'route_1')];
    } else {
      routes = routes
          .map(
            (route) => route.id == expectedRouteId
                ? _route(status: 'inactive')
                : route,
          )
          .toList();
    }
    afterOnlineCommit?.call();
    return LegacyDriverOnlineResult(
      online: online,
      routeId: expectedRouteId ?? 'route_1',
      replayed: onlineCalls > 1,
    );
  }

  @override
  Future<DriverMatch> matchDetail(String id) async => matches.first;

  @override
  Future<DriverTripReference> acceptMatch(String id) async {
    acceptCalls += 1;
    return const DriverTripReference(id: 'trip_1', status: 'accepted');
  }

  @override
  Future<void> rejectMatch(String id) async {
    rejectCalls += 1;
    matches = [_match('rejected', matches.first.createdAt)];
  }

  @override
  Future<DriverTrip> tripDetail(String id) async => trips.first;

  @override
  Future<void> updateTripStatus(String id, String status) async {
    statusUpdates.add((id, status));
    trips = [_trip(status: status), ...trips.skip(1)];
  }

  @override
  Future<TripLocation?> latestLocation(String id) async => TripLocation(
    lat: 31.5326,
    lng: 35.0998,
    source: 'simulated',
    sequence: 0,
    recordedAt: _fixedTime,
  );
}

Future<ProviderContainer> _onlineContainer(
  _FakeDriverRepository fake,
  _MemoryCanonicalStorage storage,
) async {
  final container = ProviderContainer(
    overrides: [
      driverRepositoryProvider.overrideWithValue(fake),
      canonicalOperationStorageProvider.overrideWithValue(storage),
      authControllerProvider.overrideWith(_AuthenticatedDriverController.new),
    ],
  );
  await container.read(authControllerProvider.future);
  container.read(authenticatedActorBindingProvider).bind('driver_1');
  await container.read(driverDashboardProvider.future);
  return container;
}

class _AuthenticatedDriverController extends AuthController {
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

class _MemoryCanonicalStorage implements CanonicalOperationStorage {
  @override
  String get namespace => CanonicalOperationStorage.bundleKey;
  _MemoryCanonicalStorage({this.saveError});

  CanonicalOperationBundle? bundle;
  final Object? saveError;
  int saveCount = 0;
  int clearCount = 0;

  @override
  Future<CanonicalOperationBundle?> read() async => bundle;

  @override
  Future<void> save(CanonicalOperationBundle value) async {
    saveCount += 1;
    if (saveError case final error?) throw error;
    bundle = value;
  }

  @override
  Future<void> clear() async {
    clearCount += 1;
    bundle = null;
  }
}

final _fixedTime = DateTime.utc(2026, 7, 13, 8);

DriverRoute _route({
  String status = 'active',
  int seats = 2,
  int parcels = 5,
}) => DriverRoute(
  id: 'route_1',
  originLabel: lockedDriverOriginLabel,
  originLat: lockedDriverOriginLat,
  originLng: lockedDriverOriginLng,
  destinationLabel: lockedDriverDestinationLabel,
  destinationLat: lockedDriverDestinationLat,
  destinationLng: lockedDriverDestinationLng,
  corridorKey: lockedDriverCorridorKey,
  seatsAvailable: seats,
  parcelCapacityAvailable: parcels,
  status: status,
  activatedAt: _fixedTime,
  completedAt: null,
);

DriverMatch _match(String status, DateTime createdAt) => DriverMatch(
  id: 'match_$status',
  status: status,
  score: 0.9317,
  method: 'masari_route_score',
  explanation: 'Safe explanation',
  breakdown: const ScoringBreakdown(
    corridorOverlap: 0.95,
    pickupDistanceScore: 0.82,
    timingFit: 0.9,
    trustScore: 0.86,
    capacityFit: 1,
    finalScore: 0.9317,
  ),
  createdAt: createdAt,
  route: const DriverRouteSummary(
    id: 'route_1',
    originLabel: lockedDriverOriginLabel,
    destinationLabel: lockedDriverDestinationLabel,
    corridorKey: lockedDriverCorridorKey,
    seatsAvailable: 2,
    parcelCapacityAvailable: 5,
    status: 'active',
  ),
  passengerRequest: const DriverPassengerSummary(
    id: 'request_1',
    pickupLabel: 'PPU Main Gate',
    destinationLabel: 'Bethlehem Center',
    passengerCount: 1,
    status: 'pending',
  ),
  merchantOrder: null,
  parcelBatch: null,
);

DriverTrip _trip({String status = 'accepted'}) => DriverTrip(
  id: 'trip_1',
  status: status,
  createdAt: _fixedTime,
  startedAt: _fixedTime,
  completedAt: null,
  route: _route(status: 'assigned'),
  passengerRequest: const DriverPassengerSummary(
    id: 'request_1',
    pickupLabel: 'PPU Main Gate',
    destinationLabel: 'Bethlehem Center',
    passengerCount: 1,
    status: 'accepted',
  ),
  merchantOrder: null,
  parcelBatch: null,
);
