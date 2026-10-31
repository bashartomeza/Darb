import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:masari_mobile/core/api/api_client.dart';
import 'package:masari_mobile/features/auth/data/session_coordinator.dart';
import 'package:masari_mobile/features/auth/domain/auth_models.dart';
import 'package:masari_mobile/core/widgets/language_switch.dart';
import 'package:masari_mobile/features/auth/application/auth_actor_binding.dart';
import 'package:masari_mobile/features/auth/data/authenticated_api_client.dart';
import 'package:masari_mobile/features/passenger/application/passenger_controller.dart';
import 'package:masari_mobile/features/passenger/presentation/request_detail_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import 'support/auth_test_support.dart';

void main() {
  test(
    'PATCH actual-send guard is rechecked after a same-session token refresh',
    () async {
      var current = true;
      var patches = 0;
      var refreshes = 0;
      final api = TestAuthenticatedClient(
        bundle: AuthTokenBundle(
          accessToken: 'synthetic-access',
          refreshToken: 'synthetic-refresh',
          accessTokenExpiresAt: DateTime.now().toUtc().add(
            const Duration(hours: 1),
          ),
        ),
        handler: (request) async {
          if (request.url.path == '/api/v1/auth/refresh') {
            refreshes++;
            current = false;
            return _json({
              'access_token': 'synthetic-replacement',
              'refresh_token': 'synthetic-rotated',
              'access_token_expires_in': 3600,
              'refresh_token_expires_in': 7200,
              'user': {
                'id': 'synthetic-passenger',
                'name': 'SYNTHETIC',
                'role': 'passenger',
              },
            });
          }
          patches++;
          return _json({'error': 'access_token_expired'}, 401);
        },
      );
      await expectLater(
        api.client.patchJson(
          '/passenger/requests/request-1/cancel',
          beforeSend: () {
            if (!current) throw StateError('session_changed');
          },
        ),
        throwsStateError,
      );
      expect(patches, 1);
      expect(refreshes, 1);
    },
  );

  testWidgets(
    'malformed successful PATCH body reconciles the committed cancellation',
    (tester) async {
      final h = _Harness()..response = 'malformed';
      await _pump(tester, h);
      await _cancel(tester);
      expect(find.text('Current status: Cancelled'), findsOneWidget);
      expect(find.byType(SnackBar), findsNothing);
      expect(h.cancellations, 1);
      expect(h.restorations, 1);
    },
  );

  testWidgets(
    'unavailable reconciliation does not claim cancellation failed or replay it',
    (tester) async {
      final h = _Harness()
        ..response = 'network'
        ..failReconciliation = true;
      await _pump(tester, h);
      await _cancel(tester);
      expect(
        find.text('Network unavailable. Check the API connection and retry.'),
        findsOneWidget,
      );
      expect(find.text('This request cannot be cancelled now.'), findsNothing);
      expect(h.cancellations, 1);
      expect(h.restorations, 1);
    },
  );

  testWidgets(
    'session revocation remains an authentication failure and cannot claim cancellation',
    (tester) async {
      final h = _Harness()..response = 'revoked';
      await _pump(tester, h);
      await _cancel(tester);
      expect(
        find.text('Your session has ended. Please sign in again.'),
        findsOneWidget,
      );
      expect(h.cancellations, 1);
      expect(h.restorations, 0);
    },
  );

  test(
    'account switch during credential acquisition sends no old request or related-trip GET',
    () async {
      final storage = _DelayedStorage()..pause();
      final h = _Harness(storage: storage);
      addTearDown(h.container.dispose);
      final sub = h.container.listen(
        passengerTripForRequestProvider('request-1'),
        (_, _) {},
      );
      addTearDown(sub.close);
      final future = h.container.read(
        passengerTripForRequestProvider('request-1').future,
      );
      final observed = future.then<Object?>(
        (value) => value,
        onError: (Object error) => error,
      );
      await storage.started.future;
      h.container
          .read(authenticatedActorBindingProvider)
          .bind('another-passenger');
      storage.release();
      expect(await observed, isA<StateError>());
      expect(h.requestReads + h.tripReads, 0);
    },
  );

  for (final transition in ['logout', 'switch']) {
    testWidgets(
      'credential acquisition cannot send cancellation after $transition',
      (tester) async {
        final storage = _DelayedStorage();
        final h = _Harness(storage: storage);
        await _pump(tester, h);
        await h.coordinator.clearCredentials();
        storage.storedBundle = _bundle('synthetic-original-token');
        storage.pause();
        await tester.tap(find.widgetWithText(OutlinedButton, 'Cancel request'));
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey('confirmSecurityActionButton')),
        );
        await tester.pumpAndSettle();
        await storage.started.future;
        final binding = h.container.read(authenticatedActorBindingProvider);
        if (transition == 'logout') {
          binding.clear();
        } else {
          binding.bind('another-passenger');
        }
        storage.release();
        await tester.pumpAndSettle();
        expect(h.cancellations, 0);
        expect(h.restorations, 0);
        expect(find.byType(SnackBar), findsNothing);
      },
    );
  }

  for (final language in ['en', 'ar']) {
    testWidgets(
      'accepted cancellation refreshes both visible statuses in $language',
      (tester) async {
        final h = _Harness();
        await _pump(tester, h, language: language);
        await _cancel(tester, language: language);
        final label = language == 'ar'
            ? 'الحالة الحالية: ملغاة'
            : 'Current status: Cancelled';
        expect(find.text(label), findsOneWidget);
        expect(
          h.container
              .read(passengerRequestDetailProvider('request-1'))
              .value
              ?.status,
          'cancelled',
        );
        expect(
          h.container
              .read(passengerTripForRequestProvider('request-1'))
              .value
              ?.status,
          'cancelled',
        );
        expect(h.cancellations, 1);
        expect(h.restorations, 1);
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final response in ['network', 'timeout', 'server']) {
    testWidgets(
      'committed cancellation with lost $response response reconciles without false failure',
      (tester) async {
        final h = _Harness()..response = response;
        await _pump(tester, h);
        await _cancel(tester);
        expect(find.text('Current status: Cancelled'), findsOneWidget);
        expect(find.byType(SnackBar), findsNothing);
        expect(
          find.widgetWithText(OutlinedButton, 'Cancel request'),
          findsNothing,
        );
        expect(h.cancellations, 1);
        expect(h.restorations, 1);
      },
    );
  }

  testWidgets(
    'uncommitted transport failure reconciles accepted state and reports uncertainty without replay',
    (tester) async {
      final h = _Harness()
        ..response = 'network'
        ..commit = false;
      await _pump(tester, h);
      await _cancel(tester);
      expect(find.text('Current status: Accepted'), findsOneWidget);
      expect(
        find.text('Network unavailable. Check the API connection and retry.'),
        findsOneWidget,
      );
      expect(find.text('This request cannot be cancelled now.'), findsNothing);
      expect(h.cancellations, 1);
      expect(h.restorations, 0);
    },
  );

  testWidgets(
    'genuine cancellation authorization error remains visible even if another actor cancelled',
    (tester) async {
      final h = _Harness()..response = 'forbidden';
      await _pump(tester, h);
      // A Driver can independently cancel; this must not hide our own 403.
      h.requestStatus = 'cancelled';
      h.tripStatus = 'cancelled';
      await _cancel(tester);
      expect(
        find.text('This account is not allowed to use this action.'),
        findsOneWidget,
      );
      expect(find.text('Current status: Cancelled'), findsOneWidget);
      expect(h.restorations, 0);
      expect(h.cancellations, 1);
    },
  );

  testWidgets(
    'concurrent Driver progress rejection renders authoritative state without false cancellation',
    (tester) async {
      final h = _Harness()..response = 'conflict';
      await _pump(tester, h);
      h.tripStatus = 'pickup_started';
      await _cancel(tester);
      expect(find.text('Current status: Pickup started'), findsOneWidget);
      expect(
        find.text('This request cannot be cancelled now.'),
        findsOneWidget,
      );
      expect(
        h.container
            .read(passengerRequestDetailProvider('request-1'))
            .value
            ?.status,
        'accepted',
      );
      expect(h.restorations, 0);
      expect(h.cancellations, 1);
    },
  );

  testWidgets(
    'rapid cancellation callbacks produce one confirmation and one mutation',
    (tester) async {
      final h = _Harness();
      await _pump(tester, h);
      final callback = tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, 'Cancel request'),
          )
          .onPressed!;
      callback();
      callback();
      await tester.pumpAndSettle();
      final dialogs = find.byType(AlertDialog).evaluate().length;
      // Close the current dialog before asserting, including on the RED baseline.
      await tester.tap(
        find.byKey(const ValueKey('confirmSecurityActionButton')).last,
      );
      await tester.pumpAndSettle();
      expect(dialogs, 1);
      expect(h.cancellations, 1);
      expect(h.restorations, 1);
    },
  );

  testWidgets(
    'delayed pre-cancel trip read cannot replace the reconciled cancellation',
    (tester) async {
      final h = _Harness();
      await _pump(tester, h);
      final barrier = Completer<void>();
      h.nextTripBarrier = barrier;
      final old = h.container.refresh(
        passengerTripForRequestProvider('request-1').future,
      );
      final observed = old.then<Object?>(
        (value) => value,
        onError: (Object error) => error,
      );
      await tester.pump();
      await _cancel(tester);
      final beforeOldResponse = find
          .text('Current status: Cancelled')
          .evaluate()
          .length;
      barrier.complete();
      await observed;
      await tester.pumpAndSettle();
      expect(beforeOldResponse, 1);
      expect(find.text('Current status: Cancelled'), findsOneWidget);
      expect(h.cancellations, 1);
      expect(h.restorations, 1);
    },
  );

  for (final transition in ['accepted', 'completed', 'failed']) {
    test(
      'related trip follows refreshed request through $transition',
      () async {
        final h = _Harness();
        addTearDown(h.container.dispose);
        h.requestStatus = 'matched';
        h.tripStatus = null;
        final sub = h.container.listen(
          passengerTripForRequestProvider('request-1'),
          (_, _) {},
        );
        addTearDown(sub.close);
        expect(
          await h.container.read(
            passengerTripForRequestProvider('request-1').future,
          ),
          isNull,
        );
        h.requestStatus = transition == 'failed' ? 'cancelled' : transition;
        h.tripStatus = transition;
        h.container.invalidate(passengerRequestDetailProvider('request-1'));
        final trip = await h.container.read(
          passengerTripForRequestProvider('request-1').future,
        );
        expect(trip?.status, transition);
        expect(h.cancellations, 0);
      },
    );
  }

  for (final end in ['logout', 'switch']) {
    test('related read discards delayed private result after $end', () async {
      final h = _Harness();
      addTearDown(h.container.dispose);
      final barrier = Completer<void>();
      h.nextTripBarrier = barrier;
      final sub = h.container.listen(
        passengerTripForRequestProvider('request-1'),
        (_, _) {},
      );
      addTearDown(sub.close);
      final future = h.container.read(
        passengerTripForRequestProvider('request-1').future,
      );
      final assertion = expectLater(future, throwsStateError);
      await Future<void>.delayed(Duration.zero);
      final binding = h.container.read(authenticatedActorBindingProvider);
      end == 'logout' ? binding.clear() : binding.bind('another-passenger');
      barrier.complete();
      await assertion;
      expect(
        h.container.read(passengerTripForRequestProvider('request-1')).value,
        isNull,
      );
    });
  }

  testWidgets(
    'logout during cancellation does not start reconciliation using a later session',
    (tester) async {
      final h = _Harness();
      await _pump(tester, h);
      final barrier = Completer<void>();
      h.cancelBarrier = barrier;
      await tester.tap(find.widgetWithText(OutlinedButton, 'Cancel request'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('confirmSecurityActionButton')),
      );
      await tester.pumpAndSettle();
      final reads = h.requestReads + h.tripReads;
      h.container.read(authenticatedActorBindingProvider).clear();
      barrier.complete();
      await tester.pumpAndSettle();
      expect(h.requestReads + h.tripReads, reads);
      expect(find.byType(SnackBar), findsNothing);
      expect(h.cancellations, 1);
    },
  );

  test(
    'an unbound actor cannot start private request or related-trip reads',
    () async {
      final h = _Harness();
      addTearDown(h.container.dispose);
      h.container.read(authenticatedActorBindingProvider).clear();
      final sub = h.container.listen(
        passengerTripForRequestProvider('request-1'),
        (_, _) {},
      );
      addTearDown(sub.close);
      await expectLater(
        h.container.read(passengerTripForRequestProvider('request-1').future),
        throwsStateError,
      );
      expect(h.requestReads + h.tripReads, 0);
    },
  );

  test(
    'restart reads persisted cancellation without another mutation',
    () async {
      final first = _Harness()
        ..requestStatus = 'cancelled'
        ..tripStatus = 'cancelled';
      await first.container.read(
        passengerTripForRequestProvider('request-1').future,
      );
      first.container.dispose();
      final restarted = _Harness()
        ..requestStatus = 'cancelled'
        ..tripStatus = 'cancelled';
      addTearDown(restarted.container.dispose);
      final sub = restarted.container.listen(
        passengerTripForRequestProvider('request-1'),
        (_, _) {},
      );
      addTearDown(sub.close);
      expect(
        (await restarted.container.read(
          passengerTripForRequestProvider('request-1').future,
        ))?.status,
        'cancelled',
      );
      expect(restarted.cancellations, 0);
    },
  );
}

