import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/foreground_refresh.dart';
import '../../../core/widgets/masari_card.dart';
import '../application/driver_controller.dart';
import '../application/legacy_driver_route_mutation.dart';
import '../data/driver_models.dart';
import 'driver_ui.dart';

class DriverRouteScreen extends ConsumerStatefulWidget {
  const DriverRouteScreen({super.key});
  @override
  ConsumerState<DriverRouteScreen> createState() => _DriverRouteScreenState();
}

class _DriverRouteScreenState extends ConsumerState<DriverRouteScreen>
    with WidgetsBindingObserver {
  int _seats = 2;
  int _parcels = 5;
  bool _busy = false;
  String? _message;
  bool _messageIsError = false;
  bool _recovering = false;
  bool _restoring = true;
  bool _blocked = false;
  bool _foreground = true;
  Timer? _retryTimer;
  int _automaticRetries = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    Future<void>(_restore);
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
    if (_foreground && !_busy) {
      _automaticRetries = 0;
      unawaited(_restore());
    }
  }

  Future<void> _restore() async {
    try {
      final pending = await ref
          .read(legacyDriverRouteMutationProvider)
          .pending();
      if (!mounted) return;
      setState(() {
        _restoring = false;
        _blocked = false;
        _recovering = pending != null;
        if (pending != null) {
          _seats = pending.payload['seats_available'] as int;
          _parcels = pending.payload['parcel_capacity_available'] as int;
        }
      });
      if (pending != null) await _create();
    } catch (_) {
      if (mounted) {
        setState(() {
          _restoring = false;
          _blocked = true;
          _recovering = false;
          _seats = 2;
          _parcels = 5;
          _message = AppLocalizations.of(context).canonicalRecoveryRequired;
          _messageIsError = true;
        });
      }
    }
  }

  void _scheduleVerification() {
    _retryTimer?.cancel();
    if (!_recovering || !_foreground || _automaticRetries >= 5) return;
    _retryTimer = Timer(const Duration(seconds: 15), () {
      if (mounted && !_busy && _foreground) {
        _automaticRetries++;
        unawaited(_create());
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final routeState = ref.watch(driverRouteControllerProvider);
    return ForegroundRefresh(
      refresh: () async {
        await ref.read(driverRouteControllerProvider.notifier).refresh();
      },
      child: Scaffold(
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(AppTokens.spaceLarge),
            children: [
              const Align(
                alignment: AlignmentDirectional.centerEnd,
                child: LanguageSwitch(),
              ),
              Text(
                l10n.routeDetails,
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: AppTokens.spaceLarge),
              routeState.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => FilledButton(
                  onPressed: () => ref
                      .read(driverRouteControllerProvider.notifier)
                      .refresh(),
                  child: Text(l10n.retry),
                ),
                data: (state) {
                  final route = state.currentRoute;
                  return MasariCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          '${l10n.origin}: ${localizedOrigin(context, route?.originLabel ?? lockedDriverOriginLabel)}',
                        ),
                        Text('${l10n.destination}: ${l10n.bethlehem}'),
                        Text(
                          '${l10n.lockedCorridorLabel}: ${l10n.lockedCorridor}',
                        ),
                        const SizedBox(height: AppTokens.spaceMedium),
                        if (route == null || _recovering) ...[
                          DropdownButtonFormField<int>(
                            key: const ValueKey('driverSeatsField'),
                            initialValue: _seats,
                            decoration: InputDecoration(
                              labelText: l10n.seatsAvailable,
                            ),
                            items: List.generate(9, (index) => index)
                                .map(
                                  (value) => DropdownMenuItem(
                                    value: value,
                                    child: Text('$value'),
                                  ),
                                )
                                .toList(),
                            onChanged:
                                _busy || _recovering || _restoring || _blocked
                                ? null
                                : (value) =>
                                      setState(() => _seats = value ?? 2),
                          ),
                          DropdownButtonFormField<int>(
                            key: const ValueKey('driverParcelField'),
                            initialValue: _parcels,
                            decoration: InputDecoration(
                              labelText: l10n.parcelCapacity,
                            ),
                            items: List.generate(21, (index) => index)
                                .map(
                                  (value) => DropdownMenuItem(
                                    value: value,
                                    child: Text('$value'),
                                  ),
                                )
                                .toList(),
                            onChanged:
                                _busy || _recovering || _restoring || _blocked
                                ? null
                                : (value) =>
                                      setState(() => _parcels = value ?? 5),
                          ),
                          const SizedBox(height: AppTokens.spaceMedium),
                          FilledButton(
                            key: const ValueKey('activateRouteButton'),
                            onPressed: _busy || _restoring || _blocked
                                ? null
                                : _create,
                            child: Text(
                              _recovering
                                  ? l10n.verifyBooking
                                  : l10n.activateRoute,
                            ),
                          ),
                        ] else ...[
                          technicalText(route.id, selectable: true),
                          Text(
                            '${l10n.seatsAvailable}: ${route.seatsAvailable}',
                          ),
                          Text(
                            '${l10n.parcelCapacity}: ${route.parcelCapacityAvailable}',
                          ),
                          Text(
                            '${l10n.routeStatus}: ${driverStatusLabel(l10n, route.status)}',
                          ),
                          if (route.activatedAt != null)
                            Text(
                              '${l10n.activationTime}: ${route.activatedAt}',
                            ),
                          if (route.canDeactivate) ...[
                            const SizedBox(height: AppTokens.spaceMedium),
                            OutlinedButton(
                              key: const ValueKey('deactivateRouteButton'),
                              onPressed: _busy
                                  ? null
                                  : () => _deactivate(route.id),
                              child: Text(l10n.deactivateRoute),
                            ),
                          ],
                        ],
                        if (_message != null) ...[
                          const SizedBox(height: AppTokens.spaceMedium),
                          Text(
                            _message!,
                            key: const ValueKey('driverRouteMessage'),
                            style: _messageIsError
                                ? TextStyle(
                                    color: Theme.of(context).colorScheme.error,
                                  )
                                : null,
                          ),
                        ],
                      ],
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _create() async {
    if (_busy || _restoring || _blocked) return;
    final l10n = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final route = await ref
          .read(driverRouteControllerProvider.notifier)
          .create(seatsAvailable: _seats, parcelCapacityAvailable: _parcels);
      if (mounted) setState(() => _recovering = false);
      _show(
        route.status == 'active'
            ? l10n.routeActivated
            : l10n.availabilityRecorded,
        false,
      );
    } catch (error) {
      try {
        final pending = await ref
            .read(legacyDriverRouteMutationProvider)
            .pending();
        if (mounted) setState(() => _recovering = pending != null);
        _show(
          pending != null
              ? l10n.bookingOutcomeUnknown
              : driverErrorLabel(l10n, error),
          true,
        );
      } catch (_) {
        if (mounted) setState(() => _blocked = true);
        _show(l10n.canonicalRecoveryRequired, true);
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
        _scheduleVerification();
      }
    }
  }

  Future<void> _deactivate(String id) async {
    final l10n = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await ref.read(driverRouteControllerProvider.notifier).deactivate(id);
      _show(l10n.routeDeactivated, false);
    } catch (error) {
      _show(driverErrorLabel(l10n, error), true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _show(String message, bool isError) {
    if (!mounted) return;
    setState(() {
      _message = message;
      _messageIsError = isError;
    });
  }
}
