import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/maps/map_tile_cache.dart';
import 'package:masari_mobile/core/widgets/map_cache_tile.dart';
import 'package:masari_mobile/core/widgets/masari_map.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

/// Serves a blank tile without touching the network.
class _FakeTileProvider extends TileProvider {
  int requests = 0;

  @override
  ImageProvider getImage(TileCoordinates coordinates, TileLayer options) {
    requests++;
    return MemoryImage(TileProvider.transparentImage);
  }
}

class _FakeDiskCache implements BuiltInMapCachingProvider {
  _FakeDiskCache(this.tiles);

  final Map<String, CachedMapTile> tiles;
  final List<String> puts = [];
  bool destroyed = false;
  bool deletedFiles = false;

  @override
  bool get isSupported => true;

  @override
  Future<CachedMapTile?> getTile(String url) async => tiles[url];

  @override
  Future<void> putTile({
    required String url,
    required CachedMapTileMetadata metadata,
    Uint8List? bytes,
  }) async {
    puts.add(url);
  }

  @override
  Future<void> destroy({bool deleteCache = false}) async {
    destroyed = true;
    deletedFiles = deleteCache;
  }
}

CachedMapTile _tile({required bool stale}) => (
  bytes: TileProvider.transparentImage,
  metadata: CachedMapTileMetadata(
    staleAt: DateTime.timestamp().add(
      stale ? const Duration(days: -1) : const Duration(days: 1),
    ),
    lastModified: null,
    etag: null,
  ),
);

Widget _host(Widget child, {Locale locale = const Locale('en')}) => MaterialApp(
  locale: locale,
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: Scaffold(body: child),
);

