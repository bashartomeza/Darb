import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/widgets/darb_section.dart';
import '../application/driver_renewal_provider.dart';

const driverRenewalPath = '/driver/renewal';

/// Home-screen card that appears only while the API says the driver has to
/// renew documents, or is waiting for the renewal to be reviewed.
class DriverRenewalBanner extends ConsumerWidget {
  const DriverRenewalBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(driverRenewalNeededProvider);
    if (state == null) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    // After a rejected renewal the driver sees why, and can send again.
    final rejected = state.renewalRejected && !state.submitted;
    final reason = state.rejectionReason;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: DarbInfoCard(
        key: const ValueKey('driverRenewalBanner'),
        title: state.submitted
            ? l10n.renewalBannerSubmittedTitle
            : rejected
            ? l10n.renewalRejectedTitle
            : l10n.renewalBannerTitle,
        subtitle: state.submitted
            ? l10n.renewalBannerSubmittedBody
            : rejected
            ? (reason == null
                  ? l10n.renewalRejectedBody
                  : l10n.renewalRejectedReason(reason))
            : l10n.renewalBannerBody,
        icon: state.submitted
            ? Icons.hourglass_top_outlined
            : rejected
            ? Icons.report_gmailerrorred_outlined
            : Icons.event_busy_outlined,
        emphasis: !state.submitted,
        primaryAction: CardAction(
          key: const ValueKey('openDriverRenewal'),
          label: l10n.renewalOpen,
          onPressed: () => context.push(driverRenewalPath),
        ),
      ),
    );
  }
}
