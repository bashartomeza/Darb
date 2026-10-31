import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_error.dart';
import '../../auth/application/auth_controller.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../canonical_routes/data/canonical_operation_storage.dart';
import '../data/canonical_assignment_repository.dart';
import '../domain/canonical_assignment_models.dart';

class DriverOfferInboxState {
  const DriverOfferInboxState({
    required this.offers,
    required this.nextCursor,
    required this.serverNow,
    this.loadingMore = false,
  });

  final List<CanonicalDriverOffer> offers;
  final String? nextCursor;
  final DateTime serverNow;
  final bool loadingMore;

  DriverOfferInboxState copyWith({
    List<CanonicalDriverOffer>? offers,
    String? nextCursor,
    bool clearCursor = false,
    DateTime? serverNow,
    bool? loadingMore,
  }) {
    return DriverOfferInboxState(
      offers: offers ?? this.offers,
      nextCursor: clearCursor ? null : nextCursor ?? this.nextCursor,
      serverNow: serverNow ?? this.serverNow,
      loadingMore: loadingMore ?? this.loadingMore,
    );
  }
}

final driverCanonicalOffersProvider =
    AsyncNotifierProvider<DriverCanonicalOffersNotifier, DriverOfferInboxState>(
      DriverCanonicalOffersNotifier.new,
    );

class DriverCanonicalOffersNotifier
    extends AsyncNotifier<DriverOfferInboxState> {
  var _generation = 0;

  @override
  Future<DriverOfferInboxState> build() async {
    final capabilities = await ref.watch(mobileCapabilitiesProvider.future);
    if (!capabilities.driverCanonicalOffersAvailable) {
      return DriverOfferInboxState(
        offers: const [],
        nextCursor: null,
        serverNow: DateTime.now().toUtc(),
      );
    }
    return _firstPage();
  }

  Future<DriverOfferInboxState> _firstPage() async {
    final page = await ref
        .read(canonicalAssignmentRepositoryProvider)
        .driverOffers();
    return DriverOfferInboxState(
      offers: page.offers,
      nextCursor: page.nextCursor,
      serverNow: page.serverNow,
    );
  }

  Future<void> refresh() async {
    final generation = ++_generation;
    final previous = state.value;
    if (previous == null) state = const AsyncLoading();
    try {
      final next = await _firstPage();
      if (generation == _generation) state = AsyncData(next);
    } catch (error, stackTrace) {
      if (generation == _generation) {
        state = previous == null
            ? AsyncError(error, stackTrace)
            : AsyncData(previous);
      }
      rethrow;
    }
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || current.loadingMore || current.nextCursor == null) {
      return;
    }
    final generation = ++_generation;
    state = AsyncData(current.copyWith(loadingMore: true));
    try {
      final page = await ref
          .read(canonicalAssignmentRepositoryProvider)
          .driverOffers(cursor: current.nextCursor);
      if (generation != _generation) return;
      final ids = current.offers.map((offer) => offer.id).toSet();
      state = AsyncData(
        DriverOfferInboxState(
          offers: List.unmodifiable([
            ...current.offers,
            ...page.offers.where((offer) => ids.add(offer.id)),
          ]),
          nextCursor: page.nextCursor,
          serverNow: page.serverNow,
        ),
      );
    } catch (error, stackTrace) {
      if (generation == _generation) {
        state = AsyncData(current.copyWith(loadingMore: false));
      }
      Error.throwWithStackTrace(error, stackTrace);
    }
  }
}

class DriverOfferDetailState {
  const DriverOfferDetailState({
    required this.offer,
    required this.serverNow,
    required this.recoveryPending,
    this.mutating = false,
    this.uncertain = false,
  });

  final CanonicalDriverOffer offer;
  final DateTime serverNow;
  final bool recoveryPending;
  final bool mutating;
  final bool uncertain;

