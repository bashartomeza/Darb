import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:darb_mobile/core/api/api_client.dart';
import 'package:darb_mobile/core/config/app_config.dart';
import 'package:darb_mobile/features/auth/data/token_storage.dart';
import 'package:darb_mobile/features/auth/domain/auth_models.dart';
import 'package:darb_mobile/features/passenger/application/passenger_controller.dart';
import 'package:darb_mobile/features/passenger/data/passenger_models.dart';
import 'package:darb_mobile/features/trips/data/trip_models.dart';

import 'test_app_config.dart';
import 'support/auth_test_support.dart';

void main() {
  test('dashboard refresh promotes a request failure to error state', () async {
    var fail = false;
    final container = ProviderContainer(
      overrides: [
        appConfigProvider.overrideWithValue(demoTestAppConfig),
        tokenStorageProvider.overrideWithValue(
          MemoryTokenStorage(
            storedBundle: AuthTokenBundle(
              accessToken: 'test-token',
              accessTokenExpiresAt: DateTime.now().toUtc().add(
                const Duration(hours: 1),
              ),
            ),
          ),
        ),
        httpClientProvider.overrideWithValue(
          MockClient((request) async {
            if (fail) throw StateError('dashboard unavailable');
            return http.Response('{"requests":[],"trips":[]}', 200);
          }),
        ),
      ],
    );
    addTearDown(container.dispose);

    final initial = await container.read(passengerDashboardProvider.future);
    expect(initial.activeRequest, isNull);
    expect(initial.activeTrip, isNull);

    fail = true;
    await expectLater(
      container.read(passengerDashboardProvider.notifier).refresh(),
      throwsStateError,
    );
    expect(container.read(passengerDashboardProvider).hasError, isTrue);
  });

  test('dashboard associates a request only with its persisted trip', () {
    final request = PassengerRequest(
      id: 'request_new',
      pickupLabel: 'A',
      pickupLat: 31.5,
      pickupLng: 35.1,
      destinationLabel: 'B',
      destinationLat: 31.7,
      destinationLng: 35.2,
      preferredTime: DateTime(2026, 10, 6),
      passengerCount: 1,
      status: 'pending',
      createdAt: DateTime(2026, 10, 6),
    );
    final oldTrip = PassengerTrip(
      id: 'trip_old',
      status: 'completed',
      createdAt: DateTime(2026, 10, 5),
      routeLabel: 'Old',
      passengerRequestId: 'request_old',
    );
    final matchingTrip = PassengerTrip(
      id: 'trip_new',
      status: 'accepted',
      createdAt: DateTime(2026, 10, 6),
      routeLabel: 'New',
      passengerRequestId: 'request_new',
    );
    final state = PassengerDashboardState(
      activeRequests: [request],
      trips: [oldTrip, matchingTrip],
    );

    expect(state.activeTrip?.id, 'trip_new');
    expect(state.tripForRequest('request_new')?.id, 'trip_new');
    expect(state.tripForRequest('request_old')?.id, 'trip_old');
  });
}
