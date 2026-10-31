import 'package:flutter/material.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../notifications/presentation/notification_bell.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_tokens.dart';
import '../../../../core/theme/semantic_colors.dart';
import '../../../../core/widgets/entity_cards.dart';
import '../../../../core/widgets/masari_card.dart';
import '../../../../core/widgets/trust_score_ring.dart';
import '../../domain/driver_home_stats.dart';

/// The driver home top bar: notifications, centred wordmark, avatar.
///
/// Mirrors the passenger bar — bell leading, avatar trailing — and pins that
/// arrangement left-to-right so it holds in both locales.
class DriverTopBar extends StatelessWidget {
  const DriverTopBar({required this.title, this.name, super.key});

  final String title;
  final String? name;

  @override
  Widget build(BuildContext context) {
    return Row(
      textDirection: TextDirection.ltr,
      children: [
        const NotificationBell(key: ValueKey('driverNotifications')),
        Expanded(
          child: Text(
            title,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              color: AppTheme.primary,
              fontWeight: FontWeight.w700,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        RoleAvatar(name: name ?? '', role: 'driver', size: 44),
      ],
    );
  }
}

/// Greeting plus the online switch.
///
/// "Online" is not a cosmetic flag: it reflects whether the driver has an
/// operational route, and toggling it creates or deactivates one. The switch is
/// disabled while that request is in flight so it cannot be double-submitted.
class DriverStatusCard extends StatelessWidget {
  const DriverStatusCard({
    required this.greeting,
    required this.subtitle,
    required this.isOnline,
    required this.busy,
    required this.onChanged,
    super.key,
  });

  final String greeting;
  final String subtitle;
  final bool isOnline;
  final bool busy;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);

    return MasariCard(
      padding: EdgeInsets.zero,
      // IntrinsicHeight gives the row a bounded height from its content, so
      // the status stripe can stretch to match it. Without it, `stretch`
      // inside a scroll view resolves to an infinite height and asserts.
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(AppTokens.spaceMedium),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            greeting,
                            style: theme.textTheme.titleLarge?.copyWith(
                              color: AppTheme.primary,
                              fontWeight: FontWeight.w700,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: AppTokens.spaceExtraSmall),
                          Text(
                            subtitle,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: AppTheme.onSurfaceVariant,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: AppTokens.spaceSmall),
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Switch(
                          key: const ValueKey('driverOnlineSwitch'),
                          value: isOnline,
                          onChanged: busy ? null : onChanged,
                        ),
                        Text(
                          isOnline ? l10n.driverOnline : l10n.driverOffline,
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: AppTheme.onSurfaceVariant,
                          ),
                          maxLines: 1,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            // Status stripe on the trailing edge. Unlike the reference
            // design's fixed accent, its colour encodes the online state, so
            // the card's meaning survives a glance without reading the switch.
            Container(
              width: 6,
              decoration: BoxDecoration(
                color: isOnline ? SemanticColors.success : AppTheme.outline,
                borderRadius: const BorderRadiusDirectional.horizontal(
                  end: Radius.circular(AppTokens.radiusMedium),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The trust-score gauge, or an explicit unavailable state.
class TrustScoreCard extends StatelessWidget {
  const TrustScoreCard({required this.stats, super.key});

  final DriverHomeStats stats;

  String _caption(AppLocalizations l10n, double score) {
    if (score >= 4.5) return l10n.trustExcellent;
    if (score >= 3.5) return l10n.trustGood;
    if (score >= 2.5) return l10n.trustFair;
    return l10n.trustWeak;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final score = stats.trustOutOfFive;

    return MasariCard(
      child: SizedBox(
        height: 150,
        child: Center(
          child: score == null
              // No endpoint exposes the driver's own trust score, so the card
              // says so rather than showing a zero or an invented figure.
              ? Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      l10n.trustPoints,
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: AppTheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: AppTokens.spaceSmall),
                    const Icon(
                      Icons.shield_outlined,
                      size: 32,
                      color: AppTheme.outline,
                    ),
                    const SizedBox(height: AppTokens.spaceSmall),
                    Text(
                      l10n.trustScoreUnavailable,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppTheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                )
              : TrustScoreRing(
                  score: score,
                  label: l10n.trustPoints,
                  caption: _caption(l10n, score),
                  size: 88,
                ),
        ),
      ),
    );
  }
}

/// Today's earnings and completed trips.
///
/// The trip count is always real. Earnings have no column in the schema, so
/// outside a demo build the figure is replaced by an explicit unavailable
/// label and the card still carries the real count.
class EarningsCard extends StatelessWidget {
  const EarningsCard({required this.stats, super.key});

  final DriverHomeStats stats;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final earnings = stats.todayEarningsLabel;

    return Container(
      height: 150,
      padding: const EdgeInsets.all(AppTokens.spaceMedium),
      decoration: BoxDecoration(
        color: AppTheme.primary,
        borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              const Icon(
                Icons.account_balance_wallet_outlined,
                size: 20,
                color: AppTheme.onPrimary,
              ),
              const SizedBox(width: AppTokens.spaceSmall),
              Expanded(
                child: Text(
                  l10n.todayEarnings,
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: AppTheme.onPrimary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          Text(
            earnings ?? l10n.earningsUnavailable,
            style:
                (earnings == null
                        ? theme.textTheme.titleMedium
                        : theme.textTheme.displayMedium)
                    ?.copyWith(
                      color: AppTheme.onPrimary,
                      fontWeight: FontWeight.w700,
                    ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          Text(
            l10n.completedTripsToday(stats.completedTripsToday),
            key: const ValueKey('driverCompletedTripsToday'),
            style: theme.textTheme.bodySmall?.copyWith(
              color: AppTheme.onPrimary.withValues(alpha: 0.85),
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}
