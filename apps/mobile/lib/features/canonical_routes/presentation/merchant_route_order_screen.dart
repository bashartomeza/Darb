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

class MerchantRouteOrderScreen extends ConsumerStatefulWidget {
  const MerchantRouteOrderScreen({super.key});

  @override
  ConsumerState<MerchantRouteOrderScreen> createState() =>
      _MerchantRouteOrderScreenState();
}

class _MerchantRouteOrderScreenState
    extends ConsumerState<MerchantRouteOrderScreen> {
  String? _routeVersionId;
  String? _pickupId;
  DateTime _from = DateTime.now().add(const Duration(hours: 2));
  DateTime _until = DateTime.now().add(const Duration(hours: 3));
  final List<_ParcelDraft> _parcels = [_ParcelDraft()];
  bool _busy = false;
  Object? _error;
  CanonicalOperationBundle? _completedOperation;
  CanonicalMerchantOrder? _result;

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
          bundle?.operation != 'merchant_route_order_create' ||
          bundle?.scope != 'merchant' ||
          bundle?.actorId != actorId) {
        return;
      }
      final payload = bundle!.payload;
      final parcels = payload['parcels'];
      if (parcels is! List) return;
      setState(() {
        _routeVersionId = payload['route_version_id'] as String?;
        _pickupId = payload['pickup_stop_id'] as String?;
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
        _parcels
          ..clear()
          ..addAll(
            parcels.whereType<Map<String, dynamic>>().map(
              (value) => _ParcelDraft(
                destinationStopId: value['destination_stop_id'] as String?,
                size: value['size'] as String? ?? 'S',
                priority: value['priority'] as String? ?? 'normal',
              ),
            ),
          );
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    if (_result != null) {
      return Scaffold(
        appBar: AppBar(
          title: Text(l10n.canonicalMerchantOrder),
          leading: const MasariBackButton(fallback: '/merchant'),
        ),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(AppTokens.spaceLarge),
            children: [
              OperationStatusCard(
                title: l10n.orderRecorded,
                body: l10n.batchingMatchingDisabledNotice,
              ),
              fareSnapshotBox(context, _result!.fare),
              if (_error != null) Text(_merchantError(l10n, _error!)),
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
          title: Text(l10n.canonicalMerchantOrder),
          leading: const MasariBackButton(fallback: '/merchant'),
        ),
        body: SafeArea(
          child: ref
              .watch(canonicalRouteCatalogProvider)
              .when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (_, _) => Center(
                  child: FilledButton(
                    onPressed: () => ref
                        .read(canonicalRouteCatalogProvider.notifier)
                        .refresh(),
                    child: Text(l10n.refreshRoutes),
                  ),
                ),
                data: (routes) {
                  final route = routes
                      .where((value) => value.versionId == _routeVersionId)
                      .firstOrNull;
                  if (_routeVersionId != null && route == null) {
                    _routeVersionId = null;
                    _pickupId = null;
                  }
                  final pickups = route == null
                      ? const <CanonicalStop>[]
                      : parcelPickupStops(route);
                  final pickup = route?.stops
                      .where((stop) => stop.id == _pickupId)
                      .firstOrNull;
                  final destinations = route == null || pickup == null
                      ? const <CanonicalStop>[]
                      : downstreamParcelStops(route, pickup);
                  for (final parcel in _parcels) {
                    if (!destinations.any(
                      (stop) => stop.id == parcel.destinationStopId,
                    )) {
                      parcel.destinationStopId = null;
                    }
                  }
                  return ListView(
                    padding: const EdgeInsets.all(AppTokens.spaceLarge),
                    children: [
                      Text(l10n.canonicalMerchantOrderBody),
                      for (final value in routes)
                        RouteCard(
                          route: value,
                          selected: route?.versionId == value.versionId,
                          onTap: _busy
                              ? null
                              : () => setState(() {
                                  _routeVersionId = value.versionId;
                                  _pickupId = null;
                                  for (final parcel in _parcels) {
                                    parcel.destinationStopId = null;
                                  }
                                }),
                        ),
                      if (route != null) ...[
                        OrderedStopTimeline(
                          stops: route.stops,
                          selectedIds: {
                            _pickupId,
                            ..._parcels.map(
                              (parcel) => parcel.destinationStopId,
                            ),
                          }.whereType<String>().toSet(),
                        ),
                        _Dropdown(
                          label: l10n.parcelPickupStop,
                          value: _pickupId,
                          options: {
                            for (final stop in pickups)
                              stop.id: _stopName(context, stop),
                          },
                          onChanged: _busy
                              ? null
                              : (value) => setState(() {
                                  _pickupId = value;
                                  for (final parcel in _parcels) {
                                    parcel.destinationStopId = null;
                                  }
                                }),
                        ),
                        _TimeTile(
                          label: l10n.departureFrom,
                          value: _from,
                          onTap: _busy ? null : () => _choose(from: true),
                        ),
                        _TimeTile(
                          label: l10n.departureUntil,
                          value: _until,
                          onTap: _busy ? null : () => _choose(from: false),
                        ),
                        for (var index = 0; index < _parcels.length; index++)
                          Card(
                            child: Padding(
                              padding: const EdgeInsets.all(
                                AppTokens.spaceMedium,
                              ),
                              child: Column(
                                children: [
                                  _Dropdown(
                                    label:
                                        '${l10n.parcelDestination} ${index + 1}',
                                    value: _parcels[index].destinationStopId,
                                    options: {
                                      for (final stop in destinations)
                                        stop.id: _stopName(context, stop),
                                    },
                                    onChanged: _busy
                                        ? null
                                        : (value) => setState(
                                            () =>
                                                _parcels[index]
                                                        .destinationStopId =
                                                    value,
                                          ),
                                  ),
                                  _Dropdown(
                                    label: l10n.parcelSize,
                                    value: _parcels[index].size,
                                    options: const {
                                      'S': 'S',
                                      'M': 'M',
                                      'L': 'L',
                                    },
                                    onChanged: _busy
                                        ? null
                                        : (value) => setState(
                                            () => _parcels[index].size =
                                                value ?? 'S',
                                          ),
                                  ),
                                  _Dropdown(
                                    label: l10n.parcelPriority,
                                    value: _parcels[index].priority,
                                    options: {
                                      'low': l10n.priorityLow,
                                      'normal': l10n.priorityNormal,
                                      'high': l10n.priorityHigh,
                                    },
                                    onChanged: _busy
                                        ? null
                                        : (value) => setState(
                                            () => _parcels[index].priority =
                                                value ?? 'normal',
                                          ),
                                  ),
                                  if (_parcels.length > 1)
                                    TextButton.icon(
                                      onPressed: _busy
                                          ? null
                                          : () => setState(
                                              () => _parcels.removeAt(index),
                                            ),
                                      icon: const Icon(Icons.delete_outline),
                                      label: Text(l10n.removeParcel),
                                    ),
                                ],
                              ),
                            ),
                          ),
                        parcelFareEstimate(context, route.fares, [
                          for (final parcel in _parcels) parcel.size,
                        ]),
                        OutlinedButton.icon(
                          key: const ValueKey('addCanonicalParcel'),
                          onPressed: !_busy && _parcels.length < 50
                              ? () =>
                                    setState(() => _parcels.add(_ParcelDraft()))
                              : null,
                          icon: const Icon(Icons.add),
                          label: Text(
                            '${l10n.addParcel} (${_parcels.length}/50)',
                          ),
                        ),
                      ],
                      if (_error != null) Text(_merchantError(l10n, _error!)),
                      const SizedBox(height: AppTokens.spaceLarge),
                      FilledButton(
                        key: const ValueKey('submitCanonicalMerchantOrder'),
                        onPressed:
                            route == null ||
                                _pickupId == null ||
                                _parcels.isEmpty ||
                                _parcels.any(
                                  (parcel) => parcel.destinationStopId == null,
                                ) ||
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
                            : Text(l10n.submitOrder),
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
    if (value == null) return;
    setState(() {
      if (from) {
        _from = value;
      } else {
        _until = value;
      }
    });
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
      'requested_departure_from': _from.toUtc().toIso8601String(),
      'requested_departure_until': _until.toUtc().toIso8601String(),
      'parcels': [
        for (final parcel in _parcels)
          CanonicalParcelInput(
            destinationStopId: parcel.destinationStopId!,
            size: parcel.size,
            priority: parcel.priority,
          ).toJson(),
      ],
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
      final result = await ref
          .read(canonicalMutationRunnerProvider)
          .run<CanonicalMerchantOrder>(
            operation: 'merchant_route_order_create',
            scope: 'merchant',
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
                .createMerchantOrder(
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
            operation: 'merchant_route_order_create',
            idempotencyKey: completed.idempotencyKey,
          );
      if (mounted) context.go('/merchant');
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }
}

class _ParcelDraft {
  _ParcelDraft({
    this.destinationStopId,
    this.size = 'S',
    this.priority = 'normal',
  });
  String? destinationStopId;
  String size;
  String priority;
}

class _Dropdown extends StatelessWidget {
  const _Dropdown({
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
  });
  final String label;
  final String? value;
  final Map<String, String> options;
  final ValueChanged<String?>? onChanged;
  @override
  Widget build(BuildContext context) => DropdownButtonFormField<String>(
    initialValue: options.containsKey(value) ? value : null,
    decoration: InputDecoration(labelText: label),
    isExpanded: true,
    items: [
      for (final entry in options.entries)
        DropdownMenuItem(
          value: entry.key,
          child: Text(entry.value, overflow: TextOverflow.ellipsis),
        ),
    ],
    onChanged: onChanged,
  );
}

class _TimeTile extends StatelessWidget {
  const _TimeTile({
    required this.label,
    required this.value,
    required this.onTap,
  });
  final String label;
  final DateTime value;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => ListTile(
    minTileHeight: 56,
    title: Text(label),
    subtitle: Text(dateTimeLabel(context, value)),
    trailing: const Icon(Icons.calendar_today),
    onTap: onTap,
  );
}

String _stopName(BuildContext context, CanonicalStop stop) =>
    Localizations.localeOf(context).languageCode == 'ar'
    ? stop.nameAr
    : stop.nameEn;

String _merchantError(AppLocalizations l10n, Object error) {
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
