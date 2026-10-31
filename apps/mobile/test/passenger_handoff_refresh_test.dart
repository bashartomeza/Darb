import 'dart:async';
import 'package:flutter/material.dart';
import 'package:masari_mobile/core/widgets/foreground_refresh.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/auth/application/auth_actor_binding.dart';
import 'package:masari_mobile/features/matching/data/matching_models.dart';
import 'package:masari_mobile/features/matching/data/matching_repository.dart';
import 'package:masari_mobile/features/matching/presentation/match_detail_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';
import 'support/auth_test_support.dart';
import 'support/booking_recovery_test_support.dart';
import 'package:masari_mobile/features/passenger/application/legacy_passenger_request_mutation.dart';

void main() {
  testWidgets(
    'passenger handoff polling pauses when covered or backgrounded and retains records on failure',
    (tester) async {
      final repo = _Repository();
      final container = ProviderContainer(
        overrides: [matchingRepositoryProvider.overrideWithValue(repo)],
      );
      container.read(authenticatedActorBindingProvider).bind('passenger');
      final navigator = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            navigatorKey: navigator,
            locale: const Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const MatchDetailScreen(matchId: 'match'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('SYNTHETIC Driver'), findsOneWidget);
      final beforeDeferred = repo.calls;
      final deferred = tester
          .widget<ForegroundRefresh>(find.byType(ForegroundRefresh))
          .refresh();
      unawaited(
        navigator.currentState!.push(
          MaterialPageRoute<void>(
            builder: (_) => const Scaffold(body: Text('covered')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await deferred;
      expect(
        repo.calls,
        beforeDeferred,
        reason: 'deferred refresh must not start a hidden read',
      );
      final covered = repo.calls;
      await tester.pump(const Duration(seconds: 15));
      await tester.pumpAndSettle();
      expect(repo.calls, covered);
      navigator.currentState!.pop();
      await tester.pumpAndSettle();
      await tester.pump(const Duration(milliseconds: 500));
      await tester.pump();
      expect(repo.calls, covered + 1);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pump();
      final paused = repo.calls;
      await tester.pump(const Duration(seconds: 15));
      await tester.pumpAndSettle();
      expect(repo.calls, paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      repo.fail = true;
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(find.text('SYNTHETIC Driver'), findsOneWidget);
      repo.forbidden = true;
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(find.text('SYNTHETIC Driver'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
    },
  );
  test('pending passenger handoff read rejects old actor result', () async {
    final repo = _Repository()..blocked = Completer<MatchResult>();
    final container = ProviderContainer(
      overrides: [matchingRepositoryProvider.overrideWithValue(repo)],
    );
    addTearDown(container.dispose);
    container.read(authenticatedActorBindingProvider).bind('passenger');
    final sub = container.listen(matchDetailProvider('match'), (_, _) {});
    addTearDown(sub.close);
    final future = container.read(matchDetailProvider('match').future);
    await Future<void>.delayed(Duration.zero);
    final assertion = expectLater(future, throwsStateError);
    container.read(authenticatedActorBindingProvider).bind('other');
    repo.blocked!.complete(_match);
    await assertion;
  });
}

class _Repository extends MatchingRepository {
  _Repository()
    : super(
        mutation: LegacyPassengerRequestMutation(
          storage: MemoryBookingStorage(),
          currentActor: () => 'passenger',
        ),
        apiClient: TestAuthenticatedClient(
          handler: (_) async => http.Response('{}', 500),
        ).client,
      );
  int calls = 0;
  bool fail = false;
  bool forbidden = false;
  Completer<MatchResult>? blocked;
  @override
  Future<MatchResult> detail(String id) async {
    calls++;
    if (forbidden) {
      throw const ApiException(
        ApiErrorType.forbidden,
        'forbidden',
        statusCode: 403,
      );
    }
    if (fail) {
      throw const ApiException(ApiErrorType.network, 'network_unavailable');
    }
    return blocked == null ? _match : blocked!.future;
  }
}

const _match = MatchResult(
  id: 'match',
  status: 'proposed',
  score: .9,
  explanation: 'synthetic',
  driverName: 'SYNTHETIC Driver',
  routeLabel: 'synthetic',
  seatsAvailable: 2,
  breakdown: ScoringBreakdown(
    corridorOverlap: .9,
    pickupDistanceScore: .9,
    timingFit: .9,
    trustScore: .9,
    capacityFit: .9,
    finalScore: .9,
  ),
  passengerRequestId: null,
);
