/// One inbox entry as the API serves it.
///
/// The server stores a machine-readable [type] plus [params] rather than text,
/// so each client renders the message in its own locale.
class AppNotification {
  const AppNotification({
    required this.id,
    required this.type,
    required this.createdAt,
    this.entityType,
    this.entityId,
    this.params = const {},
    this.readAt,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) {
    final params = json['params'];
    final readAt = json['read_at'];
    return AppNotification(
      id: json['id'] as String,
      type: json['type'] as String,
      entityType: json['entity_type'] as String?,
      entityId: json['entity_id'] as String?,
      params: params is Map<String, dynamic> ? params : const {},
      readAt: readAt is String ? DateTime.parse(readAt) : null,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }

  final String id;
  final String type;
  final String? entityType;
  final String? entityId;
  final Map<String, dynamic> params;
  final DateTime? readAt;
  final DateTime createdAt;

  bool get isRead => readAt != null;

  AppNotification markedRead(DateTime at) => AppNotification(
    id: id,
    type: type,
    entityType: entityType,
    entityId: entityId,
    params: params,
    readAt: readAt ?? at,
    createdAt: createdAt,
  );
}

class NotificationInbox {
  const NotificationInbox({required this.items, required this.unreadCount});

  const NotificationInbox.empty() : this(items: const [], unreadCount: 0);

  final List<AppNotification> items;
  final int unreadCount;
}
