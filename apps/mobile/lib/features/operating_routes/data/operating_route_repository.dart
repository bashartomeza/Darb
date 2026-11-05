import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import 'city_place_models.dart';
import 'operating_route_models.dart';

final operatingRouteRepositoryProvider = Provider<OperatingRouteRepository>((
  ref,
) {
  return OperatingRouteRepository(apiClient: ref.watch(apiClientProvider));
});

/// The active routes, read from the server. Public (no sign-in needed, so the
/// welcome screen can list them) and re-read whenever a screen that needs it
/// reopens, so a route the admin adds or turns off reaches the app at once.
final operatingRoutesProvider =
    FutureProvider.autoDispose<List<OperatingRoute>>((ref) {
      return ref.watch(operatingRouteRepositoryProvider).fetch();
    });

/// The villages and towns to pick from for one route (pickup places of its
/// origin city, drop-off places of its destination city), by route id and
/// whether the app reads Arabic. Re-read each time the order screen opens, so
/// a place an admin adds or disables reaches the app without a release; the
/// server answers with a cache-friendly body.
final routePlacesProvider = FutureProvider.autoDispose
    .family<RoutePlaces, ({String routeId, bool arabic})>((ref, key) {
      return ref
          .watch(operatingRouteRepositoryProvider)
          .places(key.routeId, arabic: key.arabic);
    });

class OperatingRouteRepository {
  const OperatingRouteRepository({required this.apiClient});

  final ApiClient apiClient;

  Future<List<OperatingRoute>> fetch() async =>
      parseOperatingRoutes(await apiClient.getJson('/operating-routes'));

  Future<RoutePlaces> places(
    String routeId, {
    required bool arabic,
  }) async => RoutePlaces.fromJson(
    await apiClient.getJson(
      '/operating-routes/${Uri.encodeComponent(routeId)}/places?lang=${arabic ? 'ar' : 'en'}',
    ),
  );
}
