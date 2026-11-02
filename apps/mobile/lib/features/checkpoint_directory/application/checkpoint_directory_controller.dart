import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../auth/application/auth_actor_binding.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/auth_models.dart';
import '../data/checkpoint_directory_repository.dart';

typedef DirectoryOwner = (String, int);
final checkpointDirectoryOwnerProvider = Provider<DirectoryOwner?>((ref) {
  final auth = ref.watch(authControllerProvider).value;
  final binding = ref.read(authenticatedActorBindingProvider);
  if (auth?.isAuthenticated != true ||
      auth?.user?.id != binding.actorId ||
      binding.actorId == null ||
      ![UserRole.passenger, UserRole.driver].contains(auth?.user?.role)) {
    return null;
  }
  return (binding.actorId!, binding.revision);
});

final checkpointDirectoryCapabilityProvider = FutureProvider.autoDispose
    .family<bool, DirectoryOwner>((ref, owner) {
      void current() {
        if (!ref.mounted ||
            ref.read(checkpointDirectoryOwnerProvider) != owner) {
          throw StateError('session_changed');
        }
      }

      current();
      return ref.read(checkpointDirectoryRepositoryProvider).available(current);
    });

final checkpointDirectoryProvider = FutureProvider.autoDispose.family((
  ref,
  DirectoryOwner owner,
) async {
  void current() {
    if (!ref.mounted || ref.read(checkpointDirectoryOwnerProvider) != owner) {
      throw StateError('session_changed');
    }
  }

  current();
  final available = await ref.watch(
    checkpointDirectoryCapabilityProvider(owner).future,
  );
  current();
  if (!available) return null;
  return ref.read(checkpointDirectoryRepositoryProvider).read(current);
});
