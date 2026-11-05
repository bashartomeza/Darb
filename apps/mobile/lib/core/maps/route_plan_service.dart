import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../features/auth/data/authenticated_api_client.dart';
import '../../features/canonical_routes/application/canonical_route_controller.dart';
import '../../features/checkpoints/application/checkpoint_controller.dart';
import '../../features/checkpoints/domain/checkpoint_models.dart';
import '../api/api_error.dart';
import 'route_plan_models.dart';

/// Most waypoints the server plans in one request (it plans leg by leg).
const int maxRoutePlanWaypoints = 6;

/// How often the checkpoint feed is re-read while a route is on screen. The
/// server's own feed cache is 15-60 s, so asking faster would only repeat the
/// same answer; the timer stops while the app is in the background.
const Duration routeCheckpointRefreshInterval = Duration(seconds: 60);

final routePlanServiceProvider = Provider<RoutePlanService>(
  (ref) => RoutePlanService(ref.watch(authenticatedApiClientProvider)),
);

/// Asks the Darb API for a road route that takes live checkpoint status into
/// account (`POST /route-plans`).
///
/// A 403/404 answer means this account or deployment has no checkpoint source;
/// the service then stays quiet for [unavailableCooldown] instead of asking on
/// every route.
class RoutePlanService {
  RoutePlanService(
    this._client, {
    this.unavailableCooldown = const Duration(minutes: 10),
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final AuthenticatedApiClient _client;
  final Duration unavailableCooldown;
  final DateTime Function() _clock;
  DateTime? _unavailableSince;

  /// Requests sent (tests use it to prove the cooldown).
  int requestCount = 0;

  bool get available =>
      _unavailableSince == null ||
      _clock().difference(_unavailableSince!) >= unavailableCooldown;

  Future<RoutePlan> plan(List<LatLng> waypoints) async {
    if (waypoints.length < 2 || waypoints.length > maxRoutePlanWaypoints) {
      throw const FormatException('Invalid route endpoints');
    }
    if (!available) throw const RoutePlanUnavailable();
    requestCount++;
    try {
      final json = await _client.postJson(
        '/route-plans',
        body: {
          'waypoints': [
            for (final p in waypoints)
              {'latitude': p.latitude, 'longitude': p.longitude},
          ],
        },
      );
      return RoutePlan.fromJson(json);
    } on ApiException catch (error) {
      if (error.statusCode == 404 || error.statusCode == 403) {
        _unavailableSince = _clock();
        throw const RoutePlanUnavailable();
      }
      rethrow;
    }
  }
}

/// The server has no route planner for this account (no checkpoint source, or
/// a role without checkpoint access). Not an error worth warning about.
class RoutePlanUnavailable implements Exception {
  const RoutePlanUnavailable();
}

/// Changes whenever any checkpoint's status changes, and only then, so a route
/// is re-planned when a checkpoint flips and not on every identical refresh.
final checkpointStatusSignatureProvider = Provider<String>((ref) {
  final snapshot = ref.watch(
    checkpointsProvider.select(
      (value) => value.value ?? CheckpointSnapshot.empty,
    ),
  );
  final parts = [
    for (final c in snapshot.checkpoints) '${c.id}:${c.status.name}',
  ]..sort();
  return parts.join(',');
});

/// Whether routes should ask the server for a checkpoint-aware plan: the
/// server must report a checkpoint source.
final routePlanningEnabledProvider = Provider<bool>((ref) {
  final capabilities = ref.watch(mobileCapabilitiesProvider);
  return capabilities.value?.checkpointsAvailable == true;
});

/// Keeps the checkpoint feed fresh while any checkpoint-aware route is on
/// screen, so a status flip reaches the route within about a minute. One timer
/// for the whole app; it only fires while the app is in the foreground.
final routeCheckpointRefreshProvider = Provider.autoDispose<void>((ref) {
  final timer = Timer.periodic(routeCheckpointRefreshInterval, (_) {
    final state = WidgetsBinding.instance.lifecycleState;
    if (state != null && state != AppLifecycleState.resumed) return;
    unawaited(
      ref.read(checkpointsProvider.notifier).refresh().catchError((_) {}),
    );
  });
  ref.onDispose(timer.cancel);
});
