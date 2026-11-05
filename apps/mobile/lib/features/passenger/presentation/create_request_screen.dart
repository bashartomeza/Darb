import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/presentation/localized_labels.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/darb_back_button.dart';
import '../../../core/widgets/darb_card.dart';
import '../../../core/widgets/discard_saved_request_button.dart';
import '../../canonical_routes/presentation/canonical_route_widgets.dart';
import '../../matching/data/matching_repository.dart';
import '../../operating_routes/data/operating_route_repository.dart';
import '../../operating_routes/presentation/operating_route_inputs.dart';
import '../../operating_routes/presentation/route_place_picker.dart';
import '../data/passenger_models.dart';
import '../data/passenger_repository.dart';
import '../application/legacy_passenger_request_mutation.dart';
import '../application/passenger_controller.dart';
import 'passenger_request_labels.dart';

/// Books a ride: a predefined route first, then the pickup village or town of
/// the route's origin city and the drop-off village or town of its destination
/// city (each with optional extra details), the departure time and the number
/// of passengers.
class CreateRequestScreen extends ConsumerStatefulWidget {
  const CreateRequestScreen({super.key});

  @override
  ConsumerState<CreateRequestScreen> createState() =>
      _CreateRequestScreenState();
}

class _CreateRequestScreenState extends ConsumerState<CreateRequestScreen>
    with WidgetsBindingObserver {
  final _pickupDetails = TextEditingController();
  final _dropoffDetails = TextEditingController();
  String? _routeId;

  /// The chosen places; they belong to the chosen route's cities, so they are
  /// cleared when the route changes.
  String? _pickupPlaceId;
  String? _dropoffPlaceId;

  /// Field errors are shown once the passenger tried to submit.
  bool _showErrors = false;

  DateTime _preferredTime = DateTime.now().add(const Duration(hours: 1));

  int _count = 1;
  bool _loading = false;
  String? _error;
  Map<String, dynamic>? _pendingPayload;
  bool _restoring = true;
  bool _recoveryBlocked = false;
  bool _foreground = true;
  Timer? _retryTimer;
  int _automaticRetries = 0;
  bool get _locked => _pendingPayload != null || _recoveryBlocked || _restoring;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    Future<void>(_restorePending);
  }

  @override
  void dispose() {
    _retryTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _pickupDetails.dispose();
    _dropoffDetails.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _retryTimer?.cancel();
    if (_foreground && !_loading) {
      _automaticRetries = 0;
      unawaited(_restorePending());
    }
  }

  /// Shows a booking whose outcome is unknown with its saved values, then
  /// replays it with the same idempotency key.
  void _showPending(Map<String, dynamic> payload) {
    final routeId = payload['service_route_id'];
    if (routeId is String) {
      _routeId = routeId;
      _pickupPlaceId = payload['pickup_place_id'] as String?;
      _dropoffPlaceId = payload['dropoff_place_id'] as String?;
      _pickupDetails.text = payload['pickup_details'] as String? ?? '';
      _dropoffDetails.text = payload['dropoff_details'] as String? ?? '';
    } else {
      // Left pending by an older build that sent places with coordinates;
      // it is replayed exactly as saved, so only its names are shown.
      _routeId = null;
      _pickupDetails.text = payload['pickup_label'] as String? ?? '';
      _dropoffDetails.text = payload['destination_label'] as String? ?? '';
    }
    _preferredTime = DateTime.parse(
      payload['preferred_time'] as String,
    ).toLocal();
    _count = (payload['passenger_count'] as num).toInt();
  }

  Future<void> _restorePending() async {
    try {
      final pending = await ref
          .read(legacyPassengerRequestMutationProvider)
          .pending();
      if (!mounted) return;
      if (pending != null) {
        final payload = Map<String, dynamic>.from(pending.payload)
          ..remove('route_version_id');
        setState(() {
          _pendingPayload = payload;
          _showPending(payload);
          _restoring = false;
          _recoveryBlocked = false;
          _error = AppLocalizations.of(context).bookingOutcomeUnknown;
        });
        await _submit();
      } else {
        setState(() {
          _restoring = false;
          _pendingPayload = null;
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _restoring = false;
        _recoveryBlocked = true;
        _pendingPayload = null;
        _error = AppLocalizations.of(context).canonicalRecoveryRequired;
      });
    }
  }

  /// Drops the saved booking after the passenger confirms, so the form
  /// opens again for a new one.
  Future<void> _discard() async {
    _retryTimer?.cancel();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(legacyPassengerRequestMutationProvider).discard();
      if (mounted) {
        setState(() {
          _pendingPayload = null;
          _recoveryBlocked = false;
          _automaticRetries = 0;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = AppLocalizations.of(context).canonicalRecoveryRequired,
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _scheduleVerification() {
    _retryTimer?.cancel();
    if (_pendingPayload == null || !_foreground || _automaticRetries >= 5) {
      return;
    }
    _retryTimer = Timer(const Duration(seconds: 15), () {
      if (mounted && !_loading && _foreground) {
        _automaticRetries++;
        unawaited(_submit());
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final material = MaterialLocalizations.of(context);
    final busy = _loading || _locked;

    final canSubmit = !_loading && !_restoring && !_recoveryBlocked;
    final legacyPending =
        _pendingPayload != null && _pendingPayload!['service_route_id'] == null;
    // The route's default seat price; the driver who takes the trip may
    // charge their own price inside the admin's range.
    final chosenRoute = ref
        .watch(operatingRoutesProvider)
        .value
        ?.where((route) => route.id == _routeId)
        .firstOrNull;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.createRequest),
        leading: const DarbBackButton(fallback: '/passenger'),
        actions: const [LanguageSwitch()],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppTokens.marginMobile,
            AppTokens.spaceSmall,
            AppTokens.marginMobile,
            AppTokens.spaceLarge,
          ),
          children: [
            Text(
              l10n.whereToGo,
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: AppTokens.spaceLarge),

            // The route first, then the village or town at each end (from the
            // route's own cities), then optional details for the driver.
            // There is no map picker.
            DarbCard(
              padding: const EdgeInsets.all(AppTokens.spaceMedium),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (legacyPending)
                    InputDecorator(
                      decoration: InputDecoration(
                        labelText: l10n.passengerRouteLabel,
                        prefixIcon: const Icon(Icons.route_rounded, size: 20),
                      ),
                      child: Text(
                        bidiRoute(
                          context,
                          localizedCorridorPlace(context, _pickupDetails.text),
                          localizedCorridorPlace(context, _dropoffDetails.text),
                        ),
                      ),
                    )
                  else
                    OperatingRouteDropdown(
                      fieldKey: const ValueKey('passengerRouteField'),
                      value: _routeId,
                      enabled: !busy,
                      errorText: _showErrors && _routeId == null
                          ? l10n.passengerRouteRequired
                          : null,
                      onChanged: (route) => setState(() {
                        if (route.id != _routeId) {
                          _pickupPlaceId = null;
                          _dropoffPlaceId = null;
                        }
                        _routeId = route.id;
                        _error = null;
                      }),
                    ),
                  const SizedBox(height: AppTokens.spaceMedium),
                  if (legacyPending) ...[
                    RouteDetailsField(
                      key: const ValueKey('pickupDetailsField'),
                      controller: _pickupDetails,
                      enabled: false,
                      icon: Icons.trip_origin_rounded,
                      label: l10n.passengerPickupDetailsLabel,
                      hint: l10n.passengerPickupDetailsHint,
                    ),
                    const SizedBox(height: AppTokens.spaceSmall),
                    RouteDetailsField(
                      key: const ValueKey('dropoffDetailsField'),
                      controller: _dropoffDetails,
                      enabled: false,
                      icon: Icons.location_on_outlined,
                      label: l10n.passengerDropoffDetailsLabel,
                      hint: l10n.passengerDropoffDetailsHint,
                    ),
                  ] else ...[
                    RoutePlacePicker(
                      key: const ValueKey('pickupPlacePicker'),
                      routeId: _routeId,
                      side: RoutePlaceSide.pickup,
                      selectedId: _pickupPlaceId,
                      enabled: !busy,
                      errorText: _showErrors && _pickupPlaceId == null
                          ? l10n.routePlaceRequired
                          : null,
                      onChanged: (place) => setState(() {
                        _pickupPlaceId = place.id;
                        _error = null;
                      }),
                    ),
                    const SizedBox(height: AppTokens.spaceSmall),
                    RouteDetailsField(
                      key: const ValueKey('pickupDetailsField'),
                      controller: _pickupDetails,
                      enabled: !busy,
                      icon: Icons.edit_location_alt_outlined,
                      label: l10n.routePlaceMoreDetailsLabel,
                      hint: l10n.routePlacePickupDetailsHint,
                      helper: l10n.routePlaceDetailsHelper,
                      onChanged: (_) => setState(() => _error = null),
                    ),
                    const SizedBox(height: AppTokens.spaceMedium),
                    RoutePlacePicker(
                      key: const ValueKey('dropoffPlacePicker'),
                      routeId: _routeId,
                      side: RoutePlaceSide.dropoff,
                      selectedId: _dropoffPlaceId,
                      enabled: !busy,
                      errorText: _showErrors && _dropoffPlaceId == null
                          ? l10n.routePlaceRequired
                          : null,
                      onChanged: (place) => setState(() {
                        _dropoffPlaceId = place.id;
                        _error = null;
                      }),
                    ),
                    const SizedBox(height: AppTokens.spaceSmall),
                    RouteDetailsField(
                      key: const ValueKey('dropoffDetailsField'),
                      controller: _dropoffDetails,
                      enabled: !busy,
                      icon: Icons.edit_location_alt_outlined,
                      label: l10n.routePlaceMoreDetailsLabel,
                      hint: l10n.routePlaceDropoffDetailsHint,
                      onChanged: (_) => setState(() => _error = null),
                    ),
                  ],
                ],
              ),
            ),

            const SizedBox(height: AppTokens.spaceMedium),

            // Passengers, time and date.
            DarbCard(
              padding: const EdgeInsets.symmetric(
                horizontal: AppTokens.spaceMedium,
                vertical: AppTokens.spaceSmall,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _SettingTile(
                    icon: Icons.people_alt_outlined,
                    title: l10n.passengerCount,
                    value: '$_count',
                    trailing: _Stepper(
                      value: _count,
                      min: 1,
                      max: 4,
                      decrementLabel: l10n.decreasePassengers,
                      incrementLabel: l10n.increasePassengers,
                      onChanged: busy
                          ? null
                          : (value) => setState(() => _count = value),
                    ),
                  ),
                  const Divider(height: 1),
                  _SettingTile(
                    icon: Icons.schedule_rounded,
                    title: l10n.timeField,
                    value: material.formatTimeOfDay(
                      TimeOfDay.fromDateTime(_preferredTime),
                    ),
                    onTap: busy ? null : _pickTime,
                  ),
                  const Divider(height: 1),
                  _SettingTile(
                    icon: Icons.calendar_today_rounded,
                    title: l10n.dateField,
                    value: material.formatFullDate(_preferredTime),
                    onTap: busy ? null : _pickDate,
                  ),
                ],
              ),
            ),

            if (chosenRoute != null) ...[
              const SizedBox(height: AppTokens.spaceMedium),
              KeyedSubtree(
                key: const ValueKey('passengerRouteFare'),
                child: passengerFareEstimate(
                  context,
                  chosenRoute.fares,
                  _count,
                ),
              ),
            ],

            if (_error != null) ...[
              const SizedBox(height: AppTokens.spaceMedium),
              Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
            ],
            if (_pendingPayload != null || _recoveryBlocked)
              DiscardSavedRequestButton(
                enabled: !_loading,
                onDiscard: _discard,
              ),

            const SizedBox(height: AppTokens.spaceLarge),

            FilledButton.icon(
              key: const ValueKey('submitPassengerRequest'),
              onPressed: canSubmit ? _submit : null,
              icon: _loading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.search_rounded),
              label: Text(
                _pendingPayload == null ? l10n.searchRide : l10n.verifyBooking,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ----------------------------------------------------------------------
  // TIME PICKER
  // ----------------------------------------------------------------------

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: now.add(const Duration(days: 14)),
      initialDate: _preferredTime.isBefore(now) ? now : _preferredTime,
    );
    if (date == null || !mounted) return;
    setState(() {
      _preferredTime = DateTime(
        date.year,
        date.month,
        date.day,
        _preferredTime.hour,
        _preferredTime.minute,
      );
    });
  }

  Future<void> _pickTime() async {
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_preferredTime),
    );
    if (time == null || !mounted) return;
    setState(() {
      _preferredTime = DateTime(
        _preferredTime.year,
        _preferredTime.month,
        _preferredTime.day,
        time.hour,
        time.minute,
      );
    });
  }

  // ----------------------------------------------------------------------
  // SUBMIT
  // ----------------------------------------------------------------------

  // The places are required; the details are optional (the field's own
  // counter keeps them within 300 characters).
  bool get _formComplete =>
      _routeId != null && _pickupPlaceId != null && _dropoffPlaceId != null;

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    if (_loading || _restoring || _recoveryBlocked) return;
    if (_pendingPayload == null && !_formComplete) {
      setState(() {
        _showErrors = true;
        _error = null;
      });
      return;
    }

    if (_pendingPayload == null && !_preferredTime.isAfter(DateTime.now())) {
      setState(() => _error = l10n.bookingTimePassed);
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });
    // The lists must learn about a saved request even if this screen is
    // closed while the create or the match is still in flight.
    final container = ProviderScope.containerOf(context, listen: false);

    try {
      final mutation = ref.read(legacyPassengerRequestMutationProvider);
      final payload =
          _pendingPayload ??
          passengerRouteRequestBody(
            serviceRouteId: _routeId!,
            pickupPlaceId: _pickupPlaceId!,
            dropoffPlaceId: _dropoffPlaceId!,
            pickupDetails: _pickupDetails.text,
            dropoffDetails: _dropoffDetails.text,
            preferredTime: _preferredTime,
            passengerCount: _count,
          );
      final receipt = await mutation.create(
        payload: payload,
        send: ref.read(passengerRepositoryProvider).createPayload,
      );
      final createdId = receipt.value;
      invalidatePassengerLists(container.invalidate);
      final recovery = receipt.bundle.payload['client_recovery'];
      String? selectedRoute;
      if (recovery != null) {
        final option = recovery is Map ? recovery['option'] : null;
        final routeId = option is Map ? option['id'] : null;
        if (routeId is! String || routeId.isEmpty) {
          throw const FormatException('Missing selected driver route');
        }
        selectedRoute = routeId;
      }
      if (!mounted) return;

      try {
        final match = await ref
            .read(matchingRepositoryProvider)
            .runForPassengerRequest(createdId, driverRouteId: selectedRoute);
        mutation.requireActor(receipt.bundle.actorId);
        await mutation.acknowledge(receipt);
        if (mounted) {
          context.go('/passenger/match/${match.id}');
        }
      } catch (error) {
        mutation.requireActor(receipt.bundle.actorId);
        if (selectedRoute != null) {
          final existing = await ref
              .read(matchingRepositoryProvider)
              .latestForPassengerRequest(
                createdId,
                driverRouteId: selectedRoute,
              );
          mutation.requireActor(receipt.bundle.actorId);
          if (existing != null) {
            await mutation.acknowledge(receipt);
            if (mounted) context.go('/passenger/match/${existing.id}');
            return;
          }
          final definitive =
              error is ApiException &&
              error.message != 'passenger_request_already_matched' &&
              [400, 404, 409, 422].contains(error.statusCode);
          if (!definitive) rethrow;
        }
        await mutation.acknowledge(receipt);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                _matchingCreateErrorLabel(AppLocalizations.of(context), error),
              ),
            ),
          );
          context.go('/passenger/request/$createdId');
        }
      } finally {
        // Matching moves the request out of "pending" on the server.
        invalidatePassengerLists(container.invalidate);
      }
    } catch (error) {
      if (error is ApiException && error.message == 'route_unavailable') {
        // Turned off or retired since the list was read: offer the fresh list.
        ref.invalidate(operatingRoutesProvider);
        if (mounted) setState(() => _routeId = null);
      }
      try {
        final pending = await ref
            .read(legacyPassengerRequestMutationProvider)
            .pending();
        if (mounted) {
          setState(() {
            _pendingPayload = pending == null
                ? null
                : (Map<String, dynamic>.from(pending.payload)
                    ..remove('route_version_id'));
            _error = pending != null
                ? AppLocalizations.of(context).bookingOutcomeUnknown
                : savedRequestOutcomeLabel(
                        AppLocalizations.of(context),
                        error,
                      ) ??
                      _matchingCreateErrorLabel(
                        AppLocalizations.of(context),
                        error,
                      );
          });
        }
      } catch (_) {
        if (mounted) {
          setState(() {
            _recoveryBlocked = true;
            _pendingPayload = null;
            _error = AppLocalizations.of(context).canonicalRecoveryRequired;
          });
        }
      }
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
        _scheduleVerification();
      }
    }
  }
}

