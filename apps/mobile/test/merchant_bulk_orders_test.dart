import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:darb_mobile/features/merchant/data/merchant_bulk_models.dart';
import 'package:darb_mobile/features/merchant/data/merchant_repository.dart';
import 'package:darb_mobile/features/merchant/presentation/merchant_bulk_orders_screen.dart';
import 'package:darb_mobile/features/operating_routes/data/operating_route_repository.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import 'support/auth_test_support.dart';
import 'support/operating_routes_fixture.dart';

const _previewJson =
    '{"total_rows":2,"valid_order_count":1,"error_count":1,"errors":[{"row":3,"field":"size","code":"row_invalid_size","message_en":"\\"size\\" must be S, M or L.","message_ar":"الحقل \\"الحجم\\" يجب أن يكون S أو M أو L."}],"orders":[],"batch_plan":{"batches":[{"order_rows":[2]}],"unbatchable":[]},"limits":{"max_rows":50}}';
const _resultJson =
    '{"summary":{"total_rows":2,"created":1,"replayed":0,"failed":1},"results":[{"rows":[2],"status":"created","order_id":"o1"},{"rows":[3],"status":"invalid","code":"row_invalid_size","message_en":"bad size","message_ar":"حجم غير صالح"}],"batch_ids":[]}';

http.Response _json(String body, int status) => http.Response(
  body,
  status,
  headers: const {'content-type': 'application/json; charset=utf-8'},
);

MerchantRepository _repository(
  Future<http.Response> Function(http.Request) handler,
) => MerchantRepository(
  apiClient: TestAuthenticatedClient(handler: handler).client,
);

const _header = 'route_key,pickup_details,dropoff_details,size,priority';
const _csv =
    '$_header\n'
    'hebron-to-bethlehem,Al-Amal store,Manger Street,S,normal\n'
    'hebron-to-bethlehem,Al-Amal store,Old market,XL,normal\n';

