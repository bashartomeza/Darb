import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../application/push_controller.dart';

/// Wraps the signed-in role shell and, once it is on screen, lets push ask for
/// notification permission (once per install, and only on push-enabled
/// builds). Asking here rather than at launch means the person has signed in
/// and seen the app before the system dialog appears.
class PushPermissionPrompt extends ConsumerStatefulWidget {
  const PushPermissionPrompt({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<PushPermissionPrompt> createState() =>
      _PushPermissionPromptState();
}

class _PushPermissionPromptState extends ConsumerState<PushPermissionPrompt> {
  bool _asked = false;

  @override
  void initState() {
    super.initState();
    // Push may finish starting after the shell appears, so wait for it.
    ref.listenManual<bool>(
      pushControllerProvider.select((push) => push.available),
      (_, available) {
        if (!available || _asked) return;
        _asked = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            ref.read(pushControllerProvider.notifier).promptAfterSignIn();
          }
        });
      },
      fireImmediately: true,
    );
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
