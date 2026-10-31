import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/features/merchant/application/merchant_report_provider.dart';
import 'package:masari_mobile/features/merchant/data/merchant_report_models.dart';
import 'package:masari_mobile/features/merchant/presentation/merchant_reports_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

Future<void> _pump(
  WidgetTester tester,
  Future<MerchantReportSummary> Function() load, {
  Locale locale = const Locale('en'),
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [merchantReportSummaryProvider.overrideWith((ref) => load())],
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const MerchantReportsScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  test('parses the summary payload', () {
    final summary = MerchantReportSummary.fromJson({
      'orders': {
        'total': 3,
        'parcels': 7,
        'by_status': {'submitted': 1, 'assigned': 2},
      },
      'trips': {
        'total': 1,
        'by_status': {'in_transit': 1},
      },
    });
    expect(summary.ordersTotal, 3);
    expect(summary.parcels, 7);
    expect(summary.ordersByStatus['assigned'], 2);
    expect(summary.tripsByStatus['in_transit'], 1);
  });

  testWidgets('shows real counts and a status breakdown', (tester) async {
    await _pump(
      tester,
      () async => const MerchantReportSummary(
        ordersTotal: 3,
        ordersByStatus: {'submitted': 1, 'assigned': 2},
        parcels: 7,
        tripsTotal: 1,
        tripsByStatus: {'in_transit': 1},
      ),
    );

    expect(
      tester.widget<Text>(find.byKey(const ValueKey('reportsOrderCount'))).data,
      '3',
    );
    expect(
      tester
          .widget<Text>(find.byKey(const ValueKey('reportsParcelCount')))
          .data,
      '7',
    );
    expect(
      tester
          .widget<Text>(find.byKey(const ValueKey('reportsOrders-assigned')))
          .data,
      '2',
    );
    expect(find.text('Assigned'), findsOneWidget);
    expect(find.text('In transit'), findsOneWidget);
  });

  testWidgets('an empty merchant sees zeroes and an explicit empty state', (
    tester,
  ) async {
    await _pump(
      tester,
      () async => const MerchantReportSummary(
        ordersTotal: 0,
        ordersByStatus: {},
        parcels: 0,
        tripsTotal: 0,
        tripsByStatus: {},
      ),
    );

    expect(
      tester.widget<Text>(find.byKey(const ValueKey('reportsOrderCount'))).data,
      '0',
    );
    expect(find.text('No records yet.'), findsNWidgets(2));
  });

  testWidgets('a failure is shown as an error with retry, not as zero', (
    tester,
  ) async {
    var attempts = 0;
    await _pump(tester, () async {
      attempts += 1;
      throw StateError('offline');
    });

    expect(find.text('Could not load the report.'), findsOneWidget);
    expect(find.byKey(const ValueKey('reportsOrderCount')), findsNothing);

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(attempts, 2);
  });

  testWidgets('renders in Arabic', (tester) async {
    await _pump(
      tester,
      () async => const MerchantReportSummary(
        ordersTotal: 1,
        ordersByStatus: {'submitted': 1},
        parcels: 1,
        tripsTotal: 0,
        tripsByStatus: {},
      ),
      locale: const Locale('ar'),
    );

    expect(find.text('الطلبات حسب الحالة'), findsOneWidget);
  });
}
