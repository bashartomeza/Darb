import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/features/assistant/presentation/passenger_assistant_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/assistant/application/passenger_assistant_controller.dart';
import 'package:masari_mobile/features/assistant/data/assistant_conversation_storage.dart';
import 'package:masari_mobile/features/assistant/data/passenger_assistant_repository.dart';
import 'package:masari_mobile/features/assistant/domain/passenger_assistant_models.dart';
import 'package:masari_mobile/features/auth/application/auth_controller.dart';
import 'package:masari_mobile/features/auth/domain/auth_models.dart';
import 'package:masari_mobile/features/passenger/application/legacy_passenger_request_mutation.dart';
import 'support/auth_test_support.dart';
import 'support/booking_recovery_test_support.dart';

final _draft = PassengerAssistantTripDraft(
  pickupKey: 'bab_al_zawiya',
  pickupLabel: 'Bab Al-Zawiya',
  destinationKey: 'bethlehem',
  destinationLabel: 'Bethlehem Center',
  preferredTime: DateTime.utc(2030, 1, 2, 12),
  passengerCount: 1,
);
const _option = PassengerAssistantTripOption(
  id: 'selected-route',
  driverName: 'Selected Driver',
  fromLabel: 'Bab Al-Zawiya',
  toLabel: 'Bethlehem Center',
  seatsAvailable: 2,
  score: .9,
);

