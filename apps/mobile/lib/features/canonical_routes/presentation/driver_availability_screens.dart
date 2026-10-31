import '../../../core/widgets/masari_back_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/masari_card.dart';
import '../../auth/application/auth_controller.dart';
import '../application/canonical_route_controller.dart';
import '../data/canonical_operation_storage.dart';
import '../domain/canonical_route_models.dart';
import 'canonical_route_widgets.dart';

class DriverAvailabilityListScreen extends ConsumerWidget {
  const DriverAvailabilityListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return CanonicalFeatureGate(
      child: Scaffold(
        appBar: AppBar(title: Text(l10n.driverAvailabilities)),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () => context.push('/driver/availability/new'),
          icon: const Icon(Icons.add),
          label: Text(l10n.newAvailability),
        ),
        body: SafeArea(
          child: ref
              .watch(driverAvailabilitiesProvider)
              .when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => _ErrorBody(
                  error: error,
                  retry: () =>
                      ref.read(driverAvailabilitiesProvider.notifier).refresh(),
                ),
                data: (values) => RefreshIndicator(
                  onRefresh: () =>
                      ref.read(driverAvailabilitiesProvider.notifier).refresh(),
                  child: ListView(
                    padding: const EdgeInsets.all(AppTokens.spaceLarge),
                    children: [
                      if (values.isEmpty)
                        MasariCard(child: Text(l10n.noAvailabilities))
                      else
                        for (final value in values)
                          Card(
                            child: ListTile(
                              minTileHeight: 64,
                              title: Text(
                                Localizations.localeOf(context).languageCode ==
                                        'ar'
                                    ? value.nameAr
                                    : value.nameEn,
                              ),
                              subtitle: Text(
                                '${availabilityStatusLabel(l10n, value.status)} · ${dateTimeLabel(context, value.departureAt)}',
                              ),
                              trailing: const Icon(Icons.chevron_right),
                              onTap: () => context.push(
                                '/driver/availability/${value.id}',
                              ),
                            ),
                          ),
                      const SizedBox(height: 80),
                    ],
                  ),
                ),
              ),
        ),
      ),
    );
  }
}

class DriverAvailabilityFormScreen extends ConsumerStatefulWidget {
  const DriverAvailabilityFormScreen({super.key});

  @override
  ConsumerState<DriverAvailabilityFormScreen> createState() =>
      _DriverAvailabilityFormScreenState();
}

