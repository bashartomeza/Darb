import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/config/app_config.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/brand_logo.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/darb_card.dart';
import '../../operating_routes/data/operating_route_repository.dart';

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
            DarbCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.welcomeTitle, style: textTheme.headlineMedium),
                  const SizedBox(height: AppTokens.spaceMedium),
                  Text(l10n.welcomeBody),
                  const SizedBox(height: AppTokens.spaceLarge),
                  const _RoutesPreview(),
                ],
              ),
            ),
            const SizedBox(height: AppTokens.spaceMedium),
            DarbCard(
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

/// The active routes, read before sign-in (the list is public): a few as
/// chips and how many more there are. Offline it says the routes will come.
class _RoutesPreview extends ConsumerWidget {
  const _RoutesPreview();

  static const _shown = 4;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final routes = ref.watch(operatingRoutesProvider);
    return Column(
      key: const ValueKey('welcomeRoutes'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(l10n.welcomeRoutesTitle, style: theme.textTheme.titleMedium),
        const SizedBox(height: AppTokens.spaceSmall),
        routes.when(
          loading: () => const SizedBox(
            height: 32,
            child: Align(
              alignment: AlignmentDirectional.centerStart,
              child: SizedBox.square(
                dimension: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          ),
          error: (_, _) => Text(
            l10n.welcomeRoutesOffline,
            key: const ValueKey('welcomeRoutesOffline'),
            style: theme.textTheme.bodyMedium,
          ),
          data: (items) {
            if (items.isEmpty) {
              return Text(
                l10n.passengerRoutesEmpty,
                style: theme.textTheme.bodyMedium,
              );
            }
            final more = items.length - _shown;
            return Wrap(
              spacing: AppTokens.spaceSmall,
              runSpacing: AppTokens.spaceSmall,
              children: [
                for (final route in items.take(_shown))
                  Chip(
                    avatar: const Icon(Icons.route_rounded, size: 18),
                    label: Text(route.displayName(arabic: arabic)),
                  ),
                if (more > 0)
                  Chip(
                    key: const ValueKey('welcomeRoutesMore'),
                    label: Text(l10n.welcomeRoutesMore(more)),
                  ),
              ],
            );
          },
        ),
      ],
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
