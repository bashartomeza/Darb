import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/data/authenticated_api_client.dart';
import 'legacy_corridor_models.dart';

final legacyCorridorRepositoryProvider = Provider<LegacyCorridorRepository>((
  ref,
) {
  return LegacyCorridorRepository(
    apiClient: ref.watch(authenticatedApiClientProvider),
  );
});

/// The places the legacy flows may use, read from the server.
///
/// The same for every account, and re-read whenever a screen that needs it
/// reopens, so an admin's change to the corridor reaches the app without a
/// release.
final legacyCorridorProvider = FutureProvider.autoDispose<LegacyCorridor>((
  ref,
) {
  return ref.watch(legacyCorridorRepositoryProvider).fetch();
});

class LegacyCorridorRepository {
  const LegacyCorridorRepository({required this.apiClient});

  final AuthenticatedApiClient apiClient;

  Future<LegacyCorridor> fetch() async {
    final json = await apiClient.getJson('/legacy-corridor');
    final corridor = json['corridor'];
    if (corridor is! Map<String, dynamic>) {
      throw const FormatException('Missing corridor');
    }
    return LegacyCorridor.fromJson(corridor);
  }
}
