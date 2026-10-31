import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_error.dart';
import '../../auth/application/auth_actor_binding.dart';
import '../../auth/application/auth_controller.dart';
import '../application/checkpoint_controller.dart';
import '../domain/checkpoint_models.dart';

/// Existing sheet presentation, bounded by the session that supplied its data.
/// Capture ownership before opening: a stale tap callback must not relabel an
/// old snapshot as belonging to the account that has just signed in.
Future<T?> showCheckpointSheet<T>({
  required BuildContext context,
  required Iterable<Checkpoint> checkpoints,
  required WidgetBuilder builder,
  bool isScrollControlled = false,
  Color? backgroundColor,
  ShapeBorder? shape,
}) {
  final container = ProviderScope.containerOf(context, listen: false);
  final binding = container.read(authenticatedActorBindingProvider);
  final current = container.read(checkpointsProvider).value?.checkpoints;
  final owned = current != null && checkpoints.every(current.contains);
  final actor = binding.actorId;
  final revision = binding.revision;
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: isScrollControlled,
    backgroundColor: backgroundColor,
    shape: shape,
    builder: (sheetContext) => _CheckpointSheetBoundary(
      actor: actor,
      revision: revision,
      owned: owned,
      child: builder(sheetContext),
    ),
  );
}

class _CheckpointSheetBoundary extends ConsumerStatefulWidget {
  const _CheckpointSheetBoundary({
    required this.actor,
    required this.revision,
    required this.owned,
    required this.child,
  });
  final String? actor;
  final int revision;
  final bool owned;
  final Widget child;

  @override
  ConsumerState<_CheckpointSheetBoundary> createState() =>
      _CheckpointSheetBoundaryState();
}

class _CheckpointSheetBoundaryState
    extends ConsumerState<_CheckpointSheetBoundary> {
  bool _closing = false;

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider).value;
    final error = ref.watch(checkpointsProvider.select((value) => value.error));
    final binding = ref.read(authenticatedActorBindingProvider);
    final denied =
        error is ApiException &&
        (error.type == ApiErrorType.unauthorized ||
            error.type == ApiErrorType.forbidden);
    final current =
        widget.owned &&
        widget.actor != null &&
        auth?.isAuthenticated == true &&
        auth?.user?.id == widget.actor &&
        binding.actorId == widget.actor &&
        binding.revision == widget.revision &&
        !denied;
    if (current && !_closing) return widget.child;
    if (!_closing) {
      _closing = true;
      final route = ModalRoute.of(context);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || route == null || !route.isActive) return;
        // Remove only this sheet, including when a different route is above it.
        route.navigator?.removeRoute(route);
      });
    }
    // Never paint captured names while waiting for safe Navigator cleanup.
    return const SizedBox.shrink();
  }
}
