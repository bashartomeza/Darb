import '../../delivery_handover/data/delivery_handover_repository.dart';
import '../../../core/api/authoritative_refresh.dart';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_error.dart';
import '../../auth/application/auth_actor_binding.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/auth_models.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../canonical_routes/data/canonical_operation_storage.dart';
import 'legacy_driver_route_mutation.dart';
import '../../trips/data/trip_models.dart';
import '../data/driver_models.dart';
import '../data/driver_repository.dart';

class DriverDashboardState {
  const DriverDashboardState({
    required this.routes,
    required this.matches,
    required this.trips,
  });

  final List<DriverRoute> routes;
  final List<DriverMatch> matches;
  final List<DriverTrip> trips;

  DriverRoute? get currentRoute {
    for (final route in routes) {
      if (route.isOperational) return route;
    }
    return null;
  }

  int get proposedMatchCount => matches
      .where(
        (match) =>
            match.status == 'proposed' || match.status == 'sent_to_driver',
      )
      .length;

  DriverTrip? get activeTrip {
    for (final trip in trips) {
      if (trip.isActive) return trip;
    }
    return null;
  }
}

final driverDashboardProvider =
    AsyncNotifierProvider.autoDispose<
      DriverDashboardController,
      DriverDashboardState
    >(DriverDashboardController.new);

class DriverDashboardController extends AsyncNotifier<DriverDashboardState> {
  late AuthoritativeRefresh<DriverDashboardState> _reads;
  @override
  Future<DriverDashboardState> build() {
    _reads = AuthoritativeRefresh<DriverDashboardState>();
    ref.onDispose(_reads.dispose);
    return refresh();
  }

  Future<DriverDashboardState> refresh() async {
    final binding = ref.read(authenticatedActorBindingProvider);
    final revision = binding.revision;
    try {
      return await _reads.run(
        load: () async {
          final repository = ref.read(driverRepositoryProvider);
          final routes = await repository.listRoutes();
          final matches = await repository.listMatches();
          final trips = await repository.listTrips();
          final next = DriverDashboardState(
            routes: routes,
            matches: matches,
            trips: trips,
          );

          return next;
        },
        publish: (next) => state = AsyncData(next),
        isCurrent: () => ref.mounted && binding.revision == revision,
      );
    } catch (error, stackTrace) {
      if (ref.mounted && binding.revision == revision) {
        state = AsyncError<DriverDashboardState>(error, stackTrace);
      }
      Error.throwWithStackTrace(error, stackTrace);
    }
  }
}

const legacyDriverOnlineOperation = 'legacy_driver_online_state_v1';
const _legacyOnlineScope = 'legacy_driver_online_state';
const _legacyRouteSentinel = 'legacy_driver_online_state';

final legacyDriverOnlineControllerProvider =
    Provider<LegacyDriverOnlineController>(LegacyDriverOnlineController.new);

class LegacyDriverOnlineController {
  LegacyDriverOnlineController(this.ref);

  final Ref ref;
  bool _busy = false;

  bool get busy => _busy;

  Future<DriverDashboardState> setOnline(bool desiredOnline) async {
    if (_busy) throw StateError('operation_in_progress');
    _busy = true;
    try {
      final actor = ref.read(authControllerProvider).value?.user;
      if (actor == null || actor.role != UserRole.driver) {
        throw const ApiException(ApiErrorType.forbidden, 'forbidden');
      }
      final actorId = actor.id;
      final storage = ref.read(canonicalOperationStorageProvider);
      final pending = await storage.read();
      if (pending != null && pending.actorId != actorId) {
        throw const CanonicalOperationBlocked(
          'canonical_recovery_other_account',
        );
      }

      var dashboard = await ref
          .read(driverDashboardProvider.notifier)
          .refresh();
      _requireCurrentActor(actorId);
      if (pending != null && pending.operation == legacyDriverOnlineOperation) {
        final pendingDesired = pending.payload['online'];
        if (pendingDesired is! bool) {
          throw const CanonicalOperationBlocked(
            'canonical_recovery_unreadable',
          );
        }
        if (_isOnline(dashboard) == pendingDesired) {
          await ref
              .read(canonicalMutationRunnerProvider)
              .acknowledge(
                actorId: actorId,
                operation: legacyDriverOnlineOperation,
                idempotencyKey: pending.idempotencyKey,
              );
          return dashboard;
        }
      } else if (pending == null && _isOnline(dashboard) == desiredOnline) {
        return dashboard;
      }

      final routeId = dashboard.currentRoute?.id;
      final payload = <String, dynamic>{
        'route_version_id': _legacyRouteSentinel,
        'online': desiredOnline,
        'expected_route_id': desiredOnline ? null : routeId,
      };
      final receipt = await ref
          .read(canonicalMutationRunnerProvider)
          .runWithReceipt<void>(
            operation: legacyDriverOnlineOperation,
            scope: _legacyOnlineScope,
            actorId: actorId,
            payload: payload,
            send: (bundle) async {
              _requireCurrentActor(actorId);
              await ref
                  .read(driverRepositoryProvider)
                  .setLegacyOnlineState(
                    online: bundle.payload['online'] as bool,
                    expectedRouteId:
                        bundle.payload['expected_route_id'] as String?,
                    idempotencyKey: bundle.idempotencyKey,
                    beforeRetry: () async => _requireCurrentActor(actorId),
                  );
              _requireCurrentActor(actorId);
            },
          );
      dashboard = await ref.read(driverDashboardProvider.notifier).refresh();
      _requireCurrentActor(actorId);
      if (_isOnline(dashboard) != desiredOnline) {
        throw const FormatException('Online state was not reconciled');
      }
      await ref
          .read(canonicalMutationRunnerProvider)
          .acknowledge(
            actorId: actorId,
            operation: legacyDriverOnlineOperation,
            idempotencyKey: receipt.bundle.idempotencyKey,
          );
      return dashboard;
    } finally {
      _busy = false;
    }
  }

