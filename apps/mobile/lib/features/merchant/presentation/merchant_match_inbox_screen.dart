import '../../../core/widgets/foreground_refresh.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/darb_section.dart';
import '../../../core/widgets/match_widgets.dart';
import '../../../core/widgets/state_views.dart';
import '../application/merchant_controller.dart';
import '../data/merchant_models.dart';
import '../../../core/presentation/localized_labels.dart';
import 'merchant_ui.dart';

class MerchantMatchInboxScreen extends ConsumerWidget {
  const MerchantMatchInboxScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final matches = ref.watch(merchantMatchInboxProvider);

    void refresh() => ref.read(merchantMatchInboxProvider.notifier).refresh();

    return ForegroundRefresh(
      refresh: () async {
        await ref.read(merchantMatchInboxProvider.notifier).refresh();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            l10n.merchantMatchInbox,
            key: const ValueKey('merchantMatchInboxTitle'),
          ),
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
                ref.read(merchantMatchInboxProvider.notifier).refresh(),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                AppTokens.marginMobile,
                AppTokens.spaceMedium,
                AppTokens.marginMobile,
                AppTokens.spaceExtraLarge,
              ),
              children: [
                // Merchants cannot act on a match, so the constraint is stated
                // once at the top instead of repeated on every card.
                ExplanationNote(
                  message: l10n.waitingReadOnly,
                  icon: Icons.visibility_outlined,
                ),
                const SizedBox(height: AppTokens.spaceLarge),
                matches.when(
                  loading: () => const Column(
                    children: [
                      LoadingSkeleton.card(),
                      SizedBox(height: AppTokens.spaceMedium),
                      LoadingSkeleton.card(),
                    ],
                  ),
                  error: (error, _) => ErrorStateView(
                    title: merchantErrorLabel(l10n, error),
                    retryLabel: l10n.retry,
                    onRetry: refresh,
                  ),
                  data: (items) => items.isEmpty
                      ? EmptyState(
                          title: l10n.noAvailableMatches,
                          icon: Icons.inbox_outlined,
                          actionLabel: l10n.refresh,
                          onAction: refresh,
                        )
                      : Column(
                          children: [
                            for (final match in items) ...[
                              _MerchantMatchCard(match: match),
                              const SizedBox(height: AppTokens.spaceMedium),
                            ],
                          ],
                        ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MerchantMatchCard extends StatelessWidget {
  const _MerchantMatchCard({required this.match});

  final MerchantMatch match;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final order = match.order;
    // The route by name and the pickup / drop-offs as the merchant typed them;
    // orders from before routes keep their corridor places.
    final routeName =
        order.routeName(arabic: arabic) ??
        match.route.routeName(arabic: arabic);

    return MatchResultCard(
      title: l10n.merchantOrder,
      statusLabel: merchantStatusLabel(l10n, match.status),
      statusTone: statusToneFor(match.status),
      score: match.score,
      scoreLabel: l10n.matchScore,
      from:
          order.pickupDetails ??
          localizedCorridorPlace(context, order.pickupLabel),
      to: order.dropoffs.isNotEmpty
          ? order.dropoffs.join(' · ')
          : localizedCorridorPlace(context, match.route.destinationLabel),
      details: [
        if (routeName != null)
          (
            label: l10n.orderRouteLabel,
            value: routeName,
            icon: Icons.route_outlined,
          ),
        (
          label: l10n.parcelCount,
          value: '${order.parcelCount}',
          icon: Icons.widgets_outlined,
        ),
      ],
      actionKey: ValueKey('openMerchantMatch-${match.id}'),
      actionLabel: l10n.viewDetails,
      onAction: () => context.push('/merchant/match/${match.id}'),
      onTap: () => context.push('/merchant/match/${match.id}'),
    );
  }
}
