import 'dart:async';
import 'package:flutter/material.dart';
import 'package:masari_mobile/features/trips/presentation/passenger_trip_screen.dart';
import 'package:masari_mobile/features/driver/presentation/driver_trip_screen.dart';
import 'package:masari_mobile/features/checkpoints/application/checkpoint_controller.dart';
import 'package:masari_mobile/features/checkpoints/domain/checkpoint_models.dart';
import 'package:masari_mobile/features/checkpoint_directory/application/checkpoint_directory_controller.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/features/auth/application/auth_actor_binding.dart';
import 'package:masari_mobile/features/driver/application/driver_controller.dart';
import 'package:masari_mobile/features/driver/data/driver_models.dart';
import 'package:masari_mobile/features/driver/data/driver_repository.dart';
import 'package:masari_mobile/features/trips/application/passenger_trip_controller.dart';
import 'package:masari_mobile/features/trips/data/trip_models.dart';
import 'package:masari_mobile/features/trips/data/trip_repository.dart';
import 'support/auth_test_support.dart';

void main() {
  for (final driver in [false, true]) {
    final role = driver ? 'driver' : 'passenger';
    test(
      '$role serializes overlapping reads and only publishes latest request',
      () async {
        final h = _Harness(driver);
        addTearDown(h.dispose);
        await h.start();
        final blocked = Completer<String>();
        h.source.blocked = blocked;
        final first = h.refresh();
        await Future<void>.delayed(Duration.zero);
        final second = h.refresh();
        await Future<void>.delayed(Duration.zero);
        final readsBeforeRelease = h.source.reads;
        h.source.status = 'in_transit';
        blocked.complete('accepted');
        await Future.wait([first, second]);
        expect(
          readsBeforeRelease,
          2,
          reason: 'initial plus one in-flight request',
        );
        expect(h.status, 'in_transit');
      },
    );
    test(
      '$role rejects a lower stored location sequence and older equal-sequence timestamp',
      () async {
        final h = _Harness(driver);
        addTearDown(h.dispose);
        await h.start();
        h.source.location = _location(1, 20);
        await h.refresh();
        expect(h.location?.sequence, 5);
        h.source.location = _location(5, 1);
        await h.refresh();
        expect(h.location?.recordedAt, _location(5, 10).recordedAt);
        h.source.location = _location(6, 21);
        await h.refresh();
        expect(h.location?.sequence, 6);
      },
    );
    test('$role fences a delayed read after account switch', () async {
      final h = _Harness(driver);
      addTearDown(h.dispose);
      await h.start();
      final blocked = Completer<String>();
      h.source.blocked = blocked;
      final pending = h.refresh();
      await Future<void>.delayed(Duration.zero);
      final assertion = expectLater(pending, throwsStateError);
      h.container.read(authenticatedActorBindingProvider).bind('other-account');
      blocked.complete('completed');
      await assertion;
      expect(h.status, 'accepted');
    });
    test(
      '$role retains authoritative state after transport failure and recovers',
      () async {
        final h = _Harness(driver);
        addTearDown(h.dispose);
        await h.start();
        h.source.fail = true;
        await expectLater(h.refresh(), throwsStateError);
        expect(h.status, 'accepted');
        expect(h.location?.sequence, 5);
        h.source.fail = false;
        h.source.status = 'completed';
        await h.refresh();
        expect(h.status, 'completed');
      },
    );
    testWidgets('$role controller alone starts no invisible refresh timers', (
      tester,
    ) async {
      final h = _Harness(driver);
      await h.start();
      await tester.pump(const Duration(seconds: 15));
      expect(h.source.reads, 1);
      h.dispose();
      await tester.pump();
    });
    testWidgets(
      '$role real screen pauses hidden/background and reconciles on return',
      (tester) async {
        tester.view.physicalSize = const Size(1280, 1200);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final h = _Harness(driver);
        final navigator = GlobalKey<NavigatorState>();
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: h.container,
            child: MaterialApp(
              navigatorKey: navigator,
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: driver
                  ? const DriverTripScreen(tripId: 'trip')
                  : const PassengerTripScreen(tripId: 'trip'),
            ),
          ),
        );
        await tester.pump(const Duration(milliseconds: 500));
        await tester.pump();
        final initial = h.source.reads;
        await tester.pump(const Duration(seconds: 5));
        await tester.pump();
        expect(h.source.reads, initial + 1);
        unawaited(
          navigator.currentState!.push(
            MaterialPageRoute<void>(
              builder: (_) => const Scaffold(body: Text('covered')),
            ),
          ),
        );
        await tester.pump(const Duration(milliseconds: 500));
        await tester.pump();
        final covered = h.source.reads;
        await tester.pump(const Duration(seconds: 15));
        await tester.pump();
        expect(h.source.reads, covered);
        navigator.currentState!.pop();
        await tester.pump(const Duration(milliseconds: 500));
        await tester.pump();
        expect(h.source.reads, covered + 1);
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.inactive,
        );
        await tester.pump();
        final paused = h.source.reads;
        await tester.pump(const Duration(seconds: 15));
        await tester.pump();
        expect(h.source.reads, paused);
        h.source.status = 'completed';
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 500));
        await tester.pump();
        expect(h.status, 'completed');
        await tester.pumpWidget(const SizedBox.shrink());
        h.dispose();
        await tester.pump();
      },
    );
    test('$role restart reads current persisted repository state', () async {
      final source = _Source();
      final first = _Harness(driver, source: source);
      await first.start();
      first.dispose();
      source.status = 'completed';
      final next = _Harness(driver, source: source);
      addTearDown(next.dispose);
      await next.start();
      expect(next.status, 'completed');
    });
  }
  test(
    'delayed pre-action driver read cannot roll back a completed status action',
    () async {
      final h = _Harness(true);
      addTearDown(h.dispose);
      await h.start();
      final blocked = Completer<String>();
      h.source.blocked = blocked;
      final oldRead = h.refresh();
      await Future<void>.delayed(Duration.zero);
      final action = h.container
          .read(driverTripControllerProvider('trip').notifier)
          .advanceStatus();
      await Future<void>.delayed(Duration.zero);
      blocked.complete('accepted');
      await Future.wait([oldRead, action]);
      expect(h.status, 'pickup_started');
      expect(h.source.actions, 1);
    },
  );
  test(
    'lost status response reconciles saved status without a second mutation',
    () async {
      final h = _Harness(true);
      addTearDown(h.dispose);
      await h.start();
      h.source.loseResponse = true;
      await expectLater(
        h.container
            .read(driverTripControllerProvider('trip').notifier)
            .advanceStatus(),
        throwsA(isA<TimeoutException>()),
      );
      expect(h.status, 'pickup_started');
      expect(h.source.actions, 1);
      expect(
        h.container
            .read(driverTripControllerProvider('trip'))
            .value
            ?.actionInProgress,
        isFalse,
      );
    },
  );
  test(
    'lost demo reset response restores surviving stored GPS instead of deleted simulation',
    () async {
      final h = _Harness(true);
      addTearDown(h.dispose);
      h.source.location = _location(5, 20, source: 'simulated');
      await h.start();
      h.source.loseResponse = true;
      await expectLater(
        h.container
            .read(driverTripControllerProvider('trip').notifier)
            .resetSimulation(),
        throwsA(isA<TimeoutException>()),
      );
      expect(h.location?.source, 'gps');
      expect(h.location?.sequence, 1);
      expect(h.source.actions, 1);
    },
  );
  test(
    'location reset and missing records retain the existing demo contract',
    () {
      expect(
        latestTripLocation(
          _location(5, 1, source: 'simulated'),
          _location(0, 20, source: 'simulated'),
        )?.sequence,
        0,
      );
      expect(latestTripLocation(_location(5, 1), null), isNull);
    },
  );
  for (final dispose in [false, true]) {
    test(
      'delayed driver mutation is fenced after ${dispose ? 'disposal' : 'account switching'}',
      () async {
        final h = _Harness(true);
        await h.start();
        final controller = h.container.read(
          driverTripControllerProvider('trip').notifier,
        );
        h.source.actionBarrier = Completer<void>();
        final action = controller.advanceStatus();
        await Future<void>.delayed(Duration.zero);
        final reads = h.source.reads;
        final assertion = expectLater(action, throwsStateError);
        if (dispose) {
          h.dispose();
        } else {
          h.container
              .read(authenticatedActorBindingProvider)
              .bind('other-account');
        }
        h.source.actionBarrier!.complete();
        await assertion;
        expect(h.source.reads, reads);
        expect(h.source.actions, 1);
        if (!dispose) h.dispose();
      },
    );
  }
  test('rapid driver action taps issue one mutation', () async {
    final h = _Harness(true);
    addTearDown(h.dispose);
    await h.start();
    final controller = h.container.read(
      driverTripControllerProvider('trip').notifier,
    );
    h.source.actionBarrier = Completer<void>();
    final action = controller.advanceStatus();
    await controller.advanceStatus();
    expect(h.source.actions, 1);
    h.source.actionBarrier!.complete();
    await action;
    expect(h.status, 'pickup_started');
  });
}

