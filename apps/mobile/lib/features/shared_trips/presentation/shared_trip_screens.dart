import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/darb_card.dart';
import '../../canonical_assignments/domain/canonical_assignment_models.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../application/shared_trip_controller.dart';
import '../domain/shared_trip_models.dart';

class DriverSharedOfferListScreen extends ConsumerStatefulWidget {
  const DriverSharedOfferListScreen({super.key});

  @override
  ConsumerState<DriverSharedOfferListScreen> createState() =>
      _DriverSharedOfferListScreenState();
}

class _DriverSharedOfferListScreenState
    extends ConsumerState<DriverSharedOfferListScreen>
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
    if (state == AppLifecycleState.resumed) {
      ref.read(sharedDriverOffersProvider.notifier).refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final capability = ref.watch(mobileCapabilitiesProvider);
    final available =
        capability.value?.canonicalSharedDriverOffersAvailable == true;
    if (capability.hasError) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.sharedOffers)),
        body: _ErrorPanel(
          error: capability.error!,
          onRetry: () =>
              ref.read(mobileCapabilitiesProvider.notifier).refresh(),
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(l10n.sharedOffers)),
      body: capability.isLoading
          ? const Center(child: CircularProgressIndicator())
          : !available
          ? _UnavailablePanel(message: l10n.sharedFeatureUnavailable)
          : ref
                .watch(sharedDriverOffersProvider)
                .when(
                  loading: () =>
                      const Center(child: CircularProgressIndicator()),
                  error: (error, _) => _ErrorPanel(
                    error: error,
                    onRetry: () =>
                        ref.read(sharedDriverOffersProvider.notifier).refresh(),
                  ),
                  data: (state) => RefreshIndicator(
                    onRefresh: () =>
                        ref.read(sharedDriverOffersProvider.notifier).refresh(),
                    child: ListView(
                      padding: const EdgeInsets.all(AppTokens.spaceLarge),
                      children: [
                        SegmentedButton<String>(
                          segments: [
                            ButtonSegment(
                              value: 'individual',
                              label: Text(l10n.individualOffers),
                            ),
                            ButtonSegment(
                              value: 'shared',
                              label: Text(l10n.sharedOffers),
                            ),
                          ],
                          selected: const {'shared'},
                          onSelectionChanged: (selection) {
                            if (selection.contains('individual')) {
                              context.go('/driver/canonical-offers');
                            }
                          },
                        ),
                        const SizedBox(height: AppTokens.spaceMedium),
                        Text(l10n.sharedOffersBody),
                        Text(
                          l10n.notLiveNotice,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        const SizedBox(height: AppTokens.spaceMedium),
                        if (state.offers.isEmpty)
                          DarbCard(child: Text(l10n.noSharedOffers))
                        else
                          for (final offer in state.offers) ...[
                            _SharedOfferCard(
                              offer: offer,
                              serverNow: state.clock.now,
                            ),
                            const SizedBox(height: AppTokens.spaceMedium),
                          ],
                        if (state.nextCursor != null)
                          FilledButton.tonal(
                            key: const ValueKey('loadMoreSharedOffers'),
                            onPressed: state.loadingMore
                                ? null
                                : () => ref
                                      .read(sharedDriverOffersProvider.notifier)
                                      .loadMore(),
                            child: state.loadingMore
                                ? const SizedBox.square(
                                    dimension: 20,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : Text(l10n.loadMore),
                          ),
                      ],
                    ),
                  ),
                ),
    );
  }
}

class _SharedOfferCard extends StatelessWidget {
  const _SharedOfferCard({required this.offer, required this.serverNow});

