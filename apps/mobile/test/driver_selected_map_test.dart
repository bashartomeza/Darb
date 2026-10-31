import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:masari_mobile/core/api/api_client.dart';
import 'package:masari_mobile/core/widgets/masari_map.dart';
import 'package:masari_mobile/core/maps/osrm_route_service.dart';
import 'package:latlong2/latlong.dart';
import 'package:masari_mobile/features/checkpoints/application/checkpoint_controller.dart';
import 'package:masari_mobile/features/checkpoints/domain/checkpoint_models.dart';
import 'package:masari_mobile/features/driver/application/driver_controller.dart';
import 'package:masari_mobile/features/driver/data/driver_models.dart';
import 'package:masari_mobile/features/driver/presentation/driver_trip_screen.dart';
import 'package:masari_mobile/features/driver/presentation/driver_ui.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import 'support/checkpoint_test_harness.dart';

void main() {
  test(
    'unrelated missing supply coordinates do not discard selected trip endpoints',
    () {
      final json = _tripJson('one');
      (json['driver_route'] as Map).remove('origin_lat');
      final trip = DriverTrip.fromJson(json);
      expect(trip.mapOrigin?.latitude, 31.8);
    },
  );

  test('road response without travel metadata is rejected', () async {
    final service = OsrmRouteService(
      client: MockClient(
        (_) async => http.Response(
          '{"code":"Ok","routes":[{"geometry":{"coordinates":[[35.3,31.8],[35.5,32.1]]}}]}',
          200,
        ),
      ),
    );
    await expectLater(
      service.getRoute(
        start: const LatLng(31.8, 35.3),
        end: const LatLng(32.1, 35.5),
      ),
      throwsFormatException,
    );
  });

  test(
    'merchant-only map uses persisted parcel endpoints and hides ambiguity',
    () {
      final json = _tripJson('one')..remove('passenger_request');
      json['merchant_order'] = {
        'id': 'merchant-order',
        'pickup_label': 'Warehouse',
        'pickup_lat': '31.9',
        'pickup_lng': '35.3',
        'status': 'assigned',
        'parcels': [
          {
            'destination_label': 'Recipient',
            'destination_lat': '32.2',
            'destination_lng': '35.4',
          },
        ],
      };
      final trip = DriverTrip.fromJson(json);
      expect(trip.mapOrigin?.latitude, 31.9);
      expect(trip.mapDestination?.latitude, 32.2);
      expect(trip.mapDestinationLabel, 'Recipient');
      ((json['merchant_order'] as Map)['parcels'] as List).add({
        'destination_label': 'Another',
        'destination_lat': '32.3',
        'destination_lng': '35.4',
      });
      expect(DriverTrip.fromJson(json).mapDestination, isNull);
    },
  );

  testWidgets('canonical scalar checkpoint status appears in city and detail', (
    tester,
  ) async {
    final feed = {
      'checkpoints': [
        {
          'id': 'closed',
          'name_ar': 'حاجز اختبار',
          'city': 'Test City',
          'latitude': 31.7,
          'longitude': 35.2,
          'status': 'closed',
          'entering_status': 'open',
          'leaving_status': 'congested',
        },
      ],
    };
    final h = CheckpointTestHarness(
      containerFactory: (fixture) => ProviderContainer(
        overrides: [
          ...fixture.overrides,
          driverTripControllerProvider('one').overrideWith(() => _Trip('one')),
        ],
      ),
    );
    h.role = 'driver';
    h.checkpointHandler = (_) async => CheckpointTestHarness.response(feed);
    await tester.runAsync(() async {
      await h.login();
      await h.load();
    });
    final container = h.container;
    await _pump(tester, container, 'one');
    await tester.ensureVisible(find.text('Barriers'));
    await tester.tap(find.text('Barriers'));
    await tester.pumpAndSettle();
    expect(find.text('مغلق'), findsOneWidget);
    await tester.tap(find.text('Test City'));
    await tester.pumpAndSettle();
    expect(find.text('مغلق'), findsOneWidget);
    expect(find.text('سالك'), findsOneWidget);
    expect(find.text('أزمة متوسطة'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    h.dispose();
  });

  testWidgets(
    'missing selected endpoint never uses unrelated supply coordinates',
    (tester) async {
      final container = _container((_) async => _road(31.8, 35.3));
      await _pump(tester, container, 'one');
      final json = _tripJson('one');
      (json['passenger_request'] as Map).remove('pickup_lat');
      (container.read(driverTripControllerProvider('one').notifier) as _Trip)
          .replace(json);
      await tester.pumpAndSettle();
      final map = tester.widget<MasariMap>(find.byType(MasariMap));
      expect(
        map.markers.where((marker) => marker.icon == Icons.trip_origin_rounded),
        isEmpty,
      );
      expect(map.paths, isEmpty);
      expect(map.banner, isNotNull);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
    },
  );

  test('a stalled road provider completes as a timeout', () async {
    final pending = Completer<http.Response>();
    final service = OsrmRouteService(
      client: MockClient((_) => pending.future),
      timeout: const Duration(milliseconds: 5),
    );
    await expectLater(
      service.getRoute(
        start: const LatLng(31.8, 35.3),
        end: const LatLng(32.1, 35.5),
      ),
      throwsA(isA<TimeoutException>()),
    );
    pending.complete(_road(31.8, 35.3));
  });

  testWidgets(
    'a different trip with identical endpoints discards old road state',
    (tester) async {
      final pending = Completer<http.Response>();
      var changed = false;
      final container = _container(
        (_) => changed ? pending.future : Future.value(_road(31.8, 35.3)),
      );
      await _pump(tester, container, 'one');
      changed = true;
      final json = _tripJson('one')..['id'] = 'different';
      (container.read(driverTripControllerProvider('one').notifier) as _Trip)
          .replace(json);
      await tester.pump();
      expect(tester.widget<MasariMap>(find.byType(MasariMap)).paths, isEmpty);
      pending.complete(_road(31.8, 35.3));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
    },
  );

  testWidgets(
    'late road response from previous trip cannot replace selected geometry',
    (tester) async {
      final old = Completer<http.Response>();
      var selected = false;
      final container = _container(
        (_) => selected ? Future.value(_road(32.2, 35.4)) : old.future,
      );
      await _pump(tester, container, 'one', settle: false);
      selected = true;
      await _pump(tester, container, 'two');
      old.complete(_road(31.8, 35.3));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<MasariMap>(find.byType(MasariMap))
            .paths
            .single
            .points
            .first
            .latitude,
        32.2,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
    },
  );
  testWidgets('selected passenger endpoints and labels reach the road route', (
    tester,
  ) async {
    final requests = <Uri>[];
    final container = _container((request) async {
      requests.add(request.url);
      return _road(31.8, 35.3);
    });
    await _pump(tester, container, 'one');
    final map = tester.widget<MasariMap>(find.byType(MasariMap));
    final origin = map.markers.singleWhere(
      (marker) => marker.icon == Icons.trip_origin_rounded,
    );
    final destination = map.markers.singleWhere(
      (marker) => marker.icon == Icons.flag_rounded,
    );
    expect(origin.position.latitude, 31.8);
    expect(origin.position.longitude, 35.3);
    expect(origin.label, contains('Selected origin'));
    expect(destination.position.latitude, 32.1);
    expect(destination.label, contains('Selected destination'));
    expect(map.paths.single.points[1].latitude, 31.91);
    expect(
      requests.any((uri) => uri.path.contains('35.3,31.8;35.5,32.1')),
      isTrue,
    );
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });

  testWidgets('provider failure never fabricates a straight road', (
    tester,
  ) async {
    final container = _container((_) async => http.Response('{}', 503));
    await _pump(tester, container, 'one');
    expect(tester.widget<MasariMap>(find.byType(MasariMap)).paths, isEmpty);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });

  testWidgets('switching trips removes geometry before the new road arrives', (
    tester,
  ) async {
    final pending = Completer<http.Response>();
    var second = false;
    final container = _container(
      (_) => second ? pending.future : Future.value(_road(31.8, 35.3)),
    );
    await _pump(tester, container, 'one');
    second = true;
    await _pump(tester, container, 'two', settle: false);
    expect(tester.widget<MasariMap>(find.byType(MasariMap)).paths, isEmpty);
    pending.complete(_road(32.2, 35.4));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<MasariMap>(find.byType(MasariMap))
          .paths
          .single
          .points
          .first
          .latitude,
      32.2,
    );
    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });

  testWidgets('Arabic preserves an arbitrary selected origin name', (
    tester,
  ) async {
    String? value;
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('ar'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Builder(
          builder: (context) {
            value = localizedOrigin(context, 'رام الله');
            return const SizedBox();
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(value, 'رام الله');
  });
}

ProviderContainer _container(
  Future<http.Response> Function(http.Request) handler, {
  CheckpointSnapshot snapshot = CheckpointSnapshot.empty,
}) => ProviderContainer(
  overrides: [
    httpClientProvider.overrideWithValue(MockClient(handler)),
    checkpointsProvider.overrideWith(() => _NoCheckpoints(snapshot)),
    driverTripControllerProvider('one').overrideWith(() => _Trip('one')),
    driverTripControllerProvider('two').overrideWith(() => _Trip('two')),
  ],
);

Future<void> _pump(
  WidgetTester tester,
  ProviderContainer container,
  String id, {
  bool settle = true,
}) async {
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: DriverTripScreen(tripId: id),
      ),
    ),
  );
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
    await tester.pump();
  }
}

