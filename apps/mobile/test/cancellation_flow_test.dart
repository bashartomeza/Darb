import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:darb_mobile/core/api/api_error.dart';
import 'package:darb_mobile/core/cancellation/cancellation.dart';
import 'package:darb_mobile/features/driver/data/driver_models.dart';
import 'package:darb_mobile/features/driver/data/driver_repository.dart';
import 'package:darb_mobile/features/driver/presentation/driver_ui.dart';
import 'package:darb_mobile/features/merchant/data/merchant_repository.dart';
import 'package:darb_mobile/features/passenger/data/passenger_models.dart';
import 'package:darb_mobile/features/passenger/data/passenger_repository.dart';
import 'package:darb_mobile/features/trips/data/trip_models.dart';
import 'package:darb_mobile/features/trips/presentation/passenger_cancel_trip_section.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import 'support/auth_test_support.dart';

Map<String, dynamic> _requestJson({
  String status = 'pending',
  Map<String, dynamic>? cancellation,
}) => {
  'id': 'request_1',
  'pickup_label': 'Hebron',
  'pickup_lat': '31.55',
  'pickup_lng': '35.1',
  'destination_label': 'Bethlehem',
  'destination_lat': '31.7',
  'destination_lng': '35.2',
  'preferred_time': '2026-07-02T09:00:00.000Z',
  'passenger_count': 1,
  'status': status,
  'created_at': '2026-07-01T09:00:00.000Z',
  'cancellation': cancellation,
};

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  List<Override> overrides = const [],
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: overrides,
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: SingleChildScrollView(child: child)),
      ),
    ),
  );
}

