import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_error.dart';
import '../../auth/application/auth_controller.dart';
import '../../canonical_assignments/application/canonical_assignment_controller.dart';
import '../../canonical_assignments/domain/canonical_assignment_models.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../canonical_routes/data/canonical_operation_storage.dart';
import '../../canonical_routes/data/canonical_route_repository.dart';
import '../data/shared_trip_repository.dart';
import '../domain/shared_trip_models.dart';

class SharedOfferInboxState {
  const SharedOfferInboxState({
    required this.offers,
    required this.nextCursor,
    required this.clock,
    this.loadingMore = false,
  });

  final List<SharedDriverOffer> offers;
  final String? nextCursor;
  final ServerClock clock;
  final bool loadingMore;
}

final sharedDriverOffersProvider =
    AsyncNotifierProvider<SharedDriverOffersNotifier, SharedOfferInboxState>(
      SharedDriverOffersNotifier.new,
    );

class SharedDriverOffersNotifier extends AsyncNotifier<SharedOfferInboxState> {
  var _generation = 0;

  @override
  Future<SharedOfferInboxState> build() => _firstPage();

  Future<SharedOfferInboxState> _firstPage() async {
    await _requireSharedCapability();
    final page = await ref.read(sharedTripRepositoryProvider).driverOffers();
    return SharedOfferInboxState(
      offers: page.offers,
      nextCursor: page.nextCursor,
      clock: ServerClock.sample(page.serverNow),
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
    state = AsyncData(
      SharedOfferInboxState(
        offers: current.offers,
        nextCursor: current.nextCursor,
        clock: current.clock,
        loadingMore: true,
      ),
    );
    try {
      await _requireSharedCapability();
      final page = await ref
          .read(sharedTripRepositoryProvider)
          .driverOffers(cursor: current.nextCursor);
      if (generation != _generation) return;
      final ids = current.offers.map((offer) => offer.id).toSet();
      state = AsyncData(
        SharedOfferInboxState(
          offers: List.unmodifiable([
            ...current.offers,
            ...page.offers.where((offer) => ids.add(offer.id)),
          ]),
          nextCursor: page.nextCursor,
          clock: ServerClock.sample(page.serverNow),
        ),
      );
    } catch (error, stackTrace) {
      if (generation == _generation) state = AsyncData(current);
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<void> _requireSharedCapability() => requireFreshSharedCapability(ref);
}

class SharedOfferDetailState {
  const SharedOfferDetailState({
    required this.offer,
    required this.clock,
    required this.recoveryPending,
    this.mutating = false,
    this.uncertain = false,
  });

  final SharedDriverOffer offer;
  final ServerClock clock;
  final bool recoveryPending;
  final bool mutating;
  final bool uncertain;

  SharedOfferDetailState copyWith({
    SharedDriverOffer? offer,
    ServerClock? clock,
    bool? recoveryPending,
    bool? mutating,
    bool? uncertain,
  }) => SharedOfferDetailState(
    offer: offer ?? this.offer,
    clock: clock ?? this.clock,
    recoveryPending: recoveryPending ?? this.recoveryPending,
    mutating: mutating ?? this.mutating,
    uncertain: uncertain ?? this.uncertain,
  );
}

final sharedDriverOfferDetailProvider =
    AsyncNotifierProvider.family<
      SharedDriverOfferDetailNotifier,
      SharedOfferDetailState,
      String
    >(SharedDriverOfferDetailNotifier.new);

class SharedDriverOfferDetailNotifier
    extends AsyncNotifier<SharedOfferDetailState> {
  SharedDriverOfferDetailNotifier(this.offerId);

  final String offerId;
  var _generation = 0;
  bool _mutating = false;

  @override
  Future<SharedOfferDetailState> build() => _load(reconcile: true);

  Future<SharedOfferDetailState> _load({
    required bool reconcile,
    CanonicalOperationBundle? expectedBundle,
  }) async {
    await requireFreshSharedCapability(ref);
    final actorId = _actorId();
    final pending = expectedBundle ?? await _pendingForActor(actorId);
    final envelope = await ref
        .read(sharedTripRepositoryProvider)
        .driverOffer(offerId);
    final belongs =
        pending != null &&
        pending.payload['offer_id'] == offerId &&
        _isSharedOfferOperation(pending.operation);
    if (reconcile &&
        belongs &&
        _terminalResultMatches(pending, envelope.offer)) {
      await ref
          .read(canonicalMutationRunnerProvider)
          .acknowledge(
            actorId: actorId,
            operation: pending.operation,
            idempotencyKey: pending.idempotencyKey,
          );
    }
    return SharedOfferDetailState(
      offer: envelope.offer,
      clock: ServerClock.sample(envelope.serverNow),
      recoveryPending:
          belongs && !_terminalResultMatches(pending, envelope.offer),
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
    operation: 'canonical_shared_offer_accept_v1',
    payload: (offer) => {
      'route_version_id': offer.routeVersionId,
      'offer_id': offer.id,
      'match_version': canonicalSharedMatchVersion,
    },
    send: (repository, bundle) => repository.acceptOffer(
      id: offerId,
      idempotencyKey: bundle.idempotencyKey,
      beforeAuthRetry: () => requireFreshSharedCapability(ref),
    ),
  );

  Future<void> reject(CanonicalRejectReason reason) => _mutate(
    operation: 'canonical_shared_offer_reject_v1',
    payload: (offer) => {
      'route_version_id': offer.routeVersionId,
      'offer_id': offer.id,
      'match_version': canonicalSharedMatchVersion,
      'reason': reason.apiValue,
    },
    send: (repository, bundle) => repository.rejectOffer(
      id: offerId,
      reason: reason,
      idempotencyKey: bundle.idempotencyKey,
      beforeAuthRetry: () => requireFreshSharedCapability(ref),
    ),
  );

  Future<void> recover() async {
    final actorId = _actorId();
    final pending = await _pendingForActor(actorId);
    if (pending == null ||
        pending.payload['offer_id'] != offerId ||
        !_isSharedOfferOperation(pending.operation)) {
      throw const CanonicalOperationBlocked('canonical_recovery_unresolved');
    }
    if (pending.operation == 'canonical_shared_offer_accept_v1') {
      return accept();
    }
    final reason = CanonicalRejectReason.values
        .where((value) => value.apiValue == pending.payload['reason'])
        .firstOrNull;
    if (reason == null) {
      throw const CanonicalOperationBlocked('canonical_recovery_unreadable');
    }
    return reject(reason);
  }

  Future<void> _mutate({
    required String operation,
    required Map<String, dynamic> Function(SharedDriverOffer offer) payload,
    required Future<SharedOfferEnvelope> Function(
      SharedTripRepository repository,
      CanonicalOperationBundle bundle,
    )
    send,
  }) async {
    if (_mutating) throw StateError('operation_in_progress');
    final current = state.value;
    if (current == null || !current.offer.actionableAt(current.clock.now)) {
      throw StateError('shared_offer_not_actionable');
    }
    ++_generation;
    _mutating = true;
    state = AsyncData(current.copyWith(mutating: true, uncertain: false));
    final actorId = _actorId();
    try {
      final previousPending = await _pendingForActor(actorId);
      final fresh = await _freshOffer();
      if (!fresh.offer.actionableAt(fresh.serverNow)) {
        final pending = previousPending;
        if (pending != null && _terminalResultMatches(pending, fresh.offer)) {
          await ref
              .read(canonicalMutationRunnerProvider)
              .acknowledge(
                actorId: actorId,
                operation: pending.operation,
                idempotencyKey: pending.idempotencyKey,
              );
          state = AsyncData(
            SharedOfferDetailState(
              offer: fresh.offer,
              clock: ServerClock.sample(fresh.serverNow),
              recoveryPending: false,
            ),
          );
          return;
        }
        state = AsyncData(
          SharedOfferDetailState(
            offer: fresh.offer,
            clock: ServerClock.sample(fresh.serverNow),
            recoveryPending: false,
          ),
        );
        throw StateError(
          fresh.offer.status == SharedOfferStatus.offered
              ? 'shared_offer_expired'
              : 'shared_offer_not_actionable',
        );
      }
      final receipt = await ref
          .read(canonicalMutationRunnerProvider)
          .runWithReceipt<SharedOfferEnvelope>(
            operation: operation,
            scope: 'driver',
            actorId: actorId,
            payload: payload(fresh.offer),
            send: (bundle) =>
                send(ref.read(sharedTripRepositoryProvider), bundle),
          );
      final reconciled = await _load(
        reconcile: true,
        expectedBundle: receipt.bundle,
      );
      state = AsyncData(reconciled);
      ref.invalidate(sharedDriverOffersProvider);
      ref.invalidate(driverCanonicalOffersProvider);
      ref.invalidate(passengerCanonicalAssignmentsProvider);
      ref.invalidate(merchantCanonicalAssignmentsProvider);
    } catch (error, stackTrace) {
      if (error is ApiException && error.statusCode == 404) {
        ref.invalidate(mobileCapabilitiesProvider);
      }
      final pending = await _pendingForActor(actorId);
      final latest = state.value ?? current;
      final belongs = pending?.payload['offer_id'] == offerId;
      state = AsyncData(
        latest.copyWith(
          mutating: false,
          recoveryPending: belongs,
          uncertain: belongs,
        ),
      );
      Error.throwWithStackTrace(error, stackTrace);
    } finally {
      _mutating = false;
    }
  }

  Future<SharedOfferEnvelope> _freshOffer() async {
    await requireFreshSharedCapability(ref);
    return ref.read(sharedTripRepositoryProvider).driverOffer(offerId);
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

Future<void> requireFreshSharedCapability(Ref ref) async {
  final capabilities = await ref
      .read(canonicalRouteRepositoryProvider)
      .capabilities();
  if (!capabilities.canonicalSharedTripPresentationAvailable ||
      !capabilities.canonicalSharedDriverOffersAvailable ||
      !capabilities.canonicalSharedAssignmentStatusAvailable) {
    throw const SharedTripFeatureUnavailable();
  }
}

bool _isSharedOfferOperation(String operation) =>
    operation == 'canonical_shared_offer_accept_v1' ||
    operation == 'canonical_shared_offer_reject_v1';

bool _terminalResultMatches(
  CanonicalOperationBundle pending,
  SharedDriverOffer offer,
) {
  if (pending.payload['offer_id'] != offer.id ||
      pending.payload['match_version'] != canonicalSharedMatchVersion) {
    return false;
  }
  if (pending.operation == 'canonical_shared_offer_accept_v1') {
    return offer.status == SharedOfferStatus.accepted && offer.trip != null;
  }
  return pending.operation == 'canonical_shared_offer_reject_v1' &&
      offer.status == SharedOfferStatus.rejected &&
      offer.trip == null &&
      offer.rejectReason?.apiValue == pending.payload['reason'];
}

class SharedTripFeatureUnavailable implements Exception {
  const SharedTripFeatureUnavailable();

  @override
  String toString() => 'shared_trip_feature_unavailable';
}
