import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_section.dart';
import '../../../core/widgets/state_views.dart';
import '../application/merchant_report_provider.dart';
import '../data/merchant_report_models.dart';
import 'merchant_ui.dart';

/// The merchant's "Reports" tab: live counts of their own orders, parcels and
/// deliveries, grouped by status. There is no cost or pricing data in the
/// system, so none is shown.
class MerchantReportsScreen extends ConsumerWidget {
  const MerchantReportsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final summary = ref.watch(merchantReportSummaryProvider);

    return Scaffold(
      key: const ValueKey('merchantReportsTab'),
      appBar: AppBar(
        title: Text(l10n.navReports),
        actions: const [
          LanguageSwitch(),
          SizedBox(width: AppTokens.spaceSmall),
        ],
      ),
      body: SafeArea(
        top: false,
        bottom: false,
        child: summary.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => ListView(
            children: [
              ErrorStateView(
                title: l10n.reportsLoadError,
                retryLabel: l10n.retry,
                onRetry: () => ref.invalidate(merchantReportSummaryProvider),
              ),
            ],
          ),
          data: (data) => RefreshIndicator(
            onRefresh: () => ref.refresh(merchantReportSummaryProvider.future),
            child: _ReportBody(summary: data),
          ),
        ),
      ),
    );
  }
}

class _ReportBody extends StatelessWidget {
  const _ReportBody({required this.summary});

  final MerchantReportSummary summary;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppTokens.marginMobile,
        AppTokens.spaceMedium,
        AppTokens.marginMobile,
        AppTokens.spaceExtraLarge,
      ),
      children: [
        MasariInfoCard(
          title: l10n.merchantDashboard,
          icon: Icons.summarize_outlined,
          body: StatStrip(
            stats: [
              (
                label: l10n.orders,
                value: '${summary.ordersTotal}',
                valueKey: const ValueKey('reportsOrderCount'),
              ),
              (
                label: l10n.parcels,
                value: '${summary.parcels}',
                valueKey: const ValueKey('reportsParcelCount'),
              ),
              (
                label: l10n.reportsDeliveries,
                value: '${summary.tripsTotal}',
                valueKey: const ValueKey('reportsTripCount'),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppTokens.spaceLarge),
        MasariSection(
          title: l10n.reportsOrdersByStatus,
          child: _Breakdown(
            keyPrefix: 'reportsOrders',
            counts: summary.ordersByStatus,
          ),
        ),
        const SizedBox(height: AppTokens.spaceLarge),
        MasariSection(
          title: l10n.reportsDeliveriesByStatus,
          child: _Breakdown(
            keyPrefix: 'reportsTrips',
            counts: summary.tripsByStatus,
          ),
        ),
      ],
    );
  }
}

class _Breakdown extends StatelessWidget {
  const _Breakdown({required this.keyPrefix, required this.counts});

  final String keyPrefix;
  final Map<String, int> counts;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    if (counts.isEmpty) {
      return Text(
        l10n.reportsNoRecords,
        style: theme.textTheme.bodyMedium?.copyWith(
          color: AppTheme.onSurfaceVariant,
        ),
      );
    }
    final entries = counts.entries.toList()
      ..sort((a, b) => a.key.compareTo(b.key));
    return Column(
      children: [
        for (final entry in entries)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: [
                Expanded(child: Text(merchantStatusLabel(l10n, entry.key))),
                Text(
                  '${entry.value}',
                  key: ValueKey('$keyPrefix-${entry.key}'),
                  style: theme.textTheme.titleMedium,
                ),
              ],
            ),
          ),
      ],
    );
  }
}
