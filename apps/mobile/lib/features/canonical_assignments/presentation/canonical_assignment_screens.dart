import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/masari_card.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../canonical_routes/presentation/canonical_route_widgets.dart';
import '../application/canonical_assignment_controller.dart';
import '../domain/canonical_assignment_models.dart';

class DriverCanonicalOfferListScreen extends ConsumerStatefulWidget {
  const DriverCanonicalOfferListScreen({super.key});

  @override
  ConsumerState<DriverCanonicalOfferListScreen> createState() =>
      _DriverCanonicalOfferListScreenState();
}

class _DriverCanonicalOfferListScreenState
    extends ConsumerState<DriverCanonicalOfferListScreen>
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
      ref.read(driverCanonicalOffersProvider.notifier).refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final capabilities = ref.watch(mobileCapabilitiesProvider);
    final offers = ref.watch(driverCanonicalOffersProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.canonicalDriverOffers)),
      body: capabilities.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _ErrorPanel(
          error: error,
          onRetry: () =>
              ref.read(mobileCapabilitiesProvider.notifier).refresh(),
        ),
        data: (value) {
          if (!value.driverCanonicalOffersAvailable) {
            return _UnavailablePanel(message: l10n.featureUnavailable);
          }
          return offers.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, _) => _ErrorPanel(
              error: error,
              onRetry: () =>
                  ref.read(driverCanonicalOffersProvider.notifier).refresh(),
            ),
            data: (state) => RefreshIndicator(
              onRefresh: () =>
                  ref.read(driverCanonicalOffersProvider.notifier).refresh(),
              child: ListView(
                padding: const EdgeInsets.all(AppTokens.spaceLarge),
                children: [
                  if (capabilities
                          .value
                          ?.canonicalSharedDriverOffersAvailable ==
                      true) ...[
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
                      selected: const {'individual'},
                      onSelectionChanged: (selection) {
                        if (selection.contains('shared')) {
                          context.go('/driver/shared-offers');
                        }
                      },
                    ),
                    const SizedBox(height: AppTokens.spaceMedium),
                  ],
                  Text(l10n.canonicalDriverOffersBody),
                  Text(
                    l10n.manualRefreshNotice,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: AppTokens.spaceMedium),
                  if (state.offers.isEmpty)
                    MasariCard(child: Text(l10n.noCanonicalOffers))
                  else
                    for (final offer in state.offers) ...[
                      _OfferCard(offer: offer, serverNow: state.serverNow),
                      const SizedBox(height: AppTokens.spaceMedium),
                    ],
                  if (state.nextCursor != null)
                    FilledButton.tonal(
                      key: const ValueKey('loadMoreCanonicalOffers'),
                      onPressed: state.loadingMore
                          ? null
                          : () => ref
                                .read(driverCanonicalOffersProvider.notifier)
                                .loadMore(),
                      child: state.loadingMore
                          ? const SizedBox.square(
                              dimension: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(l10n.loadMore),
                    ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _OfferCard extends StatelessWidget {
  const _OfferCard({required this.offer, required this.serverNow});

  final CanonicalDriverOffer offer;
  final DateTime serverNow;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final routeName = _routeName(context, offer.route);
    final expired = offer.expiredAt(serverNow);
    return Semantics(
      button: true,
      label:
          '$routeName, ${canonicalOfferStatusLabel(l10n, offer.status)}, ${_demandLabel(l10n, offer.demandType)}',
      child: MasariCard(
        onTap: () => context.go('/driver/canonical-offers/${offer.id}'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(routeName, style: Theme.of(context).textTheme.titleMedium),
            Text(_demandLabel(l10n, offer.demandType)),
            Text(canonicalOfferStatusLabel(l10n, offer.status)),
            Text(
              expired
                  ? l10n.offerExpired
                  : '${l10n.offerExpires}: ${dateTimeLabel(context, offer.expiresAt)}',
            ),
          ],
        ),
      ),
    );
  }
}

class DriverCanonicalOfferDetailScreen extends ConsumerStatefulWidget {
  const DriverCanonicalOfferDetailScreen({required this.offerId, super.key});

  final String offerId;

  @override
  ConsumerState<DriverCanonicalOfferDetailScreen> createState() =>
      _DriverCanonicalOfferDetailScreenState();
}

class _DriverCanonicalOfferDetailScreenState
    extends ConsumerState<DriverCanonicalOfferDetailScreen>
    with WidgetsBindingObserver {
  CanonicalRejectReason? _reason;

  bool get _dirty => _reason != null;

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
      ref
          .read(driverCanonicalOfferDetailProvider(widget.offerId).notifier)
          .refresh();
    }
  }

  Future<bool> _confirmLeave() async {
    if (!_dirty) return true;
    return await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            content: Text(AppLocalizations.of(context).leaveRejectionWarning),
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
    final capabilities = ref.watch(mobileCapabilitiesProvider);
    if (capabilities.isLoading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (capabilities.hasError) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.offerDetails)),
        body: _ErrorPanel(
          error: capabilities.error!,
          onRetry: () =>
              ref.read(mobileCapabilitiesProvider.notifier).refresh(),
        ),
      );
    }
    if (capabilities.value?.driverCanonicalOffersAvailable != true) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.offerDetails)),
        body: _UnavailablePanel(message: l10n.featureUnavailable),
      );
    }
    final detail = ref.watch(
      driverCanonicalOfferDetailProvider(widget.offerId),
    );
    return PopScope(
      canPop: !_dirty,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop || !await _confirmLeave() || !context.mounted) return;
        context.pop();
      },
      child: Scaffold(
        appBar: AppBar(title: Text(l10n.offerDetails)),
        body: detail.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => _ErrorPanel(
            error: error,
            onRetry: () => ref
                .read(
                  driverCanonicalOfferDetailProvider(widget.offerId).notifier,
                )
                .refresh(),
          ),
          data: (state) {
            final offer = state.offer;
            final actionable =
                offer.actionable && !offer.expiredAt(state.serverNow);
            return RefreshIndicator(
              onRefresh: () => ref
                  .read(
                    driverCanonicalOfferDetailProvider(widget.offerId).notifier,
                  )
                  .refresh(),
              child: ListView(
                padding: const EdgeInsets.all(AppTokens.spaceLarge),
                children: [
                  _OfferSummary(offer: offer, serverNow: state.serverNow),
                  if (state.uncertain || state.recoveryPending) ...[
                    const SizedBox(height: AppTokens.spaceMedium),
                    Semantics(
                      liveRegion: true,
                      child: MasariCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(l10n.operationResultUncertain),
                            FilledButton.tonal(
                              key: const ValueKey(
                                'recoverCanonicalOfferOperation',
                              ),
                              onPressed: state.mutating
                                  ? null
                                  : () => _run(
                                      () => ref
                                          .read(
                                            driverCanonicalOfferDetailProvider(
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
                  if (actionable) ...[
                    const SizedBox(height: AppTokens.spaceMedium),
                    FilledButton(
                      key: const ValueKey('acceptCanonicalOffer'),
                      onPressed: state.mutating
                          ? null
                          : () => _confirmAndRun(
                              l10n.confirmAcceptOffer,
                              () => ref
                                  .read(
                                    driverCanonicalOfferDetailProvider(
                                      widget.offerId,
                                    ).notifier,
                                  )
                                  .accept(),
                            ),
                      child: Text(l10n.acceptOffer),
                    ),
                    const SizedBox(height: AppTokens.spaceSmall),
                    DropdownButtonFormField<CanonicalRejectReason>(
                      key: const ValueKey('canonicalRejectReason'),
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
                      onChanged: state.mutating
                          ? null
                          : (value) => setState(() => _reason = value),
                    ),
                    OutlinedButton(
                      key: const ValueKey('rejectCanonicalOffer'),
                      onPressed: state.mutating || _reason == null
                          ? null
                          : () => _confirmAndRun(
                              l10n.confirmRejectOffer,
                              () => ref
                                  .read(
                                    driverCanonicalOfferDetailProvider(
                                      widget.offerId,
                                    ).notifier,
                                  )
                                  .reject(_reason!),
                            ),
                      child: Text(l10n.rejectOffer),
                    ),
                  ],
                  const SizedBox(height: AppTokens.spaceMedium),
                  OutlinedButton(
                    onPressed: () => ref
                        .read(
                          driverCanonicalOfferDetailProvider(
                            widget.offerId,
                          ).notifier,
                        )
                        .refresh(),
                    child: Text(l10n.refresh),
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

class _OfferSummary extends StatelessWidget {
  const _OfferSummary({required this.offer, required this.serverNow});

  final CanonicalDriverOffer offer;
  final DateTime serverNow;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final pickup = offer.route.stop(offer.demand.pickupStopId);
    final destinations = offer.demand.destinationStopIds
        .map(offer.route.stop)
        .whereType<CanonicalRouteStopSummary>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        MasariCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                _routeName(context, offer.route),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              Text(canonicalOfferStatusLabel(l10n, offer.status)),
              Text(_demandLabel(l10n, offer.demandType)),
              if (pickup != null)
                Text('${l10n.pickupStop}: ${_stopName(context, pickup)}'),
              for (final destination in destinations)
                Text('${l10n.dropoffStop}: ${_stopName(context, destination)}'),
              Text(
                '${l10n.departureTime}: ${dateTimeLabel(context, offer.departureAt)}',
              ),
              Text(
                offer.expiredAt(serverNow)
                    ? l10n.offerExpired
                    : '${l10n.offerExpires}: ${dateTimeLabel(context, offer.expiresAt)}',
              ),
              if (offer.demand.passengerCount case final count?)
                Text('${l10n.passengerCount}: $count'),
              if (offer.demand.parcelCount case final count?)
                Text('${l10n.parcelCount}: $count'),
            ],
          ),
        ),
        // Shown before the driver accepts. Display-only: no payment happens
        // in the app and the passenger or merchant pays the driver directly.
        fareSnapshotBox(
          context,
          offer.demand.fare,
          passengers: offer.demand.passengerCount,
        ),
        if (offer.trip case final trip?) ...[
          const SizedBox(height: AppTokens.spaceMedium),
          _TripSummaryCard(trip: trip),
        ],
      ],
    );
  }
}

class CanonicalAssignmentListScreen extends ConsumerStatefulWidget {
  const CanonicalAssignmentListScreen({required this.role, super.key});

  final String role;

  @override
  ConsumerState<CanonicalAssignmentListScreen> createState() =>
      _CanonicalAssignmentListScreenState();
}

class _CanonicalAssignmentListScreenState
    extends ConsumerState<CanonicalAssignmentListScreen>
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
    if (state != AppLifecycleState.resumed) return;
    if (widget.role == 'passenger') {
      ref.read(passengerCanonicalAssignmentsProvider.notifier).refresh();
    } else {
      ref.read(merchantCanonicalAssignmentsProvider.notifier).refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final capabilities = ref.watch(mobileCapabilitiesProvider);
    if (capabilities.isLoading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (capabilities.hasError) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.canonicalAssignments)),
        body: _ErrorPanel(
          error: capabilities.error!,
          onRetry: () =>
              ref.read(mobileCapabilitiesProvider.notifier).refresh(),
        ),
      );
    }
    if (capabilities.value?.canonicalAssignmentStatusAvailable != true) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.canonicalAssignments)),
        body: _UnavailablePanel(message: l10n.featureUnavailable),
      );
    }
    final assignments = widget.role == 'passenger'
        ? ref.watch(passengerCanonicalAssignmentsProvider)
        : ref.watch(merchantCanonicalAssignmentsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.canonicalAssignments)),
      body: assignments.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _ErrorPanel(error: error, onRetry: _refresh),
        data: (items) => RefreshIndicator(
          onRefresh: _refresh,
          child: ListView(
            padding: const EdgeInsets.all(AppTokens.spaceLarge),
            children: [
              Text(l10n.manualRefreshNotice),
              const SizedBox(height: AppTokens.spaceMedium),
              if (items.isEmpty)
                MasariCard(child: Text(l10n.noCanonicalAssignments))
              else
                for (final item in items) ...[
                  _AssignmentCard(
                    assignment: item,
                    sharedPresentationAvailable:
                        capabilities
                            .value
                            ?.canonicalSharedAssignmentStatusAvailable ==
                        true,
                    onTap: () => context.go(
                      '/${widget.role}/canonical-assignments/${item.id}',
                    ),
                  ),
                  const SizedBox(height: AppTokens.spaceMedium),
                ],
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _refresh() => widget.role == 'passenger'
      ? ref.read(passengerCanonicalAssignmentsProvider.notifier).refresh()
      : ref.read(merchantCanonicalAssignmentsProvider.notifier).refresh();
}

class _AssignmentCard extends StatelessWidget {
  const _AssignmentCard({
    required this.assignment,
    required this.sharedPresentationAvailable,
    required this.onTap,
  });

  final CanonicalAssignment assignment;
  final bool sharedPresentationAvailable;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    if (assignment.tripVersion == CanonicalTripVersion.shared &&
        !sharedPresentationAvailable) {
      return Semantics(
        button: true,
        label: l10n.sharedAssignmentUnavailable,
        child: MasariCard(
          onTap: onTap,
          child: Text(l10n.sharedAssignmentUnavailable),
        ),
      );
    }
    final status = canonicalAssignmentStatusLabel(l10n, assignment.status);
    return Semantics(
      button: true,
      label: '${_routeName(context, assignment.route)}, $status',
      child: MasariCard(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              _routeName(context, assignment.route),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            Text(status),
            Text(dateTimeLabel(context, assignment.departureFrom)),
          ],
        ),
      ),
    );
  }
}

