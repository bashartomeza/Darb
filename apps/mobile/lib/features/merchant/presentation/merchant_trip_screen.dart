import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';
import '../../incidents/presentation/report_incident_sheet.dart';

import '../../../core/theme/app_tokens.dart';
import '../../../core/presentation/localized_labels.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_back_button.dart';
import '../../../core/widgets/masari_card.dart';
import '../../security/presentation/session_status_banner.dart';
import '../../delivery_handover/presentation/handover_code_card.dart';
import '../application/merchant_controller.dart';
import '../data/merchant_models.dart';
import 'merchant_ui.dart';

class MerchantTripScreen extends ConsumerStatefulWidget {
  const MerchantTripScreen({required this.tripId, super.key});
  final String tripId;

  @override
  ConsumerState<MerchantTripScreen> createState() => _MerchantTripScreenState();
}

class _MerchantTripScreenState extends ConsumerState<MerchantTripScreen>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final controller = ref.read(merchantTripProvider(widget.tripId).notifier);
    if (state == AppLifecycleState.resumed) controller.resumePolling();
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive ||
        state == AppLifecycleState.detached) {
      controller.pausePolling();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final trip = ref.watch(merchantTripProvider(widget.tripId));
    return Scaffold(
      appBar: AppBar(
        title: Text(
          l10n.merchantTrip,
          key: const ValueKey('merchantTripTitle'),
        ),
        leading: const MasariBackButton(fallback: '/merchant/shipments'),
        actions: const [LanguageSwitch()],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () =>
              ref.read(merchantTripProvider(widget.tripId).notifier).refresh(),
          child: ListView(
            padding: const EdgeInsets.all(AppTokens.spaceLarge),
            children: [
              Text(l10n.waitingReadOnly),
              ReportIncidentButton(tripId: widget.tripId),
              const SizedBox(height: AppTokens.spaceLarge),
              const SessionStatusBanner(),
              const SizedBox(height: AppTokens.spaceMedium),
              trip.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => FilledButton(
                  onPressed: () => ref
                      .read(merchantTripProvider(widget.tripId).notifier)
                      .refresh(),
                  child: Text(l10n.retry),
                ),
                data: (state) => _content(l10n, state),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _content(AppLocalizations l10n, MerchantTripViewState state) {
    final currentIndex = merchantTripTimeline.indexOf(state.trip.status);
    final location = state.location;
    final progress = location == null
        ? 0.0
        : ((location.sequence + 1) / 7).clamp(0.0, 1.0);
    return Column(
      children: [
        MasariCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              merchantTechnicalText(state.trip.id),
              Text(
                '${l10n.currentStatus}: ${merchantStatusLabel(l10n, state.trip.status)}',
                key: const ValueKey('merchantTripStatus'),
              ),
              Text('${l10n.selectedRoute}: ${l10n.lockedCorridor}'),
              Text(
                '${l10n.orderStatus}: ${merchantStatusLabel(l10n, state.order.status)}',
                key: const ValueKey('merchantTripOrderStatus'),
              ),
              const SizedBox(height: AppTokens.spaceMedium),
              Text(
                l10n.statusTimeline,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              ...merchantTripTimeline.indexed.map(
                (entry) => Row(
                  children: [
                    Icon(
                      currentIndex >= entry.$1 && currentIndex >= 0
                          ? Icons.check_circle
                          : Icons.radio_button_off,
                      size: 20,
                    ),
                    const SizedBox(width: AppTokens.spaceSmall),
                    Text(merchantStatusLabel(l10n, entry.$2)),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppTokens.spaceMedium),
        if (state.trip.isActive && state.trip.status != "delivered") ...[
          HandoverCodeCard(orderId: state.order.id),
          const SizedBox(height: AppTokens.spaceMedium),
        ],
        MasariCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(l10n.orders, style: Theme.of(context).textTheme.titleLarge),
              Text('${l10n.parcelCount}: ${state.order.parcels.length}'),
              ...state.order.parcels.indexed.map(
                (entry) => Text(
                  '${l10n.parcel} ${entry.$1 + 1}: ${merchantDestinationLabel(context, entry.$2.destinationLabel)} — ${merchantStatusLabel(l10n, entry.$2.status)}',
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppTokens.spaceMedium),
        MasariCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l10n.latestLocation,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              Text(l10n.deliveryProgress),
              LinearProgressIndicator(
                key: const ValueKey('merchantRouteProgress'),
                value: progress,
              ),
              const SizedBox(height: AppTokens.spaceMedium),
              if (location == null)
                Text(l10n.noLocationYet)
              else ...[
                merchantTechnicalText('${l10n.latitude}: ${location.lat}'),
                merchantTechnicalText('${l10n.longitude}: ${location.lng}'),
                Text('${l10n.sequence}: ${location.sequence}'),
                Text(
                  '${l10n.source}: ${localizedLocationSource(l10n, location.source)}',
                ),
                Text('${l10n.recordedTime}: ${location.recordedAt}'),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
