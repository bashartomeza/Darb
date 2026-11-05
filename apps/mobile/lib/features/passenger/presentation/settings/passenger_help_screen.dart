import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/passenger_theme.dart';
import 'settings_widgets.dart';
import '../../../../l10n/app_localizations.dart';

/// Help & Support: the assistant one tap away, then answers to the questions
/// passengers ask most. There is no support inbox behind the API yet, so the
/// assistant is the live way to get help.
class PassengerHelpScreen extends StatelessWidget {
  const PassengerHelpScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final faqs = [
      (
        AppLocalizations.of(context).helpHowDoIRequest,
        AppLocalizations.of(context).helpOpenHomeTapSearch,
      ),
      (
        AppLocalizations.of(context).helpWhereISeeMy,
        AppLocalizations.of(context).helpTripsTabListsRequests,
      ),
      (
        AppLocalizations.of(context).helpHowDoIFollow,
        AppLocalizations.of(context).helpOnceDriverAcceptsOpen,
      ),
      (
        AppLocalizations.of(context).helpIForgotMyPassword,
        AppLocalizations.of(context).helpLoginScreenChooseForgot,
      ),
    ];

    return SettingsPage(
      title: AppLocalizations.of(context).settingsHelpSupport,
      children: [
        SettingsRow(
          key: const ValueKey('helpAssistant'),
          icon: Icons.support_agent_rounded,
          label: AppLocalizations.of(context).helpAskDarbAssistant,
          onTap: () => context.go('/passenger/assistant'),
        ),
        const SizedBox(height: 24),
        Text(
          AppLocalizations.of(context).helpCommonQuestions,
          style: PassengerStyle.sectionTitle,
        ),
        const SizedBox(height: 12),
        for (final (question, answer) in faqs)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Material(
              color: PassengerStyle.panel,
              borderRadius: BorderRadius.circular(PassengerStyle.radiusTile),
              clipBehavior: Clip.antiAlias,
              child: Theme(
                data: Theme.of(
                  context,
                ).copyWith(dividerColor: Colors.transparent),
                child: ExpansionTile(
                  tilePadding: const EdgeInsets.symmetric(horizontal: 14),
                  childrenPadding: const EdgeInsetsDirectional.fromSTEB(
                    14,
                    0,
                    14,
                    14,
                  ),
                  expandedCrossAxisAlignment: CrossAxisAlignment.start,
                  iconColor: PassengerStyle.orange,
                  collapsedIconColor: PassengerStyle.iconMuted,
                  title: Text(
                    question,
                    style: PassengerStyle.inter(
                      size: 15,
                      height: 19,
                      weight: 560,
                    ),
                  ),
                  children: [Text(answer, style: PassengerStyle.cardBody)],
                ),
              ),
            ),
          ),
      ],
    );
  }
}
