import 'dart:async';
import 'dart:collection';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

import '../../features/canonical_routes/domain/canonical_route_models.dart';
import '../api/api_client.dart';
import 'service_area.dart';

/// One routing service (and so one route cache) for the whole app.
final osrmRouteServiceProvider = Provider<OsrmRouteService>(
  (ref) => OsrmRouteService(client: ref.watch(httpClientProvider)),
);

/// Coordinate component of a route cache key, rounded to ~110 m so GPS jitter
/// does not trigger a new routing request on every location update.
String routeCoordKey(double value) => value.toStringAsFixed(3);

class OsrmRouteResult {
  const OsrmRouteResult({
    required this.points,
    required this.durationSeconds,
    required this.distanceMeters,
  });

  final List<LatLng> points;
  final double durationSeconds;
  final double distanceMeters;

  /// Estimated travel time in minutes.
  int get durationMinutes => (durationSeconds / 60).ceil();

  /// Estimated travel time in hours and minutes.
  String get formattedDuration {
    final totalMinutes = durationMinutes;

    if (totalMinutes < 60) {
      return '$totalMinutes min';
    }

    final hours = totalMinutes ~/ 60;
    final minutes = totalMinutes % 60;

    if (minutes == 0) {
      return '${hours}h';
    }

    return '${hours}h ${minutes}min';
  }

  /// Distance in kilometers.
  double get distanceKilometers => distanceMeters / 1000;
}

