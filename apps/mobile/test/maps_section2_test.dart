import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:latlong2/latlong.dart';

import 'package:darb_mobile/core/api/api_client.dart';
import 'package:darb_mobile/core/maps/checkpoint_map_markers.dart';
import 'package:darb_mobile/core/maps/darb_route_map.dart';
import 'package:darb_mobile/core/maps/map_overlays.dart';
import 'package:darb_mobile/core/maps/map_tile_cache.dart';
import 'package:darb_mobile/core/maps/osrm_route_service.dart';
import 'package:darb_mobile/core/maps/service_area.dart';
import 'package:darb_mobile/core/theme/semantic_colors.dart';
import 'package:darb_mobile/core/widgets/darb_map.dart';
import 'package:darb_mobile/features/canonical_routes/application/canonical_route_controller.dart';
import 'package:darb_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:darb_mobile/features/checkpoints/domain/checkpoint_models.dart';
import 'package:darb_mobile/features/community_reports/application/community_reports_controller.dart';
import 'package:darb_mobile/features/community_reports/data/community_report_models.dart';
import 'package:darb_mobile/features/community_reports/presentation/community_reports_section.dart';
import 'package:darb_mobile/features/merchant/data/merchant_models.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';
import 'package:darb_mobile/l10n/app_localizations_en.dart';

/// Serves a blank tile without touching the network and counts its life.
class _CountingTiles extends TileProvider {
  int requests = 0;
  int disposed = 0;

  @override
  ImageProvider getImage(TileCoordinates coordinates, TileLayer options) {
    requests++;
    return MemoryImage(TileProvider.transparentImage);
  }

  @override
  void dispose() => disposed++;
}

/// Every tile fails, like a phone with no connection and no saved map.
class _FailingTiles extends TileProvider {
  int requests = 0;

  @override
  ImageProvider getImage(TileCoordinates coordinates, TileLayer options) {
    requests++;
    return _BrokenImage(requests);
  }
}

class _BrokenImage extends ImageProvider<_BrokenImage> {
  const _BrokenImage(this.id);

  final int id;

  @override
  Future<_BrokenImage> obtainKey(ImageConfiguration configuration) =>
      Future.value(this);

  @override
  ImageStreamCompleter loadImage(
    _BrokenImage key,
    ImageDecoderCallback decode,
  ) => OneFrameImageStreamCompleter(Future.error(StateError('offline')));
}

/// Tiles that never arrive (a stalled connection).
class _PendingTiles extends TileProvider {
  @override
  ImageProvider getImage(TileCoordinates coordinates, TileLayer options) =>
      const _PendingImage();
}

class _PendingImage extends ImageProvider<_PendingImage> {
  const _PendingImage();

  @override
  Future<_PendingImage> obtainKey(ImageConfiguration configuration) =>
      Future.value(this);

  @override
  ImageStreamCompleter loadImage(
    _PendingImage key,
    ImageDecoderCallback decode,
  ) => OneFrameImageStreamCompleter(Completer<ImageInfo>().future);
}

final _cache = MapTileCache(factory: () => throw UnimplementedError());

Widget _host(Widget child, {ProviderContainer? container}) {
  final app = MaterialApp(
    locale: const Locale('en'),
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(body: SingleChildScrollView(child: child)),
  );
  return container == null
      ? ProviderScope(child: app)
      : UncontrolledProviderScope(container: container, child: app);
}

MapCamera _camera(WidgetTester tester) =>
    MapCamera.of(tester.element(find.byType(TileLayer)));

DarbMapMarker _marker(double lat, double lng, {String label = 'm'}) =>
    DarbMapMarker(
      position: GeoPoint(lat, lng),
      icon: Icons.place,
      color: SemanticColors.action,
      label: label,
    );

// Mountain View, California: the Android emulator's default GPS fix.
const _usa = GeoPoint(37.4220, -122.0841);

