import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_error.dart';
import '../data/canonical_operation_storage.dart';
import '../data/canonical_route_repository.dart';
import '../domain/canonical_route_models.dart';

final mobileCapabilitiesProvider =
    AsyncNotifierProvider<MobileCapabilitiesNotifier, MobileCapabilities>(
      MobileCapabilitiesNotifier.new,
    );

class MobileCapabilitiesNotifier extends AsyncNotifier<MobileCapabilities> {
  @override
  Future<MobileCapabilities> build() {
    return ref.read(canonicalRouteRepositoryProvider).capabilities();
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      () => ref.read(canonicalRouteRepositoryProvider).capabilities(),
    );
  }
}

final canonicalRouteCatalogProvider =
    AsyncNotifierProvider<CanonicalRouteCatalogNotifier, List<CanonicalRoute>>(
      CanonicalRouteCatalogNotifier.new,
    );

class CanonicalRouteCatalogNotifier
    extends AsyncNotifier<List<CanonicalRoute>> {
  @override
  Future<List<CanonicalRoute>> build() async {
    final capabilities = await ref.watch(mobileCapabilitiesProvider.future);
    if (!capabilities.routeCatalogAvailable ||
        !capabilities.multiRouteEntryAvailable) {
      return const [];
    }
    return ref.read(canonicalRouteRepositoryProvider).routes();
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      await ref.read(mobileCapabilitiesProvider.notifier).refresh();
      final capabilities = await ref.read(mobileCapabilitiesProvider.future);
      if (!capabilities.routeCatalogAvailable ||
          !capabilities.multiRouteEntryAvailable) {
        return const [];
      }
      return ref.read(canonicalRouteRepositoryProvider).routes();
    });
  }
}

final driverAvailabilitiesProvider =
    AsyncNotifierProvider<
      DriverAvailabilitiesNotifier,
      List<DriverAvailability>
    >(DriverAvailabilitiesNotifier.new);

class DriverAvailabilitiesNotifier
    extends AsyncNotifier<List<DriverAvailability>> {
  bool _mutating = false;

  @override
  Future<List<DriverAvailability>> build() async {
    final capabilities = await ref.watch(mobileCapabilitiesProvider.future);
    if (!capabilities.multiRouteEntryAvailable) return const [];
    return ref.read(canonicalRouteRepositoryProvider).availabilities();
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      () => ref.read(canonicalRouteRepositoryProvider).availabilities(),
    );
  }

  Future<DriverAvailability> create(
    Map<String, dynamic> payload, {
    required String actorId,
    void Function(CanonicalOperationBundle bundle)? onBundle,
  }) async {
    if (_mutating) throw StateError('operation_in_progress');
    _mutating = true;
    try {
      final value = await ref
          .read(canonicalMutationRunnerProvider)
          .run<DriverAvailability>(
            operation: 'driver_availability_create',
            allowExpiredReplay: true,
            scope: 'driver',
            actorId: actorId,
            payload: payload,
            onBundle: onBundle,
            preflight: () async {
              final departure = DateTime.parse(
                payload['departure_at'] as String,
              );
              final windowEnd = payload['availability_window_end'] is String
                  ? DateTime.parse(payload['availability_window_end'] as String)
                  : null;
              if (!departure.isAfter(DateTime.now()) ||
                  (windowEnd != null && !windowEnd.isAfter(departure))) {
                throw const ApiException(
                  ApiErrorType.validation,
                  'invalid_availability_window',
                  statusCode: 400,
                );
              }
              await ref
                  .read(canonicalRouteRepositoryProvider)
                  .requireFreshRoute(payload['route_version_id'] as String);
            },
            send: (bundle) => ref
                .read(canonicalRouteRepositoryProvider)
                .createAvailability(
                  payload: bundle.payload,
                  idempotencyKey: bundle.idempotencyKey,
                ),
          );
      await refresh();
      return value;
    } finally {
      _mutating = false;
    }
  }

  Future<DriverAvailability> editAvailability(
    DriverAvailability availability,
    Map<String, dynamic> changes,
  ) async {
    if (_mutating) throw StateError('operation_in_progress');
    _mutating = true;
    try {
      try {
        final value = await ref
            .read(canonicalRouteRepositoryProvider)
            .updateAvailability(availability.id, {
              'expected_revision': availability.revision,
              ...changes,
            });
        await refresh();
        return value;
      } catch (_) {
        await refresh();
        rethrow;
      }
    } finally {
      _mutating = false;
    }
  }

  Future<DriverAvailability> transition(
    DriverAvailability availability,
    String action,
  ) async {
    if (_mutating) throw StateError('operation_in_progress');
    _mutating = true;
    try {
      try {
        final value = await ref
            .read(canonicalRouteRepositoryProvider)
            .transitionAvailability(availability, action);
        await refresh();
        return value;
      } catch (_) {
        // Response loss can leave the mutation committed. Reloading server
        // state prevents a second lifecycle action based on a stale revision.
        await refresh();
        rethrow;
      }
    } finally {
      _mutating = false;
    }
  }
}

final canonicalMutationRunnerProvider = Provider<CanonicalMutationRunner>((
  ref,
) {
  return CanonicalMutationRunner(
    storage: ref.watch(canonicalOperationStorageProvider),
  );
});

class CanonicalMutationReceipt<T> {
  const CanonicalMutationReceipt({required this.value, required this.bundle});
  final T value;
  final CanonicalOperationBundle bundle;
}

class CanonicalMutationRunner {
  CanonicalMutationRunner({required this.storage, DateTime Function()? now})
    : _now = now ?? DateTime.now;

  final CanonicalOperationStorage storage;
  final DateTime Function() _now;
  bool _busy = false;
  static final Map<String, Future<void>> _storageTails = {};