void main() {
  group('MapTileConfig', () {
    test('identifies the app and bounds the cache at 100 MB', () {
      expect(MapTileConfig.userAgentPackageName, 'ps.masari.mobile');
      expect(MapTileConfig.maxCacheBytes, 100 * 1000 * 1000);
      expect(MapTileConfig.tileUrlTemplate, contains('{z}/{x}/{y}'));
    });
  });

  group('MapTileCache', () {
    test('passes fresh tiles through and never claims offline', () async {
      final disk = _FakeDiskCache({'u': _tile(stale: false)});
      final cache = MapTileCache(factory: () => disk);

      final tile = await cache.getTile('u');

      expect(tile, isNotNull);
      expect(tile!.metadata.isStale, isFalse);
      expect(cache.showingSavedMap.value, isFalse);
    });

    test('stale tiles stay stale while online (headers respected)', () async {
      final disk = _FakeDiskCache({'u': _tile(stale: true)});
      final cache = MapTileCache(factory: () => disk);

      final tile = await cache.getTile('u');

      expect(tile!.metadata.isStale, isTrue);
    });

    test(
      'after a failure a stale tile is served and the flag is set',
      () async {
        final disk = _FakeDiskCache({'u': _tile(stale: true)});
        final cache = MapTileCache(factory: () => disk);

        await cache.getTile('u'); // a saved tile is on screen
        cache.reportTileError(); // another tile could not load
        final tile = await cache.getTile('u');

        expect(tile!.metadata.isStale, isFalse);
        expect(cache.showingSavedMap.value, isTrue);
      },
    );

    test('a failure with nothing saved does not claim a saved map', () {
      final cache = MapTileCache(factory: () => _FakeDiskCache({}));

      cache.reportTileError();

      expect(cache.showingSavedMap.value, isFalse);
    });

    test('the network is tried again once the offline window passes', () async {
      var now = DateTime(2026, 1, 1);
      final disk = _FakeDiskCache({'u': _tile(stale: true)});
      final cache = MapTileCache(factory: () => disk, clock: () => now);

      await cache.getTile('u');
      cache.reportTileError();
      now = now.add(MapTileConfig.offlineWindow + const Duration(seconds: 1));
      final tile = await cache.getTile('u');

      expect(tile!.metadata.isStale, isTrue);
    });

    test('a tile arriving from the server clears the flag', () async {
      final disk = _FakeDiskCache({'u': _tile(stale: false)});
      final cache = MapTileCache(factory: () => disk);
      await cache.getTile('u');
      cache.reportTileError();
      expect(cache.showingSavedMap.value, isTrue);

      await cache.putTile(
        url: 'v',
        metadata: _tile(stale: false).metadata,
        bytes: Uint8List(1),
      );

      expect(cache.showingSavedMap.value, isFalse);
      expect(disk.puts, ['v']);
    });

    test('clear deletes the saved tiles and resets state', () async {
      final disk = _FakeDiskCache({'u': _tile(stale: false)});
      final cache = MapTileCache(factory: () => disk);
      await cache.getTile('u');
      cache.reportTileError();

      await cache.clear();

      expect(disk.destroyed, isTrue);
      expect(disk.deletedFiles, isTrue);
      expect(cache.showingSavedMap.value, isFalse);
    });
  });

  group('MasariMap tile layer', () {
    testWidgets('uses the supplied tile provider and shows no offline note', (
      tester,
    ) async {
      final provider = _FakeTileProvider();
      final cache = MapTileCache(factory: () => _FakeDiskCache({}));

      await tester.pumpWidget(
        _host(
          MasariMap(
            emptyLabel: 'empty',
            attributionLabel: 'attr',
            tileProvider: provider,
            tileCache: cache,
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.byType(TileLayer), findsOneWidget);
      expect(provider.requests, greaterThan(0));
      expect(find.byKey(const ValueKey('mapOfflineChip')), findsNothing);
      expect(find.text('attr'), findsOneWidget);
    });

    testWidgets('shows the offline note only while saved tiles are in use', (
      tester,
    ) async {
      final disk = _FakeDiskCache({'u': _tile(stale: false)});
      final cache = MapTileCache(factory: () => disk);

      await tester.pumpWidget(
        _host(
          MasariMap(
            emptyLabel: 'empty',
            attributionLabel: 'attr',
            tileProvider: _FakeTileProvider(),
            tileCache: cache,
          ),
        ),
      );
      expect(find.byKey(const ValueKey('mapOfflineChip')), findsNothing);

      await tester.runAsync(() => cache.getTile('u'));
      cache.reportTileError();
      await tester.pump();

      expect(find.byKey(const ValueKey('mapOfflineChip')), findsOneWidget);
      expect(find.text('Offline - showing saved map'), findsOneWidget);

      await tester.runAsync(
        () => cache.putTile(url: 'v', metadata: _tile(stale: false).metadata),
      );
      await tester.pump();

      expect(find.byKey(const ValueKey('mapOfflineChip')), findsNothing);
    });

    testWidgets('the offline note is localized to Arabic', (tester) async {
      final disk = _FakeDiskCache({'u': _tile(stale: false)});
      final cache = MapTileCache(factory: () => disk);

      await tester.pumpWidget(
        _host(
          MasariMap(
            emptyLabel: 'empty',
            attributionLabel: 'attr',
            tileProvider: _FakeTileProvider(),
            tileCache: cache,
          ),
          locale: const Locale('ar'),
        ),
      );
      await tester.runAsync(() => cache.getTile('u'));
      cache.reportTileError();
      await tester.pump();

      expect(find.text('بدون اتصال - تُعرض الخريطة المحفوظة'), findsOneWidget);
    });
  });

  group('MapCacheTile', () {
    testWidgets('clears the saved map and confirms', (tester) async {
      final disk = _FakeDiskCache({'u': _tile(stale: false)});
      final cache = MapTileCache(factory: () => disk);
      await cache.getTile('u');

      await tester.pumpWidget(_host(MapCacheTile(cache: cache)));
      expect(find.text('Clear saved map'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('clearMapCache')));
      await tester.pumpAndSettle();

      expect(disk.deletedFiles, isTrue);
      expect(find.text('Saved map cleared'), findsOneWidget);
    });
  });
}
