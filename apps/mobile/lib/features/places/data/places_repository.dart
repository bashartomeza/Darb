import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/data/authenticated_api_client.dart';
import '../domain/map_place.dart';

final placesRepositoryProvider = Provider<PlacesRepository>((ref) {
  return PlacesRepository(apiClient: ref.watch(authenticatedApiClientProvider));
});

/// The phone only ever asks Darb's own API for places; the data comes from
/// OpenStreetMap through a committed import (docs/maps/places.md).
class PlacesRepository {
  const PlacesRepository({required this.apiClient});

  final AuthenticatedApiClient apiClient;

  /// Places inside [box], nearest to its centre first. [categories] are API
  /// keys; empty means every category.
  Future<PlacesResult> places(
    GeoBox box, {
    Iterable<String> categories = const [],
    int limit = 200,
  }) async {
    final keys = categories.toList()..sort();
    final query = [
      'bbox=${box.query}',
      if (keys.isNotEmpty) 'categories=${keys.join(',')}',
      'limit=$limit',
    ].join('&');
    return PlacesResult.fromJson(await apiClient.getJson('/map/places?$query'));
  }

  /// "This place is wrong." One report per user and place; the admin page
  /// shows it.
  Future<void> report(String placeId, {required String reason}) async {
    await apiClient.postJson(
      '/map/places/${Uri.encodeComponent(placeId)}/report',
      body: {'reason': reason},
    );
  }
}
