import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_error.dart';
import '../../../core/api/authoritative_refresh.dart';
import '../../auth/application/auth_actor_binding.dart';
import '../../auth/application/auth_controller.dart';
import '../data/checkpoint_repository.dart';
import '../domain/checkpoint_models.dart';

final checkpointsProvider =
    AsyncNotifierProvider<CheckpointsNotifier, CheckpointSnapshot>(
      CheckpointsNotifier.new,
    );

class CheckpointsNotifier extends AsyncNotifier<CheckpointSnapshot> {
  late AuthoritativeRefresh<CheckpointSnapshot> _reads;
  (String?, int)? _owner;
  int _generation = 0;

  (String?, int) _currentOwner() {
    final auth = ref.read(authControllerProvider).value;
    final binding = ref.read(authenticatedActorBindingProvider);
    final actor =
        auth?.isAuthenticated == true && auth?.user?.id == binding.actorId
        ? binding.actorId
        : null;
    return (actor, binding.revision);
  }

  @override
  FutureOr<CheckpointSnapshot> build() {
    final generation = ++_generation;
    final reads = _reads = AuthoritativeRefresh<CheckpointSnapshot>();
    ref.onDispose(() {
      reads.dispose();
      if (_generation == generation) _generation++;
    });
    // The shared actor binding is deliberately non-reactive. Observe its owning
    // auth controller, without replacing the coordinator's single listener.
    ref.listen(authControllerProvider, (_, _) {
      if (_currentOwner() == _owner) return;
      // AsyncLoading/invalidation alone retains .value, which the maps render.
      // Remove it synchronously before invalidating the old async generation.
      state = const AsyncData(CheckpointSnapshot.empty);
      ref.invalidateSelf();
    });
    final owner = _owner = _currentOwner();
    if (owner.$1 == null) return CheckpointSnapshot.empty;
    return _read(owner, generation, reads);
  }

  Future<void> refresh() async {
    if (!ref.mounted) return;
    final owner = _owner;
    if (owner == null || owner.$1 == null) {
      state = const AsyncData(CheckpointSnapshot.empty);
      return;
    }
    state = const AsyncLoading();
    try {
      await _read(owner, _generation, _reads);
    } catch (_) {
      // Current failures are exposed in state; obsolete work is discarded.
      // Preserve the existing Future<void> refresh caller contract.
    }
  }

  Future<CheckpointSnapshot> _read(
    (String?, int) owner,
    int generation,
    AuthoritativeRefresh<CheckpointSnapshot> reads,
  ) async {
    bool isCurrent() =>
        ref.mounted && generation == _generation && _currentOwner() == owner;
    void requireCurrent() {
      if (!isCurrent()) throw StateError('session_changed');
    }

    try {
      return await reads.run(
        load: () {
          requireCurrent();
          return ref
              .read(checkpointRepositoryProvider)
              .checkpoints(beforeSend: requireCurrent);
        },
        publish: (next) => state = AsyncData(next),
        isCurrent: isCurrent,
      );
    } catch (error, stack) {
      if (isCurrent()) {
        if (error is ApiException &&
            (error.type == ApiErrorType.unauthorized ||
                error.type == ApiErrorType.forbidden)) {
          state = const AsyncData(CheckpointSnapshot.empty);
        }
        state = AsyncError(error, stack);
      }
      rethrow;
    }
  }
}
