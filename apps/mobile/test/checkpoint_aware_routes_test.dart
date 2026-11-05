import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart' show TileProvider;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:latlong2/latlong.dart';

import 'package:darb_mobile/core/api/api_client.dart';
import 'package:darb_mobile/core/api/api_error.dart';
import 'package:darb_mobile/core/maps/darb_route_map.dart';
import 'package:darb_mobile/core/maps/osrm_route_service.dart';
import 'package:darb_mobile/core/maps/route_plan_models.dart';
import 'package:darb_mobile/core/maps/route_plan_service.dart';
import 'package:darb_mobile/core/theme/semantic_colors.dart';
import 'package:darb_mobile/core/widgets/darb_map.dart';
import 'package:darb_mobile/features/auth/data/authenticated_api_client.dart';
import 'package:darb_mobile/features/canonical_routes/application/canonical_route_controller.dart';
import 'package:darb_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:darb_mobile/features/checkpoints/application/checkpoint_controller.dart';
import 'package:darb_mobile/features/checkpoints/domain/checkpoint_models.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';
import 'package:darb_mobile/l10n/app_localizations_ar.dart';
import 'package:darb_mobile/l10n/app_localizations_en.dart';

// Synthetic places inside the service area; nothing here is a real checkpoint.
const _a = GeoPoint(31.5, 35.1);
const _b = GeoPoint(31.5, 35.3);

Map<String, dynamic> _planJson({
  String status = 'clear',
  List<Map<String, dynamic>> onRoute = const [],
  List<Map<String, dynamic>> avoided = const [],
  List<String> warnings = const [],
  num extraSeconds = 0,
}) => {
  'plan': {
    'status': status,
    'coordinates': [
      [35.1, 31.5],
      [35.2, 31.56],
      [35.3, 31.5],
    ],
    'distance_meters': 24000,
    'duration_seconds': 1900,
    'extra_distance_meters': 5000,
    'extra_duration_seconds': extraSeconds,
    'checkpoints_on_route': onRoute,
    'avoided_checkpoints': avoided,
    'warnings': warnings,
  },
};

Map<String, dynamic> _cp(String name, String status, {double lat = 31.5}) => {
  'id': 'id-$name',
  'name_ar': name,
  'name_en': 'EN $name',
  'latitude': lat,
  'longitude': 35.2,
  'status': status,
};

http.Response _osrm() => http.Response(
  jsonEncode({
    'code': 'Ok',
    'routes': [
      {
        'duration': 1500.0,
        'distance': 19000.0,
        'geometry': {
          'coordinates': [
            [35.1, 31.5],
            [35.3, 31.5],
          ],
        },
      },
    ],
  }),
  200,
);

class _FakeApi implements AuthenticatedApiClient {
  _FakeApi(this.handler);
  final Future<Map<String, dynamic>> Function(
    String path,
    Map<String, dynamic> body,
  )
  handler;

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    required Map<String, dynamic> body,
    Map<String, String> headers = const {},
    Future<void> Function()? beforeRetry,
    void Function()? beforeSend,
  }) => handler(path, body);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Planner extends RoutePlanService {
  _Planner(this.handler) : super(_FakeApi((_, _) async => {}));
  final Future<RoutePlan> Function(List<LatLng>) handler;
  final calls = <List<LatLng>>[];

  @override
  Future<RoutePlan> plan(List<LatLng> waypoints) {
    calls.add(waypoints);
    return handler(waypoints);
  }
}

class _Caps extends MobileCapabilitiesNotifier {
  _Caps(this.checkpoints);
  final bool checkpoints;
  @override
  Future<MobileCapabilities> build() async => MobileCapabilities(
    routeCatalogAvailable: true,
    multiRouteEntryAvailable: false,
    matchingAvailable: false,
    canonicalTripCreationAvailable: false,
    driverCanonicalOffersAvailable: false,
    canonicalAssignmentStatusAvailable: false,
    mapsAvailable: true,
    checkpointsAvailable: checkpoints,
    liveTrackingAvailable: false,
  );
}