Future<void> _pumpScreen(
  WidgetTester tester,
  MerchantRepository repository,
) async {
  // Tall enough that the route-key list and the actions are all built.
  tester.view.physicalSize = const Size(900, 2200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        merchantRepositoryProvider.overrideWithValue(repository),
        operatingRoutesProvider.overrideWith(
          (ref) async => testOperatingRoutes(),
        ),
      ],
      child: const MaterialApp(
        locale: Locale('en'),
        localizationsDelegates: [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: MerchantBulkOrdersScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tap(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(ValueKey(key)));
  await tester.tap(find.byKey(ValueKey(key)));
  await tester.pumpAndSettle();
}

void main() {
  test(
    'preview and submit parse row errors and send the idempotency key',
    () async {
      http.Request? submitted;
      final repository = _repository((request) async {
        if (request.url.path.endsWith('/bulk/preview')) {
          return _json(_previewJson, 200);
        }
        submitted = request;
        return _json(_resultJson, 201);
      });

      final preview = await repository.previewBulkOrders('a,b');
      expect(preview.validOrderCount, 1);
      expect(preview.batchCount, 1);
      expect(preview.hasErrors, isTrue);
      expect(preview.errors.single.message(true), contains('الحجم'));
      expect(preview.errors.single.message(false), contains('size'));

      final result = await repository.submitBulkOrders(
        'a,b',
        idempotencyKey: 'upload-key-0001',
        skipInvalid: true,
      );
      expect(submitted!.headers['idempotency-key'], 'upload-key-0001');
      expect(jsonDecode(submitted!.body), {'csv': 'a,b', 'skip_invalid': true});
      expect(result.created, 1);
      expect(result.failures.single.rows, [3]);
      expect(result.failures.single.message(true), 'حجم غير صالح');
    },
  );

  testWidgets('screen walks input, preview with errors, submit and result', (
    tester,
  ) async {
    final keys = <String?>[];
    final repository = _repository((request) async {
      if (request.url.path.endsWith('/bulk/preview')) {
        return _json(_previewJson, 200);
      }
      keys.add(request.headers['idempotency-key']);
      // First submit loses its response; the retry must reuse the same key.
      if (keys.length == 1) return http.Response('{"error":"x"}', 500);
      return _json(_resultJson, 201);
    });
    await _pumpScreen(tester, repository);

    await tester.enterText(find.byKey(const ValueKey('bulkCsvField')), _csv);
    await _tap(tester, 'bulkPreviewButton');

    expect(find.textContaining('must be S, M or L'), findsOneWidget);
    // Submit is blocked until the merchant chooses to skip the invalid row.
    var submit = tester.widget<FilledButton>(
      find.byKey(const ValueKey('bulkSubmitButton')),
    );
    expect(submit.onPressed, isNull);
    await _tap(tester, 'bulkSkipInvalid');

    await _tap(tester, 'bulkSubmitButton');
    expect(find.textContaining('will not create duplicates'), findsOneWidget);

    submit = tester.widget<FilledButton>(
      find.byKey(const ValueKey('bulkSubmitButton')),
    );
    await _tap(tester, 'bulkSubmitButton');

    expect(keys, hasLength(2));
    expect(keys[0], isNotNull);
    expect(keys[1], keys[0]);
    expect(find.text('Upload result'), findsOneWidget);
    expect(find.text('bad size'), findsOneWidget);
  });

  testWidgets('screen lists the route keys and inserts a route example', (
    tester,
  ) async {
    await _pumpScreen(tester, _repository((_) async => _json('{}', 500)));
    expect(
      find.text('hebron-to-bethlehem — Hebron → Bethlehem'),
      findsOneWidget,
    );
    await _tap(tester, 'bulkTemplateButton');
    final csv = tester
        .widget<TextField>(find.byKey(const ValueKey('bulkCsvField')))
        .controller!
        .text;
    expect(
      csv.split('\n').first,
      'route_key,pickup_details,dropoff_details,size,priority,receiver_name,receiver_phone',
    );
    expect(csv.split('\n')[1], startsWith('hebron-to-bethlehem,'));
    // The example passes the app's own route check.
    expect(checkBulkCsvRoutes(csv, testOperatingRoutes()).errors, isEmpty);
  });

  testWidgets(
    'an unknown route_key is a clear row error naming the running routes',
    (tester) async {
      final repository = _repository((request) async {
        if (request.url.path.endsWith('/bulk/preview')) {
          // The server's own, less helpful error for the same row.
          return _json(
            '{"total_rows":2,"valid_order_count":1,"errors":[{"row":3,"field":"route_key","code":"row_route_unavailable","message_en":"Route unavailable.","message_ar":"المسار غير متاح."}],"batch_plan":{"batches":[]},"limits":{"max_rows":50}}',
            200,
          );
        }
        return _json(_resultJson, 201);
      });
      await _pumpScreen(tester, repository);
      await tester.enterText(
        find.byKey(const ValueKey('bulkCsvField')),
        '$_header\n'
        'hebron-to-bethlehem,Al-Amal store,Manger Street,S,normal\n'
        'hebron-to-jerusalem,Al-Amal store,Old city,S,normal\n',
      );
      await _tap(tester, 'bulkPreviewButton');

      expect(
        find.text(
          'Unknown route_key "hebron-to-jerusalem". Use one of: '
          'hebron-to-bethlehem, bethlehem-to-hebron.',
        ),
        findsOneWidget,
      );
      expect(find.text('Route unavailable.'), findsNothing);
      expect(
        find.byKey(const ValueKey('bulkError-3-unknown_route_key')),
        findsOneWidget,
      );
      // The preview names the valid rows' route.
      expect(
        find.byKey(const ValueKey('bulkRouteCount-hebron-to-bethlehem')),
        findsOneWidget,
      );
      expect(find.text('Hebron → Bethlehem: 1'), findsOneWidget);
    },
  );

  testWidgets('missing columns are a whole-file error without a server call', (
    tester,
  ) async {
    var calls = 0;
    await _pumpScreen(
      tester,
      _repository((_) async {
        calls++;
        return _json(_previewJson, 200);
      }),
    );
    await tester.enterText(
      find.byKey(const ValueKey('bulkCsvField')),
      'pickup_label,pickup_lat,pickup_lng,destination_label,size,priority\n'
      'Hebron Depot,31.5,35.1,Bethlehem Center,S,normal\n',
    );
    await _tap(tester, 'bulkPreviewButton');

    expect(calls, 0);
    expect(find.textContaining('Missing columns: route_key'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const ValueKey('bulkSubmitButton')))
          .onPressed,
      isNull,
    );
  });

  test('CSV records keep quoted commas, quotes and line breaks', () {
    expect(
      parseCsvRecords(
        'a,b\r\n"Store, Ein Sarah","say ""hi""\nthere"\n\n x ,\n',
      ),
      [
        ['a', 'b'],
        ['Store, Ein Sarah', 'say "hi"\nthere'],
        [' x ', ''],
      ],
    );
  });

  test('route check counts rows per route and flags empty keys', () {
    final check = checkBulkCsvRoutes(
      '$_header\n'
      'hebron-to-bethlehem,a,b,S,normal\n'
      ',a,b,S,normal\n'
      'bethlehem-to-hebron,a,b,S,normal\n'
      'hebron-to-bethlehem,c,d,M,high\n',
      testOperatingRoutes(),
    );
    expect(check.totalRows, 4);
    expect(check.rowsByRoute, {
      'hebron-to-bethlehem': 2,
      'bethlehem-to-hebron': 1,
    });
    expect(check.errors.single.row, 3);
    expect(check.errors.single.message(true), contains('فارغ'));
    expect(check.hasFileError, isFalse);
  });

  test('BulkRowError falls back to the other language when one is empty', () {
    const error = BulkRowError(
      row: 2,
      field: null,
      code: 'x',
      messageEn: 'only english',
      messageAr: '',
    );
    expect(error.message(true), 'only english');
  });
}
