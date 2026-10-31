import '../../../core/widgets/masari_back_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_tokens.dart';
import '../../auth/application/auth_controller.dart';
import '../application/canonical_route_controller.dart';
import '../data/canonical_operation_storage.dart';
import '../data/canonical_route_repository.dart';
import '../domain/canonical_route_models.dart';
import 'canonical_route_widgets.dart';

class PassengerRouteRequestScreen extends ConsumerStatefulWidget {
  const PassengerRouteRequestScreen({super.key});

  @override
  ConsumerState<PassengerRouteRequestScreen> createState() =>
      _PassengerRouteRequestScreenState();
}

class _PassengerRouteRequestScreenState
    extends ConsumerState<PassengerRouteRequestScreen> {
  String? _routeVersionId;
  String? _pickupId;
  String? _dropoffId;
  DateTime _from = DateTime.now().add(const Duration(hours: 2));
  DateTime _until = DateTime.now().add(const Duration(hours: 3));
  int _passengers = 1;
  bool _busy = false;
  Object? _error;
  CanonicalOperationBundle? _completedOperation;
  CanonicalPassengerRequest? _result;

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
          bundle?.operation != 'passenger_route_request_create' ||
          bundle?.scope != 'passenger' ||
          bundle?.actorId != actorId) {
        return;
      }
      final payload = bundle!.payload;
      setState(() {
        _routeVersionId = payload['route_version_id'] as String?;
        _pickupId = payload['pickup_stop_id'] as String?;
        _dropoffId = payload['dropoff_stop_id'] as String?;
        _from =
            DateTime.tryParse(
              payload['requested_departure_from'] as String? ?? '',
            )?.toLocal() ??
            _from;
        _until =
            DateTime.tryParse(
              payload['requested_departure_until'] as String? ?? '',
            )?.toLocal() ??
            _until;
        _passengers = payload['passenger_count'] as int? ?? _passengers;
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    if (_result != null) {
      return Scaffold(
        appBar: AppBar(
          title: Text(l10n.canonicalPassengerRequest),
          leading: const MasariBackButton(fallback: '/passenger'),
        ),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(AppTokens.spaceLarge),
            children: [
              OperationStatusCard(
                title: l10n.requestRecorded,
                body: l10n.matchingDisabledNotice,
              ),
              fareSnapshotBox(
                context,
                _result!.fare,
                passengers: _result!.passengerCount,
              ),
              if (_error != null) Text(_errorLabel(l10n, _error!)),
              FilledButton(
                onPressed: _acknowledgeResult,
                child: Text(l10n.returnToDashboard),
              ),
            ],
          ),
        ),
      );
    }
    return CanonicalFeatureGate(
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.canonicalPassengerRequest),
          leading: const MasariBackButton(fallback: '/passenger'),
        ),
        body: SafeArea(
          child: ref
              .watch(canonicalRouteCatalogProvider)
              .when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (_, _) => _CatalogError(
                  retry: () => ref
                      .read(canonicalRouteCatalogProvider.notifier)
                      .refresh(),
                ),
                data: (routes) {
                  final route = routes
                      .where((value) => value.versionId == _routeVersionId)
                      .firstOrNull;
                  if (_routeVersionId != null && route == null) {
                    _routeVersionId = null;
                    _pickupId = null;
                    _dropoffId = null;
                  }
                  final pickupStops = route == null
                      ? const <CanonicalStop>[]
                      : passengerPickupStops(route);
                  final pickup = route?.stops
                      .where((stop) => stop.id == _pickupId)
                      .firstOrNull;
                  final dropoffStops = route == null || pickup == null
                      ? const <CanonicalStop>[]
                      : downstreamPassengerStops(route, pickup);
                  if (_dropoffId != null &&
                      !dropoffStops.any((stop) => stop.id == _dropoffId)) {
                    _dropoffId = null;
                  }
                  return ListView(
                    padding: const EdgeInsets.all(AppTokens.spaceLarge),
                    children: [
                      Text(l10n.canonicalPassengerRequestBody),
                      const SizedBox(height: AppTokens.spaceMedium),
                      for (final value in routes)
                        RouteCard(
                          route: value,
                          selected: value.versionId == route?.versionId,
                          onTap: _busy
                              ? null
                              : () => setState(() {
                                  _routeVersionId = value.versionId;
                                  _pickupId = null;
                                  _dropoffId = null;
                                }),
                        ),
                      if (route != null) ...[
                        OrderedStopTimeline(
                          stops: route.stops,
                          selectedIds: {
                            _pickupId,
                            _dropoffId,
                          }.whereType<String>().toSet(),
                        ),
                        _StopDropdown(
                          label: l10n.pickupStop,
                          stops: pickupStops,
                          value: _pickupId,
                          onChanged: _busy
                              ? null
                              : (value) => setState(() {
                                  _pickupId = value;
                                  _dropoffId = null;
                                }),
                        ),
                        _StopDropdown(
                          label: l10n.dropoffStop,
                          stops: dropoffStops,
                          value: _dropoffId,
                          onChanged: _busy
                              ? null
                              : (value) => setState(() => _dropoffId = value),
                        ),
                        _TimeButton(
                          label: l10n.departureFrom,
                          value: _from,
                          onPressed: _busy ? null : () => _choose(from: true),
                        ),
                        _TimeButton(
                          label: l10n.departureUntil,
                          value: _until,
                          onPressed: _busy ? null : () => _choose(from: false),
                        ),
                        Row(
                          children: [
                            Expanded(child: Text(l10n.passengerCount)),
                            IconButton(
                              onPressed: !_busy && _passengers > 1
                                  ? () => setState(() => _passengers--)
                                  : null,
                              icon: const Icon(Icons.remove),
                            ),
                            Text('$_passengers'),
                            IconButton(
                              onPressed: !_busy && _passengers < 8
                                  ? () => setState(() => _passengers++)
                                  : null,
                              icon: const Icon(Icons.add),
                            ),
                          ],
                        ),
                        passengerFareEstimate(
                          context,
                          route.fares,
                          _passengers,
                        ),
                      ],
                      if (_error != null) Text(_errorLabel(l10n, _error!)),
                      const SizedBox(height: AppTokens.spaceLarge),
                      FilledButton(
                        key: const ValueKey('submitCanonicalPassengerRequest'),
                        onPressed:
                            route == null ||
                                _pickupId == null ||
                                _dropoffId == null ||
                                _busy
                            ? null
                            : _submit,
                        child: _busy
                            ? const SizedBox.square(
                                dimension: 24,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : Text(l10n.submitRequest),
                      ),
                    ],
                  );
                },
              ),
        ),
      ),
    );
  }

  Future<void> _choose({required bool from}) async {
    final value = await pickFutureDateTime(context, from ? _from : _until);
    if (value != null) {
      setState(() {
        if (from) {
          _from = value;
        } else {
          _until = value;
        }
      });
    }
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final payload = <String, dynamic>{
      'route_version_id': _routeVersionId,
      'pickup_stop_id': _pickupId,
      'dropoff_stop_id': _dropoffId,
      'requested_departure_from': _from.toUtc().toIso8601String(),
      'requested_departure_until': _until.toUtc().toIso8601String(),
      'passenger_count': _passengers,
    };
    try {
      final actorId = ref.read(authControllerProvider).value?.user?.id;
      if (actorId == null) {
        throw const ApiException(
          ApiErrorType.unauthorized,
          'account_unavailable',
          statusCode: 401,
        );
      }
      // A fresh catalog result above is required before this operation can run.
      final result = await ref
          .read(canonicalMutationRunnerProvider)
          .run<CanonicalPassengerRequest>(
            operation: 'passenger_route_request_create',
            scope: 'passenger',
            allowExpiredReplay: true,
            onBundle: (bundle) => _completedOperation = bundle,
            actorId: actorId,
            payload: payload,
            preflight: () async {
              if (!_from.isAfter(DateTime.now()) || !_until.isAfter(_from)) {
                throw const ApiException(
                  ApiErrorType.validation,
                  'invalid_departure_window',
                  statusCode: 400,
                );
              }
              await ref
                  .read(canonicalRouteRepositoryProvider)
                  .requireFreshRoute(_routeVersionId!);
            },
            send: (bundle) => ref
                .read(canonicalRouteRepositoryProvider)
                .createPassengerRequest(
                  payload: bundle.payload,
                  idempotencyKey: bundle.idempotencyKey,
                ),
          );
      if (mounted) setState(() => _result = result);
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

  Future<void> _acknowledgeResult() async {
    final actorId = ref.read(authControllerProvider).value?.user?.id;
    if (actorId == null) return;
    final completed = _completedOperation;
    if (completed == null || completed.actorId != actorId) return;
    try {
      await ref
          .read(canonicalMutationRunnerProvider)
          .acknowledge(
            actorId: actorId,
            operation: 'passenger_route_request_create',
            idempotencyKey: completed.idempotencyKey,
          );
      if (mounted) context.go('/passenger');
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }
}

class _StopDropdown extends StatelessWidget {
  const _StopDropdown({
    required this.label,
    required this.stops,
    required this.value,
    required this.onChanged,
  });
  final String label;
  final List<CanonicalStop> stops;
  final String? value;
  final ValueChanged<String?>? onChanged;

  @override
  Widget build(BuildContext context) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    return DropdownButtonFormField<String>(
      initialValue: stops.any((stop) => stop.id == value) ? value : null,
      decoration: InputDecoration(labelText: label),
      items: [
        for (final stop in stops)
          DropdownMenuItem(
            value: stop.id,
            child: Text(
              arabic ? stop.nameAr : stop.nameEn,
              overflow: TextOverflow.ellipsis,
            ),
          ),
      ],
      onChanged: onChanged,
    );
  }
}

class _TimeButton extends StatelessWidget {
  const _TimeButton({
    required this.label,
    required this.value,
    required this.onPressed,
  });
  final String label;
  final DateTime value;
  final VoidCallback? onPressed;
  @override
  Widget build(BuildContext context) => ListTile(
    minTileHeight: 56,
    title: Text(label),
    subtitle: Text(dateTimeLabel(context, value)),
    trailing: const Icon(Icons.calendar_today),
    onTap: onPressed,
  );
}

class _CatalogError extends StatelessWidget {
  const _CatalogError({required this.retry});
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(AppLocalizations.of(context).routeCatalogUnavailable),
        FilledButton(
          onPressed: retry,
          child: Text(AppLocalizations.of(context).refreshRoutes),
        ),
      ],
    ),
  );
}

String _errorLabel(AppLocalizations l10n, Object error) {
  if (error is ApiException && error.message == 'invalid_departure_window') {
    return l10n.invalidDepartureWindow;
  }
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
  return l10n.requestFailed;
}
