import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/data/authenticated_api_client.dart';
import '../domain/checkpoint_models.dart';

final checkpointRepositoryProvider = Provider<CheckpointRepository>((ref) {
  return CheckpointRepository(
    apiClient: ref.watch(authenticatedApiClientProvider),
  );
});

/// Provider credentials and transport remain behind the authenticated API.
class CheckpointRepository {
  const CheckpointRepository({required this.apiClient});

  final AuthenticatedApiClient apiClient;

  Future<CheckpointSnapshot> checkpoints({void Function()? beforeSend}) async {
    return CheckpointSnapshot.fromJson(
      await apiClient.getJson('/checkpoints', beforeSend: beforeSend),
    );
  }
}
