import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/theme/passenger_theme.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/auth_models.dart';
import '../application/place_suggestion_settings.dart';
import '../domain/place_category.dart';

/// Settings for "on your road" place suggestions: one master switch and a
/// switch per kind of place ("Don't suggest this again" in the banner turns a
/// kind off here). Shown for riders and drivers; merchants get no suggestions.
class PlaceSuggestionsSettingsTile extends ConsumerWidget {
  const PlaceSuggestionsSettingsTile({super.key}) : _passenger = false;

  /// The passenger settings list style.
  const PlaceSuggestionsSettingsTile.passenger({super.key}) : _passenger = true;

  final bool _passenger;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Merchants are never offered suggestions, so they get no setting for them.
    final role = ref.watch(authControllerProvider).value?.user?.role;
    if (role == UserRole.merchant) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final settings =
        ref.watch(placeSuggestionSettingsProvider).value ??
        PlaceSuggestionSettings.defaults();
    final controller = ref.read(placeSuggestionSettingsProvider.notifier);

    final tile = ExpansionTile(
      key: const ValueKey('placeSuggestionsTile'),
      leading: const Icon(Icons.local_cafe_outlined),
      title: Text(l10n.placeSuggestSettingTitle),
      subtitle: Text(l10n.placeSuggestSettingSubtitle),
      shape: const Border(),
      collapsedShape: const Border(),
      children: [
        SwitchListTile(
          key: const ValueKey('placeSuggestionsMaster'),
          title: Text(l10n.placeSuggestSettingMaster),
          value: settings.enabled,
          onChanged: controller.setEnabled,
        ),
        for (final category in suggestibleCategories)
          CheckboxListTile(
            key: ValueKey('placeSuggestions_${category.key}'),
            secondary: Icon(category.icon, color: category.color),
            title: Text(placeCategoryLabel(l10n, category.key)),
            value: settings.categories.contains(category.key),
            onChanged: settings.enabled
                ? (on) => controller.setCategory(category.key, on ?? false)
                : null,
          ),
      ],
    );

    if (!_passenger) return tile;
    return Material(
      color: PassengerStyle.panel,
      borderRadius: BorderRadius.circular(PassengerStyle.radiusTile),
      clipBehavior: Clip.antiAlias,
      child: tile,
    );
  }
}
