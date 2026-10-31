import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/incidents/data/incident_repository.dart';
import 'package:masari_mobile/features/incidents/presentation/report_incident_sheet.dart';
import 'package:masari_mobile/features/notifications/data/notification_models.dart';
import 'package:masari_mobile/features/notifications/presentation/notifications_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

class _FakeIncidents implements IncidentRepository {
  final List<({IncidentCategory category, String description, String? tripId})>
  sent = [];
  Object? failure;

  @override
  get apiClient => throw UnimplementedError();

  @override
  Future<void> report({
    required IncidentCategory category,
    required String description,
    String? tripId,
  }) async {
    final error = failure;
    if (error != null) throw error;
    sent.add((category: category, description: description, tripId: tripId));
  }
}

Future<void> _pumpButton(
  WidgetTester tester,
  _FakeIncidents repo, {
  Locale locale = const Locale('en'),
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [incidentRepositoryProvider.overrideWithValue(repo)],
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(body: ReportIncidentButton(tripId: 'trip_1')),
      ),
    ),
  );
}

Future<void> _openSheet(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('reportIncidentButton')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('sending needs a real description, then files against the trip', (
    tester,
  ) async {
    final repo = _FakeIncidents();
    await _pumpButton(tester, repo);
    await _openSheet(tester);

    FilledButton submit() => tester.widget<FilledButton>(
      find.byKey(const ValueKey('incidentSubmit')),
    );
    expect(submit().onPressed, isNull);

    await tester.tap(find.byKey(const ValueKey('incidentCategory-delay')));
    await tester.enterText(
      find.byKey(const ValueKey('incidentDescription')),
      '  The driver arrived late  ',
    );
    await tester.pump();
    expect(submit().onPressed, isNotNull);

    await tester.tap(find.byKey(const ValueKey('incidentSubmit')));
    await tester.pumpAndSettle();

    expect(repo.sent, hasLength(1));
    expect(repo.sent.single.category, IncidentCategory.delay);
    expect(repo.sent.single.tripId, 'trip_1');
    expect(find.text('Report sent.'), findsOneWidget);
    expect(find.byKey(const ValueKey('incidentSubmit')), findsNothing);
  });

  testWidgets('a failure keeps the sheet and the typed text', (tester) async {
    final repo = _FakeIncidents()..failure = StateError('offline');
    await _pumpButton(tester, repo);
    await _openSheet(tester);

    await tester.enterText(
      find.byKey(const ValueKey('incidentDescription')),
      'Parcel was damaged',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('incidentSubmit')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('incidentError')), findsOneWidget);
    expect(find.text('Parcel was damaged'), findsOneWidget);
    expect(repo.sent, isEmpty);
  });

  testWidgets('the open-report cap gets its own message', (tester) async {
    final repo = _FakeIncidents()
      ..failure = const ApiException(
        ApiErrorType.server,
        'too_many_open_incidents',
        statusCode: 429,
      );
    await _pumpButton(tester, repo);
    await _openSheet(tester);

    await tester.enterText(
      find.byKey(const ValueKey('incidentDescription')),
      'Another problem',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('incidentSubmit')));
    await tester.pumpAndSettle();

    expect(find.textContaining('several reports under review'), findsOneWidget);
  });

  testWidgets('the sheet says it is not an emergency service, in Arabic too', (
    tester,
  ) async {
    await _pumpButton(tester, _FakeIncidents(), locale: const Locale('ar'));
    await _openSheet(tester);

    expect(find.textContaining('ليست خدمة طوارئ'), findsOneWidget);
  });

  testWidgets('incident updates read naturally in the inbox wording', (
    tester,
  ) async {
    late AppLocalizations l10n;
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Builder(
          builder: (context) {
            l10n = AppLocalizations.of(context);
            return const SizedBox();
          },
        ),
      ),
    );
    AppNotification note(String status) => AppNotification(
      id: 'n',
      type: 'incident_updated',
      params: {'status': status},
      createdAt: DateTime.utc(2026, 10, 25),
    );

    expect(
      notificationText(l10n, note('reviewing')).body,
      'Your report is under review.',
    );
    expect(
      notificationText(l10n, note('resolved')).body,
      'Your report has been resolved.',
    );
  });
}
