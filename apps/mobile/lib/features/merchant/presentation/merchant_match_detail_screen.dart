import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_section.dart';
import '../../../core/widgets/match_widgets.dart';
import '../../../core/widgets/route_chip.dart';
import '../../../core/widgets/state_views.dart';
import '../application/merchant_controller.dart';
import '../data/merchant_models.dart';
import 'merchant_ui.dart';

class MerchantMatchDetailScreen extends ConsumerWidget {
  const MerchantMatchDetailScreen({required this.matchId, super.key});
  final String matchId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final match = ref.watch(merchantMatchDetailProvider(matchId));

    return Scaffold(
      appBar: AppBar(
        title: Text(
          l10n.matchResult,
          key: const ValueKey('merchantMatchDetailTitle'),
        ),
        actions: const [
          LanguageSwitch(),
          SizedBox(width: AppTokens.spaceSmall),
        ],
      ),
      body: SafeArea(
        top: false,
        bottom: false,
        child: match.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => ErrorStateView(
            title: merchantErrorLabel(l10n, error),
            retryLabel: l10n.retry,
            onRetry: () => ref.invalidate(merchantMatchDetailProvider(matchId)),
          ),
          data: (value) => _content(context, l10n, value),
        ),
      ),
    );
  }

  Widget _content(
    BuildContext context,
    AppLocalizations l10n,
    MerchantMatch match,
  ) {
    return ListView(
      key: const ValueKey('merchantMatchDetail'),
      padding: const EdgeInsets.fromLTRB(
        AppTokens.marginMobile,
        AppTokens.spaceMedium,
        AppTokens.marginMobile,
        AppTokens.spaceExtraLarge,
      ),
      children: [
        MasariInfoCard(
          title: l10n.merchantOrder,
          statusLabel: merchantStatusLabel(l10n, match.status),
          statusTone: statusToneFor(match.status),
          statusKey: const ValueKey('merchantMatchStatus'),
          body: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              RouteChip(
                from: match.order.pickupLabel,
                to: match.route.destinationLabel,
              ),
              const Divider(height: AppTokens.spaceLarge),
              DetailRow(
                label: l10n.parcelCount,
                value: '${match.order.parcelCount}',
                icon: Icons.widgets_outlined,
              ),
              DetailRow(
                label: l10n.selectedRoute,
                value:
                    '${match.route.originLabel} → ${match.route.destinationLabel}',
                icon: Icons.route_outlined,
              ),
              if (match.batch != null)
                DetailRow(
                  label: l10n.estimatedDistanceSaved,
                  value:
                      '${match.batch!.estimatedDistanceSaved.toStringAsFixed(2)} km',
                  icon: Icons.eco_outlined,
                ),
            ],
          ),
          primaryAction: CardAction(
            label: l10n.orderDetails,
            filled: false,
            onPressed: () => context.go('/merchant/order/${match.order.id}'),
          ),
        ),
        const SizedBox(height: AppTokens.spaceMedium),

        // The merchant's read-only status is the one thing they must
        // understand here, so it sits directly under the summary.
        ExplanationNote(
          key: const ValueKey('merchantReadOnlyNotice'),
          message: match.waitingForDriver
              ? l10n.waitingReadOnly
              : merchantStatusLabel(l10n, match.status),
          icon: Icons.visibility_outlined,
        ),
        const SizedBox(height: AppTokens.spaceLarge),

        const SizedBox(height: AppTokens.spaceLarge),
        DefaultTextStyle.merge(
          style: Theme.of(
            context,
          ).textTheme.labelSmall?.copyWith(color: AppTheme.onSurfaceVariant),
          textAlign: TextAlign.center,
          child: merchantTechnicalText(match.id),
        ),
      ],
    );
  }
}
