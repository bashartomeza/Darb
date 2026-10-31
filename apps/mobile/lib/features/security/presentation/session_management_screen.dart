import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/map_cache_tile.dart';
import '../../../core/widgets/masari_section.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/status_chip.dart';
import '../../auth/domain/auth_models.dart';
import '../../auth/presentation/credential_actions.dart';
import '../application/session_controller.dart';
import 'security_actions.dart';
import 'session_status_banner.dart';

class SessionManagementScreen extends ConsumerStatefulWidget {
  const SessionManagementScreen({super.key});

  @override
  ConsumerState<SessionManagementScreen> createState() =>
      _SessionManagementScreenState();
}

class _SessionManagementScreenState
    extends ConsumerState<SessionManagementScreen> {
  bool _busy = false;
  bool _actionFailed = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final sessions = ref.watch(sessionControllerProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.securityAndSessions),
        actions: const [
          LanguageSwitch(),
          SizedBox(width: AppTokens.spaceSmall),
        ],
      ),
      body: SafeArea(
        top: false,
        bottom: false,
        child: RefreshIndicator(
          onRefresh: () =>
              ref.read(sessionControllerProvider.notifier).refresh(),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              AppTokens.marginMobile,
              AppTokens.spaceMedium,
              AppTokens.marginMobile,
              AppTokens.spaceExtraLarge,
            ),
            children: [
              const SessionStatusBanner(),
              const CredentialSettings(),
              const MapCacheTile(),
              if (_actionFailed) ...[
                const SizedBox(height: AppTokens.spaceMedium),
                OfflineBanner(
                  key: const ValueKey('sessionActionError'),
                  message: l10n.sessionActionFailed,
                  tone: BannerTone.error,
                  icon: Icons.error_outline,
                ),
              ],
              const SizedBox(height: AppTokens.spaceLarge),

              MasariSection(
                title: l10n.activeSessions,
                child: sessions.when(
                  loading: () => const Column(
                    children: [
                      LoadingSkeleton.card(),
                      SizedBox(height: AppTokens.spaceMedium),
                      LoadingSkeleton.card(),
                    ],
                  ),
                  error: (error, stackTrace) => ErrorStateView(
                    title: l10n.sessionActionFailed,
                    retryLabel: l10n.retry,
                    onRetry: _busy
                        ? null
                        : () => ref
                              .read(sessionControllerProvider.notifier)
                              .refresh(),
                  ),
                  data: (items) => items.isEmpty
                      ? EmptyState(
                          title: l10n.noActiveSessions,
                          icon: Icons.devices_outlined,
                        )
                      : Column(
                          children: [
                            for (final session in items) ...[
                              _SessionCard(
                                session: session,
                                busy: _busy,
                                onRevoke: () => _confirmRevoke(session),
                              ),
                              const SizedBox(height: AppTokens.spaceMedium),
                            ],
                          ],
                        ),
                ),
              ),

              // Destructive actions are grouped away from the session list so
              // "sign out everywhere" is never a mis-tap on a single session.
              const SizedBox(height: AppTokens.spaceLarge),
              const Divider(),
              const SizedBox(height: AppTokens.spaceMedium),
              OutlinedButton.icon(
                key: const ValueKey('logoutCurrentSession'),
                onPressed: _busy ? null : _confirmLogout,
                icon: const Icon(Icons.logout),
                label: Text(l10n.logout),
              ),
              const SizedBox(height: AppTokens.spaceSmall),
              TextButton(
                key: const ValueKey('logoutAllSessions'),
                onPressed: _busy ? null : _confirmLogoutAll,
                style: TextButton.styleFrom(
                  foregroundColor: Theme.of(context).colorScheme.error,
                  minimumSize: const Size.fromHeight(AppTokens.minTouchTarget),
                ),
                child: Text(l10n.logoutAllDevices),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _confirmRevoke(AuthSessionSummary session) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await confirmSecurityAction(
      context,
      title: session.isCurrent ? l10n.revokeThisDevice : l10n.revokeSession,
      message: l10n.confirmRevokeSession,
      confirmLabel: session.isCurrent
          ? l10n.revokeThisDevice
          : l10n.revokeSession,
    );
    if (confirmed) {
      await _runAction(
        () => ref.read(sessionControllerProvider.notifier).revoke(session),
      );
    }
  }

  Future<void> _confirmLogout() async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await confirmSecurityAction(
      context,
      title: l10n.confirmLogout,
      message: l10n.confirmLogoutMessage,
      confirmLabel: l10n.logout,
    );
    if (confirmed) {
      await _runAction(
        () => ref.read(sessionControllerProvider.notifier).logoutCurrent(),
      );
    }
  }

  Future<void> _confirmLogoutAll() async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await confirmSecurityAction(
      context,
      title: l10n.confirmLogoutAll,
      message: l10n.confirmLogoutAllMessage,
      confirmLabel: l10n.logoutAllDevices,
    );
    if (confirmed) {
      await _runAction(
        () => ref.read(sessionControllerProvider.notifier).logoutAll(),
      );
    }
  }

  Future<void> _runAction(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _actionFailed = false;
    });
    try {
      await action();
    } catch (_) {
      if (mounted) setState(() => _actionFailed = true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

/// One signed-in device.
///
/// The device is the subject, so it leads; the timestamps are supporting
/// detail. Revoking is a text action rather than a filled button — it is a
/// per-row option, not the screen's purpose.
class _SessionCard extends StatelessWidget {
  const _SessionCard({
    required this.session,
    required this.busy,
    required this.onRevoke,
  });

  final AuthSessionSummary session;
  final bool busy;
  final VoidCallback onRevoke;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final label =
        session.deviceName ??
        (session.isCurrent ? l10n.currentDevice : l10n.otherDevice);
    final client = switch (session.clientType) {
      'mobile' => l10n.mobileSession,
      'admin' => l10n.adminSession,
      _ => l10n.otherDevice,
    };

    return MasariInfoCard(
      title: label,
      subtitle: client,
      icon: session.clientType == 'mobile'
          ? Icons.smartphone_outlined
          : Icons.desktop_windows_outlined,
      // A revoked session is the more important state to surface, so it wins
      // over the "current device" marker when both apply.
      statusLabel: session.revoked
          ? l10n.sessionRevoked
          : (session.isCurrent ? l10n.currentDevice : null),
      statusTone: session.revoked ? StatusTone.error : StatusTone.success,
      body: Column(
        children: [
          DetailRow(
            label: l10n.lastActive,
            value: _formatDateTime(context, session.lastUsedAt),
            icon: Icons.schedule_outlined,
          ),
          DetailRow(
            label: l10n.created,
            value: _formatDateTime(context, session.createdAt),
            icon: Icons.event_outlined,
          ),
          DetailRow(
            label: l10n.expires,
            value: _formatDateTime(context, session.expiresAt),
            icon: Icons.event_busy_outlined,
          ),
        ],
      ),
      secondaryAction: session.revoked
          ? null
          // Kept a TextButton: a widget test distinguishes this control from
          // the confirmation dialog's FilledButton by type.
          : TextButton(
              key: ValueKey(
                session.isCurrent ? 'revokeCurrentSession' : 'revokeSession',
              ),
              onPressed: busy ? null : onRevoke,
              style: TextButton.styleFrom(
                foregroundColor: Theme.of(context).colorScheme.error,
              ),
              child: Text(
                session.isCurrent ? l10n.revokeThisDevice : l10n.revokeSession,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
    );
  }
}

/// A compact numeric date plus the time.
///
/// `formatMediumDate` prefixes the weekday in Arabic, which made the value long
/// enough to wrap — and because the time is a left-to-right run inside
/// right-to-left text, the wrap orphaned its "م" on a line of its own. The
/// weekday carries no meaning for a session list, so it is dropped.
String _formatDateTime(BuildContext context, DateTime value) {
  final material = MaterialLocalizations.of(context);
  final local = value.toLocal();
  return '${material.formatCompactDate(local)} '
      '${material.formatTimeOfDay(TimeOfDay.fromDateTime(local))}';
}
