import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/core/location/location_service.dart';
import 'package:darb_mobile/core/widgets/darb_map.dart';
import 'package:darb_mobile/features/canonical_routes/application/canonical_route_controller.dart';
import 'package:darb_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:darb_mobile/features/driver/application/driver_location_sharing.dart';
import 'package:darb_mobile/features/driver/presentation/driver_location_sharing_scope.dart';
import 'package:darb_mobile/features/merchant/data/merchant_models.dart';
import 'package:darb_mobile/features/passenger/application/passenger_map_controller.dart';
import 'package:darb_mobile/features/passenger/presentation/passenger_map_alerts_screen.dart';
import 'package:darb_mobile/features/trips/data/trip_models.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import 'support/checkpoint_test_harness.dart';

void main() {
  group('trip location freshness', () {
    test('uses the server age, not the phone clock', () {
      final received = DateTime(2026, 11, 5, 10);
      final location = TripLocation(
        lat: 31.6,
        lng: 35.1,
        source: 'driver_gps',
        sequence: 1,
        // A phone clock an hour behind the server would call this fresh.
        recordedAt: received.add(const Duration(hours: 1)),
        ageSeconds: 100,
        receivedAt: received,
      );
      expect(location.isStaleAt(received), isFalse);
      expect(
        location.isStaleAt(received.add(const Duration(seconds: 20))),
        isFalse,
      );
      expect(
        location.isStaleAt(received.add(const Duration(seconds: 21))),
        isTrue,
      );
    });

    test('reads age_seconds from the API and falls back to recorded_at', () {
      final parsed = TripLocation.fromJson({
        'lat': '31.620000',
        'lng': '35.145000',
        'source': 'driver_gps',
        'sequence': 3,
        'recorded_at': DateTime.now().toUtc().toIso8601String(),
        'age_seconds': 130,
        'stale': true,
      });
      expect(parsed.ageSeconds, 130);
      expect(parsed.isStaleAt(DateTime.now()), isTrue);

      final old = TripLocation(
        lat: 31.6,
        lng: 35.1,
        source: 'simulated',
        sequence: 0,
        recordedAt: DateTime.now().subtract(const Duration(minutes: 3)),
      );
      expect(old.isStaleAt(DateTime.now()), isTrue);
    });
  });

  group('merchant delivery progress', () {
    test('follows the trip status steps', () {
      expect(merchantTripProgress('accepted'), closeTo(1 / 6, 1e-9));
      expect(merchantTripProgress('picked_up'), closeTo(3 / 6, 1e-9));
      expect(merchantTripProgress('in_transit'), closeTo(4 / 6, 1e-9));
      expect(merchantTripProgress('completed'), 1);
      expect(merchantTripProgress('cancelled'), 0);
      expect(merchantTripProgress('failed'), 0);
    });
  });

  group('driver location sender', () {
    testWidgets('sends now and every 15 s while active, nothing after', (
      tester,
    ) async {
      final source = _FakeSource();
      final uploads = <DeviceFix>[];
      final sender = DriverLocationSender(
        source: source,
        upload: (fix) async => uploads.add(fix),
        askConsent: () async => fail('permission was already granted'),
      );
      addTearDown(sender.dispose);

      sender.setActive(true);
      await tester.pump();
      expect(sender.value, LocationSharingStatus.sharing);
      expect(uploads, hasLength(1));

      await tester.pump(const Duration(seconds: 15));
      await tester.pump(const Duration(seconds: 15));
      expect(uploads, hasLength(3));

      sender.setActive(false);
      expect(sender.value, LocationSharingStatus.off);
      await tester.pump(const Duration(minutes: 2));
      expect(uploads, hasLength(3));
    });

    testWidgets('explains first; "Not now" never reaches the system prompt', (
      tester,
    ) async {
      final source = _FakeSource(state: LocationAccess.notAsked);
      var asked = 0;
      var answer = false;
      final uploads = <DeviceFix>[];
      final sender = DriverLocationSender(
        source: source,
        upload: (fix) async => uploads.add(fix),
        askConsent: () async {
          asked++;
          return answer;
        },
      );

      sender.setActive(true);
      await tester.pump();
      expect(asked, 1);
      expect(source.requests, 0);
      expect(sender.value, LocationSharingStatus.declined);
      expect(uploads, isEmpty);

      // Leaving and coming back does not ask again.
      sender.setActive(false);
      sender.setActive(true);
      await tester.pump();
      expect(asked, 1);
      expect(sender.value, LocationSharingStatus.declined);

      // The note's button asks again; allowing it shares.
      answer = true;
      source.afterRequest = LocationAccess.granted;
      await sender.retry();
      await tester.pump();
      expect(asked, 2);
      expect(source.requests, 1);
      expect(sender.value, LocationSharingStatus.sharing);
      expect(uploads, hasLength(1));
      sender.dispose();
    });

    testWidgets('a refused system prompt is shown, not retried', (
      tester,
    ) async {
      final source = _FakeSource(state: LocationAccess.notAsked)
        ..afterRequest = LocationAccess.denied;
      final uploads = <DeviceFix>[];
      final sender = DriverLocationSender(
        source: source,
        upload: (fix) async => uploads.add(fix),
        askConsent: () async => true,
      );
      sender.setActive(true);
      await tester.pump();
      await tester.pump(const Duration(seconds: 45));
      expect(sender.value, LocationSharingStatus.denied);
      expect(source.requests, 1);
      expect(uploads, isEmpty);

      // Android reports a refused prompt as "may ask again"; coming back to
      // the screen must not loop through the system prompt.
      source.state = LocationAccess.notAsked;
      sender.setActive(false);
      sender.setActive(true);
      await tester.pump();
      expect(sender.value, LocationSharingStatus.denied);
      expect(source.requests, 1);
      sender.dispose();
    });

    testWidgets('blocked permission and services point to the settings', (
      tester,
    ) async {
      for (final (access, status) in [
        (
          LocationAccess.permanentlyDenied,
          LocationSharingStatus.permanentlyDenied,
        ),
        (LocationAccess.serviceDisabled, LocationSharingStatus.serviceDisabled),
      ]) {
        final source = _FakeSource(state: access);
        final sender = DriverLocationSender(
          source: source,
          upload: (_) async => fail('nothing may be sent'),
          askConsent: () async => fail('the system decides now'),
        );
        sender.setActive(true);
        await tester.pump();
        expect(sender.value, status);
        await sender.retry();
        expect(source.settingsOpened, 1);
        sender.dispose();
      }
    });

    testWidgets('a lost fix is reported and sharing resumes by itself', (
      tester,
    ) async {
      final source = _FakeSource()..failFix = true;
      final uploads = <DeviceFix>[];
      final sender = DriverLocationSender(
        source: source,
        upload: (fix) async => uploads.add(fix),
        askConsent: () async => false,
      );
      sender.setActive(true);
      await tester.pump();
      expect(sender.value, LocationSharingStatus.unavailable);

      source.failFix = false;
      await tester.pump(const Duration(seconds: 15));
      expect(sender.value, LocationSharingStatus.sharing);
      expect(uploads, hasLength(1));
      sender.dispose();
    });

    testWidgets('an upload failure keeps sharing', (tester) async {
      final source = _FakeSource();
      var attempts = 0;
      final sender = DriverLocationSender(
        source: source,
        upload: (_) async {
          attempts++;
          throw StateError('offline');
        },
        askConsent: () async => false,
      );
      sender.setActive(true);
      await tester.pump();
      await tester.pump(const Duration(seconds: 15));
      expect(attempts, 2);
      expect(sender.value, LocationSharingStatus.sharing);
      sender.dispose();
    });
  });

  group('driver trip screen sharing', () {
    testWidgets('follows the trip status, the capability and the app state', (
      tester,
    ) async {
      final source = _FakeSource();
      final uploads = <(String, DeviceFix)>[];
      final container = ProviderContainer(
        overrides: [
          mobileCapabilitiesProvider.overrideWith(() => _Capabilities(true)),
          driverPositionSourceProvider.overrideWithValue(source),
          driverFixUploadProvider.overrideWithValue(
            (tripId, fix) async => uploads.add((tripId, fix)),
          ),
        ],
      );
      addTearDown(container.dispose);

      Future<void> show(String status) => tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            locale: const Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(
              body: DriverLocationSharing(
                tripId: 'trip-1',
                tripStatus: status,
                child: const DriverLocationSharingNote(),
              ),
            ),
          ),
        ),
      );

      await show('accepted');
      await tester.pumpAndSettle();
      expect(uploads.map((upload) => upload.$1), ['trip-1']);
      expect(
        find.text(
          'Your location is shared with this trip while this screen is open.',
        ),
        findsOneWidget,
      );

      await show('in_transit');
      await tester.pump(const Duration(seconds: 15));
      expect(uploads, hasLength(2));

      // Backgrounded: nothing is sent until the app is back.
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump(const Duration(minutes: 1));
      expect(uploads, hasLength(2));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(uploads, hasLength(3));

      // The trip ends: sharing stops and the note goes away.
      await show('completed');
      await tester.pumpAndSettle();
      await tester.pump(const Duration(minutes: 1));
      expect(uploads, hasLength(3));
      expect(find.byType(Text), findsNothing);

      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets('never starts when the server has live tracking off', (
      tester,
    ) async {
      final source = _FakeSource();
      final uploads = <DeviceFix>[];
      final container = ProviderContainer(
        overrides: [
          mobileCapabilitiesProvider.overrideWith(() => _Capabilities(false)),
          driverPositionSourceProvider.overrideWithValue(source),
          driverFixUploadProvider.overrideWithValue(
            (_, fix) async => uploads.add(fix),
          ),
        ],
      );
      addTearDown(container.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: DriverLocationSharing(
              tripId: 'trip-1',
              tripStatus: 'in_transit',
              child: SizedBox(),
            ),
          ),
        ),
      );
      await tester.pump(const Duration(minutes: 1));
      expect(source.accessChecks, 0);
      expect(uploads, isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets('asks with a localised reason and shows a refusal note', (
      tester,
    ) async {
      final source = _FakeSource(state: LocationAccess.notAsked);
      final container = ProviderContainer(
        overrides: [
          mobileCapabilitiesProvider.overrideWith(() => _Capabilities(true)),
          driverPositionSourceProvider.overrideWithValue(source),
          driverFixUploadProvider.overrideWithValue((_, _) async {}),
        ],
      );
      addTearDown(container.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(
            locale: Locale('ar'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(
              body: DriverLocationSharing(
                tripId: 'trip-1',
                tripStatus: 'accepted',
                child: DriverLocationSharingNote(),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('locationSharingConsent')), findsOne);
      expect(find.text('مشاركة موقعك في هذه الرحلة؟'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('locationSharingNotNow')));
      await tester.pumpAndSettle();
      expect(source.requests, 0);
      expect(
        find.byKey(const ValueKey('locationSharingNote-declined')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('locationSharingRetry')), findsOne);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  });

  group('passenger Maps tab', () {
    test('picks the newest running normal trip', () {
      PassengerTrip trip(String id, String status, int day) =>
          PassengerTrip.fromJson(_tripJson(id, status, day: day));
      expect(
        activePassengerTrip([
          trip('old', 'in_transit', 1),
          trip('new', 'accepted', 3),
          trip('done', 'completed', 4),
        ])?.id,
        'new',
      );
      expect(activePassengerTrip([trip('done', 'cancelled', 4)]), isNull);
    });

    testWidgets(
      'shows a normal trip with the driver, its ends and the road to it',
      (tester) async {
        tester.view.physicalSize = const Size(1000, 2600);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final h = CheckpointTestHarness(
          containerFactory: (fixture) => ProviderContainer(
            overrides: [
              ...fixture.overrides,
              currentPositionProvider.overrideWith(_NoPosition.new),
            ],
          ),
        );
        h.checkpointHandler = (_) async =>
            CheckpointTestHarness.response({'checkpoints': []});
        h.extraHandler = (request) async {
          final path = request.url.path;
          if (path.endsWith('/capabilities')) {
            return CheckpointTestHarness.response(_capabilities(false));
          }
          if (path.endsWith('/trips')) {
            return CheckpointTestHarness.response({
              'trips': [
                _tripJson('trip-done', 'completed', day: 4),
                _tripJson('trip-1', 'in_transit', day: 3),
              ],
            });
          }
          if (path.endsWith('/trips/trip-1')) {
            return CheckpointTestHarness.response({
              'trip': _tripJson('trip-1', 'in_transit', day: 3),
            });
          }
          if (path.endsWith('/trips/trip-1/location')) {
            return CheckpointTestHarness.response({
              'location': {
                'id': 'loc-1',
                'trip_id': 'trip-1',
                'lat': '31.620000',
                'lng': '35.145000',
                'source': 'driver_gps',
                'sequence': 4,
                'recorded_at': DateTime.now().toUtc().toIso8601String(),
                'age_seconds': 5,
                'stale': false,
              },
              'stale_after_seconds': 120,
            });
          }
          return CheckpointTestHarness.response({'error': 'not_found'}, 404);
        };
        await tester.runAsync(() async {
          await h.login();
          await h.load();
        });
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: h.container,
            child: const MaterialApp(
              locale: Locale('en'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: PassengerMapAlertsScreen(),
            ),
          ),
        );
        await tester.runAsync(
          () => h.container.read(passengerMapViewProvider.future),
        );
        await tester.pumpAndSettle();

        final view = h.container.read(passengerMapViewProvider).value!;
        expect(view.assignment, isNull);
        expect(view.tripId, 'trip-1');
        expect(view.location?.source, 'driver_gps');

        final map = tester.widget<DarbMap>(find.byType(DarbMap));
        final driver = map.markers.singleWhere(
          (marker) => marker.type == DarbMapMarkerType.driver,
        );
        expect(driver.position.latitude, 31.62);
        expect(
          map.markers.map((marker) => marker.icon),
          containsAll([Icons.trip_origin_rounded, Icons.flag_rounded]),
        );
        // The road from the driver to the trip's destination was asked for.
        expect(
          h.requests.any(
            (request) =>
                request.url.path.contains('35.145') &&
                request.url.path.contains('35.2024'),
          ),
          isTrue,
        );

        await tester.pumpWidget(const SizedBox.shrink());
        h.dispose();
      },
    );
  });
}

class _FakeSource implements DriverPositionSource {
  _FakeSource({this.state = LocationAccess.granted});

  LocationAccess state;
  LocationAccess afterRequest = LocationAccess.granted;
  bool failFix = false;
  int requests = 0;
  int accessChecks = 0;
  int settingsOpened = 0;

  @override
  Future<LocationAccess> access() async {
    accessChecks++;
    return state;
  }

  @override
  Future<LocationAccess> requestAccess() async {
    requests++;
    return state = afterRequest;
  }

  @override
  Future<DeviceFix> currentFix() async {
    if (failFix) throw TimeoutException('no fix');
    return DeviceFix(
      lat: 31.62,
      lng: 35.145,
      accuracyMeters: 8,
      timestamp: DateTime.now(),
    );
  }

  @override
  Future<void> openAppSettings() async => settingsOpened++;

  @override
  Future<void> openLocationSettings() async => settingsOpened++;
}

class _Capabilities extends MobileCapabilitiesNotifier {
  _Capabilities(this.liveTracking);
  final bool liveTracking;

  @override
  Future<MobileCapabilities> build() async =>
      MobileCapabilities.fromJson(_capabilities(liveTracking));
}

class _NoPosition extends CurrentPositionNotifier {
  @override
  Future<GeoPoint?> build() async => null;
}

Map<String, dynamic> _capabilities(bool liveTracking) => {
  'canonical_route_catalog_available': false,
  'canonical_multi_route_entry_available': false,
  'canonical_matching_available': false,
  'canonical_trip_creation_available': false,
  'driver_canonical_offers_available': false,
  'canonical_assignment_status_available': false,
  'maps_available': true,
  'checkpoints_available': true,
  'live_tracking_available': liveTracking,
};

Map<String, dynamic> _tripJson(String id, String status, {required int day}) =>
    {
      'id': id,
      'status': status,
      'created_at': '2026-11-0${day}T08:00:00Z',
      'passenger_request_id': 'request-$id',
      'driver_route': {
        'id': 'route-$id',
        'origin_label': 'Hebron',
        'origin_lat': '31.532600',
        'origin_lng': '35.099800',
        'destination_label': 'Bethlehem',
        'destination_lat': '31.705400',
        'destination_lng': '35.202400',
      },
      'passenger_request': {
        'id': 'request-$id',
        'pickup_details': 'PPU main gate',
        'dropoff_details': 'Manger Square',
        'route_name_en': 'Hebron to Bethlehem',
        'route_name_ar': 'الخليل إلى بيت لحم',
      },
    };
