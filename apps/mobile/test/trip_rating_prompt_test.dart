import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/trips/data/trip_repository.dart';
import 'package:masari_mobile/features/trips/presentation/trip_rating_prompt.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

class _FakeTrips implements TripRepository {
  int? existing;
  Object? failure;
  final List<({String tripId, int stars})> sent = [];

  @override
  get apiClient => throw UnimplementedError();

  @override
  Future<int?> myRating(String tripId) async => existing;

  @override
  Future<void> submitRating(String tripId, int stars) async {
    final error = failure;
    if (error != null) throw error;
    sent.add((tripId: tripId, stars: stars));
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<void> _pump(
  WidgetTester tester,
  _FakeTrips repo, {
  Locale locale = const Locale('en'),
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [tripRepositoryProvider.overrideWithValue(repo)],
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(body: TripRatingPrompt(tripId: 'trip_1')),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('sending needs a star, then rates the trip once', (tester) async {
    final repo = _FakeTrips();
    await _pump(tester, repo);

    expect(find.text('How was your trip?'), findsOneWidget);
    final submit = find.byKey(const ValueKey('ratingSubmit'));
    expect(tester.widget<FilledButton>(submit).onPressed, isNull);

    await tester.tap(find.byKey(const ValueKey('ratingStar-4')));
    await tester.pump();
    await tester.tap(submit);
    await tester.pumpAndSettle();

    expect(repo.sent, [(tripId: 'trip_1', stars: 4)]);
    expect(find.text('Thanks for rating your trip.'), findsOneWidget);
    expect(find.byKey(const ValueKey('ratingSubmit')), findsNothing);
  });

  testWidgets('a trip already rated shows no prompt', (tester) async {
    final repo = _FakeTrips()..existing = 5;
    await _pump(tester, repo);

    expect(find.byKey(const ValueKey('tripRatingPrompt')), findsNothing);
    expect(find.text('You already rated this trip.'), findsOneWidget);
  });

  testWidgets('a failed send keeps the prompt and says so', (tester) async {
    final repo = _FakeTrips()
      ..failure = const ApiException(ApiErrorType.server, 'x', statusCode: 500);
    await _pump(tester, repo);

    await tester.tap(find.byKey(const ValueKey('ratingStar-2')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('ratingSubmit')));
    await tester.pumpAndSettle();

    expect(
      find.text('The rating could not be sent. Try again.'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('tripRatingPrompt')), findsOneWidget);
  });

  testWidgets('renders in Arabic', (tester) async {
    await _pump(tester, _FakeTrips(), locale: const Locale('ar'));

    expect(find.text('كيف كانت رحلتك؟'), findsOneWidget);
    expect(find.text('إرسال التقييم'), findsOneWidget);
  });
}
