import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../core/i18n/locale_controller.dart';
import '../domain/place_category.dart';

const _enabledKey = 'place_suggestions_enabled_v1';
const _categoriesKey = 'place_suggestions_categories_v1';

/// The user's choices for "on your road" suggestions. A device setting kept in
/// the app's preferences (like the language): not tied to the account and
/// never sent anywhere.
@immutable
class PlaceSuggestionSettings {
  const PlaceSuggestionSettings({
    required this.enabled,
    required this.categories,
  });

  factory PlaceSuggestionSettings.defaults() => PlaceSuggestionSettings(
    enabled: true,
    categories: defaultSuggestionCategories,
  );

  /// Master switch.
  final bool enabled;

  /// Categories suggestions are on for.
  final Set<String> categories;

  /// What the engine may use: nothing when the master switch is off.
  Set<String> get active => enabled ? categories : const {};

  PlaceSuggestionSettings copyWith({bool? enabled, Set<String>? categories}) =>
      PlaceSuggestionSettings(
        enabled: enabled ?? this.enabled,
        categories: categories ?? this.categories,
      );
}

final placeSuggestionSettingsProvider =
    AsyncNotifierProvider<
      PlaceSuggestionSettingsController,
      PlaceSuggestionSettings
    >(PlaceSuggestionSettingsController.new);

class PlaceSuggestionSettingsController
    extends AsyncNotifier<PlaceSuggestionSettings> {
  late SharedPreferences _preferences;

  @override
  Future<PlaceSuggestionSettings> build() async {
    _preferences = await ref.watch(sharedPreferencesProvider.future);
    final saved = _preferences.getStringList(_categoriesKey);
    final known = {for (final c in suggestibleCategories) c.key};
    return PlaceSuggestionSettings(
      enabled: _preferences.getBool(_enabledKey) ?? true,
      categories: saved == null
          ? defaultSuggestionCategories
          : {
              for (final key in saved)
                if (known.contains(key)) key,
            },
    );
  }

  PlaceSuggestionSettings get _current =>
      state.value ?? PlaceSuggestionSettings.defaults();

  Future<void> setEnabled(bool enabled) async {
    state = AsyncData(_current.copyWith(enabled: enabled));
    await _preferences.setBool(_enabledKey, enabled);
  }

  Future<void> setCategory(String key, bool on) async {
    final categories = {..._current.categories};
    on ? categories.add(key) : categories.remove(key);
    state = AsyncData(_current.copyWith(categories: categories));
    await _preferences.setStringList(
      _categoriesKey,
      categories.toList()..sort(),
    );
  }

  /// "Don't suggest this again" from a suggestion.
  Future<void> turnOffCategory(String key) => setCategory(key, false);
}