Future<void> _pump(
  WidgetTester tester,
  _Harness h, {
  String language = 'en',
}) async {
  tester.view.physicalSize = const Size(1280, 1200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(h.container.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: h.container,
      child: MaterialApp(
        locale: Locale(language),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const ShellLanguageControl(
          child: RequestDetailScreen(requestId: 'request-1'),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _cancel(WidgetTester tester, {String language = 'en'}) async {
  await tester.tap(
    find.widgetWithText(
      OutlinedButton,
      language == 'ar' ? 'إلغاء الطلب' : 'Cancel request',
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const ValueKey('confirmSecurityActionButton')));
  await tester.pumpAndSettle();
}

class _Harness {
  _Harness({MemoryTokenStorage? storage}) {
    late AuthenticatedApiClient client;
    if (storage == null) {
      final api = TestAuthenticatedClient(handler: _handle);
      client = api.client;
      coordinator = api.coordinator;
    } else {
      final api = ApiClient(
        baseUrl: 'http://api.test',
        client: MockClient(_handle),
      );
      coordinator = AuthSessionCoordinator(
        apiClient: api,
        tokenStorage: storage,
      );
      client = AuthenticatedApiClient(
        apiClient: api,
        sessionCoordinator: coordinator,
      );
    }
    container = ProviderContainer(
      overrides: [authenticatedApiClientProvider.overrideWithValue(client)],
    );
    container
        .read(authenticatedActorBindingProvider)
        .bind('synthetic-passenger');
  }
  late final AuthSessionCoordinator coordinator;
  late final ProviderContainer container;
  String requestStatus = 'accepted';
  String? tripStatus = 'accepted';
  String response = 'success';
  bool commit = true;
  bool failReconciliation = false;
  int cancellations = 0, restorations = 0, requestReads = 0, tripReads = 0;
  Completer<void>? nextTripBarrier, cancelBarrier;

  Future<http.Response> _handle(http.Request request) async {
    if (request.method == 'PATCH' &&
        request.url.path == '/api/v1/passenger/requests/request-1/cancel') {
      cancellations++;
      await cancelBarrier?.future;
      if (response == 'revoked') {
        return _json({'error': 'session_revoked'}, 401);
      }
      if (response == 'forbidden') return _json({'error': 'forbidden'}, 403);
      if (response == 'conflict') {
        return _json({'error': 'request_cannot_be_cancelled'}, 409);
      }
      if (commit) {
        if (requestStatus != 'cancelled') restorations++;
        requestStatus = 'cancelled';
        tripStatus = 'cancelled';
      }
      if (response == 'malformed') return http.Response('{', 200);
      if (response == 'network') {
        throw http.ClientException('synthetic lost response');
      }
      if (response == 'timeout') {
        throw TimeoutException('synthetic lost response');
      }
      if (response == 'server') return _json({'error': 'response_failed'}, 500);
      return _json({'request': _request()});
    }
    if (request.method == 'GET' &&
        request.url.path == '/api/v1/passenger/requests/request-1') {
      requestReads++;
      if (failReconciliation && requestReads > 1) {
        throw http.ClientException('synthetic reconciliation unavailable');
      }
      return _json({'request': _request()});
    }
    if (request.method == 'GET' && request.url.path == '/api/v1/trips') {
      tripReads++;
      final status = tripStatus;
      final barrier = nextTripBarrier;
      nextTripBarrier = null;
      await barrier?.future;
      return _json({
        'trips': [
          if (status != null)
            {
              'id': 'trip-1',
              'status': status,
              'passenger_request_id': 'request-1',
              'created_at': '2026-10-22T12:00:00Z',
            },
        ],
      });
    }
    throw StateError(
      'unexpected synthetic endpoint ${request.method} ${request.url.path}',
    );
  }

  Map<String, dynamic> _request() => {
    'id': 'request-1',
    'pickup_label': 'SYNTHETIC A',
    'pickup_lat': 31.53,
    'pickup_lng': 35.10,
    'destination_label': 'SYNTHETIC B',
    'destination_lat': 31.70,
    'destination_lng': 35.20,
    'passenger_count': 1,
    'preferred_time': '2099-10-22T13:00:00Z',
    'created_at': '2026-10-22T12:00:00Z',
    'status': requestStatus,
  };
}

http.Response _json(Map<String, dynamic> body, [int status = 200]) =>
    http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );

AuthTokenBundle _bundle(String token) => AuthTokenBundle(
  accessToken: token,
  accessTokenExpiresAt: DateTime.now().toUtc().add(const Duration(hours: 1)),
);

class _DelayedStorage extends MemoryTokenStorage {
  _DelayedStorage() : super(storedBundle: _bundle('synthetic-original-token'));
  Completer<void>? _gate;
  Completer<void> started = Completer<void>();
  void pause() {
    started = Completer<void>();
    _gate = Completer<void>();
  }

  void release() {
    final gate = _gate;
    _gate = null;
    gate?.complete();
  }

  @override
  Future<AuthTokenBundle?> readBundle() async {
    final captured = storedBundle;
    final gate = _gate;
    if (gate != null) {
      if (!started.isCompleted) started.complete();
      await gate.future;
    }
    return captured;
  }
}
