import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/masari_back_button.dart';
import '../../auth/application/auth_controller.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../canonical_routes/data/canonical_operation_storage.dart';
import '../../canonical_routes/data/canonical_route_repository.dart';
import '../../canonical_routes/domain/canonical_route_models.dart';
import '../../canonical_routes/presentation/canonical_route_widgets.dart';
import '../application/passenger_parcel_controller.dart';
import '../data/passenger_parcel_draft.dart';
import '../data/passenger_parcel_models.dart';
import '../data/passenger_parcel_repository.dart';
import 'passenger_parcel_labels.dart';

const _operation = 'passenger_parcel_create';

/// Lets a signed-in passenger send a small parcel along an approved route.
///
/// Route, stop and time selection reuse the canonical catalogue the ride
/// request uses; creation uses the same durable idempotent mutation runner so
/// a lost response can never create a second parcel.
class SendParcelScreen extends ConsumerStatefulWidget {
  const SendParcelScreen({super.key});

  @override
  ConsumerState<SendParcelScreen> createState() => _SendParcelScreenState();
}

class _SendParcelScreenState extends ConsumerState<SendParcelScreen> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _note = TextEditingController();
  PassengerParcelDraft _draft = const PassengerParcelDraft();
  DateTime _from = DateTime.now().add(const Duration(hours: 2));
  DateTime _until = DateTime.now().add(const Duration(hours: 3));
  bool _busy = false;
  Object? _error;
  CanonicalOperationBundle? _completedOperation;
  PassengerParcel? _result;

  @override
  void initState() {
    super.initState();
    Future<void>(_restorePending);
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _note.dispose();
    super.dispose();
  }

  /// Re-opens a creation whose response was lost, with the exact same values,
  /// so retrying replays the original request instead of creating another.
  Future<void> _restorePending() async {
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
        bundle?.operation != _operation ||
        bundle?.scope != 'passenger' ||
        bundle?.actorId != actorId) {
      return;
    }
    final payload = bundle!.payload;
    _name.text = payload['receiver_name'] as String? ?? '';
    _phone.text = payload['receiver_phone'] as String? ?? '';
    _note.text = payload['note'] as String? ?? '';
    setState(() {
      _draft = PassengerParcelDraft(
        routeVersionId: payload['route_version_id'] as String?,
        pickupStopId: payload['pickup_stop_id'] as String?,
        dropoffStopId: payload['dropoff_stop_id'] as String?,
        size: payload['size'] as String? ?? 'S',
        receiverName: _name.text,
        receiverPhone: _phone.text,
        note: _note.text,
        acknowledged: payload['forbidden_items_acknowledged'] == true,
      );
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
    });
  }

  void _update(PassengerParcelDraft Function(PassengerParcelDraft) change) =>
      setState(() => _draft = change(_draft));

  PassengerParcelDraft _copy({
    String? routeVersionId,
    String? pickupStopId,
    String? dropoffStopId,
    bool clearPickup = false,
    bool clearDropoff = false,
    String? size,
    bool? acknowledged,
  }) => PassengerParcelDraft(
    routeVersionId: routeVersionId ?? _draft.routeVersionId,
    pickupStopId: clearPickup ? null : pickupStopId ?? _draft.pickupStopId,
    dropoffStopId: clearDropoff ? null : dropoffStopId ?? _draft.dropoffStopId,
    size: size ?? _draft.size,
    receiverName: _name.text,
    receiverPhone: _phone.text,
    note: _note.text,
    acknowledged: acknowledged ?? _draft.acknowledged,
  );

  void _textChanged() => _update((_) => _copy());

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    if (_result != null) return _buildDone(l10n);
    return CanonicalFeatureGate(
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.sendParcelTitle),
          leading: const MasariBackButton(fallback: '/passenger'),
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
                data: (routes) => _buildForm(l10n, routes),
              ),
        ),
      ),
    );
  }

  Widget _buildDone(AppLocalizations l10n) {
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.sendParcelTitle),
        leading: const MasariBackButton(fallback: '/passenger'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(AppTokens.spaceLarge),
          children: [
            OperationStatusCard(
              title: l10n.sendParcelRecorded,
              body: l10n.sendParcelRecordedBody,
            ),
            if (_error != null) Text(_errorLabel(l10n, _error!)),
            FilledButton(
              key: const ValueKey('viewMyParcels'),
              onPressed: _acknowledgeResult,
              child: Text(l10n.myParcelsTitle),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildForm(AppLocalizations l10n, List<CanonicalRoute> routes) {
    final route = routes
        .where((value) => value.versionId == _draft.routeVersionId)
        .firstOrNull;
    final pickupStops = route == null
        ? const <CanonicalStop>[]
        : parcelPickupStops(route);
    final pickup = route?.stops
        .where((stop) => stop.id == _draft.pickupStopId)
        .firstOrNull;
    final dropoffStops = route == null || pickup == null
        ? const <CanonicalStop>[]
        : downstreamParcelStops(route, pickup);
    final theme = Theme.of(context);
    final issue = _draft.firstIssue;
    return ListView(
      padding: const EdgeInsets.all(AppTokens.spaceLarge),
      children: [
        Text(l10n.sendParcelIntro),
        const SizedBox(height: AppTokens.spaceMedium),
        for (final value in routes)
          RouteCard(
            route: value,
            selected: value.versionId == route?.versionId,
            onTap: _busy
                ? null
                : () => _update(
                    (_) => PassengerParcelDraft(
                      routeVersionId: value.versionId,
                      size: _draft.size,
                      receiverName: _name.text,
                      receiverPhone: _phone.text,
                      note: _note.text,
                      acknowledged: _draft.acknowledged,
                    ),
                  ),
          ),
        if (route != null) ...[
          OrderedStopTimeline(
            stops: route.stops,
            selectedIds: {
              _draft.pickupStopId,
              _draft.dropoffStopId,
            }.whereType<String>().toSet(),
          ),
          _StopDropdown(
            fieldKey: const ValueKey('parcelPickupStop'),
            label: l10n.pickupStop,
            stops: pickupStops,
            value: _draft.pickupStopId,
            onChanged: _busy
                ? null
                : (value) => _update(
                    (_) => _copy(pickupStopId: value, clearDropoff: true),
                  ),
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: AppTokens.spaceSmall),
            child: Text(
              l10n.sendParcelPickupHint,
              style: theme.textTheme.bodySmall,
            ),
          ),
          _StopDropdown(
            fieldKey: const ValueKey('parcelDropoffStop'),
            label: l10n.dropoffStop,
            stops: dropoffStops,
            value: _draft.dropoffStopId,
            onChanged: _busy
                ? null
                : (value) => _update((_) => _copy(dropoffStopId: value)),
          ),
          ListTile(
            minTileHeight: 56,
            title: Text(l10n.departureFrom),
            subtitle: Text(dateTimeLabel(context, _from)),
            trailing: const Icon(Icons.calendar_today),
            onTap: _busy ? null : () => _choose(from: true),
          ),
          ListTile(
            minTileHeight: 56,
            title: Text(l10n.departureUntil),
            subtitle: Text(dateTimeLabel(context, _until)),
            trailing: const Icon(Icons.calendar_today),
            onTap: _busy ? null : () => _choose(from: false),
          ),
        ],
        const SizedBox(height: AppTokens.spaceSmall),
        Text(l10n.parcelSize, style: theme.textTheme.titleSmall),
        const SizedBox(height: AppTokens.spaceSmall),
        SegmentedButton<String>(
          key: const ValueKey('parcelSize'),
          segments: const [
            ButtonSegment(value: 'S', label: Text('S')),
            ButtonSegment(value: 'M', label: Text('M')),
          ],
          selected: {_draft.size},
          onSelectionChanged: _busy
              ? null
              : (value) => _update((_) => _copy(size: value.first)),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppTokens.spaceSmall),
          child: Text(
            _draft.size == 'S'
                ? l10n.parcelSizeSmallHint
                : l10n.parcelSizeMediumHint,
            style: theme.textTheme.bodySmall,
          ),
        ),
        Text(l10n.parcelSizeLargeNotAllowed, style: theme.textTheme.bodySmall),
        const SizedBox(height: AppTokens.spaceMedium),
        TextField(
          key: const ValueKey('receiverName'),
          controller: _name,
          enabled: !_busy,
          maxLength: PassengerParcelLimits.receiverNameMaxLength,
          textInputAction: TextInputAction.next,
          decoration: InputDecoration(labelText: l10n.receiverNameLabel),
          onChanged: (_) => _textChanged(),
        ),
        TextField(
          key: const ValueKey('receiverPhone'),
          controller: _phone,
          enabled: !_busy,
          keyboardType: TextInputType.phone,
          textInputAction: TextInputAction.next,
          decoration: InputDecoration(labelText: l10n.receiverPhoneLabel),
          onChanged: (_) => _textChanged(),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppTokens.spaceSmall),
          child: Text(
            l10n.receiverPrivacyNote,
            style: theme.textTheme.bodySmall,
          ),
        ),
        TextField(
          key: const ValueKey('parcelNote'),
          controller: _note,
          enabled: !_busy,
          maxLength: PassengerParcelLimits.noteMaxLength,
          maxLines: 2,
          decoration: InputDecoration(labelText: l10n.parcelNoteLabel),
          onChanged: (_) => _textChanged(),
        ),
        CheckboxListTile(
          key: const ValueKey('forbiddenItemsAck'),
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          value: _draft.acknowledged,
          onChanged: _busy
              ? null
              : (value) => _update((_) => _copy(acknowledged: value ?? false)),
          title: Text(l10n.forbiddenItemsAck),
        ),
        if (_error != null) Text(_errorLabel(l10n, _error!)),
        const SizedBox(height: AppTokens.spaceLarge),
        FilledButton(
          key: const ValueKey('submitPassengerParcel'),
          onPressed: issue != null || _busy ? null : _submit,
          child: _busy
              ? const SizedBox.square(
                  dimension: 24,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(l10n.sendParcelSubmit),
        ),
      ],
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
    if (_busy || !_draft.isValid) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final payload = _draft.toPayload(
      departureFrom: _from,
      departureUntil: _until,
    );
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
          .run<PassengerParcel>(
            operation: _operation,
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
                  .requireFreshRoute(_draft.routeVersionId!);
            },
            send: (bundle) => ref
                .read(passengerParcelRepositoryProvider)
                .create(
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
    final completed = _completedOperation;
    if (actorId == null || completed == null || completed.actorId != actorId) {
      return;
    }
    try {
      await ref
          .read(canonicalMutationRunnerProvider)
          .acknowledge(
            actorId: actorId,
            operation: _operation,
            idempotencyKey: completed.idempotencyKey,
          );
      ref.invalidate(passengerParcelsProvider);
      if (mounted) context.go('/passenger/parcels');
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  String _errorLabel(AppLocalizations l10n, Object error) {
    if (error is CanonicalOperationBlocked ||
        error is CanonicalOperationStorageException) {
      return l10n.canonicalRecoveryRequired;
    }
    if (error is ApiException) {
      if (error.message == 'transaction_retry_required') {
        return l10n.transactionRetryRequired;
      }
      if (error.type == ApiErrorType.network ||
          error.type == ApiErrorType.timeout ||
          error.statusCode == 502 ||
          error.statusCode == 503) {
        return l10n.operationTemporaryFailure;
      }
      return parcelErrorLabel(l10n, error.message, error.statusCode);
    }
    return l10n.requestFailed;
  }
}

class _StopDropdown extends StatelessWidget {
  const _StopDropdown({
    required this.fieldKey,
    required this.label,
    required this.stops,
    required this.value,
    required this.onChanged,
  });
  final Key fieldKey;
  final String label;
  final List<CanonicalStop> stops;
  final String? value;
  final ValueChanged<String?>? onChanged;

  @override
  Widget build(BuildContext context) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    return DropdownButtonFormField<String>(
      key: fieldKey,
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
