import '../../../core/api/authoritative_refresh.dart';
import '../../auth/application/auth_actor_binding.dart';
import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../trips/data/trip_models.dart';
import '../data/merchant_models.dart';
import '../data/merchant_repository.dart';

class MerchantDashboardState {
  const MerchantDashboardState({
    required this.orders,
    required this.matches,
    required this.trips,
  });

  final List<MerchantOrder> orders;
  final List<MerchantMatch> matches;
  final List<MerchantTrip> trips;

  MerchantOrder? get latestOrder => orders.isEmpty ? null : orders.first;
  MerchantBatch? get latestBatch {
    for (final order in orders) {
      if (order.latestBatch != null) return order.latestBatch;
    }
    return null;
  }

  int get waitingMatchCount =>
      matches.where((match) => match.waitingForDriver).length;
  MerchantTrip? get activeTrip {
    for (final trip in trips) {
      if (trip.isActive) return trip;
    }
    return null;
  }
}

final merchantDashboardProvider =
    AsyncNotifierProvider.autoDispose<
      MerchantDashboardController,
      MerchantDashboardState
    >(MerchantDashboardController.new);

class MerchantDashboardController
    extends AsyncNotifier<MerchantDashboardState> {
  late AuthoritativeRefresh<MerchantDashboardState> _reads;
  @override
  Future<MerchantDashboardState> build() {
    _reads = AuthoritativeRefresh<MerchantDashboardState>();
    ref.onDispose(_reads.dispose);
    return refresh();
  }

  Future<MerchantDashboardState> refresh() async {
    final binding = ref.read(authenticatedActorBindingProvider);
    final revision = binding.revision;
    try {
      return await _reads.run(
        load: () async {
          final repository = ref.read(merchantRepositoryProvider);
          final results = await Future.wait([
            repository.listOrders(),
            repository.listMatches(),
            repository.listTrips(),
          ]);
          final next = MerchantDashboardState(
            orders: results[0] as List<MerchantOrder>,
            matches: results[1] as List<MerchantMatch>,
            trips: results[2] as List<MerchantTrip>,
          );

          return next;
        },
        publish: (next) => state = AsyncData(next),
        isCurrent: () => ref.mounted && binding.revision == revision,
      );
    } catch (error, stackTrace) {
      if (ref.mounted && binding.revision == revision) {
        state = AsyncError<MerchantDashboardState>(error, stackTrace);
      }
      Error.throwWithStackTrace(error, stackTrace);
    }
  }
}

final merchantOrderDraftProvider =
    NotifierProvider.autoDispose<
      MerchantOrderDraftController,
      List<ParcelDraft>
    >(MerchantOrderDraftController.new);

class MerchantOrderDraftController extends Notifier<List<ParcelDraft>> {
  @override
  List<ParcelDraft> build() => const [ParcelDraft()];

  void restorePending(List<ParcelDraft> parcels) {
    if (parcels.isEmpty || parcels.length > 10) {
      throw const FormatException("Invalid parcel count");
    }
    state = List.unmodifiable(parcels);
  }

  bool get canAdd => state.length < 10;
  bool get canRemove => state.length > 1;

  void addParcel() {
    if (canAdd) state = [...state, const ParcelDraft()];
  }

  void removeParcel(int index) {
    if (!canRemove || index < 0 || index >= state.length) return;
    state = [...state]..removeAt(index);
  }

  void updateParcel(
    int index, {
    String? destinationLabel,
    String? size,
    String? priority,
  }) {
    if (index < 0 || index >= state.length) return;
    final updated = [...state];
    updated[index] = updated[index].copyWith(
      destinationLabel: destinationLabel,
      size: size,
      priority: priority,
    );
    state = updated;
  }
}

class MerchantOrderViewState {
  const MerchantOrderViewState({
    required this.order,
    required this.matches,
    required this.trip,
  });

  final MerchantOrder order;
  final List<MerchantMatch> matches;
  final MerchantTrip? trip;

  MerchantMatch? get latestMatch => matches.isEmpty ? null : matches.first;
  bool get canRunMatch =>
      order.status == 'batched' &&
      order.latestBatch?.status == 'created' &&
      !matches.any(
        (match) =>
            match.status == 'proposed' ||
            match.status == 'sent_to_driver' ||
            match.status == 'accepted',
      );
}

