import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/application/auth_controller.dart';
import '../data/notification_models.dart';
import '../data/notification_repository.dart';

const notificationsPollInterval = Duration(seconds: 10);

/// The signed-in user's inbox.
///
/// Auto-disposed, so it polls only while something (a bell badge or the inbox
/// screen) is listening. It is rebuilt whenever the signed-in user changes, and
/// a response that arrives after that is discarded, so one actor's inbox can
/// never appear under another.
final notificationsControllerProvider =
    AsyncNotifierProvider.autoDispose<
      NotificationsController,
      NotificationInbox
    >(NotificationsController.new);

/// Unread total for badges; zero while loading, failed or signed out.
final unreadNotificationCountProvider = Provider.autoDispose<int>((ref) {
  return ref
      .watch(notificationsControllerProvider)
      .maybeWhen(data: (inbox) => inbox.unreadCount, orElse: () => 0);
});

class NotificationsController extends AsyncNotifier<NotificationInbox> {
  Timer? _timer;
  String? _actorId;
  int _generation = 0;

  @override
  Future<NotificationInbox> build() async {
    final actorId = ref.watch(
      authControllerProvider.select((auth) => auth.value?.user?.id),
    );
    _actorId = actorId;
    final generation = ++_generation;
    _timer?.cancel();
    _timer = null;
    ref.onDispose(() {
      _timer?.cancel();
      _timer = null;
    });
    if (actorId == null) return const NotificationInbox.empty();

    final initial = await ref.read(notificationRepositoryProvider).inbox();
    if (generation != _generation) return const NotificationInbox.empty();
    _timer = Timer.periodic(notificationsPollInterval, (_) => _poll());
    return initial;
  }

  Future<void> refresh() async {
    final actorId = _actorId;
    final generation = _generation;
    final inbox = await ref.read(notificationRepositoryProvider).inbox();
    if (generation != _generation || actorId != _actorId) return;
    state = AsyncData(inbox);
  }

  /// Background poll: keeps the last good inbox if a refresh fails.
  Future<void> _poll() async {
    try {
      await refresh();
    } catch (_) {}
  }

  Future<void> markRead(AppNotification notification) async {
    if (notification.isRead) return;
    final current = state.value;
    if (current != null) {
      final now = DateTime.now();
      state = AsyncData(
        NotificationInbox(
          items: [
            for (final item in current.items)
              item.id == notification.id ? item.markedRead(now) : item,
          ],
          unreadCount: current.unreadCount > 0 ? current.unreadCount - 1 : 0,
        ),
      );
    }
    try {
      await ref.read(notificationRepositoryProvider).markRead(notification.id);
    } catch (_) {
      await _restoreFromServer();
    }
  }

  Future<void> markAllRead() async {
    final current = state.value;
    if (current == null || current.unreadCount == 0) return;
    final now = DateTime.now();
    state = AsyncData(
      NotificationInbox(
        items: [for (final item in current.items) item.markedRead(now)],
        unreadCount: 0,
      ),
    );
    try {
      await ref.read(notificationRepositoryProvider).markAllRead();
    } catch (_) {
      await _restoreFromServer();
    }
  }

  /// An optimistic update failed: trust the server again.
  Future<void> _restoreFromServer() async {
    try {
      await refresh();
    } catch (_) {}
  }
}