  final SharedDriverOffer offer;
  final DateTime serverNow;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    void openOffer() => context.go('/driver/shared-offers/${offer.id}');
    final summary = [
      _routeName(context, offer.route),
      _compositionLabel(l10n, offer.composition),
      _statusLabel(l10n, offer.status),
      '${l10n.passengerRequests}: ${offer.passengerRequestCount}',
      '${l10n.passengerSeats}: ${offer.passengerSeatCount}',
      '${l10n.merchantOrders}: ${offer.merchantOrderCount}',
      '${l10n.parcels}: ${offer.parcelUnitCount}',
    ].join(', ');
    return Semantics(
      button: true,
      excludeSemantics: true,
      label: summary,
      onTap: openOffer,
      child: DarbCard(
        onTap: openOffer,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.sharedTrip,
              style: Theme.of(context).textTheme.labelLarge,
            ),
            Text(
              _routeName(context, offer.route),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            Text(_compositionLabel(l10n, offer.composition)),
            Text(_statusLabel(l10n, offer.status)),
            Text(_directionLabel(l10n, offer.route.direction)),
            Text(
              '${l10n.departureTime}: ${_dateTime(context, offer.departureAt)}',
            ),
            Text('${l10n.passengerRequests}: ${offer.passengerRequestCount}'),
            Text('${l10n.passengerSeats}: ${offer.passengerSeatCount}'),
            Text('${l10n.merchantOrders}: ${offer.merchantOrderCount}'),
            Text('${l10n.parcels}: ${offer.parcelUnitCount}'),
            Text(
              offer.expiredAt(serverNow)
                  ? l10n.offerExpired
                  : '${l10n.offerExpires}: ${_dateTime(context, offer.expiresAt)}',
            ),
          ],
        ),
      ),
    );
  }
}

class DriverSharedOfferDetailScreen extends ConsumerStatefulWidget {
  const DriverSharedOfferDetailScreen({required this.offerId, super.key});

  final String offerId;

  @override
  ConsumerState<DriverSharedOfferDetailScreen> createState() =>
      _DriverSharedOfferDetailScreenState();
}

