import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:darb_mobile/core/api/api_error.dart';
import 'package:darb_mobile/core/theme/app_theme.dart';
import 'package:darb_mobile/features/assistant/application/passenger_assistant_controller.dart';
import 'package:darb_mobile/features/assistant/domain/assistant_route_match.dart';
import 'package:darb_mobile/features/assistant/domain/passenger_assistant_models.dart';
import 'package:darb_mobile/features/assistant/presentation/passenger_assistant_screen.dart';
import 'package:darb_mobile/features/auth/application/auth_actor_binding.dart';
import 'package:darb_mobile/features/auth/application/auth_controller.dart';
import 'package:darb_mobile/features/auth/data/authenticated_api_client.dart';
import 'package:darb_mobile/features/auth/domain/auth_models.dart';
import 'package:darb_mobile/features/canonical_routes/application/canonical_route_controller.dart';
import 'package:darb_mobile/features/canonical_routes/data/canonical_operation_storage.dart';
import 'package:darb_mobile/features/matching/data/matching_models.dart';
import 'package:darb_mobile/features/operating_routes/data/operating_route_models.dart';
import 'package:darb_mobile/features/operating_routes/data/operating_route_repository.dart';
import 'package:darb_mobile/core/theme/passenger_theme.dart';
import 'package:darb_mobile/features/notifications/application/notifications_controller.dart';
import 'package:darb_mobile/features/passenger/application/legacy_passenger_request_mutation.dart';
import 'package:darb_mobile/features/passenger/application/passenger_controller.dart';
import 'package:darb_mobile/features/passenger/presentation/passenger_home_screen.dart';
import 'package:darb_mobile/features/passenger/data/passenger_models.dart';
import 'package:darb_mobile/features/passenger/data/passenger_repository.dart';
import 'package:darb_mobile/features/passenger/presentation/create_request_screen.dart';
import 'package:darb_mobile/features/passenger/presentation/request_detail_screen.dart';
import 'package:darb_mobile/features/passenger_parcels/data/passenger_parcel_models.dart';
import 'package:darb_mobile/features/passenger_parcels/data/passenger_parcel_repository.dart';
import 'package:darb_mobile/features/passenger_parcels/presentation/send_parcel_screen.dart';
import 'package:darb_mobile/features/shell/presentation/welcome_screen.dart';
import 'package:darb_mobile/features/trips/data/trip_models.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/auth_test_support.dart';
import 'support/booking_recovery_test_support.dart';
import 'support/operating_routes_fixture.dart';
import 'test_app_config.dart';

const _hebronToBethlehem = 'Hebron → Bethlehem';

