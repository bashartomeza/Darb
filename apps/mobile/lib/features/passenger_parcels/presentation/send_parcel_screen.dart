import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/darb_back_button.dart';
import '../../../core/widgets/darb_card.dart';
import '../../../core/widgets/discard_saved_request_button.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/data/token_storage.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../canonical_routes/data/canonical_operation_storage.dart';
import '../../canonical_routes/presentation/canonical_route_widgets.dart';
import '../../delivery_handover/data/delivery_handover_models.dart';
import '../../delivery_handover/presentation/handover_code_card.dart';
import '../../operating_routes/data/operating_route_repository.dart';
import '../../operating_routes/presentation/operating_route_inputs.dart';
import '../application/passenger_parcel_controller.dart';
import '../data/passenger_parcel_draft.dart';
import '../data/passenger_parcel_models.dart';
import '../data/passenger_parcel_repository.dart';
import 'passenger_parcel_labels.dart';

const _operation = 'passenger_parcel_create';

/// Only for the storage format of the pending create; never sent.
const _storageSentinel = 'passenger_parcel_route';

/// The durable create of a passenger parcel, kept apart from other pending
/// operations so a lost response is replayed with the same key and body.
final passengerParcelMutationRunnerProvider = Provider<CanonicalMutationRunner>(
  (ref) => CanonicalMutationRunner(
    storage: CanonicalOperationStorage(
      ref.watch(secureStorageProvider),
      storageKey: 'darb_passenger_parcel_create_v2',
    ),
  ),
);

/// Lets a signed-in passenger send a small parcel along one of the predefined
/// routes: the route, where the driver collects it and where it goes (typed
/// as text), a preferred time, the size and the receiver.
///
/// Creation uses the durable idempotent mutation runner, so a lost response
/// can never create a second parcel.
class SendParcelScreen extends ConsumerStatefulWidget {
  const SendParcelScreen({super.key});

  @override
  ConsumerState<SendParcelScreen> createState() => _SendParcelScreenState();
}

class _SendParcelScreenState extends ConsumerState<SendParcelScreen> {
  final _pickup = TextEditingController();
  final _dropoff = TextEditingController();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _note = TextEditingController();
  PassengerParcelDraft _draft = const PassengerParcelDraft();
  DateTime _preferredTime = DateTime.now().add(const Duration(hours: 2));
  bool _busy = false;
  bool _showErrors = false;
  Object? _error;
  CanonicalOperationBundle? _completedOperation;
  PassengerParcel? _result;

  /// A saved, unconfirmed create is kept on this device.
  bool _savedPending = false;

  @override
  void initState() {
    super.initState();
    Future<void>(_restorePending);
  }