class _DriverAvailabilityFormScreenState
    extends ConsumerState<DriverAvailabilityFormScreen> {
  String? _restoredRouteVersionId;
  CanonicalRoute? _route;
  DateTime _departure = DateTime.now().add(const Duration(hours: 2));
  DateTime? _windowEnd;
  int _seats = 1;
  int _parcels = 0;
  bool _busy = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    Future<void>(() async {
      final actorId = ref.read(authControllerProvider).value?.user?.id;
      if (actorId == null) return;
      CanonicalOperationBundle? bundle;
      try {
        bundle = await ref.read(canonicalOperationStorageProvider).read();
      } catch (error) {
        if (mounted) setState(() => _error = error);
        return;
      }
      if (!mounted ||
          bundle?.operation != 'driver_availability_create' ||
          bundle?.scope != 'driver' ||
          bundle?.actorId != actorId) {
        return;
      }
      final payload = bundle!.payload;
      setState(() {
        _restoredRouteVersionId = payload['route_version_id'] as String?;
        _departure =
            DateTime.tryParse(
              payload['departure_at'] as String? ?? '',
            )?.toLocal() ??
            _departure;
        _windowEnd = DateTime.tryParse(
          payload['availability_window_end'] as String? ?? '',
        )?.toLocal();
        _seats = payload['total_seats'] as int? ?? _seats;
        _parcels = payload['total_parcel_capacity'] as int? ?? _parcels;
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return CanonicalFeatureGate(
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.newAvailability),
          leading: const MasariBackButton(fallback: '/driver'),
        ),
        body: SafeArea(
          child: ref
              .watch(canonicalRouteCatalogProvider)
              .when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => _ErrorBody(
                  error: error,
                  retry: () => ref
                      .read(canonicalRouteCatalogProvider.notifier)
                      .refresh(),
                ),
                data: (routes) => ListView(
                  padding: const EdgeInsets.all(AppTokens.spaceLarge),
                  children: [
                    if (_route == null && _restoredRouteVersionId != null)
                      Builder(
                        builder: (context) {
                          final restored = routes
                              .where(
                                (route) =>
                                    route.versionId == _restoredRouteVersionId,
                              )
                              .firstOrNull;
                          if (restored != null) {
                            WidgetsBinding.instance.addPostFrameCallback((_) {
                              if (mounted && _route == null) {
                                setState(() => _route = restored);
                              }
                            });
                          } else {
                            _restoredRouteVersionId = null;
                          }
                          return const SizedBox.shrink();
                        },
                      ),
                    Text(
                      l10n.selectRoute,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    if (routes.isEmpty)
                      MasariCard(child: Text(l10n.noPublishedRoutes))
                    else
                      for (final route in routes)
                        RouteCard(
                          route: route,
                          selected: route.versionId == _route?.versionId,
                          onTap: _busy
                              ? null
                              : () => setState(() => _route = route),
                        ),
                    if (_route != null) ...[
                      const SizedBox(height: AppTokens.spaceMedium),
                      OrderedStopTimeline(stops: _route!.stops),
                      const SizedBox(height: AppTokens.spaceMedium),
                      _DateTimeTile(
                        label: l10n.departureTime,
                        value: _departure,
                        onPressed: _busy
                            ? null
                            : () async {
                                final value = await pickFutureDateTime(
                                  context,
                                  _departure,
                                );
                                if (value != null) {
                                  setState(() => _departure = value);
                                }
                              },
                      ),
                      _DateTimeTile(
                        label: l10n.availabilityWindowEnd,
                        value: _windowEnd,
                        onPressed: _busy
                            ? null
                            : () async {
                                final value = await pickFutureDateTime(
                                  context,
                                  _windowEnd ??
                                      _departure.add(const Duration(hours: 1)),
                                );
                                if (value != null) {
                                  setState(() => _windowEnd = value);
                                }
                              },
                      ),
                      _NumberSelector(
                        label: l10n.seatCapacity,
                        value: _seats,
                        minimum: 1,
                        maximum: 8,
                        onChanged: _busy
                            ? null
                            : (value) => setState(() => _seats = value),
                      ),
                      _NumberSelector(
                        label: l10n.parcelCapacity,
                        value: _parcels,
                        minimum: 0,
                        maximum: 20,
                        onChanged: _busy
                            ? null
                            : (value) => setState(() => _parcels = value),
                      ),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: AppTokens.spaceMedium),
                      Text(
                        _safeError(l10n, _error!),
                        key: const ValueKey('availabilityError'),
                      ),
                    ],
                    const SizedBox(height: AppTokens.spaceLarge),
                    FilledButton(
                      key: const ValueKey('submitCanonicalAvailability'),
                      onPressed: _route == null || _busy ? null : _submit,
                      child: _busy
                          ? const SizedBox.square(
                              dimension: 24,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(l10n.submitAvailability),
                    ),
                  ],
                ),
              ),
        ),
      ),
    );
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final actorId = ref.read(authControllerProvider).value?.user?.id;
      if (actorId == null) {
        throw const ApiException(
          ApiErrorType.unauthorized,
          'account_unavailable',
          statusCode: 401,
        );
      }
      CanonicalOperationBundle? sent;
      final runner = ref.read(canonicalMutationRunnerProvider);
      final value = await ref
          .read(driverAvailabilitiesProvider.notifier)
          .create(
            {
              'route_version_id': _route!.versionId,
              'departure_at': _departure.toUtc().toIso8601String(),
              'availability_window_end': _windowEnd?.toUtc().toIso8601String(),
              'total_seats': _seats,
              'total_parcel_capacity': _parcels,
            },
            actorId: actorId,
            onBundle: (bundle) => sent = bundle,
          );
      if (!mounted ||
          ref.read(authControllerProvider).value?.user?.id != actorId) {
        return;
      }
      final completed = sent;
      if (completed == null) {
        throw const FormatException('Missing creation receipt');
      }
      await runner.acknowledge(
        actorId: completed.actorId,
        operation: completed.operation,
        idempotencyKey: completed.idempotencyKey,
      );
      if (!mounted ||
          ref.read(authControllerProvider).value?.user?.id != actorId) {
        return;
      }
      if (mounted) context.pushReplacement('/driver/availability/${value.id}');
    } catch (error) {
      if (error is ApiException && error.statusCode == 404) {
        ref.invalidate(mobileCapabilitiesProvider);
        ref.invalidate(canonicalRouteCatalogProvider);
      }
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class DriverAvailabilityDetailScreen extends ConsumerStatefulWidget {
  const DriverAvailabilityDetailScreen({
    required this.availabilityId,
    super.key,
  });
  final String availabilityId;

  @override
  ConsumerState<DriverAvailabilityDetailScreen> createState() =>
      _DriverAvailabilityDetailScreenState();
}

class _DriverAvailabilityDetailScreenState
    extends ConsumerState<DriverAvailabilityDetailScreen> {
  bool _busy = false;
  Object? _error;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return CanonicalFeatureGate(
      child: Scaffold(
        appBar: AppBar(title: Text(l10n.driverAvailabilities)),
        body: SafeArea(
          child: ref
              .watch(driverAvailabilitiesProvider)
              .when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => _ErrorBody(
                  error: error,
                  retry: () =>
                      ref.read(driverAvailabilitiesProvider.notifier).refresh(),
                ),
                data: (values) {
                  final value = values
                      .where((item) => item.id == widget.availabilityId)
                      .firstOrNull;
                  if (value == null) {
                    return Center(child: Text(l10n.routeCatalogUnavailable));
                  }
                  return ListView(
                    padding: const EdgeInsets.all(AppTokens.spaceLarge),
                    children: [
                      MasariCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              Localizations.localeOf(context).languageCode ==
                                      'ar'
                                  ? value.nameAr
                                  : value.nameEn,
                              style: Theme.of(context).textTheme.titleLarge,
                            ),
                            DirectionBadge(direction: value.direction),
                            Text(
                              '${l10n.currentStatus}: ${availabilityStatusLabel(l10n, value.status)}',
                            ),
                            Text(
                              '${l10n.departureTime}: ${dateTimeLabel(context, value.departureAt)}',
                            ),
                            Text(
                              l10n.remainingCapacity(
                                value.remainingSeats,
                                value.remainingParcelCapacity,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (_error != null)
                        Text(
                          _safeError(l10n, _error!),
                          key: const ValueKey('availabilityActionError'),
                        ),
                      if (!value.isTerminal) ...[
                        const SizedBox(height: AppTokens.spaceMedium),
                        for (final action in _actions(value))
                          Padding(
                            padding: const EdgeInsets.only(
                              bottom: AppTokens.spaceSmall,
                            ),
                            child: action == 'cancel'
                                ? OutlinedButton(
                                    onPressed: _busy
                                        ? null
                                        : () => _transition(value, action),
                                    child: Text(_actionLabel(l10n, action)),
                                  )
                                : FilledButton(
                                    onPressed: _busy
                                        ? null
                                        : () => _transition(value, action),
                                    child: Text(_actionLabel(l10n, action)),
                                  ),
                          ),
                      ],
                    ],
                  );
                },
              ),
        ),
      ),
    );
  }

  Future<void> _transition(DriverAvailability value, String action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(driverAvailabilitiesProvider.notifier)
          .transition(value, action);
    } catch (error) {
      if (error is ApiException && error.statusCode == 404) {
        ref.invalidate(mobileCapabilitiesProvider);
        ref.invalidate(canonicalRouteCatalogProvider);
      }
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _DateTimeTile extends StatelessWidget {
  const _DateTimeTile({
    required this.label,
    required this.value,
    required this.onPressed,
  });
  final String label;
  final DateTime? value;
  final VoidCallback? onPressed;
  @override
  Widget build(BuildContext context) => ListTile(
    minTileHeight: 56,
    title: Text(label),
    subtitle: value == null ? null : Text(dateTimeLabel(context, value!)),
    trailing: const Icon(Icons.calendar_today),
    onTap: onPressed,
  );
}

class _NumberSelector extends StatelessWidget {
  const _NumberSelector({
    required this.label,
    required this.value,
    required this.minimum,
    required this.maximum,
    required this.onChanged,
  });
  final String label;
  final int value;
  final int minimum;
  final int maximum;
  final ValueChanged<int>? onChanged;

  @override
  Widget build(BuildContext context) => Semantics(
    label: '$label: $value',
    child: Row(
      children: [
        Expanded(child: Text(label)),
        IconButton(
          onPressed: value > minimum && onChanged != null
              ? () => onChanged!(value - 1)
              : null,
          icon: const Icon(Icons.remove),
        ),
        Text('$value'),
        IconButton(
          onPressed: value < maximum && onChanged != null
              ? () => onChanged!(value + 1)
              : null,
          icon: const Icon(Icons.add),
        ),
      ],
    ),
  );
}

class _ErrorBody extends StatelessWidget {
  const _ErrorBody({required this.error, required this.retry});
  final Object error;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(AppTokens.spaceLarge),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            _safeError(AppLocalizations.of(context), error),
            textAlign: TextAlign.center,
          ),
          FilledButton(
            onPressed: retry,
            child: Text(AppLocalizations.of(context).retry),
          ),
        ],
      ),
    ),
  );
}