  bool _isOnline(DriverDashboardState state) =>
      state.currentRoute?.isOperational == true;

  void _requireCurrentActor(String actorId) {
    if (ref.read(authenticatedActorBindingProvider).actorId != actorId) {
      throw const ApiException(ApiErrorType.unauthorized, 'session_changed');
    }
  }
}

class DriverRouteState {
  const DriverRouteState(this.routes);
  final List<DriverRoute> routes;

  DriverRoute? get currentRoute {
    for (final route in routes) {
      if (route.isOperational) return route;
    }
    return null;
  }
}

final driverRouteControllerProvider =
    AsyncNotifierProvider.autoDispose<DriverRouteController, DriverRouteState>(
      DriverRouteController.new,
    );

class DriverRouteController extends AsyncNotifier<DriverRouteState> {
  late AuthoritativeRefresh<DriverRouteState> _reads;

  @override
  Future<DriverRouteState> build() {
    _reads = AuthoritativeRefresh<DriverRouteState>();
    ref.onDispose(_reads.dispose);
    return refresh();
  }

  Future<DriverRouteState> refresh() async {
    if (!ref.mounted) throw StateError('session_changed');
    final binding = ref.read(authenticatedActorBindingProvider);
    final revision = binding.revision;
    if (binding.actorId == null) throw StateError('session_changed');
    void requireCurrent() {
      if (!ref.mounted || binding.revision != revision) {
        throw StateError('session_changed');
      }
    }

    return _reads.run(
      load: () async {
        requireCurrent();
        final repository = ref.read(driverRepositoryProvider);
        final activeRoutes = await repository.activeRoutes();
        requireCurrent();
        final routeHistory = await repository.listRoutes();
        requireCurrent();
        final seen = <String>{};
        return DriverRouteState([
          ...activeRoutes.where((route) => seen.add(route.id)),
          ...routeHistory.where((route) => seen.add(route.id)),
        ]);
      },
      publish: (next) => state = AsyncData(next),
      isCurrent: () => ref.mounted && binding.revision == revision,
    );
  }

  Future<DriverRoute> create({
    required int seatsAvailable,
    required int parcelCapacityAvailable,
  }) async {
    final mutation = ref.read(legacyDriverRouteMutationProvider);
    final pending = await mutation.pending();
    final current = state.value?.currentRoute;
    if (current != null && pending == null) {
      throw const ApiException(ApiErrorType.validation, 'route_already_active');
    }
    final actor = mutation.actorId;
    final receipt = await mutation.create(
      seats: seatsAvailable,
      parcels: parcelCapacityAvailable,
      send: (key, beforeRetry) => ref
          .read(driverRepositoryProvider)
          .createRoute(
            seatsAvailable: seatsAvailable,
            parcelCapacityAvailable: parcelCapacityAvailable,
            idempotencyKey: key,
            beforeRetry: beforeRetry,
          ),
    );
    await refresh();
    mutation.requireActor(actor);
    await mutation.acknowledge(receipt);
    ref.invalidate(driverDashboardProvider);
    return receipt.value;
  }

  Future<void> deactivate(String id) async {
    await ref.read(driverRepositoryProvider).deactivateRoute(id);
    await refresh();
    ref.invalidate(driverDashboardProvider);
  }
}

