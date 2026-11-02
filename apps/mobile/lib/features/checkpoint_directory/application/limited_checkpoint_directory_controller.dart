import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'checkpoint_directory_controller.dart';
import '../data/limited_checkpoint_directory_repository.dart';
import '../domain/limited_checkpoint_directory.dart';

enum DirectorySource { research, limitedProvider }

final limitedCheckpointDirectoryCapabilityProvider = FutureProvider.autoDispose
    .family<bool, DirectoryOwner>((ref, owner) {
      void current() {
        if (!ref.mounted ||
            ref.read(checkpointDirectoryOwnerProvider) != owner) {
          throw StateError('session_changed');
        }
      }

      current();
      return ref
          .read(limitedCheckpointDirectoryRepositoryProvider)
          .available(current);
    });
// The explicitly enabled limited source takes precedence; sources never merge.
final checkpointDirectorySourceProvider = FutureProvider.autoDispose
    .family<DirectorySource?, DirectoryOwner>((ref, owner) async {
      final limited = await ref.watch(
        limitedCheckpointDirectoryCapabilityProvider(owner).future,
      );
      if (!ref.mounted || ref.read(checkpointDirectoryOwnerProvider) != owner) {
        throw StateError('session_changed');
      }
      if (limited) return DirectorySource.limitedProvider;
      final research = await ref.watch(
        checkpointDirectoryCapabilityProvider(owner).future,
      );
      if (!ref.mounted || ref.read(checkpointDirectoryOwnerProvider) != owner) {
        throw StateError('session_changed');
      }
      return research ? DirectorySource.research : null;
    });
final limitedCheckpointDirectoryProvider = FutureProvider.autoDispose
    .family<DirectoryDisplayCatalog?, DirectoryOwner>((ref, owner) async {
      void current() {
        if (!ref.mounted ||
            ref.read(checkpointDirectoryOwnerProvider) != owner) {
          throw StateError('session_changed');
        }
      }

      current();
      final enabled = await ref.watch(
        limitedCheckpointDirectoryCapabilityProvider(owner).future,
      );
      current();
      if (!enabled) return null;
      return (await ref
              .read(limitedCheckpointDirectoryRepositoryProvider)
              .read(current))
          .catalog;
    });
