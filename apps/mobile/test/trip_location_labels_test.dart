import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/widgets/masari_map.dart';
import 'package:masari_mobile/features/checkpoints/application/checkpoint_controller.dart';
import 'package:masari_mobile/features/checkpoints/domain/checkpoint_models.dart';
import 'package:masari_mobile/features/trips/application/passenger_trip_controller.dart';
import 'package:masari_mobile/features/trips/data/trip_models.dart';
import 'package:masari_mobile/features/trips/presentation/passenger_trip_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

// These tests catch destructive endpoint parsing in the actual screen/model.
// Only data loading is replaced; headers, details and map configuration are real.
void main() {
  final legacyCases = <(String, String, String)>[
    ('Bab Al-Zawiya', 'Bab Al-Zawiya', 'Bab Al-Zawiya'),
    (
      'Hebron / PPU / Bab Al-Zawiya → Bethlehem',
      'Hebron / PPU / Bab Al-Zawiya',
      'Bethlehem',
    ),
    (
      'Hebron / PPU / Bab Al-Zawiya -> Bethlehem',
      'Hebron / PPU / Bab Al-Zawiya',
      'Bethlehem',
    ),
    ('Bab Al-Zawiya - Bethlehem', 'Bab Al-Zawiya', 'Bethlehem'),
    (
      'الخليل / باب-الزاوية، بوابة (أ) → بيت لحم / شارع-السلام',
      'الخليل / باب-الزاوية، بوابة (أ)',
      'بيت لحم / شارع-السلام',
    ),
    (
      'Pick-up / Store-A -> Drop-off / Gate-B',
      'Pick-up / Store-A',
      'Drop-off / Gate-B',
    ),
    ('Single custom-name', 'Single custom-name', 'Single custom-name'),
    ('A -> B - C', 'A', 'B - C'),
    ('A -> B -> C', 'A -> B -> C', 'A -> B -> C'),
    ('A - - B', 'A - - B', 'A - - B'),
    ('', 'Origin', 'Destination'),
    ('   ', 'Origin', 'Destination'),
    (' -> Bethlehem', 'Origin', 'Bethlehem'),
    ('Bab Al-Zawiya -> ', 'Bab Al-Zawiya', 'Destination'),
  ];
  for (final locale in ['en', 'ar']) {
    for (var i = 0; i < legacyCases.length; i++) {
      final (label, origin, destination) = legacyCases[i];
      testWidgets('$locale legacy endpoint preservation case $i', (
        tester,
      ) async {
        final trip = PassengerTrip(
          id: 'trip',
          status: 'accepted',
          createdAt: DateTime.utc(2026),
          routeLabel: label,
          originLat: 31.53272,
          originLng: 35.099874,
          destinationLat: 31.705211,
          destinationLng: 35.202185,
        );
        // Legacy known-place translation is retained for header/detail only.
        final displayedOrigin = locale == 'ar' && origin == 'Bab Al-Zawiya'
            ? 'باب الزاوية'
            : origin;
        final displayedDestination =
            locale == 'ar' && destination == 'Bethlehem'
            ? 'بيت لحم'
            : locale == 'ar' && destination == 'Bab Al-Zawiya'
            ? 'باب الزاوية'
            : destination;
        await _verifyScreen(
          tester,
          trip,
          locale,
          origin,
          destination,
          displayedOrigin: displayedOrigin,
          displayedDestination: displayedDestination,
        );
      });
    }
    for (final labels in <(String?, String?)>[
      ('Hebron / PPU / Bab Al-Zawiya', 'Bethlehem / Gate-B'),
      ('Bab Al-Zawiya', 'Bethlehem'),
      ('Origin -> Annex - A', 'Destination → Gate-B'),
      ('الخليل / باب-الزاوية، بوابة (أ)', 'بيت لحم؛ شارع-السلام / بوابة → ب'),
      ('  Custom-A, (north)  ', '  Custom-B / جنوب  '),
      ('', ''),
      (null, 'Destination → Gate-B'),
      ('Origin -> Annex - A', null),
    ]) {
      final (origin, destination) = labels;
      testWidgets('$locale structured labels remain opaque: $labels', (
        tester,
      ) async {
        final trip = PassengerTrip.fromJson(_json(origin, destination));
        await _verifyScreen(
          tester,
          trip,
          locale,
          origin == null || origin.isEmpty ? 'Origin' : origin,
          destination == null || destination.isEmpty
              ? 'Destination'
              : destination,
        );
      });
    }
    testWidgets('$locale absent route keeps existing missing-label behavior', (
      tester,
    ) async {
      final json = _json(null, null)..remove('driver_route');
      final trip = PassengerTrip.fromJson(json);
      expect(trip.routeLabel, '');
      expect(trip.hasRouteCoordinates, isFalse);
      await _verifyScreen(
        tester,
        trip,
        locale,
        'Origin',
        'Destination',
        hasCoordinates: false,
      );
    });
  }
  test(
    'existing serialized nested driver route and combined label stay compatible',
    () {
      final trip = PassengerTrip.fromJson(
        _json('Bab Al-Zawiya', 'بيت لحم / Gate-B'),
      );
      expect(trip.routeLabel, 'Bab Al-Zawiya -> بيت لحم / Gate-B');
      expect(trip.passengerRequestId, 'request');
      expect(trip.originLat, 31.53272);
      expect(trip.originLng, 35.099874);
      expect(trip.destinationLat, 31.705211);
      expect(trip.destinationLng, 35.202185);
    },
  );
}

