import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';
import 'package:masari_mobile/core/widgets/masari_map.dart';
import 'package:masari_mobile/features/auth/application/auth_actor_binding.dart';
import 'package:masari_mobile/features/auth/data/authenticated_api_client.dart';
import 'package:masari_mobile/features/assistant/data/passenger_assistant_repository.dart';
import 'package:masari_mobile/features/assistant/domain/passenger_assistant_models.dart';
import 'package:masari_mobile/features/canonical_routes/data/canonical_operation_storage.dart';
import 'package:masari_mobile/features/passenger/application/legacy_passenger_request_mutation.dart';
import 'package:masari_mobile/features/passenger/data/passenger_request_selection_storage.dart';
import 'package:masari_mobile/features/passenger/data/passenger_repository.dart';
import 'package:masari_mobile/features/passenger/presentation/create_request_screen.dart';
import 'package:masari_mobile/features/passenger/presentation/request_detail_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/auth_test_support.dart';

void main() {
  testWidgets(
    'direct request detail cannot lose selection after confirmed create pin write fails',
    (tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      final saved = {
        'id': 'pin-pending-request',
        'status': 'pending',
        'pickup_label': 'Origin',
        'pickup_lat': 31.5,
        'pickup_lng': 35.1,
        'destination_label': 'Destination',
        'destination_lat': 31.7,
        'destination_lng': 35.2,
        'preferred_time': '2030-01-02T12:00:00.000Z',
        'passenger_count': 1,
        'created_at': DateTime.now().toUtc().toIso8601String(),
      };
      final mutation = LegacyPassengerRequestMutation(
        storage: CanonicalOperationStorage(
          const FlutterSecureStorage(),
          storageKey: 'masari_legacy_passenger_create_v1',
        ),
        currentActor: () => 'passenger-fixture',
        selectionStorage: _FailedSelectionStorage(),
      );
      await expectLater(
        mutation.create(
          payload: {...saved}
            ..remove('id')
            ..remove('status')
            ..remove('created_at'),
          recoveryContext: const {
            'option': {'id': 'selected-route'},
          },
          send: (_, _, _) async => {'request': saved},
        ),
        throwsStateError,
      );
      expect(await mutation.pending(), isNotNull);
      var matchingCalls = 0;
      await _pump(
        tester,
        (request) async {
          if (request.url.path.endsWith(
            '/passenger/requests/pin-pending-request',
          )) {
            return http.Response(jsonEncode({'request': saved}), 200);
          }
          if (request.url.path.endsWith('/matches/run')) {
            matchingCalls++;
            return http.Response(
              jsonEncode(_matchResponse('alternative-route')),
              201,
            );
          }
          if (request.url.path.endsWith('/trips')) {
            return http.Response('{"trips":[]}', 200);
          }
          return http.Response('{"matches":[]}', 200);
        },
        preserveStorage: true,
        detailRequestId: 'pin-pending-request',
      );
      await tester.tap(
        find.widgetWithText(FilledButton, 'Find compatible route'),
      );
      await tester.pumpAndSettle();
      expect(matchingCalls, 0);
      expect(find.text('Matched'), findsNothing);
      expect(await mutation.pending(), isNotNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
  testWidgets(
    'unavailable selected route is reported without matching an alternative',
    (tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      var createCalls = 0;
      Map<String, dynamic>? savedRequest;
      final routes = <Object?>[];
      Future<http.Response> handler(http.Request request) async {
        if (request.url.path.endsWith('/passenger/requests')) {
          createCalls++;
          savedRequest ??= {
            ...jsonDecode(request.body) as Map<String, dynamic>,
            'id': 'unavailable-request',
            'status': 'pending',
            'created_at': DateTime.now().toUtc().toIso8601String(),
          };
          if (createCalls == 1) {
            throw http.ClientException('saved response lost');
          }
          return http.Response(
            jsonEncode({
              'request': {
                ...jsonDecode(request.body) as Map,
                'id': 'unavailable-request',
              },
            }),
            200,
          );
        }
        if (request.url.path.endsWith('/matches/run')) {
          routes.add((jsonDecode(request.body) as Map)['driverRouteId']);
          if ((jsonDecode(request.body) as Map)['driverRouteId'] == null) {
            return http.Response(
              jsonEncode(_matchResponse('alternative-route')),
              201,
            );
          }
          return http.Response(
            '{"error":"selected_driver_route_unavailable"}',
            409,
          );
        }
        if (request.url.path.endsWith(
          '/passenger/requests/unavailable-request',
        )) {
          return http.Response(jsonEncode({'request': savedRequest}), 200);
        }
        if (request.url.path.endsWith('/trips')) {
          return http.Response('{"trips":[]}', 200);
        }
        return http.Response('{"matches":[]}', 200);
      }

      final mutation = LegacyPassengerRequestMutation(
        storage: CanonicalOperationStorage(
          const FlutterSecureStorage(),
          storageKey: 'masari_legacy_passenger_create_v1',
        ),
        currentActor: () => 'passenger-fixture',
      );
      final assistant = ApiPassengerAssistantRepository(
        apiClient: TestAuthenticatedClient(handler: handler).client,
        mutation: mutation,
      );
      await expectLater(
        assistant.selectTrip(
          draft: PassengerAssistantTripDraft(
            pickupKey: 'bab_al_zawiya',
            pickupLabel: 'Origin',
            destinationKey: 'bethlehem',
            destinationLabel: 'Destination',
            preferredTime: DateTime.utc(2030, 1, 2),
            passengerCount: 1,
          ),
          option: const PassengerAssistantTripOption(
            id: 'unavailable-route',
            driverName: 'Selected',
            fromLabel: 'Origin',
            toLabel: 'Destination',
            seatsAvailable: 2,
            score: 0.8,
          ),
        ),
        throwsA(anything),
      );
      await _pump(tester, handler, preserveStorage: true);
      expect(routes, ['unavailable-route']);
      expect(find.text('Saved unavailable-request'), findsOneWidget);
      expect(
        find.text(
          'The selected driver route is no longer available. Please search again.',
        ),
        findsOneWidget,
      );
      expect(await mutation.pending(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await _pump(
        tester,
        handler,
        preserveStorage: true,
        detailRequestId: 'unavailable-request',
      );
      await tester.tap(
        find.widgetWithText(FilledButton, 'Find compatible route'),
      );
      await tester.pumpAndSettle();
      expect(routes, ['unavailable-route', 'unavailable-route']);
      expect(find.text('Matched'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
  for (final failure in ['transport', 'already-matched']) {
    testWidgets(
      'assistant handoff and restart retain the selected route after $failure',
      (tester) async {
        FlutterSecureStorage.setMockInitialValues({});
        final keys = <String>[];
        final selectedRoutes = <Object?>[];
        var loseCreate = true;
        var loseMatch = true;
        Map<String, dynamic>? saved;
        Future<http.Response> handler(http.Request request) async {
          if (request.url.path.endsWith('/passenger/requests')) {
            keys.add(request.headers['idempotency-key']!);
            saved ??= {
              ...jsonDecode(request.body) as Map<String, dynamic>,
              'id': 'selected-request',
              'status': 'pending',
              'created_at': DateTime.now().toUtc().toIso8601String(),
            };
            if (loseCreate) {
              loseCreate = false;
              throw http.ClientException('create response lost after commit');
            }
            return http.Response(jsonEncode({'request': saved}), 200);
          }
          if (request.url.path.endsWith('/matches/run')) {
            selectedRoutes.add(
              (jsonDecode(request.body) as Map)['driverRouteId'],
            );
            if (loseMatch) {
              loseMatch = false;
              if (failure == 'already-matched') {
                return http.Response(
                  '{"error":"passenger_request_already_matched"}',
                  409,
                );
              }
              throw http.ClientException('match response lost');
            }
            return http.Response(
              jsonEncode(_matchResponse('selected-route')),
              201,
            );
          }
          return http.Response('{"matches":[]}', 200);
        }

        final mutation = LegacyPassengerRequestMutation(
          storage: CanonicalOperationStorage(
            const FlutterSecureStorage(),
            storageKey: 'masari_legacy_passenger_create_v1',
          ),
          currentActor: () => 'passenger-fixture',
        );
        final assistant = ApiPassengerAssistantRepository(
          apiClient: TestAuthenticatedClient(handler: handler).client,
          mutation: mutation,
        );
        await expectLater(
          assistant.selectTrip(
            draft: PassengerAssistantTripDraft(
              pickupKey: 'bab_al_zawiya',
              pickupLabel: 'Bab Al-Zawiya',
              destinationKey: 'bethlehem',
              destinationLabel: 'Bethlehem Center',
              preferredTime: DateTime.utc(2030, 1, 2),
              passengerCount: 1,
            ),
            option: const PassengerAssistantTripOption(
              id: 'selected-route',
              driverName: 'Chosen driver',
              fromLabel: 'Origin',
              toLabel: 'Destination',
              seatsAvailable: 2,
              score: 0.8,
            ),
          ),
          throwsA(anything),
        );
        // Recreate the ordinary screen with only durable storage from the assistant.
        await _pump(tester, handler, preserveStorage: true);
        expect(selectedRoutes, ['selected-route']);
        expect(find.text('Verify booking'), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
        await _pump(tester, handler, preserveStorage: true);
        expect(selectedRoutes, ['selected-route', 'selected-route']);
        expect(find.text('Matched'), findsOneWidget);
        expect(keys.toSet(), hasLength(1));
        expect(saved!['id'], 'selected-request');
        expect(await mutation.pending(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }
  testWidgets(
    'lost create response recovers after reopening using the same durable identity',
    (tester) async {
      final saved = <String, Map<String, dynamic>>{};
      final keys = <String>[];
      var loseResponse = true;
      Future<http.Response> handler(http.Request request) async {
        if (!request.url.path.endsWith('/passenger/requests')) {
          return http.Response('{"error":"no_compatible_driver"}', 409);
        }
        final key = request.headers['idempotency-key'] ?? '';
        keys.add(key);
        final result = saved.putIfAbsent(
          key,
          () => {
            ...jsonDecode(request.body) as Map<String, dynamic>,
            'id': 'durable-request',
            'status': 'pending',
            'created_at': DateTime.now().toUtc().toIso8601String(),
          },
        );
        if (loseResponse) {
          loseResponse = false;
          throw http.ClientException('response lost after commit');
        }
        return http.Response(jsonEncode({'request': result}), 201);
      }

      await _pump(tester, handler);
      await _select(
        tester,
        'اختاري موقع الانطلاق',
        'Saved origin',
        const LatLng(31.72, 35.21),
      );
      await _select(
        tester,
        'اختاري الوجهة',
        'Saved destination',
        const LatLng(32.21, 35.29),
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Submit request'));
      await tester.pumpAndSettle();
      expect(find.text('Verify booking'), findsOneWidget);
      expect(keys.single, isNotEmpty);
      expect(
        tester
            .widget<DropdownButtonFormField<int>>(
              find.byType(DropdownButtonFormField<int>),
            )
            .onChanged,
        isNull,
      );
      await tester.pumpWidget(const SizedBox.shrink());
      await _pump(tester, handler, preserveStorage: true);
      await tester.pumpAndSettle();
      expect(find.text('Saved durable-request'), findsOneWidget);
      expect(saved.length, 1);
      expect(keys, [keys.first, keys.first]);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
  testWidgets('a time earlier today is rejected before a request is sent', (
    tester,
  ) async {
    var calls = 0;
    await _pump(tester, (request) async {
      if (request.url.path.endsWith('/passenger/requests')) {
        calls++;
        return http.Response(
          jsonEncode({
            'request': {
              ...jsonDecode(request.body) as Map<String, dynamic>,
              'id': 'past-request',
              'status': 'pending',
              'created_at': DateTime.now().toUtc().toIso8601String(),
            },
          }),
          201,
        );
      }
      return http.Response('{"error":"no_compatible_driver"}', 409);
    });
    await _select(
      tester,
      'اختاري موقع الانطلاق',
      'Origin square',
      const LatLng(31.72, 35.21),
    );
    await _select(
      tester,
      'اختاري الوجهة',
      'Destination station',
      const LatLng(32.21, 35.29),
    );
    await tester.tap(find.byIcon(Icons.schedule_rounded));
    await tester.pumpAndSettle();
    // The form's initial time is tomorrow near midnight. Select today
    // explicitly so this regression always exercises a past timestamp.
    final now = DateTime.now();
    tester
        .widget<CalendarDatePicker>(find.byType(CalendarDatePicker))
        .onDateChanged(DateTime(now.year, now.month, now.day));
    await tester.pump();
    await tester.tap(find.text('OK').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.keyboard_outlined));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '00');
    await tester.enterText(find.byType(TextField).last, '00');
    await tester.tap(find.text('OK').last);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Submit request'));
    await tester.pumpAndSettle();
    expect(calls, 0);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'foreground resume verifies an uncertain saved booking with its original key',
    (tester) async {
      final keys = <String>[];
      Map<String, dynamic>? saved;
      await _pump(tester, (request) async {
        if (!request.url.path.endsWith('/passenger/requests')) {
          return http.Response('{"error":"no_compatible_driver"}', 409);
        }
        keys.add(request.headers['idempotency-key']!);
        saved ??= {
          ...jsonDecode(request.body) as Map<String, dynamic>,
          'id': 'resume-request',
          'status': 'pending',
          'created_at': DateTime.now().toUtc().toIso8601String(),
        };
        if (keys.length == 1) throw http.ClientException('response lost');
        return http.Response(jsonEncode({'request': saved}), 200);
      });
      await _select(
        tester,
        'اختاري موقع الانطلاق',
        'Origin',
        const LatLng(31.72, 35.21),
      );
      await _select(
        tester,
        'اختاري الوجهة',
        'Destination',
        const LatLng(32.21, 35.29),
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Submit request'));
      await tester.pumpAndSettle();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.text('Saved resume-request'), findsOneWidget);
      expect(keys, [keys.first, keys.first]);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('two rapid submit events persist only one named request', (
    tester,
  ) async {
    final response = Completer<http.Response>();
    var calls = 0;
    Map<String, dynamic>? body;
    await _pump(tester, (request) async {
      if (request.url.path.endsWith('/passenger/requests')) {
        calls++;
        body = jsonDecode(request.body) as Map<String, dynamic>;
        return response.future;
      }
      return http.Response('{"error":"no_compatible_driver"}', 409);
    });
    await _select(
      tester,
      'اختاري موقع الانطلاق',
      'Origin square',
      const LatLng(31.72, 35.21),
    );
    await _select(
      tester,
      'اختاري الوجهة',
      'Destination station',
      const LatLng(32.21, 35.29),
    );
    final submit = tester
        .widget<FilledButton>(
          find.widgetWithText(FilledButton, 'Submit request'),
        )
        .onPressed!;
    submit();
    submit();
    await tester.pump();
    try {
      expect(calls, 1);
    } finally {
      response.complete(
        http.Response(
          jsonEncode({
            'request': {
              ...body!,
              'id': 'saved-request',
              'status': 'pending',
              'created_at': DateTime.now().toUtc().toIso8601String(),
            },
          }),
          201,
        ),
      );
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox.shrink());
    }
  });
}

Map<String, dynamic> _matchResponse(String routeId) => {
  'match': {
    'id': 'selected-match',
    'status': 'proposed',
    'score': 0.8,
    'explanation': 'Selected route',
    'passenger_request': {'id': 'selected-request'},
    'driver_route': {
      'id': routeId,
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

class _FailedSelectionStorage extends PassengerRequestSelectionStorage {
  _FailedSelectionStorage() : super(const FlutterSecureStorage());
  @override
  Future<void> save(String actorId, String requestId, String routeId) async {
    throw StateError('secure selection write failed');
  }
}

Future<void> _pump(
  WidgetTester tester,
  Future<http.Response> Function(http.Request) handler, {
  bool preserveStorage = false,
  String? detailRequestId,
}) async {
  tester.view.physicalSize = const Size(1000, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  SharedPreferences.setMockInitialValues({});
  if (!preserveStorage) FlutterSecureStorage.setMockInitialValues({});
  final client = TestAuthenticatedClient(handler: handler);
  final actor = AuthenticatedActorBinding()..bind('passenger-fixture');
  final router = GoRouter(
    initialLocation: detailRequestId == null
        ? '/create'
        : '/passenger/request/$detailRequestId',
    routes: [
      GoRoute(path: '/create', builder: (_, _) => const CreateRequestScreen()),
      GoRoute(
        path: '/passenger/request/:id',
        builder: (_, state) => detailRequestId == null
            ? Scaffold(body: Text('Saved ${state.pathParameters['id']}'))
            : RequestDetailScreen(requestId: state.pathParameters['id']!),
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
      overrides: [
        authenticatedActorBindingProvider.overrideWithValue(actor),
        passengerRepositoryProvider.overrideWithValue(
          PassengerRepository(apiClient: client.client),
        ),
        authenticatedApiClientProvider.overrideWithValue(client.client),
      ],
      child: MaterialApp.router(
        routerConfig: router,
        locale: const Locale('en'),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
          child: child!,
        ),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _select(
  WidgetTester tester,
  String prompt,
  String name,
  LatLng point,
) async {
  await tester.tap(find.text(prompt));
  await tester.pumpAndSettle();
  tester.widget<MasariMap>(find.byType(MasariMap).last).onTap!(point);
  await tester.pump();
  await tester.enterText(find.byType(TextField), name);
  await tester.tap(find.text('تأكيد الموقع'));
  await tester.pumpAndSettle();
}
