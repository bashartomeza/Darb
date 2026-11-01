import 'package:flutter/material.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/config/app_config.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/brand_logo.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_card.dart';

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key, this.config});

  final AppConfig? config;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(AppTokens.spaceLarge),
          children: [
            const Align(
              alignment: AlignmentDirectional.centerEnd,
              child: LanguageSwitch(),
            ),
            const SizedBox(height: AppTokens.spaceLarge),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: BrandLogo(width: 180, semanticLabel: l10n.appTitle),
            ),
            const SizedBox(height: AppTokens.spaceSmall),
            Text(l10n.tagline, style: textTheme.titleLarge),
            const SizedBox(height: AppTokens.spaceLarge),
            MasariCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.welcomeTitle, style: textTheme.headlineMedium),
                  const SizedBox(height: AppTokens.spaceMedium),
                  Text(l10n.welcomeBody),
                  const SizedBox(height: AppTokens.spaceLarge),
                  Text(l10n.lockedCorridor, style: textTheme.titleMedium),
                ],
              ),
            ),
            const SizedBox(height: AppTokens.spaceMedium),
            MasariCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.shellStatusTitle, style: textTheme.titleLarge),
                  const SizedBox(height: AppTokens.spaceSmall),
                  Text(l10n.shellStatusBody),
                  const SizedBox(height: AppTokens.spaceMedium),
                  _StatusLine(
                    label: l10n.mobileDemoPreparation,
                    value: l10n.androidOnly,
                  ),
                  _StatusLine(
                    label: l10n.apiEnvironment,
                    value: l10n.configuredApiBaseUrl,
                  ),
                  Directionality(
                    textDirection: TextDirection.ltr,
                    child: SelectableText(
                      (config ?? AppConfig.fromEnvironment()).apiBaseUrl,
                      style: textTheme.bodyMedium?.copyWith(
                        fontFamily: 'monospace',
                      ),
                    ),
                  ),
                  const SizedBox(height: AppTokens.spaceMedium),
                  Text(l10n.businessFlowsPending),
                ],
              ),
            ),
            const SizedBox(height: AppTokens.spaceLarge),
            FilledButton(onPressed: () {}, child: Text(l10n.continueAction)),
          ],
        ),
      ),
    );
  }
}

class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.spaceSmall),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
          const SizedBox(width: AppTokens.spaceMedium),
          Expanded(child: Text(value, textAlign: TextAlign.end)),
        ],
      ),
    );
  }
}
