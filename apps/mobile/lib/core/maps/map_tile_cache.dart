import 'package:flutter/foundation.dart';
import 'package:flutter_map/flutter_map.dart';

/// Where map tiles come from and how they are cached on the device.
///
/// To move off the public OpenStreetMap servers (self-hosted or commercial
/// tile server), change [tileUrlTemplate] or build with
/// `--dart-define=MAP_TILE_URL=...`. See docs/mobile/offline-map-tiles.md.
abstract final class MapTileConfig {
  /// Tile address template. Defaults to the public OpenStreetMap server.
  static const String tileUrlTemplate = String.fromEnvironment(
    'MAP_TILE_URL',
    defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  );

  /// Identifies the app to the tile server (OSM tile usage policy requires an
  /// identifying User-Agent). flutter_map sends it as
  /// `flutter_map (ps.masari.mobile)`.
  static const String userAgentPackageName = 'ps.masari.mobile';

  /// Upper bound of the on-device tile cache. The oldest-used tiles are
  /// evicted first (LRU) once it is exceeded.
  static const int maxCacheBytes = 100 * 1000 * 1000;

  /// While the network is failing, tiles past their server-given freshness are
  /// still shown (they are better than a blank map) for this long before the
  /// network is tried again.
  static const Duration offlineWindow = Duration(seconds: 30);
}

/// Creates the underlying on-disk cache. Overridable for tests.
typedef MapCacheFactory = BuiltInMapCachingProvider Function();

BuiltInMapCachingProvider _defaultCacheFactory() =>
    BuiltInMapCachingProvider.getOrCreateInstance(
      maxCacheSize: MapTileConfig.maxCacheBytes,
    );

/// Disk tile cache that fills as the user browses (no prefetching), honours
/// the tile server's cache headers while online, and keeps serving saved tiles
/// when the connection is gone.
///
/// Wraps flutter_map's built-in caching provider (size-bounded, LRU eviction)
/// and adds three things: serving stale tiles during an outage, a flag the UI
/// can show ([showingSavedMap]) and a [clear] for app settings.
class MapTileCache implements MapCachingProvider {
  MapTileCache({MapCacheFactory? factory, DateTime Function()? clock})
    : _factory = factory ?? _defaultCacheFactory,
      _clock = clock ?? DateTime.now;

  /// The cache the app's maps share.
  static final MapTileCache shared = MapTileCache();

  final MapCacheFactory _factory;
  final DateTime Function() _clock;

  BuiltInMapCachingProvider? _inner;
  BuiltInMapCachingProvider get _cache => _inner ??= _factory();

  DateTime? _lastFailure;
  bool _servedFromCache = false;
  final ValueNotifier<bool> _showingSavedMap = ValueNotifier(false);

  /// True while tiles are failing to load and saved tiles are on screen.
  ValueListenable<bool> get showingSavedMap => _showingSavedMap;

  bool get _offline {
    final failure = _lastFailure;
    return failure != null &&
        _clock().difference(failure) < MapTileConfig.offlineWindow;
  }

  /// Called by the tile layer when a tile could not be loaded.
  void reportTileError() {
    _lastFailure = _clock();
    if (_servedFromCache) _showingSavedMap.value = true;
  }

  @override
  bool get isSupported => _cache.isSupported;

  @override
  Future<CachedMapTile?> getTile(String url) async {
    final tile = await _cache.getTile(url);
    if (tile == null) return null;
    _servedFromCache = true;
    if (!_offline || !tile.metadata.isStale) return tile;
    // Network is down: a stale tile beats a blank one.
    return (
      bytes: tile.bytes,
      metadata: CachedMapTileMetadata(
        staleAt: DateTime.timestamp().add(MapTileConfig.offlineWindow),
        lastModified: tile.metadata.lastModified,
        etag: tile.metadata.etag,
      ),
    );
  }

  @override
  Future<void> putTile({
    required String url,
    required CachedMapTileMetadata metadata,
    Uint8List? bytes,
  }) {
    // A tile reached us from the server: the connection is back.
    _lastFailure = null;
    _showingSavedMap.value = false;
    return _cache.putTile(url: url, metadata: metadata, bytes: bytes);
  }

  /// Deletes every saved tile. Maps opened afterwards refill it as they go.
  Future<void> clear() async {
    final inner = _inner;
    _inner = null;
    _servedFromCache = false;
    _lastFailure = null;
    _showingSavedMap.value = false;
    if (inner != null) {
      await inner.destroy(deleteCache: true);
    } else {
      // Nothing opened yet this run, but tiles from earlier runs may exist.
      await _factory().destroy(deleteCache: true);
    }
  }
}
