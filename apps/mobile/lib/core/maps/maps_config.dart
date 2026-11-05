import 'package:flutter/foundation.dart';

/// Where road routes come from.
enum RoutingSource {
  /// The Darb API's authenticated `/api/v1/maps/route` proxy. Provider keys
  /// stay on the server, never in the app. The default in staging/production.
  api,

  /// An OSRM-compatible server at `ROUTING_BASE_URL`.
  direct,

  /// No routing: maps draw a straight line and say so.
  disabled,
}

/// Build-time map configuration:
///
/// * `--dart-define=ROUTING_BASE_URL=https://routing.example.com` (OSRM API)
/// * `--dart-define=TILE_URL_TEMPLATE=https://tiles.example.com/{z}/{x}/{y}.png`
/// * `--dart-define=TILE_ATTRIBUTION=© OpenStreetMap contributors © Provider`
///
/// The free public OpenStreetMap tile server and the public OSRM demo server
/// forbid production traffic. They are used only when `APP_ENV` is local,
/// test or demo. In staging and production they are refused: tiles are left
/// off and routing goes through the API proxy (or a configured server), with
/// a visible note on the map.
@immutable
class MapsConfig {
  const MapsConfig({
    required this.routingSource,
    this.routingBaseUrl,
    this.tileUrlTemplate,
    this.tileAttribution,
  });

  factory MapsConfig.fromEnvironment() => MapsConfig.fromValues(
    appEnvironment: const String.fromEnvironment(
      'APP_ENV',
      defaultValue: 'local',
    ),
    routingBaseUrl: const String.fromEnvironment('ROUTING_BASE_URL'),
    tileUrlTemplate: const String.fromEnvironment('TILE_URL_TEMPLATE'),
    tileAttribution: const String.fromEnvironment('TILE_ATTRIBUTION'),
  );

  factory MapsConfig.fromValues({
    required String appEnvironment,
    String routingBaseUrl = '',
    String tileUrlTemplate = '',
    String tileAttribution = '',
  }) {
    // Anything that is not a known relaxed environment is treated strictly.
    final relaxed = const {
      'local',
      'test',
      'demo',
    }.contains(appEnvironment.trim());

    final routing = routingBaseUrl.trim();
    RoutingSource source;
    String? base;
    if (routing.isEmpty) {
      source = relaxed ? RoutingSource.direct : RoutingSource.api;
      base = relaxed ? publicRoutingBaseUrl : null;
    } else {
      final uri = Uri.tryParse(routing);
      final usable =
          uri != null &&
          uri.hasAuthority &&
          (uri.scheme == 'https' || (relaxed && uri.scheme == 'http')) &&
          (relaxed || !isPublicDemoHost(uri.host));
      source = usable ? RoutingSource.direct : RoutingSource.disabled;
      base = usable ? routing.replaceFirst(RegExp(r'/+$'), '') : null;
    }

    final tiles = tileUrlTemplate.trim();
    String? tileUrl;
    if (tiles.isEmpty) {
      tileUrl = relaxed ? publicTileUrlTemplate : null;
    } else {
      final uri = Uri.tryParse(tiles.replaceAll(RegExp(r'[{}]'), ''));
      final hasPlaceholders =
          tiles.contains('{z}') &&
          tiles.contains('{x}') &&
          tiles.contains('{y}');
      final schemeOk =
          uri != null &&
          (uri.scheme == 'https' || (relaxed && uri.scheme == 'http'));
      final hostOk = uri != null && (relaxed || !isPublicDemoHost(uri.host));
      tileUrl = hasPlaceholders && schemeOk && hostOk ? tiles : null;
    }

    final attribution = tileAttribution.trim();
    return MapsConfig(
      routingSource: source,
      routingBaseUrl: base,
      tileUrlTemplate: tileUrl,
      tileAttribution: attribution.isEmpty || attribution.length > 200
          ? null
          : attribution,
    );
  }

  static const String publicRoutingBaseUrl = 'https://router.project-osrm.org';
  static const String publicTileUrlTemplate =
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  /// True for the public demo servers that must not carry production traffic.
  static bool isPublicDemoHost(String host) {
    final h = host.toLowerCase();
    return h == 'openstreetmap.org' ||
        h.endsWith('.openstreetmap.org') ||
        h == 'project-osrm.org' ||
        h.endsWith('.project-osrm.org');
  }

  final RoutingSource routingSource;

  /// Base of the OSRM-compatible server; set only for [RoutingSource.direct].
  final String? routingBaseUrl;

  /// Null when tiles are not configured for this environment.
  final String? tileUrlTemplate;

  /// Provider credit from `TILE_ATTRIBUTION`; null means the default
  /// (localised OpenStreetMap credit).
  final String? tileAttribution;

  bool get tilesAvailable => tileUrlTemplate != null;

  static MapsConfig _current = MapsConfig.fromEnvironment();

  /// The configuration the app runs with.
  static MapsConfig get current => _current;

  @visibleForTesting
  static set current(MapsConfig value) => _current = value;
}
