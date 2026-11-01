import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/darb_card.dart';
import '../../auth/application/auth_controller.dart';

class SessionStatusBanner extends ConsumerWidget {
  const SessionStatusBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider).value;
    final l10n = AppLocalizations.of(context);
    if (auth?.status == AuthStatus.refreshing) {
      return DarbCard(
        child: Row(
          children: [
            const SizedBox.square(
              dimension: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(width: AppTokens.spaceSmall),
            Expanded(child: Text(l10n.refreshingSession)),
          ],
        ),
      );
    }
    if (auth?.status == AuthStatus.retryableFailure) {
      return DarbCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.unableToRefresh),
            const SizedBox(height: AppTokens.spaceSmall),
            FilledButton(
              onPressed: () =>
                  ref.read(authControllerProvider.notifier).retryRefresh(),
              child: Text(l10n.retry),
            ),
          ],
        ),
      );
    }
    return const SizedBox.shrink();
  }
}
