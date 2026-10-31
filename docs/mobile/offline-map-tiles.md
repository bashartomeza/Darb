# Offline map tiles

Connectivity is poor at checkpoints, so map tiles are cached on the device.
Areas the user has already looked at (including the corridor's route area)
keep rendering with no connection.

## How it works

- Code: `apps/mobile/lib/core/maps/map_tile_cache.dart` (`MapTileConfig`,
  `MapTileCache`), used by `MasariMap`.
- It builds on the caching provider that ships with `flutter_map` 8.x
  (`BuiltInMapCachingProvider`): no extra dependency, files on disk in the
  app cache directory.
- **Fills as the user browses.** There is no bulk or region prefetch.
- **Bounded:** `MapTileConfig.maxCacheBytes` (100 MB). Past it the
  least-recently-used tiles are evicted.
- **Respects the tile server's cache headers** (`Cache-Control`, `Expires`,
  `ETag`, `Last-Modified`) while online: fresh tiles are served from disk
  without a request, stale ones are revalidated.
- **Outage behaviour.** When a tile fails to load, `MapTileCache` serves saved
  tiles even if past their freshness for `MapTileConfig.offlineWindow` (30 s),
  then tries the network again. Without this, stale tiles would be dropped
  exactly when the user is offline.
- **Indicator.** A small "Offline - showing saved map" chip appears at the
  bottom of the map when tiles are failing and saved tiles are on screen. It
  disappears as soon as a tile arrives from the server. Online behaviour is
  otherwise unchanged.
- **Clear map cache.** Security and sessions screen (settings) has "Clear saved
  map" (EN and AR).

## OpenStreetMap tile usage policy

The default source is the public `tile.openstreetmap.org` server, which is
governed by <https://operations.osmfoundation.org/policies/tiles/>. What this
app does about it:

- Sends an identifying User-Agent (`flutter_map (ps.masari.mobile)`, from
  `MapTileConfig.userAgentPackageName`).
- Caches tiles and honours cache headers (the policy asks for at least 7 days of
  caching), which also reduces load on OSM.
- No bulk downloading or prefetching of tiles.
- Shows the "OpenStreetMap contributors" attribution on every map.

The public servers are for light use. `flutter_map` prints a policy reminder in
debug builds. If Masari grows beyond demo / pilot traffic, move to a tile
server we are entitled to use heavily.

## Switching to a self-hosted or commercial tile server

Change one value, no other code:

- Build time: `flutter build apk --dart-define=MAP_TILE_URL=https://tiles.example.com/{z}/{x}/{y}.png`
- Or edit the default of `MapTileConfig.tileUrlTemplate`.

Also update the attribution string (`mapAttribution` in the ARB files and the
literal in `create_request_screen.dart`) to the new provider's required
credit, and put any API key in the URL via `--dart-define` rather than the
source. The cache keys on the full tile URL, so changing the server simply
starts a fresh cache.

## Testing

`MasariMap` accepts `tileProvider` (a fake that never touches the network) and
`tileCache`. See `apps/mobile/test/map_tile_cache_test.dart`.
