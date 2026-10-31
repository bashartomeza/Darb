import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_back_button.dart';
import '../../../core/widgets/masari_card.dart';
import '../../../core/widgets/masari_map.dart';
import '../../canonical_routes/domain/canonical_route_models.dart';
import '../../matching/data/matching_repository.dart';
import '../data/passenger_models.dart';
import '../data/passenger_repository.dart';
import '../application/legacy_passenger_request_mutation.dart';
import 'location_picker_screen.dart';

class CreateRequestScreen extends ConsumerStatefulWidget {
  const CreateRequestScreen({super.key});

  @override
  ConsumerState<CreateRequestScreen> createState() =>
      _CreateRequestScreenState();
}

class _CreateRequestScreenState extends ConsumerState<CreateRequestScreen>
    with WidgetsBindingObserver {
  PassengerLocation? _pickup;
  PassengerLocation? _destination;

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
          _pickup = PassengerLocation(
            label: payload['pickup_label'] as String,
            latitude: (payload['pickup_lat'] as num).toDouble(),
            longitude: (payload['pickup_lng'] as num).toDouble(),
          );
          _destination = PassengerLocation(
            label: payload['destination_label'] as String,
            latitude: (payload['destination_lat'] as num).toDouble(),
            longitude: (payload['destination_lng'] as num).toDouble(),
          );
          _preferredTime = DateTime.parse(
            payload['preferred_time'] as String,
          ).toLocal();
          _count = payload['passenger_count'] as int;
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
        _pickup = null;
        _destination = null;
        _pendingPayload = null;
        _error = AppLocalizations.of(context).canonicalRecoveryRequired;
      });
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

    final canSubmit =
        _pickup != null &&
        _destination != null &&
        !_loading &&
        !_restoring &&
        !_recoveryBlocked;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.createRequest),
        leading: const MasariBackButton(fallback: '/passenger'),
        actions: const [LanguageSwitch()],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(AppTokens.spaceLarge),
          children: [
            const SizedBox(height: AppTokens.spaceLarge),

            // ----------------------------------------------------------
            // PICKUP + DESTINATION
            // ----------------------------------------------------------
            MasariCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    l10n.pickup,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),

                  const SizedBox(height: AppTokens.spaceSmall),

                  _LocationButton(
                    icon: Icons.trip_origin_rounded,
                    title: _pickup?.label ?? 'اختاري موقع الانطلاق',
                    subtitle: _pickup == null
                        ? 'اضغطي لاختيار الموقع من الخريطة'
                        : _coordinatesText(_pickup!),
                    selected: _pickup != null,
                    onTap: _loading || _locked
                        ? null
                        : () => _chooseLocation(isPickup: true),
                  ),

                  const SizedBox(height: AppTokens.spaceMedium),

                  Text(
                    l10n.destination,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),

                  const SizedBox(height: AppTokens.spaceSmall),

                  _LocationButton(
                    icon: Icons.location_on_rounded,
                    title: _destination?.label ?? 'اختاري الوجهة',
                    subtitle: _destination == null
                        ? 'اضغطي لاختيار الوجهة من الخريطة'
                        : _coordinatesText(_destination!),
                    selected: _destination != null,
                    onTap: _loading || _locked
                        ? null
                        : () => _chooseLocation(isPickup: false),
                  ),
                ],
              ),
            ),

            // ----------------------------------------------------------
            // MAP PREVIEW
            // ----------------------------------------------------------
            if (_pickup != null || _destination != null) ...[
              const SizedBox(height: AppTokens.spaceMedium),

              MasariCard(
                padding: EdgeInsets.zero,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(20),
                  child: MasariMap(
                    height: 300,
                    emptyLabel: '',
                    attributionLabel: '© OpenStreetMap contributors',
                    markers: [
                      if (_pickup != null)
                        MasariMapMarker(
                          position: GeoPoint(
                            _pickup!.latitude,
                            _pickup!.longitude,
                          ),
                          icon: Icons.trip_origin_rounded,
                          color: theme.colorScheme.primary,
                          label: _pickup!.label,
                        ),

                      if (_destination != null)
                        MasariMapMarker(
                          position: GeoPoint(
                            _destination!.latitude,
                            _destination!.longitude,
                          ),
                          icon: Icons.location_on_rounded,
                          color: theme.colorScheme.error,
                          label: _destination!.label,
                        ),
                    ],
                  ),
                ),
              ),
            ],

            const SizedBox(height: AppTokens.spaceMedium),

            // ----------------------------------------------------------
            // TIME + PASSENGERS
            // ----------------------------------------------------------
            MasariCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  OutlinedButton.icon(
                    onPressed: _loading || _locked ? null : _pickTime,
                    icon: const Icon(Icons.schedule_rounded),
                    label: Text(
                      '${l10n.preferredTime}: '
                      '${_preferredTime.toLocal()}',
                    ),
                  ),

                  const SizedBox(height: AppTokens.spaceMedium),

                  DropdownButtonFormField<int>(
                    initialValue: _count,
                    decoration: InputDecoration(
                      labelText: l10n.passengerCount,
                      prefixIcon: const Icon(Icons.people_alt_outlined),
                    ),
                    items: [1, 2, 3, 4]
                        .map(
                          (count) => DropdownMenuItem(
                            value: count,
                            child: Text('$count'),
                          ),
                        )
                        .toList(),
                    onChanged: _loading || _locked
                        ? null
                        : (value) {
                            setState(() {
                              _count = value ?? 1;
                            });
                          },
                  ),

                  if (_error != null) ...[
                    const SizedBox(height: AppTokens.spaceMedium),
                    Text(
                      _error!,
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                  ],

                  const SizedBox(height: AppTokens.spaceLarge),

                  FilledButton.icon(
                    onPressed: canSubmit ? _submit : null,
                    icon: _loading
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send_rounded),
                    label: Text(
                      _pendingPayload == null
                          ? l10n.submitRequest
                          : l10n.verifyBooking,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ----------------------------------------------------------------------
  // LOCATION PICKER
  // ----------------------------------------------------------------------

  Future<void> _chooseLocation({required bool isPickup}) async {
    final current = isPickup ? _pickup : _destination;

    final result = await Navigator.of(context).push<PassengerLocation>(
      MaterialPageRoute(
        builder: (_) => PassengerLocationPickerScreen(
          title: isPickup ? 'اختيار موقع الانطلاق' : 'اختيار الوجهة',
          initialLocation: current,
        ),
      ),
    );

    if (result == null || !mounted) return;

    setState(() {
      if (isPickup) {
        _pickup = result;
      } else {
        _destination = result;
      }

      _error = null;
    });
  }

  // ----------------------------------------------------------------------
  // TIME PICKER
  // ----------------------------------------------------------------------

  Future<void> _pickTime() async {
    final date = await showDatePicker(
      context: context,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 14)),
      initialDate: _preferredTime,
    );

    if (date == null || !mounted) return;

    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_preferredTime),
    );

    if (time == null) return;

    setState(() {
      _preferredTime = DateTime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      );
    });
  }

  // ----------------------------------------------------------------------
  // SUBMIT
  // ----------------------------------------------------------------------

  Future<void> _submit() async {
    if (_loading || _restoring || _recoveryBlocked) return;
    if (_pickup == null || _destination == null) {
      setState(() {
        _error = 'اختاري موقع الانطلاق والوجهة أولاً';
      });
      return;
    }

    if (_pendingPayload == null && !_preferredTime.isAfter(DateTime.now())) {
      setState(() => _error = AppLocalizations.of(context).bookingTimePassed);
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final mutation = ref.read(legacyPassengerRequestMutationProvider);
      final payload =
          _pendingPayload ??
          <String, dynamic>{
            'pickup_label': _pickup!.label,
            'pickup_lat': _pickup!.latitude,
            'pickup_lng': _pickup!.longitude,
            'destination_label': _destination!.label,
            'destination_lat': _destination!.latitude,
            'destination_lng': _destination!.longitude,
            'preferred_time': _preferredTime.toUtc().toIso8601String(),
            'passenger_count': _count,
          };
      final receipt = await mutation.create(
        payload: payload,
        send: ref.read(passengerRepositoryProvider).createPayload,
      );
      final createdId = receipt.value;
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
      }
    } catch (error) {
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
                : _matchingCreateErrorLabel(
                    AppLocalizations.of(context),
                    error,
                  );
          });
        }
      } catch (_) {
        if (mounted) {
          setState(() {
            _recoveryBlocked = true;
            _pickup = null;
            _destination = null;
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

  // ----------------------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------------------

  String _coordinatesText(PassengerLocation location) {
    return '${location.latitude.toStringAsFixed(6)}, '
        '${location.longitude.toStringAsFixed(6)}';
  }
}

String _matchingCreateErrorLabel(AppLocalizations l10n, Object error) {
  if (error is! ApiException) return l10n.requestFailed;
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
// LOCATION BUTTON
// ==========================================================================

class _LocationButton extends StatelessWidget {
  const _LocationButton({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(AppTokens.spaceMedium),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected
                ? theme.colorScheme.primary
                : theme.colorScheme.outlineVariant,
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: selected
                    ? theme.colorScheme.primary.withValues(alpha: 0.12)
                    : theme.colorScheme.surfaceContainerHighest,
              ),
              child: Icon(
                icon,
                color: selected
                    ? theme.colorScheme.primary
                    : theme.colorScheme.onSurfaceVariant,
              ),
            ),

            const SizedBox(width: AppTokens.spaceMedium),

            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    subtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(width: 8),

            Icon(
              Icons.chevron_right_rounded,
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ],
        ),
      ),
    );
  }
}