class CanonicalAssignmentDetailScreen extends ConsumerStatefulWidget {
  const CanonicalAssignmentDetailScreen({
    required this.role,
    required this.assignmentId,
    super.key,
  });

  final String role;
  final String assignmentId;

  @override
  ConsumerState<CanonicalAssignmentDetailScreen> createState() =>
      _CanonicalAssignmentDetailScreenState();
}

class _CanonicalAssignmentDetailScreenState
    extends ConsumerState<CanonicalAssignmentDetailScreen>
    with WidgetsBindingObserver {
  CanonicalAssignmentTarget get _target =>
      (role: widget.role, id: widget.assignmentId);

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
      ref.read(canonicalAssignmentDetailProvider(_target).notifier).refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final capabilities = ref.watch(mobileCapabilitiesProvider);
    if (capabilities.isLoading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (capabilities.hasError) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.canonicalAssignmentStatus)),
        body: _ErrorPanel(
          error: capabilities.error!,
          onRetry: () =>
              ref.read(mobileCapabilitiesProvider.notifier).refresh(),
        ),
      );
    }
    if (capabilities.value?.canonicalAssignmentStatusAvailable != true) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.canonicalAssignmentStatus)),
        body: _UnavailablePanel(message: l10n.featureUnavailable),
      );
    }
    final detail = ref.watch(canonicalAssignmentDetailProvider(_target));
    return Scaffold(
      appBar: AppBar(title: Text(l10n.canonicalAssignmentStatus)),
      body: detail.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _ErrorPanel(
          error: error,
          onRetry: () => ref
              .read(canonicalAssignmentDetailProvider(_target).notifier)
              .refresh(),
        ),
        data: (envelope) =>
            envelope.assignment.tripVersion == CanonicalTripVersion.shared &&
                capabilities.value?.canonicalSharedAssignmentStatusAvailable !=
                    true
            ? _UnavailablePanel(message: l10n.sharedAssignmentUnavailable)
            : RefreshIndicator(
                onRefresh: () => ref
                    .read(canonicalAssignmentDetailProvider(_target).notifier)
                    .refresh(),
                child: ListView(
                  padding: const EdgeInsets.all(AppTokens.spaceLarge),
                  children: [
                    _AssignmentSummary(assignment: envelope.assignment),
                    const SizedBox(height: AppTokens.spaceMedium),
                    OutlinedButton(
                      onPressed: () => ref
                          .read(
                            canonicalAssignmentDetailProvider(_target).notifier,
                          )
                          .refresh(),
                      child: Text(l10n.refresh),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}

class _AssignmentSummary extends StatelessWidget {
  const _AssignmentSummary({required this.assignment});
  final CanonicalAssignment assignment;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final pickup = assignment.route.stop(assignment.pickupStopId);
    final passengerDestination = assignment.dropoffStopId == null
        ? null
        : assignment.route.stop(assignment.dropoffStopId!);
    final destinations = <CanonicalRouteStopSummary>[
      ?passengerDestination,
      ...assignment.destinationStopIds
          .map(assignment.route.stop)
          .whereType<CanonicalRouteStopSummary>(),
    ];
    return Semantics(
      liveRegion: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          MasariCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  _routeName(context, assignment.route),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                Text(canonicalAssignmentStatusLabel(l10n, assignment.status)),
                Text(_assignmentBody(l10n, assignment.status)),
                if (pickup != null)
                  Text('${l10n.pickupStop}: ${_stopName(context, pickup)}'),
                for (final destination in destinations.toSet())
                  Text(
                    '${l10n.dropoffStop}: ${_stopName(context, destination)}',
                  ),
                Text(
                  '${l10n.departureFrom}: ${dateTimeLabel(context, assignment.departureFrom)}',
                ),
                Text(
                  '${l10n.departureUntil}: ${dateTimeLabel(context, assignment.departureUntil)}',
                ),
              ],
            ),
          ),
          fareSnapshotBox(
            context,
            assignment.fare,
            passengers: assignment.passengerCount,
          ),
          if (assignment.trip case final trip?) ...[
            const SizedBox(height: AppTokens.spaceMedium),
            _TripSummaryCard(trip: trip),
            if (trip.version == CanonicalTripVersion.shared) ...[
              const SizedBox(height: AppTokens.spaceMedium),
              MasariCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      l10n.sharedAssignmentIndicator,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    Text(l10n.sharedAssignmentPrivacyNotice),
                  ],
                ),
              ),
            ],
          ],
          const SizedBox(height: AppTokens.spaceMedium),
          MasariCard(child: Text(l10n.trackingNotAvailable)),
        ],
      ),
    );
  }
}

