import '../../delivery_handover/data/delivery_handover_models.dart';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_error.dart';
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
  Future<MerchantOrder> submit(List<ParcelDraft> parcels) => _run((
    actor,
  ) async {
    final payload = MerchantRepository.createOrderBody(parcels);
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
      // Only a definitive rejection of this first send proves it never committed.
      // Reconciliation failures, malformed success, transport loss and 5xx retain identity.
      if (const {400, 422}.contains(error.statusCode) &&
          error.message != 'invalid_response') {
        _require(actor);
        await storage.clear(pending, guard: () => _require(actor));
      }
      rethrow;
    }
  });
  Future<MerchantOrder> _resume(
    MerchantPendingOrder pending,
    _OrderActor actor,
  ) async {
    final saved = await _lookup(pending, actor);
    if (saved != null) return saved;
    return _send(pending, actor);
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
      if (pending.expired(_now())) {
        throw const MerchantOrderRecoveryException(
          'merchant_order_recovery_expired',
        );
      }
      return null;
    }
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
    final expected =
        (pending.payload['parcels'] as List)
            .map(
              (p) => '${p['destination_label']}|${p['size']}|${p['priority']}',
            )
            .toList()
          ..sort();
    final actual =
        order.parcels
            .map((p) => '${p.destinationLabel}|${p.size}|${p.priority}')
            .toList()
          ..sort();
    if (order.id.isEmpty ||
        order.pickupLabel != pending.payload['pickup_label'] ||
        order.parcels.any((p) => p.id.isEmpty) ||
        order.parcels.map((p) => p.id).toSet().length != order.parcels.length ||
        jsonEncode(expected) != jsonEncode(actual)) {
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
