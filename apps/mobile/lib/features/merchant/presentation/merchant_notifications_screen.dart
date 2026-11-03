import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/theme/merchant_theme.dart';
import '../../../core/widgets/state_views.dart';
import '../../notifications/application/notifications_controller.dart';
import '../../notifications/data/notification_models.dart';
import '../../notifications/presentation/notifications_screen.dart'
    show notificationText;
import 'widgets/merchant_design.dart';

class MerchantNotificationsScreen extends ConsumerWidget {
  const MerchantNotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final inbox = ref.watch(notificationsControllerProvider);
    final controller = ref.read(notificationsControllerProvider.notifier);
    return Scaffold(
      key: const ValueKey('notificationsTab'),
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            MerchantHeader(
              title: l10n.notifications,
              trailing: (inbox.value?.unreadCount ?? 0) > 0
                  ? IconButton(
                      key: const ValueKey('notificationsMarkAllRead'),
                      tooltip: l10n.notificationsMarkAllRead,
                      onPressed: controller.markAllRead,
                      icon: const Icon(
                        Icons.done_all_rounded,
                        size: 20,
                        color: MerchantStyle.orange,
                      ),
                    )
                  : null,
            ),
            Expanded(
              child: inbox.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (_, _) => ErrorStateView(
                  title: l10n.notificationsLoadError,
                  onRetry: () =>
                      ref.invalidate(notificationsControllerProvider),
                ),
                data: (data) => RefreshIndicator(
                  onRefresh: controller.refresh,
                  child: data.items.isEmpty
                      ? ListView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          children: [
                            EmptyState(
                              title: l10n.noNotifications,
                              icon: Icons.notifications_none_rounded,
                            ),
                          ],
                        )
                      : ListView.separated(
                          physics: const AlwaysScrollableScrollPhysics(),
                          padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
                          itemCount: data.items.length,
                          separatorBuilder: (_, _) =>
                              const SizedBox(height: 12),
                          itemBuilder: (_, index) {
                            final item = data.items[index];
                            return MerchantNotificationCard(
                              key: ValueKey('notification-${item.id}'),
                              notification: item,
                              onTap: () {
                                controller.markRead(item);
                                final destination =
                                    merchantNotificationDestination(item);
                                if (destination != null) {
                                  context.push(destination);
                                } else {
                                  final text = notificationText(l10n, item);
                                  showModalBottomSheet<void>(
                                    context: context,
                                    builder: (_) => SafeArea(
                                      child: Padding(
                                        padding: const EdgeInsets.all(24),
                                        child: Column(
                                          mainAxisSize: MainAxisSize.min,
                                          crossAxisAlignment:
                                              CrossAxisAlignment.stretch,
                                          children: [
                                            Text(
                                              text.title,
                                              style: MerchantStyle.text(
                                                size: 20,
                                                weight: FontWeight.w700,
                                              ),
                                            ),
                                            if (text.body != null) ...[
                                              const SizedBox(height: 14),
                                              Text(
                                                text.body!,
                                                style: MerchantStyle.text(),
                                              ),
                                            ],
                                          ],
                                        ),
                                      ),
                                    ),
                                  );
                                }
                              },
                            );
                          },
                        ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String? merchantNotificationDestination(AppNotification item) {
  final id = item.entityId;
  if (id == null || id.isEmpty) return null;
  final encoded = Uri.encodeComponent(id);
  return switch (item.entityType?.toLowerCase()) {
    'trip' => '/merchant/trip/$encoded',
    'match' => '/merchant/match/$encoded',
    'merchantorder' ||
    'merchant_order' ||
    'order' => '/merchant/order/$encoded',
    _ => null,
  };
}

class MerchantNotificationCard extends StatelessWidget {
  const MerchantNotificationCard({
    required this.notification,
    required this.onTap,
    super.key,
  });
  final AppNotification notification;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final text = notificationText(l10n, notification);
    final status = notification.params['status'];
    final success =
        notification.type == 'match_accepted' ||
        const {'delivered', 'completed'}.contains(status);
    final color = success ? MerchantStyle.green : MerchantStyle.orange;
    final material = MaterialLocalizations.of(context);
    final at = notification.createdAt.toLocal();
    return Semantics(
      label: notification.isRead ? null : l10n.notificationsUnreadCount(1),
      child: MerchantCard(
        onTap: onTap,
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 30,
              height: 30,
              margin: const EdgeInsets.only(top: 2),
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              child: Icon(
                success
                    ? Icons.check_rounded
                    : notification.type == 'driver_approaching'
                    ? Icons.local_shipping_outlined
                    : Icons.inventory_2_outlined,
                color: Colors.white,
                size: 16,
              ),
            ),
            const SizedBox(width: 13),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    text.title,
                    style: MerchantStyle.text(
                      size: 14,
                      weight: notification.isRead
                          ? FontWeight.w500
                          : FontWeight.w700,
                    ),
                  ),
                  if (notification.entityId != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      merchantReference(notification.entityId!),
                      style: MerchantStyle.text(
                        size: 12,
                        color: MerchantStyle.muted,
                      ),
                    ),
                  ],
                  const SizedBox(height: 5),
                  Text(
                    '${material.formatShortDate(at)} · ${material.formatTimeOfDay(TimeOfDay.fromDateTime(at))}',
                    style: MerchantStyle.text(
                      size: 10,
                      color: MerchantStyle.muted,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            const Icon(
              Icons.chevron_right_rounded,
              size: 18,
              color: MerchantStyle.muted,
            ),
          ],
        ),
      ),
    );
  }
}