List<String> _actions(DriverAvailability value) => switch (value.status) {
  DriverAvailabilityStatus.draft => ['activate', 'cancel'],
  DriverAvailabilityStatus.active => ['pause', 'cancel'],
  DriverAvailabilityStatus.paused => ['resume', 'cancel'],
  _ => const [],
};

String _actionLabel(AppLocalizations l10n, String action) => switch (action) {
  'activate' => l10n.activateAvailability,
  'pause' => l10n.pauseAvailability,
  'resume' => l10n.resumeAvailability,
  'cancel' => l10n.cancelAvailability,
  _ => action,
};

String availabilityStatusLabel(
  AppLocalizations l10n,
  DriverAvailabilityStatus status,
) => switch (status) {
  DriverAvailabilityStatus.draft => l10n.statusDraft,
  DriverAvailabilityStatus.active => l10n.statusActive,
  DriverAvailabilityStatus.paused => l10n.statusPaused,
  DriverAvailabilityStatus.filled => l10n.statusFilled,
  DriverAvailabilityStatus.departed => l10n.statusDeparted,
  DriverAvailabilityStatus.completed => l10n.statusCompleted,
  DriverAvailabilityStatus.cancelled => l10n.statusCancelled,
  DriverAvailabilityStatus.expired => l10n.statusExpired,
};

