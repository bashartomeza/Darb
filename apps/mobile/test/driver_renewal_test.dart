import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/auth/application/auth_actor_binding.dart';
import 'package:masari_mobile/features/auth/data/authenticated_api_client.dart';
import 'package:masari_mobile/features/driver_renewal/data/driver_renewal_repository.dart';
import 'package:masari_mobile/features/driver_renewal/presentation/driver_renewal_banner.dart';
import 'package:masari_mobile/features/driver_renewal/presentation/driver_renewal_screen.dart';
import 'package:masari_mobile/features/notifications/presentation/notifications_screen.dart';
import 'package:masari_mobile/features/onboarding/domain/onboarding_models.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import 'support/auth_test_support.dart';

Map<String, dynamic> _stateJson({
  String status = 'documents_expired',
  bool canUpload = true,
  bool submitted = false,
  List<Map<String, dynamic>> documents = const [],
}) => {
  'status': status,
  'can_upload': canUpload,
  'submitted': submitted,
  'documents_expired_at': '2026-07-01T00:00:00.000Z',
  'renewal_submitted_at': submitted ? '2026-07-02T00:00:00.000Z' : null,
  'documents': documents,
  'limits': {
    'max_documents': 6,
    'max_bytes': 1024,
    'kinds': ['driver_licence', 'vehicle_registration', 'insurance', 'other'],
  },
};

void main() {
  group('repository', () {
    test('parses state and calls the renewal endpoints', () async {
      final calls = <String>[];
      List<int>? uploaded;
      String? contentType;
      final repository = DriverRenewalRepository(
        apiClient: _client((request) async {
          calls.add(
            '${request.method} ${request.url.path}${request.url.query.isEmpty ? '' : '?${request.url.query}'}',
          );
          if (request.method == 'POST' &&
              request.url.path.endsWith('/documents')) {
            uploaded = request.bodyBytes;
            contentType = request.headers['content-type'];
            return http.Response(
              jsonEncode({
                'document': {
                  'id': 'd9',
                  'kind': 'driver_licence',
                  'size_bytes': 3,
                },
              }),
              201,
            );
          }
          if (request.method == 'GET') {
            return http.Response(jsonEncode(_stateJson()), 200);
          }
          return http.Response('{}', 200);
        }),
      );

      final state = await repository.state();
      expect(state.status, 'documents_expired');
      expect(state.canUpload, isTrue);
      expect(state.needsAttention, isTrue);
      expect(state.maxBytes, 1024);

      final document = await repository.upload(
        kind: 'driver_licence',
        bytes: [1, 2, 3],
      );
      expect(document.id, 'd9');
      expect(uploaded, [1, 2, 3]);
      expect(contentType, 'application/octet-stream');

      await repository.delete('d9');
      await repository.submit();
      expect(calls, [
        'GET /api/v1/driver/document-renewal',
        'POST /api/v1/driver/document-renewal/documents?kind=driver_licence',
        'DELETE /api/v1/driver/document-renewal/documents/d9',
        'POST /api/v1/driver/document-renewal/submit',
      ]);
    });

    test('rejects a malformed state', () {
      expect(
        () => DriverRenewalState.fromJson({'status': 'x'}),
        throwsFormatException,
      );
    });
  });

  group('screen', () {
    testWidgets('uploads, removes and submits, then waits for review', (
      tester,
    ) async {
      final repository = _FakeRenewalRepository();
      await _pump(
        tester,
        repository,
        const DriverRenewalScreen(pickFile: _pickJpeg),
      );

      expect(find.byKey(const ValueKey('renewalNoDocuments')), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(find.byKey(const ValueKey('renewalSubmit')))
            .onPressed,
        isNull,
      );

      await tester.tap(find.byKey(const ValueKey('renewalAdd')));
      await tester.pumpAndSettle();
      expect(repository.uploads, [('driver_licence', 4)]);
      expect(find.byKey(const ValueKey('renewalDocument-d1')), findsOneWidget);

      await tester.tap(find.byTooltip('Remove document'));
      await tester.pumpAndSettle();
      expect(repository.deleted, ['d1']);
      expect(find.byKey(const ValueKey('renewalDocument-d1')), findsNothing);

      await tester.tap(find.byKey(const ValueKey('renewalAdd')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('renewalSubmit')));
      await tester.pumpAndSettle();
      expect(repository.submitCalls, 1);
      expect(find.byKey(const ValueKey('renewalSubmitted')), findsOneWidget);
      expect(find.text('Waiting for review'), findsOneWidget);
      expect(find.byKey(const ValueKey('renewalAdd')), findsNothing);
    });

    testWidgets('refuses an oversized file before uploading', (tester) async {
      final repository = _FakeRenewalRepository(maxBytes: 3);
      await _pump(
        tester,
        repository,
        const DriverRenewalScreen(pickFile: _pickJpeg),
      );
      await tester.tap(find.byKey(const ValueKey('renewalAdd')));
      await tester.pumpAndSettle();
      expect(repository.uploads, isEmpty);
      expect(find.text('That file is too large. The limit is 5 MB.'), findsOne);
    });

    testWidgets('does nothing when the picker is cancelled', (tester) async {
      final repository = _FakeRenewalRepository();
      await _pump(
        tester,
        repository,
        DriverRenewalScreen(pickFile: () async => null),
      );
      await tester.tap(find.byKey(const ValueKey('renewalAdd')));
      await tester.pumpAndSettle();
      expect(repository.uploads, isEmpty);
    });

    testWidgets('shows a message when the server says documents are required', (
      tester,
    ) async {
      final repository = _FakeRenewalRepository()
        ..documents.add(const _Doc('d1', 'driver_licence'))
        ..submitError = const ApiException(
          ApiErrorType.unknown,
          'renewal_documents_required',
          statusCode: 409,
        );
      await _pump(
        tester,
        repository,
        const DriverRenewalScreen(pickFile: _pickJpeg),
      );
      await tester.tap(find.byKey(const ValueKey('renewalSubmit')));
      await tester.pumpAndSettle();
      expect(
        find.text('Upload at least one renewed document before sending.'),
        findsOneWidget,
      );
    });

    testWidgets('shows the waiting state when already submitted', (
      tester,
    ) async {
      final repository = _FakeRenewalRepository()..submitted = true;
      await _pump(tester, repository, const DriverRenewalScreen());
      expect(find.byKey(const ValueKey('renewalSubmitted')), findsOneWidget);
    });
  });

  group('banner', () {
    testWidgets('shows only when renewal is needed', (tester) async {
      final repository = _FakeRenewalRepository();
      await _pump(tester, repository, const DriverRenewalBanner());
      expect(find.byKey(const ValueKey('driverRenewalBanner')), findsOneWidget);
      expect(find.text('Your documents have expired'), findsOneWidget);
    });

    testWidgets('shows the review state after submitting', (tester) async {
      final repository = _FakeRenewalRepository()..submitted = true;
      await _pump(tester, repository, const DriverRenewalBanner());
      expect(find.text('Renewal under review'), findsOneWidget);
    });

    testWidgets('is hidden for an approved driver or on 404', (tester) async {
      final approved = _FakeRenewalRepository()..approved = true;
      await _pump(tester, approved, const DriverRenewalBanner());
      expect(find.byKey(const ValueKey('driverRenewalBanner')), findsNothing);

      final missing = _FakeRenewalRepository()
        ..stateError = const ApiException(
          ApiErrorType.unknown,
          'driver_documents_unavailable',
          statusCode: 404,
        );
      await _pump(tester, missing, const DriverRenewalBanner());
      expect(find.byKey(const ValueKey('driverRenewalBanner')), findsNothing);
    });
  });

  test('expiry notifications open the renewal screen', () {
    expect(opensDriverRenewal('driver_documents_expired'), isTrue);
    expect(opensDriverRenewal('driver_documents_expiring'), isTrue);
    expect(opensDriverRenewal('driver_documents_renewal_submitted'), isTrue);
    expect(opensDriverRenewal('match_offered'), isFalse);
  });
}

