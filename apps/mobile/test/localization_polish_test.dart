import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/core/i18n/domain_labels.dart';
import 'package:darb_mobile/core/i18n/locale_controller.dart';
import 'package:darb_mobile/core/location/location_service.dart';
import 'package:darb_mobile/core/maps/checkpoint_map_markers.dart';
import 'package:darb_mobile/core/presentation/localized_labels.dart';
import 'package:darb_mobile/core/widgets/darb_map.dart';
import 'package:darb_mobile/features/auth/application/auth_controller.dart';
import 'package:darb_mobile/features/auth/domain/auth_models.dart';
import 'package:darb_mobile/features/canonical_routes/application/canonical_route_controller.dart';
import 'package:darb_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:darb_mobile/features/checkpoints/application/checkpoint_controller.dart';
import 'package:darb_mobile/features/checkpoints/domain/checkpoint_models.dart';
import 'package:darb_mobile/features/notifications/application/notifications_controller.dart';
import 'package:darb_mobile/features/passenger/application/passenger_controller.dart';
import 'package:darb_mobile/features/passenger/application/passenger_history_controller.dart';
import 'package:darb_mobile/features/passenger/application/passenger_map_controller.dart';
import 'package:darb_mobile/features/passenger/presentation/passenger_home_screen.dart';
import 'package:darb_mobile/features/passenger/presentation/passenger_map_alerts_screen.dart';
import 'package:darb_mobile/features/passenger/presentation/passenger_trips_screen.dart';
import 'package:darb_mobile/features/trips/application/passenger_trip_controller.dart';
import 'package:darb_mobile/features/trips/data/trip_models.dart';
import 'package:darb_mobile/features/trips/presentation/passenger_trip_screen.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/checkpoint_test_harness.dart';

final _en = lookupAppLocalizations(const Locale('en'));
final _ar = lookupAppLocalizations(const Locale('ar'));