class _Source {
  String status = 'accepted';
  int reads = 0, actions = 0;
  bool fail = false, loseResponse = false;
  Completer<String>? blocked;
  Completer<void>? actionBarrier;
  TripLocation? location = _location(5, 10);
  Future<String> read() async {
    reads++;
    if (fail) throw StateError('transport');
    final b = blocked;
    blocked = null;
    return b == null ? status : b.future;
  }

  Future<void> update(String next) async {
    actions++;
    await actionBarrier?.future;
    status = next;
    if (loseResponse) {
      loseResponse = false;
      throw TimeoutException('response lost after commit');
    }
  }
}

class _Harness {
  _Harness(this.driver, {_Source? source}) : source = source ?? _Source() {
    container = ProviderContainer(
      overrides: [
        // This fixture models trip ownership directly; optional directory auth
        // is covered separately through the real session/HTTP harness.
        checkpointDirectoryOwnerProvider.overrideWith((ref) => null),
        checkpointsProvider.overrideWith(_NoCheckpoints.new),
        tripRepositoryProvider.overrideWithValue(
          _Passenger(source: this.source),
        ),
        driverRepositoryProvider.overrideWithValue(
          _Driver(source: this.source),
        ),
      ],
    );
    container
        .read(authenticatedActorBindingProvider)
        .bind(driver ? 'driver' : 'passenger');
    if (driver) {
      subscription = container.listen(
        driverTripControllerProvider('trip'),
        (_, _) {},
      );
    } else {
      subscription = container.listen(
        passengerTripControllerProvider('trip'),
        (_, _) {},
      );
    }
  }
  final bool driver;
  final _Source source;
  late final ProviderContainer container;
  late final ProviderSubscription<Object?> subscription;
  Future<void> start() async {
    if (driver) {
      await container.read(driverTripControllerProvider('trip').future);
    } else {
      await container.read(passengerTripControllerProvider('trip').future);
    }
  }

