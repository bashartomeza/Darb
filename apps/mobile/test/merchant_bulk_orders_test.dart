import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/features/merchant/data/merchant_bulk_models.dart';
import 'package:masari_mobile/features/merchant/data/merchant_repository.dart';
import 'package:masari_mobile/features/merchant/presentation/merchant_bulk_orders_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import 'support/auth_test_support.dart';

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
    await tester.pumpWidget(
      ProviderScope(
        overrides: [merchantRepositoryProvider.overrideWithValue(repository)],
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

    await tester.enterText(find.byKey(const ValueKey('bulkCsvField')), 'x,y');
    await tester.tap(find.byKey(const ValueKey('bulkPreviewButton')));
    await tester.pumpAndSettle();

    expect(find.textContaining('must be S, M or L'), findsOneWidget);
    // Submit is blocked until the merchant chooses to skip the invalid row.
    var submit = tester.widget<FilledButton>(
      find.byKey(const ValueKey('bulkSubmitButton')),
    );
    expect(submit.onPressed, isNull);
    await tester.tap(find.byKey(const ValueKey('bulkSkipInvalid')));
    await tester.pump();

    await tester.tap(find.byKey(const ValueKey('bulkSubmitButton')));
    await tester.pumpAndSettle();
    expect(find.textContaining('will not create duplicates'), findsOneWidget);

    submit = tester.widget<FilledButton>(
      find.byKey(const ValueKey('bulkSubmitButton')),
    );
    await tester.tap(find.byKey(const ValueKey('bulkSubmitButton')));
    await tester.pumpAndSettle();

    expect(keys, hasLength(2));
    expect(keys[0], isNotNull);
    expect(keys[1], keys[0]);
    expect(find.text('Upload result'), findsOneWidget);
    expect(find.text('bad size'), findsOneWidget);
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