Future<List<int>?> _pickJpeg() async => [0xff, 0xd8, 0xff, 1];

AuthenticatedApiClient _client(
  Future<http.Response> Function(http.Request request) handler,
) => TestAuthenticatedClient(handler: handler).client;

Future<void> _pump(
  WidgetTester tester,
  _FakeRenewalRepository repository,
  Widget child,
) async {
  tester.view.physicalSize = const Size(1000, 2000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authenticatedActorBindingProvider.overrideWithValue(
          AuthenticatedActorBinding()..bind('driver-1'),
        ),
        driverRenewalRepositoryProvider.overrideWithValue(repository),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: child is Scaffold || child is DriverRenewalScreen
            ? child
            : Scaffold(body: SingleChildScrollView(child: child)),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _Doc {
  const _Doc(this.id, this.kind);
  final String id;
  final String kind;
}

class _FakeRenewalRepository implements DriverRenewalRepository {
  _FakeRenewalRepository({this.maxBytes = 1024});

  final int maxBytes;
  final documents = <_Doc>[];
  final uploads = <(String, int)>[];
  final deleted = <String>[];
  int submitCalls = 0;
  int _next = 1;
  bool submitted = false;
  bool approved = false;
  Object? submitError;
  Object? stateError;

  @override
  AuthenticatedApiClient get apiClient => throw UnimplementedError();

  @override
  Future<DriverRenewalState> state() async {
    if (stateError != null) throw stateError!;
    return DriverRenewalState.fromJson(
      _stateJson(
          status: approved
              ? 'approved'
              : submitted
              ? 'pending'
              : 'documents_expired',
          canUpload: !approved && !submitted,
          submitted: submitted,
          documents: [
            for (final doc in documents)
              {'id': doc.id, 'kind': doc.kind, 'size_bytes': 2048},
          ],
        )
        ..['limits'] = {
          'max_documents': 6,
          'max_bytes': maxBytes,
          'kinds': ['driver_licence', 'vehicle_registration', 'insurance'],
        },
    );
  }

  @override
  Future<DriverDocument> upload({
    required String kind,
    required List<int> bytes,
  }) async {
    uploads.add((kind, bytes.length));
    final doc = _Doc('d${_next++}', kind);
    documents.add(doc);
    return DriverDocument(id: doc.id, kind: kind, sizeBytes: bytes.length);
  }

  @override
  Future<void> delete(String id) async {
    deleted.add(id);
    documents.removeWhere((doc) => doc.id == id);
  }

  @override
  Future<void> submit() async {
    if (submitError != null) throw submitError!;
    submitCalls += 1;
    submitted = true;
  }
}