void main() {
  test(
    'confirmed saved request remains actor-scoped across assistant restart and a new search',
    () async {
      FlutterSecureStorage.setMockInitialValues({});
      const history = AssistantConversationStorage(FlutterSecureStorage());
      final mutation = testBookingMutation(actor: () => 'A');
      final auth = TestAuthenticatedClient(
        handler: (request) async {
          if (request.url.path.endsWith('/passenger/requests')) {
            return http.Response('{"request":{"id":"saved-request"}}', 201);
          }
          if (request.url.path.endsWith('/matches/run')) {
            return http.Response('{"error":"passenger_request_expired"}', 409);
          }
          if (request.url.path.endsWith('/matches')) {
            return http.Response('{"matches":[]}', 200);
          }
          return http.Response(
            '{"status":"clarification","question":"New search"}',
            200,
          );
        },
      );
      final repository = ApiPassengerAssistantRepository(
        apiClient: auth.client,
        mutation: mutation,
      );
      ProviderContainer create(
        AssistantConversationStorage storage,
      ) => ProviderContainer(
        overrides: [
          authControllerProvider.overrideWith(_Auth.new),
          assistantConversationStorageProvider.overrideWithValue(storage),
          passengerAssistantRepositoryProvider.overrideWithValue(repository),
          legacyPassengerRequestMutationProvider.overrideWithValue(mutation),
        ],
      );
      final first = create(_History(delegate: history));
      await first.read(authControllerProvider.future);
      await first.read(passengerAssistantControllerProvider.future);
      await first
          .read(passengerAssistantControllerProvider.notifier)
          .selectTrip(_option);
      first.dispose();
      final second = create(history);
      addTearDown(second.dispose);
      await second.read(authControllerProvider.future);
      final restored = await second.read(
        passengerAssistantControllerProvider.future,
      );
      expect(restored.savedRequestId, 'saved-request');
      expect(restored.selectionRequestId, isNull);
      expect(await mutation.pending(), isNull);
      expect((await history.read('B')).savedRequestId, isNull);
      await second
          .read(passengerAssistantControllerProvider.notifier)
          .submit('A new search', locale: 'en');
      expect(
        second.read(passengerAssistantControllerProvider).value!.savedRequestId,
        'saved-request',
      );
    },
  );
  for (final preCreateFailure in [true, false]) {
    testWidgets(
      'saved request navigation belongs to the current attempt (pre-create failure: $preCreateFailure)',
      (tester) async {
        final mutation = testBookingMutation(actor: () => 'A');
        var creates = 0;
        final auth = TestAuthenticatedClient(
          handler: (request) async {
            if (request.url.path.endsWith('/passenger/requests')) {
              creates++;
              return http.Response('{"request":{"id":"current-request"}}', 201);
            }
            if (request.url.path.endsWith('/matches/run')) {
              return http.Response(
                '{"error":"selected_driver_route_unavailable"}',
                409,
              );
            }
            return http.Response('{"matches":[]}', 200);
          },
        );
        final router = GoRouter(
          initialLocation: '/assistant',
          routes: [
            GoRoute(
              path: '/assistant',
              builder: (_, _) => const PassengerAssistantScreen(),
            ),
            GoRoute(
              path: '/passenger/request/:id',
              builder: (_, state) =>
                  Scaffold(body: Text('Request ${state.pathParameters['id']}')),
            ),
          ],
        );
        addTearDown(router.dispose);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authControllerProvider.overrideWith(_Auth.new),
              assistantConversationStorageProvider.overrideWithValue(
                _History(
                  initial: PassengerAssistantState(
                    phase: PassengerAssistantPhase.result,
                    draft: preCreateFailure
                        ? _draft.copyWith(preferredTime: DateTime.utc(2020))
                        : _draft,
                    tripOptions: const [_option],
                    savedRequestId: 'old-request',
                  ),
                ),
              ),
              passengerAssistantRepositoryProvider.overrideWithValue(
                ApiPassengerAssistantRepository(
                  apiClient: auth.client,
                  mutation: mutation,
                ),
              ),
              legacyPassengerRequestMutationProvider.overrideWithValue(
                mutation,
              ),
            ],
            child: MaterialApp.router(
              routerConfig: router,
              locale: const Locale('en'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey('bookOffer-selected-route')),
        );
        await tester.pumpAndSettle();
        expect(find.text('Request old-request'), findsNothing);
        if (preCreateFailure) {
          expect(
            find.byKey(const ValueKey('passengerAssistantScreen')),
            findsOneWidget,
          );
          expect(creates, 0);
        } else {
          expect(find.text('Request current-request'), findsOneWidget);
          expect(
            find.text(
              'The selected driver route is no longer available. Please search again.',
            ),
            findsOneWidget,
          );
          expect(creates, 1);
        }
      },
    );
  }
  for (final failure in [
    (409, 'passenger_request_expired', PassengerAssistantFailure.expired),
    (
      409,
      'selected_driver_route_unavailable',
      PassengerAssistantFailure.selectedDriverUnavailable,
    ),
    (422, 'unsupported_destination', PassengerAssistantFailure.generic),
    (404, 'passenger_request_not_found', PassengerAssistantFailure.unavailable),
  ]) {
    test(
      'definitive ${failure.$2} releases verification and allows a new search',
      () async {
        final mutation = testBookingMutation(actor: () => 'A');
        var creates = 0;
        var messages = 0;
        final auth = TestAuthenticatedClient(
          handler: (request) async {
            if (request.url.path.endsWith('/passenger/requests')) {
              creates++;
              return http.Response('{"request":{"id":"saved-request"}}', 201);
            }
            if (request.url.path.endsWith('/matches/run')) {
              return http.Response(
                jsonEncode({'error': failure.$2}),
                failure.$1,
              );
            }
            if (request.url.path.endsWith('/matches')) {
              return http.Response('{"matches":[]}', 200);
            }
            messages++;
            return http.Response(
              '{"status":"clarification","question":"New search"}',
              200,
            );
          },
        );
        final repository = ApiPassengerAssistantRepository(
          apiClient: auth.client,
          mutation: mutation,
        );
        final container = ProviderContainer(
          overrides: [
            authControllerProvider.overrideWith(_Auth.new),
            assistantConversationStorageProvider.overrideWithValue(_History()),
            passengerAssistantRepositoryProvider.overrideWithValue(repository),
            legacyPassengerRequestMutationProvider.overrideWithValue(mutation),
          ],
        );
        addTearDown(container.dispose);
        await container.read(authControllerProvider.future);
        await container.read(passengerAssistantControllerProvider.future);
        final controller = container.read(
          passengerAssistantControllerProvider.notifier,
        );
        expect(await controller.selectTrip(_option), isNull);
        expect(
          container
              .read(passengerAssistantControllerProvider)
              .value!
              .selectionFailure,
          failure.$3,
        );
        expect(await mutation.pending(), isNull);
        expect(
          container
              .read(passengerAssistantControllerProvider)
              .value!
              .savedRequestId,
          'saved-request',
        );
        controller.editSearch();
        expect(
          container.read(passengerAssistantControllerProvider).value!.phase,
          PassengerAssistantPhase.requestReview,
        );
        await controller.submit('A legitimate new search', locale: 'en');
        expect(
          container
              .read(passengerAssistantControllerProvider)
              .value!
              .savedRequestId,
          'saved-request',
        );
        expect(messages, 1);
        expect(creates, 1);
      },
    );
  }
  for (final failure in [
    'timeout',
    'lost-response',
    'server',
    'invalid-response',
  ]) {
    test(
      '$failure keeps saved request pending and retries without creating again',
      () async {
        final mutation = testBookingMutation();
        var creates = 0;
        var runs = 0;
        final matchedRequests = <String>[];
        final auth = TestAuthenticatedClient(
          handler: (request) async {
            if (request.url.path.endsWith('/passenger/requests')) {
              creates++;
              return http.Response('{"request":{"id":"saved-request"}}', 201);
            }
            if (request.url.path.endsWith('/matches/run')) {
              matchedRequests.add(
                jsonDecode(request.body)['passengerRequestId'] as String,
              );
              if (++runs > 1) {
                return http.Response('{"match":{"id":"matched"}}', 201);
              }
              if (failure == 'timeout') {
                throw TimeoutException('transport timeout');
              }
              if (failure == 'lost-response') {
                throw http.ClientException('response lost');
              }
              return http.Response(
                failure == 'server' ? '{"error":"internal_error"}' : '{}',
                failure == 'server' ? 500 : 201,
              );
            }
            return http.Response('{"matches":[]}', 200);
          },
        );
        final repository = ApiPassengerAssistantRepository(
          apiClient: auth.client,
          mutation: mutation,
        );
        await expectLater(
          repository.selectTrip(draft: _draft, option: _option),
          throwsA(
            isA<ApiException>()
                .having(
                  (e) => e.type,
                  'matching failure category',
                  switch (failure) {
                    'timeout' => ApiErrorType.timeout,
                    'lost-response' => ApiErrorType.network,
                    'server' => ApiErrorType.server,
                    _ => ApiErrorType.unknown,
                  },
                )
                .having(
                  (e) => e.message,
                  'known saved request uncertainty',
                  'booking_saved_matching_unavailable',
                ),
          ),
        );
        expect(await mutation.pending(), isNotNull);
        expect(
          await repository.selectTrip(draft: _draft, option: _option),
          'matched',
        );
        expect(creates, 1);
        expect(matchedRequests, ['saved-request', 'saved-request']);
        expect(await mutation.pending(), isNull);
      },
    );
  }
  for (final route in ['selected-route', 'another-route']) {
    test(
      'lost matching response reconciles only the originally selected driver ($route)',
      () async {
        final mutation = testBookingMutation();
        final auth = TestAuthenticatedClient(
          handler: (request) async {
            if (request.url.path.endsWith('/passenger/requests')) {
              return http.Response('{"request":{"id":"saved-request"}}', 201);
            }
            if (request.url.path.endsWith('/matches/run')) {
              throw http.ClientException('committed but response lost');
            }
            return http.Response(
              jsonEncode({
                'matches': [
                  {
                    'id': 'existing-match',
                    'status': 'sent_to_driver',
                    'passenger_request': {'id': 'saved-request'},
                    'driver_route': {'id': route},
                  },
                ],
              }),
              200,
            );
          },
        );
        final repository = ApiPassengerAssistantRepository(
          apiClient: auth.client,
          mutation: mutation,
        );
        if (route == 'selected-route') {
          expect(
            await repository.selectTrip(draft: _draft, option: _option),
            'existing-match',
          );
          expect(await mutation.pending(), isNull);
        } else {
          await expectLater(
            repository.selectTrip(draft: _draft, option: _option),
            throwsA(isA<ApiException>()),
          );
          expect(await mutation.pending(), isNotNull);
        }
      },
    );
  }
}

class _Auth extends AuthController {
  @override
  Future<AuthState> build() async => const AuthState.authenticated(
    AuthUser(id: 'A', name: 'A', role: UserRole.passenger, demoAccount: false),
  );
}

class _History extends AssistantConversationStorage {
  _History({this.initial, this.delegate}) : super(const FlutterSecureStorage());
  final PassengerAssistantState? initial;
  final AssistantConversationStorage? delegate;
  @override
  Future<PassengerAssistantState> read(String userId) async =>
      initial ??
      PassengerAssistantState(
        phase: PassengerAssistantPhase.result,
        draft: _draft,
        tripOptions: const [_option],
      );
  @override
  Future<void> save(String userId, PassengerAssistantState state) async {
    await delegate?.save(userId, state);
  }
}