final merchantOrderProvider = AsyncNotifierProvider.autoDispose
    .family<MerchantOrderController, MerchantOrderViewState, String>(
      MerchantOrderController.new,
    );

class MerchantOrderController extends AsyncNotifier<MerchantOrderViewState> {
  late AuthoritativeRefresh<MerchantOrderViewState> _reads;
  MerchantOrderController(this._orderId);
  final String _orderId;

  @override
  Future<MerchantOrderViewState> build() {
    _reads = AuthoritativeRefresh<MerchantOrderViewState>();
    ref.onDispose(_reads.dispose);
    return refresh();
  }

  Future<MerchantOrderViewState> refresh() async {
    final binding = ref.read(authenticatedActorBindingProvider);
    final revision = binding.revision;
    return await _reads.run(
      load: () async {
        final repository = ref.read(merchantRepositoryProvider);
        final results = await Future.wait([
          repository.orderDetail(_orderId),
          repository.listMatches(),
          repository.listTrips(),
        ]);
        final order = results[0] as MerchantOrder;
        final matches = (results[1] as List<MerchantMatch>)
            .where(
              (match) =>
                  match.order.id == _orderId ||
                  order.batches.any((batch) => batch.id == match.batch?.id),
            )
            .toList();
        final trips = (results[2] as List<MerchantTrip>)
            .where(
              (trip) =>
                  trip.order.id == _orderId ||
                  order.batches.any((batch) => batch.id == trip.batch?.id),
            )
            .toList();
        final next = MerchantOrderViewState(
          order: order,
          matches: matches,
          trip: trips.isEmpty ? null : trips.first,
        );

        return next;
      },
      publish: (next) => state = AsyncData(next),
      isCurrent: () => ref.mounted && binding.revision == revision,
    );
  }

  Future<void> createBatch() async {
    await ref.read(merchantRepositoryProvider).createBatch(_orderId);
    await refresh();
    ref.invalidate(merchantDashboardProvider);
  }

  Future<void> cancelOrder() async {
    await ref.read(merchantRepositoryProvider).cancelOrder(_orderId);
    await refresh();
    ref.invalidate(merchantDashboardProvider);
    ref.invalidate(merchantMatchInboxProvider);
  }

  Future<MerchantMatch> runMatch() async {
    final match = await ref.read(merchantRepositoryProvider).runMatch(_orderId);
    await refresh();
    ref.invalidate(merchantDashboardProvider);
    ref.invalidate(merchantMatchInboxProvider);
    return match;
  }
}

final merchantMatchInboxProvider =
    AsyncNotifierProvider.autoDispose<
      MerchantMatchInboxController,
      List<MerchantMatch>
    >(MerchantMatchInboxController.new);

class MerchantMatchInboxController extends AsyncNotifier<List<MerchantMatch>> {
  late AuthoritativeRefresh<List<MerchantMatch>> _reads;
  @override
  Future<List<MerchantMatch>> build() {
    _reads = AuthoritativeRefresh<List<MerchantMatch>>();
    ref.onDispose(_reads.dispose);
    return refresh();
  }

  Future<List<MerchantMatch>> refresh({String? status}) async {
    final binding = ref.read(authenticatedActorBindingProvider);
    final revision = binding.revision;
    return await _reads.run(
      load: () async {
        final matches = await ref
            .read(merchantRepositoryProvider)
            .listMatches(status: status);

        return matches;
      },
      publish: (next) => state = AsyncData(next),
      isCurrent: () => ref.mounted && binding.revision == revision,
    );
  }
}

final merchantMatchDetailProvider = AsyncNotifierProvider.autoDispose
    .family<MerchantMatchDetailController, MerchantMatch, String>(
      MerchantMatchDetailController.new,
    );

class MerchantMatchDetailController extends AsyncNotifier<MerchantMatch> {
  MerchantMatchDetailController(this._matchId);
  final String _matchId;
  late AuthoritativeRefresh<MerchantMatch> _reads;
  @override
  Future<MerchantMatch> build() {
    _reads = AuthoritativeRefresh<MerchantMatch>();
    ref.onDispose(_reads.dispose);
    return refresh();
  }

