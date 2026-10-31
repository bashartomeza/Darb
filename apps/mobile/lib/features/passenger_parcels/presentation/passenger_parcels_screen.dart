import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/masari_back_button.dart';
import '../../../core/widgets/masari_card.dart';
import '../../../core/widgets/route_chip.dart';
import '../../../core/widgets/timeline_tracker.dart';
import '../../canonical_routes/presentation/canonical_route_widgets.dart';
import '../application/passenger_parcel_controller.dart';
import '../data/passenger_parcel_models.dart';
import 'passenger_parcel_labels.dart';

/// The sender's parcels with their tracking state, newest first.
class PassengerParcelsScreen extends ConsumerWidget {
  const PassengerParcelsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final parcels = ref.watch(passengerParcelsProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.myParcelsTitle),
        leading: const MasariBackButton(fallback: '/passenger'),
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const ValueKey('sendNewParcel'),
        onPressed: () => context.push('/passenger/parcels/new'),
        icon: const Icon(Icons.add),
        label: Text(l10n.sendParcelTitle),
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () =>
              ref.read(passengerParcelsProvider.notifier).refresh(),
          child: parcels.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (_, _) => ListView(
              children: [
                Padding(
                  padding: const EdgeInsets.all(AppTokens.spaceLarge),
                  child: Column(
                    children: [
                      Text(l10n.requestFailed),
                      FilledButton(
                        onPressed: () => ref
                            .read(passengerParcelsProvider.notifier)
                            .refresh(),
                        child: Text(l10n.retry),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            data: (items) => items.isEmpty
                ? ListView(
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(AppTokens.spaceLarge),
                        child: Text(
                          l10n.myParcelsEmpty,
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ],
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(
                      AppTokens.spaceLarge,
                      AppTokens.spaceMedium,
                      AppTokens.spaceLarge,
                      96,
                    ),
                    itemCount: items.length,
                    separatorBuilder: (_, _) =>
                        const SizedBox(height: AppTokens.spaceMedium),
                    itemBuilder: (context, index) =>
                        ParcelCard(parcel: items[index]),
                  ),
          ),
        ),
      ),
    );
  }
}

class ParcelCard extends ConsumerStatefulWidget {
  const ParcelCard({required this.parcel, super.key});

  final PassengerParcel parcel;

  @override
  ConsumerState<ParcelCard> createState() => _ParcelCardState();
}

class _ParcelCardState extends ConsumerState<ParcelCard> {
  bool _busy = false;
  String? _message;

  List<TimelineStep> _steps(AppLocalizations l10n) {
    final state = widget.parcel.state;
    final progression = ParcelTrackingState.progression;
    final reached = progression.indexOf(state);
    return [
      for (var i = 0; i < progression.length; i++)
        TimelineStep(
          title: parcelTrackingLabel(l10n, progression[i]),
          state: reached < 0
              ? TimelineStepState.upcoming
              : i < reached
              ? TimelineStepState.completed
              : i == reached
              ? (state == ParcelTrackingState.delivered
                    ? TimelineStepState.completed
                    : TimelineStepState.current)
              : TimelineStepState.upcoming,
        ),
    ];
  }

  Future<void> _cancel() async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(l10n.parcelCancelConfirm),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.keepParcel),
          ),
          FilledButton(
            key: const ValueKey('confirmCancelParcel'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.parcelCancelAction),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    String? message;
    try {
      await ref.read(passengerParcelsProvider.notifier).cancel(widget.parcel);
      message = l10n.parcelCancelledNotice;
    } catch (error) {
      message = parcelErrorLabel(
        l10n,
        error is ApiException ? error.message : null,
        error is ApiException ? error.statusCode : null,
      );
    }
    if (mounted) {
      setState(() {
        _busy = false;
        _message = message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final parcel = widget.parcel;
    final theme = Theme.of(context);
    return MasariCard(
      key: ValueKey('parcel-${parcel.id}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${l10n.parcelSize}: ${parcel.size}',
                  style: theme.textTheme.titleMedium,
                ),
              ),
              parcelStateChip(l10n, parcel.state),
            ],
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          RouteChip(
            from: parcel.pickupLabel,
            to: parcel.dropoffLabel ?? '',
            compact: true,
          ),
          if (parcel.departureFrom != null) ...[
            const SizedBox(height: AppTokens.spaceSmall),
            Text(dateTimeLabel(context, parcel.departureFrom!)),
          ],
          const SizedBox(height: AppTokens.spaceSmall),
          if (parcel.receiverDetailsRemoved)
            Text(l10n.parcelReceiverRemoved, style: theme.textTheme.bodySmall)
          else if (parcel.receiverName != null)
            Text(
              l10n.parcelReceiverLine(
                parcel.receiverName!,
                parcel.receiverPhoneMasked ?? '',
              ),
              style: theme.textTheme.bodyMedium,
            ),
          if (!parcel.state.isFinal) ...[
            const SizedBox(height: AppTokens.spaceMedium),
            TimelineTracker(steps: _steps(l10n)),
          ],
          if (_message != null) ...[
            const SizedBox(height: AppTokens.spaceSmall),
            Semantics(liveRegion: true, child: Text(_message!)),
          ],
          if (parcel.canCancel) ...[
            const SizedBox(height: AppTokens.spaceSmall),
            OutlinedButton(
              key: ValueKey('cancelParcel-${parcel.id}'),
              onPressed: _busy ? null : _cancel,
              child: Text(l10n.parcelCancelAction),
            ),
          ],
        ],
      ),
    );
  }
}
