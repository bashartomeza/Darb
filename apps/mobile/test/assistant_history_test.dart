import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:darb_mobile/core/theme/app_theme.dart';
import 'package:darb_mobile/features/assistant/data/passenger_assistant_repository.dart';
import 'package:darb_mobile/features/assistant/domain/passenger_assistant_models.dart';
import 'package:darb_mobile/features/assistant/presentation/passenger_assistant_screen.dart';
import 'package:darb_mobile/features/auth/application/auth_controller.dart';
import 'package:darb_mobile/features/auth/domain/auth_models.dart';
import 'package:darb_mobile/features/passenger/application/legacy_passenger_request_mutation.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';
import 'support/auth_test_support.dart';
import 'support/booking_recovery_test_support.dart';

http.Response _json(Object body) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  200,
  headers: const {'content-type': 'application/json; charset=utf-8'},
);

Map<String, dynamic> _savedChat() => {
  'conversation': {
    'id': 'conversation-1',
    'saved_request_id': 'request-1',
    'created_at': '2026-11-01T08:00:00.000Z',
    'updated_at': '2026-11-01T08:01:00.000Z',
    'messages': [
      {
        'id': 'm1',
        'role': 'user',
        'text': 'رحلة إلى بيت لحم',
        'payload': null,
        'created_at': '2026-11-01T08:00:00.000Z',
      },
      {
        'id': 'm2',
        'role': 'assistant',
        'text': 'ما موعد الرحلة؟',
        'payload': {
          'status': 'clarification',
          'suggestions': ['اليوم'],
        },
        'created_at': '2026-11-01T08:00:01.000Z',
      },
    ],
  },
};

