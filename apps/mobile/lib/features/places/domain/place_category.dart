import 'package:flutter/material.dart';

import 'package:darb_mobile/l10n/app_localizations.dart';

/// The id of the "Checkpoints" filter. It sits in the same chip row as the
/// place categories but is not one of them.
const String checkpointsFilterId = 'checkpoints';

/// Who may be offered a category as a gentle suggestion on a trip.
enum SuggestionAudience { rider, driver }

/// One kind of place on the map.
///
/// The list below mirrors apps/api/data/map-place-categories.json (the API
/// refuses keys that are not in that file). To add a category: add it to that
/// file, add an entry here with an icon, and add its labels to both ARB files
/// and to [placeCategoryLabel]; chips, the filter, the sheet and the settings
/// list follow from this registry.
@immutable
class PlaceCategory {
  const PlaceCategory({
    required this.key,
    required this.icon,
    required this.color,
    this.suggestFor = const {},
    this.suggestByDefault = false,
  });

  /// The API's category key.
  final String key;
  final IconData icon;
  final Color color;

  /// Roles that may be offered this category as a suggestion. Empty: never
  /// suggested (the category is still a map filter).
  final Set<SuggestionAudience> suggestFor;

  /// Whether the suggestion is on until the user turns it off in Settings.
  final bool suggestByDefault;

  bool get suggestible => suggestFor.isNotEmpty;
}

const _both = {SuggestionAudience.rider, SuggestionAudience.driver};
const _driverOnly = {SuggestionAudience.driver};

/// Display and suggestion order. Health places are deliberately never
/// suggested: whether one is relevant is not something the app can know, and a
/// suggestion must never appear in an emergency.
const List<PlaceCategory> placeCategories = [
  PlaceCategory(
    key: 'cafe',
    icon: Icons.local_cafe_rounded,
    color: Color(0xFF8D5A3B),
    suggestFor: _both,
    suggestByDefault: true,
  ),
  PlaceCategory(
    key: 'restaurant',
    icon: Icons.restaurant_rounded,
    color: Color(0xFFD9822B),
    suggestFor: _both,
    suggestByDefault: true,
  ),
  PlaceCategory(
    key: 'fuel',
    icon: Icons.local_gas_station_rounded,
    color: Color(0xFFC62828),
    suggestFor: _driverOnly,
    suggestByDefault: true,
  ),
  PlaceCategory(
    key: 'rest_stop',
    icon: Icons.wc_rounded,
    color: Color(0xFF00897B),
    suggestFor: _both,
    suggestByDefault: true,
  ),
  PlaceCategory(
    key: 'pharmacy',
    icon: Icons.local_pharmacy_rounded,
    color: Color(0xFF2E7D32),
  ),
  PlaceCategory(
    key: 'hospital',
    icon: Icons.local_hospital_rounded,
    color: Color(0xFFD32F2F),
  ),
  PlaceCategory(
    key: 'clinic',
    icon: Icons.medical_services_rounded,
    color: Color(0xFF0277BD),
  ),
  PlaceCategory(
    key: 'supermarket',
    icon: Icons.shopping_cart_rounded,
    color: Color(0xFF6A1B9A),
    suggestFor: _both,
  ),
  PlaceCategory(
    key: 'atm',
    icon: Icons.account_balance_rounded,
    color: Color(0xFF455A64),
    suggestFor: _both,
  ),
  PlaceCategory(
    key: 'mosque',
    icon: Icons.mosque_rounded,
    color: Color(0xFF1B5E20),
    suggestFor: _both,
  ),
  PlaceCategory(
    key: 'car_repair',
    icon: Icons.car_repair_rounded,
    color: Color(0xFF5D4037),
    suggestFor: _driverOnly,
  ),
  PlaceCategory(
    key: 'ev_charging',
    icon: Icons.ev_station_rounded,
    color: Color(0xFF00838F),
    suggestFor: _driverOnly,
  ),
];

PlaceCategory? placeCategoryFor(String key) {
  for (final category in placeCategories) {
    if (category.key == key) return category;
  }
  return null;
}

/// Categories the user can switch suggestions on or off for.
List<PlaceCategory> get suggestibleCategories => [
  for (final category in placeCategories)
    if (category.suggestible) category,
];

/// The categories whose suggestions are on until the user changes them.
Set<String> get defaultSuggestionCategories => {
  for (final category in placeCategories)
    if (category.suggestByDefault) category.key,
};

String placeCategoryLabel(AppLocalizations l10n, String key) {
  return switch (key) {
    'cafe' => l10n.placeCategoryCafe,
    'restaurant' => l10n.placeCategoryRestaurant,
    'fuel' => l10n.placeCategoryFuel,
    'rest_stop' => l10n.placeCategoryRestStop,
    'pharmacy' => l10n.placeCategoryPharmacy,
    'hospital' => l10n.placeCategoryHospital,
    'clinic' => l10n.placeCategoryClinic,
    'supermarket' => l10n.placeCategorySupermarket,
    'atm' => l10n.placeCategoryAtm,
    'mosque' => l10n.placeCategoryMosque,
    'car_repair' => l10n.placeCategoryCarRepair,
    'ev_charging' => l10n.placeCategoryEvCharging,
    checkpointsFilterId => l10n.mapFilterCheckpoints,
    _ => key,
  };
}

/// The line shown when a place of [key] is near the trip. Always names the
/// kind of place; [name] is added when the place has one.
String placeSuggestionMessage(AppLocalizations l10n, String key, String? name) {
  final named = name != null && name.isNotEmpty;
  return switch (key) {
    'cafe' => named ? l10n.placeSuggestCafeNamed(name) : l10n.placeSuggestCafe,
    'restaurant' =>
      named
          ? l10n.placeSuggestRestaurantNamed(name)
          : l10n.placeSuggestRestaurant,
    'fuel' => named ? l10n.placeSuggestFuelNamed(name) : l10n.placeSuggestFuel,
    'rest_stop' =>
      named ? l10n.placeSuggestRestStopNamed(name) : l10n.placeSuggestRestStop,
    _ =>
      named
          ? l10n.placeSuggestGenericNamed(placeCategoryLabel(l10n, key), name)
          : l10n.placeSuggestGeneric(placeCategoryLabel(l10n, key)),
  };
}
