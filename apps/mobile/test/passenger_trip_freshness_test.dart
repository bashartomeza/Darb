import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/core/widgets/darb_map.dart';
import 'package:darb_mobile/features/checkpoints/application/checkpoint_controller.dart';
import 'package:darb_mobile/features/checkpoints/domain/checkpoint_models.dart';
import 'package:darb_mobile/features/trips/application/passenger_trip_controller.dart';
import 'package:darb_mobile/features/trips/data/trip_models.dart';
import 'package:darb_mobile/features/trips/presentation/passenger_trip_screen.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

// The trip screen calls the driver "live" only for a point under two minutes
// old; an older one is labelled with how long ago it was seen.
void main() {
  for (final locale in ['en', 'ar']) {
    testWidgets('$locale fresh point reads as live', (tester) async {
      final l10n = await _pump(tester, locale, ageSeconds: 30);
      final tile = find.byKey(const ValueKey('tripLocationQuickInfo'));
      expect(
        find.descendant(of: tile, matching: find.text(l10n.tripLocationLive)),
        findsOneWidget,
      );
      expect(
        find.textContaining(l10n.locationLastSeenMinutes(1)),
        findsNothing,
      );
      final driver = _driverMarker(tester);
      expect(driver.label, isNot(contains(l10n.locationLastSeenMinutes(0))));
      expect(driver.label, l10n.sourceDriverGps);
      await _dispose(tester);
    });

    testWidgets('$locale stale point reads as last seen, never live', (
      tester,
    ) async {
      final l10n = await _pump(tester, locale, ageSeconds: 7 * 60 + 20);
      final tile = find.byKey(const ValueKey('tripLocationQuickInfo'));
      expect(
        find.descendant(of: tile, matching: find.text(l10n.tripLocationLive)),
        findsNothing,
      );
      expect(
        find.descendant(
          of: tile,
          matching: find.text(l10n.locationLastSeenMinutes(7)),
        ),
        findsOneWidget,
      );
      expect(find.text(l10n.liveLocationBadge), findsNothing);
      expect(
        _driverMarker(tester).label,
        contains(l10n.locationLastSeenMinutes(7)),
      );
      await _dispose(tester);
    });
  }
}

DarbMapMarker _driverMarker(WidgetTester tester) => tester
    .widget<DarbMap>(find.byType(DarbMap))
    .markers
    .singleWhere((marker) => marker.type == DarbMapMarkerType.driver);

Future<AppLocalizations> _pump(
  WidgetTester tester,
  String locale, {
  required int ageSeconds,
}) async {
  tester.view.physicalSize = const Size(1280, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final now = DateTime.now();
  final location = TripLocation(
    lat: 31.62,
    lng: 35.145,
    source: 'driver_gps',
    sequence: 3,
    recordedAt: now.subtract(Duration(seconds: ageSeconds)),
    ageSeconds: ageSeconds,
    receivedAt: now,
  );
  final trip = PassengerTrip(
    id: 'trip',
    status: 'in_transit',
    createdAt: DateTime.utc(2026),
    routeLabel: 'Hebron -> Bethlehem',
    originLat: 31.53272,
    originLng: 35.099874,
    destinationLat: 31.705211,
    destinationLng: 35.202185,
  );
  final container = ProviderContainer(
    overrides: [
      passengerTripControllerProvider(
        'trip',
      ).overrideWith(() => _FixtureTrip(trip, location)),
      checkpointsProvider.overrideWith(_NoCheckpoints.new),
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
  return AppLocalizations.of(tester.element(find.byType(PassengerTripScreen)));
}

Future<void> _dispose(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump();
}

class _FixtureTrip extends PassengerTripController {
  _FixtureTrip(this.trip, this.location) : super('trip');
  final PassengerTrip trip;
  final TripLocation location;
  @override
  Future<PassengerTripState> build() async =>
      PassengerTripState(trip: trip, location: location);
  @override
  Future<void> refresh() async {}
}

class _NoCheckpoints extends CheckpointsNotifier {
  @override
  Future<CheckpointSnapshot> build() async => CheckpointSnapshot.empty;
}
