import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../../core/api/api_error.dart';
import '../../auth/application/auth_actor_binding.dart';
import '../../auth/data/token_storage.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../canonical_routes/data/canonical_operation_storage.dart';
import '../data/passenger_request_selection_storage.dart';

final legacyPassengerRequestMutationProvider =
    Provider<LegacyPassengerRequestMutation>((ref) {
      final binding = ref.watch(authenticatedActorBindingProvider);
      return LegacyPassengerRequestMutation(
        storage: CanonicalOperationStorage(
          ref.watch(secureStorageProvider),
          storageKey: 'masari_legacy_passenger_create_v1',
        ),
        currentActor: () => binding.actorId,
        selectionStorage: PassengerRequestSelectionStorage(
          ref.watch(secureStorageProvider),
        ),
      );
    });

/// A single durable create operation shared by the ordinary and assistant flows.
/// Its internal sentinel exists only for storage compatibility, never on the wire.
class LegacyPassengerRequestMutation {
  LegacyPassengerRequestMutation({
    required this.storage,
    required this.currentActor,
    this.selectionStorage = const PassengerRequestSelectionStorage(
      FlutterSecureStorage(),
    ),
  }) : _runner = CanonicalMutationRunner(storage: storage);

  static const operation = 'legacy_passenger_request_create';
  static const sentinel = 'legacy_location_request';
  final CanonicalOperationStorage storage;
  final String? Function() currentActor;
  final CanonicalMutationRunner _runner;
  final PassengerRequestSelectionStorage selectionStorage;

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
      storedPayload['client_recovery'] = recoveryContext;
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
      // A 400 from the create handler is a confirmed validation rejection.
      // Auth, transport, provider and malformed-response failures stay unresolved.
      if (error.statusCode == 400 &&
          error.message != 'invalid_response' &&
          currentActor() == actor) {
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
    // Persist the pin before any caller can clear the create receipt. A failed
    // secure-storage write leaves the original idempotent operation unresolved.
    await _rememberSelection(receipt);
    return receipt;
  }

  Future<String?> selectedDriverRouteForRequest(String requestId) async {
    final actor = actorId;
    final selected = await selectionStorage.read(actor, requestId);
    requireActor(actor);
    if (selected == null) {
      final unresolved = await pending();
      requireActor(actor);
      if (unresolved?.payload['client_recovery'] != null) {
        // The response may have committed before the request-to-selection pin
        // was written. Its request identity must be reconciled first; the
        // pending selection cannot safely be assigned to an arbitrary request.
        throw const ApiException(
          ApiErrorType.validation,
          'booking_outcome_unknown',
        );
      }
    }
    return selected;
  }

  Future<void> _rememberSelection(
    CanonicalMutationReceipt<String> receipt,
  ) async {
    final actor = receipt.bundle.actorId;
    requireActor(actor);
    final context = receipt.bundle.payload['client_recovery'];
    if (context == null) return;
    final option = context is Map ? context['option'] : null;
    final routeId = option is Map ? option['id'] : null;
    if (routeId is! String || routeId.trim().isEmpty) {
      throw const FormatException('Missing selected driver route');
    }
    final existing = await selectionStorage.read(actor, receipt.value);
    requireActor(actor);
    if (existing != null && existing != routeId) {
      throw const FormatException('Saved request selection conflict');
    }
    await selectionStorage.save(actor, receipt.value, routeId);
    requireActor(actor);
  }

  Future<void> acknowledge(CanonicalMutationReceipt<String> receipt) async {
    requireActor(receipt.bundle.actorId);
    if (receipt.bundle.operation != operation) {
      throw const CanonicalOperationBlocked(
        'canonical_recovery_acknowledgement_mismatch',
      );
    }
    await _rememberSelection(receipt);
    await _runner.acknowledge(
      actorId: receipt.bundle.actorId,
      operation: operation,
      idempotencyKey: receipt.bundle.idempotencyKey,
    );
    requireActor(receipt.bundle.actorId);
  }
}