String _safeError(AppLocalizations l10n, Object error) {
  if (error is String) return error;
  if (error is CanonicalOperationBlocked ||
      error is CanonicalOperationStorageException) {
    return l10n.canonicalRecoveryRequired;
  }
  if (error is ApiException && error.message == 'transaction_retry_required') {
    return l10n.transactionRetryRequired;
  }
  if (error is ApiException &&
      (error.type == ApiErrorType.network ||
          error.type == ApiErrorType.timeout ||
          error.statusCode == 502 ||
          error.statusCode == 503)) {
    return l10n.operationTemporaryFailure;
  }
  if (error is ApiException) {
    switch (error.message) {
      case 'departure_too_soon':
        return l10n.availabilityDepartureTooSoon;
      case 'departure_too_far':
        return l10n.availabilityDepartureTooFar;
      case 'invalid_availability_window':
        return l10n.availabilityInvalidWindow;
      case 'availability_exceeds_vehicle_capacity':
        return l10n.availabilityExceedsVehicleCapacity;
      case 'driver_documents_expired':
        return l10n.availabilityDocumentsExpired;
      case 'driver_not_approved':
        return l10n.availabilityDriverNotApproved;
      case 'route_unavailable':
      case 'canonical_entry_disabled':
        return l10n.availabilityRouteNoLongerEligible;
      case 'duplicate_driver_availability':
        return l10n.availabilityDuplicate;
    }
  }
  return l10n.requestFailed;
}