Map<String, dynamic> _json(String? origin, String? destination) => {
  'id': 'trip',
  'status': 'accepted',
  'created_at': '2026-10-23T10:00:00.000Z',
  'passenger_request_id': 'request',
  'driver_route': {
    'origin_label': ?origin,
    'destination_label': ?destination,
    'origin_lat': '31.53272',
    'origin_lng': '35.099874',
    'destination_lat': '31.705211',
    'destination_lng': '35.202185',
  },
};

Future<void> _verifyScreen(
  WidgetTester tester,
  PassengerTrip trip,
  String locale,
  String origin,
  String destination, {
  String? displayedOrigin,
  String? displayedDestination,
  bool hasCoordinates = true,
}) async {
  tester.view.physicalSize = const Size(1280, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final container = ProviderContainer(
    overrides: [
      passengerTripControllerProvider(
        'trip',
      ).overrideWith(() => _FixtureTrip(trip)),
      checkpointsProvider.overrideWith(_NoCheckpoints.new),
    ],
  );
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
  final context = tester.element(find.byType(PassengerTripScreen));
  final l10n = AppLocalizations.of(context);
  expect(
    Directionality.of(context),
    locale == 'ar' ? TextDirection.rtl : TextDirection.ltr,
  );
  final headerOrigin = displayedOrigin ?? origin;
  final headerDestination = displayedDestination ?? destination;
  expect(find.text('$headerOrigin  →  $headerDestination'), findsOneWidget);
  expect(find.text(displayedOrigin ?? origin), findsWidgets);
  expect(find.text(displayedDestination ?? destination), findsWidgets);
  final map = tester.widget<MasariMap>(find.byType(MasariMap));
  if (hasCoordinates) {
    final start = map.markers.singleWhere(
      (m) => m.icon == Icons.trip_origin_rounded,
    );
    final end = map.markers.singleWhere((m) => m.icon == Icons.flag_rounded);
    expect(start.label, l10n.mapOriginLabel(origin));
    expect(end.label, l10n.mapDestinationLabel(destination));
    expect(start.position.latitude, 31.53272);
    expect(start.position.longitude, 35.099874);
    expect(end.position.latitude, 31.705211);
    expect(end.position.longitude, 35.202185);
  } else {
    expect(
      map.markers.where(
        (m) =>
            m.icon == Icons.trip_origin_rounded || m.icon == Icons.flag_rounded,
      ),
      isEmpty,
    );
  }
  await tester.pumpWidget(const SizedBox.shrink());
  container.dispose();
  await tester.pump();
  expect(tester.takeException(), isNull);
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
