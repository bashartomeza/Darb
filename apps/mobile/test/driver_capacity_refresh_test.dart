import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/core/widgets/language_switch.dart';
import 'package:masari_mobile/features/auth/application/auth_actor_binding.dart';
import 'package:masari_mobile/features/driver/application/driver_controller.dart';
import 'package:masari_mobile/features/driver/data/driver_models.dart';
import 'package:masari_mobile/features/driver/data/driver_repository.dart';
import 'package:masari_mobile/features/driver/presentation/driver_route_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import 'support/auth_test_support.dart';

void main() {
  testWidgets(
    'driver capacity polls one seat to zero and retains last counters on network error',
    (tester) async {
      final repository = _Repository();
      final container = _container(repository);
      await _pumpScreen(tester, container);
      expect(find.text('Seats available: 1'), findsOneWidget);
      repository.seats = 0;
      repository.parcels = 2;
      await tester.pump(const Duration(seconds: 4));
      await tester.pumpAndSettle();
      expect(find.text('Seats available: 1'), findsOneWidget);
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpAndSettle();
      final refreshed = find.text('Seats available: 0').evaluate().length;
      final refreshedParcels = find
          .text('Parcel capacity: 2')
          .evaluate()
          .length;
      repository.fail = true;
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      final retained = find.text('Seats available: 0').evaluate().length;
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
      expect(refreshed, 1);
      expect(refreshedParcels, 1);
      expect(retained, 1);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'driver route refresh pauses when covered, branch hidden, backgrounded and disposed; resumes immediately',
    (tester) async {
      final repository = _Repository();
      final container = _container(repository);
      final navigator = GlobalKey<NavigatorState>();
      final visible = ValueNotifier(true);
      await _pumpScreen(
        tester,
        container,
        navigator: navigator,
        visible: visible,
      );
      final initial = repository.activeCalls;
      unawaited(
        navigator.currentState!.push(
          MaterialPageRoute<void>(
            builder: (_) => const Scaffold(body: Text('covered')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final covered = repository.activeCalls;
      await tester.pump(const Duration(seconds: 15));
      await tester.pumpAndSettle();
      final hiddenCalls = repository.activeCalls;
      navigator.currentState!.pop();
      await tester.pumpAndSettle();
      final revealed = repository.activeCalls;
      visible.value = false;
      await tester.pump();
      final branchHidden = repository.activeCalls;
      await tester.pump(const Duration(seconds: 15));
      await tester.pumpAndSettle();
      final branchPaused = repository.activeCalls;
      visible.value = true;
      await tester.pumpAndSettle();
      final branchResumed = repository.activeCalls;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pump();
      final backgrounded = repository.activeCalls;
      await tester.pump(const Duration(seconds: 15));
      await tester.pumpAndSettle();
      final backgroundCalls = repository.activeCalls;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      final resumed = repository.activeCalls;
      await tester.pumpWidget(const SizedBox.shrink());
      final disposed = repository.activeCalls;
      await tester.pump(const Duration(seconds: 15));
      final afterDisposal = repository.activeCalls;
      visible.dispose();
      container.dispose();
      expect(initial, 1);
      expect(hiddenCalls, covered);
      expect(revealed, covered + 1);
      expect(branchPaused, branchHidden);
      expect(branchResumed, branchHidden + 1);
      expect(backgroundCalls, backgrounded);
      expect(resumed, backgrounded + 1);
      expect(afterDisposal, disposed);
      expect(tester.takeException(), isNull);
    },
  );

  test(
    'driver route serializes refreshes and publishes only the latest counters',
    () async {
      final repository = _Repository();
      final container = _container(repository);
      addTearDown(container.dispose);
      final published = <int?>[];
      final subscription = container.listen(driverRouteControllerProvider, (
        _,
        next,
      ) {
        if (next.hasValue) {
          published.add(next.value?.currentRoute?.seatsAvailable);
        }
      });
      addTearDown(subscription.close);
      await container.read(driverRouteControllerProvider.future);
      published.clear();
      final barrier = Completer<List<DriverRoute>>();
      repository.activeBarrier = barrier;
      final controller = container.read(driverRouteControllerProvider.notifier);
      final old = controller.refresh();
      await Future<void>.delayed(Duration.zero);
      repository.seats = 0;
      final latest = controller.refresh();
      final callsBeforeRelease = repository.activeCalls;
      barrier.complete([_route(seats: 1)]);
      await Future.wait([old, latest]);
      expect(
        callsBeforeRelease,
        2,
        reason: 'a queued refresh cannot start a second active-route GET',
      );
      expect(
        published,
        [0],
        reason: 'the overtaken one-seat snapshot must never be published',
      );
      expect(
        container
            .read(driverRouteControllerProvider)
            .value
            ?.currentRoute
            ?.seatsAvailable,
        0,
      );
    },
  );

  test('driver route requires a bound actor before issuing reads', () async {
    final repository = _Repository();
    final container = _container(repository, bind: false);
    addTearDown(container.dispose);
    final subscription = container.listen(
      driverRouteControllerProvider,
      (_, _) {},
    );
    addTearDown(subscription.close);
    final error = await _error(
      container.read(driverRouteControllerProvider.future),
    );
    expect(repository.activeCalls, 0);
    expect(repository.historyCalls, 0);
    expect(error, isA<StateError>());
  });

  for (final dispose in [false, true]) {
    test(
      'driver route ${dispose ? 'disposal' : 'account switch'} during active read cannot issue history GET',
      () async {
        final repository = _Repository();
        final barrier = Completer<List<DriverRoute>>();
        repository.activeBarrier = barrier;
        final container = _container(repository);
        final subscription = container.listen(
          driverRouteControllerProvider,
          (_, _) {},
        );
        final pending = _error(
          container.read(driverRouteControllerProvider.future),
        );
        await Future<void>.delayed(Duration.zero);
        if (dispose) {
          subscription.close();
          container.dispose();
        } else {
          container
              .read(authenticatedActorBindingProvider)
              .bind('another-driver');
        }
        barrier.complete([_route(seats: 0)]);
        final error = await pending;
        final historyCalls = repository.historyCalls;
        if (!dispose) {
          subscription.close();
          container.dispose();
        }
        expect(
          historyCalls,
          0,
          reason:
              'the active response belongs to an obsolete actor or disposed provider',
        );
        expect(error, isA<StateError>());
      },
    );
  }

  test(
    'driver route rejects account change during history read without replacing authoritative capacity',
    () async {
      final repository = _Repository();
      final container = _container(repository);
      addTearDown(container.dispose);
      final subscription = container.listen(
        driverRouteControllerProvider,
        (_, _) {},
      );
      addTearDown(subscription.close);
      await container.read(driverRouteControllerProvider.future);
      final barrier = Completer<List<DriverRoute>>();
      repository.historyBarrier = barrier;
      repository.seats = 0;
      final pending = _error(
        container.read(driverRouteControllerProvider.notifier).refresh(),
      );
      await Future<void>.delayed(Duration.zero);
      container.read(authenticatedActorBindingProvider).bind('another-driver');
      barrier.complete([]);
      final error = await pending;
      expect(
        container
            .read(driverRouteControllerProvider)
            .value
            ?.currentRoute
            ?.seatsAvailable,
        1,
      );
      expect(error, isA<StateError>());
    },
  );
}

Future<Object?> _error(Future<Object?> work) =>
    work.then<Object?>((_) => null, onError: (Object error) => error);

ProviderContainer _container(_Repository repository, {bool bind = true}) {
  final container = ProviderContainer(
    overrides: [driverRepositoryProvider.overrideWithValue(repository)],
  );
  if (bind) {
    container.read(authenticatedActorBindingProvider).bind('synthetic-driver');
  }
  return container;
}

Future<void> _pumpScreen(
  WidgetTester tester,
  ProviderContainer container, {
  GlobalKey<NavigatorState>? navigator,
  ValueNotifier<bool>? visible,
}) async {
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        navigatorKey: navigator,
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: ShellLanguageControl(
          child: visible == null
              ? const DriverRouteScreen()
              : ValueListenableBuilder<bool>(
                  valueListenable: visible,
                  builder: (_, enabled, _) => TickerMode(
                    enabled: enabled,
                    child: const DriverRouteScreen(),
                  ),
                ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _Repository extends DriverRepository {
  _Repository()
    : super(
        apiClient: TestAuthenticatedClient(
          handler: (_) async =>
              http.Response('{"error":"unexpected HTTP request"}', 500),
        ).client,
      );
  int seats = 1;
  int parcels = 4;
  int activeCalls = 0;
  int historyCalls = 0;
  bool fail = false;
  Completer<List<DriverRoute>>? activeBarrier;
  Completer<List<DriverRoute>>? historyBarrier;
  @override
  Future<List<DriverRoute>> activeRoutes() async {
    activeCalls++;
    if (fail) {
      throw const ApiException(ApiErrorType.network, 'network_unavailable');
    }
    final barrier = activeBarrier;
    activeBarrier = null;
    return barrier == null
        ? [_route(seats: seats, parcels: parcels)]
        : barrier.future;
  }

  @override
  Future<List<DriverRoute>> listRoutes() async {
    historyCalls++;
    final barrier = historyBarrier;
    historyBarrier = null;
    return barrier == null ? [] : barrier.future;
  }
}

DriverRoute _route({required int seats, int parcels = 4}) => DriverRoute(
  id: 'synthetic-route',
  originLabel: lockedDriverOriginLabel,
  originLat: lockedDriverOriginLat,
  originLng: lockedDriverOriginLng,
  destinationLabel: lockedDriverDestinationLabel,
  destinationLat: lockedDriverDestinationLat,
  destinationLng: lockedDriverDestinationLng,
  corridorKey: lockedDriverCorridorKey,
  seatsAvailable: seats,
  parcelCapacityAvailable: parcels,
  status: 'active',
  activatedAt: null,
  completedAt: null,
);
