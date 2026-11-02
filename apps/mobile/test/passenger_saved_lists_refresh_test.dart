import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:darb_mobile/core/api/api_error.dart';
import 'package:darb_mobile/features/auth/application/auth_actor_binding.dart';
import 'package:darb_mobile/features/auth/application/auth_controller.dart';
import 'package:darb_mobile/features/auth/data/authenticated_api_client.dart';
import 'package:darb_mobile/features/auth/domain/auth_models.dart';
import 'package:darb_mobile/features/canonical_assignments/application/canonical_assignment_controller.dart';
import 'package:darb_mobile/features/canonical_assignments/domain/canonical_assignment_models.dart';
import 'package:darb_mobile/features/canonical_routes/application/canonical_route_controller.dart';
import 'package:darb_mobile/features/canonical_routes/data/canonical_operation_storage.dart';
import 'package:darb_mobile/features/canonical_routes/data/canonical_route_repository.dart';
import 'package:darb_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:darb_mobile/features/canonical_routes/presentation/passenger_route_request_screen.dart';
import 'package:darb_mobile/features/passenger/application/legacy_passenger_request_mutation.dart';
import 'package:darb_mobile/features/passenger/application/passenger_controller.dart';
import 'package:darb_mobile/features/passenger/application/passenger_history_controller.dart';
import 'package:darb_mobile/features/passenger/data/passenger_repository.dart';
import 'package:darb_mobile/features/passenger/presentation/create_request_screen.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'canonical_routes_test.dart' show routeJson;
import 'support/auth_test_support.dart';
import 'support/booking_recovery_test_support.dart';

// Home, "My trips" and the route request list are long-lived providers. A
// request the passenger just saved must show up there without a manual pull.

final _builds = <String, int>{};

void main() {
  setUp(_builds.clear);

  testWidgets('a saved and matched request refreshes Home and My trips', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});

    // A create whose response was lost is restored and finished by the screen.
    final storage = MemoryBookingStorage();
    final mutation = testBookingMutation(
      storage: storage,
      actor: () => 'passenger-fixture',
    );
    final payload = {
      'pickup_label': 'Origin',
      'pickup_lat': 31.72,
      'pickup_lng': 35.21,
      'destination_label': 'Destination',
      'destination_lat': 32.21,
      'destination_lng': 35.29,
      'preferred_time': DateTime.now()
          .add(const Duration(days: 1))
          .toUtc()
          .toIso8601String(),
      'passenger_count': 1,
    };
    await expectLater(
      mutation.create(
        payload: payload,
        send: (_, _, _) async =>
            throw const ApiException(ApiErrorType.network, 'network'),
      ),
      throwsA(isA<ApiException>()),
    );
    expect(await mutation.pending(), isNotNull);

    final client = TestAuthenticatedClient(
      handler: (request) async {
        if (request.url.path.endsWith('/passenger/requests')) {
          return http.Response(
            jsonEncode({
              'request': {
                ...jsonDecode(request.body) as Map<String, dynamic>,
                'id': 'saved-request',
                'status': 'pending',
                'created_at': DateTime.now().toUtc().toIso8601String(),
              },
            }),
            201,
          );
        }
        if (request.url.path.endsWith('/matches/run')) {
          return http.Response(jsonEncode(_matchResponse), 201);
        }
        return http.Response('{}', 404);
      },
    );
    final router = GoRouter(
      initialLocation: '/create',
      routes: [
        GoRoute(
          path: '/create',
          builder: (_, _) => const CreateRequestScreen(),
        ),
        GoRoute(
          path: '/passenger/match/:id',
          builder: (_, _) => const Scaffold(body: Text('Matched')),
        ),
      ],
    );
    addTearDown(router.dispose);
    final container = ProviderContainer(
      overrides: [
        authenticatedActorBindingProvider.overrideWithValue(
          AuthenticatedActorBinding()..bind('passenger-fixture'),
        ),
        authenticatedApiClientProvider.overrideWithValue(client.client),
        passengerRepositoryProvider.overrideWithValue(
          PassengerRepository(apiClient: client.client),
        ),
        legacyPassengerRequestMutationProvider.overrideWithValue(mutation),
        passengerHistoryProvider.overrideWith(_CountingHistory.new),
        passengerDashboardProvider.overrideWith(_CountingDashboard.new),
      ],
    );
    addTearDown(container.dispose);
    // Home and My trips stay alive in the shell while the form is open.
    container.listen(passengerHistoryProvider, (_, _) {});
    container.listen(passengerDashboardProvider, (_, _) {});
    await container.read(passengerHistoryProvider.future);
    await container.read(passengerDashboardProvider.future);
    expect(_builds, {'history': 1, 'dashboard': 1});

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(
          routerConfig: router,
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Matched'), findsOneWidget);
    expect(await mutation.pending(), isNull);
    expect(_builds['history'], greaterThan(1));
    expect(_builds['dashboard'], greaterThan(1));
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'a saved route request refreshes the route request list and lands on it',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final storage = MemoryBookingStorage();
      final body = <String, dynamic>{
        'route_version_id': 'version',
        'pickup_stop_id': 'one',
        'dropoff_stop_id': 'three',
        'requested_departure_from': DateTime.now()
            .add(const Duration(hours: 2))
            .toUtc()
            .toIso8601String(),
        'requested_departure_until': DateTime.now()
            .add(const Duration(hours: 3))
            .toUtc()
            .toIso8601String(),
        'passenger_count': 1,
      };
      // A pending create restores the form exactly, as after a lost response.
      storage.bundle = CanonicalOperationBundle.create(
        operation: 'passenger_route_request_create',
        scope: 'passenger',
        actorId: 'actor',
        payload: body,
      );
      final client = TestAuthenticatedClient(
        handler: (request) async {
          final value = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response(
            jsonEncode({
              'request': {'id': 'saved', ...value},
              'replayed': false,
            }),
            201,
          );
        },
      );
      final router = GoRouter(
        initialLocation: '/form',
        routes: [
          GoRoute(
            path: '/form',
            builder: (_, _) => const PassengerRouteRequestScreen(),
          ),
          GoRoute(
            path: '/passenger/canonical-assignments',
            builder: (_, _) => const Scaffold(body: Text('Route request list')),
          ),
        ],
      );
      addTearDown(router.dispose);
      final container = ProviderContainer(
        overrides: [
          authControllerProvider.overrideWith(_Actor.new),
          canonicalOperationStorageProvider.overrideWithValue(storage),
          canonicalRouteRepositoryProvider.overrideWithValue(
            CanonicalRouteRepository(apiClient: client.client),
          ),
          mobileCapabilitiesProvider.overrideWith(_Capabilities.new),
          canonicalRouteCatalogProvider.overrideWith(_Catalog.new),
          passengerCanonicalAssignmentsProvider.overrideWith(
            _CountingAssignments.new,
          ),
        ],
      );
      addTearDown(container.dispose);
      await container.read(authControllerProvider.future);
      container.listen(passengerCanonicalAssignmentsProvider, (_, _) {});
      await container.read(passengerCanonicalAssignmentsProvider.future);
      expect(_builds['assignments'], 1);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(
            routerConfig: router,
            locale: const Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
          ),
        ),
      );
      await tester.pumpAndSettle();
      final submit = find.byKey(
        const ValueKey('submitCanonicalPassengerRequest'),
      );
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(_builds['assignments'], 2);

      await tester.tap(find.text('View my route requests'));
      await tester.pumpAndSettle();
      expect(find.text('Route request list'), findsOneWidget);
      expect(storage.bundle, isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}

