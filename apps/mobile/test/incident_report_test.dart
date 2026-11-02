import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:darb_mobile/core/api/api_error.dart';
import 'package:darb_mobile/features/incidents/data/incident_repository.dart';
import 'package:darb_mobile/features/incidents/presentation/report_incident_sheet.dart';
import 'package:darb_mobile/features/notifications/data/notification_models.dart';
import 'package:darb_mobile/features/notifications/presentation/notifications_screen.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import 'support/auth_test_support.dart';

class _FakeIncidents implements IncidentRepository {
  final List<({IncidentCategory category, String description, String? tripId})>
  sent = [];
  Object? failure;
  Object? listFailure;
  int listReads = 0;

  /// Stands in for the server rows `GET /incidents` returns, oldest first.
  final List<IncidentReport> saved = [];

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
    saved.add(
      IncidentReport(
        id: 'inc_${saved.length + 1}',
        category: category,
        description: description.trim(),
        status: IncidentStatus.open,
        createdAt: DateTime(2026, 10, 25),
        tripId: tripId,
      ),
    );
  }

  @override
  Future<List<IncidentReport>> mine() async {
    listReads++;
    final error = listFailure;
    if (error != null) throw error;
    return saved.reversed.toList();
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

Future<void> _openMyReports(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('myIncidentReportsButton')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a sent report is listed under "My reports" with its status', (
    tester,
  ) async {
    final repo = _FakeIncidents();
    await _pumpButton(tester, repo);

    await _openMyReports(tester);
    expect(
      find.byKey(const ValueKey('myIncidentReportsEmpty')),
      findsOneWidget,
    );
    Navigator.of(tester.element(find.byType(MyIncidentReportsList))).pop();
    await tester.pumpAndSettle();

    await _openSheet(tester);
    await tester.tap(find.byKey(const ValueKey('incidentCategory-delay')));
    await tester.enterText(
      find.byKey(const ValueKey('incidentDescription')),
      'The driver arrived late',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('incidentSubmit')));
    await tester.pumpAndSettle();

    await _openMyReports(tester);
    // Read again from the repository, not a copy kept from the first open.
    expect(repo.listReads, 2);
    expect(find.byKey(const ValueKey('incidentReport-inc_1')), findsOneWidget);
    expect(find.text('Delay'), findsOneWidget);
    expect(find.text('Open'), findsOneWidget);
    expect(find.textContaining('The driver arrived late'), findsOneWidget);
  });

  testWidgets('"My reports" offers a retry when the list cannot load', (
    tester,
  ) async {
    final repo = _FakeIncidents()..listFailure = StateError('offline');
    await _pumpButton(tester, repo);
    await _openMyReports(tester);
    expect(
      find.byKey(const ValueKey('myIncidentReportsError')),
      findsOneWidget,
    );

    repo
      ..listFailure = null
      ..saved.add(
        IncidentReport(
          id: 'inc_9',
          category: IncidentCategory.safety,
          description: 'Unsafe overtaking',
          status: IncidentStatus.reviewing,
          createdAt: DateTime(2026, 10, 24),
        ),
      );
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.text('Under review'), findsOneWidget);
  });

  test("the repository reads the caller's reports from GET /incidents", () async {
    final paths = <String>[];
    final auth = TestAuthenticatedClient(
      handler: (request) async {
        paths.add('${request.method} ${request.url.path}');
        return http.Response(
          '{"incidents":[{"id":"inc_1","trip_id":"trip_1","category":"parcel_damage",'
          '"description":"Box crushed","status":"resolved","admin_note":null,'
          '"revision":2,"reviewed_at":null,"resolved_at":null,'
          '"created_at":"2026-10-25T10:00:00.000Z"},'
          '{"id":"inc_2","trip_id":null,"category":"something_new",'
          '"description":"New kind","status":"open",'
          '"created_at":"2026-10-24T10:00:00.000Z"}]}',
          200,
        );
      },
    );
    final reports = await IncidentRepository(apiClient: auth.client).mine();
    expect(paths, ['GET /api/v1/incidents']);
    expect(reports.first.category, IncidentCategory.parcelDamage);
    expect(reports.first.status, IncidentStatus.resolved);
    expect(reports.first.tripId, 'trip_1');
    expect(reports.last.category, IncidentCategory.other);
  });

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
