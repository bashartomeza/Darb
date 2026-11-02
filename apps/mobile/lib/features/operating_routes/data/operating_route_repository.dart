import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
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

class OperatingRouteRepository {
  const OperatingRouteRepository({required this.apiClient});

  final ApiClient apiClient;

  Future<List<OperatingRoute>> fetch() async =>
      parseOperatingRoutes(await apiClient.getJson('/operating-routes'));
}
