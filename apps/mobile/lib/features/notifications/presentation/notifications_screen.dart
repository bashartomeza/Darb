import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_card.dart';
import '../../../core/widgets/state_views.dart';
import '../../driver/presentation/driver_ui.dart';
import '../../driver_renewal/presentation/driver_renewal_banner.dart';
import '../application/notifications_controller.dart';
import '../data/notification_models.dart';

/// The in-app inbox, shared by every role.
///
/// Used both as a bottom-navigation tab and, via the home-screen bell, as a
/// pushed page. Entries arrive from the API as a type plus parameters and are
/// worded here, so Arabic and English both read naturally.
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final inbox = ref.watch(notificationsControllerProvider);
    final controller = ref.read(notificationsControllerProvider.notifier);

    return Scaffold(
      key: const ValueKey('notificationsTab'),
      appBar: AppBar(
        title: Text(l10n.notifications),
        actions: [
          const LanguageSwitch(),
          const SizedBox(width: AppTokens.spaceSmall),
        ],
      ),
      body: SafeArea(
        top: false,
        bottom: false,
        child: inbox.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => ListView(
            children: [
              ErrorStateView(
                title: l10n.notificationsLoadError,
                onRetry: () => ref.invalidate(notificationsControllerProvider),
              ),
            ],
          ),
          data: (data) => RefreshIndicator(
            onRefresh: controller.refresh,
            child: data.items.isEmpty
                ? ListView(
                    children: [
                      EmptyState(
                        title: l10n.noNotifications,
                        icon: Icons.notifications_none_outlined,
                      ),
                    ],
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(
                      AppTokens.marginMobile,
                      AppTokens.spaceMedium,
                      AppTokens.marginMobile,
                      AppTokens.spaceExtraLarge,
                    ),
                    itemCount: data.items.length + 1,
                    separatorBuilder: (_, _) =>
                        const SizedBox(height: AppTokens.spaceSmall),
                    itemBuilder: (context, index) {
                      if (index == 0) {
                        return _UnreadHeader(
                          unread: data.unreadCount,
                          onMarkAll: controller.markAllRead,
                        );
                      }
                      final item = data.items[index - 1];
                      return _NotificationTile(
                        key: ValueKey('notification-${item.id}'),
                        notification: item,
                        onTap: () {
                          controller.markRead(item);
                          // Expiry notices lead straight to the renewal page.
                          if (opensDriverRenewal(item.type)) {
                            GoRouter.maybeOf(context)?.push(driverRenewalPath);
                          }
                        },
                      );
                    },
                  ),
          ),
        ),
      ),
    );
  }
}

/// Unread count with a "mark all as read" action, kept out of the app bar so
/// the page title keeps its room in both languages.
class _UnreadHeader extends StatelessWidget {
  const _UnreadHeader({required this.unread, required this.onMarkAll});

  final int unread;
  final VoidCallback onMarkAll;

