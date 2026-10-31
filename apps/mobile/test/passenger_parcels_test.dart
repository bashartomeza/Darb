import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/auth/data/authenticated_api_client.dart';
import 'package:masari_mobile/features/passenger_parcels/data/passenger_parcel_draft.dart';
import 'package:masari_mobile/features/passenger_parcels/data/passenger_parcel_models.dart';
import 'package:masari_mobile/features/passenger_parcels/data/passenger_parcel_repository.dart';
import 'package:masari_mobile/features/passenger_parcels/presentation/passenger_parcel_labels.dart';
import 'package:masari_mobile/features/passenger_parcels/presentation/passenger_parcels_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

Map<String, dynamic> parcelJson({
  String id = 'order_1',
  String state = 'searching',
  bool canCancel = true,
  bool removed = false,
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
  'created_at': '2026-10-28T10:00:00.000Z',
  'requested_departure_from': '2026-10-29T10:00:00.000Z',
  'requested_departure_until': '2026-10-29T11:00:00.000Z',
};

class _FakeRepository implements PassengerParcelRepository {
  _FakeRepository(this.parcels);
  List<PassengerParcel> parcels;
  final cancelled = <String>[];
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
  Future<PassengerParcel> cancel(String id) async {
    if (cancelError != null) throw cancelError!;
    cancelled.add(id);
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
      routeVersionId: 'r',
      pickupStopId: 'a',
      dropoffStopId: 'b',
      receiverName: 'Sami',
      receiverPhone: '0591234567',
      acknowledged: true,
    );

    test('is valid once everything is filled in and acknowledged', () {
      expect(complete.isValid, isTrue);
    });

    test('requires the forbidden-items acknowledgement', () {
      const draft = PassengerParcelDraft(
        routeVersionId: 'r',
        pickupStopId: 'a',
        dropoffStopId: 'b',
        receiverName: 'Sami',
        receiverPhone: '0591234567',
      );
      expect(draft.firstIssue, ParcelFormIssue.acknowledgement);
    });

    test(
      'rejects large parcels, missing stops, short names and bad phones',
      () {
        expect(
          const PassengerParcelDraft(routeVersionId: 'r').firstIssue,
          ParcelFormIssue.pickup,
        );
        expect(
          PassengerParcelDraft(
            routeVersionId: 'r',
            pickupStopId: 'a',
            dropoffStopId: 'b',
            size: 'L',
            receiverName: complete.receiverName,
            receiverPhone: complete.receiverPhone,
            acknowledged: true,
          ).firstIssue,
          ParcelFormIssue.size,
        );
        expect(
          const PassengerParcelDraft(
            routeVersionId: 'r',
            pickupStopId: 'a',
            dropoffStopId: 'b',
            receiverName: 'S',
            receiverPhone: '0591234567',
            acknowledged: true,
          ).firstIssue,
          ParcelFormIssue.receiverName,
        );
        expect(looksLikePhone('abc'), isFalse);
        expect(looksLikePhone('123'), isFalse);
        expect(looksLikePhone('+970 59 123 4567'), isTrue);
      },
    );

    test('builds the API payload and leaves the note out when empty', () {
      final payload = complete.toPayload(
        departureFrom: DateTime.utc(2026, 11, 1, 10),
        departureUntil: DateTime.utc(2026, 11, 1, 11),
      );
      expect(payload['forbidden_items_acknowledged'], isTrue);
      expect(payload['size'], 'S');
      expect(payload.containsKey('note'), isFalse);
      expect(payload['requested_departure_from'], '2026-11-01T10:00:00.000Z');
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

    testWidgets('cancelling asks first, then shows the cancelled state', (
      tester,
    ) async {
      final repository = _FakeRepository([
        PassengerParcel.fromJson(parcelJson()),
      ]);
      await _pump(tester, repository);
      await tester.tap(find.byKey(const ValueKey('cancelParcel-order_1')));
      await tester.pumpAndSettle();
      expect(repository.cancelled, isEmpty);
      await tester.tap(find.byKey(const ValueKey('confirmCancelParcel')));
      await tester.pumpAndSettle();
      expect(repository.cancelled, ['order_1']);
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
      await tester.tap(find.byKey(const ValueKey('confirmCancelParcel')));
      await tester.pumpAndSettle();
      expect(find.textContaining('can no longer be cancelled'), findsOneWidget);
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

    testWidgets('shows an empty state', (tester) async {
      await _pump(tester, _FakeRepository([]));
      expect(find.text('You have not sent any parcels yet.'), findsOneWidget);
    });
  });
}
