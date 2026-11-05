import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/core/cancellation/cancellation.dart';
import 'package:darb_mobile/core/api/api_error.dart';
import 'package:darb_mobile/features/auth/data/authenticated_api_client.dart';
import 'package:darb_mobile/features/passenger_parcels/data/passenger_parcel_draft.dart';
import 'package:darb_mobile/features/passenger_parcels/data/passenger_parcel_models.dart';
import 'package:darb_mobile/features/passenger_parcels/data/passenger_parcel_repository.dart';
import 'package:darb_mobile/features/passenger_parcels/presentation/passenger_parcel_labels.dart';
import 'package:darb_mobile/features/passenger_parcels/presentation/passenger_parcels_screen.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

Map<String, dynamic> parcelJson({
  String id = 'order_1',
  String state = 'searching',
  bool canCancel = true,
  bool removed = false,
  Map<String, dynamic>? cancellation,
}) => {
  'id': id,
  'tracking_state': state,
  'size': 'S',
  'pickup_label': 'Hebron Center',
  'dropoff_label': 'Bethlehem Center',
  'receiver_name': removed ? null : 'Sami',
  'receiver_phone_masked': removed ? null : '+970 *** *** 567',
  'receiver_details_removed': removed,
  'note': null,
  'can_cancel': canCancel,
  'cancellation': cancellation,
  'created_at': '2026-10-28T10:00:00.000Z',
  'requested_departure_from': '2026-10-29T10:00:00.000Z',
  'requested_departure_until': '2026-10-29T11:00:00.000Z',
};

class _FakeRepository implements PassengerParcelRepository {
  _FakeRepository(this.parcels);
  List<PassengerParcel> parcels;
  final cancelled = <String>[];
  final cancelChoices = <CancelChoice>[];
  ApiException? cancelError;

  @override
  AuthenticatedApiClient get apiClient => throw UnimplementedError();

  @override
  Future<List<PassengerParcel>> list() async => parcels;

  @override
  Future<PassengerParcel> create({
    required Map<String, dynamic> payload,
    required String idempotencyKey,
  }) => throw UnimplementedError();

  @override
  Future<PassengerParcel> cancel(String id, CancelChoice choice) async {
    if (cancelError != null) throw cancelError!;
    cancelled.add(id);
    cancelChoices.add(choice);
    parcels = [
      for (final parcel in parcels)
        if (parcel.id == id)
          PassengerParcel.fromJson(
            parcelJson(
              id: id,
              state: 'cancelled',
              canCancel: false,
              removed: true,
            ),
          )
        else
          parcel,
    ];
    return parcels.firstWhere((parcel) => parcel.id == id);
  }
}