class _DriverSharedOfferDetailScreenState
    extends ConsumerState<DriverSharedOfferDetailScreen>
    with WidgetsBindingObserver {
  CanonicalRejectReason? _reason;
  Timer? _displayTimer;
  bool _resumed = true;

  bool get _dirty => _reason != null;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    _displayTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _resumed = state == AppLifecycleState.resumed;
    if (!_resumed) {
      _displayTimer?.cancel();
      _displayTimer = null;
      return;
    }
    if (ref
            .read(sharedDriverOfferDetailProvider(widget.offerId))
            .value
            ?.offer
            .status ==
        SharedOfferStatus.offered) {
      _startTimer();
    }
    ref
        .read(sharedDriverOfferDetailProvider(widget.offerId).notifier)
        .refresh();
  }

  void _startTimer() {
    if (!_resumed || _displayTimer != null) return;
    _displayTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  void _stopTimer() {
    _displayTimer?.cancel();
    _displayTimer = null;
  }

  Future<bool> _confirmLeave({required bool ambiguous}) async {
    if (!_dirty && !ambiguous) return true;
    return await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            content: Text(
              ambiguous
                  ? AppLocalizations.of(context).canonicalRecoveryRequired
                  : AppLocalizations.of(context).leaveRejectionWarning,
            ),
            actions: [
              TextButton(
                onPressed: () => context.pop(false),
                child: Text(AppLocalizations.of(context).cancel),
              ),
              FilledButton(
                onPressed: () => context.pop(true),
                child: Text(AppLocalizations.of(context).reviewAndConfirm),
              ),
            ],
          ),
        ) ??
        false;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final capability = ref.watch(mobileCapabilitiesProvider);
    if (capability.isLoading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (capability.hasError) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.sharedOfferDetails)),
        body: _ErrorPanel(
          error: capability.error!,
          onRetry: () =>
              ref.read(mobileCapabilitiesProvider.notifier).refresh(),
        ),
      );
    }
    if (capability.value?.canonicalSharedDriverOffersAvailable != true) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.sharedOfferDetails)),
        body: _UnavailablePanel(message: l10n.sharedFeatureUnavailable),
      );
    }
    final detail = ref.watch(sharedDriverOfferDetailProvider(widget.offerId));
    ref.listen(sharedDriverOfferDetailProvider(widget.offerId), (_, next) {
      if (next.value?.offer.status == SharedOfferStatus.offered) {
        _startTimer();
      } else {
        _stopTimer();
      }
    });
    final ambiguous = detail.value?.recoveryPending == true;
    return PopScope(
      canPop: !_dirty && !ambiguous,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop ||
            !await _confirmLeave(ambiguous: ambiguous) ||
            !context.mounted) {
          return;
        }
        context.pop();
      },
      child: Scaffold(
        appBar: AppBar(title: Text(l10n.sharedOfferDetails)),
        body: detail.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => _ErrorPanel(
            error: error,
            onRetry: () => ref
                .read(sharedDriverOfferDetailProvider(widget.offerId).notifier)
                .refresh(),
          ),
          data: (state) {
            final offer = state.offer;
            final serverNow = state.clock.now;
            final actionable =
                offer.actionableAt(serverNow) &&
                !state.uncertain &&
                !state.recoveryPending;
            final disabledReason = state.uncertain || state.recoveryPending
                ? l10n.actionDisabledUncertain
                : offer.expiredAt(serverNow)
                ? l10n.actionDisabledExpired
                : null;
            final VoidCallback? acceptAction = actionable && !state.mutating
                ? () => _confirmAndRun(
                    _decisionConfirmation(
                      l10n,
                      l10n.confirmAcceptSharedTrip,
                      offer,
                    ),
                    () => ref
                        .read(
                          sharedDriverOfferDetailProvider(
                            widget.offerId,
                          ).notifier,
                        )
                        .accept(),
                  )
                : null;
            final VoidCallback? rejectAction =
                actionable && !state.mutating && _reason != null
                ? () => _confirmAndRun(
                    _decisionConfirmation(
                      l10n,
                      l10n.confirmRejectSharedTrip,
                      offer,
                    ),
                    () => ref
                        .read(
                          sharedDriverOfferDetailProvider(
                            widget.offerId,
                          ).notifier,
                        )
                        .reject(_reason!),
                  )
                : null;
            return RefreshIndicator(
              onRefresh: () => ref
                  .read(
                    sharedDriverOfferDetailProvider(widget.offerId).notifier,
                  )
                  .refresh(),
              child: ListView(
                padding: const EdgeInsets.all(AppTokens.spaceLarge),
                children: [
                  _SharedOfferSummary(offer: offer, serverNow: serverNow),
                  const SizedBox(height: AppTokens.spaceMedium),
                  DarbCard(child: Text(l10n.sharedCapacityNotice)),
                  const SizedBox(height: AppTokens.spaceMedium),
                  DarbCard(child: Text(l10n.sharedGroupDecisionNotice)),
                  if (state.uncertain || state.recoveryPending) ...[
                    const SizedBox(height: AppTokens.spaceMedium),
                    Semantics(
                      liveRegion: true,
                      child: DarbCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(l10n.operationResultUncertain),
                            FilledButton.tonal(
                              key: const ValueKey('recoverSharedOffer'),
                              onPressed: state.mutating
                                  ? null
                                  : () => _run(
                                      () => ref
                                          .read(
                                            sharedDriverOfferDetailProvider(
                                              widget.offerId,
                                            ).notifier,
                                          )
                                          .recover(),
                                    ),
                              child: Text(l10n.recoverOperation),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                  if (offer.status == SharedOfferStatus.offered) ...[
                    const SizedBox(height: AppTokens.spaceMedium),
                    Semantics(
                      label: actionable
                          ? l10n.acceptEntireSharedTrip
                          : disabledReason,
                      button: true,
                      enabled: acceptAction != null,
                      excludeSemantics: true,
                      onTap: acceptAction,
                      child: FilledButton(
                        key: const ValueKey('acceptSharedOffer'),
                        onPressed: acceptAction,
                        child: Text(l10n.acceptEntireSharedTrip),
                      ),
                    ),
                    const SizedBox(height: AppTokens.spaceSmall),
                    DropdownButtonFormField<CanonicalRejectReason>(
                      key: const ValueKey('sharedRejectReason'),
                      initialValue: _reason,
                      decoration: InputDecoration(labelText: l10n.rejectReason),
                      items: CanonicalRejectReason.values
                          .map(
                            (reason) => DropdownMenuItem(
                              value: reason,
                              child: Text(_rejectReasonLabel(l10n, reason)),
                            ),
                          )
                          .toList(growable: false),
                      onChanged: actionable && !state.mutating
                          ? (value) => setState(() => _reason = value)
                          : null,
                    ),
                    Semantics(
                      label: actionable && _reason != null
                          ? l10n.rejectEntireSharedTrip
                          : disabledReason ?? l10n.rejectReason,
                      button: true,
                      enabled: rejectAction != null,
                      excludeSemantics: true,
                      onTap: rejectAction,
                      child: OutlinedButton(
                        key: const ValueKey('rejectSharedOffer'),
                        onPressed: rejectAction,
                        child: Text(l10n.rejectEntireSharedTrip),
                      ),
                    ),
                  ],
                  const SizedBox(height: AppTokens.spaceMedium),
                  OutlinedButton(
                    onPressed: state.mutating
                        ? null
                        : () => ref
                              .read(
                                sharedDriverOfferDetailProvider(
                                  widget.offerId,
                                ).notifier,
                              )
                              .refresh(),
                    child: Text(l10n.refresh),
                  ),
                  Text(
                    l10n.notLiveNotice,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Future<void> _confirmAndRun(
    String message,
    Future<void> Function() action,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => context.pop(false),
            child: Text(AppLocalizations.of(context).cancel),
          ),
          FilledButton(
            onPressed: () => context.pop(true),
            child: Text(AppLocalizations.of(context).reviewAndConfirm),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await _run(action);
      if (mounted) setState(() => _reason = null);
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    try {
      await action();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(_safeErrorLabel(context, error))));
    }
  }
}

class _SharedOfferSummary extends StatelessWidget {
  const _SharedOfferSummary({required this.offer, required this.serverNow});

  final SharedDriverOffer offer;
  final DateTime serverNow;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          liveRegion: true,
          child: DarbCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  _routeName(context, offer.route),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                Text(_directionLabel(l10n, offer.route.direction)),
                Text(_compositionLabel(l10n, offer.composition)),
                Text(_statusLabel(l10n, offer.status)),
                Text(
                  '${l10n.departureTime}: ${_dateTime(context, offer.departureAt)}',
                ),
                Text(
                  offer.expiredAt(serverNow)
                      ? l10n.offerExpired
                      : '${l10n.offerExpires}: ${_dateTime(context, offer.expiresAt)}',
                ),
                Text(
                  '${l10n.passengerRequests}: ${offer.passengerRequestCount}',
                ),
                Text('${l10n.passengerSeats}: ${offer.passengerSeatCount}'),
                Text('${l10n.merchantOrders}: ${offer.merchantOrderCount}'),
                Text('${l10n.parcels}: ${offer.parcelUnitCount}'),
              ],
            ),
          ),
        ),
        const SizedBox(height: AppTokens.spaceMedium),
        DarbCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l10n.stopEventTimeline,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              for (final event in offer.stopEvents) _StopEventRow(event: event),
            ],
          ),
        ),
        if (offer.status == SharedOfferStatus.accepted) ...[
          const SizedBox(height: AppTokens.spaceMedium),
          DarbCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  l10n.sharedTrip,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                Text(l10n.sharedAcceptedNotice),
                Text(
                  '${l10n.currentStatus}: ${_tripStatusLabel(l10n, offer.trip!.status)}',
                ),
                if (offer.trip!.vehicleType case final vehicle?)
                  Text('${l10n.vehicleType}: ${_vehicleLabel(l10n, vehicle)}'),
                Text(l10n.trackingNotAvailable),
              ],
            ),
          ),
        ],
        if (offer.status == SharedOfferStatus.rejected) ...[
          const SizedBox(height: AppTokens.spaceMedium),
          DarbCard(child: Text(l10n.sharedRejectedNotice)),
        ],
        if (offer.status == SharedOfferStatus.invalidated) ...[
          const SizedBox(height: AppTokens.spaceMedium),
          DarbCard(child: Text(l10n.sharedInvalidatedNotice)),
        ],
      ],
    );
  }
}

