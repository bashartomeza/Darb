import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api/api_error.dart';
import '../../auth/application/auth_actor_binding.dart';
import '../../auth/data/token_storage.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../canonical_routes/data/canonical_operation_storage.dart';
import '../data/driver_models.dart';

final legacyDriverRouteMutationProvider = Provider<LegacyDriverRouteMutation>((
  ref,
) {
  final binding = ref.watch(authenticatedActorBindingProvider);
  return LegacyDriverRouteMutation(
    storage: CanonicalOperationStorage(
      ref.watch(secureStorageProvider),
      storageKey: 'masari_legacy_driver_create_v1',
    ),
    currentActor: () => binding.actorId,
  );
});

class LegacyDriverRouteMutation {
  LegacyDriverRouteMutation({required this.storage, required this.currentActor})
    : _runner = CanonicalMutationRunner(storage: storage);
  static const operation = 'legacy_driver_route_create_v1';
  static const sentinel = 'legacy_driver_route';
  final CanonicalOperationStorage storage;
  final String? Function() currentActor;
  final CanonicalMutationRunner _runner;

  String get actorId {
    final actor = currentActor();
    if (actor == null) {
      throw const ApiException(ApiErrorType.unauthorized, 'session_changed');
    }
    return actor;
  }

  void requireActor(String actor) {
    if (currentActor() != actor) {
      throw const ApiException(ApiErrorType.unauthorized, 'session_changed');
    }
  }

  Future<CanonicalOperationBundle?> pending() async {
    final actor = actorId;
    final bundle = await storage.read();
    requireActor(actor);
    if (bundle != null &&
        (bundle.actorId != actor ||
            bundle.operation != operation ||
            bundle.routeVersionId != sentinel)) {
      throw const CanonicalOperationBlocked(
        'legacy_driver_recovery_other_account',
      );
    }
    return bundle;
  }

  Future<CanonicalMutationReceipt<DriverRoute>> create({
    required int seats,
    required int parcels,
    required Future<DriverRoute> Function(
      String key,
      Future<void> Function() beforeRetry,
    )
    send,
  }) async {
    final actor = actorId;
    return _runner.runWithReceipt<DriverRoute>(
      operation: operation,
      scope: 'driver',
      actorId: actor,
      payload: {
        'route_version_id': sentinel,
        'seats_available': seats,
        'parcel_capacity_available': parcels,
      },
      allowExpiredReplay: true,
      send: (bundle) async {
        requireActor(actor);
        final route = await send(
          bundle.idempotencyKey,
          () async => requireActor(actor),
        );
        requireActor(actor);
        return route;
      },
    );
  }

  Future<void> acknowledge(
    CanonicalMutationReceipt<DriverRoute> receipt,
  ) async {
    requireActor(receipt.bundle.actorId);
    if (receipt.bundle.operation != operation) {
      throw const CanonicalOperationBlocked(
        'canonical_recovery_acknowledgement_mismatch',
      );
    }
    await _runner.acknowledge(
      actorId: receipt.bundle.actorId,
      operation: operation,
      idempotencyKey: receipt.bundle.idempotencyKey,
    );
  }
}