  DriverOfferDetailState copyWith({
    CanonicalDriverOffer? offer,
    DateTime? serverNow,
    bool? recoveryPending,
    bool? mutating,
    bool? uncertain,
  }) {
    return DriverOfferDetailState(
      offer: offer ?? this.offer,
      serverNow: serverNow ?? this.serverNow,
      recoveryPending: recoveryPending ?? this.recoveryPending,
      mutating: mutating ?? this.mutating,
      uncertain: uncertain ?? this.uncertain,
    );
  }
}

final driverCanonicalOfferDetailProvider =
    AsyncNotifierProvider.family<
      DriverCanonicalOfferDetailNotifier,
      DriverOfferDetailState,
      String
    >(DriverCanonicalOfferDetailNotifier.new);

class DriverCanonicalOfferDetailNotifier
    extends AsyncNotifier<DriverOfferDetailState> {
  DriverCanonicalOfferDetailNotifier(this.offerId);

  final String offerId;
  var _generation = 0;
  bool _mutating = false;

  @override
  Future<DriverOfferDetailState> build() => _load(reconcile: true);

  Future<DriverOfferDetailState> _load({
    required bool reconcile,
    CanonicalOperationBundle? expectedBundle,
  }) async {
    final actorId = _actorId();
    final pending = expectedBundle ?? await _pendingForActor(actorId);
    final envelope = await ref
        .read(canonicalAssignmentRepositoryProvider)
        .driverOffer(offerId);
    final belongsToOffer =
        pending != null &&
        pending.payload['offer_id'] == offerId &&
        _isOfferOperation(pending.operation);
    if (reconcile && belongsToOffer && !envelope.offer.actionable) {
      await ref
          .read(canonicalMutationRunnerProvider)
          .acknowledge(
            actorId: actorId,
            operation: pending.operation,
            idempotencyKey: pending.idempotencyKey,
          );
    }
    return DriverOfferDetailState(
      offer: envelope.offer,
      serverNow: envelope.serverNow,
      recoveryPending: belongsToOffer && envelope.offer.actionable,
    );
  }

  Future<void> refresh() async {
    if (_mutating) return;
    final generation = ++_generation;
    final previous = state.value;
    if (previous == null) state = const AsyncLoading();
    try {
      final next = await _load(reconcile: true);
      if (generation == _generation) state = AsyncData(next);
    } catch (error, stackTrace) {
      if (generation == _generation && previous == null) {
        state = AsyncError(error, stackTrace);
      }
      rethrow;
    }
  }

  Future<void> accept() => _mutate(
    operation: 'driver_canonical_offer_accept',
    payload: (offer) => {
      'route_version_id': offer.routeVersionId,
      'offer_id': offer.id,
    },
    send: (repository, bundle) => repository.acceptOffer(
      id: offerId,
      idempotencyKey: bundle.idempotencyKey,
    ),
  );

  Future<void> reject(CanonicalRejectReason reason) => _mutate(
    operation: 'driver_canonical_offer_reject',
    payload: (offer) => {
      'route_version_id': offer.routeVersionId,
      'offer_id': offer.id,
      'reason': reason.apiValue,
    },
    send: (repository, bundle) => repository.rejectOffer(
      id: offerId,
      reason: reason,
      idempotencyKey: bundle.idempotencyKey,
    ),
  );

  Future<void> recover() async {
    final actorId = _actorId();
    final pending = await _pendingForActor(actorId);
    if (pending == null ||
        pending.payload['offer_id'] != offerId ||
        !_isOfferOperation(pending.operation)) {
      throw const CanonicalOperationBlocked('canonical_recovery_unresolved');
    }
    if (pending.operation == 'driver_canonical_offer_accept') {
      return accept();
    }
    final rawReason = pending.payload['reason'];
    final reason = CanonicalRejectReason.values
        .where((value) => value.apiValue == rawReason)
        .firstOrNull;
    if (reason == null) {
      throw const CanonicalOperationBlocked('canonical_recovery_unreadable');
    }
    return reject(reason);
  }

  Future<void> _mutate({
    required String operation,
    required Map<String, dynamic> Function(CanonicalDriverOffer offer) payload,
    required Future<CanonicalDriverOffer> Function(
      CanonicalAssignmentRepository repository,
      CanonicalOperationBundle bundle,
    )
    send,
  }) async {
    if (_mutating) throw StateError('operation_in_progress');
    final current = state.value;
    if (current == null || !current.offer.actionable) {
      throw StateError('offer_not_actionable');
    }
    ++_generation;
    _mutating = true;
    state = AsyncData(current.copyWith(mutating: true, uncertain: false));
    final actorId = _actorId();
    try {
      final fresh = await _freshOffer();
      if (!fresh.offer.actionable || fresh.offer.expiredAt(fresh.serverNow)) {
        state = AsyncData(
          DriverOfferDetailState(
            offer: fresh.offer,
            serverNow: fresh.serverNow,
            recoveryPending: false,
          ),
        );
        throw StateError(
          fresh.offer.actionable ? 'offer_expired' : 'offer_not_actionable',
        );
      }
      final receipt = await ref
          .read(canonicalMutationRunnerProvider)
          .runWithReceipt<CanonicalDriverOffer>(
            operation: operation,
            scope: 'driver',
            actorId: actorId,
            payload: payload(fresh.offer),
            send: (bundle) =>
                send(ref.read(canonicalAssignmentRepositoryProvider), bundle),
          );
      final reconciled = await _load(
        reconcile: true,
        expectedBundle: receipt.bundle,
      );
      state = AsyncData(reconciled);
      ref.invalidate(driverCanonicalOffersProvider);
      ref.invalidate(passengerCanonicalAssignmentsProvider);
      ref.invalidate(merchantCanonicalAssignmentsProvider);
    } catch (error, stackTrace) {
      if (error is ApiException && error.statusCode == 404) {
        ref.invalidate(mobileCapabilitiesProvider);
      }
      final pending = await _pendingForActor(actorId);
      final latest = state.value ?? current;
      state = AsyncData(
        latest.copyWith(
          mutating: false,
          recoveryPending:
              pending != null && pending.payload['offer_id'] == offerId,
          uncertain: pending != null && pending.payload['offer_id'] == offerId,
        ),
      );
      Error.throwWithStackTrace(error, stackTrace);
    } finally {
      _mutating = false;
    }
  }

  Future<CanonicalOfferEnvelope> _freshOffer() async {
    await ref.read(mobileCapabilitiesProvider.notifier).refresh();
    final capabilities = await ref.read(mobileCapabilitiesProvider.future);
    if (!capabilities.matchingAvailable ||
        !capabilities.canonicalTripCreationAvailable ||
        !capabilities.driverCanonicalOffersAvailable) {
      throw StateError('canonical_offer_feature_unavailable');
    }
    final envelope = await ref
        .read(canonicalAssignmentRepositoryProvider)
        .driverOffer(offerId);
    return envelope;
  }

  String _actorId() {
    final user = ref.read(authControllerProvider).value?.user;
    if (user == null) throw StateError('authentication_required');
    return user.id;
  }

  Future<CanonicalOperationBundle?> _pendingForActor(String actorId) async {
    final pending = await ref.read(canonicalOperationStorageProvider).read();
    if (pending == null) return null;
    if (pending.recoveryWindowExpired(DateTime.now())) {
      throw const CanonicalOperationBlocked('canonical_recovery_expired');
    }
    if (pending.actorId != actorId) {
      throw const CanonicalOperationBlocked('canonical_recovery_other_account');
    }
    return pending;
  }
}

