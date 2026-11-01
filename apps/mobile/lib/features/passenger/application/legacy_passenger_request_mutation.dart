import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_error.dart';
import '../../auth/application/auth_actor_binding.dart';
import '../../auth/data/token_storage.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../canonical_routes/data/canonical_operation_storage.dart';

final legacyPassengerRequestMutationProvider =
    Provider<LegacyPassengerRequestMutation>((ref) {
      final binding = ref.watch(authenticatedActorBindingProvider);
      return LegacyPassengerRequestMutation(
        storage: CanonicalOperationStorage(
          ref.watch(secureStorageProvider),
          storageKey: 'darb_legacy_passenger_create_v1',
        ),
        currentActor: () => binding.actorId,
      );
    });

/// A single durable create operation shared by the ordinary and assistant flows.
/// Its internal sentinel exists only for storage compatibility, never on the wire.
///
/// A driver route picked in the assistant travels in the create body as
/// `selected_driver_route_id`, so the server saves it on the request together
/// with the request itself. The pending bundle only holds it until that write
/// is confirmed; the saved request is the source of truth afterwards.
class LegacyPassengerRequestMutation {
  LegacyPassengerRequestMutation({
    required this.storage,
    required this.currentActor,
  }) : _runner = CanonicalMutationRunner(storage: storage);

  static const operation = 'legacy_passenger_request_create';
  static const sentinel = 'legacy_location_request';
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
      throw const CanonicalOperationBlocked('legacy_recovery_other_account');
    }
    return bundle;
  }

  Future<CanonicalMutationReceipt<String>> create({
    required Map<String, dynamic> payload,
    Map<String, dynamic>? recoveryContext,
    required Future<Map<String, dynamic>> Function(
      Map<String, dynamic> payload,
      String key,
      Future<void> Function() beforeRetry,
    )
    send,
    Future<void> Function()? preflight,
  }) async {
    final actor = actorId;
    CanonicalOperationBundle? attempted;
    final storedPayload = {...payload, 'route_version_id': sentinel};
    if (recoveryContext != null) {
      final option = recoveryContext['option'];
      final routeId = option is Map ? option['id'] : null;
      if (routeId is! String || routeId.trim().isEmpty) {
        throw const FormatException('Missing selected driver route');
      }
      storedPayload['client_recovery'] = recoveryContext;
      storedPayload['selected_driver_route_id'] = routeId;
    }
    late CanonicalMutationReceipt<String> receipt;
    try {
      receipt = await _runner.runWithReceipt<String>(
        operation: operation,
        scope: 'passenger',
        actorId: actor,
        payload: storedPayload,
        onBundle: (bundle) => attempted = bundle,
        // Legacy server keeps completed identities beyond TTL. Reconciliation
        // must reuse that identity even after the client recovery window passes.
        allowExpiredReplay: true,
        preflight: () async {
          requireActor(actor);
          final departure = DateTime.tryParse(
            payload['preferred_time'] as String? ?? '',
          );
          if (departure == null || !departure.isAfter(DateTime.now())) {
            throw const ApiException(
              ApiErrorType.validation,
              'booking_time_passed',
              statusCode: 400,
            );
          }
          await preflight?.call();
        },
        send: (bundle) async {
          requireActor(actor);
          final wire = Map<String, dynamic>.from(bundle.payload)
            ..remove('route_version_id')
            ..remove('client_recovery');
          final response = await send(
            wire,
            bundle.idempotencyKey,
            () async => requireActor(actor),
          );
          requireActor(actor);
          final request = response['request'];
          if (request is! Map ||
              request['id'] is! String ||
              (request['id'] as String).isEmpty) {
            throw const FormatException('Missing saved passenger request');
          }
          return request['id'] as String;
        },
      );
    } on ApiException catch (error) {
      // A 400 from the create handler is a confirmed validation rejection, and
      // so is an unavailable picked route: the server rolls the whole create
      // back. Auth, transport, provider and malformed-response failures stay
      // unresolved.
      final rejected =
          (error.statusCode == 400 && error.message != 'invalid_response') ||
          (error.statusCode == 409 &&
              error.message == 'selected_driver_route_unavailable');
      if (rejected && currentActor() == actor) {
        final bundle = attempted;
        if (bundle != null) {
          try {
            await _runner.acknowledge(
              actorId: actor,
              operation: operation,
              idempotencyKey: bundle.idempotencyKey,
            );
          } on CanonicalOperationBlocked {
            // Another intent may have been saved after this call failed.
          }
        }
      }
      rethrow;
    }
    return receipt;
  }

  Future<void> acknowledge(CanonicalMutationReceipt<String> receipt) async {
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
    requireActor(receipt.bundle.actorId);
  }
}