class _NoCheckpoints extends CheckpointsNotifier {
  _NoCheckpoints(this.snapshot);
  final CheckpointSnapshot snapshot;
  @override
  Future<CheckpointSnapshot> build() async => snapshot;
}

class _Trip extends DriverTripController {
  _Trip(this.id) : super(id);
  final String id;
  @override
  Future<DriverTripState> build() async =>
      DriverTripState(trip: DriverTrip.fromJson(_tripJson(id)), location: null);
  void replace(Map<String, dynamic> json) {
    state = AsyncData(
      DriverTripState(trip: DriverTrip.fromJson(json), location: null),
    );
  }
}

http.Response _road(double lat, double lng) => http.Response(
  jsonEncode({
    'code': 'Ok',
    'routes': [
      {
        'duration': 600,
        'distance': 1234,
        'geometry': {
          'coordinates': [
            [lng, lat],
            [35.35, 31.91],
            [35.5, 32.1],
          ],
        },
      },
    ],
  }),
  200,
);

Map<String, dynamic> _tripJson(String id) => {
  'id': id,
  'status': 'accepted',
  'created_at': '2026-10-16T08:00:00Z',
  'driver_route': {
    'id': 'supply',
    'origin_label': 'Supply origin',
    'origin_lat': 31.5,
    'origin_lng': 35.1,
    'destination_label': 'Supply destination',
    'destination_lat': 31.7,
    'destination_lng': 35.2,
    'corridor_key': 'legacy',
    'seats_available': 3,
    'parcel_capacity_available': 1,
    'status': 'assigned',
  },
  'passenger_request': {
    'id': 'request-$id',
    'pickup_label': 'Selected origin',
    'pickup_lat': id == 'one' ? 31.8 : 32.2,
    'pickup_lng': id == 'one' ? 35.3 : 35.4,
    'destination_label': 'Selected destination',
    'destination_lat': 32.1,
    'destination_lng': 35.5,
    'passenger_count': 1,
    'status': 'accepted',
  },
};