class _TripSummaryCard extends StatelessWidget {
  const _TripSummaryCard({required this.trip});
  final CanonicalTripSummary trip;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return MasariCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.canonicalTrip,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          Text('${l10n.currentStatus}: ${_tripStatusLabel(l10n, trip.status)}'),
          if (trip.departureAt case final departure?)
            Text('${l10n.departureTime}: ${dateTimeLabel(context, departure)}'),
          if (trip.vehicleType case final vehicle?)
            Text('${l10n.vehicleType}: ${_vehicleLabel(l10n, vehicle)}'),
          if (trip.status == CanonicalTripStatus.unsupported ||
              trip.vehicleType == CanonicalVehicleType.unsupported)
            Text(l10n.unsupportedDataNotice),
        ],
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
    children: [MasariCard(child: Text(message))],
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
      MasariCard(
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

String _stopName(BuildContext context, CanonicalRouteStopSummary stop) =>
    Localizations.localeOf(context).languageCode == 'ar'
    ? stop.nameAr
    : stop.nameEn;

String _demandLabel(AppLocalizations l10n, CanonicalDemandType type) =>
    switch (type) {
      CanonicalDemandType.passenger => l10n.demandPassenger,
      CanonicalDemandType.merchantOrder => l10n.demandMerchant,
    };

String canonicalOfferStatusLabel(
  AppLocalizations l10n,
  CanonicalOfferStatus status,
) => switch (status) {
  CanonicalOfferStatus.offered => l10n.statusOffered,
  CanonicalOfferStatus.accepted => l10n.statusAccepted,
  CanonicalOfferStatus.rejected => l10n.statusRejected,
  CanonicalOfferStatus.expired => l10n.statusExpired,
};

String canonicalAssignmentStatusLabel(
  AppLocalizations l10n,
  CanonicalAssignmentStatus status,
) => switch (status) {
  CanonicalAssignmentStatus.pending => l10n.statusPending,
  CanonicalAssignmentStatus.offered => l10n.statusOffered,
  CanonicalAssignmentStatus.assigned => l10n.statusAssigned,
  CanonicalAssignmentStatus.unavailable => l10n.statusUnavailable,
  CanonicalAssignmentStatus.cancelled => l10n.statusCancelled,
};

String _assignmentBody(
  AppLocalizations l10n,
  CanonicalAssignmentStatus status,
) => switch (status) {
  CanonicalAssignmentStatus.pending => l10n.assignmentPendingBody,
  CanonicalAssignmentStatus.offered => l10n.assignmentOfferedBody,
  CanonicalAssignmentStatus.assigned => l10n.assignmentAssignedBody,
  CanonicalAssignmentStatus.unavailable => l10n.assignmentUnavailableBody,
  CanonicalAssignmentStatus.cancelled => l10n.assignmentCancelledBody,
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
  if (error is CanonicalOperationBlocked) {
    return l10n.canonicalRecoveryRequired;
  }
  if (error is ApiException &&
      (error.type == ApiErrorType.network ||
          error.type == ApiErrorType.timeout ||
          error.statusCode == 502 ||
          error.statusCode == 503)) {
    return l10n.operationTemporaryFailure;
  }
  return l10n.requestFailed;
}
