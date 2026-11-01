import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/geo/reverse_geocoder.dart';
import '../../../core/theme/app_theme.dart';
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
    final material = MaterialLocalizations.of(context);
    final busy = _loading || _locked;

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

            // From / To card with a dotted connector between the two stops.
            MasariCard(
              padding: const EdgeInsets.symmetric(
                horizontal: AppTokens.spaceMedium,
                vertical: AppTokens.spaceSmall,
              ),
              child: IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const _DottedConnector(),
                    const SizedBox(width: AppTokens.gutterMobile),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _PlaceTile(
                            title: l10n.pickup,
                            value: _pickup?.label ?? l10n.selectPickupLocation,
                            selected: _pickup != null,
                            onTap: busy
                                ? null
                                : () => _chooseLocation(isPickup: true),
                          ),
                          const Divider(height: 1),
                          _PlaceTile(
                            title: l10n.destination,
                            value:
                                _destination?.label ?? l10n.selectDestination,
                            selected: _destination != null,
                            onTap: busy
                                ? null
                                : () => _chooseLocation(isPickup: false),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),

            if (_pickup != null || _destination != null) ...[
              const SizedBox(height: AppTokens.spaceMedium),
              MasariCard(
                padding: EdgeInsets.zero,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
                  child: MasariMap(
                    height: 240,
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
                          color: AppTheme.routeOrigin,
                          label: _pickup!.label,
                        ),
                      if (_destination != null)
                        MasariMapMarker(
                          position: GeoPoint(
                            _destination!.latitude,
                            _destination!.longitude,
                          ),
                          icon: Icons.location_on_rounded,
                          color: AppTheme.routeDestination,
                          label: _destination!.label,
                        ),
                    ],
                  ),
                ),
              ),
            ],

            const SizedBox(height: AppTokens.spaceMedium),

            // Passengers, time and date.
            MasariCard(
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

            if (_error != null) ...[
              const SizedBox(height: AppTokens.spaceMedium),
              Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
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
  // LOCATION PICKER
  // ----------------------------------------------------------------------

  Future<void> _chooseLocation({required bool isPickup}) async {
    final l10n = AppLocalizations.of(context);
    final current = isPickup ? _pickup : _destination;

    final result = await Navigator.of(context).push<PassengerLocation>(
      MaterialPageRoute(
        builder: (_) => PassengerLocationPickerScreen(
          title: isPickup
              ? l10n.selectPickupLocationTitle
              : l10n.selectDestinationTitle,
          initialLocation: current,
          reverseGeocoder: ref.read(reverseGeocoderProvider),
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

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    if (_loading || _restoring || _recoveryBlocked) return;
    if (_pickup == null || _destination == null) {
      setState(() {
        _error = l10n.selectBothLocations;
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
// FORM PARTS
// ==========================================================================

/// White circular badge holding a leading icon, as in the Darb references.
class _Badge extends StatelessWidget {
  const _Badge({required this.icon, this.color});

  final IconData icon;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 44,
      height: 44,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        color: AppTheme.surfaceContainerLowest,
      ),
      child: Icon(icon, color: color ?? AppTheme.onSurface, size: 22),
    );
  }
}

/// Origin badge, a dotted vertical line, then the destination badge.
class _DottedConnector extends StatelessWidget {
  const _DottedConnector();

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: SizedBox(
        width: 44,
        child: Column(
          children: [
            const SizedBox(height: AppTokens.spaceSmall),
            const _Badge(
              icon: Icons.circle_outlined,
              color: AppTheme.routeOrigin,
            ),
            Expanded(
              child: Center(
                child: SizedBox(
                  width: 2,
                  child: CustomPaint(painter: _DotsPainter()),
                ),
              ),
            ),
            const _Badge(
              icon: Icons.location_on_outlined,
              color: AppTheme.routeDestination,
            ),
            const SizedBox(height: AppTokens.spaceSmall),
          ],
        ),
      ),
    );
  }
}

/// A tappable From/To row: grey label, orange prompt (or the chosen place).
class _PlaceTile extends StatelessWidget {
  const _PlaceTile({
    required this.title,
    required this.value,
    required this.selected,
    required this.onTap,
  });

  final String title;
  final String value;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppTokens.radiusDefault),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 72),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppTokens.spaceSmall),
          child: Row(
            children: [
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
                    const SizedBox(height: AppTokens.spaceExtraSmall),
                    Text(
                      value,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: selected
                            ? AppTheme.onSurface
                            : AppTheme.primaryText,
                        fontWeight: selected ? FontWeight.w600 : null,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(
                Directionality.of(context) == TextDirection.rtl
                    ? Icons.chevron_left_rounded
                    : Icons.chevron_right_rounded,
                color: AppTheme.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
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

/// Paints the dotted vertical line between the origin and destination badges.
class _DotsPainter extends CustomPainter {
  const _DotsPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppTheme.hint
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    for (var y = 4.0; y < size.height - 2; y += 8) {
      canvas.drawLine(Offset(1, y), Offset(1, y + 2), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
