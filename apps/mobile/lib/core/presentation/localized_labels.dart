import 'package:flutter/widgets.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

String localizedLocationSource(AppLocalizations l10n, String source) =>
    switch (source) {
      'simulated' => l10n.sourceSimulated,
      'driver_gps' => l10n.sourceDriverGps,
      _ => source,
    };

/// Arabic names for places already stored as English labels.
///
/// Legacy records keep only an English `pickup_label` / `destination_label`,
/// so rendering them raw leaves Latin text in an otherwise Arabic screen. New
/// choices are shown with the stop's own `name_ar` from the server; this
/// lookup only covers labels saved by earlier releases. Anything unrecognised
/// falls through unchanged rather than being hidden.
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

/// A road travel time such as "25 min" or "1 h 5 min", in the reading
/// language.
String formatRouteDuration(AppLocalizations l10n, int totalMinutes) {
  if (totalMinutes < 60) return l10n.durationMinutesValue(totalMinutes);
  final hours = totalMinutes ~/ 60;
  final minutes = totalMinutes % 60;
  return minutes == 0
      ? l10n.durationHoursValue(hours)
      : l10n.durationHoursMinutesValue(hours, minutes);
}

/// The localized name of a trip status. Unknown values are shown as sent.
String tripStatusLabel(AppLocalizations l10n, String status) =>
    switch (status.toLowerCase()) {
      'created' => l10n.statusCreated,
      'pending' => l10n.statusPending,
      'matched' => l10n.statusMatched,
      'accepted' => l10n.statusAccepted,
      'pickup_started' => l10n.statusPickupStarted,
      'picked_up' => l10n.statusPickedUp,
      'in_transit' => l10n.statusInTransit,
      'delivered' => l10n.statusDelivered,
      'completed' => l10n.statusCompleted,
      'cancelled' => l10n.statusCancelled,
      'failed' => l10n.statusFailed,
      _ => status,
    };