bool _isOfferOperation(String operation) =>
    operation == 'driver_canonical_offer_accept' ||
    operation == 'driver_canonical_offer_reject';

final passengerCanonicalAssignmentsProvider =
    AsyncNotifierProvider<
      PassengerCanonicalAssignmentsNotifier,
      List<CanonicalAssignment>
    >(PassengerCanonicalAssignmentsNotifier.new);

class PassengerCanonicalAssignmentsNotifier
    extends AsyncNotifier<List<CanonicalAssignment>> {
  var _generation = 0;

  @override
  Future<List<CanonicalAssignment>> build() async {
    final capabilities = await ref.watch(mobileCapabilitiesProvider.future);
    if (!capabilities.canonicalAssignmentStatusAvailable) return const [];
    return ref
        .read(canonicalAssignmentRepositoryProvider)
        .passengerAssignments();
  }

  Future<void> refresh() => _refresh(
    () =>
        ref.read(canonicalAssignmentRepositoryProvider).passengerAssignments(),
  );

  Future<void> _refresh(
    Future<List<CanonicalAssignment>> Function() load,
  ) async {
    final generation = ++_generation;
    final previous = state.value;
    if (previous == null) state = const AsyncLoading();
    try {
      final next = await load();
      if (generation == _generation) state = AsyncData(next);
    } catch (error, stackTrace) {
      if (generation == _generation && previous == null) {
        state = AsyncError(error, stackTrace);
      }
      rethrow;
    }
  }
}

