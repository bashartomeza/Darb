import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../data/operating_route_models.dart';
import '../data/operating_route_repository.dart';

/// The shortest pickup or drop-off text the API accepts (after trimming).
const routeDetailsMinLength = 3;

/// The error to show under a pickup/drop-off details field, or null when the
/// text is acceptable. Mirrors the API: trimmed, 3–[routeDetailsMaxLength].
/// The field's own counter already stops typing (and pasting) past the limit.
String? routeDetailsError(AppLocalizations l10n, String text) =>
    text.trim().length < routeDetailsMinLength
    ? l10n.passengerDetailsTooShort
    : null;

bool routeDetailsValid(String text) {
  final length = text.trim().length;
  return length >= routeDetailsMinLength && length <= routeDetailsMaxLength;
}

/// The route list of `GET /operating-routes` as a dropdown, with its loading,
/// failed (retryable) and empty states. [value] is a service route id; a value
/// that is no longer offered shows as unselected.
class OperatingRouteDropdown extends ConsumerWidget {
  const OperatingRouteDropdown({
    required this.value,
    required this.onChanged,
    this.enabled = true,
    this.errorText,
    this.fieldKey = const ValueKey('operatingRouteField'),
    super.key,
  });

  final String? value;
  final ValueChanged<OperatingRoute>? onChanged;
  final bool enabled;
  final String? errorText;
  final Key fieldKey;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final routes = ref.watch(operatingRoutesProvider);

    Widget notice({
      required Key key,
      required Widget leading,
      required String message,
      Widget? action,
    }) {
      return InputDecorator(
        key: key,
        decoration: InputDecoration(
          labelText: l10n.passengerRouteLabel,
          errorText: errorText,
        ),
        child: Row(
          children: [
            leading,
            const SizedBox(width: AppTokens.spaceSmall),
            Expanded(
              child: Text(
                message,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: AppTheme.onSurfaceVariant,
                ),
              ),
            ),
            ?action,
          ],
        ),
      );
    }

    return routes.when(
      skipLoadingOnRefresh: false,
      loading: () => notice(
        key: const ValueKey('operatingRoutesLoading'),
        leading: const SizedBox.square(
          dimension: 18,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
        message: l10n.passengerRoutesLoading,
      ),
      error: (_, _) => notice(
        key: const ValueKey('operatingRoutesError'),
        leading: const Icon(Icons.cloud_off_rounded, size: 20),
        message: l10n.passengerRoutesLoadFailed,
        action: TextButton(
          key: const ValueKey('operatingRoutesRetry'),
          onPressed: () => ref.invalidate(operatingRoutesProvider),
          child: Text(l10n.retry),
        ),
      ),
      data: (items) {
        if (items.isEmpty) {
          return notice(
            key: const ValueKey('operatingRoutesEmpty'),
            leading: const Icon(Icons.route_outlined, size: 20),
            message: l10n.passengerRoutesEmpty,
          );
        }
        final selected = items.any((route) => route.id == value) ? value : null;
        // Keyed by the selection so a value set from outside (a restored
        // booking, the assistant's guess) is shown, not just the first one.
        return KeyedSubtree(
          key: fieldKey,
          child: DropdownButtonFormField<String>(
            key: ValueKey('operatingRouteValue-$selected'),
            initialValue: selected,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: l10n.passengerRouteLabel,
              hintText: l10n.passengerRouteHint,
              prefixIcon: const Icon(Icons.route_rounded, size: 20),
              errorText: errorText,
            ),
            items: [
              for (final route in items)
                DropdownMenuItem(
                  value: route.id,
                  child: Text(
                    route.displayName(arabic: arabic),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: !enabled || onChanged == null
                ? null
                : (id) {
                    final route = items.where((item) => item.id == id);
                    if (route.isNotEmpty) onChanged!(route.first);
                  },
          ),
        );
      },
    );
  }
}

/// A multi-line field for the exact pickup or drop-off, typed as free text.
class RouteDetailsField extends StatelessWidget {
  const RouteDetailsField({
    required this.controller,
    required this.label,
    required this.hint,
    required this.icon,
    this.helper,
    this.errorText,
    this.enabled = true,
    this.onChanged,
    super.key,
  });

  final TextEditingController controller;
  final String label;
  final String hint;
  final IconData icon;
  final String? helper;
  final String? errorText;
  final bool enabled;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      enabled: enabled,
      minLines: 2,
      maxLines: 4,
      maxLength: routeDetailsMaxLength,
      keyboardType: TextInputType.multiline,
      textCapitalization: TextCapitalization.sentences,
      onChanged: onChanged,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        hintMaxLines: 2,
        helperText: helper,
        helperMaxLines: 2,
        errorText: errorText,
        errorMaxLines: 2,
        alignLabelWithHint: true,
        prefixIcon: Icon(icon, size: 20),
      ),
    );
  }
}
