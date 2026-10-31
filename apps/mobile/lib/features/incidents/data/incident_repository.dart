import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/data/authenticated_api_client.dart';

/// Server-side category values; the UI words each one per locale.
enum IncidentCategory {
  safety('safety'),
  delay('delay'),
  parcelDamage('parcel_damage'),
  behavior('behavior'),
  other('other');

  const IncidentCategory(this.apiValue);

  final String apiValue;
}

const incidentDescriptionMinLength = 3;
const incidentDescriptionMaxLength = 1000;

final incidentRepositoryProvider = Provider<IncidentRepository>((ref) {
  return IncidentRepository(
    apiClient: ref.watch(authenticatedApiClientProvider),
  );
});

class IncidentRepository {
  const IncidentRepository({required this.apiClient});

  final AuthenticatedApiClient apiClient;

  Future<void> report({
    required IncidentCategory category,
    required String description,
    String? tripId,
  }) async {
    await apiClient.postJson(
      '/incidents',
      body: {
        'category': category.apiValue,
        'description': description.trim(),
        'trip_id': ?tripId,
      },
    );
  }
}
