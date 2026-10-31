import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../auth/application/auth_actor_binding.dart';
import '../../auth/data/authenticated_api_client.dart';
import '../../trips/data/trip_models.dart';
import 'driver_models.dart';

const _compileTimeDemoFeatures = bool.fromEnvironment(
  'ENABLE_DEMO_FEATURES',
  defaultValue: !bool.fromEnvironment('dart.vm.product'),
);

final driverRepositoryProvider = Provider<DriverRepository>((ref) {
  return DriverRepository(apiClient: ref.watch(authenticatedApiClientProvider));
});

/// The signed-in driver's own trust score. This actor-private cache must be
/// invalidated with the rest of the authenticated providers on every terminal
/// session transition.
final driverTrustScoreProvider = FutureProvider.family<int?, String>((
  ref,
  actorId,
) async {
  final binding = ref.watch(authenticatedActorBindingProvider);
  if (binding.actorId != actorId) return null;
  try {
    final score = await ref.watch(driverRepositoryProvider).ownTrustScore();
    return binding.actorId == actorId ? score : null;
  } catch (error, stackTrace) {
    if (binding.actorId != actorId) return null;
    Error.throwWithStackTrace(error, stackTrace);
  }
});

/// How the driver answered the offers they responded to. The percentage is
/// null until the server has a large enough sample to report one.
class DriverPerformance {
  const DriverPerformance({
    required this.responded,
    required this.accepted,
    required this.minSample,
    this.acceptanceRate,
  });

  final int responded;
  final int accepted;
  final int minSample;
  final int? acceptanceRate;

  factory DriverPerformance.fromJson(Map<String, dynamic> json) {
    final responded = json['offers_responded'];
    final accepted = json['offers_accepted'];
    final minSample = json['min_sample'];
    final rate = json['acceptance_rate'];
    if (responded is! int ||
        accepted is! int ||
        minSample is! int ||
        (rate != null && rate is! int)) {
      throw const FormatException('Invalid performance response');
    }
    return DriverPerformance(
      responded: responded,
      accepted: accepted,
      minSample: minSample,
      acceptanceRate: rate as int?,
    );
  }
}

final driverPerformanceProvider = FutureProvider<DriverPerformance?>((
  ref,
) async {
  final binding = ref.watch(authenticatedActorBindingProvider);
  final actorId = binding.actorId;
  if (actorId == null) return null;
  try {
    final result = await ref.watch(driverRepositoryProvider).performance();
    return binding.actorId == actorId ? result : null;
  } catch (error, stackTrace) {
    if (binding.actorId != actorId) return null;
    Error.throwWithStackTrace(error, stackTrace);
  }
});

class DriverRepository {
  const DriverRepository({required this.apiClient});

  final AuthenticatedApiClient apiClient;

  Future<List<DriverRoute>> listRoutes() async {
    final json = await apiClient.getJson('/driver/routes');
    return _routes(json);
  }

  /// This driver's own trust score (0..100), or null when unavailable.
  ///
  /// `/me` returns `driver_profile` only for drivers, so a missing block is a
  /// legitimate "no score" rather than a failure.
  Future<int?> ownTrustScore() async {
    final json = await apiClient.getJson('/me');
    final profile = json['driver_profile'];
    if (profile is! Map) return null;
    final value = profile['trust_score'];
    return value is num ? value.toInt() : null;
  }

  Future<DriverPerformance> performance() async {
    final json = await apiClient.getJson('/driver/performance');
    return DriverPerformance.fromJson(json);
  }

  Future<List<DriverRoute>> activeRoutes() async {
    final json = await apiClient.getJson('/driver/routes/active');
    return _routes(json);
  }

  Future<DriverRoute> createRoute({
    required int seatsAvailable,
    required int parcelCapacityAvailable,
    String? idempotencyKey,
    Future<void> Function()? beforeRetry,
  }) async {
    final json = await apiClient.postJson(
      '/driver/routes',
      headers: {'Idempotency-Key': ?idempotencyKey},
      beforeRetry: beforeRetry,
      body: {
        'origin_label': lockedDriverOriginLabel,
        'destination_label': lockedDriverDestinationLabel,
        'corridor_key': lockedDriverCorridorKey,
        'seats_available': seatsAvailable,
        'parcel_capacity_available': parcelCapacityAvailable,
      },
    );
    return DriverRoute.fromJson(json['route'] as Map<String, dynamic>);
  }