void main() {
  group('assistant history repository', () {
    test('reads the saved chat from the API in order', () async {
      final paths = <String>[];
      final auth = TestAuthenticatedClient(
        handler: (request) async {
          paths.add('${request.method} ${request.url.path}');
          return _json(_savedChat());
        },
      );

      final restored = await ApiPassengerAssistantRepository(
        apiClient: auth.client,
      ).loadConversation();

      expect(paths, ['GET /api/v1/passenger/assistant/conversation']);
      expect(restored.conversationId, 'conversation-1');
      expect(restored.savedRequestId, 'request-1');
      expect(restored.messages.map((message) => message.role), [
        PassengerAssistantMessageRole.passenger,
        PassengerAssistantMessageRole.assistant,
      ]);
      expect(restored.messages.map((message) => message.text), [
        'رحلة إلى بيت لحم',
        'ما موعد الرحلة؟',
      ]);
    });

    test('reopens a waiting question with its suggestions', () async {
      final auth = TestAuthenticatedClient(
        handler: (_) async => _json(_savedChat()),
      );

      final restored = await ApiPassengerAssistantRepository(
        apiClient: auth.client,
      ).loadConversation();

      expect(restored.phase, PassengerAssistantPhase.clarification);
      expect(restored.suggestions, ['اليوم']);
    });

    test('an account without a chat starts empty', () async {
      final auth = TestAuthenticatedClient(
        handler: (_) async => http.Response('{"conversation":null}', 200),
      );

      final restored = await ApiPassengerAssistantRepository(
        apiClient: auth.client,
      ).loadConversation();

      expect(restored.messages, isEmpty);
      expect(restored.conversationId, isNull);
      expect(restored.savedRequestId, isNull);
    });

    test('rejects a malformed chat instead of showing part of it', () async {
      final auth = TestAuthenticatedClient(
        handler: (_) async => http.Response(
          jsonEncode({
            'conversation': {
              'id': 'conversation-1',
              'messages': [
                {'role': 'system', 'text': 'hidden'},
              ],
            },
          }),
          200,
        ),
      );

      await expectLater(
        ApiPassengerAssistantRepository(
          apiClient: auth.client,
        ).loadConversation(),
        throwsFormatException,
      );
    });

    test('links a saved request to the chat on the server', () async {
      final bodies = <String>[];
      final auth = TestAuthenticatedClient(
        handler: (request) async {
          expect(request.method, 'PATCH');
          expect(request.url.path, '/api/v1/passenger/assistant/conversation');
          bodies.add(request.body);
          return http.Response(request.body, 200);
        },
      );

      await ApiPassengerAssistantRepository(
        apiClient: auth.client,
      ).linkSavedRequest(conversationId: 'conversation-1', requestId: 'r1');

      expect(bodies.map(jsonDecode), [
        {'conversation_id': 'conversation-1', 'saved_request_id': 'r1'},
      ]);
    });
  });

  group('assistant screen history', () {
    testWidgets('shows the saved chat and continues the same conversation', (
      tester,
    ) async {
      final sent = <Map<String, dynamic>>[];
      final auth = TestAuthenticatedClient(
        handler: (request) async {
          if (request.url.path.endsWith('/passenger/assistant/messages')) {
            sent.add(jsonDecode(request.body) as Map<String, dynamic>);
            return _json({
              'status': 'clarification',
              'question': 'في أي ساعة؟',
              'suggestions': <String>[],
              'conversation_id': 'conversation-1',
            });
          }
          return _json(_savedChat());
        },
      );
      await tester.pumpWidget(_app(auth));
      await tester.pumpAndSettle();

      expect(find.text('رحلة إلى بيت لحم'), findsOneWidget);
      expect(find.text('ما موعد الرحلة؟'), findsOneWidget);
      expect(find.byKey(const ValueKey('assistantReadyState')), findsNothing);

      await tester.enterText(
        find.byKey(const ValueKey('assistantTextInput')),
        'اليوم',
      );
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('assistantSendButton')));
      await tester.pumpAndSettle();

      expect(sent.single['conversation_id'], 'conversation-1');
      expect(sent.single['history'], [
        {'role': 'user', 'text': 'رحلة إلى بيت لحم'},
        {'role': 'assistant', 'text': 'ما موعد الرحلة؟'},
      ]);
      expect(find.text('في أي ساعة؟'), findsOneWidget);
    });

    testWidgets('New chat deletes the saved chat after confirming', (
      tester,
    ) async {
      final requests = <String>[];
      var cleared = false;
      final auth = TestAuthenticatedClient(
        handler: (request) async {
          requests.add('${request.method} ${request.url.path}');
          if (request.method == 'DELETE') {
            cleared = true;
            return _json({'deleted': true});
          }
          return _json(cleared ? {'conversation': null} : _savedChat());
        },
      );
      await tester.pumpWidget(_app(auth, locale: 'en'));
      await tester.pumpAndSettle();
      expect(find.text('رحلة إلى بيت لحم'), findsOneWidget);

      // Cancelling the dialog keeps everything.
      await tester.tap(find.byKey(const ValueKey('assistantNewChat')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(requests.where((r) => r.startsWith('DELETE')), isEmpty);
      expect(find.text('رحلة إلى بيت لحم'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('assistantNewChat')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('assistantNewChatConfirm')));
      await tester.pumpAndSettle();

      expect(
        requests,
        contains('DELETE /api/v1/passenger/assistant/conversation'),
      );
      expect(find.text('رحلة إلى بيت لحم'), findsNothing);
      expect(find.byKey(const ValueKey('assistantNewChat')), findsNothing);
    });

    testWidgets('a failed load offers a retry that brings the chat back', (
      tester,
    ) async {
      var offline = true;
      final auth = TestAuthenticatedClient(
        handler: (request) async {
          if (offline) throw http.ClientException('offline');
          return _json(_savedChat());
        },
      );
      await tester.pumpWidget(_app(auth, locale: 'en'));
      await tester.pumpAndSettle();

      expect(find.text('Couldn’t load your chat'), findsOneWidget);
      expect(find.text('رحلة إلى بيت لحم'), findsNothing);

      offline = false;
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();

      expect(find.text('Couldn’t load your chat'), findsNothing);
      expect(find.text('رحلة إلى بيت لحم'), findsOneWidget);
    });
  });
}

Widget _app(TestAuthenticatedClient auth, {String locale = 'ar'}) =>
    ProviderScope(
      overrides: [
        authControllerProvider.overrideWith(_Auth.new),
        legacyPassengerRequestMutationProvider.overrideWithValue(
          testBookingMutation(actor: () => 'A'),
        ),
        passengerAssistantRepositoryProvider.overrideWith(
          (ref) => ApiPassengerAssistantRepository(
            apiClient: auth.client,
            mutation: ref.watch(legacyPassengerRequestMutationProvider),
          ),
        ),
      ],
      child: MaterialApp(
        locale: Locale(locale),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        theme: AppTheme.light,
        home: const PassengerAssistantScreen(),
      ),
    );

class _Auth extends AuthController {
  @override
  Future<AuthState> build() async => const AuthState.authenticated(
    AuthUser(id: 'A', name: 'A', role: UserRole.passenger, demoAccount: false),
  );
}
