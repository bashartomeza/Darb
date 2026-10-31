import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api/api_error.dart';

import '../../auth/data/authenticated_api_client.dart';
import '../../passenger/application/legacy_passenger_request_mutation.dart';
import 'matching_models.dart';

final matchingRepositoryProvider = Provider<MatchingRepository>((ref) {
  return MatchingRepository(
    apiClient: ref.watch(authenticatedApiClientProvider),
    mutation: ref.watch(legacyPassengerRequestMutationProvider),
  );
});

class MatchingRepository {
  const MatchingRepository({required this.apiClient, required this.mutation});

  final AuthenticatedApiClient apiClient;
  final LegacyPassengerRequestMutation mutation;

  Future<String?> _selectedRoute(String requestId, String? supplied) async {
    final selected = await mutation.selectedDriverRouteForRequest(requestId);
    if (selected != null && supplied != null && selected != supplied) {
      throw const ApiException(
        ApiErrorType.validation,
        'selected_driver_route_unavailable',
        statusCode: 409,
      );
    }
    return selected ?? supplied;
  }

  Future<MatchResult> runForPassengerRequest(
    String requestId, {
    String? driverRouteId,
  }) async {
    final actor = mutation.actorId;
    final selectedRoute = await _selectedRoute(requestId, driverRouteId);
    mutation.requireActor(actor);
    final json = await apiClient.postJson(
      '/matches/run',
      body: {'passengerRequestId': requestId, 'driverRouteId': ?selectedRoute},
    );
    mutation.requireActor(actor);
    return _match(json);
  }

  Future<MatchResult> detail(String id) async {
    final json = await apiClient.getJson('/matches/$id');
    return _match(json);
  }

  Future<MatchResult?> latestForPassengerRequest(
    String requestId, {
    String? driverRouteId,
  }) async {
    final actor = mutation.actorId;
    final selectedRoute = await _selectedRoute(requestId, driverRouteId);
    mutation.requireActor(actor);
    final json = await apiClient.getJson('/matches');
    mutation.requireActor(actor);
    final matches = json['matches'];
    if (matches is! List) throw const FormatException('Missing matches');
    for (final raw in matches.cast<Map<String, dynamic>>()) {
      final passengerRequest = raw['passenger_request'];
      if (passengerRequest is Map && passengerRequest['id'] == requestId) {
        if (selectedRoute != null &&
            (raw['driver_route'] is! Map ||
                (raw['driver_route'] as Map)['id'] != selectedRoute ||
                ![
                  'proposed',
                  'sent_to_driver',
                  'accepted',
                ].contains(raw['status']))) {
          continue;
        }
        final scoring = raw['scoring_breakdown'];
        if (scoring is! Map<String, dynamic>) {
          throw const FormatException('Missing scoring breakdown');
        }
        return MatchResult.fromJson(raw, scoring);
      }
    }
    return null;
  }

  MatchResult _match(Map<String, dynamic> json) {
    return MatchResult.fromJson(
      json['match'] as Map<String, dynamic>,
      json['scoringBreakdown'] as Map<String, dynamic>,
    );
  }
}
