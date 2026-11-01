import 'package:flutter/widgets.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

String localizedLocationSource(AppLocalizations l10n, String source) =>
    switch (source) {
      'simulated' => l10n.sourceSimulated,
      _ => source,
    };

/// Arabic names for the fixed corridor's places.
///
/// The API stores these labels in English (`pickup_label`, `destination_label`
/// and the `lockedPickupPresets` constants), so rendering them raw leaves Latin
/// text in an otherwise Arabic screen. The corridor is a closed set, so a
/// lookup is enough; anything unrecognised falls through unchanged rather than
/// being hidden.
String localizedCorridorPlace(BuildContext context, String label) {
  if (Localizations.localeOf(context).languageCode != 'ar') return label;
  return switch (label) {
    // Kept short on purpose: this label is used in chips and card rows, where
    // the full "البوابة الرئيسية لجامعة بوليتكنك فلسطين" crowds out its
    // neighbours.
    'PPU Main Gate' => 'بوابة البوليتكنك',
    'Bab Al-Zawiya' => 'باب الزاوية',
    'Bethlehem Center' => 'وسط بيت لحم',
    'Bethlehem' => 'بيت لحم',
    'Bethlehem Market' => 'سوق بيت لحم',
    'Bethlehem University Area' => 'منطقة جامعة بيت لحم',
    'Manger Street' => 'شارع المهد',
    'Beit Jala Junction' => 'مفرق بيت جالا',
    'Hebron / PPU / Bab Al-Zawiya' =>
      'الخليل / جامعة بوليتكنك فلسطين / باب الزاوية',
    'Hebron Merchant Pickup' => 'نقطة استلام التاجر - الخليل',
    _ => label,
  };
}