final merchantCanonicalAssignmentsProvider =
    AsyncNotifierProvider<
      MerchantCanonicalAssignmentsNotifier,
      List<CanonicalAssignment>
    >(MerchantCanonicalAssignmentsNotifier.new);

class MerchantCanonicalAssignmentsNotifier
    extends AsyncNotifier<List<CanonicalAssignment>> {
  var _generation = 0;

  @override
  Future<List<CanonicalAssignment>> build() async {
    final capabilities = await ref.watch(mobileCapabilitiesProvider.future);
    if (!capabilities.canonicalAssignmentStatusAvailable) return const [];
    return ref
        .read(canonicalAssignmentRepositoryProvider)
        .merchantAssignments();
  }

  Future<void> refresh() async {
    final generation = ++_generation;
    final previous = state.value;
    if (previous == null) state = const AsyncLoading();
    try {
      final next = await ref
          .read(canonicalAssignmentRepositoryProvider)
          .merchantAssignments();
      if (generation == _generation) state = AsyncData(next);
    } catch (error, stackTrace) {
      if (generation == _generation && previous == null) {
        state = AsyncError(error, stackTrace);
      }
      rethrow;
    }
  }
}

typedef CanonicalAssignmentTarget = ({String role, String id});

final canonicalAssignmentDetailProvider =
    AsyncNotifierProvider.family<
      CanonicalAssignmentDetailNotifier,
      CanonicalAssignmentEnvelope,
      CanonicalAssignmentTarget
    >(CanonicalAssignmentDetailNotifier.new);

class CanonicalAssignmentDetailNotifier
    extends AsyncNotifier<CanonicalAssignmentEnvelope> {
  CanonicalAssignmentDetailNotifier(this.target);

  final CanonicalAssignmentTarget target;
  var _generation = 0;

  @override
  Future<CanonicalAssignmentEnvelope> build() => _load();

  Future<CanonicalAssignmentEnvelope> _load() {
    final repository = ref.read(canonicalAssignmentRepositoryProvider);
    return switch (target.role) {
      'passenger' => repository.passengerAssignment(target.id),
      'merchant' => repository.merchantAssignment(target.id),
      _ => throw StateError('unsupported_assignment_role'),
    };
  }

  Future<void> refresh() async {
    final generation = ++_generation;
    final previous = state.value;
    if (previous == null) state = const AsyncLoading();
    try {
      final next = await _load();
      if (generation == _generation) state = AsyncData(next);
    } catch (error, stackTrace) {
      if (generation == _generation && previous == null) {
        state = AsyncError(error, stackTrace);
      }
      rethrow;
    }
  }
}