  Future<MerchantMatch> refresh() {
    final binding = ref.read(authenticatedActorBindingProvider);
    final revision = binding.revision;
    return _reads.run(
      load: () => ref.read(merchantRepositoryProvider).matchDetail(_matchId),
      publish: (value) => state = AsyncData(value),
      isCurrent: () => ref.mounted && binding.revision == revision,
    );
  }
}

final merchantTripProvider = AsyncNotifierProvider.autoDispose
    .family<MerchantTripController, MerchantTripViewState, String>(
      MerchantTripController.new,
    );

class MerchantTripController extends AsyncNotifier<MerchantTripViewState> {
  MerchantTripController(this._tripId);
  final String _tripId;
  Timer? _tripTimer;
  Timer? _orderTimer;
  Timer? _locationTimer;
  bool _tripRunning = false;
  bool _orderRunning = false;
  bool _locationRunning = false;

  bool get isPolling =>
      _tripTimer != null || _orderTimer != null || _locationTimer != null;
  int get activeTimerCount =>
      (_tripTimer == null ? 0 : 1) +
      (_orderTimer == null ? 0 : 1) +
      (_locationTimer == null ? 0 : 1);

  @override
  Future<MerchantTripViewState> build() async {
    ref.onDispose(pausePolling);
    final initial = await _load();
    resumePolling();
    return initial;
  }

  Future<void> refresh() async => state = AsyncData(await _load());

  void resumePolling() {
    if (isPolling) return;
    _tripTimer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => unawaited(_refreshTrip()),
    );
    _orderTimer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => unawaited(_refreshOrder()),
    );
    _locationTimer = Timer.periodic(
      const Duration(seconds: 3),
      (_) => unawaited(_refreshLocation()),
    );
  }

  void pausePolling() {
    _tripTimer?.cancel();
    _orderTimer?.cancel();
    _locationTimer?.cancel();
    _tripTimer = null;
    _orderTimer = null;
    _locationTimer = null;
  }

  Future<MerchantTripViewState> _load() async {
    final repository = ref.read(merchantRepositoryProvider);
    final trip = await repository.tripDetail(_tripId);
    final results = await Future.wait([
      repository.orderDetail(trip.order.id),
      repository.latestLocation(_tripId),
    ]);
    return MerchantTripViewState(
      trip: trip,
      order: results[0] as MerchantOrder,
      location: results[1] as TripLocation?,
    );
  }

  Future<void> _refreshTrip() async {
    if (_tripRunning) return;
    _tripRunning = true;
    try {
      final trip = await ref
          .read(merchantRepositoryProvider)
          .tripDetail(_tripId);
      final current = state.value;
      if (current != null) {
        state = AsyncData(
          MerchantTripViewState(
            trip: trip,
            order: current.order,
            location: current.location,
          ),
        );
      }
    } catch (_) {
      // Keep the last good read-only state while polling.
    } finally {
      _tripRunning = false;
    }
  }

  Future<void> _refreshOrder() async {
    final current = state.value;
    if (_orderRunning || current == null) return;
    _orderRunning = true;
    try {
      final order = await ref
          .read(merchantRepositoryProvider)
          .orderDetail(current.order.id);
      final latest = state.value;
      if (latest != null) {
        state = AsyncData(
          MerchantTripViewState(
            trip: latest.trip,
            order: order,
            location: latest.location,
          ),
        );
      }
    } catch (_) {
      // Keep the last good read-only state while polling.
    } finally {
      _orderRunning = false;
    }
  }

  Future<void> _refreshLocation() async {
    if (_locationRunning) return;
    _locationRunning = true;
    try {
      final location = await ref
          .read(merchantRepositoryProvider)
          .latestLocation(_tripId);
      final current = state.value;
      if (current != null && location != null) {
        state = AsyncData(
          MerchantTripViewState(
            trip: current.trip,
            order: current.order,
            location: location,
          ),
        );
      }
    } catch (_) {
      // Keep the last good read-only state while polling.
    } finally {
      _locationRunning = false;
    }
  }
}