  Future<T> _serialize<T>(Future<T> Function() action) async {
    final namespace = storage.namespace;
    final previous = _storageTails[namespace] ?? Future<void>.value();
    final released = Completer<void>();
    _storageTails[namespace] = released.future;
    await previous;
    try {
      return await action();
    } finally {
      released.complete();
      if (identical(_storageTails[namespace], released.future)) {
        _storageTails.remove(namespace);
      }
    }
  }

  Future<CanonicalMutationReceipt<T>> runWithReceipt<T>({
    required String operation,
    required String scope,
    required String actorId,
    required Map<String, dynamic> payload,
    Future<void> Function()? preflight,
    bool allowExpiredReplay = false,
    void Function(CanonicalOperationBundle bundle)? onBundle,
    required Future<T> Function(CanonicalOperationBundle bundle) send,
  }) async {
    CanonicalOperationBundle? selected;
    final value = await run<T>(
      operation: operation,
      scope: scope,
      actorId: actorId,
      payload: payload,
      preflight: preflight,
      allowExpiredReplay: allowExpiredReplay,
      onBundle: (bundle) {
        selected = bundle;
        onBundle?.call(bundle);
      },
      send: send,
    );
    return CanonicalMutationReceipt(value: value, bundle: selected!);
  }

  Future<T> run<T>({
    required String operation,
    required String scope,
    required String actorId,
    required Map<String, dynamic> payload,
    Future<void> Function()? preflight,
    bool allowExpiredReplay = false,
    void Function(CanonicalOperationBundle bundle)? onBundle,
    required Future<T> Function(CanonicalOperationBundle bundle) send,
  }) async {
    if (_busy) throw StateError('operation_in_progress');
    _busy = true;
    try {
      return await _serialize<T>(() async {
        final candidate = CanonicalOperationBundle.create(
          operation: operation,
          scope: scope,
          actorId: actorId,
          payload: payload,
          now: _now(),
        );
        final pending = await storage.read();
        final bundle = pending == null
            ? candidate
            : _requireExactPending(
                pending,
                candidate,
                actorId: actorId,
                operation: operation,
                scope: scope,
                allowExpiredReplay: allowExpiredReplay,
              );
        if (pending == null) {
          await preflight?.call();
          await storage.save(bundle);
        }
        try {
          onBundle?.call(bundle);
          return await send(bundle);
        } catch (error) {
          if (pending == null && !_ambiguous(error)) await storage.clear();
          rethrow;
        }
      });
    } finally {
      _busy = false;
    }
  }

  CanonicalOperationBundle _requireExactPending(
    CanonicalOperationBundle pending,
    CanonicalOperationBundle candidate, {
    required String actorId,
    required String operation,
    required String scope,
    required bool allowExpiredReplay,
  }) {
    if (!allowExpiredReplay && pending.recoveryWindowExpired(_now())) {
      throw const CanonicalOperationBlocked('canonical_recovery_expired');
    }
    if (pending.actorId != actorId) {
      throw const CanonicalOperationBlocked('canonical_recovery_other_account');
    }
    final exact =
        pending.operation == operation &&
        pending.scope == scope &&
        pending.fingerprint == candidate.fingerprint &&
        jsonEncode(pending.payload) == jsonEncode(candidate.payload);
    if (!exact) {
      throw const CanonicalOperationBlocked('canonical_recovery_unresolved');
    }
    return pending;
  }

  Future<void> acknowledge({
    required String actorId,
    required String operation,
    required String idempotencyKey,
  }) => _serialize<void>(() async {
    final pending = await storage.read();
    if (pending == null) return;
    if (pending.actorId != actorId ||
        pending.operation != operation ||
        pending.idempotencyKey != idempotencyKey) {
      throw const CanonicalOperationBlocked(
        'canonical_recovery_acknowledgement_mismatch',
      );
    }
    await storage.clear();
  });
}

class CanonicalOperationBlocked implements Exception {
  const CanonicalOperationBlocked(this.code);

  final String code;

  @override
  String toString() => code;
}

bool _ambiguous(Object error) {
  if (error is FormatException) return true;
  if (error is! ApiException) return false;
  return error.type == ApiErrorType.network ||
      error.type == ApiErrorType.timeout ||
      error.type == ApiErrorType.server ||
      error.message == 'session_changed' ||
      error.message == 'invalid_response' ||
      error.statusCode == 502 ||
      error.statusCode == 503 ||
      error.message == 'transaction_retry_required' ||
      error.message == 'idempotency_in_progress' ||
      error.message == 'idempotency_replay_unavailable' ||
      error.message == 'idempotency_conflict';
}

bool canonicalAvailabilityResultMatches(
  CanonicalOperationBundle pending,
  DriverAvailability availability,
) {
  return pending.operation == 'driver_availability_create' &&
      pending.routeVersionId == availability.routeVersionId &&
      _samePersistedInstant(
        pending.payload['departure_at'],
        availability.departureAt,
      ) &&
      _sameOptionalPersistedInstant(
        pending.payload['availability_window_end'],
        availability.windowEnd,
      ) &&
      pending.payload['total_seats'] == availability.totalSeats &&
      pending.payload['total_parcel_capacity'] ==
          availability.totalParcelCapacity;
}

bool _samePersistedInstant(Object? encoded, DateTime value) {
  if (encoded is! String) return false;
  final parsed = DateTime.tryParse(encoded);
  return parsed != null &&
      parsed.toUtc().millisecondsSinceEpoch ==
          value.toUtc().millisecondsSinceEpoch;
}

bool _sameOptionalPersistedInstant(Object? encoded, DateTime? value) {
  if (encoded == null || value == null) return encoded == null && value == null;
  return _samePersistedInstant(encoded, value);
}