String _matchingCreateErrorLabel(AppLocalizations l10n, Object error) {
  if (error is! ApiException) return l10n.requestFailed;
  if (error.message == 'route_unavailable') {
    return l10n.passengerRouteUnavailable;
  }
  if (error.message == 'selected_driver_route_unavailable') {
    return l10n.selectedDriverUnavailable;
  }
  if (error.message == 'booking_time_passed' ||
      error.message == 'preferred_time_in_past') {
    return l10n.bookingTimePassed;
  }
  if (error.type == ApiErrorType.network) return l10n.networkUnavailable;
  if (error.type == ApiErrorType.timeout) return l10n.requestTimedOut;
  return error.message == 'no_compatible_driver_route'
      ? l10n.noCompatibleDriverFound
      : l10n.requestFailed;
}

// ==========================================================================
// FORM PARTS
// ==========================================================================

/// White circular badge holding a leading icon, as in the Darb references.
class _Badge extends StatelessWidget {
  const _Badge({required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 44,
      height: 44,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        color: AppTheme.surfaceContainerLowest,
      ),
      child: Icon(icon, color: AppTheme.onSurface, size: 22),
    );
  }
}

/// A row in the passengers/time/date card.
class _SettingTile extends StatelessWidget {
  const _SettingTile({
    required this.icon,
    required this.title,
    required this.value,
    this.trailing,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String value;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppTokens.radiusDefault),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 72),
        child: Row(
          children: [
            _Badge(icon: icon),
            const SizedBox(width: AppTokens.gutterMobile),
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: theme.textTheme.titleMedium?.copyWith(
                      color: AppTheme.onSurfaceVariant,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(value, style: theme.textTheme.bodyMedium),
                ],
              ),
            ),
            trailing ??
                Icon(
                  Directionality.of(context) == TextDirection.rtl
                      ? Icons.chevron_left_rounded
                      : Icons.chevron_right_rounded,
                  color: AppTheme.onSurfaceVariant,
                ),
          ],
        ),
      ),
    );
  }
}

