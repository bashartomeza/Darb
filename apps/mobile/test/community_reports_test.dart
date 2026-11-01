import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/community_reports/data/community_report_models.dart';
import 'package:masari_mobile/features/community_reports/data/community_report_repository.dart';
import 'package:masari_mobile/features/community_reports/presentation/community_reports_section.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

CommunityReport _report({
  String id = 'r1',
  CommunityReportCategory category = CommunityReportCategory.roadClosure,
  DateTime? createdAt,
  int up = 0,
  int down = 0,
  int myVote = 0,
  bool isMine = false,
  double? lat,
  double? lng,
}) => CommunityReport(
  id: id,
  category: category,
  description: 'Road blocked near the junction',
  locationName: 'Main junction',
  createdAt: createdAt ?? DateTime.now(),
  upvotes: up,
  downvotes: down,
  myVote: myVote,
  isMine: isMine,
  latitude: lat,
  longitude: lng,
);

class _FakeRepo implements CommunityReportRepository {
  _FakeRepo(this.reports);
  List<CommunityReport> reports;
  final votes = <(String, int)>[];
  final created = <CommunityReportCategory>[];
  final flagged = <String>[];
  Object? createFailure;

  @override
  get apiClient => throw UnimplementedError();

  @override
  Future<List<CommunityReport>> list() async => reports;

  @override
  Future<CommunityReport> vote(String id, int value) async {
    votes.add((id, value));
    return reports.firstWhere((r) => r.id == id).withVote(value);
  }

  @override
  Future<void> flag(String id) async => flagged.add(id);

  @override
  Future<CommunityReport> create({
    required CommunityReportCategory category,
    required String description,
    required String locationName,
    double? latitude,
    double? longitude,
  }) async {
    final failure = createFailure;
    if (failure != null) throw failure;
    created.add(category);
    return _report(id: 'new', category: category);
  }
}

