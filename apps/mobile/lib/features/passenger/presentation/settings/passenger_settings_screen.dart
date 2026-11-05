import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../../core/i18n/domain_labels.dart';
import '../../../../core/i18n/locale_controller.dart';
import '../../../../core/routing/app_router.dart';
import '../../../../core/theme/passenger_theme.dart';
import '../../../../core/theme/semantic_colors.dart';
import '../../../auth/application/auth_controller.dart';
import '../../../security/presentation/security_actions.dart';
import '../../../security/presentation/session_status_banner.dart';
import 'rate_app_sheet.dart';
import 'settings_widgets.dart';

/// The passenger Settings tab: the profile summary, the account entries the
/// passenger actually uses, and log out. Everything else about the account
/// (editing, password, devices) lives one tap deeper.
class PassengerSettingsScreen extends ConsumerWidget {
  const PassengerSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final user = ref.watch(authControllerProvider).value?.user;
    final locale =
        ref.watch(localeControllerProvider).value ?? DomainLabels.defaultLocale;

    return ColoredBox(
      key: const ValueKey('passengerSettings'),
      color: PassengerStyle.surface,
      child: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
          children: [
            const SessionStatusBanner(),
            Padding(
              padding: const EdgeInsets.fromLTRB(0, 8, 0, 20),
              child: Text(
                l10n.passengerNavSettings,
                style: PassengerStyle.inter(size: 26, height: 32, weight: 600),
              ),
            ),
            _ProfileSummary(
              name: user?.name ?? '',
              contact: user?.contact ?? '',
              onTap: () => context.go(passengerProfilePath),
            ),
            const SizedBox(height: 24),
            SettingsRow(
              key: const ValueKey('settingsProfile'),
              icon: Icons.person_outline_rounded,
              label: AppLocalizations.of(context).settingsMyProfile,
              onTap: () => context.go(passengerProfilePath),
            ),
            const SizedBox(height: 12),
            SettingsRow(
              key: const ValueKey('settingsPassword'),
              icon: Icons.lock_outline_rounded,
              label: AppLocalizations.of(context).settingsChangePassword,
              onTap: () => context.go(passengerPasswordPath),
            ),
            const SizedBox(height: 12),
            SettingsRow(
              key: const ValueKey('settingsLanguage'),
              icon: Icons.language_rounded,
              label: AppLocalizations.of(context).language,
              value: languageName(l10n, locale.languageCode),
              onTap: () => showPassengerLanguagePicker(context, ref, locale),
            ),
            const SizedBox(height: 12),
            SettingsRow(
              key: const ValueKey('settingsRate'),
              icon: Icons.star_outline_rounded,
              label: AppLocalizations.of(context).settingsRateOurApp,
              onTap: () => showRateAppSheet(context),
            ),
            const SizedBox(height: 12),
            SettingsRow(
              key: const ValueKey('settingsHelp'),
              icon: Icons.help_outline_rounded,
              label: AppLocalizations.of(context).settingsHelpSupport,
              onTap: () => context.go(passengerHelpPath),
            ),
            const SizedBox(height: 12),
            SettingsRow(
              key: const ValueKey('settingsSessions'),
              icon: Icons.security_outlined,
              label: l10n.securityAndSessions,
              onTap: () => context.go(passengerSessionsPath),
            ),
            const SizedBox(height: 28),
            SettingsRow(
              key: const ValueKey('logoutButton'),
              icon: Icons.logout_rounded,
              label: l10n.logout,
              color: SemanticColors.error,
              showChevron: false,
              onTap: () => _confirmLogout(context, ref),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmLogout(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await confirmSecurityAction(
      context,
      title: l10n.confirmLogout,
      message: l10n.confirmLogoutMessage,
      confirmLabel: l10n.logout,
    );
    if (confirmed) await ref.read(authControllerProvider.notifier).logout();
  }
}

/// The passenger language sheet; choosing a language applies it at once and
/// is remembered across restarts. Shared by settings and My trips.
Future<void> showPassengerLanguagePicker(
  BuildContext context,
  WidgetRef ref,
  Locale current,
) async {
  final l10n = AppLocalizations.of(context);
  final chosen = await showModalBottomSheet<String>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              AppLocalizations.of(context).language,
              style: PassengerStyle.sectionTitle,
            ),
            const SizedBox(height: 12),
            for (final code in const ['en', 'ar'])
              ListTile(
                key: ValueKey('language-$code'),
                contentPadding: EdgeInsets.zero,
                title: Text(
                  code == 'ar' ? 'العربية' : 'English',
                  style: PassengerStyle.inter(size: 16, height: 20),
                ),
                subtitle: Text(languageName(l10n, code)),
                trailing: current.languageCode == code
                    ? const Icon(
                        Icons.check_circle_rounded,
                        color: PassengerStyle.orange,
                      )
                    : const Icon(
                        Icons.radio_button_unchecked_rounded,
                        color: PassengerStyle.iconMuted,
                      ),
                onTap: () => Navigator.of(sheetContext).pop(code),
              ),
          ],
        ),
      ),
    ),
  );
  if (chosen != null && chosen != current.languageCode) {
    await ref.read(localeControllerProvider.notifier).setLocale(Locale(chosen));
  }
}

/// Avatar, name and account handle in one tappable card that opens the profile.
class _ProfileSummary extends StatelessWidget {
  const _ProfileSummary({
    required this.name,
    required this.contact,
    required this.onTap,
  });

  final String name;
  final String contact;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: PassengerStyle.orangeContainer.withValues(alpha: 0.45),
      borderRadius: BorderRadius.circular(PassengerStyle.radiusCard),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        key: const ValueKey('settingsProfileSummary'),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              SettingsAvatar(name: name, size: 60),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: PassengerStyle.inter(
                        size: 18,
                        height: 22,
                        weight: 600,
                      ),
                    ),
                    if (contact.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        contact,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textDirection: TextDirection.ltr,
                        style: PassengerStyle.inter(
                          size: 14,
                          height: 17,
                          color: PassengerStyle.muted,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Icon(
                Directionality.of(context) == TextDirection.rtl
                    ? Icons.chevron_left_rounded
                    : Icons.chevron_right_rounded,
                color: PassengerStyle.orange,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
