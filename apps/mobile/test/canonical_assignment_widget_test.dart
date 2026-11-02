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

void main() {
  testWidgets('Arabic driver offers render RTL at 200 percent text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(720, 1280);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      _testApp(
        locale: const Locale('ar'),
        client: _client((request) async {
          if (request.url.path.endsWith('/capabilities')) {
            return _response(capabilitiesJson());
          }
          return _response({
            'offers': [offerJson()],
            'next_cursor': null,
            'server_now': '2026-07-27T10:00:00.000Z',
          });
        }),
        home: const DriverCanonicalOfferListScreen(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('عروض المسار'), findsWidgets);
    expect(find.text('طلب راكب'), findsOneWidget);
    expect(find.text('الخليل إلى بيت لحم'), findsOneWidget);
    expect(
      tester
          .widget<Directionality>(find.byType(Directionality).first)
          .textDirection,
      TextDirection.rtl,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('English passenger assignment truthfully shows trip boundary', (
    tester,
  ) async {
    await tester.pumpWidget(
      _testApp(
        locale: const Locale('en'),
        client: _client((request) async {
          if (request.url.path.endsWith('/capabilities')) {
            return _response(capabilitiesJson());
          }
          return _response({
            'requests': [assignmentJson()],
            'server_now': '2026-07-27T10:00:00.000Z',
          });
        }),
        home: const CanonicalAssignmentListScreen(role: 'passenger'),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Route requests and assignments'), findsOneWidget);
    expect(find.text('Assigned'), findsOneWidget);
    expect(find.textContaining('Live tracking'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shared passenger assignment is neutral and co-member blind', (
    tester,
  ) async {
    await tester.pumpWidget(
      _testApp(
        locale: const Locale('en'),
        client: _client((request) async {
          if (request.url.path.endsWith('/capabilities')) {
            return _response({
              ...capabilitiesJson(),
              'canonical_shared_trip_presentation_available': true,
              'canonical_shared_driver_offers_available': true,
              'canonical_shared_assignment_status_available': true,
            });
          }
          if (request.url.path.endsWith('/route-requests/request_1')) {
            return _response({
              'request': assignmentJson(shared: true),
              'server_now': '2026-07-27T10:00:00.000Z',
            });
          }
          return _response({
            'requests': [assignmentJson(shared: true)],
            'server_now': '2026-07-27T10:00:00.000Z',
          });
        }),
        home: const CanonicalAssignmentDetailScreen(
          role: 'passenger',
          assignmentId: 'request_1',
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('Assigned to a shared trip'),
      150,
      scrollable: find.byType(Scrollable).last,
    );

    expect(find.text('Assigned to a shared trip'), findsOneWidget);
    expect(
      find.textContaining('Other trip members are private'),
      findsOneWidget,
    );
    expect(find.text('Van'), findsNothing);
    expect(find.textContaining('Passenger requests'), findsNothing);
    expect(find.textContaining('Merchant orders'), findsNothing);
    expect(find.textContaining('Live tracking'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('disabled shared assignment uses a dedicated unavailable state', (
    tester,
  ) async {
    await tester.pumpWidget(
      _testApp(
        locale: const Locale('en'),
        client: _client((request) async {
          if (request.url.path.endsWith('/capabilities')) {
            return _response(capabilitiesJson());
          }
          return _response({
            'request': assignmentJson(shared: true),
            'server_now': '2026-07-27T10:00:00.000Z',
          });
        }),
        home: const CanonicalAssignmentDetailScreen(
          role: 'passenger',
          assignmentId: 'request_1',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.text(
        'Shared-trip assignment details are not available in this environment.',
      ),
      findsOneWidget,
    );
    expect(find.text('Assigned'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('unknown Trip and vehicle enums use safe localized wording', (
    tester,
  ) async {
    final assignment = assignmentJson();
    final trip = assignment['trip'] as Map<String, dynamic>;
    trip['status'] = 'future_status';
    trip['vehicle_type'] = 'hovercraft';
    await tester.pumpWidget(
      _testApp(
        locale: const Locale('en'),
        client: _client((request) async {
          if (request.url.path.endsWith('/capabilities')) {
            return _response(capabilitiesJson());
          }
          return _response({
            'request': assignment,
            'server_now': '2026-07-27T10:00:00.000Z',
          });
        }),
        home: const CanonicalAssignmentDetailScreen(
          role: 'passenger',
          assignmentId: 'request_1',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('Status unavailable'), findsOneWidget);
    expect(find.textContaining('Vehicle type unavailable'), findsOneWidget);
    expect(
      find.textContaining('not supported by this app version'),
      findsOneWidget,
    );
    expect(find.textContaining('future_status'), findsNothing);
    expect(find.textContaining('hovercraft'), findsNothing);
  });
}

Widget _testApp({
  required Locale locale,
  required AuthenticatedApiClient client,
  required Widget home,
}) {
  return ProviderScope(
    overrides: [authenticatedApiClientProvider.overrideWithValue(client)],
    child: MaterialApp(
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: const TextScaler.linear(2)),
        child: child!,
      ),
      home: home,
    ),
  );
}

AuthenticatedApiClient _client(
  Future<http.Response> Function(http.Request request) handler,
) => TestAuthenticatedClient(handler: handler).client;

http.Response _response(Map<String, dynamic> value) => http.Response.bytes(
  utf8.encode(jsonEncode(value)),
  200,
  headers: const {'content-type': 'application/json; charset=utf-8'},
);

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
