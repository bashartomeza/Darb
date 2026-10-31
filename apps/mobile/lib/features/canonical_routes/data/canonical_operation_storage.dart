import 'dart:convert';
import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../auth/data/token_storage.dart';
import 'operation_fingerprint_io.dart'
    if (dart.library.js_interop) 'operation_fingerprint_web.dart';

final canonicalOperationStorageProvider = Provider<CanonicalOperationStorage>((
  ref,
) {
  return CanonicalOperationStorage(ref.watch(secureStorageProvider));
});

class CanonicalOperationBundle {
  const CanonicalOperationBundle({
    required this.operation,
    required this.scope,
    required this.actorId,
    required this.idempotencyKey,
    required this.payload,
    required this.fingerprint,
    required this.createdAt,
    required this.routeVersionId,
  });

  static const version = 2;
  static const recoveryWindow = Duration(hours: 24);
  static const maximumClockSkew = Duration(minutes: 5);
  final String operation;
  final String scope;
  final String actorId;
  final String idempotencyKey;
  final Map<String, dynamic> payload;
  final String fingerprint;
  final DateTime createdAt;
  final String routeVersionId;

  factory CanonicalOperationBundle.create({
    required String operation,
    required String scope,
    required String actorId,
    required Map<String, dynamic> payload,
    DateTime? now,
  }) {
    final normalized = _normalize(payload);
    final routeVersionId = normalized['route_version_id'];
    if (operation.isEmpty ||
        scope.isEmpty ||
        actorId.isEmpty ||
        routeVersionId is! String ||
        routeVersionId.isEmpty) {
      throw const FormatException('Invalid canonical operation bundle');
    }
    final createdAt = (now ?? DateTime.now()).toUtc();
    return CanonicalOperationBundle(
      operation: operation,
      scope: scope,
      actorId: actorId,
      idempotencyKey: newCanonicalIdempotencyKey(),
      payload: normalized,
      fingerprint: operationFingerprint(jsonEncode(normalized)),
      createdAt: createdAt,
      routeVersionId: routeVersionId,
    );
  }

  bool recoveryWindowExpired(DateTime now) {
    final current = now.toUtc();
    if (createdAt.isAfter(current.add(maximumClockSkew))) return true;
    return !current.isBefore(createdAt.add(recoveryWindow));
  }

  Map<String, dynamic> toJson() => {
    'version': version,
    'operation': operation,
    'scope': scope,
    'actor_id': actorId,
    'idempotency_key': idempotencyKey,
    'payload': payload,
    'fingerprint': fingerprint,
    'created_at': createdAt.toIso8601String(),
    'route_version_id': routeVersionId,
  };

  factory CanonicalOperationBundle.fromJson(Map<String, dynamic> json) {
    const keys = {
      'version',
      'operation',
      'scope',
      'actor_id',
      'idempotency_key',
      'payload',
      'fingerprint',
      'created_at',
      'route_version_id',
    };
    if (json.keys.toSet().difference(keys).isNotEmpty ||
        keys.difference(json.keys.toSet()).isNotEmpty ||
        json['version'] != version ||
        json['operation'] is! String ||
        json['scope'] is! String ||
        json['actor_id'] is! String ||
        json['idempotency_key'] is! String ||
        json['payload'] is! Map<String, dynamic> ||
        json['fingerprint'] is! String ||
        json['created_at'] is! String ||
        json['route_version_id'] is! String) {
      throw const FormatException('Invalid canonical operation bundle');
    }
    final createdAt = DateTime.tryParse(json['created_at'] as String);
    final payload = _normalize(json['payload'] as Map<String, dynamic>);
    if ((json['operation'] as String).isEmpty ||
        (json['scope'] as String).isEmpty ||
        (json['actor_id'] as String).isEmpty ||
        (json['idempotency_key'] as String).isEmpty ||
        (json['route_version_id'] as String).isEmpty ||
        payload['route_version_id'] != json['route_version_id'] ||
        createdAt == null ||
        operationFingerprint(jsonEncode(payload)) != json['fingerprint']) {
      throw const FormatException('Invalid canonical operation bundle');
    }
    return CanonicalOperationBundle(
      operation: json['operation'] as String,
      scope: json['scope'] as String,
      actorId: json['actor_id'] as String,
      idempotencyKey: json['idempotency_key'] as String,
      payload: payload,
      fingerprint: json['fingerprint'] as String,
      createdAt: createdAt.toUtc(),
      routeVersionId: json['route_version_id'] as String,
    );
  }
}

class CanonicalOperationStorage {
  const CanonicalOperationStorage(
    this._storage, {
    String storageKey = bundleKey,
    // Keep the established public named argument while hiding the backing field.
    // ignore: prefer_initializing_formals
  }) : _storageKey = storageKey;

  static const bundleKey = 'masari_canonical_operation_v1';
  static const maximumEncodedBytes = 60 * 1024;
  final FlutterSecureStorage _storage;
  final String _storageKey;
  String get namespace => _storageKey;

  Future<CanonicalOperationBundle?> read() async {
    final encoded = await _storage.read(key: _storageKey);
    if (encoded == null || encoded.isEmpty) return null;
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is! Map<String, dynamic>) {
        throw const FormatException('Invalid canonical operation bundle');
      }
      final bundle = CanonicalOperationBundle.fromJson(decoded);
      return bundle;
    } on FormatException catch (error) {
      throw CanonicalOperationStorageException(
        'canonical_recovery_unreadable',
        error,
      );
    }
  }

  Future<void> save(CanonicalOperationBundle bundle) {
    final encoded = jsonEncode(bundle.toJson());
    if (utf8.encode(encoded).length > maximumEncodedBytes) {
      throw const CanonicalOperationStorageException(
        'canonical_recovery_too_large',
      );
    }
    return _storage.write(key: _storageKey, value: encoded);
  }

  Future<void> clear() => _storage.delete(key: _storageKey);
}

class CanonicalOperationStorageException implements Exception {
  const CanonicalOperationStorageException(this.code, [this.cause]);

  final String code;
  final Object? cause;

  @override
  String toString() => code;
}

String newCanonicalIdempotencyKey() {
  const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-';
  final random = Random.secure();
  return List.generate(
    32,
    (_) => alphabet[random.nextInt(alphabet.length)],
  ).join();
}

Map<String, dynamic> _normalize(Map<String, dynamic> input) {
  final keys = input.keys.toList()..sort();
  return {
    for (final key in keys)
      key: switch (input[key]) {
        Map<String, dynamic> map => _normalize(map),
        List list =>
          list
              .map(
                (value) =>
                    value is Map<String, dynamic> ? _normalize(value) : value,
              )
              .toList(growable: false),
        final value => value,
      },
  };
}