Future<void> _pump(
  WidgetTester tester,
  _FakeRepository repository, {
  Locale locale = const Locale('en'),
}) async {
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => const PassengerParcelsScreen(),
      ),
    ],
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        passengerParcelRepositoryProvider.overrideWithValue(repository),
      ],
      child: MaterialApp.router(
        routerConfig: router,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('parcel model', () {
    test('parses the sender view and falls back safely on unknown states', () {
      final parcel = PassengerParcel.fromJson(parcelJson(state: 'in_transit'));
      expect(parcel.state, ParcelTrackingState.inTransit);
      expect(parcel.receiverPhoneMasked, contains('***'));
      expect(
        PassengerParcel.fromJson(parcelJson(state: 'from_the_future')).state,
        ParcelTrackingState.searching,
      );
    });

    test('rejects a payload without an id', () {
      expect(
        () => PassengerParcel.fromJson({...parcelJson(), 'id': null}),
        throwsFormatException,
      );
    });

    test('knows which states are final', () {
      expect(ParcelTrackingState.delivered.isFinal, isTrue);
      expect(ParcelTrackingState.cancelled.isFinal, isTrue);
      expect(ParcelTrackingState.searching.isFinal, isFalse);
      expect(ParcelTrackingState.inTransit.isFinal, isFalse);
    });
  });

  group('parcel draft', () {
    const complete = PassengerParcelDraft(
      serviceRouteId: 'route-heb-bth',
      pickupPlaceId: 'place-heb-halhul',
      dropoffPlaceId: 'place-bth-beitjala',
      pickupDetails: 'The shop next to Ibn Rushd roundabout',
      dropoffDetails: 'Receiver house near the Church of the Nativity',
      receiverName: 'Sami',
      receiverPhone: '0591234567',
      acknowledged: true,
    );

    test('is valid once everything is filled in and acknowledged', () {
      expect(complete.isValid, isTrue);
    });

    test('requires the forbidden-items acknowledgement', () {
      expect(
        complete.copyWith(acknowledged: false).firstIssue,
        ParcelFormIssue.acknowledgement,
      );
    });

    test(
      'rejects a missing route or place, long details, large parcels, short names and bad phones',
      () {
        expect(const PassengerParcelDraft().firstIssue, ParcelFormIssue.route);
        expect(
          complete.copyWith(pickupDetails: 'x' * 301).firstIssue,
          ParcelFormIssue.pickup,
        );
        expect(
          complete.copyWith(dropoffDetails: 'y' * 301).firstIssue,
          ParcelFormIssue.dropoff,
        );
        // Details are optional once the places are chosen.
        expect(
          complete.copyWith(pickupDetails: '', dropoffDetails: '').isValid,
          isTrue,
        );
        expect(complete.copyWith(size: 'L').firstIssue, ParcelFormIssue.size);
        expect(
          complete.copyWith(receiverName: 'S').firstIssue,
          ParcelFormIssue.receiverName,
        );
        expect(looksLikePhone('abc'), isFalse);
        expect(looksLikePhone('123'), isFalse);
        expect(looksLikePhone('+970 59 123 4567'), isTrue);
      },
    );

    test('builds the route body and leaves the note out when empty', () {
      final payload = complete.toPayload(
        preferredTime: DateTime.utc(2026, 11, 1, 10),
      );
      expect(payload, {
        'service_route_id': 'route-heb-bth',
        'pickup_place_id': 'place-heb-halhul',
        'dropoff_place_id': 'place-bth-beitjala',
        'pickup_details': 'The shop next to Ibn Rushd roundabout',
        'dropoff_details': 'Receiver house near the Church of the Nativity',
        'preferred_time': '2026-11-01T10:00:00.000Z',
        'size': 'S',
        'receiver_name': 'Sami',
        'receiver_phone': '0591234567',
        'forbidden_items_acknowledged': true,
      });
      expect(
        complete
            .copyWith(note: '  fragile ')
            .toPayload(preferredTime: DateTime.utc(2026, 11, 1, 10))['note'],
        'fragile',
      );
    });

    test('restores a pending create from its body', () {
      final payload = complete.toPayload(
        preferredTime: DateTime.utc(2026, 11, 1, 10),
      );
      final restored = PassengerParcelDraft.fromPayload(payload);
      expect(
        restored.toPayload(preferredTime: DateTime.utc(2026, 11, 1, 10)),
        payload,
      );
    });
  });

  group('tracking labels', () {
    testWidgets('every state has English and Arabic wording', (tester) async {
      for (final locale in const [Locale('en'), Locale('ar')]) {
        late AppLocalizations l10n;
        await tester.pumpWidget(
          MaterialApp(
            locale: locale,
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
        final labels = {
          for (final state in ParcelTrackingState.values)
            parcelTrackingLabel(l10n, state),
        };
        expect(labels.length, ParcelTrackingState.values.length);
        expect(labels.every((label) => label.isNotEmpty), isTrue);
      }
    });
  });

  group('my parcels screen', () {
    testWidgets(
      'shows tracking state and masked receiver, with cancel while unmatched',
      (tester) async {
        final repository = _FakeRepository([
          PassengerParcel.fromJson(parcelJson()),
          PassengerParcel.fromJson(
            parcelJson(id: 'order_2', state: 'assigned', canCancel: false),
          ),
        ]);
        await _pump(tester, repository);
        expect(find.text('Finding a driver'), findsWidgets);
        expect(find.text('Driver assigned'), findsWidgets);
        expect(find.textContaining('+970 *** *** 567'), findsNWidgets(2));
        expect(
          find.byKey(const ValueKey('cancelParcel-order_1')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('cancelParcel-order_2')),
          findsNothing,
        );
      },
    );

    testWidgets('cancelling asks why first, then shows the cancelled state', (
      tester,
    ) async {
      final repository = _FakeRepository([
        PassengerParcel.fromJson(parcelJson()),
      ]);
      await _pump(tester, repository);
      await tester.tap(find.byKey(const ValueKey('cancelParcel-order_1')));
      await tester.pumpAndSettle();
      expect(repository.cancelled, isEmpty);
      // The confirm button waits for a reason.
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('confirmCancelParcel')),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(
        find.byKey(const ValueKey('cancelReason-changed_plans')),
      );
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('confirmCancelParcel')));
      await tester.pumpAndSettle();
      expect(repository.cancelled, ['order_1']);
      expect(repository.cancelChoices.single.reason, 'changed_plans');
      expect(find.text('Cancelled'), findsOneWidget);
      expect(find.text('Receiver details have been erased.'), findsOneWidget);
      expect(find.byKey(const ValueKey('cancelParcel-order_1')), findsNothing);
    });

    testWidgets('a refused cancellation explains why', (tester) async {
      final repository =
          _FakeRepository([PassengerParcel.fromJson(parcelJson())])
            ..cancelError = const ApiException(
              ApiErrorType.validation,
              'parcel_cannot_be_cancelled',
              statusCode: 409,
            );
      await _pump(tester, repository);
      await tester.tap(find.byKey(const ValueKey('cancelParcel-order_1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('cancelReason-other')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('confirmCancelParcel')));
      await tester.pumpAndSettle();
      expect(find.textContaining('can no longer be cancelled'), findsOneWidget);
    });

    testWidgets('a cancelled parcel shows who cancelled it and why', (
      tester,
    ) async {
      final repository = _FakeRepository([
        PassengerParcel.fromJson(
          parcelJson(
            state: 'cancelled',
            canCancel: false,
            removed: true,
            cancellation: {
              'reason': 'no_driver_in_time',
              'by': 'system',
              'automatic': true,
            },
          ),
        ),
        PassengerParcel.fromJson(
          parcelJson(
            id: 'order_2',
            state: 'cancelled',
            canCancel: false,
            removed: true,
            cancellation: {
              'reason': 'safety_concern',
              'by': 'admin',
              'automatic': false,
            },
          ),
        ),
      ]);
      await _pump(tester, repository);
      expect(
        find.text('Cancelled automatically: No driver accepted in time'),
        findsOneWidget,
      );
      expect(
        find.text('Cancelled by the Darb team: Safety concern'),
        findsOneWidget,
      );
    });

    testWidgets('the cancellation is shown in Arabic too', (tester) async {
      final repository = _FakeRepository([
        PassengerParcel.fromJson(
          parcelJson(
            state: 'cancelled',
            canCancel: false,
            removed: true,
            cancellation: {
              'reason': 'no_driver_in_time',
              'by': 'system',
              'automatic': true,
            },
          ),
        ),
      ]);
      await _pump(tester, repository, locale: const Locale('ar'));
      expect(
        find.text('أُلغي تلقائياً: لم يقبله أي سائق في الوقت المحدد'),
        findsOneWidget,
      );
    });

    testWidgets('renders right-to-left Arabic with Arabic tracking wording', (
      tester,
    ) async {
      final repository = _FakeRepository([
        PassengerParcel.fromJson(parcelJson()),
      ]);
      await _pump(tester, repository, locale: const Locale('ar'));
      expect(find.text('جارٍ البحث عن سائق'), findsWidgets);
      expect(find.text('طرودي'), findsOneWidget);
      expect(
        Directionality.of(tester.element(find.text('طرودي'))),
        TextDirection.rtl,
      );
    });

    testWidgets('shows the fare frozen on a parcel, and none without one', (
      tester,
    ) async {
      final repository = _FakeRepository([
        PassengerParcel.fromJson({
          ...parcelJson(),
          'fare': {
            'currency': 'ILS',
            'unit_minor': 800,
            'total_minor': 800,
            'estimated': true,
            'paid_directly_to_driver': true,
          },
        }),
        PassengerParcel.fromJson({...parcelJson(id: 'order_2'), 'fare': null}),
      ]);
      await _pump(tester, repository);
      expect(find.byKey(const ValueKey('fareEstimateBox')), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('parcel-order_1')),
          matching: find.text('₪8.00'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('parcel-order_2')),
          matching: find.byKey(const ValueKey('fareEstimateBox')),
        ),
        findsNothing,
      );
    });

    testWidgets('shows a parcel fare in Arabic', (tester) async {
      final repository = _FakeRepository([
        PassengerParcel.fromJson({
          ...parcelJson(),
          'fare': {'currency': 'ILS', 'unit_minor': 800, 'total_minor': 800},
        }),
      ]);
      await _pump(tester, repository, locale: const Locale('ar'));
      expect(find.text('الأجرة التقديرية عند الطلب'), findsOneWidget);
      expect(find.text('الإجمالي'), findsOneWidget);
    });

    testWidgets('shows an empty state', (tester) async {
      await _pump(tester, _FakeRepository([]));
      expect(find.text('You have not sent any parcels yet.'), findsOneWidget);
    });
  });
}