  @override
  Widget build(BuildContext context) {
    if (unread == 0) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    return Row(
      children: [
        Expanded(
          child: Text(
            l10n.notificationsUnreadCount(unread),
            style: Theme.of(context).textTheme.labelLarge,
          ),
        ),
        TextButton.icon(
          key: const ValueKey('notificationsMarkAllRead'),
          onPressed: onMarkAll,
          icon: const Icon(Icons.done_all, size: 18),
          label: Text(l10n.notificationsMarkAllRead),
        ),
      ],
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({
    required this.notification,
    required this.onTap,
    super.key,
  });

  final AppNotification notification;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final text = notificationText(l10n, notification);
    final unread = !notification.isRead;

    return Semantics(
      label: unread ? l10n.notificationsUnreadCount(1) : null,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
        child: MasariCard(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                _iconFor(notification.type),
                color: unread ? AppTheme.primary : AppTheme.onSurfaceVariant,
              ),
              const SizedBox(width: AppTokens.spaceMedium),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      text.title,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: unread ? FontWeight.w700 : FontWeight.w500,
                      ),
                    ),
                    if (text.body != null) ...[
                      const SizedBox(height: AppTokens.spaceExtraSmall),
                      Text(text.body!, style: theme.textTheme.bodyMedium),
                    ],
                    const SizedBox(height: AppTokens.spaceExtraSmall),
                    Text(
                      _formatTime(context, notification.createdAt),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: AppTheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              if (unread)
                Container(
                  key: const ValueKey('notificationUnreadDot'),
                  width: 10,
                  height: 10,
                  margin: const EdgeInsetsDirectional.only(
                    start: AppTokens.spaceSmall,
                    top: 6,
                  ),
                  decoration: const BoxDecoration(
                    color: AppTheme.primary,
                    shape: BoxShape.circle,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  static IconData _iconFor(String type) => switch (type) {
    'match_offered' => Icons.local_offer_outlined,
    'match_accepted' => Icons.check_circle_outline,
    'match_rejected' => Icons.cancel_outlined,
    'trip_status' => Icons.route_outlined,
    'driver_verification_approved' => Icons.verified_outlined,
    'driver_verification_rejected' => Icons.gpp_bad_outlined,
    'driver_documents_expiring' => Icons.event_outlined,
    'driver_documents_expired' => Icons.event_busy_outlined,
    'driver_documents_renewal_submitted' => Icons.upload_file_outlined,
    'incident_updated' => Icons.flag_outlined,
    'driver_approaching' => Icons.directions_car_outlined,
    _ => Icons.notifications_none_outlined,
  };

  static String _formatTime(BuildContext context, DateTime at) {
    final local = at.toLocal();
    final material = MaterialLocalizations.of(context);
    return '${material.formatShortDate(local)} '
        '${material.formatTimeOfDay(TimeOfDay.fromDateTime(local))}';
  }
}

/// Notification types whose tap opens the document renewal screen.
bool opensDriverRenewal(String type) =>
    type == 'driver_documents_expiring' ||
    type == 'driver_documents_expired' ||
    type == 'driver_documents_renewal_submitted';

/// Localised wording for an inbox entry.
({String title, String? body}) notificationText(
  AppLocalizations l10n,
  AppNotification notification,
) {
  switch (notification.type) {
    case 'match_offered':
      return (
        title: l10n.notifMatchOfferedTitle,
        body: l10n.notifMatchOfferedBody,
      );
    case 'match_accepted':
      return (
        title: l10n.notifMatchAcceptedTitle,
        body: l10n.notifMatchAcceptedBody,
      );
    case 'match_rejected':
      return (
        title: l10n.notifMatchRejectedTitle,
        body: l10n.notifMatchRejectedBody,
      );
    case 'trip_status':
      final status = notification.params['status'];
      return (
        title: l10n.notifTripStatusTitle,
        body: status is String
            ? l10n.notifTripStatusBody(driverStatusLabel(l10n, status))
            : null,
      );
    case 'driver_verification_approved':
      return (
        title: l10n.notifVerificationApprovedTitle,
        body: l10n.notifVerificationApprovedBody,
      );
    case 'driver_verification_rejected':
      final reason = notification.params['reason'];
      return (
        title: l10n.notifVerificationRejectedTitle,
        body: reason is String && reason.isNotEmpty
            ? l10n.notifVerificationRejectedReason(reason)
            : l10n.notifVerificationRejectedBody,
      );
    case 'driver_documents_expiring':
      final document = switch (notification.params['kind']) {
        'licence' => l10n.documentKindDriverLicence,
        'vehicle_registration' => l10n.documentKindVehicleRegistration,
        'insurance' => l10n.documentKindInsurance,
        'contract' => l10n.documentKindContract,
        _ => null,
      };
      final date = notification.params['expires_on'];
      return (
        title: l10n.notifDocsExpiringTitle,
        body: document != null && date is String
            ? l10n.notifDocsExpiringBody(document, '\u202A$date\u202C')
            : null,
      );
    case 'driver_documents_expired':
      return (
        title: l10n.notifDocsExpiredTitle,
        body: l10n.notifDocsExpiredBody,
      );
    case 'driver_documents_renewal_submitted':
      return (
        title: l10n.notifDocsRenewalSubmittedTitle,
        body: l10n.notifDocsRenewalSubmittedBody,
      );
    case 'driver_approaching':
      return (
        title: l10n.notifDriverApproachingTitle,
        body: l10n.notifDriverApproachingBody,
      );
    case 'incident_updated':
      return (
        title: l10n.notifIncidentUpdatedTitle,
        body: switch (notification.params['status']) {
          'reviewing' => l10n.notifIncidentReviewingBody,
          'resolved' => l10n.notifIncidentResolvedBody,
          _ => null,
        },
      );
    default:
      return (title: l10n.notifUnknownTitle, body: null);
  }
}