final driverMatchInboxProvider =
    AsyncNotifierProvider.autoDispose<
      DriverMatchInboxController,
      List<DriverMatch>
    >(DriverMatchInboxController.new);

class DriverMatchInboxController extends AsyncNotifier<List<DriverMatch>> {
  late AuthoritativeRefresh<List<DriverMatch>> _reads;
  @override
  Future<List<DriverMatch>> build() {
    _reads = AuthoritativeRefresh<List<DriverMatch>>();
    ref.onDispose(_reads.dispose);
    return refresh();
  }

  Future<List<DriverMatch>> refresh({String? status}) async {
    final binding = ref.read(authenticatedActorBindingProvider);
    final revision = binding.revision;

    return await _reads.run(
      load: () async {
        final matches = await ref
            .read(driverRepositoryProvider)
            .listMatches(status: status);
        final indexed = matches.indexed.toList();
        indexed.sort((left, right) {
          final priority = _matchPriority(
            left.$2.status,
          ).compareTo(_matchPriority(right.$2.status));
          if (priority != 0) return priority;
          final created = right.$2.createdAt.compareTo(left.$2.createdAt);
          return created != 0 ? created : left.$1.compareTo(right.$1);
        });
        final next = indexed.map((entry) => entry.$2).toList();

        return next;
      },
      publish: (next) => state = AsyncData(next),
      isCurrent: () => ref.mounted && binding.revision == revision,
    );
  }
}

int _matchPriority(String status) =>
    status == 'proposed' || status == 'sent_to_driver' ? 0 : 1;

final driverMatchDetailProvider = AsyncNotifierProvider.autoDispose
    .family<DriverMatchDetailController, DriverMatch, String>(
      DriverMatchDetailController.new,
    );

class DriverMatchDetailController extends AsyncNotifier<DriverMatch> {
  late AuthoritativeRefresh<DriverMatch> _reads;
  DriverMatchDetailController(this._matchId);
  final String _matchId;

  @override
  Future<DriverMatch> build() {
    _reads = AuthoritativeRefresh<DriverMatch>();
    ref.onDispose(_reads.dispose);
    return refresh();
  }

  Future<DriverMatch> refresh() async {
    final binding = ref.read(authenticatedActorBindingProvider);
    final revision = binding.revision;

    return await _reads.run(
      load: () async {
        final match = await ref
            .read(driverRepositoryProvider)
            .matchDetail(_matchId);

        return match;
      },
      publish: (next) => state = AsyncData(next),
      isCurrent: () => ref.mounted && binding.revision == revision,
    );
  }

  Future<DriverTripReference> accept() async {
    final trip = await ref.read(driverRepositoryProvider).acceptMatch(_matchId);
    ref.invalidate(driverMatchInboxProvider);
    ref.invalidate(driverDashboardProvider);
    return trip;
  }

  Future<void> reject() async {
    await ref.read(driverRepositoryProvider).rejectMatch(_matchId);
    await refresh();
    ref.invalidate(driverMatchInboxProvider);
    ref.invalidate(driverDashboardProvider);
  }
}

class DriverTripState {
  const DriverTripState({
    required this.trip,
    required this.location,
    this.actionInProgress = false,
  });

  final DriverTrip trip;
  final TripLocation? location;
  final bool actionInProgress;

  DriverTripState copyWith({
    DriverTrip? trip,
    TripLocation? location,
    bool clearLocation = false,
    bool? actionInProgress,
  }) {
    return DriverTripState(
      trip: trip ?? this.trip,
      location: clearLocation ? null : location ?? this.location,
      actionInProgress: actionInProgress ?? this.actionInProgress,
    );
  }
}

final driverTripControllerProvider = AsyncNotifierProvider.autoDispose
    .family<DriverTripController, DriverTripState, String>(
      DriverTripController.new,
    );

class DriverTripController extends AsyncNotifier<DriverTripState> {
  DriverTripController(this._tripId);
  final String _tripId;
  late AuthoritativeRefresh<({DriverTripState state, int actionRevision})>
  _reads;
  bool _actionRunning = false;
  int _actionRevision = 0;
  bool _resetLocation = false;

  @override
  Future<DriverTripState> build() {
    _reads =
        AuthoritativeRefresh<({DriverTripState state, int actionRevision})>();
    ref.onDispose(_reads.dispose);
    return _read();
  }

  Future<void> refresh() async {
    if (!_actionRunning) await _read();
  }

