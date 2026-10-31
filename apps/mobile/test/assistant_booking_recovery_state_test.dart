import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/auth/application/auth_controller.dart';
import 'package:masari_mobile/features/auth/domain/auth_models.dart';
import 'package:masari_mobile/features/assistant/application/passenger_assistant_controller.dart';
import 'package:masari_mobile/features/assistant/data/passenger_assistant_repository.dart';
import 'package:masari_mobile/features/assistant/data/assistant_conversation_storage.dart';
import 'package:masari_mobile/features/assistant/domain/passenger_assistant_models.dart';
import 'package:masari_mobile/features/assistant/presentation/passenger_assistant_screen.dart';
import 'package:masari_mobile/features/passenger/application/legacy_passenger_request_mutation.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';
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
  id: 'route',
  driverName: 'Driver',
  fromLabel: 'Bab Al-Zawiya',
  toLabel: 'Bethlehem Center',
  seatsAvailable: 2,
  score: 0.9,
);

void main() {
  for (final operation in ['search', 'selection', 'message']) {
    test(
      'late actor A $operation completion cannot publish or persist into actor B',
      () async {
        final delayed = Completer<dynamic>();
        final storage = _Conversations(
          PassengerAssistantState(
            phase: operation == 'selection'
                ? PassengerAssistantPhase.result
                : PassengerAssistantPhase.requestReview,
            messages: const [
              PassengerAssistantMessage.passenger('Actor A private message'),
            ],
            draft: _draft,
            tripOptions: const [_option],
          ),
        );
        final repo = _Delayed(delayed);
        final container = ProviderContainer(
          overrides: [
            authControllerProvider.overrideWith(_Auth.new),
            assistantConversationStorageProvider.overrideWithValue(storage),
            passengerAssistantRepositoryProvider.overrideWithValue(repo),
            legacyPassengerRequestMutationProvider.overrideWithValue(
              testBookingMutation(),
            ),
          ],
        );
        addTearDown(container.dispose);
        await container.read(authControllerProvider.future);
        await container.read(passengerAssistantControllerProvider.future);
        final controller = container.read(
          passengerAssistantControllerProvider.notifier,
        );
        final work = operation == 'search'
            ? controller.confirmAndSearch(_draft)
            : operation == 'selection'
            ? controller.selectTrip(_option)
            : controller.submit('A followup', locale: 'en');
        await Future<void>.delayed(Duration.zero);
        container.read(authControllerProvider.notifier).state = const AsyncData(
          AuthState.authenticated(
            AuthUser(
              id: 'B',
              name: 'B',
              role: UserRole.passenger,
              demoAccount: false,
            ),
          ),
        );
        await container.read(passengerAssistantControllerProvider.future);
        if (operation == 'search') {
          delayed.complete(<PassengerAssistantTripOption>[_option]);
        } else {
          delayed.completeError(
            const ApiException(ApiErrorType.network, 'late failure'),
          );
        }
        await work;
        await Future<void>.delayed(Duration.zero);
        final state = container
            .read(passengerAssistantControllerProvider)
            .value!;
        expect(state.messages, isEmpty);
        expect(state.draft, isNull);
        expect(storage.saved['B']?.messages ?? [], isEmpty);
      },
    );
  }

  testWidgets(
    'assistant restart exposes the unresolved selection without supplying its previous draft',
    (tester) async {
      final pending = MemoryBookingStorage();
      final conversations = _Conversations(
        PassengerAssistantState(
          phase: PassengerAssistantPhase.requestReview,
          draft: _draft,
        ),
      );
      final keys = <String>[];
      var messageCalls = 0;
      final saved = <String>{};
      final auth = TestAuthenticatedClient(
        handler: (request) async {
          if (request.url.path.endsWith('/assistant/messages')) {
            messageCalls++;
            return http.Response('{"error":"must not send"}', 500);
          }
          if (request.url.path.endsWith('/matches/search')) {
            return http.Response(
              jsonEncode({
                'results': [
                  {
                    'id': 'route',
                    'origin_label': 'Bab Al-Zawiya',
                    'destination_label': 'Bethlehem Center',
                    'seats_available': 2,
                    'score': 0.9,
                    'driver': {'name': 'Driver'},
                  },
                ],
              }),
              200,
            );
          }
          if (request.url.path.endsWith('/passenger/requests')) {
            final key = request.headers['idempotency-key']!;
            keys.add(key);
            saved.add(key);
            if (keys.length == 1) {
              throw http.ClientException('saved response lost');
            }
            return http.Response('{"request":{"id":"saved"}}', 201);
          }
          return http.Response('{"match":{"id":"recovered"}}', 201);
        },
      );
      ProviderContainer create() => ProviderContainer(
        overrides: [
          authControllerProvider.overrideWith(_Auth.new),
          assistantConversationStorageProvider.overrideWithValue(conversations),
          legacyPassengerRequestMutationProvider.overrideWithValue(
            testBookingMutation(storage: pending, actor: () => 'A'),
          ),
          passengerAssistantRepositoryProvider.overrideWith(
            (ref) => ApiPassengerAssistantRepository(
              apiClient: auth.client,
              mutation: ref.watch(legacyPassengerRequestMutationProvider),
            ),
          ),
        ],
      );
      final first = create();
      await first.read(authControllerProvider.future);
      await first.read(passengerAssistantControllerProvider.future);
      final controller = first.read(
        passengerAssistantControllerProvider.notifier,
      );
      await controller.confirmAndSearch(_draft);
      await controller.selectTrip(
        first
            .read(passengerAssistantControllerProvider)
            .value!
            .tripOptions
            .single,
      );
      first.dispose();
      // Only persisted messages survive the ordinary conversation storage. The
      // original draft and selected option must come from the durable mutation.
      conversations.initial = const PassengerAssistantState();
      final reopened = create();
      addTearDown(reopened.dispose);
      await reopened.read(authControllerProvider.future);
      await reopened.read(passengerAssistantControllerProvider.future);
      await reopened
          .read(passengerAssistantControllerProvider.notifier)
          .submit('A different new trip', locale: 'en');
      expect(messageCalls, 0);
      final router = GoRouter(
        routes: [
          GoRoute(
            path: '/',
            builder: (_, _) => const PassengerAssistantScreen(),
          ),
          GoRoute(
            path: '/passenger/match/:id',
            builder: (_, state) =>
                Scaffold(body: Text('Matched ${state.pathParameters['id']}')),
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: reopened,
          child: MaterialApp.router(
            routerConfig: router,
            locale: const Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Verify booking'), findsOneWidget);
      expect(tester.widget<TextField>(find.byType(TextField)).enabled, isFalse);
      await tester.ensureVisible(find.byKey(const ValueKey('bookOffer-route')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('bookOffer-route')));
      await tester.pumpAndSettle();
      expect(find.text('Matched recovered'), findsOneWidget);
      expect(keys, [keys.first, keys.first]);
      expect(saved.length, 1);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  for (final window in ['expired', 'future', 'undated']) {
    test(
      'fresh assistant offer with $window availability window is validated before create',
      () async {
        var creates = 0;
        final auth = TestAuthenticatedClient(
          handler: (request) async {
            if (request.url.path.endsWith('/passenger/requests')) {
              creates++;
              return http.Response('{"request":{"id":"saved"}}', 201);
            }
            return http.Response('{"match":{"id":"matched"}}', 201);
          },
        );
        final repository = ApiPassengerAssistantRepository(
          apiClient: auth.client,
          mutation: testBookingMutation(),
        );
        final option = PassengerAssistantTripOption(
          id: 'route',
          driverName: 'Driver',
          fromLabel: 'Origin',
          toLabel: 'Destination',
          seatsAvailable: 2,
          score: 0.9,
          availabilityWindowEnd: window == 'undated'
              ? null
              : DateTime.now().add(
                  Duration(days: window == 'expired' ? -1 : 1),
                ),
        );
        if (window == 'expired') {
          await expectLater(
            repository.selectTrip(draft: _draft, option: option),
            throwsA(
              isA<ApiException>().having(
                (error) => error.message,
                'message',
                'booking_time_passed',
              ),
            ),
          );
          expect(creates, 0);
        } else {
          expect(
            await repository.selectTrip(draft: _draft, option: option),
            'matched',
          );
          expect(creates, 1);
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

class _Conversations extends AssistantConversationStorage {
  _Conversations(this.initial) : super(const FlutterSecureStorage());
  PassengerAssistantState initial;
  final saved = <String, PassengerAssistantState>{};
  @override
  Future<PassengerAssistantState> read(String userId) async =>
      userId == 'A' ? initial : const PassengerAssistantState();
  @override
  Future<void> save(String userId, PassengerAssistantState state) async {
    saved[userId] = state;
  }
}

class _Delayed implements PassengerAssistantRepository {
  _Delayed(this.response);
  final Completer<dynamic> response;
  @override
  Future<List<PassengerAssistantTripOption>> searchTrips(
    PassengerAssistantTripDraft draft,
  ) async => (await response.future) as List<PassengerAssistantTripOption>;
  @override
  Future<String> selectTrip({
    required PassengerAssistantTripDraft draft,
    required PassengerAssistantTripOption option,
  }) async => (await response.future) as String;
  @override
  Future<PassengerAssistantReply> ask({
    required String message,
    required String locale,
    required List<PassengerAssistantMessage> history,
    String? conversationId,
  }) async => (await response.future) as PassengerAssistantReply;
}
