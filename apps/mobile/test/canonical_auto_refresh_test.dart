import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:darb_mobile/features/auth/data/authenticated_api_client.dart';
import 'package:darb_mobile/features/canonical_assignments/presentation/canonical_assignment_screens.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import 'canonical_assignments_test.dart';
import 'support/auth_test_support.dart';

/// A merchant's order is matched by the server after submission, so the driver
/// and merchant screens must pick the change up on the project's standard
/// foreground cadence (ForegroundRefresh, 5 s) without a manual pull.
void main() {
  testWidgets('driver offer list shows a newly created offer without a pull', (
    tester,
  ) async {
    var offers = <Map<String, dynamic>>[];
    var offerReads = 0;
    await tester.pumpWidget(
      _app(const DriverCanonicalOfferListScreen(), (request) async {
        if (request.url.path.endsWith('/capabilities')) {
          return _json(capabilitiesJson());
        }
        offerReads++;
        return _json({
          'offers': offers,
          'next_cursor': null,
          'server_now': '2026-07-27T10:00:00.000Z',
        });
      }),
    );
    await tester.pumpAndSettle();
    expect(find.text('Hebron to Bethlehem'), findsNothing);
    final initialReads = offerReads;

    offers = [offerJson()];
    await tester.pump(const Duration(seconds: 6));
    await tester.pumpAndSettle();

    expect(offerReads, greaterThan(initialReads));
    expect(find.text('Hebron to Bethlehem'), findsOneWidget);
  });

  testWidgets('merchant order list reflects a status change without a pull', (
    tester,
  ) async {
    var dispatchStatus = 'pending';
    await tester.pumpWidget(
      _app(const CanonicalAssignmentListScreen(role: 'merchant'), (
        request,
      ) async {
        if (request.url.path.endsWith('/capabilities')) {
          return _json(capabilitiesJson());
        }
        final assigned = dispatchStatus == 'assigned';
        return _json({
          'orders': [
            {
              ...assignmentJson(id: 'order_1', merchant: true),
              'dispatch_status': dispatchStatus,
              'assignment_trip_version': assigned
                  ? 'canonical_route_trip_v1'
                  : null,
              if (!assigned) 'trip': null,
            },
          ],
          'server_now': '2026-07-27T10:00:00.000Z',
        });
      }),
    );
    await tester.pumpAndSettle();
    expect(find.text('Assigned'), findsNothing);

    dispatchStatus = 'assigned';
    await tester.pump(const Duration(seconds: 6));
    await tester.pumpAndSettle();

    expect(find.text('Assigned'), findsOneWidget);
  });
}

Widget _app(
  Widget home,
  Future<http.Response> Function(http.Request request) handler,
) {
  final AuthenticatedApiClient client = TestAuthenticatedClient(
    handler: handler,
  ).client;
  return ProviderScope(
    overrides: [authenticatedApiClientProvider.overrideWithValue(client)],
    child: MaterialApp(
      locale: const Locale('en'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: home,
    ),
  );
}

Map<String, dynamic> capabilitiesJson() => {
  'canonical_route_catalog_available': true,
  'canonical_multi_route_entry_available': true,
  'canonical_matching_available': true,
  'canonical_trip_creation_available': true,
  'driver_canonical_offers_available': true,
  'canonical_assignment_status_available': true,
  'maps_available': false,
  'live_tracking_available': false,
};

http.Response _json(Map<String, dynamic> value) => http.Response.bytes(
  utf8.encode(jsonEncode(value)),
  200,
  headers: const {'content-type': 'application/json; charset=utf-8'},
);