Future<void> _pump(
  WidgetTester tester,
  _FakeRepo repo, {
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = const Size(800, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [communityReportRepositoryProvider.overrideWithValue(repo)],
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(
          body: SingleChildScrollView(child: CommunityReportsSection()),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('models', () {
    final now = DateTime.utc(2026, 11, 1, 12);

    test('badges: recent, disputed and well supported', () {
      expect(
        _report(
          createdAt: now.subtract(const Duration(minutes: 5)),
        ).badges(now),
        {CommunityReportBadge.recent},
      );
      final old = now.subtract(const Duration(days: 1));
      expect(_report(createdAt: old, up: 1, down: 1).badges(now), isEmpty);
      expect(_report(createdAt: old, up: 1, down: 4).badges(now), {
        CommunityReportBadge.disputed,
      });
      expect(_report(createdAt: old, up: 5, down: 1).badges(now), {
        CommunityReportBadge.wellSupported,
      });
      expect(_report(createdAt: old, up: 3, down: 3).badges(now), isEmpty);
    });

    test('withVote moves a vote without double counting', () {
      final r = _report(up: 2, down: 1);
      final up = r.withVote(1);
      expect((up.upvotes, up.downvotes, up.myVote), (3, 1, 1));
      final flipped = up.withVote(-1);
      expect((flipped.upvotes, flipped.downvotes, flipped.myVote), (2, 2, -1));
      final cleared = flipped.withVote(0);
      expect((cleared.upvotes, cleared.downvotes, cleared.myVote), (2, 1, 0));
    });

    test('filter by group and sort by recency, support and dispute', () {
      final a = _report(
        id: 'a',
        createdAt: DateTime.utc(2026, 11, 1, 8),
        up: 5,
      );
      final b = _report(
        id: 'b',
        category: CommunityReportCategory.checkpointOutdated,
        createdAt: DateTime.utc(2026, 11, 1, 9),
        down: 4,
      );
      final c = _report(id: 'c', createdAt: DateTime.utc(2026, 11, 1, 7));
      final all = [a, b, c];
      expect(arrangeReports(all).map((r) => r.id), ['b', 'a', 'c']);
      expect(
        arrangeReports(all, sort: CommunityReportSort.top).map((r) => r.id),
        ['a', 'c', 'b'],
      );
      expect(
        arrangeReports(
          all,
          sort: CommunityReportSort.disputed,
        ).map((r) => r.id),
        ['b', 'c', 'a'],
      );
      expect(
        arrangeReports(
          all,
          group: CommunityReportGroup.checkpoint,
        ).map((r) => r.id),
        ['b'],
      );
    });

    test(
      'parses the API payload and only sensitive categories are flagged',
      () {
        final r = CommunityReport.fromJson({
          'id': 'x',
          'category': 'driver_report',
          'description': 'd',
          'location_name': 'l',
          'created_at': '2026-11-01T10:00:00.000Z',
          'latitude': 32.2,
          'longitude': 35.2,
          'upvotes': 2,
          'downvotes': 1,
          'my_vote': -1,
          'is_mine': false,
          'awaiting_admin_review': true,
          'has_trip': true,
        });
        expect(r.category.sensitive, isTrue);
        expect(r.hasLocation, isTrue);
        expect(r.myVote, -1);
        expect(r.awaitingAdminReview, isTrue);
        expect(CommunityReportCategory.roadClosure.sensitive, isFalse);
        expect(
          CommunityReportCategory.fromApi('nope'),
          CommunityReportCategory.other,
        );
      },
    );
  });

  testWidgets('shows counts, badges and voting that can be changed', (
    tester,
  ) async {
    final repo = _FakeRepo([
      _report(id: 'r1', up: 5, down: 1, createdAt: DateTime(2020)),
      _report(
        id: 'r2',
        category: CommunityReportCategory.incorrectMapInfo,
        up: 0,
        down: 4,
        createdAt: DateTime(2020),
      ),
    ]);
    await _pump(tester, repo);

    expect(find.text('Well supported'), findsOneWidget);
    expect(find.text('Disputed'), findsOneWidget);
    expect(find.text('5'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('communityUp-r1')));
    await tester.pumpAndSettle();
    expect(repo.votes.last, ('r1', 1));
    expect(find.text('6'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('communityDown-r1')));
    await tester.pumpAndSettle();
    expect(repo.votes.last, ('r1', -1));
    expect(find.text('5'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('communityDown-r1')));
    await tester.pumpAndSettle();
    expect(repo.votes.last, ('r1', 0));
  });

  testWidgets('own reports cannot be voted on and a filter hides others', (
    tester,
  ) async {
    final repo = _FakeRepo([
      _report(id: 'mine', isMine: true),
      _report(id: 'cp', category: CommunityReportCategory.checkpointOutdated),
    ]);
    await _pump(tester, repo);

    final up = tester.widget<TextButton>(
      find.descendant(
        of: find.byKey(const ValueKey('communityUp-mine')),
        matching: find.byType(TextButton),
      ),
    );
    expect(up.onPressed, isNull);
    expect(find.byKey(const ValueKey('communityFlag-mine')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('communityGroup-checkpoint')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('communityReport-mine')), findsNothing);
    expect(find.byKey(const ValueKey('communityReport-cp')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('communityGroup-safety')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('communityEmpty')), findsOneWidget);
  });

  testWidgets('sensitive reports read as unverified and can be flagged', (
    tester,
  ) async {
    final repo = _FakeRepo([
      _report(id: 'd', category: CommunityReportCategory.driverReport),
    ]);
    await _pump(tester, repo);

    expect(
      find.text('Unverified report: Trip or driver feedback'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('communityFlag-d')));
    await tester.pumpAndSettle();
    expect(repo.flagged, ['d']);
    expect(find.text('Thanks. Our team will look at this report.'), findsOne);
  });

  testWidgets('submit sheet validates, warns on sensitive types, and posts', (
    tester,
  ) async {
    final repo = _FakeRepo([]);
    await _pump(tester, repo);

    await tester.tap(find.byKey(const ValueKey('communityAdd')));
    await tester.pumpAndSettle();
    FilledButton submit() => tester.widget<FilledButton>(
      find.byKey(const ValueKey('communitySubmit')),
    );
    expect(submit().onPressed, isNull);
    expect(find.byKey(const ValueKey('communitySensitiveNote')), findsNothing);

    await tester.tap(
      find.byKey(const ValueKey('communityCategory-driver_report')),
    );
    await tester.pump();
    expect(
      find.byKey(const ValueKey('communitySensitiveNote')),
      findsOneWidget,
    );

    await tester.enterText(
      find.byKey(const ValueKey('communityDescription')),
      'The vehicle stopped for a long time',
    );
    await tester.enterText(
      find.byKey(const ValueKey('communityLocation')),
      'Main junction',
    );
    await tester.pump();
    expect(submit().onPressed, isNotNull);
    await tester.tap(find.byKey(const ValueKey('communitySubmit')));
    await tester.pumpAndSettle();

    expect(repo.created, [CommunityReportCategory.driverReport]);
    expect(find.byKey(const ValueKey('communitySubmit')), findsNothing);
  });

  testWidgets('a rate-limited submit keeps the sheet with its own message', (
    tester,
  ) async {
    final repo = _FakeRepo([])
      ..createFailure = const ApiException(
        ApiErrorType.server,
        'too_many_reports',
        statusCode: 429,
      );
    await _pump(tester, repo);
    await tester.tap(find.byKey(const ValueKey('communityAdd')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('communityDescription')),
      'Heavy traffic',
    );
    await tester.enterText(
      find.byKey(const ValueKey('communityLocation')),
      'Ramallah',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('communitySubmit')));
    await tester.pumpAndSettle();
    expect(find.text('You have sent many reports. Try again later.'), findsOne);
  });

  testWidgets('renders in Arabic', (tester) async {
    await _pump(
      tester,
      _FakeRepo([_report(up: 1)]),
      locale: const Locale('ar'),
    );
    expect(find.text('بلاغات المجتمع'), findsOneWidget);
    expect(find.textContaining('لا يغيّر حالة الحواجز'), findsOneWidget);
  });

  testWidgets('map markers only for located reports and avoid free text', (
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
    final markers = communityReportMarkers(l10n, [
      _report(id: 'a', lat: 32.2, lng: 35.2),
      _report(id: 'b'),
    ]);
    expect(markers, hasLength(1));
    expect(markers.single.label, contains('Unverified report'));
    expect(markers.single.label, isNot(contains('blocked')));
  });
}
