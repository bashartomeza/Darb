import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/foreground_refresh.dart';
import '../../../core/widgets/darb_card.dart';
import '../../../core/widgets/discard_saved_request_button.dart';
import '../../operating_routes/data/operating_route_models.dart';
import '../../operating_routes/data/operating_route_repository.dart';
import '../application/driver_controller.dart';
import '../application/legacy_driver_route_mutation.dart';
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

  /// The predefined route chosen in the form, or restored from a saved,
  /// unconfirmed route (null for one saved before routes existed).
  String? _routeId;
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
          _routeId = pending.payload['service_route_id'] as String?;
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
          _routeId = null;
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
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final routeState = ref.watch(driverRouteControllerProvider);
    final routes = ref.watch(operatingRoutesProvider);
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
                  return DarbCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (route != null && !_recovering)
                          Text(
                            '${l10n.orderRouteLabel}: ${driverRouteName(context, route)}',
                            key: const ValueKey('driverActiveRouteName'),
                            style: Theme.of(context).textTheme.titleMedium,
                          )
                        else if (_recovering)
                          // A saved route is resent exactly as saved, so it
                          // is shown, not chosen again.
                          Text(
                            '${l10n.orderRouteLabel}: ${_savedRouteName(l10n, routes.value, arabic)}',
                            key: const ValueKey('driverSavedRouteName'),
                          )
                        else
                          _routeField(l10n, routes, arabic),
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
                            onPressed:
                                _busy ||
                                    _restoring ||
                                    _blocked ||
                                    (!_recovering &&
                                        _chosenRoute(routes.value) == null)
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
                        if (_recovering || _blocked)
                          DiscardSavedRequestButton(
                            enabled: !_busy,
                            onDiscard: _discard,
                          ),
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

  /// The route in the form while it is still running; a single running route
  /// is chosen for the driver.
  String? _chosenRoute(List<OperatingRoute>? routes) {
    if (routes == null) return null;
    if (routes.any((route) => route.id == _routeId)) return _routeId;
    return routes.length == 1 ? routes.single.id : null;
  }

  String _savedRouteName(
    AppLocalizations l10n,
    List<OperatingRoute>? routes,
    bool arabic,
  ) =>
      routes
          ?.where((route) => route.id == _routeId)
          .firstOrNull
          ?.displayName(arabic: arabic) ??
      l10n.orderRouteSaved;

  /// The route dropdown, with loading, error-and-retry and empty states.
  Widget _routeField(
    AppLocalizations l10n,
    AsyncValue<List<OperatingRoute>> routes,
    bool arabic,
  ) => routes.when(
    skipLoadingOnRefresh: false,
    loading: () => const Padding(
      padding: EdgeInsets.symmetric(vertical: AppTokens.spaceSmall),
      child: LinearProgressIndicator(key: ValueKey('driverRoutesLoading')),
    ),
    error: (_, _) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.orderRoutesLoadFailed,
          key: const ValueKey('driverRoutesError'),
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
        TextButton(
          key: const ValueKey('driverRoutesRetry'),
          onPressed: () => ref.invalidate(operatingRoutesProvider),
          child: Text(l10n.retry),
        ),
      ],
    ),
    data: (list) => list.isEmpty
        ? Text(l10n.orderRoutesEmpty, key: const ValueKey('driverRoutesEmpty'))
        // A reloaded list starts a fresh field, so a route that was turned
        // off is never kept as the chosen value.
        : KeyedSubtree(
            key: ObjectKey(list),
            child: DropdownButtonFormField<String>(
              key: const ValueKey('driverRouteField'),
              initialValue: _chosenRoute(list),
              isExpanded: true,
              decoration: InputDecoration(labelText: l10n.orderRouteLabel),
              hint: Text(l10n.orderRouteChoose),
              items: [
                for (final route in list)
                  DropdownMenuItem(
                    value: route.id,
                    child: Text(
                      route.displayName(arabic: arabic),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: _busy || _restoring || _blocked
                  ? null
                  : (id) => setState(() => _routeId = id),
            ),
          ),
  );

  Future<void> _create() async {
    if (_busy || _restoring || _blocked) return;
    final l10n = AppLocalizations.of(context);
    // A saved route is resent with exactly the route it was saved with.
    final serviceRouteId = _recovering
        ? _routeId
        : _chosenRoute(ref.read(operatingRoutesProvider).value);
    if (!_recovering && serviceRouteId == null) {
      _show(l10n.orderRouteRequired, true);
      return;
    }
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final route = await ref
          .read(driverRouteControllerProvider.notifier)
          .create(
            serviceRouteId: serviceRouteId,
            seatsAvailable: _seats,
            parcelCapacityAvailable: _parcels,
          );
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

  /// Drops the saved route the driver no longer wants verified, so the form
  /// opens again.
  Future<void> _discard() async {
    final l10n = AppLocalizations.of(context);
    _retryTimer?.cancel();
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await ref.read(legacyDriverRouteMutationProvider).discard();
      if (mounted) {
        setState(() {
          _recovering = false;
          _blocked = false;
          _automaticRetries = 0;
        });
      }
    } catch (error) {
      _show(driverErrorLabel(l10n, error), true);
    } finally {
      if (mounted) setState(() => _busy = false);
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