/// Road routing through the public OSRM server.
///
/// Every request is cached by its rounded waypoints (so the same trip shown on
/// several screens, or re-rendered by a 5-second refresh, asks once), identical
/// requests in flight share one call, each call has a timeout and one retry,
/// and a failure is remembered briefly so a down server is not hammered.
class OsrmRouteService {
  OsrmRouteService({
    this.client,
    this.timeout = const Duration(seconds: 8),
    this.maxCachedRoutes = 64,
    this.failureCooldown = const Duration(seconds: 30),
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final http.Client? client;
  final Duration timeout;
  final int maxCachedRoutes;
  final Duration failureCooldown;
  final DateTime Function() _clock;

  // Insertion-ordered: re-inserting on a hit makes it least-recently-used.
  final LinkedHashMap<String, OsrmRouteResult> _cache = LinkedHashMap();
  final Map<String, Future<OsrmRouteResult>> _inFlight = {};
  final Map<String, (DateTime, Object)> _failures = {};

  /// HTTP requests actually sent (tests use it to prove caching).
  int get requestCount => _requestCount;
  int _requestCount = 0;

  static String cacheKey(List<LatLng> waypoints) => waypoints
      .map((p) => '${routeCoordKey(p.latitude)},${routeCoordKey(p.longitude)}')
      .join(';');

  Future<OsrmRouteResult> getRoute({
    required LatLng start,
    required LatLng end,
  }) => getRouteThrough([start, end]);

  /// A road route visiting [waypoints] in order (OSRM allows up to 25 here).
  Future<OsrmRouteResult> getRouteThrough(List<LatLng> waypoints) {
    if (waypoints.length < 2 ||
        waypoints.length > 25 ||
        !waypoints.every(_valid)) {
      return Future.error(const FormatException('Invalid route endpoints'));
    }
    final key = cacheKey(waypoints);
    final cached = _cache.remove(key);
    if (cached != null) {
      _cache[key] = cached;
      return Future.value(cached);
    }
    final failure = _failures[key];
    if (failure != null && _clock().difference(failure.$1) < failureCooldown) {
      return Future.error(failure.$2);
    }
    return _inFlight[key] ??= _fetchWithRetry(waypoints)
        .then((result) {
          _failures.remove(key);
          _cache[key] = result;
          while (_cache.length > maxCachedRoutes) {
            _cache.remove(_cache.keys.first);
          }
          return result;
        })
        .catchError((Object error) {
          _failures[key] = (_clock(), error);
          throw error;
        })
        // A block body: returning the removed future here would make the
        // chain wait for itself.
        .whenComplete(() {
          _inFlight.remove(key);
        });
  }

  Future<OsrmRouteResult> _fetchWithRetry(List<LatLng> waypoints) async {
    try {
      return await _fetch(waypoints);
    } on FormatException {
      rethrow; // A malformed answer will not improve on a retry.
    } catch (_) {
      return _fetch(waypoints);
    }
  }

  Future<OsrmRouteResult> _fetch(List<LatLng> waypoints) async {
    final url = Uri.parse(
      'https://router.project-osrm.org/route/v1/driving/'
      '${waypoints.map((p) => '${p.longitude},${p.latitude}').join(';')}'
      '?overview=full&geometries=geojson',
    );

    _requestCount++;
    final response = await (client?.get(url) ?? http.get(url)).timeout(timeout);

    if (response.statusCode != 200) {
      throw http.ClientException('OSRM request failed: ${response.statusCode}');
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;

    if (data['code'] != 'Ok') {
      throw const FormatException('OSRM returned an invalid route');
    }

    final routes = data['routes'] as List<dynamic>;

    if (routes.isEmpty) {
      throw const FormatException('No road route available');
    }

    final route = routes.first as Map<String, dynamic>;

    if (route['duration'] is! num || route['distance'] is! num) {
      throw const FormatException('Missing road travel metadata');
    }
    final durationSeconds = (route['duration'] as num).toDouble();
    final distanceMeters = (route['distance'] as num).toDouble();

    final geometry = route['geometry'] as Map<String, dynamic>;

    final coordinates = geometry['coordinates'] as List<dynamic>;

    final points = coordinates
        .map((coordinate) {
          final point = coordinate as List<dynamic>;

          return LatLng(
            (point[1] as num).toDouble(),
            (point[0] as num).toDouble(),
          );
        })
        .toList(growable: false);

    if (points.length < 2 ||
        !points.every(_valid) ||
        !durationSeconds.isFinite ||
        durationSeconds < 0 ||
        !distanceMeters.isFinite ||
        distanceMeters < 0) {
      throw const FormatException('Invalid road route');
    }
    return OsrmRouteResult(
      points: points,
      durationSeconds: durationSeconds,
      distanceMeters: distanceMeters,
    );
  }

  bool _valid(LatLng point) =>
      point.latitude.isFinite &&
      point.longitude.isFinite &&
      point.latitude >= -90 &&
      point.latitude <= 90 &&
      point.longitude >= -180 &&
      point.longitude <= 180;
}

/// What to route: the record's own points, in travel order.
class RoadRouteRequest {
  RoadRouteRequest(List<GeoPoint> waypoints)
    : waypoints = List.unmodifiable(waypoints),
      _key = OsrmRouteService.cacheKey([
        for (final p in waypoints) LatLng(p.latitude, p.longitude),
      ]);

  final List<GeoPoint> waypoints;
  final String _key;

  @override
  bool operator ==(Object other) =>
      other is RoadRouteRequest && other._key == _key;

  @override
  int get hashCode => _key.hashCode;
}

/// A line to draw for a trip, order or catalogue route.
class RoadRoute {
  const RoadRoute({
    required this.points,
    required this.routed,
    this.durationSeconds,
    this.distanceMeters,
  });

  /// Straight segments between the record's points, used when no road route
  /// is available. The map draws it dashed and labels it.
  factory RoadRoute.straight(List<GeoPoint> waypoints) =>
      RoadRoute(points: List.unmodifiable(waypoints), routed: false);

  final List<GeoPoint> points;

  /// True when [points] follow real roads; false for the straight fallback.
  final bool routed;
  final double? durationSeconds;
  final double? distanceMeters;
}

/// Road route between a record's points, never failing: when routing is not
/// possible (offline, server down, a point outside the service area) it
/// resolves to the straight fallback so the map still shows the trip.
final roadRouteProvider = FutureProvider.autoDispose
    .family<RoadRoute, RoadRouteRequest>((ref, request) async {
      final waypoints = request.waypoints;
      final straight = RoadRoute.straight(waypoints);
      if (waypoints.length < 2 ||
          !waypoints.every(
            (p) => DarbServiceArea.contains(p.latitude, p.longitude),
          )) {
        return straight;
      }
      try {
        final result = await ref.read(osrmRouteServiceProvider).getRouteThrough(
          [for (final p in waypoints) LatLng(p.latitude, p.longitude)],
        );
        return RoadRoute(
          points: List.unmodifiable([
            for (final p in result.points) GeoPoint(p.latitude, p.longitude),
          ]),
          routed: true,
          durationSeconds: result.durationSeconds,
          distanceMeters: result.distanceMeters,
        );
      } catch (_) {
        return straight;
      }
    });
