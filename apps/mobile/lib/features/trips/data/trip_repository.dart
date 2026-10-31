import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/data/authenticated_api_client.dart';
import 'trip_models.dart';

final tripRepositoryProvider = Provider<TripRepository>((ref) {
  return TripRepository(apiClient: ref.watch(authenticatedApiClientProvider));
});

class TripRepository {
  const TripRepository({required this.apiClient});

  final AuthenticatedApiClient apiClient;

  Future<List<PassengerTrip>> listTrips({void Function()? beforeSend}) async {
    final json = await apiClient.getJson('/trips', beforeSend: beforeSend);
    final list = json['trips'];

    if (list is! List) {
      throw const FormatException('Missing trips');
    }

    return list
        .cast<Map<String, dynamic>>()
        .map(PassengerTrip.fromJson)
        .toList();
  }

  Future<PassengerTrip> tripDetail(String id) async {
    final json = await apiClient.getJson('/trips/$id');

    return PassengerTrip.fromJson(json['trip'] as Map<String, dynamic>);
  }

  /// The signed-in passenger's own rating of the trip, or null if not rated.
  Future<int?> myRating(String tripId) async {
    final json = await apiClient.getJson('/trips/$tripId/rating');
    final rating = json['rating'];
    if (rating is! Map<String, dynamic>) return null;
    final stars = rating['stars'];
    return stars is int ? stars : null;
  }

  Future<void> submitRating(String tripId, int stars) async {
    await apiClient.postJson('/trips/$tripId/rating', body: {'stars': stars});
  }

  Future<TripLocation?> latestLocation(String id) async {
    final json = await apiClient.getJson('/trips/$id/location');
    final location = json['location'];

    if (location == null) {
      return null;
    }

    return TripLocation.fromJson(location as Map<String, dynamic>);
  }
}