  Future<void> refresh() => driver
      ? container.read(driverTripControllerProvider('trip').notifier).refresh()
      : container
            .read(passengerTripControllerProvider('trip').notifier)
            .refresh();
  String? get status => driver
      ? container.read(driverTripControllerProvider('trip')).value?.trip.status
      : container
            .read(passengerTripControllerProvider('trip'))
            .value
            ?.trip
            .status;
  TripLocation? get location => driver
      ? container.read(driverTripControllerProvider('trip')).value?.location
      : container.read(passengerTripControllerProvider('trip')).value?.location;
  void dispose() {
    subscription.close();
    container.dispose();
  }
}

final _client = TestAuthenticatedClient(
  handler: (_) async => http.Response('{}', 500),
).client;

class _Passenger extends TripRepository {
  _Passenger({required this.source}) : super(apiClient: _client);
  final _Source source;
  @override
  Future<PassengerTrip> tripDetail(String id) async => PassengerTrip(
    id: id,
    status: await source.read(),
    createdAt: DateTime.utc(2026),
    routeLabel: 'synthetic',
    originLat: 31.5,
    originLng: 35.1,
    destinationLat: 31.7,
    destinationLng: 35.2,
  );
  @override
  Future<TripLocation?> latestLocation(String id) async => source.location;
}

class _Driver extends DriverRepository {
  _Driver({required this.source}) : super(apiClient: _client);
  final _Source source;
  @override
  Future<DriverTrip> tripDetail(String id) async => DriverTrip(
    id: id,
    status: await source.read(),
    createdAt: DateTime.utc(2026),
    startedAt: null,
    completedAt: null,
    route: const DriverRoute(
      id: 'route',
      originLabel: 'synthetic',
      originLat: 31.5,
      originLng: 35.1,
      destinationLabel: 'synthetic',
      destinationLat: 31.7,
      destinationLng: 35.2,
      corridorKey: 'synthetic',
      seatsAvailable: 3,
      parcelCapacityAvailable: 3,
      status: 'assigned',
      activatedAt: null,
      completedAt: null,
    ),
    passengerRequest: null,
    merchantOrder: null,
    parcelBatch: null,
  );
  @override
  Future<TripLocation?> latestLocation(String id) async => source.location;
  @override
  Future<void> updateTripStatus(String id, String status) =>
      source.update(status);
  @override
  Future<void> resetSimulation(String id) async {
    source.actions++;
    source.location = _location(1, 1);
    if (source.loseResponse) {
      source.loseResponse = false;
      throw TimeoutException('response lost after reset');
    }
  }
}

TripLocation _location(int sequence, int seconds, {String source = 'gps'}) =>
    TripLocation(
      lat: 31.5,
      lng: 35.1,
      source: source,
      sequence: sequence,
      recordedAt: DateTime.utc(2026, 10, 22, 0, 0, seconds),
    );

class _NoCheckpoints extends CheckpointsNotifier {
  @override
  Future<CheckpointSnapshot> build() async => CheckpointSnapshot.empty;
}
