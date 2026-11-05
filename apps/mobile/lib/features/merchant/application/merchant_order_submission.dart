import '../../delivery_handover/data/delivery_handover_models.dart';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_error.dart';
import '../../../core/api/saved_request_outcome.dart';
import '../../auth/application/auth_actor_binding.dart';
import '../data/merchant_models.dart';
import '../data/merchant_order_operation_storage.dart';
import '../data/merchant_repository.dart';

final merchantOrderSubmissionProvider = Provider<MerchantOrderSubmission>(
  (ref) => MerchantOrderSubmission(
    storage: ref.watch(merchantOrderOperationStorageProvider),
    repository: ref.watch(merchantRepositoryProvider),
    binding: ref.watch(authenticatedActorBindingProvider),
  ),
);

class MerchantOrderSubmission {
  MerchantOrderSubmission({
    required this.storage,
    required this.repository,
    required this.binding,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;
  final MerchantOrderOperationStorage storage;
  final MerchantRepository repository;
  final AuthenticatedActorBinding binding;
  final DateTime Function() _now;
  bool _busy = false;
  final _cleanupBlockedActors = <String>{};

  _OrderActor _actor() {
    final id = binding.actorId;
    if (id == null) {
      throw const MerchantOrderRecoveryException('merchant_order_auth_changed');
    }
    if (_cleanupBlockedActors.contains(id)) {
      throw const MerchantOrderRecoveryException(
        'merchant_order_cleanup_failed',
      );
    }
    return _OrderActor(id, binding.revision);
  }

  void _require(_OrderActor actor) {
    if (binding.actorId != actor.id || binding.revision != actor.revision) {
      throw const MerchantOrderRecoveryException('merchant_order_auth_changed');
    }
  }

  Future<T> _run<T>(Future<T> Function(_OrderActor) work) async {
    if (_busy) {
      throw const MerchantOrderRecoveryException('merchant_order_in_progress');
    }
    _busy = true;
    try {
      return await work(_actor());
    } finally {
      _busy = false;
    }
  }

  Future<MerchantPendingOrder?> pending() async {
    final actor = _actor();
    final value = await storage.read(actor.id);
    _require(actor);
    return value;
  }

  Future<MerchantOrder?> recover() => _run((actor) async {
    final pending = await storage.read(actor.id);
    _require(actor);
    if (pending == null) return null;
    return _lookup(pending, actor);
  });
  Future<MerchantOrder> resume() => _run((actor) async {
    final pending = await storage.read(actor.id);
    _require(actor);
    if (pending == null) {
      throw const MerchantOrderRecoveryException(
        'merchant_order_recovery_unreadable',
      );
    }
    return _resume(pending, actor);
  });
  Future<MerchantOrder> submit({
    required String serviceRouteId,
    String? pickupPlaceId,
    String pickupDetails = '',
    required List<ParcelDraft> parcels,
  }) => _run((actor) async {
    final payload = MerchantRepository.createOrderBody(
      serviceRouteId: serviceRouteId,
      pickupPlaceId: pickupPlaceId,
      pickupDetails: pickupDetails,
      parcels: parcels,
    );
    final previous = await storage.read(actor.id);
    _require(actor);
    if (previous != null) {
      if (jsonEncode(previous.payload) != jsonEncode(payload)) {
        throw const MerchantOrderRecoveryException('merchant_order_pending');
      }
      return _resume(previous, actor);
    }
    final pending = MerchantPendingOrder.create(
      actorId: actor.id,
      payload: payload,
      now: _now(),
    );
    await storage.save(pending);
    _require(actor);
    try {
      return await _send(pending, actor);
    } on ApiException catch (error) {
      // Only a definitive rejection of this first send proves it never committed
      // (a route turned off before the first send is one too). Malformed
      // success, transport loss, 429 and 5xx retain identity.
      if (isDefiniteRejection(error)) {
        _require(actor);
        await storage.clear(pending, guard: () => _require(actor));
      }
      rethrow;
    }
  });

  /// Drops this merchant's saved order, readable or not, so they can start
  /// again. The screen asks first: if the earlier send did arrive, a new
  /// order is a duplicate.
  Future<void> discard() async {
    if (_busy) {
      throw const MerchantOrderRecoveryException('merchant_order_in_progress');
    }
    _busy = true;
    try {
      final id = binding.actorId;
      if (id == null) {
        throw const MerchantOrderRecoveryException(
          'merchant_order_auth_changed',
        );
      }
      final actor = _OrderActor(id, binding.revision);
      await storage.discard(id);
      _require(actor);
      _cleanupBlockedActors.remove(id);
    } finally {
      _busy = false;
    }
  }

  Future<MerchantOrder> _resume(
    MerchantPendingOrder pending,
    _OrderActor actor,
  ) async {
    final saved = await _lookup(pending, actor);
    if (saved != null) return saved;
    try {
      return await _send(pending, actor);
    } on ApiException catch (error) {
      if (!isDefiniteRejection(error)) rethrow;
      // The server refused the resend for good: keeping the order would lock
      // the form forever. Lost responses, 429 and 5xx keep it for retry.
      _require(actor);
      await storage.clear(pending, guard: () => _require(actor));
      throw SavedRequestRejected(error);
    }
  }

  Future<MerchantOrder?> _lookup(
    MerchantPendingOrder pending,
    _OrderActor actor,
  ) async {
    try {
      final order = await repository.recoverOrder(
        pending.idempotencyKey,
        beforeSend: () => _require(actor),
      );
      return _acknowledge(pending, actor, order);
    } on ApiException catch (error) {
      _require(actor);
      if (error.statusCode != 404 ||
          error.message != 'merchant_order_operation_not_found') {
        rethrow;
      }
      if (pending.expired(_now())) await _expire(pending, actor);
      return null;
    }
  }

  /// A saved order the server does not know, past its retry window, is
  /// removed so the form opens again. One dated in the future (a clock that
  /// moved backwards) is kept until it can be judged.
  Future<Never> _expire(MerchantPendingOrder pending, _OrderActor actor) async {
    if (!pending.windowPassed(_now())) {
      throw const MerchantOrderRecoveryException(
        'merchant_order_recovery_expired',
      );
    }
    _require(actor);
    await storage.clear(pending, guard: () => _require(actor));
    throw const SavedRequestExpired();
  }

  Future<MerchantOrder> _send(
    MerchantPendingOrder pending,
    _OrderActor actor,
  ) async {
    void guard() {
      _require(actor);
      if (pending.expired(_now())) {
        throw const MerchantOrderRecoveryException(
          'merchant_order_recovery_expired',
        );
      }
    }

    guard();
    final order = await repository.createOrderPayload(
      pending.payload,
      idempotencyKey: pending.idempotencyKey,
      beforeSend: guard,
    );
    // The receiver's hand-over code is only in this response; keep it for the session.
    HandoverCodeVault.remember(order.id, order.handover?.code);
    return _acknowledge(pending, actor, order);
  }

  Future<MerchantOrder> _acknowledge(
    MerchantPendingOrder pending,
    _OrderActor actor,
    MerchantOrder order,
  ) async {
    _require(actor);
    final payload = pending.payload;
    // Orders saved by builds before routes existed name corridor places; the
    // server echoes those labels. Route orders are checked by their own text.
    final routeShape = payload.containsKey('service_route_id');
    final placeKey = routeShape ? 'dropoff_details' : 'destination_label';
    final expected =
        (payload['parcels'] as List)
            .map((p) => '${p[placeKey]}|${p['size']}|${p['priority']}')
            .toList()
          ..sort();
    // A place the merchant chose must come back as the same place.
    final expectedPlaces = routeShape
        ? ((payload['parcels'] as List)
              .map((p) => '${p['dropoff_place_id']}')
              .toList()
            ..sort())
        : const <String>[];
    final actualPlaces = routeShape
        ? (order.parcels.map((p) => '${p.dropoffPlaceId}').toList()..sort())
        : const <String>[];
    final actual =
        order.parcels
            .map(
              (p) =>
                  '${routeShape ? p.dropoffDetails : p.destinationLabel}'
                  '|${p.size}|${p.priority}',
            )
            .toList()
          ..sort();
    final samePickup = routeShape
        ? order.pickupDetails == payload['pickup_details'] &&
              order.pickupPlaceId == payload['pickup_place_id'] &&
              (order.serviceRouteId == null ||
                  order.serviceRouteId == payload['service_route_id'])
        : order.pickupLabel == payload['pickup_label'];
    if (order.id.isEmpty ||
        !samePickup ||
        order.parcels.any((p) => p.id.isEmpty) ||
        order.parcels.map((p) => p.id).toSet().length != order.parcels.length ||
        jsonEncode(expected) != jsonEncode(actual) ||
        jsonEncode(expectedPlaces) != jsonEncode(actualPlaces)) {
      throw const MerchantOrderRecoveryException(
        'merchant_order_recovery_unreadable',
      );
    }
    try {
      await storage.clear(pending, guard: () => _require(actor));
      _require(actor);
    } catch (error, stack) {
      // The final continuation after clear is another session-change boundary.
      // Preserve exact identity through that boundary before releasing single flight.
      try {
        await storage.preserve(pending);
      } catch (_) {
        _cleanupBlockedActors.add(actor.id);
        throw const MerchantOrderRecoveryException(
          'merchant_order_cleanup_failed',
        );
      }
      Error.throwWithStackTrace(error, stack);
    }
    return order;
  }
}

class _OrderActor {
  const _OrderActor(this.id, this.revision);
  final String id;
  final int revision;
}
