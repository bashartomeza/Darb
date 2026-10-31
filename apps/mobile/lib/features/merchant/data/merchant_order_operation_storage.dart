import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../auth/data/token_storage.dart';
import '../../canonical_routes/data/canonical_operation_storage.dart'
    show newCanonicalIdempotencyKey;

final merchantOrderOperationStorageProvider =
    Provider<MerchantOrderOperationStorage>(
      (ref) => MerchantOrderOperationStorage(ref.watch(secureStorageProvider)),
    );

class MerchantOrderRecoveryException implements Exception {
  const MerchantOrderRecoveryException(this.code);
  final String code;
  @override
  String toString() => code;
}

class MerchantPendingOrder {
  MerchantPendingOrder._(
    this.actorId,
    this.idempotencyKey,
    this._payloadJson,
    this.createdAt,
  );
  final String actorId;
  final String idempotencyKey;
  final String _payloadJson;
  final DateTime createdAt;
  static const recoveryWindow = Duration(days: 7);
  Map<String, dynamic> get payload =>
      jsonDecode(_payloadJson) as Map<String, dynamic>;
  bool expired(DateTime now) =>
      !now.toUtc().isBefore(createdAt.add(recoveryWindow)) ||
      createdAt.isAfter(now.toUtc().add(const Duration(minutes: 5)));

  factory MerchantPendingOrder.create({
    required String actorId,
    required Map<String, dynamic> payload,
    DateTime? now,
  }) => MerchantPendingOrder.fromJson({
    'version': 1,
    'actor_id': actorId,
    'idempotency_key': newCanonicalIdempotencyKey(),
    'payload': payload,
    'created_at': (now ?? DateTime.now()).toUtc().toIso8601String(),
  });
  Map<String, dynamic> toJson() => {
    'version': 1,
    'actor_id': actorId,
    'idempotency_key': idempotencyKey,
    'payload': payload,
    'created_at': createdAt.toIso8601String(),
  };
  factory MerchantPendingOrder.fromJson(Map<String, dynamic> json) {
    const keys = {
      'version',
      'actor_id',
      'idempotency_key',
      'payload',
      'created_at',
    };
    final actor = json['actor_id'];
    final key = json['idempotency_key'];
    final value = json['payload'];
    final created = json['created_at'] is String
        ? DateTime.tryParse(json['created_at'] as String)
        : null;
    if (json.keys.toSet().difference(keys).isNotEmpty ||
        json.length != keys.length ||
        json['version'] != 1 ||
        actor is! String ||
        actor.isEmpty ||
        actor.length > 191 ||
        key is! String ||
        !RegExp(r'^[A-Za-z0-9._:-]{8,128}$').hasMatch(key) ||
        value is! Map<String, dynamic> ||
        created == null ||
        !_validPayload(value)) {
      throw const MerchantOrderRecoveryException(
        'merchant_order_recovery_unreadable',
      );
    }
    return MerchantPendingOrder._(
      actor,
      key,
      jsonEncode(value),
      created.toUtc(),
    );
  }
}

bool _validPayload(Map<String, dynamic> value) {
  bool point(Map<String, dynamic> map, String label, String lat, String lng) =>
      map[label] is String &&
      (map[label] as String).isNotEmpty &&
      map[lat] is num &&
      (map[lat] as num).isFinite &&
      (map[lat] as num).abs() <= 90 &&
      map[lng] is num &&
      (map[lng] as num).isFinite &&
      (map[lng] as num).abs() <= 180;
  if (value.length != 4 ||
      !point(value, 'pickup_label', 'pickup_lat', 'pickup_lng')) {
    return false;
  }
  final parcels = value['parcels'];
  return parcels is List &&
      parcels.isNotEmpty &&
      parcels.length <= 10 &&
      parcels.every(
        (p) =>
            p is Map<String, dynamic> &&
            p.length == 5 &&
            point(
              p,
              'destination_label',
              'destination_lat',
              'destination_lng',
            ) &&
            const {'S', 'M', 'L'}.contains(p['size']) &&
            const {'low', 'normal', 'high'}.contains(p['priority']),
      );
}

class MerchantOrderOperationStorage {
  const MerchantOrderOperationStorage(this._storage);
  final FlutterSecureStorage _storage;
  String _key(String actor) =>
      'masari_merchant_order_v1:${Uri.encodeComponent(actor)}';
  Future<MerchantPendingOrder?> read(String actorId) async {
    final encoded = await _storage.read(key: _key(actorId));
    if (encoded == null) return null;
    try {
      if (utf8.encode(encoded).length > 60 * 1024) {
        throw const FormatException();
      }
      final decoded = jsonDecode(encoded);
      if (decoded is! Map<String, dynamic>) throw const FormatException();
      final operation = MerchantPendingOrder.fromJson(decoded);
      if (operation.actorId != actorId) throw const FormatException();
      return operation;
    } on FormatException {
      throw const MerchantOrderRecoveryException(
        'merchant_order_recovery_unreadable',
      );
    }
  }

  Future<void> save(MerchantPendingOrder operation) async {
    final previous = await read(operation.actorId);
    if (previous != null) {
      throw const MerchantOrderRecoveryException('merchant_order_pending');
    }
    final encoded = jsonEncode(operation.toJson());
    if (utf8.encode(encoded).length > 60 * 1024) {
      throw const MerchantOrderRecoveryException(
        'merchant_order_recovery_unreadable',
      );
    }
    await _storage.write(key: _key(operation.actorId), value: encoded);
  }

  Future<void> preserve(MerchantPendingOrder operation) async {
    final current = await read(operation.actorId);
    if (current == null) {
      await _storage.write(
        key: _key(operation.actorId),
        value: jsonEncode(operation.toJson()),
      );
    } else if (current.idempotencyKey != operation.idempotencyKey) {
      throw const MerchantOrderRecoveryException(
        'merchant_order_pending_changed',
      );
    }
  }

  Future<void> clear(
    MerchantPendingOrder operation, {
    void Function()? guard,
  }) async {
    final current = await read(operation.actorId);
    if (current?.idempotencyKey != operation.idempotencyKey) {
      throw const MerchantOrderRecoveryException(
        'merchant_order_pending_changed',
      );
    }
    guard?.call();
    try {
      await _storage.delete(key: _key(operation.actorId));
      guard?.call();
    } catch (error, stack) {
      // Logout can race the platform deletion itself. Restore this exact actor's
      // operation before the shared runner releases its single-flight guard.
      try {
        await preserve(operation);
      } catch (_) {
        throw const MerchantOrderRecoveryException(
          'merchant_order_cleanup_failed',
        );
      }
      Error.throwWithStackTrace(error, stack);
    }
  }
}