class _StopEventRow extends StatelessWidget {
  const _StopEventRow({required this.event});
  final SharedStopEvent event;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final name = Localizations.localeOf(context).languageCode == 'ar'
        ? event.nameAr
        : event.nameEn;
    final parts = <String>[
      if (event.passengerPickups > 0)
        '${l10n.passengerPickups}: ${event.passengerPickups}',
      if (event.passengerDropoffs > 0)
        '${l10n.passengerDropoffs}: ${event.passengerDropoffs}',
      if (event.parcelPickups > 0)
        '${l10n.parcelPickups}: ${event.parcelPickups}',
      if (event.parcelDestinations > 0)
        '${l10n.parcelDestinations}: ${event.parcelDestinations}',
    ];
    return Semantics(
      label: '$name, ${parts.join(', ')}',
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppTokens.spaceSmall),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(name, style: Theme.of(context).textTheme.titleSmall),
            for (final part in parts) Text(part),
          ],
        ),
      ),
    );
  }
}

class _UnavailablePanel extends StatelessWidget {
  const _UnavailablePanel({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(AppTokens.spaceLarge),
    children: [DarbCard(child: Text(message))],
  );
}

class _ErrorPanel extends StatelessWidget {
  const _ErrorPanel({required this.error, required this.onRetry});
  final Object error;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(AppTokens.spaceLarge),
    children: [
      DarbCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(_safeErrorLabel(context, error)),
            FilledButton(
              onPressed: onRetry,
              child: Text(AppLocalizations.of(context).retry),
            ),
          ],
        ),
      ),
    ],
  );
}