/// Minus / plus buttons for the passenger count.
class _Stepper extends StatelessWidget {
  const _Stepper({
    required this.value,
    required this.min,
    required this.max,
    required this.decrementLabel,
    required this.incrementLabel,
    required this.onChanged,
  });

  final int value;
  final int min;
  final int max;
  final String decrementLabel;
  final String incrementLabel;
  final ValueChanged<int>? onChanged;

  @override
  Widget build(BuildContext context) {
    Widget button(IconData icon, String label, int? next) => Semantics(
      button: true,
      label: label,
      child: InkWell(
        onTap: next == null || onChanged == null
            ? null
            : () => onChanged!(next),
        borderRadius: BorderRadius.circular(AppTokens.radiusDefault),
        child: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: AppTheme.surfaceContainerLowest,
            borderRadius: BorderRadius.circular(AppTokens.radiusDefault),
            border: Border.all(color: AppTheme.outlineVariant),
          ),
          child: Icon(
            icon,
            size: 20,
            color: next == null || onChanged == null
                ? AppTheme.hint
                : AppTheme.onSurface,
          ),
        ),
      ),
    );

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        button(Icons.remove, decrementLabel, value > min ? value - 1 : null),
        const SizedBox(width: AppTokens.spaceSmall),
        button(Icons.add, incrementLabel, value < max ? value + 1 : null),
      ],
    );
  }
}
