import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/features/auth/application/auth_controller.dart';
import 'package:masari_mobile/features/auth/domain/auth_models.dart';
import 'package:masari_mobile/features/canonical_routes/application/canonical_route_controller.dart';
import 'package:masari_mobile/features/canonical_routes/data/canonical_operation_storage.dart';
import 'package:masari_mobile/features/canonical_routes/data/canonical_route_repository.dart';
import 'package:masari_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:masari_mobile/features/canonical_routes/presentation/passenger_route_request_screen.dart';
import 'package:masari_mobile/features/canonical_routes/presentation/merchant_route_order_screen.dart';
import 'package:masari_mobile/features/canonical_routes/presentation/driver_availability_screens.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';
import 'canonical_routes_test.dart' show routeJson;
import 'support/auth_test_support.dart';
import 'support/booking_recovery_test_support.dart';

void main() {
  for (final role in [UserRole.passenger, UserRole.merchant, UserRole.driver]) {
    testWidgets(
      '${role.name} form replays an exact saved operation after its departure passed',
      (tester) async {
        tester.view.physicalSize = const Size(1000, 2400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final from = DateTime.now()
            .subtract(const Duration(hours: 1))
            .toUtc()
            .toIso8601String();
        final until = DateTime.now()
            .add(const Duration(hours: 1))
            .toUtc()
            .toIso8601String();
        final body = <String, dynamic>{
          'route_version_id': 'version',
          if (role == UserRole.driver) ...{
            'departure_at': from,
            'availability_window_end': null,
            'total_seats': 1,
            'total_parcel_capacity': 0,
          } else ...{
            'pickup_stop_id': 'one',
            'requested_departure_from': from,
            'requested_departure_until': until,
            if (role == UserRole.passenger) ...{
              'dropoff_stop_id': 'three',
              'passenger_count': 1,
            } else
              'parcels': [
                {
                  'destination_stop_id': 'three',
                  'size': 'S',
                  'priority': 'normal',
                },
              ],
          },
        };
        final storage = MemoryBookingStorage();
        storage.bundle = CanonicalOperationBundle.create(
          now: DateTime.now().subtract(const Duration(days: 2)),
          operation: role == UserRole.driver
              ? 'driver_availability_create'
              : '${role.name}_route_${role == UserRole.passenger ? 'request' : 'order'}_create',
          scope: role.name,
          actorId: 'actor',
          payload: body,
        );
        final key = storage.bundle!.idempotencyKey;
        final sent = <String>[];
        final client = TestAuthenticatedClient(
          handler: (request) async {
            if (request.method == 'GET') {
              return http.Response('{"availabilities":[]}', 200);
            }
            sent.add(request.headers['idempotency-key']!);
            final value = jsonDecode(request.body) as Map<String, dynamic>;
            return http.Response(
              jsonEncode(
                role == UserRole.passenger
                    ? {
                        'request': {'id': 'saved', ...value},
                        'replayed': true,
                      }
                    : role == UserRole.merchant
                    ? {
                        'order': {
                          'id': 'saved',
                          'parcels': [{}],
                        },
                        'replayed': true,
                      }
                    : {
                        'availability': {
                          'id': 'saved',
                          ...value,
                          'route_version': {
                            'id': 'version',
                            'name_ar': 'مسار',
                            'name_en': 'Route',
                            'direction': 'outbound',
                          },
                          'remaining_seats': 1,
                          'remaining_parcel_capacity': 0,
                          'status': 'draft',
                          'revision': 1,
                        },
                        'replayed': true,
                      },
              ),
              200,
            );
          },
        );
        final router = GoRouter(
          initialLocation: '/form',
          routes: [
            GoRoute(
              path: '/form',
              builder: (_, _) => role == UserRole.passenger
                  ? const PassengerRouteRequestScreen()
                  : role == UserRole.merchant
                  ? const MerchantRouteOrderScreen()
                  : const DriverAvailabilityFormScreen(),
            ),
            GoRoute(
              path: '/driver/availability/:id',
              builder: (_, _) =>
                  const Scaffold(body: Text('Saved availability')),
            ),
          ],
        );
        addTearDown(router.dispose);
        final container = ProviderContainer(
          overrides: [
            authControllerProvider.overrideWith(() => _Actor(role)),
            canonicalOperationStorageProvider.overrideWithValue(storage),
            canonicalRouteRepositoryProvider.overrideWithValue(
              CanonicalRouteRepository(apiClient: client.client),
            ),
            mobileCapabilitiesProvider.overrideWith(_Capabilities.new),
            canonicalRouteCatalogProvider.overrideWith(_Catalog.new),
          ],
        );
        addTearDown(container.dispose);
        await container.read(authControllerProvider.future);
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
          ValueKey(
            role == UserRole.driver
                ? 'submitCanonicalAvailability'
                : role == UserRole.passenger
                ? 'submitCanonicalPassengerRequest'
                : 'submitCanonicalMerchantOrder',
          ),
        );
        await tester.ensureVisible(submit);
        await tester.tap(submit);
        await tester.pumpAndSettle();
        expect(sent, [key]);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }
}

class _Actor extends AuthController {
  _Actor(this.role);
  final UserRole role;
  @override
  Future<AuthState> build() async => AuthState.authenticated(
    AuthUser(id: 'actor', name: 'Fixture', role: role, demoAccount: false),
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
    canonicalAssignmentStatusAvailable: false,
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
