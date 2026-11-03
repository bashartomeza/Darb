import 'package:flutter/material.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../api/saved_request_outcome.dart';

/// Lets a person drop a saved, unconfirmed request that is holding a screen,
/// so they can start again. Asks first: if the earlier send did reach Darb,
/// starting again can create a duplicate.
class DiscardSavedRequestButton extends StatelessWidget {
  const DiscardSavedRequestButton({
    required this.onDiscard,
    this.enabled = true,
    super.key,
  });

  final Future<void> Function() onDiscard;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return TextButton.icon(
      key: const ValueKey('discardSavedRequest'),
      onPressed: enabled ? () => _confirm(context) : null,
      icon: const Icon(Icons.delete_outline),
      label: Text(l10n.discardSavedRequest),
    );
  }

  Future<void> _confirm(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.discardSavedRequestTitle),
        content: Text(l10n.discardSavedRequestBody),
        actions: [
          TextButton(
            key: const ValueKey('cancelDiscardSavedRequest'),
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            key: const ValueKey('confirmDiscardSavedRequest'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.discardSavedRequestConfirm),
          ),
        ],
      ),
    );
    if (confirmed == true) await onDiscard();
  }
}

/// The message for a saved request that was removed because the server
/// refused it or it could not be confirmed in time; null for other errors.
String? savedRequestOutcomeLabel(AppLocalizations l10n, Object error) =>
    switch (error) {
      SavedRequestRejected() => l10n.savedRequestRejected,
      SavedRequestExpired() => l10n.savedRequestExpired,
      _ => null,
    };
