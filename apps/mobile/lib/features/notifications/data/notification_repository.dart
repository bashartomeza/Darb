import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/data/authenticated_api_client.dart';
import 'notification_models.dart';

final notificationRepositoryProvider = Provider<NotificationRepository>((ref) {
  return NotificationRepository(
    apiClient: ref.watch(authenticatedApiClientProvider),
  );
});

class NotificationRepository {
  const NotificationRepository({required this.apiClient});

  final AuthenticatedApiClient apiClient;

  Future<NotificationInbox> inbox({int limit = 50}) async {
    final json = await apiClient.getJson('/notifications?limit=$limit');
    final list = json['notifications'];
    if (list is! List) throw const FormatException('Missing notifications');
    return NotificationInbox(
      items: list
          .cast<Map<String, dynamic>>()
          .map(AppNotification.fromJson)
          .toList(growable: false),
      unreadCount: (json['unread_count'] as num?)?.toInt() ?? 0,
    );
  }

  Future<void> markRead(String id) async {
    await apiClient.postJson('/notifications/$id/read', body: const {});
  }

  Future<void> markAllRead() async {
    await apiClient.postJson('/notifications/read-all', body: const {});
  }
}