void main() {
  group('checkpoint times', () {
    test('a real timestamp is shown in the device time zone', () {
      final utc = DateTime.utc(2026, 7, 1, 21, 45);
      final local = utc.toLocal();
      String two(int v) => v.toString().padLeft(2, '0');
      expect(
        formatCheckpointTime(utc),
        '${local.year}-${two(local.month)}-${two(local.day)} '
        '${two(local.hour)}:${two(local.minute)}',
      );
      // An offset is honoured too (parsed as UTC, then shown locally).
      expect(
        formatCheckpointTime(DateTime.parse('2026-07-01T23:45:00+02:00')),
        formatCheckpointTime(utc),
      );
    });

    test('a provider time without a timezone is shown exactly as given', () {
      expect(
        formatCheckpointTime(DateTime.parse('2026-11-01T09:30:00')),
        '2026-11-01 09:30',
      );
      // Winter and summer alike: no fixed +3 shift.
      expect(
        formatCheckpointTime(DateTime.parse('2026-01-15T23:10:00')),
        '2026-01-15 23:10',
      );
    });
  });

  group('checkpoint callouts', () {
    final checkpoint = Checkpoint.fromJson({
      'id': 'c1',
      'name_ar': 'حاجز اختبار',
      'latitude': 31.7,
      'longitude': 35.2,
      'status': 'closed',
      'entering_status': 'open',
      'leaving_status': 'مغلق',
    });

    test('lines carry their direction and state as data', () {
      final marker = checkpointTrafficMarker(checkpoint, l10n: _en);
      final details = marker.details!;
      expect(details.map((d) => d.text), [
        'Closed',
        'Entering: open',
        'Leaving: مغلق',
      ]);
      expect(details.map((d) => d.kind), [
        DarbMapDetailKind.info,
        DarbMapDetailKind.entering,
        DarbMapDetailKind.leaving,
      ]);
      expect(details.map((d) => d.status), [
        CheckpointStatus.closed,
        CheckpointStatus.open,
        CheckpointStatus.closed,
      ]);
      expect(
        marker.label,
        'حاجز اختبار\nClosed\nEntering: open\nLeaving: مغلق',
      );
    });

    test('Arabic wording uses the same structure', () {
      final marker = checkpointTrafficMarker(checkpoint, l10n: _ar);
      expect(marker.details!.map((d) => d.kind), [
        DarbMapDetailKind.info,
        DarbMapDetailKind.entering,
        DarbMapDetailKind.leaving,
      ]);
      expect(marker.details![1].text, 'دخول: open');
      expect(checkpointStatusLabel(_ar, CheckpointStatus.open), 'سالك');
      expect(checkpointStatusLabel(_en, CheckpointStatus.open), 'Open');
    });
  });

  group('labels', () {
    test('trip statuses read as words, never raw codes', () {
      expect(tripStatusLabel(_en, 'accepted'), 'Accepted');
      expect(tripStatusLabel(_en, 'failed'), 'Failed');
      expect(tripStatusLabel(_ar, 'in_transit'), _ar.statusInTransit);
    });

    test('durations follow the reading language', () {
      expect(formatRouteDuration(_en, 25), '25 min');
      expect(formatRouteDuration(_en, 60), '1 h');
      expect(formatRouteDuration(_en, 65), '1 h 5 min');
      expect(formatRouteDuration(_ar, 65), '1 س 5 د');
    });
  });

  group('switching language changes the formerly hard-coded copy', () {
    testWidgets('Map & alerts', (tester) async {
      Future<void> pump(String locale) async {
        tester.view.physicalSize = const Size(1000, 2600);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final h = CheckpointTestHarness(
          containerFactory: (fixture) => ProviderContainer(
            overrides: [
              ...fixture.overrides,
              passengerMapViewProvider.overrideWith(
                (ref) async => const PassengerMapView(
                  mapsAvailable: true,
                  checkpointsAvailable: true,
                ),
              ),
              currentPositionProvider.overrideWith(_NoPosition.new),
            ],
          ),
        );
        h.checkpointHandler = (_) async => CheckpointTestHarness.response({
          'checkpoints': [
            {
              'id': 'traffic',
              'latitude': 31.7,
              'longitude': 35.2,
              'city': 'الخليل',
              'status': 'congested',
            },
          ],
        });
        await tester.runAsync(() async {
          await h.login();
          await h.load();
        });
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: h.container,
            child: MaterialApp(
              locale: Locale(locale),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: const PassengerMapAlertsScreen(),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final l10n = locale == 'ar' ? _ar : _en;
        expect(find.text(l10n.checkpointsOnRoad), findsOneWidget);
        expect(find.text(l10n.checkpointsViewDetails), findsOneWidget);
        expect(find.text(l10n.checkpointsRefreshData), findsOneWidget);
        expect(find.text(l10n.checkpointsCityCount(1, 1)), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
        h.dispose();
      }

      await pump('en');
      expect(find.text('الحواجز على الطريق'), findsNothing);
      await pump('ar');
    });

    testWidgets('trip screen', (tester) async {
      for (final locale in ['en', 'ar']) {
        final l10n = locale == 'ar' ? _ar : _en;
        await _pumpTrip(tester, locale: locale);
        // The status pill is a word, not "ACCEPTED".
        expect(find.text(l10n.statusAccepted), findsWidgets);
        expect(find.text('ACCEPTED'), findsNothing);
        expect(find.text(l10n.tripVehicleLocation), findsOneWidget);
        expect(find.text(l10n.tripStartLabel), findsOneWidget);
        expect(find.text(l10n.tripArrivalLabel), findsOneWidget);
        expect(find.text(l10n.tripRefreshLocation), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
      }
    });

    testWidgets('My trips, and its picker switches the language', (
      tester,
    ) async {
      SharedPreferences.setMockInitialValues({
        DomainLabels.localeStorageKey: 'en',
      });
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            passengerHistoryProvider.overrideWith(_History.new),
            mobileCapabilitiesProvider.overrideWith(_Caps.new),
          ],
          child: const _LocaleApp(home: PassengerTripsScreen()),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text(_en.myTripsSubtitle), findsOneWidget);

      await tester.tap(find.byIcon(Icons.language_rounded));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('language-ar')));
      await tester.pumpAndSettle();

      expect(find.text(_ar.myTripsSubtitle), findsOneWidget);
      expect(find.text(_en.myTripsSubtitle), findsNothing);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(DomainLabels.localeStorageKey), 'ar');
    });
  });

  group('foreground refresh', () {
    testWidgets('Home polls the dashboard while it is on screen', (
      tester,
    ) async {
      final dashboard = _Dashboard();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authControllerProvider.overrideWith(_SignedIn.new),
            passengerDashboardProvider.overrideWith(() => dashboard),
            unreadNotificationCountProvider.overrideWithValue(0),
          ],
          child: const MaterialApp(
            locale: Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(body: PassengerHomeScreen()),
          ),
        ),
      );
      await tester.pump();
      expect(dashboard.polls, 0);
      await tester.pump(const Duration(seconds: 6));
      expect(dashboard.polls, 1);
      await tester.pump(const Duration(seconds: 5));
      expect(dashboard.polls, 2);
      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets('My trips polls the history while it is on screen', (
      tester,
    ) async {
      final history = _History();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            passengerHistoryProvider.overrideWith(() => history),
            mobileCapabilitiesProvider.overrideWith(_Caps.new),
          ],
          child: const MaterialApp(
            locale: Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: PassengerTripsScreen(),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(seconds: 6));
      expect(history.polls, 1);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  });

  group('my location', () {
    testWidgets('a refused permission is explained, the map stays put', (
      tester,
    ) async {
      await _pumpTrip(
        tester,
        location: const _FakeLocation(
          error: LocationException(LocationFailure.permissionDenied),
        ),
      );
      await tester.tap(find.byKey(const ValueKey('tripMyLocation')));
      await tester.pump();
      expect(find.text(_en.locationPermissionDenied), findsOneWidget);
      expect(tester.widget<DarbMap>(find.byType(DarbMap)).focus, isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets('a position in the service area centres the map on it', (
      tester,
    ) async {
      const here = GeoPoint(31.53, 35.1);
      await _pumpTrip(tester, location: const _FakeLocation(point: here));
      await tester.tap(find.byKey(const ValueKey('tripMyLocation')));
      await tester.pump();
      final map = tester.widget<DarbMap>(find.byType(DarbMap));
      expect(map.focus?.point, here);
      expect(
        map.markers.where((m) => m.label == _en.mapYouAreHere).single.position,
        here,
      );
      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets('a position outside the service area is not used', (
      tester,
    ) async {
      await _pumpTrip(
        tester,
        location: const _FakeLocation(point: GeoPoint(37.42, -122.08)),
      );
      await tester.tap(find.byKey(const ValueKey('tripMyLocation')));
      await tester.pump();
      expect(find.text(_en.mapLocationOutsideArea), findsOneWidget);
      expect(tester.widget<DarbMap>(find.byType(DarbMap)).focus, isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  });
}

Future<void> _pumpTrip(
  WidgetTester tester, {
  String locale = 'en',
  LocationService location = const _FakeLocation(),
}) async {
  tester.view.physicalSize = const Size(1280, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final trip = PassengerTrip.fromJson({
    'id': 'trip',
    'status': 'accepted',
    'created_at': '2026-11-01T08:00:00.000Z',
    'driver_route': {
      'origin_label': 'Hebron',
      'destination_label': 'Bethlehem',
      'origin_lat': '31.53272',
      'origin_lng': '35.099874',
      'destination_lat': '31.705211',
      'destination_lng': '35.202185',
    },
  });
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        passengerTripControllerProvider(
          'trip',
        ).overrideWith(() => _FixtureTrip(trip)),
        checkpointsProvider.overrideWith(_NoCheckpoints.new),
        locationServiceProvider.overrideWithValue(location),
      ],
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

class _LocaleApp extends ConsumerWidget {
  const _LocaleApp({required this.home});

  final Widget home;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = ref.watch(localeControllerProvider).value;
    return MaterialApp(
      locale: locale ?? const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: home,
    );
  }
}

class _FakeLocation extends LocationService {
  const _FakeLocation({this.point, this.error});

  final GeoPoint? point;
  final LocationException? error;

  @override
  Future<GeoPoint> currentPosition() async {
    final failure = error;
    if (failure != null) throw failure;
    return point ??
        (throw const LocationException(LocationFailure.unavailable));
  }
}

class _NoPosition extends CurrentPositionNotifier {
  @override
  Future<GeoPoint?> build() async => null;
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

class _History extends PassengerHistoryController {
  int polls = 0;

  @override
  Future<PassengerHistoryState> build() async =>
      const PassengerHistoryState(requests: [], trips: []);

  @override
  Future<void> poll() async => polls++;
}

class _Dashboard extends PassengerDashboardController {
  int polls = 0;

  @override
  Future<PassengerDashboardState> build() async =>
      const PassengerDashboardState(activeRequests: [], trips: []);

  @override
  Future<void> poll() async => polls++;
}

class _Caps extends MobileCapabilitiesNotifier {
  @override
  Future<MobileCapabilities> build() async => const MobileCapabilities(
    routeCatalogAvailable: true,
    multiRouteEntryAvailable: false,
    matchingAvailable: false,
    canonicalTripCreationAvailable: false,
    driverCanonicalOffersAvailable: false,
    canonicalAssignmentStatusAvailable: false,
    mapsAvailable: true,
    liveTrackingAvailable: false,
  );
}

class _SignedIn extends AuthController {
  @override
  Future<AuthState> build() async => const AuthState.authenticated(
    AuthUser(
      id: 'passenger-fixture',
      name: 'Passenger',
      role: UserRole.passenger,
      demoAccount: false,
    ),
  );
}
