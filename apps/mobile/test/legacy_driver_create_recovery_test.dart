import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:darb_mobile/features/auth/application/auth_actor_binding.dart';
import 'package:darb_mobile/features/canonical_routes/data/canonical_operation_storage.dart';
import 'package:darb_mobile/features/driver/application/legacy_driver_route_mutation.dart';
import 'package:darb_mobile/features/driver/data/driver_repository.dart';
import 'package:darb_mobile/features/driver/presentation/driver_route_screen.dart';
import 'package:darb_mobile/features/operating_routes/data/operating_route_repository.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';
import 'support/auth_test_support.dart';
import 'support/operating_routes_fixture.dart';

void main() {
  testWidgets(
    'driver form replays the saved identity after response loss and capacity/status changes',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      FlutterSecureStorage.setMockInitialValues({});
      final keys = <String>[];
      final bodies = <String>[];
      final rows = <String, Map<String, dynamic>>{};
      var lose = true;
      Future<http.Response> handler(http.Request request) async {
        if (request.method == 'GET') {
          return http.Response(
            jsonEncode({'routes': rows.values.toList()}),
            200,
          );
        }
        final key = request.headers['idempotency-key'] ?? '';
        keys.add(key);
        bodies.add(request.body);
        final row = rows.putIfAbsent(
          key,
          () => {
            ...jsonDecode(request.body) as Map<String, dynamic>,
            'origin_label': 'Hebron',
            'destination_label': 'Bethlehem',
            'corridor_key': 'hebron-to-bethlehem',
            'id': 'original-route',
            'origin_lat': 31.5,
            'origin_lng': 35.1,
            'destination_lat': 31.7,
            'destination_lng': 35.2,
            'status': 'active',
          },
        );
        if (lose) {
          lose = false;
          row['seats_available'] = 0;
          row['status'] = 'completed';
          throw http.ClientException('commit response lost');
        }
        return http.Response(jsonEncode({'route': row}), 200);
      }

      Future<void> pump() async {
        final client = TestAuthenticatedClient(handler: handler);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authenticatedActorBindingProvider.overrideWithValue(
                AuthenticatedActorBinding()..bind('driver'),
              ),
              driverRepositoryProvider.overrideWithValue(
                DriverRepository(apiClient: client.client),
              ),
              // One running route, so it is chosen for the driver.
              operatingRoutesProvider.overrideWith(
                (ref) async => testOperatingRoutes().take(1).toList(),
              ),
            ],
            child: const MaterialApp(
              locale: Locale('en'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: DriverRouteScreen(),
            ),
          ),
        );
        await tester.pumpAndSettle();
      }

      await pump();
      await tester.tap(find.byKey(const ValueKey('activateRouteButton')));
      await tester.pumpAndSettle();
      expect(find.text('Verify booking'), findsOneWidget);
      expect(keys.single, isNotEmpty);
      final seats = tester.widget<DropdownButtonFormField<int>>(
        find.byKey(const ValueKey('driverSeatsField')),
      );
      expect(seats.onChanged, isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await pump();
      await tester.pumpAndSettle();
      expect(keys, [keys.first, keys.first]);
      // The replay is the saved body, route included.
      expect(bodies.toSet(), hasLength(1));
      expect(jsonDecode(bodies.first)['service_route_id'], 'route-heb-bth');
      expect(rows.length, 1);
      expect(find.byKey(const ValueKey('driverRouteMessage')), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'a route saved before routes existed is replayed as saved, without a route',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      FlutterSecureStorage.setMockInitialValues({});
      final saved = CanonicalOperationBundle.create(
        operation: LegacyDriverRouteMutation.operation,
        scope: 'driver',
        actorId: 'driver',
        payload: const {
          'route_version_id': LegacyDriverRouteMutation.sentinel,
          'seats_available': 3,
          'parcel_capacity_available': 4,
        },
      );
      await CanonicalOperationStorage(
        const FlutterSecureStorage(),
        storageKey: 'darb_legacy_driver_create_v1',
      ).save(saved);

      final posts = <http.Request>[];
      Future<http.Response> handler(http.Request request) async {
        if (request.method == 'GET') {
          return http.Response(
            posts.isEmpty ? '{"routes":[]}' : '{"routes":[$_oldRoute]}',
            200,
          );
        }
        posts.add(request);
        return http.Response('{"route":$_oldRoute}', 200);
      }

      final client = TestAuthenticatedClient(handler: handler);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authenticatedActorBindingProvider.overrideWithValue(
              AuthenticatedActorBinding()..bind('driver'),
            ),
            driverRepositoryProvider.overrideWithValue(
              DriverRepository(apiClient: client.client),
            ),
            operatingRoutesProvider.overrideWith(
              (ref) async => testOperatingRoutes(),
            ),
          ],
          child: const MaterialApp(
            locale: Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: DriverRouteScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(posts, hasLength(1));
      expect(posts.single.headers['idempotency-key'], saved.idempotencyKey);
      expect(jsonDecode(posts.single.body), {
        'seats_available': 3,
        'parcel_capacity_available': 4,
      });
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('a saved route refused on resend leaves verify mode', (
    tester,
  ) async {
    final storage = await _saveRoute();
    final posts = <http.Request>[];
    await _pumpRouteScreen(tester, (request) async {
      if (request.method == 'GET') return http.Response('{"routes":[]}', 200);
      posts.add(request);
      return http.Response('{"error":"route_unavailable"}', 409);
    });

    expect(posts, hasLength(1));
    expect(await storage.read(), isNull);
    expect(find.text('Verify booking'), findsNothing);
    expect(find.text('Activate route'), findsOneWidget);
    expect(
      find.textContaining('Darb did not accept the saved request'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('discardSavedRequest')), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('a saved route can be discarded to start again', (tester) async {
    final storage = await _saveRoute();
    var posts = 0;
    await _pumpRouteScreen(tester, (request) async {
      if (request.method == 'GET') return http.Response('{"routes":[]}', 200);
      posts++;
      throw http.ClientException('lost again');
    });
    expect(find.text('Verify booking'), findsOneWidget);
    final sent = posts;

    await tester.ensureVisible(
      find.byKey(const ValueKey('discardSavedRequest')),
    );
    await tester.tap(find.byKey(const ValueKey('discardSavedRequest')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('confirmDiscardSavedRequest')));
    await tester.pumpAndSettle();

    expect(await storage.read(), isNull);
    expect(find.text('Verify booking'), findsNothing);
    expect(find.text('Activate route'), findsOneWidget);
    expect(posts, sent);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}

/// A route kept on the device because its response was lost.
Future<CanonicalOperationStorage> _saveRoute() async {
  SharedPreferences.setMockInitialValues({});
  FlutterSecureStorage.setMockInitialValues({});
  final storage = CanonicalOperationStorage(
    const FlutterSecureStorage(),
    storageKey: 'darb_legacy_driver_create_v1',
  );
  await storage.save(
    CanonicalOperationBundle.create(
      operation: LegacyDriverRouteMutation.operation,
      scope: 'driver',
      actorId: 'driver',
      payload: const {
        'route_version_id': LegacyDriverRouteMutation.sentinel,
        'service_route_id': 'route-heb-bth',
        'seats_available': 3,
        'parcel_capacity_available': 4,
      },
    ),
  );
  return storage;
}

Future<void> _pumpRouteScreen(
  WidgetTester tester,
  Future<http.Response> Function(http.Request) handler,
) async {
  final client = TestAuthenticatedClient(handler: handler);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authenticatedActorBindingProvider.overrideWithValue(
          AuthenticatedActorBinding()..bind('driver'),
        ),
        driverRepositoryProvider.overrideWithValue(
          DriverRepository(apiClient: client.client),
        ),
        operatingRoutesProvider.overrideWith(
          (ref) async => testOperatingRoutes(),
        ),
      ],
      child: const MaterialApp(
        locale: Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: DriverRouteScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

const _oldRoute =
    '{"id":"old-route","origin_label":"Hebron / PPU / Bab Al-Zawiya","origin_lat":31.5,"origin_lng":35.1,"destination_label":"Bethlehem","destination_lat":31.7,"destination_lng":35.2,"corridor_key":"hebron-ppu-bab-al-zawiya-to-bethlehem","seats_available":3,"parcel_capacity_available":4,"status":"active","activated_at":null,"completed_at":null}';