  Future<DriverRoute> deactivateRoute(String id) async {
    final json = await apiClient.patchJson('/driver/routes/$id/deactivate');
    return DriverRoute.fromJson(json['route'] as Map<String, dynamic>);
  }

  Future<LegacyDriverOnlineResult> setLegacyOnlineState({
    required bool online,
    required String idempotencyKey,
    String? expectedRouteId,
    Future<void> Function()? beforeRetry,
  }) async {
    final body = <String, dynamic>{'online': online};
    if (expectedRouteId != null) {
      body['expected_route_id'] = expectedRouteId;
    }
    final json = await apiClient.putJson(
      '/driver/online-state',
      body: body,
      headers: {'Idempotency-Key': idempotencyKey},
      beforeRetry: beforeRetry,
    );
    final resultOnline = json['online'];
    final routeId = json['route_id'];
    final replayed = json['replayed'];
    if (resultOnline is! bool || routeId is! String || replayed is! bool) {
      throw const FormatException('Invalid legacy online-state response');
    }
    return LegacyDriverOnlineResult(
      online: resultOnline,
      routeId: routeId,
      replayed: replayed,
    );
  }

  Future<List<DriverMatch>> listMatches({String? status}) async {
    final suffix = status == null
        ? ''
        : '?status=${Uri.encodeQueryComponent(status)}';
    final json = await apiClient.getJson('/matches$suffix');
    final matches = json['matches'];
    if (matches is! List) throw const FormatException('Missing matches');
    return matches
        .cast<Map<String, dynamic>>()
        .map(DriverMatch.fromJson)
        .toList();
  }

  Future<DriverMatch> matchDetail(String id) async {
    final json = await apiClient.getJson('/matches/$id');
    return DriverMatch.fromJson(json['match'] as Map<String, dynamic>);
  }

  Future<DriverTripReference> acceptMatch(String id) async {
    final json = await apiClient.postJson(
      '/matches/$id/accept',
      body: const {},
    );
    return DriverTripReference.fromJson(json['trip'] as Map<String, dynamic>);
  }

  Future<void> rejectMatch(String id) async {
    await apiClient.postJson('/matches/$id/reject', body: const {});
  }

  Future<List<DriverTrip>> listTrips() async {
    final json = await apiClient.getJson('/trips');
    final trips = json['trips'];
    if (trips is! List) throw const FormatException('Missing trips');
    return trips.cast<Map<String, dynamic>>().map(DriverTrip.fromJson).toList();
  }

  Future<DriverTrip> tripDetail(String id) async {
    final json = await apiClient.getJson('/trips/$id');
    return DriverTrip.fromJson({
      ...(json['trip'] as Map<String, dynamic>),
      'delivery_confirmation': json['delivery_confirmation'],
    });
  }

  Future<void> updateTripStatus(String id, String status) async {
    await apiClient.postJson('/trips/$id/status', body: {'status': status});
  }

  Future<TripLocation> simulateStep(String id) async {
    if (!_compileTimeDemoFeatures) {
      throw UnsupportedError('Demo simulation is not available in this build');
    }
    final json = await apiClient.postJson(
      '/trips/$id/simulate/step',
      body: const {},
    );
    return TripLocation.fromJson(json['location'] as Map<String, dynamic>);
  }

  Future<void> resetSimulation(String id) async {
    if (!_compileTimeDemoFeatures) {
      throw UnsupportedError('Demo simulation is not available in this build');
    }
    await apiClient.postJson('/trips/$id/simulate/reset', body: const {});
  }

  Future<TripLocation?> latestLocation(String id) async {
    final json = await apiClient.getJson('/trips/$id/location');
    final location = json['location'];
    return location is Map<String, dynamic>
        ? TripLocation.fromJson(location)
        : null;
  }

  List<DriverRoute> _routes(Map<String, dynamic> json) {
    final routes = json['routes'];
    if (routes is! List) throw const FormatException('Missing routes');
    return routes
        .cast<Map<String, dynamic>>()
        .map(DriverRoute.fromJson)
        .toList();
  }
}

class LegacyDriverOnlineResult {
  const LegacyDriverOnlineResult({
    required this.online,
    required this.routeId,
    required this.replayed,
  });

  final bool online;
  final String routeId;
  final bool replayed;
}
