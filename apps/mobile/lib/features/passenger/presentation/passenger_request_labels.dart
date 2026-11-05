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

  /// Whether the request names its own pickup (a chosen place and/or typed
  /// details) rather than only the old place label.
  bool get hasOwnPickup => pickupSummary(arabic: true) != null;

  /// Whether the request names its own drop-off.
  bool get hasOwnDropoff => dropoffSummary(arabic: true) != null;

  /// The chosen pickup place and its optional details, or the old label.
  String pickupText(BuildContext context) =>
      pickupSummary(arabic: _arabic(context)) ??
      localizedCorridorPlace(context, pickupLabel);

  /// The chosen drop-off place and its optional details, or the old label.
  String dropoffText(BuildContext context) =>
      dropoffSummary(arabic: _arabic(context)) ??
      localizedCorridorPlace(context, destinationLabel);
}

/// "from → to" in the reading direction. Each name is bidi-isolated so a
/// Latin place inside an Arabic line keeps the pickup first.
String bidiRoute(BuildContext context, String from, String to) {
  final arrow = Directionality.of(context) == TextDirection.rtl ? '←' : '→';
  return '\u2068$from\u2069 $arrow \u2068$to\u2069';
}