/// Opens the shared reason dialog for [role] and returns what the person chose.
Future<CancelChoice?> _askFor(
  WidgetTester tester,
  CancelRole role, {
  required Future<void> Function() answer,
  Locale locale = const Locale('en'),
}) async {
  CancelChoice? result;
  var done = false;
  await _pump(
    tester,
    Builder(
      builder: (context) => TextButton(
        onPressed: () async {
          result = await showCancelReasonDialog(
            context,
            role: role,
            title: 'Cancel?',
            message: 'Are you sure?',
            confirmLabel: 'Yes, cancel',
          );
          done = true;
        },
        child: const Text('open'),
      ),
    ),
    locale: locale,
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  await answer();
  await tester.pumpAndSettle();
  expect(done, isTrue);
  return result;
}

void main() {
  group('the reason dialog', () {
    for (final role in CancelRole.values) {
      testWidgets('${role.name}: offers exactly its own reasons', (
        tester,
      ) async {
        CancelChoice? result;
        await _pump(
          tester,
          Builder(
            builder: (context) => TextButton(
              onPressed: () async => result = await showCancelReasonDialog(
                context,
                role: role,
                title: 't',
                message: 'm',
                confirmLabel: 'c',
              ),
              child: const Text('open'),
            ),
          ),
        );
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();
        for (final code in role.reasons) {
          expect(find.byKey(ValueKey('cancelReason-$code')), findsOneWidget);
        }
        final shown = find.byWidgetPredicate(
          (widget) =>
              widget.key is ValueKey<String> &&
              (widget.key! as ValueKey<String>).value.startsWith(
                'cancelReason-',
              ),
        );
        expect(shown, findsNWidgets(role.reasons.length));
        expect(result, isNull);
      });
    }

    testWidgets('nothing can be confirmed until a reason is picked', (
      tester,
    ) async {
      final choice = await _askFor(
        tester,
        CancelRole.rider,
        answer: () async {
          expect(
            tester
                .widget<FilledButton>(
                  find.byKey(const ValueKey('cancelReasonConfirm')),
                )
                .onPressed,
            isNull,
          );
          await tester.tap(
            find.byKey(const ValueKey('cancelReason-found_other_transport')),
          );
          await tester.pump();
          await tester.enterText(
            find.byKey(const ValueKey('cancelNoteField')),
            '  took a taxi  ',
          );
          await tester.pump();
          await tester.tap(find.byKey(const ValueKey('cancelReasonConfirm')));
        },
      );
      expect(choice?.reason, 'found_other_transport');
      expect(choice?.note, 'took a taxi');
      expect(choice?.toBody(), {
        'reason': 'found_other_transport',
        'note': 'took a taxi',
      });
    });

    testWidgets('a reason without a note sends no note', (tester) async {
      final choice = await _askFor(
        tester,
        CancelRole.driver,
        answer: () async {
          await tester.tap(
            find.byKey(const ValueKey('cancelReason-emergency')),
          );
          await tester.pump();
          await tester.tap(find.byKey(const ValueKey('cancelReasonConfirm')));
        },
      );
      expect(choice?.toBody(), {'reason': 'emergency'});
    });

    testWidgets('keeping the trip cancels nothing', (tester) async {
      final choice = await _askFor(
        tester,
        CancelRole.sender,
        answer: () async {
          await tester.tap(find.byKey(const ValueKey('cancelReason-other')));
          await tester.pump();
          await tester.tap(find.byKey(const ValueKey('cancelReasonKeep')));
        },
      );
      expect(choice, isNull);
    });

    testWidgets('is written in Arabic for an Arabic app', (tester) async {
      await _askFor(
        tester,
        CancelRole.driver,
        locale: const Locale('ar'),
        answer: () async {
          expect(find.text('ما سبب الإلغاء؟'), findsOneWidget);
          expect(find.text('مشكلة في المركبة'), findsOneWidget);
          expect(find.text('حالة طارئة'), findsOneWidget);
          await tester.tap(find.byKey(const ValueKey('cancelReasonKeep')));
        },
      );
    });
  });

  group('what a cancelled item shows', () {
    final en = lookupAppLocalizations(const Locale('en'));
    final ar = lookupAppLocalizations(const Locale('ar'));

    test('parses who, why and whether it was automatic', () {
      final info = CancellationInfo.tryParse({
        'reason': 'vehicle_problem',
        'by': 'driver',
        'automatic': false,
        'at': '2026-11-12T10:00:00Z',
      });
      expect(info?.reason, 'vehicle_problem');
      expect(info?.by, 'driver');
      expect(info?.automatic, isFalse);
      expect(CancellationInfo.tryParse(null), isNull);
      expect(CancellationInfo.tryParse({'reason': 'x'}), isNull);
    });

    test('every reason code has a label in both languages', () {
      for (final code in [
        ...CancelRole.values.expand((role) => role.reasons),
        'customer_request',
        'driver_unavailable',
        'safety_concern',
        'duplicate',
        'policy_violation',
        'no_driver_in_time',
      ]) {
        expect(cancelReasonLabel(en, code), isNotEmpty);
        expect(cancelReasonLabel(ar, code), isNotEmpty);
        if (code != 'other') {
          expect(
            cancelReasonLabel(en, code),
            isNot(cancelReasonLabel(en, 'other')),
          );
        }
      }
      expect(cancelReasonLabel(en, 'something_new'), 'Other');
    });

    test('is worded by who cancelled and who is reading', () {
      const system = CancellationInfo(
        reason: 'no_driver_in_time',
        by: 'system',
        automatic: true,
      );
      const driver = CancellationInfo(
        reason: 'emergency',
        by: 'driver',
        automatic: false,
      );
      const admin = CancellationInfo(
        reason: 'duplicate',
        by: 'admin',
        automatic: false,
      );
      const passenger = CancellationInfo(
        reason: 'changed_plans',
        by: 'passenger',
        automatic: false,
      );
      const merchant = CancellationInfo(
        reason: 'wrong_details',
        by: 'merchant',
        automatic: false,
      );

      expect(
        cancellationSummary(en, system),
        'Cancelled automatically: No driver accepted in time',
      );
      expect(
        cancellationSummary(en, driver),
        'Cancelled by the driver: Emergency',
      );
      expect(
        cancellationSummary(en, admin),
        'Cancelled by the Darb team: Duplicate request',
      );
      expect(
        cancellationSummary(en, passenger),
        'You cancelled: Changed plans',
      );
      expect(
        cancellationSummary(en, passenger, viewerIsDriver: true),
        'Cancelled by the passenger: Changed plans',
      );
      expect(
        cancellationSummary(en, merchant, viewerIsDriver: true),
        'Cancelled by the sender: Wrong details entered',
      );
      expect(
        cancellationSummary(en, driver, viewerIsDriver: true),
        'You cancelled: Emergency',
      );
      expect(
        cancellationSummary(ar, system),
        'أُلغي تلقائياً: لم يقبله أي سائق في الوقت المحدد',
      );
      expect(cancellationSummary(ar, driver), 'ألغاه السائق: حالة طارئة');
    });

    testWidgets('shows nothing without a recorded cancellation', (
      tester,
    ) async {
      await _pump(tester, const CancellationReasonNote(info: null));
      expect(
        find.byKey(const ValueKey('cancellationReasonNote')),
        findsNothing,
      );
    });

    testWidgets('shows the reason in the reading language', (tester) async {
      await _pump(
        tester,
        const CancellationReasonNote(
          info: CancellationInfo(
            reason: 'no_driver_in_time',
            by: 'system',
            automatic: true,
          ),
        ),
        locale: const Locale('ar'),
      );
      expect(
        find.text('أُلغي تلقائياً: لم يقبله أي سائق في الوقت المحدد'),
        findsOneWidget,
      );
    });

    test(
      'a ride request carries its cancellation and knows when a driver is attached',
      () {
        final cancelled = PassengerRequest.fromJson(
          _requestJson(
            status: 'cancelled',
            cancellation: {
              'reason': 'changed_plans',
              'by': 'passenger',
              'automatic': false,
            },
          ),
        );
        expect(cancelled.cancellation?.reason, 'changed_plans');
        expect(cancelled.canCancel, isFalse);
        final waiting = PassengerRequest.fromJson(_requestJson());
        expect(waiting.cancellation, isNull);
        expect(waiting.canCancel, isTrue);
        expect(waiting.hasAcceptedDriver, isFalse);
        final accepted = PassengerRequest.fromJson(
          _requestJson(status: 'accepted'),
        );
        expect(accepted.canCancel, isTrue);
        expect(accepted.hasAcceptedDriver, isTrue);
        expect(
          PassengerRequest.fromJson(
            _requestJson(status: 'picked_up'),
          ).canCancel,
          isFalse,
        );
      },
    );
  });

  group('the cancel requests', () {
    final requests = <http.Request>[];
    final bodies = <Map<String, dynamic>>[];

    setUp(() {
      requests.clear();
      bodies.clear();
    });

    TestAuthenticatedClient fake(
      Map<String, dynamic> response, {
      int status = 200,
    }) {
      return TestAuthenticatedClient(
        handler: (request) async {
          requests.add(request);
          bodies.add(
            request.body.isEmpty
                ? {}
                : jsonDecode(request.body) as Map<String, dynamic>,
          );
          return http.Response(jsonEncode(response), status);
        },
      );
    }

    test('a merchant cancels with the sender reason', () async {
      final repo = MerchantRepository(
        apiClient: fake({
          'order': {
            'id': 'order_1',
            'pickup_label': 'Hebron',
            'status': 'cancelled',
            'created_at': '2026-07-01T09:00:00.000Z',
            'trip_status': null,
            'cancellation': {
              'reason': 'wrong_details',
              'by': 'merchant',
              'automatic': false,
            },
          },
        }).client,
      );
      final order = await repo.cancelOrder(
        'order_1',
        const CancelChoice('wrong_details'),
      );
      expect(requests.single.method, 'PATCH');
      expect(
        requests.single.url.path,
        endsWith('/merchant/orders/order_1/cancel'),
      );
      expect(bodies.single, {'reason': 'wrong_details'});
      expect(order.cancellation?.reason, 'wrong_details');
    });

    test(
      'a driver cancels an accepted trip through the reason endpoint',
      () async {
        final repo = DriverRepository(
          apiClient: fake({'returned_to_waiting': 1}).client,
        );
        await repo.cancelAcceptedTrip(
          'trip_1',
          const CancelChoice('route_changed', note: 'closed road'),
        );
        expect(requests.single.method, 'POST');
        expect(requests.single.url.path, endsWith('/trips/trip_1/cancel'));
        expect(bodies.single, {
          'reason': 'route_changed',
          'note': 'closed road',
        });
      },
    );

    test('the daily limit is explained to the driver', () {
      final en = lookupAppLocalizations(const Locale('en'));
      const limit = ApiException(
        ApiErrorType.validation,
        'driver_cancellation_limit_reached',
        statusCode: 429,
      );
      expect(
        driverErrorLabel(en, limit),
        contains('limit for cancelling trips'),
      );
    });
  });

  group('the driver trip', () {
    test('cancels with a reason only before pickup', () {
      DriverTrip trip(String status) => DriverTrip.fromJson({
        'id': 'trip_1',
        'status': status,
        'created_at': '2026-07-01T09:00:00.000Z',
        'driver_route': {
          'id': 'route_1',
          'origin_label': 'Hebron',
          'destination_label': 'Bethlehem',
          'corridor_key': 'hebron-bethlehem',
          'status': 'assigned',
          'seats_available': 1,
          'parcel_capacity_available': 0,
          'created_at': '2026-07-01T09:00:00.000Z',
        },
        'cancellation': status == 'cancelled'
            ? {'reason': 'changed_plans', 'by': 'passenger', 'automatic': false}
            : null,
      });
      expect(trip('accepted').cancelsWithReason, isTrue);
      expect(trip('pickup_started').cancelsWithReason, isTrue);
      expect(trip('picked_up').cancelsWithReason, isFalse);
      expect(trip('in_transit').cancelsWithReason, isFalse);
      expect(trip('cancelled').cancellation?.by, 'passenger');
    });
  });

  group('the passenger trip screen', () {
    PassengerTrip trip(String status, {Map<String, dynamic>? cancellation}) =>
        PassengerTrip.fromJson({
          'id': 'trip_1',
          'status': status,
          'created_at': '2026-07-01T09:00:00.000Z',
          'passenger_request_id': 'request_1',
          'driver_route': {
            'origin_label': 'Hebron',
            'destination_label': 'Bethlehem',
          },
          'cancellation': cancellation,
        });

    testWidgets('offers cancel before pickup only', (tester) async {
      for (final entry in {
        'accepted': true,
        'pickup_started': true,
        'picked_up': false,
        'in_transit': false,
        'completed': false,
      }.entries) {
        await _pump(tester, PassengerCancelTripSection(trip: trip(entry.key)));
        expect(
          find.byKey(const ValueKey('passengerCancelTripButton')),
          entry.value ? findsOneWidget : findsNothing,
          reason: entry.key,
        );
      }
    });

    testWidgets('cancelling asks why, then cancels the request with the reason', (
      tester,
    ) async {
      final repository = _RecordingPassengerRepository();
      await _pump(
        tester,
        PassengerCancelTripSection(trip: trip('accepted')),
        overrides: [passengerRepositoryProvider.overrideWithValue(repository)],
      );
      await tester.tap(find.byKey(const ValueKey('passengerCancelTripButton')));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'A driver has accepted this request. Cancel it anyway? The driver will be told.',
        ),
        findsOneWidget,
      );
      expect(repository.cancelled, isEmpty);
      await tester.tap(
        find.byKey(const ValueKey('cancelReason-driver_too_far')),
      );
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('cancelReasonConfirm')));
      await tester.pumpAndSettle();
      expect(repository.cancelled, ['request_1']);
      expect(repository.choices.single.reason, 'driver_too_far');
    });

    testWidgets('a cancelled trip shows why, even from the driver side', (
      tester,
    ) async {
      await _pump(
        tester,
        PassengerCancelTripSection(
          trip: trip(
            'cancelled',
            cancellation: {
              'reason': 'vehicle_problem',
              'by': 'driver',
              'automatic': false,
            },
          ),
        ),
      );
      expect(
        find.text('Cancelled by the driver: Vehicle problem'),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('passengerCancelTripButton')),
        findsNothing,
      );
    });
  });
}

class _RecordingPassengerRepository implements PassengerRepository {
  final cancelled = <String>[];
  final choices = <CancelChoice>[];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<PassengerRequest> cancelRequest(
    String id,
    CancelChoice choice, {
    void Function()? beforeSend,
  }) async {
    cancelled.add(id);
    choices.add(choice);
    return PassengerRequest.fromJson(_requestJson(status: 'cancelled'));
  }
}