class _Checkpoints extends CheckpointsNotifier {
  _Checkpoints(this.first);
  final CheckpointSnapshot first;
  @override
  Future<CheckpointSnapshot> build() async => first;
  void publish(CheckpointSnapshot next) => state = AsyncData(next);
  int refreshes = 0;
  @override
  Future<void> refresh() async => refreshes++;
}

CheckpointSnapshot _snapshot(CheckpointStatus status) => CheckpointSnapshot(
  checkpoints: [
    Checkpoint(
      id: 'c1',
      position: const GeoPoint(31.5, 35.2),
      nameAr: 'حاجز',
      status: status,
    ),
  ],
);

ProviderContainer _container({
  required _Planner planner,
  bool checkpoints = true,
  http.Client? http,
  _Checkpoints? feed,
}) {
  final container = ProviderContainer(
    overrides: [
      httpClientProvider.overrideWithValue(
        http ?? MockClient((_) async => _osrm()),
      ),
      mobileCapabilitiesProvider.overrideWith(() => _Caps(checkpoints)),
      checkpointsProvider.overrideWith(
        () => feed ?? _Checkpoints(_snapshot(CheckpointStatus.open)),
      ),
      routePlanServiceProvider.overrideWithValue(planner),
      // No real timer in unit tests.
      routeCheckpointRefreshProvider.overrideWith((ref) {}),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

Future<RoadRoute> _road(ProviderContainer container) async {
  // The app has its capabilities and checkpoints loaded before a trip opens.
  await container.read(mobileCapabilitiesProvider.future);
  await container.read(checkpointsProvider.future);
  final provider = roadRouteProvider(RoadRouteRequest(const [_a, _b]));
  final sub = container.listen(provider, (_, _) {});
  addTearDown(sub.close);
  return container.read(provider.future);
}

void main() {
  final en = AppLocalizationsEn();
  final ar = AppLocalizationsAr();

  group('RoutePlan parsing', () {
    test('reads the server plan', () {
      final plan = RoutePlan.fromJson(
        _planJson(
          status: 'rerouted_closed',
          onRoute: [_cp('open one', 'open')],
          avoided: [_cp('shut', 'closed')],
          warnings: ['status_stale'],
          extraSeconds: 400,
        ),
      );
      expect(plan.status, RoutePlanStatus.reroutedClosed);
      expect(plan.points, hasLength(3));
      expect(plan.points.first, const GeoPoint(31.5, 35.1)); // lon/lat order
      expect(plan.avoidedCheckpoints.single.status, CheckpointStatus.closed);
      expect(plan.checkpointsOnRoute.single.status, CheckpointStatus.open);
      expect(plan.extraMinutes, 7);
      expect(plan.hasWarning('status_stale'), isTrue);
    });

    test('an unknown status word is unchecked, never clear', () {
      expect(parseRoutePlanStatus('something_new'), RoutePlanStatus.unchecked);
      expect(parseRoutePlanStatus(null), RoutePlanStatus.unchecked);
    });

    test('rejects malformed plans', () {
      expect(() => RoutePlan.fromJson({}), throwsFormatException);
      final bad = _planJson();
      (bad['plan'] as Map)['coordinates'] = [
        [35.1, 31.5],
      ];
      expect(() => RoutePlan.fromJson(bad), throwsFormatException);
      final badPoint = _planJson();
      (badPoint['plan'] as Map)['coordinates'] = [
        [35.1, 31.5],
        [35.2, 99],
      ];
      expect(() => RoutePlan.fromJson(badPoint), throwsFormatException);
    });
  });

  group('RoutePlanService', () {
    test('posts the waypoints and parses the plan', () async {
      Map<String, dynamic>? sent;
      final service = RoutePlanService(
        _FakeApi((path, body) async {
          expect(path, '/route-plans');
          sent = body;
          return _planJson();
        }),
      );
      final plan = await service.plan(const [
        LatLng(31.5, 35.1),
        LatLng(31.5, 35.3),
      ]);
      expect(plan.status, RoutePlanStatus.clear);
      expect(sent!['waypoints'], [
        {'latitude': 31.5, 'longitude': 35.1},
        {'latitude': 31.5, 'longitude': 35.3},
      ]);
    });

    test(
      'a 404 or 403 means unavailable and is not asked again for a while',
      () async {
        var now = DateTime(2026, 11, 5, 12);
        final service = RoutePlanService(
          _FakeApi(
            (_, _) async => throw const ApiException(
              ApiErrorType.unknown,
              'x',
              statusCode: 404,
            ),
          ),
          clock: () => now,
        );
        const pts = [LatLng(31.5, 35.1), LatLng(31.5, 35.3)];
        await expectLater(
          service.plan(pts),
          throwsA(isA<RoutePlanUnavailable>()),
        );
        await expectLater(
          service.plan(pts),
          throwsA(isA<RoutePlanUnavailable>()),
        );
        expect(service.requestCount, 1);
        now = now.add(const Duration(minutes: 11));
        await expectLater(
          service.plan(pts),
          throwsA(isA<RoutePlanUnavailable>()),
        );
        expect(service.requestCount, 2);
      },
    );

    test('other failures are rethrown so the caller can warn', () async {
      final service = RoutePlanService(
        _FakeApi(
          (_, _) async => throw const ApiException(
            ApiErrorType.server,
            'x',
            statusCode: 502,
          ),
        ),
      );
      await expectLater(
        service.plan(const [LatLng(31.5, 35.1), LatLng(31.5, 35.3)]),
        throwsA(isA<ApiException>()),
      );
      expect(service.available, isTrue);
    });

    test('refuses fewer than two or more than six waypoints', () {
      final service = RoutePlanService(_FakeApi((_, _) async => {}));
      expect(
        () => service.plan(const [LatLng(31.5, 35.1)]),
        throwsFormatException,
      );
      expect(
        () => service.plan(List.filled(7, const LatLng(31.5, 35.1))),
        throwsFormatException,
      );
    });
  });

  group('roadRouteProvider', () {
    test(
      'uses the checkpoint-aware plan when the server has a checkpoint source',
      () async {
        final planner = _Planner(
          (_) async => RoutePlan.fromJson(
            _planJson(
              status: 'rerouted_closed',
              avoided: [_cp('shut', 'closed')],
            ),
          ),
        );
        final road = await _road(_container(planner: planner));
        expect(road.routed, isTrue);
        expect(road.plan!.status, RoutePlanStatus.reroutedClosed);
        expect(road.points, hasLength(3));
        expect(road.distanceMeters, 24000);
        expect(planner.calls, hasLength(1));
      },
    );

    test(
      'keeps today\'s road route when the server reports no checkpoint source',
      () async {
        final planner = _Planner(
          (_) async => throw StateError('must not be called'),
        );
        final road = await _road(
          _container(planner: planner, checkpoints: false),
        );
        expect(planner.calls, isEmpty);
        expect(road.plan, isNull);
        expect(road.checkFailed, isFalse);
        expect(road.distanceMeters, 19000);
      },
    );

    test(
      'falls back to the plain road, flagged, when the planner fails',
      () async {
        final planner = _Planner(
          (_) async => throw const ApiException(
            ApiErrorType.server,
            'x',
            statusCode: 502,
          ),
        );
        final road = await _road(_container(planner: planner));
        expect(road.routed, isTrue);
        expect(road.plan, isNull);
        expect(road.checkFailed, isTrue);
        expect(road.distanceMeters, 19000);
      },
    );

    test(
      'falls back to a labelled straight line when planner and engine both fail',
      () async {
        final planner = _Planner(
          (_) async => throw const FormatException('bad'),
        );
        final road = await _road(
          _container(
            planner: planner,
            http: MockClient((_) async => http.Response('', 503)),
          ),
        );
        expect(road.routed, isFalse);
        expect(road.checkFailed, isTrue);
        expect(road.points, const [_a, _b]);
      },
    );

    test(
      'a role without checkpoint access gets the plain road without a warning',
      () async {
        final planner = _Planner(
          (_) async => throw const RoutePlanUnavailable(),
        );
        final road = await _road(_container(planner: planner));
        expect(road.plan, isNull);
        expect(road.checkFailed, isFalse);
        expect(road.distanceMeters, 19000);
      },
    );

    test(
      'plans again when a checkpoint changes status, not when it stays the same',
      () async {
        final feed = _Checkpoints(_snapshot(CheckpointStatus.open));
        final planner = _Planner((_) async => RoutePlan.fromJson(_planJson()));
        final container = _container(planner: planner, feed: feed);
        await _road(container);
        expect(planner.calls, hasLength(1));

        feed.publish(_snapshot(CheckpointStatus.open)); // same status
        await Future<void>.delayed(Duration.zero);
        await _road(container);
        expect(planner.calls, hasLength(1));

        feed.publish(_snapshot(CheckpointStatus.closed)); // flipped
        await Future<void>.delayed(Duration.zero);
        await _road(container);
        expect(planner.calls, hasLength(2));
      },
    );

    test('more than six waypoints skip the planner', () async {
      final planner = _Planner(
        (_) async => throw StateError('must not be called'),
      );
      final container = _container(planner: planner);
      final many = List.generate(7, (i) => GeoPoint(31.5, 35.1 + i * 0.01));
      await container.read(mobileCapabilitiesProvider.future);
      final provider = roadRouteProvider(RoadRouteRequest(many));
      final sub = container.listen(provider, (_, _) {});
      addTearDown(sub.close);
      await container.read(provider.future);
      expect(planner.calls, isEmpty);
    });
  });

  group('checkpoint status signature', () {
    test('changes only when a status changes', () async {
      final feed = _Checkpoints(_snapshot(CheckpointStatus.open));
      final container = ProviderContainer(
        overrides: [checkpointsProvider.overrideWith(() => feed)],
      );
      addTearDown(container.dispose);
      final seen = <String>[];
      container.listen(
        checkpointStatusSignatureProvider,
        (_, next) => seen.add(next),
      );
      await container.read(checkpointsProvider.future);
      await Future<void>.delayed(Duration.zero);
      expect(seen, ['c1:open']);
      feed.publish(_snapshot(CheckpointStatus.open)); // same status again
      await Future<void>.delayed(Duration.zero);
      expect(seen, ['c1:open']);
      feed.publish(_snapshot(CheckpointStatus.closed));
      await Future<void>.delayed(Duration.zero);
      expect(seen, ['c1:open', 'c1:closed']);
    });
  });

  group('checkpoint refresh while a route is shown', () {
    testWidgets('re-reads checkpoints once a minute in the foreground only', (
      tester,
    ) async {
      final feed = _Checkpoints(_snapshot(CheckpointStatus.open));
      final container = ProviderContainer(
        overrides: [checkpointsProvider.overrideWith(() => feed)],
      );
      final sub = container.listen(routeCheckpointRefreshProvider, (_, _) {});

      await tester.pump(const Duration(seconds: 59));
      expect(feed.refreshes, 0);
      await tester.pump(const Duration(seconds: 2));
      expect(feed.refreshes, 1);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump(const Duration(minutes: 3));
      expect(feed.refreshes, 1);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump(const Duration(seconds: 61));
      expect(feed.refreshes, 2);

      sub.close();
      container.dispose();
      await tester.pump(const Duration(minutes: 5));
      expect(feed.refreshes, 2);
    });
  });

  group('route notices', () {
    RoadRoute roadOf(Map<String, dynamic> json) => RoadRoute(
      points: const [_a, _b],
      routed: true,
      plan: RoutePlan.fromJson(json),
    );

    test('says why the route changed when a closure was avoided', () {
      final road = roadOf(
        _planJson(status: 'rerouted_closed', avoided: [_cp('الجبع', 'closed')]),
      );
      expect(
        routeNotices(en, road).single.text,
        'Route changed: checkpoint EN الجبع is closed',
      );
      expect(
        routeNotices(ar, road).single.text,
        'تم تغيير المسار: حاجز الجبع مغلق',
      );
    });

    test('adds the extra time when it is meaningful', () {
      final road = roadOf(
        _planJson(
          status: 'rerouted_closed',
          avoided: [_cp('shut', 'closed')],
          extraSeconds: 420,
        ),
      );
      expect(routeNotices(en, road).single.text, contains('7 min longer'));
    });

    test('warns plainly when every known route is closed', () {
      final road = roadOf(
        _planJson(
          status: 'blocked',
          onRoute: [_cp('one', 'closed'), _cp('two', 'open')],
          warnings: ['all_routes_closed'],
        ),
      );
      final notice = routeNotices(en, road).single;
      expect(notice.level, RouteNoticeLevel.critical);
      expect(
        notice.text,
        startsWith('All known routes pass a closed checkpoint: EN one'),
      );
      expect(notice.text, isNot(contains('two')));
    });

    test('warns about unavoidable congestion and about avoided congestion', () {
      expect(
        routeNotices(
          en,
          roadOf(
            _planJson(
              status: 'congestion_warning',
              onRoute: [_cp('busy', 'congested')],
            ),
          ),
        ).single.text,
        contains('congested checkpoint: EN busy'),
      );
      expect(
        routeNotices(
          en,
          roadOf(
            _planJson(
              status: 'rerouted_congestion',
              avoided: [_cp('busy', 'congested')],
            ),
          ),
        ).single.text,
        'Route changed to avoid congestion at EN busy',
      );
    });

    test(
      'says so when statuses are old, when a position is approximate, when unchecked',
      () {
        final stale = routeNotices(
          en,
          roadOf(_planJson(warnings: ['status_stale'])),
        );
        expect(stale.single.text, contains('out of date'));
        final fuzzy = routeNotices(
          en,
          roadOf(_planJson(warnings: ['position_approximate'])),
        );
        expect(fuzzy.single.text, contains('approximate'));
        final unchecked = routeNotices(
          en,
          roadOf(_planJson(status: 'unchecked')),
        );
        expect(unchecked.single.text, en.routeCheckUnavailable);
      },
    );

    test(
      'a clear route and a plain route say nothing; a failed check warns',
      () {
        expect(routeNotices(en, roadOf(_planJson())), isEmpty);
        expect(
          routeNotices(en, const RoadRoute(points: [_a, _b], routed: true)),
          isEmpty,
        );
        expect(routeNotices(en, null), isEmpty);
        final failed = routeNotices(
          en,
          const RoadRoute(points: [_a, _b], routed: true, checkFailed: true),
        );
        expect(failed.single.text, en.routeCheckUnavailable);
        expect(
          roadRouteNotes(
            en,
            const RoadRoute(points: [_a, _b], routed: true, checkFailed: true),
          ),
          [en.routeCheckUnavailable],
        );
      },
    );

    test('highlights each checkpoint on the route in its status colour', () {
      final road = roadOf(
        _planJson(
          onRoute: [
            _cp('shut', 'closed'),
            _cp('busy', 'congested', lat: 31.52),
            _cp('ok', 'open', lat: 31.54),
          ],
        ),
      );
      final markers = roadRouteMarkers(en, road);
      expect(markers.map((m) => m.color), [
        SemanticColors.checkpointClosed,
        SemanticColors.checkpointCongested,
        SemanticColors.checkpointOpen,
      ]);
      expect(markers.first.label, startsWith('On your route:'));
    });
  });

  testWidgets('the route map shows the "route changed" banner and highlights', (
    tester,
  ) async {
    final planner = _Planner(
      (_) async => RoutePlan.fromJson(
        _planJson(
          status: 'rerouted_closed',
          avoided: [_cp('shut', 'closed')],
          onRoute: [_cp('ok', 'open', lat: 31.54)],
        ),
      ),
    );
    final container = _container(planner: planner);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: DarbRouteMap(
              waypoints: const [_a, _b],
              emptyLabel: 'empty',
              tileProvider: _BlankTiles(),
            ),
          ),
        ),
      ),
    );
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 80)),
    );
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const ValueKey('routeNotice')), findsOneWidget);
    expect(
      find.textContaining('Route changed: checkpoint EN shut is closed'),
      findsOneWidget,
    );
    final map = tester.widget<DarbMap>(find.byType(DarbMap));
    expect(map.paths.single.dashed, isFalse);
    expect(
      map.markers.any((m) => m.label.startsWith('On your route:')),
      isTrue,
    );
    // The banner carries the notice; the notes do not repeat it.
    expect(map.notes.where((n) => n.startsWith('Route changed')), isEmpty);
  });
}

class _BlankTiles extends TileProvider {
  @override
  ImageProvider getImage(coordinates, options) =>
      MemoryImage(TileProvider.transparentImage);
}
