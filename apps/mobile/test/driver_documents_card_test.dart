import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/onboarding/application/onboarding_controller.dart';
import 'package:masari_mobile/features/onboarding/data/onboarding_repository.dart';
import 'package:masari_mobile/features/onboarding/domain/onboarding_models.dart';
import 'package:masari_mobile/features/onboarding/presentation/driver_documents_card.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';
import 'package:http/http.dart' as http;

void main() {
  testWidgets(
    'lists, adds and removes documents with the pending session token',
    (tester) async {
      final repository = _FakeRepository();
      await _pump(tester, repository, pick: () async => [0xff, 0xd8, 0xff, 1]);

      expect(find.text('Verification documents'), findsOneWidget);
      expect(find.byKey(const ValueKey('driverDocument-d1')), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('driverDocumentAdd')));
      await tester.pumpAndSettle();

      expect(repository.uploads, [('driver_licence', 4)]);
      expect(repository.tokens.toSet(), {'pending-token'});
      expect(find.byKey(const ValueKey('driverDocument-d2')), findsOneWidget);

      await tester.tap(find.byTooltip('Remove document').first);
      await tester.pumpAndSettle();
      expect(repository.deleted, ['d1']);
      expect(find.byKey(const ValueKey('driverDocument-d1')), findsNothing);
    },
  );

  testWidgets('does nothing when the picker is cancelled', (tester) async {
    final repository = _FakeRepository();
    await _pump(tester, repository, pick: () async => null);
    await tester.tap(find.byKey(const ValueKey('driverDocumentAdd')));
    await tester.pumpAndSettle();
    expect(repository.uploads, isEmpty);
  });

  testWidgets('refuses an oversized file before uploading it', (tester) async {
    final repository = _FakeRepository(maxBytes: 3);
    await _pump(tester, repository, pick: () async => [1, 2, 3, 4]);
    await tester.tap(find.byKey(const ValueKey('driverDocumentAdd')));
    await tester.pumpAndSettle();
    expect(repository.uploads, isEmpty);
    expect(
      find.text('That file is too large. The limit is 5 MB.'),
      findsOneWidget,
    );
  });

  testWidgets('shows a clear message when the server rejects the type', (
    tester,
  ) async {
    final repository = _FakeRepository()..uploadStatus = 415;
    await _pump(tester, repository, pick: () async => [1, 2]);
    await tester.tap(find.byKey(const ValueKey('driverDocumentAdd')));
    await tester.pumpAndSettle();
    expect(
      find.text('Only JPEG, PNG or PDF files can be uploaded.'),
      findsOneWidget,
    );
  });

  testWidgets('a shop owner sees shop papers and uses the shop endpoints', (
    tester,
  ) async {
    final repository = _FakeRepository();
    await _pump(
      tester,
      repository,
      pick: () async => [0xff, 0xd8, 0xff, 1],
      merchant: true,
    );

    expect(find.textContaining('commercial register'), findsWidgets);
    await tester.tap(find.byKey(const ValueKey('driverDocumentAdd')));
    await tester.pumpAndSettle();

    expect(repository.uploads, [('commercial_register', 4)]);
    expect(repository.merchantCalls.toSet(), {true});
  });

  testWidgets('stays hidden when the server has uploads switched off', (
    tester,
  ) async {
    final repository = _FakeRepository()..listStatus = 404;
    await _pump(tester, repository, pick: () async => null);
    expect(find.text('Verification documents'), findsNothing);
  });
}

Future<void> _pump(
  WidgetTester tester,
  _FakeRepository repository, {
  required Future<List<int>?> Function() pick,
  bool merchant = false,
}) async {
  tester.view.physicalSize = const Size(1000, 1800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        onboardingRepositoryProvider.overrideWithValue(repository),
        onboardingControllerProvider.overrideWith(_PendingOnboarding.new),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: SingleChildScrollView(
            child: DriverDocumentsCard(merchant: merchant, pickFile: pick),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _PendingOnboarding extends OnboardingController {
  @override
  String? get pendingStatusToken => 'pending-token';

  @override
  Future<OnboardingState> build() async => const OnboardingState.checking();
}

class _FakeRepository extends OnboardingRepository {
  _FakeRepository({this.maxBytes = 5 * 1024 * 1024})
    : super(baseUrl: 'http://fixture.invalid', client: http.Client());

  final int maxBytes;
  int? listStatus;
  int? uploadStatus;
  final tokens = <String>[];
  final merchantCalls = <bool>[];
  final uploads = <(String, int)>[];
  final deleted = <String>[];
  final _documents = <DriverDocument>[
    const DriverDocument(id: 'd1', kind: 'national_id', sizeBytes: 2048),
  ];

  @override
  Future<DriverDocumentList> driverDocuments(
    String onboardingToken, {
    bool merchant = false,
  }) async {
    tokens.add(onboardingToken);
    merchantCalls.add(merchant);
    if (listStatus != null) {
      throw ApiException(
        ApiErrorType.unknown,
        'driver_documents_unavailable',
        statusCode: listStatus,
      );
    }
    return DriverDocumentList(
      documents: List.of(_documents),
      maxDocuments: 6,
      maxBytes: maxBytes,
    );
  }

  @override
  Future<DriverDocument> uploadDriverDocument(
    String onboardingToken, {
    required String kind,
    required List<int> bytes,
    bool merchant = false,
  }) async {
    tokens.add(onboardingToken);
    merchantCalls.add(merchant);
    if (uploadStatus != null) {
      throw ApiException(
        ApiErrorType.validation,
        'document_type_unsupported',
        statusCode: uploadStatus,
      );
    }
    uploads.add((kind, bytes.length));
    final document = DriverDocument(
      id: 'd2',
      kind: kind,
      sizeBytes: bytes.length,
    );
    _documents.add(document);
    return document;
  }

  @override
  Future<void> deleteDriverDocument(
    String onboardingToken,
    String id, {
    bool merchant = false,
  }) async {
    tokens.add(onboardingToken);
    deleted.add(id);
    _documents.removeWhere((document) => document.id == id);
  }
}
