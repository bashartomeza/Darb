import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/data/authenticated_api_client.dart';
import 'community_report_models.dart';

final communityReportRepositoryProvider = Provider<CommunityReportRepository>((
  ref,
) {
  return CommunityReportRepository(
    apiClient: ref.watch(authenticatedApiClientProvider),
  );
});

class CommunityReportRepository {
  const CommunityReportRepository({required this.apiClient});

  final AuthenticatedApiClient apiClient;

  Future<List<CommunityReport>> list() async {
    final json = await apiClient.getJson('/community-reports?limit=100');
    final items = json['reports'];
    if (items is! List) return const [];
    return [
      for (final item in items)
        if (item is Map<String, dynamic>) CommunityReport.fromJson(item),
    ];
  }

  Future<CommunityReport> create({
    required CommunityReportCategory category,
    required String description,
    required String locationName,
    double? latitude,
    double? longitude,
  }) async {
    final json = await apiClient.postJson(
      '/community-reports',
      body: {
        'category': category.apiValue,
        'description': description.trim(),
        'location_name': locationName.trim(),
        'latitude': ?latitude,
        'longitude': ?longitude,
      },
    );
    return CommunityReport.fromJson(json['report'] as Map<String, dynamic>);
  }

  /// [value] is 1, -1, or 0 to withdraw the vote.
  Future<CommunityReport> vote(String id, int value) async {
    final json = await apiClient.putJson(
      '/community-reports/$id/vote',
      body: {'value': value},
    );
    return CommunityReport.fromJson(json['report'] as Map<String, dynamic>);
  }

  Future<void> flag(String id) async {
    await apiClient.postJson('/community-reports/$id/flag', body: const {});
  }
}