void main() {
  final l10n = AppLocalizationsEn();

  // ==========================================================================
  // 1. SERVICE AREA
  // ==========================================================================
  group('service area', () {
    test('contains Palestine and rejects the emulator default', () {
      expect(DarbServiceArea.contains(31.5326, 35.0998), isTrue);
      expect(DarbServiceArea.contains(_usa.latitude, _usa.longitude), isFalse);
      expect(DarbServiceArea.contains(double.nan, 35), isFalse);
    });

    testWidgets('an out-of-area location never moves the camera: Hebron', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(
          DarbMap(
            emptyLabel: 'empty',
            attributionLabel: 'attr',
            tileProvider: _CountingTiles(),
            tileCache: _cache,
            markers: [
              DarbMapMarker(
                position: _usa,
                icon: Icons.my_location_rounded,
                color: SemanticColors.passenger,
                type: DarbMapMarkerType.location,
                label: 'You',
              ),
            ],
          ),
        ),
      );
      await tester.pump();
      final camera = _camera(tester);
      expect(camera.center.latitude, closeTo(31.5326, 0.01));
      expect(camera.center.longitude, closeTo(35.0998, 0.01));
      expect(tester.takeException(), isNull);
    });

    testWidgets('frames only in-area points when some are abroad', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(
          DarbMap(
            emptyLabel: 'empty',
            attributionLabel: 'attr',
            tileProvider: _CountingTiles(),
            tileCache: _cache,
            markers: [
              _marker(31.53, 35.10),
              _marker(31.70, 35.20),
              _marker(_usa.latitude, _usa.longitude),
            ],
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
      final camera = _camera(tester);
      expect(
        DarbServiceArea.contains(
          camera.center.latitude,
          camera.center.longitude,
        ),
        isTrue,
      );
      expect(camera.zoom, greaterThan(9));
    });

    test('checkpoint and report layers do not frame the camera', () {
      expect(
        const DarbMapMarker(
          position: GeoPoint(31.5, 35.1),
          icon: Icons.place,
          color: SemanticColors.action,
          label: 'c',
          type: DarbMapMarkerType.checkpoint,
        ).fitsCamera,
        isFalse,
      );
      expect(_marker(31.5, 35.1).fitsCamera, isTrue);
    });
  });

  // ==========================================================================
  // 2. TILES: ONE LAYER, ONE PROVIDER, A RETRY WHEN THEY FAIL
  // ==========================================================================
  group('tile layer', () {
    testWidgets('fitting new content moves the camera without a new layer', (
      tester,
    ) async {
      final tiles = _CountingTiles();
      Widget map(List<DarbMapMarker> markers) => _host(
        DarbMap(
          emptyLabel: 'empty',
          attributionLabel: 'attr',
          tileProvider: tiles,
          tileCache: _cache,
          markers: markers,
        ),
      );

      await tester.pumpWidget(map([_marker(31.53, 35.10)]));
      await tester.pump();
      final layer = tester.state(find.byType(TileLayer));
      final before = _camera(tester).center;

      await tester.pumpWidget(map([_marker(32.22, 35.25)]));
      await tester.pump();
      await tester.pump();

      expect(identical(tester.state(find.byType(TileLayer)), layer), isTrue);
      expect(tiles.disposed, 0);
      expect(_camera(tester).center, isNot(before));
      expect(_camera(tester).center.latitude, closeTo(32.22, 0.01));
      // The layer loaded tiles for the new view itself.
      expect(tiles.requests, greaterThan(0));
    });

    testWidgets('a poll with the same content does not refit or rebuild', (
      tester,
    ) async {
      final tiles = _CountingTiles();
      Widget map() => _host(
        DarbMap(
          emptyLabel: 'empty',
          attributionLabel: 'attr',
          tileProvider: tiles,
          tileCache: _cache,
          // New list instances with equal content, as a 5-second refresh makes.
          markers: [_marker(31.53, 35.10), _marker(31.7, 35.2)],
        ),
      );
      await tester.pumpWidget(map());
      await tester.pump();
      final layer = tester.state(find.byType(TileLayer));
      final camera = _camera(tester);
      await tester.pumpWidget(map());
      await tester.pump();
      expect(identical(tester.state(find.byType(TileLayer)), layer), isTrue);
      expect(_camera(tester).center, camera.center);
      expect(_camera(tester).zoom, camera.zoom);
    });

    testWidgets('failing tiles show a retry instead of a blank map', (
      tester,
    ) async {
      final tiles = _FailingTiles();
      await tester.pumpWidget(
        _host(
          DarbMap(
            emptyLabel: 'empty',
            attributionLabel: 'attr',
            tileProvider: tiles,
            tileCache: _cache,
          ),
        ),
      );
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const ValueKey('mapTilesFailed')), findsOneWidget);
      expect(find.byKey(const ValueKey('mapTilesLoading')), findsNothing);
      final layer = tester.state(find.byType(TileLayer));
      final before = tiles.requests;
      await tester.tap(find.byKey(const ValueKey('mapTilesRetry')));
      await tester.pump();
      // Retry reloads the tiles through the same layer.
      expect(tiles.requests, greaterThan(before));
      expect(identical(tester.state(find.byType(TileLayer)), layer), isTrue);
    });

    testWidgets('a map waiting for tiles says it is loading', (tester) async {
      await tester.pumpWidget(
        _host(
          DarbMap(
            emptyLabel: 'empty',
            attributionLabel: 'attr',
            tileProvider: _PendingTiles(),
            tileCache: _cache,
          ),
        ),
      );
      await tester.pump();
      expect(find.byKey(const ValueKey('mapTilesLoading')), findsOneWidget);
    });

    test('the disk tile cache is never opened on the web', () async {
      MapTileCache.runningOnWeb = true;
      addTearDown(() => MapTileCache.runningOnWeb = false);
      var opened = false;
      final cache = MapTileCache(
        factory: () {
          opened = true;
          throw UnsupportedError('no disk cache on the web');
        },
      );
      expect(cache.isSupported, isFalse);
      expect(await cache.getTile('u'), isNull);
      await cache.clear();
      expect(opened, isFalse);
    });
  });

  // ==========================================================================
  // 3. ROUTES: CACHED, AND A LABELLED STRAIGHT LINE WHEN ROUTING FAILS
  // ==========================================================================
  group('road routes', () {
    http.Response road(double lat, double lng) => http.Response(
      jsonEncode({
        'code': 'Ok',
        'routes': [
          {
            'duration': 600,
            'distance': 1234,
            'geometry': {
              'coordinates': [
                [lng, lat],
                [35.15, 31.6],
                [35.2, 31.7],
              ],
            },
          },
        ],
      }),
      200,
    );

    test('one request per rounded route, shared while in flight', () async {
      var calls = 0;
      final service = OsrmRouteService(
        client: MockClient((_) async {
          calls++;
          return road(31.53, 35.1);
        }),
      );
      const a = LatLng(31.53261, 35.09981);
      const b = LatLng(31.7054, 35.2024);
      await Future.wait([
        service.getRoute(start: a, end: b),
        service.getRoute(start: a, end: b),
      ]);
      // GPS jitter of a few metres is the same route.
      await service.getRoute(start: const LatLng(31.53262, 35.09979), end: b);
      expect(calls, 1);
      expect(service.requestCount, 1);
      await service.getRoute(start: const LatLng(31.6, 35.1), end: b);
      expect(service.requestCount, 2);
    });

    test('retries once, then remembers the failure briefly', () async {
      var calls = 0;
      final service = OsrmRouteService(
        client: MockClient((_) async {
          calls++;
          return http.Response('busy', 503);
        }),
      );
      const a = LatLng(31.53, 35.1);
      const b = LatLng(31.7, 35.2);
      await expectLater(service.getRoute(start: a, end: b), throwsException);
      expect(calls, 2);
      await expectLater(service.getRoute(start: a, end: b), throwsException);
      expect(calls, 2);
    });

    testWidgets('routing failure draws the record ends as a labelled dashed '
        'line', (tester) async {
      final container = ProviderContainer(
        overrides: [
          httpClientProvider.overrideWithValue(
            MockClient((_) async => http.Response('down', 503)),
          ),
          mobileCapabilitiesProvider.overrideWith(_Caps.new),
        ],
      );
      addTearDown(container.dispose);
      final order = MerchantOrder.fromJson({
        'id': 'o1',
        'pickup_label': 'Warehouse',
        'pickup_lat': '31.532600',
        'pickup_lng': '35.099800',
        'status': 'submitted',
        'created_at': '2026-11-01T10:00:00Z',
        'parcels': [
          {
            'id': 'p1',
            'destination_label': 'Market',
            'destination_lat': '31.705400',
            'destination_lng': '35.202400',
            'size': 'S',
            'priority': 'normal',
            'status': 'pending',
          },
        ],
        'parcel_batches': const [],
      });
      expect(order.routeWaypoints, const [
        GeoPoint(31.5326, 35.0998),
        GeoPoint(31.7054, 35.2024),
      ]);

      await tester.pumpWidget(
        _host(
          DarbRouteMap(
            waypoints: order.routeWaypoints,
            emptyLabel: 'empty',
            originLabel: order.pickupLabel,
            destinationLabel: 'Market',
            tileProvider: _CountingTiles(),
          ),
          container: container,
        ),
      );
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 50)),
      );
      await tester.pump();
      final map = tester.widget<DarbMap>(find.byType(DarbMap));
      final path = map.paths.single;
      expect(path.dashed, isTrue);
      expect(path.points, order.routeWaypoints);
      expect(map.notes, contains(l10n.mapStraightLineNote));
      expect(find.text(l10n.mapStraightLineNote), findsOneWidget);
      // No checkpoint source configured: said so, not silently empty.
      expect(map.notes, contains(l10n.mapCheckpointsUnavailable));
    });
  });

  // ==========================================================================
  // 4. CHECKPOINT SOURCES
  // ==========================================================================
  group('checkpoint sources', () {
    final partner = CheckpointSnapshot.fromJson({
      'source': 'aweenrayeh_partner',
      'fetched_at': '2026-11-01T10:00:01Z',
      'stale': false,
      'position_attribution': '© OpenStreetMap contributors',
      'checkpoints': [
        {
          'id': 'aweenrayeh:p1',
          'name_ar': 'حاجز اختبار',
          'city': 'مدينة اختبار',
          'latitude': 32.178,
          'longitude': 35.2734,
          'status': 'unknown',
          'entering_status_last_updated': '2026-11-01T09:00:00',
          'leaving_status_last_updated': '2026-11-01T09:30:00Z',
          'position_source': 'openstreetmap',
        },
      ],
      'unplaced': [
        {
          'id': 'aweenrayeh:p2',
          'name_ar': 'حاجز بلا موقع',
          'city': 'مدينة اختبار',
          'entering_status_last_updated': '2026-11-01T08:00:00',
          'leaving_status_last_updated': '2026-11-01T08:00:00',
        },
        {'id': 'broken'},
      ],
    });

    test('partner rows parse; unplaced rows are listed, never pinned', () {
      expect(partner.source, 'aweenrayeh_partner');
      expect(partner.checkpoints.single.positionFromOpenStreetMap, isTrue);
      expect(partner.unplaced.map((c) => c.id), ['aweenrayeh:p2']);
      final markers = checkpointTrafficMarkers(partner.checkpoints, l10n: l10n);
      expect(markers, hasLength(1));
      expect(markers.single.color, SemanticColors.checkpointUnknown);
      expect(markers.single.label, contains(l10n.checkpointOfficialUnknown));
      expect(
        markers.single.label,
        contains(l10n.checkpointEnteringChanged('2026-11-01 09:00')),
      );
      expect(markers.single.label, contains(l10n.checkpointPositionOsm));
    });

    test('partner status shows on pins and on the no-position list', () {
      final live = CheckpointSnapshot.fromJson({
        'source': 'aweenrayeh_partner',
        'checkpoints': [
          {
            'id': 'aweenrayeh:p1',
            'name_ar': 'حاجز اختبار',
            'latitude': 32.178,
            'longitude': 35.2734,
            'status': 'congested',
            'entering_status': 'أزمة خانقة',
            'leaving_status': 'سالك',
          },
        ],
        'unplaced': [
          {
            'id': 'aweenrayeh:p2',
            'name_ar': 'حاجز بلا موقع',
            'status': 'closed',
            'entering_status': 'مغلق',
            'leaving_status': 'مغلق',
          },
        ],
      });
      final marker = checkpointTrafficMarkers(
        live.checkpoints,
        l10n: l10n,
      ).single;
      expect(marker.color, checkpointStatusColor(CheckpointStatus.congested));
      expect(marker.label, isNot(contains(l10n.checkpointOfficialUnknown)));
      expect(marker.label, contains('دخول: أزمة خانقة'));
      expect(parseCheckpointStatus('أزمة خانقة'), CheckpointStatus.congested);
      final unplaced = live.unplaced.single;
      expect(unplaced.status, CheckpointStatus.closed);
      expect(unplaced.enteringStatus, 'مغلق');
    });

    test('status colours are the shared palette', () {
      expect(
        checkpointStatusColor(CheckpointStatus.open),
        const Color(0xFF3A7C07),
      );
      expect(
        checkpointStatusColor(CheckpointStatus.congested),
        const Color(0xFFFA5F12),
      );
      expect(
        checkpointStatusColor(CheckpointStatus.closed),
        const Color(0xFFEB3223),
      );
      expect(
        checkpointStatusColor(CheckpointStatus.unknown),
        SemanticColors.checkpointUnknown,
      );
    });

    test('a nearby checkpoint report rings the marker, never recolours it', () {
      final now = DateTime.utc(2026, 11, 1, 12);
      final checkpoint = partner.checkpoints.single;
      CommunityReport report(String category, {double dLat = 0.001}) =>
          CommunityReport.fromJson({
            'id': 'r-$category-$dLat',
            'category': category,
            'description': 'seen it',
            'location_name': 'here',
            'created_at': '2026-11-01T11:30:00Z',
            'latitude': checkpoint.position.latitude + dLat,
            'longitude': checkpoint.position.longitude,
            'upvotes': 4,
          });
      final notes = communityCheckpointNotes(partner.checkpoints, [
        report('checkpoint_open_marked_closed'),
        // ~1 km away: about another place.
        report('checkpoint_closed_marked_open', dLat: 0.01),
      ], now: now);
      final note = notes[checkpoint.id]!;
      expect(note.claim, CommunityCheckpointClaim.open);
      expect(note.wellSupported, isTrue);
      final marker = checkpointTrafficMarker(
        checkpoint,
        l10n: l10n,
        community: note,
      );
      expect(marker.color, SemanticColors.checkpointUnknown);
      expect(marker.ringColor, SemanticColors.checkpointOpen);
      expect(
        marker.label,
        contains(l10n.checkpointCommunitySays(l10n.communityStatusOpen)),
      );
    });

    testWidgets('the map asks for checkpoints only when a source is on', (
      tester,
    ) async {
      var reads = 0;
      final container = ProviderContainer(
        overrides: [
          mobileCapabilitiesProvider.overrideWith(_Caps.new),
          httpClientProvider.overrideWithValue(
            MockClient((request) async {
              if (request.url.path.endsWith('/checkpoints')) reads++;
              return http.Response('{}', 404);
            }),
          ),
        ],
      );
      addTearDown(container.dispose);
      MapOverlay? overlay;
      await tester.pumpWidget(
        _host(
          Consumer(
            builder: (context, ref, _) {
              overlay = watchMapOverlay(ref, AppLocalizations.of(context));
              return const SizedBox();
            },
          ),
          container: container,
        ),
      );
      await tester.pump();
      expect(reads, 0);
      expect(overlay!.checkpointsAvailable, isFalse);
      expect(overlay!.notes, [l10n.mapCheckpointsUnavailable]);
    });
  });

  // ==========================================================================
  // 5. COMMUNITY REPORTS ON THE MAP
  // ==========================================================================
  group('community reports', () {
    test('map categories need a place; driver and other do not', () {
      expect(CommunityReportCategory.roadClosure.requiresLocation, isTrue);
      expect(
        CommunityReportCategory.checkpointOutdated.requiresLocation,
        isTrue,
      );
      expect(CommunityReportCategory.incorrectMapInfo.requiresLocation, isTrue);
      expect(CommunityReportCategory.safetyAlert.requiresLocation, isTrue);
      expect(CommunityReportCategory.driverReport.requiresLocation, isFalse);
      expect(CommunityReportCategory.other.requiresLocation, isFalse);
    });

    test('located reports become pins with category and standing', () {
      final now = DateTime.utc(2026, 11, 1, 12);
      CommunityReport report(String id, int up, int down, double lat) =>
          CommunityReport.fromJson({
            'id': id,
            'category': 'road_closure',
            'description': 'blocked',
            'location_name': 'junction',
            'created_at': '2026-11-01T11:00:00Z',
            'latitude': lat,
            'longitude': 35.1,
            'upvotes': up,
            'downvotes': down,
          });
      final pins = communityReportMarkers(l10n, [
        report('supported', 5, 0, 31.5),
        report('disputed', 0, 5, 31.6),
        report('abroad', 0, 0, 37.4),
        CommunityReport.fromJson({
          'id': 'nowhere',
          'category': 'other',
          'description': 'x',
          'location_name': 'y',
          'created_at': '2026-11-01T11:00:00Z',
        }),
      ], now: now);
      expect(pins, hasLength(2));
      expect(pins.every((p) => p.type == DarbMapMarkerType.report), isTrue);
      expect(pins.every((p) => p.icon == Icons.block_rounded), isTrue);
      expect(pins[0].badgeIcon, Icons.verified_rounded);
      expect(pins[0].dimmed, isFalse);
      expect(pins[1].dimmed, isTrue);
    });

    testWidgets('the form needs a map place for road reports and sends it', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1000, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final sent = <Map<String, dynamic>>[];
      final container = ProviderContainer(
        overrides: [
          communityReportsProvider.overrideWith(() => _Reports(sent)),
        ],
      );
      addTearDown(container.dispose);
      await tester.pumpWidget(
        _host(
          CommunityReportForm(tileProvider: _CountingTiles()),
          container: container,
        ),
      );
      await tester.pump();
      await tester.tap(
        find.byKey(const ValueKey('communityCategory-road_closure')),
      );
      await tester.enterText(
        find.byKey(const ValueKey('communityDescription')),
        'Road blocked',
      );
      await tester.enterText(
        find.byKey(const ValueKey('communityLocation')),
        'Main junction',
      );
      await tester.pump();

      FilledButton submit() => tester.widget<FilledButton>(
        find.byKey(const ValueKey('communitySubmit')),
      );
      expect(submit().onPressed, isNull);
      expect(
        find.byKey(const ValueKey('communityLocationRequired')),
        findsOneWidget,
      );

      // Tap the middle of the small map: inside the service area (Hebron).
      await tester.tapAt(
        tester.getCenter(find.byKey(const ValueKey('communityLocationMap'))),
      );
      // The map waits out the double-tap window before reporting a tap.
      await tester.pump(const Duration(milliseconds: 600));
      expect(submit().onPressed, isNotNull);

      await tester.tap(find.byKey(const ValueKey('communitySubmit')));
      await tester.pump();
      expect(sent.single['category'], 'road_closure');
      expect(
        DarbServiceArea.contains(
          sent.single['latitude'] as double,
          sent.single['longitude'] as double,
        ),
        isTrue,
      );
      expect(sent.single['location_name'], 'Main junction');
    });

    testWidgets('driver reports may be sent without a place', (tester) async {
      tester.view.physicalSize = const Size(1000, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final container = ProviderContainer(
        overrides: [communityReportsProvider.overrideWith(() => _Reports([]))],
      );
      addTearDown(container.dispose);
      await tester.pumpWidget(
        _host(
          CommunityReportForm(tileProvider: _CountingTiles()),
          container: container,
        ),
      );
      await tester.pump();
      await tester.tap(
        find.byKey(const ValueKey('communityCategory-driver_report')),
      );
      await tester.enterText(
        find.byKey(const ValueKey('communityDescription')),
        'Rude driver',
      );
      await tester.enterText(
        find.byKey(const ValueKey('communityLocation')),
        'Bus',
      );
      await tester.pump();
      expect(
        tester
            .widget<FilledButton>(find.byKey(const ValueKey('communitySubmit')))
            .onPressed,
        isNotNull,
      );
    });
  });
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

class _Reports extends CommunityReportsNotifier {
  _Reports(this.sent);
  final List<Map<String, dynamic>> sent;

  @override
  Future<List<CommunityReport>> build() async => const [];

  @override
  Future<void> submit({
    required CommunityReportCategory category,
    required String description,
    required String locationName,
    double? latitude,
    double? longitude,
  }) async {
    sent.add({
      'category': category.apiValue,
      'description': description,
      'location_name': locationName,
      'latitude': latitude,
      'longitude': longitude,
    });
  }
}
