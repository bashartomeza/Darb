import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/features/checkpoints/application/checkpoint_controller.dart';
import 'package:darb_mobile/features/checkpoints/domain/checkpoint_models.dart';
import 'package:darb_mobile/features/merchant/data/merchant_models.dart';
import 'package:darb_mobile/features/trips/application/passenger_trip_controller.dart';
import 'package:darb_mobile/features/trips/data/trip_models.dart';
import 'package:darb_mobile/features/trips/presentation/driver_call_card.dart';
import 'package:darb_mobile/features/trips/presentation/passenger_trip_screen.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

// The server sends `driver_route.driver.phone` only from the driver's
// acceptance until drop-off; the app shows the call action exactly when it is
// there.
void main() {
  Map<String, dynamic> tripJson({Object? phone, bool withDriver = true}) => {
    'id': 'trip',
    'status': 'in_transit',
    'created_at': '2026-07-13T08:20:00.000Z',
    'driver_route': {
      'id': 'route_1',
      'origin_label': 'Hebron',
      'destination_label': 'Bethlehem',
      'corridor_key': 'hebron-to-bethlehem',
      'parcel_capacity_available': 5,
      'status': 'assigned',
      if (withDriver)
        'driver': {
          'name': 'Driver One',
          'vehicle_type': 'sedan',
          'verified': true,
          'trust_score': 86,
          'phone': phone,
        },
    },
    'merchant_order': {
      'id': 'order_1',
      'pickup_label': 'Hebron Merchant Pickup',
      'status': 'in_transit',
      'parcels': const [],
    },
    'parcel_batch': null,
  };

  group('trip models read the driver phone', () {
    test('passenger trip', () {
      expect(
        PassengerTrip.fromJson(tripJson(phone: '+970599000111')).driverPhone,
        '+970599000111',
      );
      expect(PassengerTrip.fromJson(tripJson()).driverPhone, isNull);
      expect(PassengerTrip.fromJson(tripJson(phone: '  ')).driverPhone, isNull);
      expect(
        PassengerTrip.fromJson(tripJson(withDriver: false)).driverPhone,
        isNull,
      );
    });

    test('merchant trip', () {
      expect(
        MerchantTrip.fromJson(tripJson(phone: '0599222333')).driverPhone,
        '0599222333',
      );
      expect(MerchantTrip.fromJson(tripJson()).driverPhone, isNull);
    });
  });

  test('tel: links keep only digits and a leading plus', () {
    expect(phoneDialUri('+970 599-000 111').toString(), 'tel:+970599000111');
    expect(phoneDialUri('0599 222 333').toString(), 'tel:0599222333');
    expect(phoneDialUri('call me'), isNull);
  });

  group('passenger trip screen', () {
    testWidgets('shows the number and the call action when sent', (
      tester,
    ) async {
      final dialed = <String>[];
      await _pumpPassengerTrip(
        tester,
        _trip('+970599000111'),
        dialer: (number) async {
          dialed.add(number);
          return true;
        },
      );
      final l10n = AppLocalizations.of(
        tester.element(find.byType(PassengerTripScreen)),
      );

      expect(find.byKey(const ValueKey('driverCallCard')), findsOneWidget);
      expect(find.text('+970599000111'), findsOneWidget);
      expect(find.text(l10n.callDriver), findsOneWidget);

      await tester.ensureVisible(
        find.byKey(const ValueKey('callDriverButton')),
      );
      await tester.tap(find.byKey(const ValueKey('callDriverButton')));
      await tester.pump();
      expect(dialed, ['+970599000111']);
      expect(find.text(l10n.callDriverUnavailable), findsNothing);
    });

    testWidgets('keeps the number on screen when the device cannot dial', (
      tester,
    ) async {
      await _pumpPassengerTrip(
        tester,
        _trip('0599222333'),
        locale: 'en',
        dialer: (_) async => false,
      );

      await tester.ensureVisible(
        find.byKey(const ValueKey('callDriverButton')),
      );
      await tester.tap(find.byKey(const ValueKey('callDriverButton')));
      await tester.pump();
      expect(
        find.text("This device can't place the call. Dial the number shown."),
        findsOneWidget,
      );
      expect(find.text('0599222333'), findsOneWidget);
    });

    testWidgets('shows no call action when the trip carries no phone', (
      tester,
    ) async {
      await _pumpPassengerTrip(tester, _trip(null));

      expect(find.byKey(const ValueKey('driverCallCard')), findsNothing);
      expect(find.byKey(const ValueKey('callDriverButton')), findsNothing);
    });
  });
}

PassengerTrip _trip(String? phone) => PassengerTrip(
  id: 'trip',
  // The screen follows the phone, not the status: the server decides the window.
  status: 'in_transit',
  createdAt: DateTime.utc(2026),
  routeLabel: 'Hebron -> Bethlehem',
  originLabel: 'Hebron',
  destinationLabel: 'Bethlehem',
  driverPhone: phone,
);

Future<void> _pumpPassengerTrip(
  WidgetTester tester,
  PassengerTrip trip, {
  String locale = 'ar',
  PhoneDialer? dialer,
}) async {
  tester.view.physicalSize = const Size(1280, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final container = ProviderContainer(
    overrides: [
      passengerTripControllerProvider(
        'trip',
      ).overrideWith(() => _FixtureTrip(trip)),
      checkpointsProvider.overrideWith(_NoCheckpoints.new),
      if (dialer != null) phoneDialerProvider.overrideWithValue(dialer),
    ],
  );
  addTearDown(container.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        locale: Locale(locale),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const PassengerTripScreen(tripId: 'trip'),
      ),
    ),
  );
  await tester.pump(const Duration(milliseconds: 300));
  await tester.pump();
}

class _FixtureTrip extends PassengerTripController {
  _FixtureTrip(this.trip) : super('trip');
  final PassengerTrip trip;
  @override
  Future<PassengerTripState> build() async =>
      PassengerTripState(trip: trip, location: null);
  @override
  Future<void> refresh() async {}
}

class _NoCheckpoints extends CheckpointsNotifier {
  @override
  Future<CheckpointSnapshot> build() async => CheckpointSnapshot.empty;
}