void main() {
  group('passenger request model', () {
    test('reads the route and the typed places', () {
      final request = PassengerRequest.fromJson(_requestJson(withRoute: true));
      expect(request.serviceRouteId, 'route-heb-bth');
      expect(request.routeName(arabic: true), 'الخليل ← بيت لحم');
      expect(request.routeName(arabic: false), _hebronToBethlehem);
      expect(request.pickupDetails, 'Near the PPU main gate');
      expect(request.dropoffDetails, 'Bethlehem bus station');
    });

    test('an older request has no route and keeps its labels', () {
      final request = PassengerRequest.fromJson(_requestJson(withRoute: false));
      expect(request.serviceRouteId, isNull);
      expect(request.routeName(arabic: true), isNull);
      expect(request.pickupDetails, isNull);
      expect(request.pickupLabel, 'PPU Main Gate');
    });

    test('matches and trips read the passenger request details', () {
      final match = MatchResult.fromJson(
        {
          'id': 'match-1',
          'status': 'proposed',
          'score': 0.8,
          'explanation': 'x',
          'passenger_request': {
            'id': 'request-1',
            'route_name_ar': 'الخليل ← بيت لحم',
            'route_name_en': _hebronToBethlehem,
            'pickup_details': 'Near the PPU main gate',
            'dropoff_details': 'Bethlehem bus station',
          },
          'driver_route': {
            'id': 'driver-route',
            'origin_label': 'Hebron',
            'destination_label': 'Bethlehem',
            'seats_available': 2,
          },
        },
        {
          for (final key in [
            'corridorOverlap',
            'pickupDistanceScore',
            'timingFit',
            'trustScore',
            'capacityFit',
            'finalScore',
          ])
            key: 0.5,
        },
      );
      expect(match.routeName(arabic: true), 'الخليل ← بيت لحم');
      expect(match.pickupDetails, 'Near the PPU main gate');
      expect(match.dropoffDetails, 'Bethlehem bus station');

      final trip = PassengerTrip.fromJson({
        'id': 'trip-1',
        'status': 'accepted',
        'created_at': '2030-01-01T10:00:00.000Z',
        'driver_route': {
          'origin_label': 'Hebron',
          'destination_label': 'Bethlehem',
        },
        'passenger_request': {
          'id': 'request-1',
          'route_name_en': _hebronToBethlehem,
          'pickup_details': 'Near the PPU main gate',
          'dropoff_details': 'Bethlehem bus station',
        },
      });
      expect(trip.routeName(arabic: true), _hebronToBethlehem);
      expect(trip.pickupDetails, 'Near the PPU main gate');
      expect(trip.dropoffDetails, 'Bethlehem bus station');
    });
  });

  group('create request screen', () {
    testWidgets('shows a loading route list while the routes are read', (
      tester,
    ) async {
      final never = Completer<List<OperatingRoute>>();
      await _pumpCreate(tester, routes: (_) => never.future, settle: false);
      expect(
        find.byKey(const ValueKey('operatingRoutesLoading')),
        findsOneWidget,
      );
      expect(find.text('Loading routes…'), findsOneWidget);
      never.complete(testOperatingRoutes());
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('passengerRouteField')), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets('a failed route list can be retried', (tester) async {
      var reads = 0;
      await _pumpCreate(
        tester,
        routes: (_) async {
          reads++;
          if (reads == 1) throw http.ClientException('offline');
          return testOperatingRoutes();
        },
      );
      expect(
        find.byKey(const ValueKey('operatingRoutesError')),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('operatingRoutesRetry')));
      await tester.pumpAndSettle();
      expect(reads, 2);
      expect(find.byKey(const ValueKey('passengerRouteField')), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets('says so when no route is running', (tester) async {
      await _pumpCreate(tester, routes: (_) async => const []);
      expect(
        find.byKey(const ValueKey('operatingRoutesEmpty')),
        findsOneWidget,
      );
      expect(
        find.text('No routes are running right now. Please check again later.'),
        findsOneWidget,
      );
      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets('offers the routes by name in Arabic', (tester) async {
      await _pumpCreate(tester, locale: const Locale('ar'));
      await tester.tap(find.byKey(const ValueKey('passengerRouteField')));
      await tester.pumpAndSettle();
      expect(find.text('الخليل ← بيت لحم'), findsWidgets);
      expect(find.text('بيت لحم ← الخليل'), findsWidgets);
      // The pickup hint guides the passenger towards an exact place.
      await tester.tap(find.text('الخليل ← بيت لحم').last);
      await tester.pumpAndSettle();
      expect(
        find.text('مثال: أمام البوابة الرئيسية لجامعة بوليتكنك فلسطين'),
        findsOneWidget,
      );
      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets(
      'needs a route and both places of at least 3 characters before sending',
      (tester) async {
        final creates = <Map<String, dynamic>>[];
        await _pumpCreate(
          tester,
          handler: (request) async {
            if (request.url.path.endsWith('/passenger/requests')) {
              creates.add(jsonDecode(request.body) as Map<String, dynamic>);
            }
            return http.Response('{"error":"unexpected"}', 500);
          },
        );
        await tester.tap(find.byKey(const ValueKey('submitPassengerRequest')));
        await tester.pumpAndSettle();
        expect(find.text('Choose a route to continue.'), findsOneWidget);
        expect(find.text('Write at least 3 characters.'), findsNWidgets(2));

        await _chooseRoute(tester);
        await tester.enterText(
          find.byKey(const ValueKey('pickupDetailsField')),
          '  ab ',
        );
        await tester.enterText(
          find.byKey(const ValueKey('dropoffDetailsField')),
          'Bethlehem bus station',
        );
        await tester.tap(find.byKey(const ValueKey('submitPassengerRequest')));
        await tester.pumpAndSettle();
        expect(find.text('Choose a route to continue.'), findsNothing);
        expect(find.text('Write at least 3 characters.'), findsOneWidget);
        expect(creates, isEmpty);

        // The counter shows the 300-character limit.
        expect(find.textContaining('/300'), findsNWidgets(2));
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );

    testWidgets('sends the route body, then matches the saved request', (
      tester,
    ) async {
      final creates = <Map<String, dynamic>>[];
      final matched = <Object?>[];
      await _pumpCreate(
        tester,
        handler: (request) async {
          if (request.url.path.endsWith('/passenger/requests')) {
            creates.add(jsonDecode(request.body) as Map<String, dynamic>);
            return http.Response(
              jsonEncode({
                'request': {'id': 'route-request'},
              }),
              201,
            );
          }
          if (request.url.path.endsWith('/matches/run')) {
            matched.add(
              (jsonDecode(request.body) as Map)['passengerRequestId'],
            );
            return http.Response(jsonEncode(_matchResponse()), 201);
          }
          return http.Response('{"matches":[]}', 200);
        },
      );
      await _chooseRoute(tester);
      await tester.enterText(
        find.byKey(const ValueKey('pickupDetailsField')),
        '  Near the PPU main gate ',
      );
      await tester.enterText(
        find.byKey(const ValueKey('dropoffDetailsField')),
        'Bethlehem bus station',
      );
      await tester.tap(find.byIcon(Icons.add));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('submitPassengerRequest')));
      await tester.pumpAndSettle();

      expect(creates, hasLength(1));
      final body = creates.single;
      expect(body.keys.toSet(), {
        'service_route_id',
        'pickup_details',
        'dropoff_details',
        'preferred_time',
        'passenger_count',
      });
      expect(body['service_route_id'], 'route-heb-bth');
      expect(body['pickup_details'], 'Near the PPU main gate');
      expect(body['dropoff_details'], 'Bethlehem bus station');
      expect(body['passenger_count'], 2);
      expect(DateTime.parse(body['preferred_time'] as String).isUtc, isTrue);
      expect(matched, ['route-request']);
      expect(find.text('Matched'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets(
      'a coordinate booking left pending by an older build is replayed unchanged',
      (tester) async {
        FlutterSecureStorage.setMockInitialValues({});
        final mutation = LegacyPassengerRequestMutation(
          storage: CanonicalOperationStorage(
            const FlutterSecureStorage(),
            storageKey: 'darb_legacy_passenger_create_v1',
          ),
          currentActor: () => 'passenger-fixture',
        );
        final legacy = {
          'pickup_label': 'PPU Main Gate',
          'pickup_lat': 31.55,
          'pickup_lng': 35.1,
          'destination_label': 'Bethlehem Center',
          'destination_lat': 31.7054,
          'destination_lng': 35.2024,
          'preferred_time': DateTime.now()
              .add(const Duration(days: 1))
              .toUtc()
              .toIso8601String(),
          'passenger_count': 1,
        };
        await expectLater(
          mutation.create(
            payload: legacy,
            // The response was lost: the outcome stays unknown.
            send: (_, _, _) async =>
                throw const ApiException(ApiErrorType.network, 'lost'),
          ),
          throwsA(anything),
        );
        final bodies = <Map<String, dynamic>>[];
        await _pumpCreate(
          tester,
          preserveStorage: true,
          handler: (request) async {
            if (request.url.path.endsWith('/passenger/requests')) {
              bodies.add(jsonDecode(request.body) as Map<String, dynamic>);
              return http.Response(
                jsonEncode({
                  'request': {'id': 'legacy-request'},
                }),
                200,
              );
            }
            return http.Response('{"error":"no_compatible_driver"}', 409);
          },
        );
        expect(bodies, [legacy]);
        expect(find.text('Saved legacy-request'), findsOneWidget);
        expect(await mutation.pending(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );

    testWidgets('a turned-off route is reported and nothing stays pending', (
      tester,
    ) async {
      var reads = 0;
      await _pumpCreate(
        tester,
        routes: (_) async {
          reads++;
          return testOperatingRoutes();
        },
        handler: (request) async {
          if (request.url.path.endsWith('/passenger/requests')) {
            return http.Response('{"error":"route_unavailable"}', 409);
          }
          return http.Response('{}', 404);
        },
      );
      await _chooseRoute(tester);
      await tester.enterText(
        find.byKey(const ValueKey('pickupDetailsField')),
        'Near the PPU main gate',
      );
      await tester.enterText(
        find.byKey(const ValueKey('dropoffDetailsField')),
        'Bethlehem bus station',
      );
      await tester.tap(find.byKey(const ValueKey('submitPassengerRequest')));
      await tester.pumpAndSettle();
      expect(
        find.text('This route is no longer available. Choose another route.'),
        findsOneWidget,
      );
      expect(find.text('Verify booking'), findsNothing);
      // The list is read again so the passenger sees what still runs.
      expect(reads, 2);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  });

  group('request detail', () {
    testWidgets('shows the route and the exact places', (tester) async {
      await _pumpDetail(tester, _requestJson(withRoute: true));
      expect(find.text('Route'), findsOneWidget);
      expect(find.text(_hebronToBethlehem), findsOneWidget);
      expect(find.text('Pickup point'), findsOneWidget);
      expect(find.text('Near the PPU main gate'), findsOneWidget);
      expect(find.text('Drop-off point'), findsOneWidget);
      expect(find.text('Bethlehem bus station'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets('shows the route name in Arabic', (tester) async {
      await _pumpDetail(
        tester,
        _requestJson(withRoute: true),
        locale: const Locale('ar'),
      );
      expect(find.text('الخليل ← بيت لحم'), findsOneWidget);
      expect(find.text('مكان الصعود'), findsOneWidget);
      expect(find.text('مكان النزول'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets('an older request keeps showing its place names', (
      tester,
    ) async {
      await _pumpDetail(tester, _requestJson(withRoute: false));
      expect(find.text('Pickup'), findsOneWidget);
      expect(find.text('PPU Main Gate'), findsOneWidget);
      expect(find.text('Destination'), findsOneWidget);
      expect(find.text('Bethlehem Center'), findsOneWidget);
      expect(find.textContaining('PPU Main Gate'), findsWidgets);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  });

  group('assistant route', () {
    final routes = testOperatingRoutes();

    PassengerAssistantTripDraft draft({
      required String pickup,
      required String destination,
      String pickupKey = 'pickup',
      String destinationKey = 'destination',
      double? pickupLat,
      double? pickupLng,
    }) => PassengerAssistantTripDraft(
      pickupKey: pickupKey,
      pickupLabel: pickup,
      destinationKey: destinationKey,
      destinationLabel: destination,
      preferredTime: DateTime.utc(2030, 1, 2, 12),
      passengerCount: 1,
      pickupLat: pickupLat,
      pickupLng: pickupLng,
    );

    test('matches Arabic and English city names in both directions', () {
      expect(
        routeForAssistantDraft(
          routes,
          draft(pickup: 'الخليل', destination: 'بيت لحم'),
        )?.id,
        'route-heb-bth',
      );
      expect(
        routeForAssistantDraft(
          routes,
          draft(pickup: 'Bethlehem Center', destination: 'hebron'),
        )?.id,
        'route-bth-heb',
      );
    });

    test('tolerates the article, hamza and spelling variants', () {
      expect(
        routeForAssistantDraft(
          routes,
          draft(pickup: 'خليل', destination: 'وسط بيت لحم'),
        )?.id,
        'route-heb-bth',
      );
      expect(
        routeForAssistantDraft(
          routes,
          draft(pickup: 'مدينة الخَليل', destination: 'بيتَ لحم'),
        )?.id,
        'route-heb-bth',
      );
      expect(
        routeForAssistantDraft(
          routes,
          draft(
            pickup: 'Somewhere',
            pickupKey: 'city-hebron',
            destination: 'Somewhere else',
            destinationKey: 'bethlehem-center',
          ),
        )?.id,
        'route-heb-bth',
      );
    });

    test('places that name no city fall back to the nearest city', () {
      expect(
        routeForAssistantDraft(
          routes,
          draft(
            pickup: 'PPU Main Gate',
            pickupLat: 31.55,
            pickupLng: 35.1,
            destination: 'Bethlehem',
          ),
        )?.id,
        'route-heb-bth',
      );
      // Far from every city: the passenger chooses.
      expect(
        routeForAssistantDraft(
          routes,
          draft(
            pickup: 'Somewhere',
            pickupLat: 32.9,
            pickupLng: 35.1,
            destination: 'Bethlehem',
          ),
        ),
        isNull,
      );
    });

    test('no guess for unknown places or a route that does not exist', () {
      expect(
        routeForAssistantDraft(
          routes,
          draft(pickup: 'Nablus', destination: 'Bethlehem'),
        ),
        isNull,
      );
      expect(
        routeForAssistantDraft(
          routes,
          draft(pickup: 'Hebron', destination: 'Hebron'),
        ),
        isNull,
      );
    });

    testWidgets(
      'review card preselects the route from the extracted cities and sends route and places',
      (tester) async {
        tester.view.physicalSize = const Size(1000, 2400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final controller = _CapturingAssistantController(
          PassengerAssistantState(
            phase: PassengerAssistantPhase.requestReview,
            messages: const [
              PassengerAssistantMessage.passenger(
                'بدي أروح من الخليل لبيت لحم',
              ),
            ],
            draft: PassengerAssistantTripDraft(
              pickupKey: 'hebron-center',
              pickupLabel: 'وسط الخليل',
              destinationKey: 'bethlehem-center',
              destinationLabel: 'وسط بيت لحم',
              preferredTime: DateTime.now().add(const Duration(days: 1)),
              passengerCount: 1,
            ),
          ),
        );
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              passengerAssistantControllerProvider.overrideWith(
                () => controller,
              ),
              operatingRoutesProvider.overrideWith(
                (ref) async => testOperatingRoutes(),
              ),
            ],
            child: MaterialApp(
              locale: const Locale('ar'),
              supportedLocales: AppLocalizations.supportedLocales,
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              theme: AppTheme.light,
              home: const PassengerAssistantScreen(),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('الخليل ← بيت لحم'), findsOneWidget);
        await tester.enterText(
          find.byKey(const ValueKey('assistantPickupDetailsField')),
          'وسط الخليل، أمام البلدية',
        );
        await tester.ensureVisible(
          find.byKey(const ValueKey('assistantConfirmSearch')),
        );
        await tester.tap(find.byKey(const ValueKey('assistantConfirmSearch')));
        await tester.pumpAndSettle();

        final searched = controller.searched!;
        expect(searched.serviceRouteId, 'route-heb-bth');
        expect(searched.pickupDetails, 'وسط الخليل، أمام البلدية');
        expect(searched.dropoffDetails, 'وسط بيت لحم');
      },
    );

    testWidgets('without a recognised route the passenger must choose one', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1000, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final controller = _CapturingAssistantController(
        PassengerAssistantState(
          phase: PassengerAssistantPhase.requestReview,
          draft: PassengerAssistantTripDraft(
            pickupKey: 'unknown',
            pickupLabel: 'Somewhere',
            destinationKey: 'elsewhere',
            destinationLabel: 'Elsewhere',
            preferredTime: DateTime.now().add(const Duration(days: 1)),
            passengerCount: 1,
          ),
        ),
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            passengerAssistantControllerProvider.overrideWith(() => controller),
            operatingRoutesProvider.overrideWith(
              (ref) async => testOperatingRoutes(),
            ),
          ],
          child: MaterialApp(
            locale: const Locale('en'),
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            theme: AppTheme.light,
            home: const PassengerAssistantScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(
        find.byKey(const ValueKey('assistantConfirmSearch')),
      );
      await tester.tap(find.byKey(const ValueKey('assistantConfirmSearch')));
      await tester.pumpAndSettle();
      expect(controller.searched, isNull);
      expect(find.text('Choose a route to continue.'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('assistantRouteField')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Bethlehem → Hebron').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('assistantConfirmSearch')));
      await tester.pumpAndSettle();
      expect(controller.searched?.serviceRouteId, 'route-bth-heb');
      expect(controller.searched?.pickupDetails, 'Somewhere');
    });
  });

  group('send parcel screen', () {
    testWidgets('sends the route, the places, the time and the receiver', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1000, 3000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repository = _ParcelRepository();
      final storage = MemoryBookingStorage();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authControllerProvider.overrideWith(_SignedIn.new),
            operatingRoutesProvider.overrideWith(
              (ref) async => testOperatingRoutes(),
            ),
            passengerParcelRepositoryProvider.overrideWithValue(repository),
            passengerParcelMutationRunnerProvider.overrideWithValue(
              CanonicalMutationRunner(storage: storage),
            ),
          ],
          child: MaterialApp(
            locale: const Locale('en'),
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            home: const SendParcelScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Nothing is sent until the form is complete.
      await tester.tap(find.byKey(const ValueKey('submitPassengerParcel')));
      await tester.pumpAndSettle();
      expect(repository.payloads, isEmpty);
      expect(find.text('Choose a route to continue.'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('parcelRouteField')));
      await tester.pumpAndSettle();
      await tester.tap(find.text(_hebronToBethlehem).last);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('parcelPickupDetails')),
        'The shop next to Ibn Rushd roundabout',
      );
      await tester.enterText(
        find.byKey(const ValueKey('parcelDropoffDetails')),
        'Receiver house near the Church of the Nativity',
      );
      await tester.tap(find.text('M'));
      await tester.enterText(
        find.byKey(const ValueKey('receiverName')),
        'Sami',
      );
      await tester.enterText(
        find.byKey(const ValueKey('receiverPhone')),
        '+970591234567',
      );
      await tester.enterText(find.byKey(const ValueKey('parcelNote')), 'Glass');
      await tester.tap(find.byKey(const ValueKey('forbiddenItemsAck')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('submitPassengerParcel')));
      await tester.pumpAndSettle();

      final body = repository.payloads.single;
      expect(body.keys.toSet(), {
        'service_route_id',
        'pickup_details',
        'dropoff_details',
        'preferred_time',
        'size',
        'receiver_name',
        'receiver_phone',
        'forbidden_items_acknowledged',
        'note',
      });
      expect(body['service_route_id'], 'route-heb-bth');
      expect(body['pickup_details'], 'The shop next to Ibn Rushd roundabout');
      expect(
        body['dropoff_details'],
        'Receiver house near the Church of the Nativity',
      );
      expect(body['size'], 'M');
      expect(body['receiver_name'], 'Sami');
      expect(body['receiver_phone'], '+970591234567');
      expect(body['forbidden_items_acknowledged'], isTrue);
      expect(body['note'], 'Glass');
      expect(
        DateTime.parse(
          body['preferred_time'] as String,
        ).isAfter(DateTime.now()),
        isTrue,
      );
      expect(repository.keys.single, isNotEmpty);
      expect(find.text('Your parcel request was recorded.'), findsOneWidget);
    });
  });

  group('passenger home', () {
    testWidgets(
      'names an open request by its route and always offers parcels',
      (tester) async {
        tester.view.physicalSize = const Size(1000, 2400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authControllerProvider.overrideWith(_SignedIn.new),
              passengerDashboardProvider.overrideWith(_Dashboard.new),
              unreadNotificationCountProvider.overrideWithValue(0),
            ],
            child: MaterialApp(
              locale: const Locale('en'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              // Inside the passenger shell, as in the app.
              home: const Scaffold(
                body: PassengerTheme(child: PassengerHomeScreen()),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text(_hebronToBethlehem), findsOneWidget);
        expect(find.textContaining('Near the PPU main gate'), findsOneWidget);
        // No feature flag: the parcel entry is always there.
        expect(
          find.byKey(const ValueKey('openPassengerParcels')),
          findsOneWidget,
        );
      },
    );
  });

  group('welcome screen', () {
    testWidgets('lists a few active routes and how many more there are', (
      tester,
    ) async {
      final many = parseOperatingRoutes({
        'routes': [
          for (final (index, (from, to)) in const [
            ('Hebron', 'Bethlehem'),
            ('Bethlehem', 'Hebron'),
            ('Hebron', 'Ramallah'),
            ('Ramallah', 'Hebron'),
            ('Nablus', 'Jenin'),
            ('Jenin', 'Nablus'),
          ].indexed)
            {
              'id': 'route-$index',
              'route_key': '${from.toLowerCase()}-to-${to.toLowerCase()}',
              'name_ar': '$from ar',
              'name_en': '$from → $to',
              'origin': cityJson('c-$from', from, from, 31.5, 35.1),
              'destination': cityJson('c-$to', to, to, 31.7, 35.2),
            },
        ],
      });
      await _pumpWelcome(tester, (_) async => many);
      expect(find.text('Routes we serve'), findsOneWidget);
      expect(find.text(_hebronToBethlehem), findsOneWidget);
      expect(find.text('Ramallah → Hebron'), findsOneWidget);
      expect(find.text('Nablus → Jenin'), findsNothing);
      expect(find.text('+2 more'), findsOneWidget);
    });

    testWidgets('shows the Arabic route names', (tester) async {
      await _pumpWelcome(
        tester,
        (_) async => testOperatingRoutes(),
        locale: const Locale('ar'),
      );
      expect(find.text('المسارات التي نخدمها'), findsOneWidget);
      expect(find.text('الخليل ← بيت لحم'), findsOneWidget);
      expect(find.byKey(const ValueKey('welcomeRoutesMore')), findsNothing);
    });

    testWidgets('stays calm offline', (tester) async {
      await _pumpWelcome(
        tester,
        (_) async => throw http.ClientException('offline'),
      );
      expect(
        find.text("The routes will appear once you're connected."),
        findsOneWidget,
      );
    });
  });
}

Map<String, dynamic> _requestJson({required bool withRoute}) => {
  'id': 'route-request',
  'status': 'pending',
  'pickup_label': withRoute ? 'Hebron' : 'PPU Main Gate',
  'pickup_lat': 31.5326,
  'pickup_lng': 35.0998,
  'destination_label': withRoute ? 'Bethlehem' : 'Bethlehem Center',
  'destination_lat': 31.7054,
  'destination_lng': 35.2024,
  'preferred_time': '2030-01-02T12:00:00.000Z',
  'passenger_count': 1,
  'created_at': '2030-01-01T12:00:00.000Z',
  'service_route_id': withRoute ? 'route-heb-bth' : null,
  'route_name_ar': withRoute ? 'الخليل ← بيت لحم' : null,
  'route_name_en': withRoute ? _hebronToBethlehem : null,
  'pickup_details': withRoute ? 'Near the PPU main gate' : null,
  'dropoff_details': withRoute ? 'Bethlehem bus station' : null,
};

Map<String, dynamic> _matchResponse() => {
  'match': {
    'id': 'route-match',
    'status': 'proposed',
    'score': 0.8,
    'explanation': 'Same route',
    'passenger_request': {'id': 'route-request'},
    'driver_route': {
      'id': 'driver-route',
      'origin_label': 'Hebron',
      'destination_label': 'Bethlehem',
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

http.Response _utf8Json(Object body, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Future<void> _chooseRoute(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('passengerRouteField')));
  await tester.pumpAndSettle();
  await tester.tap(find.text(_hebronToBethlehem).last);
  await tester.pumpAndSettle();
}

Future<void> _pumpCreate(
  WidgetTester tester, {
  Future<List<OperatingRoute>> Function(Ref ref)? routes,
  Future<http.Response> Function(http.Request request)? handler,
  bool preserveStorage = false,
  Locale locale = const Locale('en'),
  // Loading-state tests keep the route list pending; settling would wait on
  // its spinner forever.
  bool settle = true,
}) async {
  tester.view.physicalSize = const Size(1000, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  SharedPreferences.setMockInitialValues({});
  if (!preserveStorage) FlutterSecureStorage.setMockInitialValues({});
  final client = TestAuthenticatedClient(
    handler: handler ?? (_) async => http.Response('{}', 404),
  );
  final actor = AuthenticatedActorBinding()..bind('passenger-fixture');
  final router = GoRouter(
    initialLocation: '/create',
    routes: [
      GoRoute(path: '/create', builder: (_, _) => const CreateRequestScreen()),
      GoRoute(
        path: '/passenger/request/:id',
        builder: (_, state) =>
            Scaffold(body: Text('Saved ${state.pathParameters['id']}')),
      ),
      GoRoute(
        path: '/passenger/match/:id',
        builder: (_, _) => const Scaffold(body: Text('Matched')),
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    ProviderScope(
      // A failed read shows its error at once instead of retrying.
      retry: (_, _) => null,
      overrides: [
        authenticatedActorBindingProvider.overrideWithValue(actor),
        passengerRepositoryProvider.overrideWithValue(
          PassengerRepository(apiClient: client.client),
        ),
        authenticatedApiClientProvider.overrideWithValue(client.client),
        operatingRoutesProvider.overrideWith(
          routes ?? (ref) async => testOperatingRoutes(),
        ),
      ],
      child: MaterialApp.router(
        routerConfig: router,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
      ),
    ),
  );
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
    await tester.pump();
  }
}

Future<void> _pumpDetail(
  WidgetTester tester,
  Map<String, dynamic> request, {
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = const Size(1000, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  SharedPreferences.setMockInitialValues({});
  FlutterSecureStorage.setMockInitialValues({});
  final client = TestAuthenticatedClient(
    handler: (http.Request call) async {
      if (call.url.path.endsWith('/passenger/requests/${request['id']}')) {
        return _utf8Json({'request': request});
      }
      if (call.url.path.endsWith('/trips')) {
        return http.Response('{"trips":[]}', 200);
      }
      return http.Response('{"matches":[]}', 200);
    },
  );
  final actor = AuthenticatedActorBinding()..bind('passenger-fixture');
  final router = GoRouter(
    initialLocation: '/passenger/request/${request['id']}',
    routes: [
      GoRoute(
        path: '/passenger/request/:id',
        builder: (_, state) =>
            RequestDetailScreen(requestId: state.pathParameters['id']!),
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authenticatedActorBindingProvider.overrideWithValue(actor),
        passengerRepositoryProvider.overrideWithValue(
          PassengerRepository(apiClient: client.client),
        ),
        authenticatedApiClientProvider.overrideWithValue(client.client),
      ],
      child: MaterialApp.router(
        routerConfig: router,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _pumpWelcome(
  WidgetTester tester,
  Future<List<OperatingRoute>> Function(Ref ref) routes, {
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = const Size(1000, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      retry: (_, _) => null,
      overrides: [operatingRoutesProvider.overrideWith(routes)],
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const WelcomeScreen(config: demoTestAppConfig),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _CapturingAssistantController extends PassengerAssistantController {
  _CapturingAssistantController(this.value);

  final PassengerAssistantState value;
  PassengerAssistantTripDraft? searched;

  @override
  Future<PassengerAssistantState> build() async => value;

  @override
  Future<void> confirmAndSearch(PassengerAssistantTripDraft draft) async {
    searched = draft;
  }
}

class _SignedIn extends AuthController {
  @override
  Future<AuthState> build() async => const AuthState.authenticated(
    AuthUser(
      id: 'passenger-fixture',
      name: 'Passenger',
      role: UserRole.passenger,
      demoAccount: false,
    ),
  );
}

class _ParcelRepository implements PassengerParcelRepository {
  final payloads = <Map<String, dynamic>>[];
  final keys = <String>[];

  @override
  AuthenticatedApiClient get apiClient => throw UnimplementedError();

  @override
  Future<List<PassengerParcel>> list() async => const [];

  @override
  Future<PassengerParcel> create({
    required Map<String, dynamic> payload,
    required String idempotencyKey,
  }) async {
    payloads.add(payload);
    keys.add(idempotencyKey);
    return PassengerParcel.fromJson({
      'id': 'parcel-1',
      'tracking_state': 'searching',
      'size': payload['size'],
      'pickup_label': 'Hebron',
      'dropoff_label': 'Bethlehem',
      'pickup_details': payload['pickup_details'],
      'dropoff_details': payload['dropoff_details'],
      'service_route_id': payload['service_route_id'],
      'route_name_en': _hebronToBethlehem,
      'can_cancel': true,
      'created_at': DateTime.now().toUtc().toIso8601String(),
    });
  }

  @override
  Future<PassengerParcel> cancel(String id) => throw UnimplementedError();
}

class _Dashboard extends PassengerDashboardController {
  @override
  Future<PassengerDashboardState> build() async => PassengerDashboardState(
    activeRequests: [PassengerRequest.fromJson(_requestJson(withRoute: true))],
    trips: const [],
  );
}
