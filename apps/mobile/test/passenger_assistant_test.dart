import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/core/theme/app_theme.dart';
import 'package:masari_mobile/features/assistant/application/passenger_assistant_controller.dart';
import 'package:masari_mobile/features/assistant/data/passenger_assistant_repository.dart';
import 'package:masari_mobile/features/assistant/domain/passenger_assistant_models.dart';
import 'package:masari_mobile/features/assistant/presentation/passenger_assistant_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import 'support/auth_test_support.dart';
import 'support/booking_recovery_test_support.dart';

void main() {
  group('assistant repository', () {
    test(
      'retries matching the saved request without creating a second booking',
      () async {
        var creates = 0;
        final matchedRequests = <String>[];
        final auth = TestAuthenticatedClient(
          handler: (request) async {
            if (request.url.path == '/api/v1/passenger/requests') {
              creates++;
              return http.Response('{"request":{"id":"saved_request"}}', 201);
            }
            if (request.url.path == '/api/v1/matches/run') {
              matchedRequests.add(
                jsonDecode(request.body)['passengerRequestId'] as String,
              );
              return matchedRequests.length == 1
                  ? http.Response('{"error":"no_compatible_driver_route"}', 409)
                  : http.Response('{"match":{"id":"match_1"}}', 200);
            }
            return http.Response('{}', 404);
          },
        );
        final repository = ApiPassengerAssistantRepository(
          apiClient: auth.client,
          mutation: testBookingMutation(),
        );
        final draft = PassengerAssistantTripDraft(
          pickupKey: 'bab_al_zawiya',
          pickupLabel: 'Bab Al-Zawiya',
          destinationKey: 'bethlehem',
          destinationLabel: 'Bethlehem Center',
          preferredTime: DateTime.utc(2030, 1, 2, 12),
          passengerCount: 1,
        );
        const option = PassengerAssistantTripOption(
          id: 'route_1',
          driverName: 'Driver',
          fromLabel: 'Bab Al-Zawiya',
          toLabel: 'Bethlehem Center',
          seatsAvailable: 2,
          score: 0.9,
        );
        await expectLater(
          repository.selectTrip(draft: draft, option: option),
          throwsA(isA<ApiException>()),
        );
        expect(
          await repository.selectTrip(draft: draft.copyWith(), option: option),
          'match_1',
        );
        expect(creates, 1);
        expect(matchedRequests, ['saved_request', 'saved_request']);
      },
    );
    test(
      'searches real routes, then creates a request for the selected route',
      () async {
        final requests = <http.Request>[];
        final auth = TestAuthenticatedClient(
          handler: (request) async {
            requests.add(request);
            if (request.url.path == '/api/v1/matches/search') {
              return http.Response(
                jsonEncode({
                  'results': [
                    {
                      'id': 'route_1',
                      'origin_label': 'Bab Al-Zawiya',
                      'destination_label': 'Bethlehem Center',
                      'departure_at': '2030-01-02T12:30:00.000Z',
                      'seats_available': 3,
                      'score': 0.91,
                      'driver': {
                        'name': 'Driver One',
                        'vehicle_type': 'Sedan',
                        'trust_score': 96,
                      },
                    },
                  ],
                }),
                200,
                headers: {'content-type': 'application/json; charset=utf-8'},
              );
            }
            if (request.url.path == '/api/v1/passenger/requests') {
              return http.Response(
                jsonEncode({
                  'request': {'id': 'request_1'},
                }),
                201,
                headers: {'content-type': 'application/json; charset=utf-8'},
              );
            }
            if (request.url.path == '/api/v1/matches/run') {
              return http.Response(
                jsonEncode({
                  'match': {'id': 'match_1'},
                }),
                201,
                headers: {'content-type': 'application/json; charset=utf-8'},
              );
            }
            return http.Response('{}', 404);
          },
        );
        final repository = ApiPassengerAssistantRepository(
          apiClient: auth.client,
          mutation: testBookingMutation(),
        );
        final draft = PassengerAssistantTripDraft(
          pickupKey: 'bab_al_zawiya',
          pickupLabel: 'Bab Al-Zawiya',
          destinationKey: 'bethlehem',
          destinationLabel: 'Bethlehem Center',
          preferredTime: DateTime.utc(2030, 1, 2, 12),
          passengerCount: 2,
        );

        final options = await repository.searchTrips(draft);
        final matchId = await repository.selectTrip(
          draft: draft,
          option: options.single,
        );

        expect(matchId, 'match_1');
        expect(options.single.driverName, 'Driver One');
        expect(options.single.score, 0.91);
        expect(requests, hasLength(3));
        expect(requests[0].url.path, '/api/v1/matches/search');
        expect(jsonDecode(requests[0].body), {
          'pickup_label': 'Bab Al-Zawiya',
          'pickup_lat': 31.5326,
          'pickup_lng': 35.0998,
          'destination_label': 'Bethlehem Center',
          'destination_lat': 31.7054,
          'destination_lng': 35.2024,
          'preferred_time': '2030-01-02T12:00:00.000Z',
          'passenger_count': 2,
        });
        expect(requests[1].url.path, '/api/v1/passenger/requests');
        expect(jsonDecode(requests[1].body), {
          'pickup_label': 'Bab Al-Zawiya',
          'pickup_lat': 31.5326,
          'pickup_lng': 35.0998,
          'destination_label': 'Bethlehem Center',
          'destination_lat': 31.7054,
          'destination_lng': 35.2024,
          'preferred_time': '2030-01-02T12:00:00.000Z',
          'passenger_count': 2,
        });
        expect(requests[2].url.path, '/api/v1/matches/run');
        expect(jsonDecode(requests[2].body), {
          'passengerRequestId': 'request_1',
          'driverRouteId': 'route_1',
        });
      },
    );

    test(
      'sends an authenticated localized message and parses clarification',
      () async {
        late Map<String, dynamic> requestBody;
        final auth = TestAuthenticatedClient(
          handler: (request) async {
            expect(request.method, 'POST');
            expect(request.url.path, '/api/v1/passenger/assistant/messages');
            expect(
              request.headers['authorization'],
              'Bearer test-access-token',
            );
            requestBody = jsonDecode(request.body) as Map<String, dynamic>;
            return http.Response(
              jsonEncode({
                'status': 'clarification',
                'question': 'أي يوم تقصد؟',
                'suggestions': ['اليوم', 'غداً'],
                'conversation_id': 'conversation_1',
              }),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          },
        );
        final repository = ApiPassengerAssistantRepository(
          apiClient: auth.client,
        );

        final reply = await repository.ask(
          message: 'متى الرحلة؟',
          locale: 'ar',
          history: const [],
        );

        expect(requestBody, {
          'message': 'متى الرحلة؟',
          'locale': 'ar',
          'history': <dynamic>[],
        });
        expect(reply.type, PassengerAssistantReplyType.clarification);
        expect(reply.message, 'أي يوم تقصد؟');
        expect(reply.suggestions, ['اليوم', 'غداً']);
        expect(reply.conversationId, 'conversation_1');
      },
    );

    test('rejects a response that is not clarification or a final result', () {
      expect(
        () => PassengerAssistantReply.fromJson({
          'status': 'processing',
          'message': 'placeholder',
        }),
        throwsFormatException,
      );
    });
  });

  group('assistant controller', () {
    test(
      'moves through processing, clarification, and real result states',
      () async {
        final repository = _ControlledAssistantRepository();
        final container = ProviderContainer(
          overrides: [
            passengerAssistantRepositoryProvider.overrideWithValue(repository),
          ],
        );
        addTearDown(container.dispose);
        await container.read(passengerAssistantControllerProvider.future);
        final controller = container.read(
          passengerAssistantControllerProvider.notifier,
        );

        final clarification = Completer<PassengerAssistantReply>();
        repository.next = clarification;
        final firstRequest = controller.submit('متى رحلتي؟', locale: 'ar');
        expect(
          container.read(passengerAssistantControllerProvider).value?.phase,
          PassengerAssistantPhase.processing,
        );
        clarification.complete(
          const PassengerAssistantReply(
            type: PassengerAssistantReplyType.clarification,
            message: 'أي يوم تقصد؟',
            conversationId: 'conversation_1',
            suggestions: ['غداً'],
          ),
        );
        await firstRequest;

        final clarified = container
            .read(passengerAssistantControllerProvider)
            .requireValue;
        expect(clarified.phase, PassengerAssistantPhase.clarification);
        expect(clarified.messages.last.text, 'أي يوم تقصد؟');

        final result = Completer<PassengerAssistantReply>();
        repository.next = result;
        final secondRequest = controller.submit('غداً', locale: 'ar');
        expect(repository.conversationIds.last, 'conversation_1');
        result.complete(
          const PassengerAssistantReply(
            type: PassengerAssistantReplyType.result,
            message: 'لا توجد رحلة مؤكدة غداً.',
            conversationId: 'conversation_1',
          ),
        );
        await secondRequest;

        final completed = container
            .read(passengerAssistantControllerProvider)
            .requireValue;
        expect(completed.phase, PassengerAssistantPhase.result);
        expect(completed.messages.last.text, 'لا توجد رحلة مؤكدة غداً.');
      },
    );

    test(
      'does not add an assistant result when the service is unavailable',
      () async {
        final repository = _ControlledAssistantRepository();
        final container = ProviderContainer(
          overrides: [
            passengerAssistantRepositoryProvider.overrideWithValue(repository),
          ],
        );
        addTearDown(container.dispose);
        await container.read(passengerAssistantControllerProvider.future);
        final failure = Completer<PassengerAssistantReply>();
        repository.next = failure;

        final request = container
            .read(passengerAssistantControllerProvider.notifier)
            .submit('هل توجد رحلة؟', locale: 'ar');
        failure.completeError(
          const ApiException(
            ApiErrorType.unknown,
            'not_found',
            statusCode: 404,
          ),
        );
        await request;

        final state = container
            .read(passengerAssistantControllerProvider)
            .requireValue;
        expect(state.phase, PassengerAssistantPhase.error);
        expect(state.failure, PassengerAssistantFailure.unavailable);
        expect(state.messages, hasLength(1));
        expect(
          state.messages.single.role,
          PassengerAssistantMessageRole.passenger,
        );
      },
    );

    test('keeps backend candidates and selects the chosen route', () async {
      final repository = _ControlledAssistantRepository();
      final container = ProviderContainer(
        overrides: [
          passengerAssistantRepositoryProvider.overrideWithValue(repository),
        ],
      );
      addTearDown(container.dispose);
      await container.read(passengerAssistantControllerProvider.future);
      final controller = container.read(
        passengerAssistantControllerProvider.notifier,
      );
      final draft = _tripDraft();
      final option = _tripOption;
      repository.searchResult = [option];
      repository.next = Completer<PassengerAssistantReply>()
        ..complete(
          PassengerAssistantReply(
            type: PassengerAssistantReplyType.requestReview,
            message: 'راجع المعلومات ثم أكّد لبدء البحث.',
            draft: draft,
          ),
        );

      await controller.submit('ابحث عن رحلة', locale: 'ar');
      // The assistant reply puts the user in the editable review state.
      await controller.confirmAndSearch(draft);

      final results = container
          .read(passengerAssistantControllerProvider)
          .requireValue;
      expect(results.phase, PassengerAssistantPhase.result);
      expect(results.tripOptions, [option]);

      final matchId = await controller.selectTrip(option);
      expect(matchId, 'match_1');
      expect(repository.selectedOption, option);
    });
  });

  group('assistant screen', () {
    testWidgets('shows extracted data in an editable Arabic review card', (
      tester,
    ) async {
      final reviewState = PassengerAssistantState(
        phase: PassengerAssistantPhase.requestReview,
        messages: const [
          PassengerAssistantMessage.passenger(
            'ابحث لي من باب الزاوية إلى بيت لحم الساعة 3 لشخص',
          ),
          PassengerAssistantMessage.assistant(
            'راجع المعلومات ثم أكّد لبدء البحث.',
          ),
        ],
        draft: PassengerAssistantTripDraft(
          pickupKey: 'bab_al_zawiya',
          pickupLabel: 'Bab Al-Zawiya',
          destinationKey: 'bethlehem',
          destinationLabel: 'Bethlehem Center',
          preferredTime: DateTime.now().add(const Duration(days: 1)),
          passengerCount: 1,
        ),
      );
      await tester.pumpWidget(
        _testApp(
          override: passengerAssistantControllerProvider.overrideWith(
            () => _StaticAssistantController(reviewState),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.drag(
        find.byKey(const ValueKey('assistantConversation')),
        const Offset(0, -500),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('assistantExtractedData')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('assistantPickupField')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('assistantDestinationField')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('assistantTimeField')), findsOneWidget);
      expect(
        find.byKey(const ValueKey('assistantPassengerCountField')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('assistantConfirmSearch')),
        findsOneWidget,
      );
      expect(find.text('باب الزاوية'), findsOneWidget);
      expect(find.text('وسط بيت لحم'), findsOneWidget);
    });

    testWidgets('renders Arabic RTL and the ready and loading states', (
      tester,
    ) async {
      final loading = Completer<PassengerAssistantState>();
      await tester.pumpWidget(
        _testApp(
          override: passengerAssistantControllerProvider.overrideWith(
            () => _LoadingAssistantController(loading),
          ),
        ),
      );

      expect(
        find.byKey(const ValueKey('assistantLoadingState')),
        findsOneWidget,
      );
      expect(
        Directionality.of(
          tester.element(find.byKey(const ValueKey('assistantTextInput'))),
        ),
        TextDirection.rtl,
      );

      loading.complete(const PassengerAssistantState());
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('assistantReadyState')), findsOneWidget);
    });

    testWidgets('shows processing, clarification, and result states', (
      tester,
    ) async {
      final repository = _ControlledAssistantRepository();
      await tester.pumpWidget(
        _testApp(
          override: passengerAssistantRepositoryProvider.overrideWithValue(
            repository,
          ),
        ),
      );
      await tester.pumpAndSettle();

      final clarification = Completer<PassengerAssistantReply>();
      repository.next = clarification;
      await tester.enterText(
        find.byKey(const ValueKey('assistantTextInput')),
        'متى رحلتي؟',
      );
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('assistantSendButton')));
      await tester.pump();
      expect(
        find.byKey(const ValueKey('assistantProcessingState')),
        findsOneWidget,
      );

      clarification.complete(
        const PassengerAssistantReply(
          type: PassengerAssistantReplyType.clarification,
          message: 'أي يوم تقصد؟',
          conversationId: 'conversation_1',
          suggestions: ['غداً'],
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('أي يوم تقصد؟'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('assistantClarificationOptions')),
        findsOneWidget,
      );

      final result = Completer<PassengerAssistantReply>();
      repository.next = result;
      await tester.tap(
        find.ancestor(of: find.text('غداً'), matching: find.byType(ActionChip)),
      );
      await tester.pump();
      expect(
        find.byKey(const ValueKey('assistantProcessingState')),
        findsOneWidget,
      );
      result.complete(
        const PassengerAssistantReply(
          type: PassengerAssistantReplyType.result,
          message: 'لا توجد رحلة مؤكدة غداً.',
          conversationId: 'conversation_1',
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('لا توجد رحلة مؤكدة غداً.'), findsOneWidget);
      expect(find.byKey(const ValueKey('assistantErrorState')), findsNothing);
    });

    testWidgets('shows an honest error instead of a fabricated answer', (
      tester,
    ) async {
      final repository = _ControlledAssistantRepository();
      await tester.pumpWidget(
        _testApp(
          override: passengerAssistantRepositoryProvider.overrideWithValue(
            repository,
          ),
        ),
      );
      await tester.pumpAndSettle();

      final failure = Completer<PassengerAssistantReply>();
      repository.next = failure;
      await tester.enterText(
        find.byKey(const ValueKey('assistantTextInput')),
        'هل توجد رحلة؟',
      );
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('assistantSendButton')));
      await tester.pump();
      failure.completeError(
        const ApiException(ApiErrorType.unknown, 'not_found', statusCode: 404),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('assistantErrorState')), findsOneWidget);
      expect(find.byKey(const ValueKey('assistantReply')), findsNothing);
      expect(find.textContaining('لم يتم إنشاء أي نتيجة'), findsOneWidget);
    });

    testWidgets('renders backend trip candidates in the existing offer cards', (
      tester,
    ) async {
      final resultState = PassengerAssistantState(
        phase: PassengerAssistantPhase.result,
        draft: _tripDraft(),
        tripOptions: [_tripOption],
      );
      await tester.pumpWidget(
        _testApp(
          override: passengerAssistantControllerProvider.overrideWith(
            () => _StaticAssistantController(resultState),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('assistantTripResults')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('bookOffer-route_1')), findsOneWidget);
      expect(find.text('Driver One'), findsOneWidget);
      expect(find.text('باب الزاوية'), findsOneWidget);
      expect(find.text('وسط بيت لحم'), findsOneWidget);
    });

    testWidgets('selecting an AI result continues to the match booking flow', (
      tester,
    ) async {
      final resultState = PassengerAssistantState(
        phase: PassengerAssistantPhase.result,
        draft: _tripDraft(),
        tripOptions: [_tripOption],
      );
      await tester.pumpWidget(
        _routerTestApp(
          override: passengerAssistantControllerProvider.overrideWith(
            () => _SelectingAssistantController(resultState, 'match_1'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('bookOffer-route_1')));
      await tester.pumpAndSettle();

      expect(find.text('match: match_1'), findsOneWidget);
    });

    testWidgets(
      'an unknown booking can be verified after its displayed departure passes',
      (tester) async {
        final state = PassengerAssistantState(
          phase: PassengerAssistantPhase.result,
          draft: _tripDraft(),
          selectionFailure: PassengerAssistantFailure.unknownBooking,
          tripOptions: [
            PassengerAssistantTripOption(
              id: 'route_1',
              driverName: 'Driver',
              fromLabel: 'Origin',
              toLabel: 'Destination',
              departureAt: DateTime.now().subtract(const Duration(minutes: 1)),
              seatsAvailable: 1,
              score: 0.9,
            ),
          ],
        );
        await tester.pumpWidget(
          _routerTestApp(
            override: passengerAssistantControllerProvider.overrideWith(
              () => _SelectingAssistantController(state, 'existing'),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final button = tester.widget<FilledButton>(
          find.byKey(const ValueKey('bookOffer-route_1')),
        );
        expect(button.onPressed, isNotNull);
        expect(find.text('التحقق من الحجز'), findsOneWidget);
        await tester.tap(find.byKey(const ValueKey('bookOffer-route_1')));
        await tester.pumpAndSettle();
        expect(find.text('match: existing'), findsOneWidget);
      },
    );
  });
}

class _ControlledAssistantRepository implements PassengerAssistantRepository {
  Completer<PassengerAssistantReply>? next;
  final conversationIds = <String?>[];
  final histories = <List<PassengerAssistantMessage>>[];
  List<PassengerAssistantTripOption> searchResult = const [];
  PassengerAssistantTripOption? selectedOption;

  @override
  Future<List<PassengerAssistantTripOption>> searchTrips(
    PassengerAssistantTripDraft draft,
  ) async {
    return searchResult;
  }

  @override
  Future<String> selectTrip({
    required PassengerAssistantTripDraft draft,
    required PassengerAssistantTripOption option,
  }) async {
    selectedOption = option;
    return 'match_1';
  }

  @override
  Future<PassengerAssistantReply> ask({
    required String message,
    required String locale,
    required List<PassengerAssistantMessage> history,
    String? conversationId,
  }) {
    conversationIds.add(conversationId);
    histories.add(history);
    final pending = next;
    if (pending == null) {
      throw StateError('Test reply was not configured');
    }
    next = null;
    return pending.future;
  }
}

class _LoadingAssistantController extends PassengerAssistantController {
  _LoadingAssistantController(this.loading);

  final Completer<PassengerAssistantState> loading;

  @override
  Future<PassengerAssistantState> build() => loading.future;
}

class _StaticAssistantController extends PassengerAssistantController {
  _StaticAssistantController(this.value);

  final PassengerAssistantState value;

  @override
  Future<PassengerAssistantState> build() async => value;
}

class _SelectingAssistantController extends PassengerAssistantController {
  _SelectingAssistantController(this.value, this.matchId);

  final PassengerAssistantState value;
  final String matchId;

  @override
  Future<PassengerAssistantState> build() async => value;

  @override
  Future<String?> selectTrip(PassengerAssistantTripOption option) async {
    return matchId;
  }
}

PassengerAssistantTripDraft _tripDraft() => PassengerAssistantTripDraft(
  pickupKey: 'bab_al_zawiya',
  pickupLabel: 'Bab Al-Zawiya',
  destinationKey: 'bethlehem',
  destinationLabel: 'Bethlehem Center',
  preferredTime: DateTime.now().add(const Duration(days: 1)),
  passengerCount: 1,
);

const PassengerAssistantTripOption _tripOption = PassengerAssistantTripOption(
  id: 'route_1',
  driverName: 'Driver One',
  fromLabel: 'Bab Al-Zawiya',
  toLabel: 'Bethlehem Center',
  departureAt: null,
  seatsAvailable: 3,
  score: 0.91,
  vehicleType: 'Sedan',
  trustScore: 96,
);

Widget _testApp({required dynamic override}) {
  return ProviderScope(
    overrides: [override],
    child: MaterialApp(
      locale: const Locale('ar'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      theme: AppTheme.light,
      home: const PassengerAssistantScreen(),
    ),
  );
}

Widget _routerTestApp({required dynamic override}) {
  final router = GoRouter(
    routes: [
      GoRoute(path: '/', builder: (_, _) => const PassengerAssistantScreen()),
      GoRoute(
        path: '/passenger/match/:id',
        builder: (_, state) =>
            Scaffold(body: Text('match: ${state.pathParameters['id']}')),
      ),
    ],
  );
  return ProviderScope(
    overrides: [override],
    child: MaterialApp.router(
      locale: const Locale('ar'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      theme: AppTheme.light,
      routerConfig: router,
    ),
  );
}