String _routeName(BuildContext context, CanonicalRouteSummary route) =>
    Localizations.localeOf(context).languageCode == 'ar'
    ? route.nameAr
    : route.nameEn;

String _dateTime(BuildContext context, DateTime value) =>
    '${MaterialLocalizations.of(context).formatFullDate(value.toLocal())} '
    '${MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(value.toLocal()))}';

String _compositionLabel(
  AppLocalizations l10n,
  SharedTripComposition composition,
) => switch (composition) {
  SharedTripComposition.passengerOnly => l10n.compositionPassengerOnly,
  SharedTripComposition.merchantOnly => l10n.compositionMerchantOnly,
  SharedTripComposition.mixed => l10n.compositionMixed,
};

String _statusLabel(AppLocalizations l10n, SharedOfferStatus status) =>
    switch (status) {
      SharedOfferStatus.offered => l10n.statusOffered,
      SharedOfferStatus.accepted => l10n.statusAccepted,
      SharedOfferStatus.rejected => l10n.statusRejected,
      SharedOfferStatus.expired => l10n.statusExpired,
      SharedOfferStatus.invalidated => l10n.statusUnsupported,
    };

String _directionLabel(AppLocalizations l10n, String direction) =>
    switch (direction) {
      'outbound' => l10n.directionOutbound,
      'inbound' => l10n.directionInbound,
      'loop' => l10n.directionLoop,
      _ => l10n.statusUnsupported,
    };

String _tripStatusLabel(AppLocalizations l10n, CanonicalTripStatus status) =>
    switch (status) {
      CanonicalTripStatus.accepted => l10n.statusAccepted,
      CanonicalTripStatus.unsupported => l10n.statusUnsupported,
    };

String _vehicleLabel(AppLocalizations l10n, CanonicalVehicleType vehicle) =>
    switch (vehicle) {
      CanonicalVehicleType.sedan => l10n.vehicleSedan,
      CanonicalVehicleType.van => l10n.vehicleVan,
      CanonicalVehicleType.unsupported => l10n.vehicleUnavailable,
    };

String _rejectReasonLabel(
  AppLocalizations l10n,
  CanonicalRejectReason reason,
) => switch (reason) {
  CanonicalRejectReason.driverDeclined => l10n.rejectDriverDeclined,
  CanonicalRejectReason.scheduleConflict => l10n.rejectScheduleConflict,
  CanonicalRejectReason.capacityUnavailable => l10n.rejectCapacityUnavailable,
};

String _safeErrorLabel(BuildContext context, Object error) {
  final l10n = AppLocalizations.of(context);
  if (error is SharedTripFeatureUnavailable) {
    return l10n.sharedFeatureUnavailable;
  }
  if (error is FormatException) return l10n.unsupportedDataNotice;
  if (error is ApiException &&
      (error.type == ApiErrorType.network ||
          error.type == ApiErrorType.timeout ||
          error.statusCode == 502 ||
          error.statusCode == 503)) {
    return l10n.operationTemporaryFailure;
  }
  return l10n.requestFailed;
}

String _decisionConfirmation(
  AppLocalizations l10n,
  String message,
  SharedDriverOffer offer,
) =>
    '$message\n'
    '${l10n.passengerRequests}: ${offer.passengerRequestCount}\n'
    '${l10n.passengerSeats}: ${offer.passengerSeatCount}\n'
    '${l10n.merchantOrders}: ${offer.merchantOrderCount}\n'
    '${l10n.parcels}: ${offer.parcelUnitCount}';
