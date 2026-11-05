import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/data/authenticated_api_client.dart';

final pushRepositoryProvider = Provider<PushRepository>((ref) {
  return PushRepository(apiClient: ref.watch(authenticatedApiClientProvider));
});

/// The server's push settings for the signed-in account.
class PushPreference {
  const PushPreference({required this.enabled, required this.available});

  factory PushPreference.fromJson(Map<String, dynamic> json) => PushPreference(
    enabled: json['push_enabled'] != false,
    available: json['push_available'] == true,
  );

  /// The account wants pushes (the default).
  final bool enabled;

  /// The server is configured to send them.
  final bool available;
}

class PushRepository {
  const PushRepository({required this.apiClient});

  final AuthenticatedApiClient apiClient;

  Future<void> register({
    required String token,
    required String platform,
    String? locale,
    String? appVersion,
  }) async {
    await apiClient.putJson(
      '/push/devices',
      body: {
        'token': token,
        'platform': platform,
        'locale': ?locale,
        'app_version': ?appVersion,
      },
    );
  }

  Future<void> unregister(String token) async {
    await apiClient.postJson(
      '/push/devices/unregister',
      body: {'token': token},
    );
  }

  Future<PushPreference> preference() async {
    return PushPreference.fromJson(
      await apiClient.getJson('/push/preferences'),
    );
  }

  Future<PushPreference> setEnabled(bool enabled) async {
    return PushPreference.fromJson(
      await apiClient.putJson(
        '/push/preferences',
        body: {'push_enabled': enabled},
      ),
    );
  }
}