void _count(String key) => _builds[key] = (_builds[key] ?? 0) + 1;

class _CountingHistory extends PassengerHistoryController {
  @override
  Future<PassengerHistoryState> build() async {
    _count('history');
    return const PassengerHistoryState(requests: [], trips: []);
  }
}

class _CountingDashboard extends PassengerDashboardController {
  @override
  Future<PassengerDashboardState> build() async {
    _count('dashboard');
    return const PassengerDashboardState(activeRequests: [], trips: []);
  }
}

class _CountingAssignments extends PassengerCanonicalAssignmentsNotifier {
  @override
  Future<List<CanonicalAssignment>> build() async {
    _count('assignments');
    return const [];
  }
}

class _Actor extends AuthController {
  @override
  Future<AuthState> build() async => AuthState.authenticated(
    const AuthUser(
      id: 'actor',
      name: 'Fixture',
      role: UserRole.passenger,
      demoAccount: false,
    ),
  );
}

class _Capabilities extends MobileCapabilitiesNotifier {
  @override
  Future<MobileCapabilities> build() async => const MobileCapabilities(
    routeCatalogAvailable: true,
    multiRouteEntryAvailable: true,
    matchingAvailable: false,
    canonicalTripCreationAvailable: false,
    driverCanonicalOffersAvailable: false,
    canonicalAssignmentStatusAvailable: true,
    mapsAvailable: false,
    liveTrackingAvailable: false,
  );
}

class _Catalog extends CanonicalRouteCatalogNotifier {
  @override
  Future<List<CanonicalRoute>> build() async => [
    CanonicalRoute.fromJson(routeJson()),
  ];
}

final _matchResponse = {
  'match': {
    'id': 'saved-match',
    'status': 'proposed',
    'score': 0.8,
    'explanation': 'Best route',
    'passenger_request': {'id': 'saved-request'},
    'driver_route': {
      'id': 'route',
      'origin_label': 'Origin',
      'destination_label': 'Destination',
      'seats_available': 1,
    },
  },
  'scoringBreakdown': {
    for (final key in [
      'corridorOverlap',
      'pickupDistanceScore',
      'timingFit',
      'trustScore',
      'capacityFit',
      'finalScore',
    ])
      key: 0.8,
  },
};
