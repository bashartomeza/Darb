import 'package:flutter/widgets.dart';

import '../../../core/presentation/localized_labels.dart';
import '../data/passenger_models.dart';

/// How a passenger request is named on screen. Requests booked on a route
/// carry the route's name and the exact places typed by the passenger; older
/// requests only have place labels, which keep being shown as before.
extension PassengerRequestLabels on PassengerRequest {
  bool _arabic(BuildContext context) =>
      Localizations.localeOf(context).languageCode == 'ar';

  /// The route's name, or "pickup → destination" for older requests.
  String routeTitle(BuildContext context) =>
      routeName(arabic: _arabic(context)) ??
      bidiRoute(
        context,
        localizedCorridorPlace(context, pickupLabel),
        localizedCorridorPlace(context, destinationLabel),
      );

  /// The exact pickup the passenger typed, or the old pickup label.
  String pickupText(BuildContext context) =>
      pickupDetails ?? localizedCorridorPlace(context, pickupLabel);

  /// The exact drop-off the passenger typed, or the old destination label.
  String dropoffText(BuildContext context) =>
      dropoffDetails ?? localizedCorridorPlace(context, destinationLabel);
}

/// "from → to" in the reading direction. Each name is bidi-isolated so a
/// Latin place inside an Arabic line keeps the pickup first.
String bidiRoute(BuildContext context, String from, String to) {
  final arrow = Directionality.of(context) == TextDirection.rtl ? '←' : '→';
  return '\u2068$from\u2069 $arrow \u2068$to\u2069';
}