  @override
  void dispose() {
    _pickup.dispose();
    _dropoff.dispose();
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
      bundle = await ref
          .read(passengerParcelMutationRunnerProvider)
          .storage
          .read();
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error;
          _savedPending = true;
        });
      }
      return;
    }
    if (mounted && bundle != null) setState(() => _savedPending = true);
    if (!mounted ||
        bundle?.operation != _operation ||
        bundle?.scope != 'passenger' ||
        bundle?.actorId != actorId) {
      return;
    }
    final payload = bundle!.payload;
    final draft = PassengerParcelDraft.fromPayload(payload);
    _pickup.text = draft.pickupDetails;
    _dropoff.text = draft.dropoffDetails;
    _name.text = draft.receiverName;
    _phone.text = draft.receiverPhone;
    _note.text = draft.note;
    setState(() {
      _draft = draft;
      _preferredTime =
          DateTime.tryParse(
            payload['preferred_time'] as String? ?? '',
          )?.toLocal() ??
          _preferredTime;
    });
  }

  void _update(PassengerParcelDraft Function(PassengerParcelDraft) change) =>
      setState(() => _draft = change(_draft));

  void _textChanged() => _update(
    (draft) => draft.copyWith(
      pickupDetails: _pickup.text,
      dropoffDetails: _dropoff.text,
      receiverName: _name.text,
      receiverPhone: _phone.text,
      note: _note.text,
    ),
  );

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    if (_result case final result?) return _buildDone(l10n, result);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.sendParcelTitle),
        leading: const DarbBackButton(fallback: '/passenger'),
      ),
      body: SafeArea(child: _buildForm(l10n)),
    );
  }

  Widget _buildDone(AppLocalizations l10n, PassengerParcel parcel) {
    final code = parcel.handoverCode;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.sendParcelTitle),
        leading: const DarbBackButton(fallback: '/passenger'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(AppTokens.spaceLarge),
          children: [
            OperationStatusCard(
              title: l10n.sendParcelRecorded,
              body: l10n.sendParcelRecordedBody,
            ),
            const SizedBox(height: AppTokens.spaceMedium),
            if (code != null) ...[
              Text(
                l10n.sendParcelHandoverCodeIntro,
                key: const ValueKey('sendParcelHandoverIntro'),
              ),
              const SizedBox(height: AppTokens.spaceSmall),
            ],
            // The code from the create response lives only in this screen's
            // state. A replayed create carries none, so the card then loads the
            // handover state and offers a new code instead.
            HandoverCodeCard(
              orderId: parcel.id,
              keepInSession: false,
              initial: code == null
                  ? null
                  : HandoverStatus(
                      issued: true,
                      confirmed: false,
                      locked: false,
                      expired: false,
                      attemptsRemaining: handoverCodeMaxAttempts,
                      code: code,
                    ),
            ),
            const SizedBox(height: AppTokens.spaceMedium),
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

  Widget _buildForm(AppLocalizations l10n) {
    final theme = Theme.of(context);
    final issue = _draft.firstIssue;
    String? fieldError(ParcelFormIssue field, String? message) =>
        _showErrors && issue == field ? message : null;
    return ListView(
      padding: const EdgeInsets.all(AppTokens.spaceLarge),
      children: [
        Text(l10n.passengerParcelRouteIntro),
        const SizedBox(height: AppTokens.spaceMedium),
        DarbCard(
          padding: const EdgeInsets.all(AppTokens.spaceMedium),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              OperatingRouteDropdown(
                fieldKey: const ValueKey('parcelRouteField'),
                value: _draft.serviceRouteId,
                enabled: !_busy,
                errorText: _showErrors && _draft.serviceRouteId == null
                    ? l10n.passengerRouteRequired
                    : null,
                onChanged: (route) => _update(
                  (draft) => draft.copyWith(serviceRouteId: route.id),
                ),
              ),
              const SizedBox(height: AppTokens.spaceMedium),
              RouteDetailsField(
                key: const ValueKey('parcelPickupDetails'),
                controller: _pickup,
                enabled: !_busy,
                icon: Icons.trip_origin_rounded,
                label: l10n.passengerParcelPickupDetailsLabel,
                hint: l10n.passengerParcelPickupDetailsHint,
                errorText: _showErrors
                    ? routeDetailsError(l10n, _pickup.text)
                    : null,
                onChanged: (_) => _textChanged(),
              ),
              const SizedBox(height: AppTokens.spaceSmall),
              RouteDetailsField(
                key: const ValueKey('parcelDropoffDetails'),
                controller: _dropoff,
                enabled: !_busy,
                icon: Icons.location_on_outlined,
                label: l10n.passengerParcelDropoffDetailsLabel,
                hint: l10n.passengerParcelDropoffDetailsHint,
                errorText: _showErrors
                    ? routeDetailsError(l10n, _dropoff.text)
                    : null,
                onChanged: (_) => _textChanged(),
              ),
              ListTile(
                key: const ValueKey('parcelPreferredTime'),
                contentPadding: EdgeInsets.zero,
                minTileHeight: 56,
                leading: const Icon(Icons.schedule_rounded),
                title: Text(l10n.passengerParcelPreferredTime),
                subtitle: Text(dateTimeLabel(context, _preferredTime)),
                trailing: const Icon(Icons.calendar_today),
                onTap: _busy ? null : _chooseTime,
              ),
            ],
          ),
        ),
        const SizedBox(height: AppTokens.spaceMedium),
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
              : (value) =>
                    _update((draft) => draft.copyWith(size: value.first)),
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
        // The route's default price for this size; the driver who takes the
        // parcel may charge their own inside the admin's range.
        if (ref
                .watch(operatingRoutesProvider)
                .value
                ?.where((route) => route.id == _draft.serviceRouteId)
                .firstOrNull
            case final route?)
          KeyedSubtree(
            key: const ValueKey('parcelRouteFare'),
            child: parcelFareEstimate(context, route.fares, [_draft.size]),
          ),
        const SizedBox(height: AppTokens.spaceMedium),
        TextField(
          key: const ValueKey('receiverName'),
          controller: _name,
          enabled: !_busy,
          maxLength: PassengerParcelLimits.receiverNameMaxLength,
          textInputAction: TextInputAction.next,
          decoration: InputDecoration(
            labelText: l10n.receiverNameLabel,
            errorText: fieldError(
              ParcelFormIssue.receiverName,
              l10n.receiverNameInvalid,
            ),
          ),
          onChanged: (_) => _textChanged(),
        ),
        TextField(
          key: const ValueKey('receiverPhone'),
          controller: _phone,
          enabled: !_busy,
          keyboardType: TextInputType.phone,
          textInputAction: TextInputAction.next,
          decoration: InputDecoration(
            labelText: l10n.receiverPhoneLabel,
            errorText: fieldError(
              ParcelFormIssue.receiverPhone,
              l10n.invalidReceiverPhone,
            ),
          ),
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
              : (value) => _update(
                  (draft) => draft.copyWith(acknowledged: value ?? false),
                ),
          title: Text(l10n.forbiddenItemsAck),
          subtitle:
              fieldError(
                    ParcelFormIssue.acknowledgement,
                    l10n.parcelAckRequired,
                  ) ==
                  null
              ? null
              : Text(
                  l10n.parcelAckRequired,
                  style: TextStyle(color: theme.colorScheme.error),
                ),
        ),
        if (_error != null) Text(_errorLabel(l10n, _error!)),
        if (_savedPending)
          DiscardSavedRequestButton(enabled: !_busy, onDiscard: _discard),
        const SizedBox(height: AppTokens.spaceLarge),
        FilledButton(
          key: const ValueKey('submitPassengerParcel'),
          onPressed: _busy
              ? null
              : issue != null
              ? () => setState(() => _showErrors = true)
              : _submit,
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

  Future<void> _chooseTime() async {
    final value = await pickFutureDateTime(context, _preferredTime);
    if (value != null) setState(() => _preferredTime = value);
  }

  Future<void> _submit() async {
    if (_busy || !_draft.isValid) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final payload = {
      ..._draft.toPayload(preferredTime: _preferredTime),
      'route_version_id': _storageSentinel,
    };
    // Read up front so the create is settled even if the screen is left
    // while it is in flight.
    final runner = ref.read(passengerParcelMutationRunnerProvider);
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
          .read(passengerParcelMutationRunnerProvider)
          .run<PassengerParcel>(
            operation: _operation,
            scope: 'passenger',
            allowExpiredReplay: true,
            onBundle: (bundle) => _completedOperation = bundle,
            actorId: actorId,
            payload: payload,
            preflight: () async {
              if (!_preferredTime.isAfter(DateTime.now())) {
                throw const ApiException(
                  ApiErrorType.validation,
                  'invalid_departure_window',
                  statusCode: 400,
                );
              }
            },
            send: (bundle) => ref
                .read(passengerParcelRepositoryProvider)
                .create(
                  payload: Map<String, dynamic>.from(bundle.payload)
                    ..remove('route_version_id'),
                  idempotencyKey: bundle.idempotencyKey,
                ),
          );
      if (mounted) {
        setState(() {
          _result = result;
          _savedPending = false;
        });
      }
      // The parcel is saved: settle it now, so leaving this screen any way
      // never leaves it to be pre-filled and replayed next time.
      await _settleCompleted(runner, actorId);
    } catch (error) {
      if (error is ApiException && error.message == 'route_unavailable') {
        // Turned off since the list was read: nothing was created, so a
        // replayed create is settled too. Offer the fresh list.
        final attempted = _completedOperation;
        if (attempted != null) {
          try {
            await ref
                .read(passengerParcelMutationRunnerProvider)
                .acknowledge(
                  actorId: attempted.actorId,
                  operation: _operation,
                  idempotencyKey: attempted.idempotencyKey,
                );
          } catch (_) {
            // Another create was saved meanwhile; it stays to be verified.
          }
          _completedOperation = null;
        }
        ref.invalidate(operatingRoutesProvider);
        if (mounted) setState(() => _draft = _draft.withoutRoute());
      }
      final saved = await savedOperationPresent(runner.storage);
      if (mounted) {
        setState(() {
          _error = error;
          _savedPending = saved;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Clears the saved create once its result is in hand. False while it
  /// could not be cleared; the result button tries again.
  Future<bool> _settleCompleted(
    CanonicalMutationRunner runner,
    String? actorId,
  ) async {
    final completed = _completedOperation;
    if (completed == null) return true;
    if (actorId == null || completed.actorId != actorId) return false;
    try {
      await runner.acknowledge(
        actorId: actorId,
        operation: _operation,
        idempotencyKey: completed.idempotencyKey,
      );
      _completedOperation = null;
      return true;
    } catch (error) {
      if (mounted) setState(() => _error = error);
      return false;
    }
  }

  Future<void> _acknowledgeResult() async {
    final actorId = ref.read(authControllerProvider).value?.user?.id;
    final runner = ref.read(passengerParcelMutationRunnerProvider);
    if (!await _settleCompleted(runner, actorId)) return;
    ref.invalidate(passengerParcelsProvider);
    if (mounted) context.go('/passenger/parcels');
  }

  /// Drops the saved create after the passenger confirms, so the form can be
  /// sent as a new parcel.
  Future<void> _discard() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(passengerParcelMutationRunnerProvider).discard();
      _completedOperation = null;
      if (mounted) setState(() => _savedPending = false);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _errorLabel(AppLocalizations l10n, Object error) {
    final saved = savedRequestOutcomeLabel(l10n, error);
    if (saved != null) return saved;
    if (error is CanonicalOperationBlocked ||
        error is CanonicalOperationStorageException) {
      return l10n.canonicalRecoveryRequired;
    }
    if (error is ApiException) {
      if (error.message == 'route_unavailable') {
        return l10n.passengerRouteUnavailable;
      }
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