  Future<DriverTripState> _read() async {
    if (!ref.mounted) throw StateError('session_changed');
    final binding = ref.read(authenticatedActorBindingProvider);
    final revision = binding.revision;
    if (binding.actorId == null) throw StateError('session_changed');
    final actionRevision = _actionRevision;
    void requireCurrent() {
      if (!ref.mounted || binding.revision != revision) {
        throw StateError('session_changed');
      }
    }

    final read = await _reads.run(
      load: () async {
        requireCurrent();
        final repository = ref.read(driverRepositoryProvider);
        final trip = await repository.tripDetail(_tripId);
        requireCurrent();
        final location = await repository.latestLocation(_tripId);
        requireCurrent();
        return (
          state: DriverTripState(trip: trip, location: location),
          actionRevision: actionRevision,
        );
      },
      publish: (read) {
        if (read.actionRevision != _actionRevision) return;
        final next = read.state;
        final location = _resetLocation
            ? next.location
            : latestTripLocation(state.value?.location, next.location);
        _resetLocation = false;
        state = AsyncData(
          next.copyWith(
            location: location,
            clearLocation: location == null,
            actionInProgress: _actionRunning,
          ),
        );
      },
      isCurrent: () => ref.mounted && binding.revision == revision,
    );
    return read.state;
  }

  Future<void> advanceStatus() async {
    final current = state.value;
    final next = current?.trip.nextStatus;
    if (current == null || _actionRunning || next == null) return;
    await _runAction(
      () => ref.read(driverRepositoryProvider).updateTripStatus(_tripId, next),
    );
    if (ref.mounted) ref.invalidate(driverDashboardProvider);
  }

  /// Completes the delivery with the receivers' codes, or records why the
  /// receiver was unavailable. The trip becomes delivered once every parcel
  /// order on it is confirmed.
  Future<void> confirmDelivery({
    Map<String, String>? codesByOrderId,
    String? unavailableReason,
  }) async {
    final current = state.value;
    if (current == null ||
        _actionRunning ||
        current.trip.status != 'in_transit') {
      return;
    }
    final repository = ref.read(deliveryHandoverRepositoryProvider);
    final tripId = _tripId;
    await _runAction(
      () => unavailableReason != null
          ? repository.confirmReceiverUnavailable(tripId, unavailableReason)
          : repository.confirmWithCodes(tripId, codesByOrderId ?? const {}),
    );
    if (ref.mounted) ref.invalidate(driverDashboardProvider);
  }

  Future<void> cancelTrip() async {
    final current = state.value;
    if (current == null ||
        _actionRunning ||
        !{
          'accepted',
          'pickup_started',
          'picked_up',
          'in_transit',
        }.contains(current.trip.status)) {
      return;
    }
    await _runAction(
      () => ref
          .read(driverRepositoryProvider)
          .updateTripStatus(_tripId, 'cancelled'),
    );
    if (ref.mounted) ref.invalidate(driverDashboardProvider);
  }

  Future<void> failDelivery() async {
    if (state.value?.trip.status != 'in_transit' || _actionRunning) return;
    await _runAction(
      () => ref
          .read(driverRepositoryProvider)
          .updateTripStatus(_tripId, 'failed'),
    );
    if (ref.mounted) ref.invalidate(driverDashboardProvider);
  }

  Future<void> simulateStep() async {
    if (state.value == null || _actionRunning) return;
    await _runAction(
      () => ref.read(driverRepositoryProvider).simulateStep(_tripId),
    );
  }

  Future<void> resetSimulation() async {
    if (state.value == null || _actionRunning) return;
    await _runAction(
      () => ref.read(driverRepositoryProvider).resetSimulation(_tripId),
      resetLocation: true,
    );
  }

  Future<void> _runAction(
    Future<void> Function() action, {
    bool resetLocation = false,
  }) async {
    final binding = ref.read(authenticatedActorBindingProvider);
    final revision = binding.revision;
    if (binding.actorId == null) throw StateError('session_changed');
    bool currentActor() => ref.mounted && binding.revision == revision;
    _actionRunning = true;
    _actionRevision++;
    _resetLocation = resetLocation;
    state = AsyncData(state.value!.copyWith(actionInProgress: true));
    try {
      await action();
      if (!currentActor()) throw StateError('session_changed');
      _resetLocation = resetLocation;
      await _read();
    } catch (error, stackTrace) {
      // A committed POST may lose its response. Reconcile with a GET; never
      // replay the action or restore the captured pre-action snapshot.
      if (currentActor()) {
        try {
          await _read();
        } catch (_) {
          /* retain last authoritative state */
        }
      }
      Error.throwWithStackTrace(error, stackTrace);
    } finally {
      _actionRunning = false;
      if (currentActor() && state.value != null) {
        state = AsyncData(state.value!.copyWith(actionInProgress: false));
      }
    }
  }
}
