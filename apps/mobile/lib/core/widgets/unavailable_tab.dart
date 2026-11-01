import 'package:flutter/material.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../theme/app_tokens.dart';
import 'language_switch.dart';
import 'state_views.dart';

/// A top-level tab whose feature has no backend behind it yet.
///
/// The navigation model comes from the product flow diagrams, which include
/// destinations — notifications, maps, incident reports, exported reports —
/// that no endpoint serves today. Rather than drop those tabs (which would make
/// the app's structure disagree with the agreed flows) or fake them (which
/// would misrepresent what the system does), the tab exists and says plainly
/// what is missing.
///
/// [notice] is the one-line reason shown under the explanation. It is the part
/// a reviewer should read: it names the missing backend, not a coming-soon
/// promise.
class UnavailableTab extends StatelessWidget {
  const UnavailableTab({
    required this.appBarTitle,
    required this.title,
    required this.message,
    required this.icon,
    this.extra,
    super.key,
  });

  final String appBarTitle;
  final String title;
  final String message;
  final IconData icon;

  /// Content rendered above the empty state, for tabs that do have *some*
  /// working part alongside the unavailable one.
  final Widget? extra;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(appBarTitle),
        actions: const [
          LanguageSwitch(),
          SizedBox(width: AppTokens.spaceSmall),
        ],
      ),
      body: SafeArea(
        top: false,
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppTokens.marginMobile,
            AppTokens.spaceMedium,
            AppTokens.marginMobile,
            AppTokens.spaceExtraLarge,
          ),
          children: [
            if (extra != null) ...[
              extra!,
              const SizedBox(height: AppTokens.spaceLarge),
            ],
            EmptyState(title: title, message: message, icon: icon),
            const SizedBox(height: AppTokens.spaceMedium),
            // Deliberately worded as a system fact rather than a promise: this
            // screen must not read as a feature that is about to arrive.
            OfflineBanner(
              message: l10n.featureNotBackedNotice,
              icon: Icons.info_outline,
            ),
          ],
        ),
      ),
    );
  }
}
